import math
import cv2
import mediapipe as mp
import numpy as np 
import time
import os
import sys
import threading
import queue
import logging
from collections import deque
from typing import Dict, Any
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

try:
    from logger_config import get_logger, write_crash_fallback
    logger = get_logger("VisionEngine")
except Exception as _e:
    def write_crash_fallback(msg: str):
        try:
            log_dir = os.path.expanduser("~/Documents/ShackleAI/logs")
            os.makedirs(log_dir, exist_ok=True)
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(os.path.join(log_dir, "crash_fallback.txt"), "a", encoding="utf-8") as f:
                f.write(f"[{ts}] [CRASH_FALLBACK] {msg}\n")
        except Exception:
            pass
    write_crash_fallback(f"Failed loading logger_config in vision.py: {_e}")
    logger = logging.getLogger("VisionEngine")


class BackgroundCameraStream:
    """Polled frame buffering class to prevent OpenCV main thread synchronization locks."""
    def __init__(self, src=0):
        self.cap = None
        self.frame_queue = queue.Queue(maxsize=2)
        self.stopped = False
        self.backend_used = "UNKNOWN"
        self.error_mode = None  # None | 'permission_denied' | 'no_camera_found' | 'device_busy'
        self.error_message = ""

        # Check process elevation context on Windows
        is_elevated = False
        if sys.platform == "win32":
            try:
                import ctypes
                is_elevated = bool(ctypes.windll.shell32.IsUserAnAdmin())
            except Exception:
                pass

        logger.info(f"[CAMERA DIAGNOSTIC] Initializing VideoCapture({src}). Elevated/Admin process context: {is_elevated}")

        # Primary backend: default OpenCV backend (MSMF on Windows)
        try:
            self.cap = cv2.VideoCapture(src)
            backend_name = self.cap.getBackendName() if hasattr(self.cap, "getBackendName") else "DEFAULT"
            logger.info(f"[CAMERA DIAGNOSTIC] Primary VideoCapture({src}) initialized backend: {backend_name}. cap.isOpened()={self.cap.isOpened()}")
            self.backend_used = backend_name
        except Exception as e:
            logger.warning(f"[CAMERA DIAGNOSTIC] Primary VideoCapture({src}) exception: {e}")

        # Fallback backend: DirectShow on Windows if primary unopened
        if (self.cap is None or not self.cap.isOpened()) and sys.platform == "win32":
            logger.info("[CAMERA DIAGNOSTIC] Primary VideoCapture unopened. Attempting DirectShow fallback: cv2.VideoCapture(src, cv2.CAP_DSHOW)")
            try:
                if self.cap:
                    self.cap.release()
                self.cap = cv2.VideoCapture(src, cv2.CAP_DSHOW)
                backend_name = self.cap.getBackendName() if hasattr(self.cap, "getBackendName") else "CAP_DSHOW"
                logger.info(f"[CAMERA DIAGNOSTIC] DirectShow fallback cap.isOpened()={self.cap.isOpened()}")
                self.backend_used = backend_name
            except Exception as e:
                logger.warning(f"[CAMERA DIAGNOSTIC] DirectShow fallback VideoCapture({src}) exception: {e}")

        # Diagnostic categorization
        if self.cap is None or not self.cap.isOpened():
            if is_elevated:
                self.error_mode = "permission_denied"
                self.error_message = "Windows Camera Privacy Policy or MSMF security context blocked elevated camera access. Grant camera access to desktop apps or run without Admin elevation."
                logger.error(f"[CAMERA ERROR] {self.error_message}")
            else:
                self.error_mode = "no_camera_found"
                self.error_message = f"No active camera device found on VideoCapture({src}). Ensure webcam is plugged in."
                logger.error(f"[CAMERA ERROR] {self.error_message}")
        else:
            # Test-read 1 frame
            ret, test_frame = self.cap.read()
            if not ret or test_frame is None:
                if is_elevated:
                    self.error_mode = "permission_denied"
                    self.error_message = "Camera device opened but read() returned no frame (Elevated Windows Privacy Block / MSMF Sandbox Lock)."
                    logger.error(f"[CAMERA ERROR] {self.error_message}")
                else:
                    self.error_mode = "device_busy"
                    self.error_message = "Camera opened but read() returned no frame. Another application (Zoom/Teams/Discord) may be using the camera."
                    logger.warning(f"[CAMERA WARNING] {self.error_message}")

        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _capture_loop(self):
        while not self.stopped:
            if not self.cap or not self.cap.isOpened():
                time.sleep(0.1)
                continue
            success, frame = self.cap.read()
            if success and frame is not None:
                if self.frame_queue.full():
                    try:
                        self.frame_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.frame_queue.put(frame)
            else:
                time.sleep(0.03)

    def read_frame(self):
        try:
            return self.frame_queue.get(timeout=0.05)
        except queue.Empty:
            return None

    def is_opened(self):
        return self.cap is not None and self.cap.isOpened()

    def release(self):
        self.stopped = True
        if self.cap:
            self.cap.release()


class VisionEngine:
    def __init__(self, debug: bool = False):
        """Initializes MediaPipe tasks with non-blocking threaded hardware layers."""
        self.debug = debug
        self.stream = None
        self.face_detector = None
        self.pose_detector = None

        # State Tracking Matrix
        self.last_seen_timestamp = time.time()
        self.last_compliant_timestamp = time.time()  # NEW: separate tracker for compliant state
        self.last_mp_timestamp_ms = 0  
        self.is_book_mode_active = False

        # Fix 1: Rolling window for yaw/pitch smoothing (maxlen=5 frames).
        self._yaw_window: deque = deque(maxlen=5)
        self._pitch_window: deque = deque(maxlen=5)

        # Fix: Rolling windows for phone detection to prevent single-frame false positives
        self._phone_near_face_window: deque = deque(maxlen=10)  # ~1 second at 10fps
        self._phone_in_hand_window: deque = deque(maxlen=10)

        # NEW: Rolling window for sustained smiling/giggling detection (~1.5s at 10fps).
        # Longer than phone window on purpose — brief smiles/reactions are normal and
        # shouldn't trip distraction; only sustained laughing should.
        self._giggle_window: deque = deque(maxlen=15)

        # Fix 3: Book Mode no-landmark grace tracking
        self._book_mode_no_landmark_start: float | None = None
        self.BOOK_MODE_NO_LANDMARK_GRACE = 45.0

        # NEW: Distraction state tracking to prevent timer reset on brief glitches
        self._distraction_start_time: float | None = None
        self._last_distraction_type: str | None = None
        self._gaze_window: deque = deque(maxlen=10)
        self._face_occluded_start_time: float | None = None
        # Cached is_far_user — persists across frames so absent/abandoned branches can read it
        self._last_is_far_user: bool = False

        try:
            if getattr(sys, 'frozen', False):
                base_path = sys._MEIPASS
            else:
                base_path = os.path.dirname(os.path.abspath(__file__))

            face_model_path = os.path.join(base_path, 'assets', 'face_landmarker.task')
            pose_model_path = os.path.join(base_path, 'assets', 'pose_landmarker.task')

            if not os.path.exists(face_model_path) or not os.path.exists(pose_model_path):
                raise FileNotFoundError("Required MediaPipe configuration assets are missing.")

            # Spin up threaded stream worker
            self.stream = BackgroundCameraStream(src=0)
            if not self.stream.is_opened():
                err_msg = getattr(self.stream, 'error_message', 'OS failed to open a valid stream on VideoCapture(0).')
                raise RuntimeError(err_msg)

            # CRITICAL REGRESSION NOTICE: Both FaceLandmarkerOptions and PoseLandmarkerOptions MUST use
            # vision.RunningMode.VIDEO (NOT python.RunningMode.VIDEO — python module has no RunningMode attribute).
            face_options = vision.FaceLandmarkerOptions(
                base_options=python.BaseOptions(model_asset_path=face_model_path),
                running_mode=vision.RunningMode.VIDEO,
                output_facial_transformation_matrixes=True,
                output_face_blendshapes=True  # needed for smile/jaw/cheek expression scores
            )
            self.face_detector = vision.FaceLandmarker.create_from_options(face_options)

            pose_options = vision.PoseLandmarkerOptions(
                base_options=python.BaseOptions(model_asset_path=pose_model_path),
                running_mode=vision.RunningMode.VIDEO,
                output_segmentation_masks=False
            )
            self.pose_detector = vision.PoseLandmarker.create_from_options(pose_options)
            logger.info("[VISION ENGINE] MediaPipe Face & Pose Landmarker pipelines initialized successfully.")

        except Exception as e:
            err_details = f"[VISION CRITICAL] Failed initializing pipeline: {e}"
            logger.error(err_details)
            write_crash_fallback(err_details)
            self.release()
            raise e

    @staticmethod
    def _calc_dist_w(p1, p2, w: int, h: int) -> float:
        """Aspect-ratio corrected Euclidean distance between two landmarks, normalised to frame width."""
        return np.sqrt(((p1.x - p2.x) * w) ** 2 + ((p1.y - p2.y) * h) ** 2) / w

    @staticmethod
    def _is_arm_extended(wrist, elbow, shoulder, w: int, h: int) -> bool:
        """Check if arm is extended forward (phone-holding posture)."""
        d_sw = VisionEngine._calc_dist_w(wrist, shoulder, w, h)
        d_se = VisionEngine._calc_dist_w(elbow, shoulder, w, h)
        return d_sw > d_se * 1.3

    def analyze_frame(self) -> Dict[str, Any]:
        """Processes telemetry metrics and returns definitive user status payloads."""
        if not self.stream:
            return {"status": "processing", "message": "Camera hardware uninitialized or warming up."}

        frame = self.stream.read_frame()
        if frame is None:
            if not self.stream.is_opened():
                err_mode = getattr(self.stream, 'error_mode', 'uninitialized')
                err_msg = getattr(self.stream, 'error_message', 'Camera hardware uninitialized or camera access blocked.')
                return {
                    "status": "error",
                    "error_mode": err_mode,
                    "message": err_msg
                }
            return {"status": "processing", "message": "Awaiting fresh buffer payload..."}

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w, _ = frame.shape
        average_brightness = np.mean(gray)

        if average_brightness < 8.0:
            res = {
                "status": "dark_room", 
                "message": "Workspace visibility critically low. Turn on your lights.",
                "ambient_light": float(average_brightness)
            }
            if self.debug:
                logger.debug(f"[VISION DEBUG] face_present=False, pose_present=False, status={res['status']}, message={res['message']}")
            return res

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        current_ms = int(time.time() * 1000)
        if current_ms <= self.last_mp_timestamp_ms:
            current_ms = self.last_mp_timestamp_ms + 1
        self.last_mp_timestamp_ms = current_ms

        face_results = self.face_detector.detect_for_video(mp_image, current_ms)
        pose_results = self.pose_detector.detect_for_video(mp_image, current_ms)

        face_present = face_results is not None and face_results.face_landmarks is not None and len(face_results.face_landmarks) > 0
        pose_present = pose_results is not None and pose_results.pose_landmarks is not None and len(pose_results.pose_landmarks) > 0
        current_time = time.time()
        # Use the last known far-user value as the default; overwrite if pose is available this frame
        is_far_user = self._last_is_far_user

        # ── PHONE DETECTION WITH TEMPORAL SMOOTHING ──
        is_phone_near_face = False
        is_phone_in_hand = False

        if pose_present and pose_results and pose_results.pose_landmarks:
            try:
                landmarks = pose_results.pose_landmarks[0]
                if len(landmarks) > 24:
                    nose        = landmarks[0]
                    left_wrist  = landmarks[15]
                    right_wrist = landmarks[16]
                    left_hip    = landmarks[23]
                    right_hip   = landmarks[24]
                    left_elbow  = landmarks[13]
                    right_elbow = landmarks[14]
                    left_shoulder = landmarks[11]
                    right_shoulder = landmarks[12]

                    # Aspect-ratio corrected Euclidean distance helper (relative to frame width w)
                    calc_dist = VisionEngine._calc_dist_w

                    # Near-face check – wrist must be close to nose
                    dist_left  = calc_dist(left_wrist, nose, w, h)
                    dist_right = calc_dist(right_wrist, nose, w, h)

                    # 0.20 normalized frame-width distance
                    near_face_raw = dist_left < 0.20 or dist_right < 0.20

                    # Nose & Mouth Occlusion check using face landmarks
                    is_face_partially_occluded = False
                    if face_present and face_results and face_results.face_landmarks and len(face_results.face_landmarks) > 0:
                        try:
                            fl = face_results.face_landmarks[0]
                            if len(fl) > 14:
                                nose_tip = fl[1]
                                upper_lip = fl[13]
                                dist_nose_l = calc_dist(left_wrist, nose_tip, w, h)
                                dist_nose_r = calc_dist(right_wrist, nose_tip, w, h)
                                dist_mouth_l = calc_dist(left_wrist, upper_lip, w, h)
                                dist_mouth_r = calc_dist(right_wrist, upper_lip, w, h)
                                if min(dist_nose_l, dist_nose_r) < 0.18 or min(dist_mouth_l, dist_mouth_r) < 0.18:
                                    is_face_partially_occluded = True
                        except Exception:
                            pass

                    # Distance & camera angle estimation (shoulder width in aspect-corrected space)
                    shoulder_dist = calc_dist(right_shoulder, left_shoulder, w, h)
                    is_far_user = shoulder_dist < 0.18
                    self._last_is_far_user = is_far_user  # persist across frames

                    left_extended = VisionEngine._is_arm_extended(left_wrist, left_elbow, left_shoulder, w, h)
                    right_extended = VisionEngine._is_arm_extended(right_wrist, right_elbow, right_shoulder, w, h)

                    # Phone near face if arm is extended OR if nose/mouth are occluded by hand
                    is_phone_near_face = (near_face_raw and (left_extended or right_extended)) or (near_face_raw and is_face_partially_occluded)

                    # At-distance check — wrist raised above hip
                    avg_hip_y = (left_hip.y + right_hip.y) / 2
                    wrist_above_hip = (left_wrist.y < avg_hip_y - 0.20) or (right_wrist.y < avg_hip_y - 0.20)

                    # Must also be extended AND wrist must be above elbow (holding up, not resting)
                    wrist_above_elbow = (left_wrist.y < left_elbow.y - 0.05) or (right_wrist.y < right_elbow.y - 0.05)

                    # All three conditions must be true for "phone in hand at distance"
                    is_phone_in_hand = wrist_above_hip and (left_extended or right_extended) and wrist_above_elbow

            except Exception as e:
                logger.warning(f"[VISION WARNING] Pose landmark distance calc failed: {e}")

        # Temporal smoothing: append current frame result, then check majority
        self._phone_near_face_window.append(is_phone_near_face)
        self._phone_in_hand_window.append(is_phone_in_hand)

        # Require 60% of recent frames to agree — prevents single-frame glitches.
        # Threshold scales with current fill level so it's always reachable right after a deque reset.
        _pnf_len = len(self._phone_near_face_window)
        _pih_len = len(self._phone_in_hand_window)
        _pnf_thresh = min(max(1, math.ceil(0.6 * _pnf_len)), self._phone_near_face_window.maxlen)
        _pih_thresh = min(max(1, math.ceil(0.6 * _pih_len)), self._phone_in_hand_window.maxlen)
        near_face_smoothed = sum(self._phone_near_face_window) >= _pnf_thresh if _pnf_len >= 5 else is_phone_near_face
        in_hand_smoothed   = sum(self._phone_in_hand_window)   >= _pih_thresh if _pih_len >= 5 else is_phone_in_hand

        is_phone_detected = near_face_smoothed or in_hand_smoothed

        # ── IRIS / GAZE TRACKING ──
        is_gaze_away_raw = False
        if face_present and face_results and face_results.face_landmarks and len(face_results.face_landmarks) > 0:
            try:
                fl = face_results.face_landmarks[0]
                if len(fl) > 473:
                    # Left eye corners: fl[33] (lateral) and fl[133] (medial)
                    l_eye_x = (fl[33].x + fl[133].x) / 2
                    l_eye_y = (fl[33].y + fl[133].y) / 2
                    l_iris_dx = (fl[468].x - l_eye_x) * w
                    l_iris_dy = (fl[468].y - l_eye_y) * h

                    # Right eye corners: fl[362] (lateral) and fl[263] (medial)
                    r_eye_x = (fl[362].x + fl[263].x) / 2
                    r_eye_y = (fl[362].y + fl[263].y) / 2
                    r_iris_dx = (fl[473].x - r_eye_x) * w
                    r_iris_dy = (fl[473].y - r_eye_y) * h

                    avg_iris_dx = (l_iris_dx + r_iris_dx) / 2
                    avg_iris_dy = (l_iris_dy + r_iris_dy) / 2

                    # Compute actual eye width in pixels from corner-to-corner distance.
                    # The iris can realistically shift ~15-25% of eye width, so use 20% as threshold.
                    # This is ~3-8 px for a typical webcam frame — physiologically accurate.
                    l_eye_width_px = abs(fl[33].x - fl[133].x) * w
                    r_eye_width_px = abs(fl[362].x - fl[263].x) * w
                    avg_eye_width_px = max(1.0, (l_eye_width_px + r_eye_width_px) / 2)
                    gaze_threshold = 0.20 * avg_eye_width_px

                    if abs(avg_iris_dx) > gaze_threshold or abs(avg_iris_dy) > gaze_threshold:
                        is_gaze_away_raw = True
            except Exception:
                pass

        self._gaze_window.append(is_gaze_away_raw)
        _gaze_len = len(self._gaze_window)
        _gaze_thresh = min(max(1, math.ceil(0.6 * _gaze_len)), self._gaze_window.maxlen)
        is_gaze_away_smoothed = (
            sum(self._gaze_window) >= _gaze_thresh if _gaze_len >= 5 else is_gaze_away_raw
        )

        # ── NOSE / MOUTH PRESENCE & OCCLUSION CHECK ──
        # is_face_partially_occluded is computed inside the pose block above;
        # default to False when pose was not detected so the logic is always defined.
        if not pose_present:
            is_face_partially_occluded = False
        is_key_landmarks_missing = False
        if face_present and face_results and face_results.face_landmarks and len(face_results.face_landmarks) > 0:
            fl = face_results.face_landmarks[0]
            if len(fl) <= 14:
                is_key_landmarks_missing = True
            else:
                nose_pt = fl[1]
                lip_pt = fl[13]
                if (nose_pt.x <= 0 or nose_pt.x >= 1 or nose_pt.y <= 0 or nose_pt.y >= 1 or
                    lip_pt.x <= 0 or lip_pt.x >= 1 or lip_pt.y <= 0 or lip_pt.y >= 1):
                    is_key_landmarks_missing = True
        # Also treat wrist-over-face occlusion as missing landmarks so it generates
        # its own looking_away/warning result independently of the phone-detection path.
        if is_face_partially_occluded:
            is_key_landmarks_missing = True

        if is_key_landmarks_missing:
            if self._face_occluded_start_time is None:
                self._face_occluded_start_time = current_time
            time_occluded = current_time - self._face_occluded_start_time
            if time_occluded > 2.0:
                res = {
                    "status": "looking_away",
                    "message": f"Key facial features (nose/mouth) missing or occluded for {int(time_occluded)}s.",
                    "duration": time_occluded
                }
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res
        else:
            self._face_occluded_start_time = None

        # ── SMILE / GIGGLE DETECTION (blendshape-based) ──
        is_giggling_raw = False
        if face_present and face_results and face_results.face_blendshapes and len(face_results.face_blendshapes) > 0:
            try:
                scores = {c.category_name: c.score for c in face_results.face_blendshapes[0]}
                smile_score = max(scores.get('mouthSmileLeft', 0.0), scores.get('mouthSmileRight', 0.0))
                jaw_open_score = scores.get('jawOpen', 0.0)
                cheek_squint = (scores.get('cheekSquintLeft', 0.0) + scores.get('cheekSquintRight', 0.0)) / 2

                is_giggling_raw = smile_score > 0.65 and (jaw_open_score > 0.20 or cheek_squint > 0.40)
            except Exception as e:
                logger.warning(f"[VISION WARNING] Blendshape smile/giggle extraction failed: {e}")

        self._giggle_window.append(is_giggling_raw)
        _giggle_len = len(self._giggle_window)
        _giggle_thresh = min(max(1, math.ceil(0.6 * _giggle_len)), self._giggle_window.maxlen)
        is_giggling_smoothed = (
            sum(self._giggle_window) >= _giggle_thresh if _giggle_len >= 10 else False
        )

        # ── BOOK MODE ──
        if self.is_book_mode_active:
            if is_phone_detected:
                # Use persistent distraction timer instead of resetting
                if self._distraction_start_time is None or self._last_distraction_type != "phone_book":
                    self._distraction_start_time = current_time
                    self._last_distraction_type = "phone_book"
                time_distracted = current_time - self._distraction_start_time
                proximity_note = "near face" if near_face_smoothed else "raised above hip (held at distance)"
                res = {
                    "status": "distracted",
                    "message": f"Book Mode: phone detected ({proximity_note}) for {int(time_distracted)}s.",
                    "duration": time_distracted
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res
            if is_giggling_smoothed:
                if self._distraction_start_time is None or self._last_distraction_type != "giggling":
                    self._distraction_start_time = current_time
                    self._last_distraction_type = "giggling"
                time_distracted = current_time - self._distraction_start_time
                res = {
                    "status": "distracted",
                    "message": f"Book Mode: sustained smiling/laughing detected for {int(time_distracted)}s.",
                    "duration": time_distracted
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res
            if pose_present or face_present:
                # User is present — reset distraction state
                self.last_seen_timestamp = current_time
                self.last_compliant_timestamp = current_time
                self._distraction_start_time = None
                self._last_distraction_type = None
                self._book_mode_no_landmark_start = None
                res = {"status": "compliant", "message": "Book Mode active. Posture verified."}
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res
            # Neither pose nor face detected in Book Mode
            if self._book_mode_no_landmark_start is None:
                self._book_mode_no_landmark_start = current_time
            elapsed_no_landmark = current_time - self._book_mode_no_landmark_start
            if elapsed_no_landmark < self.BOOK_MODE_NO_LANDMARK_GRACE:
                res = {
                    "status": "reading_paused",
                    "message": f"Book Mode: no landmark detected for {int(elapsed_no_landmark)}s (grace {int(self.BOOK_MODE_NO_LANDMARK_GRACE)}s).",
                    "duration": elapsed_no_landmark
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res

        # ── STANDARD MODE ──
        if face_present:
            if is_phone_detected:
                # Use persistent distraction timer
                if self._distraction_start_time is None or self._last_distraction_type != "phone":
                    self._distraction_start_time = current_time
                    self._last_distraction_type = "phone"
                time_distracted = current_time - self._distraction_start_time
                proximity_note = "near face" if near_face_smoothed else "raised (held at distance)"
                res = {
                    "status": "distracted",
                    "message": f"User holding phone {proximity_note} for {int(time_distracted)} seconds.",
                    "duration": time_distracted
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res

            if is_giggling_smoothed:
                if self._distraction_start_time is None or self._last_distraction_type != "giggling":
                    self._distraction_start_time = current_time
                    self._last_distraction_type = "giggling"
                time_distracted = current_time - self._distraction_start_time
                res = {
                    "status": "distracted",
                    "message": f"User appears to be laughing/giggling for {int(time_distracted)}s (possibly distracted by content).",
                    "duration": time_distracted
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res

            if is_gaze_away_smoothed:
                if self._distraction_start_time is None or self._last_distraction_type != "gaze_away":
                    self._distraction_start_time = current_time
                    self._last_distraction_type = "gaze_away"
                time_distracted = current_time - self._distraction_start_time
                res = {
                    "status": "distracted",
                    "message": f"Gaze directed away from screen for {int(time_distracted)}s.",
                    "duration": time_distracted
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res

            # Head pose analysis
            pitch = 0.0
            yaw = 0.0
            if face_results and face_results.facial_transformation_matrixes and len(face_results.facial_transformation_matrixes) > 0:
                try:
                    M = face_results.facial_transformation_matrixes[0]
                    R = M[:3, :3]
                    pitch = np.arcsin(-R[1, 2]) * 180 / np.pi
                    yaw   = np.arctan2(R[0, 2], R[2, 2]) * 180 / np.pi
                except Exception as e:
                    logger.warning(f"[VISION WARNING] Head pose extraction failed: {e}")

            self._yaw_window.append(yaw)
            self._pitch_window.append(pitch)

            avg_yaw   = sum(self._yaw_window) / len(self._yaw_window)
            avg_pitch = sum(self._pitch_window) / len(self._pitch_window)

            # Yaw check with temporal persistence
            if avg_yaw < -45.0 or avg_yaw > 45.0:
                if self._distraction_start_time is None or self._last_distraction_type != "yaw":
                    self._distraction_start_time = current_time
                    self._last_distraction_type = "yaw"
                time_distracted = current_time - self._distraction_start_time
                res = {
                    "status": "distracted",
                    "message": f"User looking away (avg yaw: {int(avg_yaw)}°) for {int(time_distracted)}s.",
                    "duration": time_distracted
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res

            # Pitch threshold calibration
            if avg_pitch < -25.0:
                if self._distraction_start_time is None or self._last_distraction_type != "steep_pitch":
                    self._distraction_start_time = current_time
                    self._last_distraction_type = "steep_pitch"
                time_distracted = current_time - self._distraction_start_time
                res = {
                    "status": "distracted",
                    "message": f"Steep downward head angle ({int(avg_pitch)}°) — looking down at phone/lap.",
                    "duration": time_distracted
                }
                res["is_far_user"] = is_far_user
                if self.debug:
                    logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
                return res

            # COMPLIANT: Reset all distraction tracking
            self.last_seen_timestamp = current_time
            self.last_compliant_timestamp = current_time
            self._distraction_start_time = None
            self._last_distraction_type = None

            if avg_pitch < -15.0:
                res = {"status": "compliant", "message": "Downward workspace/lap focus verified."}
            elif -15.0 <= avg_pitch <= 10.0:
                res = {"status": "compliant", "message": "Screen focus verified."}
            else:
                res = {"status": "compliant", "message": "Upward screen focus verified."}
            res["is_far_user"] = is_far_user
            if self.debug:
                logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
            return res

        # Face not present but pose present — looking away
        if pose_present and not face_present:
            if self._distraction_start_time is None or self._last_distraction_type != "no_face":
                self._distraction_start_time = current_time
                self._last_distraction_type = "no_face"
            # Still update last_seen since user is physically present
            self.last_seen_timestamp = current_time
            time_distracted = current_time - self._distraction_start_time
            res = {
                "status": "looking_away",
                "message": "Face not visible (looking away or down).",
                "duration": time_distracted
            }
            res["is_far_user"] = is_far_user
            if self.debug:
                logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
            return res

        # Neither face nor pose — truly absent
        self._distraction_start_time = None
        self._last_distraction_type = None
        time_away = current_time - self.last_seen_timestamp
        if time_away > 300.0:
            res = {"status": "abandoned", "message": "Workplace abandoned for >5 minutes. Safe Pause active."}
        else:
            res = {
                "status": "absent", 
                "message": f"Desk empty. User absent for {int(time_away)} seconds.",
                "duration": time_away
            }
        res["is_far_user"] = is_far_user  # uses self._last_is_far_user (cached from last pose frame)
        if self.debug:
            logger.debug(f"[VISION DEBUG] face_present={face_present}, pose_present={pose_present}, status={res['status']}, message={res['message']}")
        return res

    def set_book_mode(self, active: bool):
        self.is_book_mode_active = bool(active)
        # Reset all temporal windows when switching modes to prevent stale-sample false positives
        self._phone_near_face_window.clear()
        self._phone_in_hand_window.clear()
        self._giggle_window.clear()
        self._gaze_window.clear()
        self._yaw_window.clear()
        self._pitch_window.clear()
        self._distraction_start_time = None
        self._last_distraction_type = None
        logger.info(f"[VISION] Book Mode active state set to: {self.is_book_mode_active}")

    def release(self):
        logger.info("[SYSTEM] Releasing camera hardware layers...")
        if self.stream:
            self.stream.release()
            self.stream = None
        if self.face_detector:
            try:
                self.face_detector.close()
            except RuntimeError as e:
                logger.warning(f"[SYSTEM] Face detector already shut down: {e}")
            self.face_detector = None
        if self.pose_detector:
            try:
                self.pose_detector.close()
            except RuntimeError as e:
                logger.warning(f"[SYSTEM] Pose detector already shut down: {e}")
            self.pose_detector = None


class HardwareObjectError(Exception):
    pass


if __name__ == "__main__":
    logger.info("Initializing Shackle AI Threaded Vision Engine...")
    try:
        tracker = VisionEngine()
        while True:
            state = tracker.analyze_frame()
            if state['status'] != "processing":
                logger.info(f"Current State: {state['status'].upper()} | {state.get('message', '')}")
            time.sleep(0.1)
    except KeyboardInterrupt:
        if 'tracker' in locals():
            tracker.release()
        logger.info("Vision Engine safe exit executed.")
    except Exception as e:
        logger.error(f"Engine failure execution abort: {e}")
