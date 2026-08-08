import sys
import time
import re
import threading
import requests
import logging
import pygetwindow as gw
from typing import List, Dict, Any

try:
    import winsound as _winsound
except ImportError:
    _winsound = None

try:
    from logger_config import get_logger
    logger = get_logger("ShackleDaemon")
except ImportError:
    logger = logging.getLogger("ShackleDaemon")

from vision import VisionEngine
from telemetry import TelemetryEngine
from utils.os_locker import OSLocker
from utils.break_manager import BreakManager

# Injected by app.py after webview.create_window() so stream_audio_discipline
# can forward the audio URL to the React frontend instead of spawning PowerShell.
_webview_window = None


class ShackleDaemon:
    def __init__(self, session_id: str = "", user_id: str = "", api_url: str = "http://127.0.0.1:8080", stop_event: threading.Event = None,
                 productive_app_distraction_threshold: float = 30.0):
        """Initializes the background orchestrator with thread-safe cached states."""
        self.session_id = session_id
        self.user_id = user_id
        self.api_url = api_url
        self.stop_event = stop_event
        self.strike_count = 0
        self.session_active = False  
        self.last_vision_status = "error"

        # Thread-safe data cache to prevent heartbeat thread collisions
        self._cached_telemetry_snapshot = {"apm": 0, "kpm": 0, "status": "idle"}
        self._audio_playback_lock = threading.Lock()
        self._strike_lock = threading.Lock()
        self._shutdown_lock = threading.Lock()
        self._shutdown_called = False

        # NEW: Track last violation context to prevent duplicate strikes for same offense
        self._last_violation_context: str | None = None
        self._last_violation_time: float = 0.0
        self._violation_cooldown_seconds = 5.0  # Don't re-strike for same issue within 5s
        self._last_beep_time: float = 0.0
        # Distraction duration threshold (seconds) before a strike is issued.
        # Extended when the active window belongs to a productive app.
        self._base_distraction_threshold: float = 15.0
        self._productive_app_distraction_threshold: float = productive_app_distraction_threshold

        # Initialize Vision Engine
        logger.info("[SYSTEM] Booting Threaded Vision Engine...")
        try:
            self.vision_engine = VisionEngine()
            self.vision_initialized = True
            logger.info("[SYSTEM] Vision Engine initialized successfully.")
        except Exception as e:
            logger.warning(f"[WARNING] Vision Engine initialization failed: {e}. Continuing without vision monitoring.")
            self.vision_engine = None
            self.vision_initialized = False

        # Initialize Telemetry Engine
        logger.info("[SYSTEM] Booting Lock-Free Telemetry Engine...")
        try:
            self.telemetry_engine = TelemetryEngine()
            self.telemetry_initialized = True
            logger.info("[SYSTEM] Telemetry Engine initialized successfully.")
        except Exception as e:
            logger.warning(f"[WARNING] Telemetry Engine initialization failed: {e}. Continuing without telemetry monitoring.")
            self.telemetry_engine = None
            self.telemetry_initialized = False

        logger.info("[SYSTEM] Initializing Local OS Enforcement Modules...")
        self.os_locker = OSLocker()
        self.break_manager = BreakManager(grace_seconds={
            "absent": 450,          # 7.5 minutes
            "abandoned": 450,       # 7.5 minutes
            "distracted": 90,       # 1.5 minutes
            "dark_room": 30,
            "reading_paused": 180,
            "looking_away": 60      # 1 minute
        })

        self.productive_apps = ["Code", "Terminal", "Command Prompt", "bash", "nvim", "PyCharm", "Idea", "Sublime"]
        self.distracting_apps = ["Netflix", "Twitter", "x.com", " / X", "YouTube", "TikTok", "Discord", "Steam", "Riot"]
        self.light_bomb_executed = False

        self.is_running = False

    def _run_startup_self_test(self):
        """Runs a single consolidated diagnostic self-test at daemon startup and logs results."""
        is_admin = False
        if sys.platform == "win32":
            try:
                import ctypes
                is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
            except Exception:
                pass

        # Vision status check
        vision_status = "FAIL (Engine Uninitialized)"
        if self.vision_initialized and self.vision_engine:
            if getattr(self.vision_engine, 'stream', None) and self.vision_engine.stream.is_opened():
                vision_status = "PASS (MediaPipe Landmarker & Camera Stream Active)"
            else:
                err_msg = getattr(self.vision_engine.stream, 'error_message', 'Camera stream unopened') if getattr(self.vision_engine, 'stream', None) else 'No stream'
                vision_status = f"FAIL ({err_msg})"

        # Telemetry status check (allow listeners to initialize)
        time.sleep(1.5)
        kb_running = False
        mouse_running = False
        if self.telemetry_initialized and self.telemetry_engine:
            if hasattr(self.telemetry_engine, 'keyboard_listener'):
                kb_running = getattr(self.telemetry_engine.keyboard_listener, 'running', False)
            if hasattr(self.telemetry_engine, 'mouse_listener'):
                mouse_running = getattr(self.telemetry_engine.mouse_listener, 'running', False)

        telemetry_status = (
            f"PASS (Keyboard Hook: {'ACTIVE' if kb_running else 'INACTIVE'}, Mouse Hook: {'ACTIVE' if mouse_running else 'INACTIVE'})"
            if (kb_running or mouse_running) else "FAIL (Hooks Inactive)"
        )

        test_block = (
            "\n"
            "============================================================\n"
            "SHACKLE AI DAEMON SUBSYSTEM DIAGNOSTIC SELF-TEST\n"
            "------------------------------------------------------------\n"
            f"* Process Elevation (Admin): {'YES' if is_admin else 'NO'}\n"
            f"* Vision Engine:            {vision_status}\n"
            f"* Telemetry Engine:         {telemetry_status}\n"
            f"* OS Locker Module:         READY (Blacklist items: {len(self.os_locker.blacklist)})\n"
            "============================================================\n"
        )
        logger.info(test_block)

    def get_active_window_title(self) -> str:
        try:
            window = gw.getActiveWindow()
            if window and hasattr(window, "title") and window.title:
                return window.title.strip()
            return "Unknown Window"
        except Exception:
            return "OS Error"

    def evaluate_environment(self) -> Dict[str, Any]:
        """Core logic matrix. Updates central cache and validates metrics cleanly."""
        try:
            active_window = self.get_active_window_title()

            vision_state = {"status": "error", "message": "Vision engine not available"}

            if self.telemetry_initialized and self.telemetry_engine:
                try:
                    self._cached_telemetry_snapshot = self.telemetry_engine.get_telemetry_snapshot()
                except Exception as e:
                    self._cached_telemetry_snapshot = {"status": "error", "message": f"Telemetry error: {str(e)}", "apm": 0, "kpm": 0}

            if self.vision_initialized and self.vision_engine:
                try:
                    vision_state = self.vision_engine.analyze_frame()
                    self.last_vision_status = vision_state.get("status", "error")
                except Exception as e:
                    vision_state = {"status": "error", "message": f"Vision error: {str(e)}"}
                    self.last_vision_status = "error"

            # 1. Active Window Trap
            active_window_lower = active_window.lower()
            for app in self.distracting_apps:
                is_match = False
                if app == " / X":
                    if " / x" in active_window_lower:
                        is_match = True
                elif app == "x.com":
                    if "x.com" in active_window_lower:
                        is_match = True
                else:
                    pattern = rf"\b{re.escape(app.lower())}\b"
                    if re.search(pattern, active_window_lower):
                        is_match = True

                if is_match:
                    return {
                        "is_violation": True,
                        "context": f"Browsing a blacklisted application: {app}",
                        "telemetry": {"window": active_window, "kpm": self._cached_telemetry_snapshot.get('kpm', 0)}
                    }

            # 2. OS Locker Active Process Background Scan
            running_violations = self.os_locker.scan_for_violations()
            if running_violations:
                return {
                    "is_violation": True,
                    "context": f"Blacklisted processes active in background: {', '.join(running_violations)}",
                    "telemetry": {"violations": running_violations, "window": active_window}
                }

            # 3. Handle Biological Presence and Grace Windows
            status = vision_state.get("status")

            if vision_state.get("is_far_user"):
                self.break_manager.set_grace("absent", 900)
                self.break_manager.set_grace("abandoned", 900)
                self.break_manager.set_grace("looking_away", 120)
            else:
                self.break_manager.set_grace("absent", 450)
                self.break_manager.set_grace("abandoned", 450)
                self.break_manager.set_grace("looking_away", 60)

            if status == "processing":
                pass
            elif status in ["absent", "abandoned", "dark_room"]:
                break_report = self.break_manager.register_absence(violation_type=status)
                if status in ["absent", "abandoned"]:
                    self.play_progressive_beep(break_report.get("elapsed_seconds", 0))
                if break_report.get("violation"):
                    return {
                        "is_violation": True,
                        "context": break_report["message"],
                        "telemetry": {
                            "window": active_window,
                            "elapsed_seconds": break_report["elapsed_seconds"],
                            "active_violation_type": status
                        },
                        "ambient_light": vision_state.get("ambient_light", 0)
                    }
            elif status == "looking_away":
                break_report = self.break_manager.register_absence(violation_type="looking_away")
                # Soft beeping warning every 5s while looking away
                now = time.time()
                if now - self._last_beep_time >= 5.0:
                    self._last_beep_time = now
                    threading.Thread(target=self.play_beep, args=(700, 180), daemon=True).start()

                if break_report.get("violation"):
                    return {
                        "is_violation": True,
                        "context": "Looking away for too long (exceeded grace period)",
                        "telemetry": {
                            "window": active_window,
                            "elapsed_seconds": break_report["elapsed_seconds"],
                            "active_violation_type": "looking_away"
                        }
                    }
            elif status == "distracted":
                duration = vision_state.get("duration", 0)
                active_window_lower = active_window.lower()
                is_productive_window = any(
                    app.lower() in active_window_lower for app in self.productive_apps
                )
                effective_threshold = (
                    self._productive_app_distraction_threshold
                    if is_productive_window
                    else self._base_distraction_threshold
                )

                if duration > effective_threshold:
                    return {
                        "is_violation": True,
                        "context": vision_state.get("message", "User distracted"),
                        "telemetry": {
                            "window": active_window,
                            "duration": duration,
                            "active_violation_type": "distracted",
                            "productive_window": is_productive_window,
                            "distraction_threshold_used": effective_threshold
                        }
                    }
            elif status in ["compliant", "reading_paused"]:
                self.break_manager.register_presence()

            # 4. Hardware / Privacy Shutter Bypass Trap
            if vision_state["status"] == "error":
                if self._cached_telemetry_snapshot["status"] == "idle":
                    return {
                        "is_violation": True,
                        "context": "Camera blocked and zero input telemetry. Workspace abandoned.",
                        "telemetry": {"window": active_window, "kpm": 0}
                    }
                elif self._cached_telemetry_snapshot["status"] == "spoofing_detected":
                    return {
                        "is_violation": True,
                        "context": "Camera blocked and unnatural input rhythm detected (Macro/Spoofing).",
                        "telemetry": {"window": active_window, "kpm": self._cached_telemetry_snapshot.get('kpm', 0)}
                    }
                return {"is_violation": False, "context": "Operating in Stealth Desktop Mode (Camera Offline)"}

            return {"is_violation": False, "context": "User is focused and compliant."}
        except Exception as e:
            logger.error(f"[DAEMON ERROR] Exception in evaluate_environment: {e}")
            return {"is_violation": False, "context": "Daemon internal error – check logs."}

    def play_beep(self, frequency: int = 800, duration_ms: int = 200):
        """Cross-platform audio beep helper."""
        try:
            if _winsound:
                _winsound.Beep(frequency, duration_ms)
            elif sys.stdout is not None:
                print("\a", end="", flush=True)
        except Exception:
            pass

    def play_progressive_beep(self, elapsed_seconds: int):
        """
        Progressive beeping on absence (0-30s grace, 30-60s soft/10s, 60-120s medium/5s, 120s+ loud/2s).
        """
        now = time.time()
        if elapsed_seconds < 30:
            return
        elif 30 <= elapsed_seconds < 60:
            interval, freq, dur = 10.0, 600, 150
        elif 60 <= elapsed_seconds < 120:
            interval, freq, dur = 5.0, 800, 250
        else:
            interval, freq, dur = 2.0, 1000, 400

        if now - self._last_beep_time >= interval:
            self._last_beep_time = now
            threading.Thread(target=self.play_beep, args=(freq, dur), daemon=True).start()

    def trigger_strike(self, violation_data: Dict[str, Any]):
        with self._strike_lock:
            current_time = time.time()
            context = violation_data.get("context", "")
            telemetry = violation_data.get("telemetry", {})
            dedup_key = telemetry.get("active_violation_type") or context

            if (self._last_violation_context == dedup_key and
                current_time - self._last_violation_time < self._violation_cooldown_seconds):
                logger.info(f"[DAEMON] Duplicate violation suppressed (key={dedup_key!r}): {context[:60]}")
                return

            self._last_violation_context = dedup_key
            self._last_violation_time = current_time

            if self.strike_count >= 3:
                return

            if not self.session_id:
                logger.info("[DAEMON] No session_id — cannot record strike. Skipping.")
                return

            self.strike_count += 1
            logger.warning(f"🚨 STRIKE {self.strike_count} RECORDED: {violation_data['context']}")

            global _webview_window
            if _webview_window is not None:
                safe_reason = violation_data["context"].replace("'", "\\'")
                _webview_window.evaluate_js(f"window.showStrikeToast({self.strike_count}, '{safe_reason}')")

            context_lower = violation_data.get("context", "").lower()
            is_process_violation = "blacklisted" in context_lower or "browsing" in context_lower

            if self.strike_count >= 2 and is_process_violation:
                logger.info("[OS_LOCKER] High infraction count. Initiating active process execution termination...")
                purge_metrics = self.os_locker.execute_purge()
                logger.info(f"[OS_LOCKER] Purge Complete: {purge_metrics}")

            if self.strike_count >= 3 and not self.light_bomb_executed:
                logger.warning("💀 CRITICAL: Three strike threshold reached. Moving environment into Phase 1 Lockdown!")
                self.execute_light_bomb()
                self.light_bomb_executed = True

            payload = {
                "session_id": self.session_id,
                "user_id": self.user_id if self.user_id else "unknown",
                "trigger_type": violation_data["context"],
                "strike_count": self.strike_count
            }
        network_thread = threading.Thread(target=self._dispatch_strike_network_call, args=(payload,), daemon=True)
        network_thread.start()

    def _dispatch_strike_network_call(self, payload: Dict[str, Any]):
        try:
            response = requests.post(f"{self.api_url}/v1/session/infraction", json=payload, timeout=5)
            if response.status_code == 200:
                data = response.json()
                infraction_id = data.get("infraction_id")
                if not infraction_id:
                    logger.warning("[DAEMON] No infraction_id returned, skipping roast playback.")
                    return

                polling_thread = threading.Thread(
                    target=self._poll_infraction_result,
                    args=(infraction_id,),
                    daemon=True
                )
                polling_thread.start()
            else:
                logger.error(f"[API ERROR] Failed to log strike: {response.status_code}")
        except Exception as e:
            logger.error(f"[NETWORK ERROR] Backend infraction log failed or timed out: {e}")

    def _poll_infraction_result(self, infraction_id: str):
        """Polls the infraction result endpoint every 2 seconds up to 4 attempts."""
        attempts = 0
        max_attempts = 4
        roast_text = "Get back to work."
        audio_url = None
        success = False

        while attempts < max_attempts:
            time.sleep(2)
            attempts += 1
            try:
                url = f"{self.api_url}/v1/session/infraction/{infraction_id}/result"
                params = {}
                if self.user_id:
                    params["user_id"] = self.user_id
                response = requests.get(url, params=params, timeout=3)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("ready"):
                        roast_text = data.get("roast", "Get back to work.")
                        audio_url = data.get("audio_url")
                        success = True
                        break
            except Exception as e:
                logger.warning(f"[DAEMON WARNING] Poll attempt {attempts} failed: {e}")

        if not success:
            logger.warning("[DAEMON WARNING] Roast generation timed out or failed. Falling back to canned warning.")

        logger.info(f"[SHACKLE AI]: {roast_text}")
        if audio_url:
            self.stream_audio_discipline(audio_url, roast_text)
        else:
            self.show_roast_text_only(roast_text)

    def stream_audio_discipline(self, url: str, roast_text: str):
        """Forwards the roast audio URL and text to the React frontend via evaluate_js."""
        with self._audio_playback_lock:
            global _webview_window
            if _webview_window is not None:
                safe_url = url.replace("'", "\\'")
                safe_roast_text = roast_text.replace("'", "\\'")
                _webview_window.evaluate_js(f"window.playRoastAudio('{safe_url}', '{safe_roast_text}')")
                logger.info(f"[DAEMON] Roast audio forwarded to frontend: {url}")
            else:
                logger.warning(f"[DAEMON] No webview window available to play roast audio. URL was: {url}")

    def show_roast_text_only(self, roast_text: str):
        """Forwards text-only roast to the React frontend via evaluate_js when TTS/audio fails."""
        global _webview_window
        if _webview_window is not None:
            safe_roast_text = roast_text.replace("'", "\\'")
            _webview_window.evaluate_js(f"window.showRoastText('{safe_roast_text}')")
            logger.info(f"[DAEMON] Text-only roast forwarded to frontend: {roast_text}")
        else:
            logger.warning(f"[DAEMON] No webview window available for text-only roast: {roast_text}")

    def set_session_active(self, active: bool, duration_minutes: int = 45, user_id: str = None, xp_earned: int = None):
        if active and not self.session_active:
            self.strike_count = 0
            self.light_bomb_executed = False
            self.session_duration = duration_minutes
            self._last_violation_context = None
            self._last_violation_time = 0.0

            effective_user_id = user_id or self.user_id
            if not effective_user_id or effective_user_id == "local_developer":
                logger.warning("[DAEMON] set_session_active(True) blocked — no authenticated user_id set yet.")
                self.session_active = False
                self.session_id = ""
                return

            try:
                resp = requests.post(
                    f"{self.api_url}/v1/session/start",
                    json={
                        "user_id": effective_user_id,
                        "mode": "webcam",
                        "duration_minutes": duration_minutes
                    },
                    timeout=5
                )
                if resp.status_code == 200:
                    server_sid = resp.json().get("session_id")
                    if server_sid:
                        self.session_id = server_sid
                        self.session_active = True
                        self.user_id = effective_user_id
                        try:
                            from backend.firebase_config import ShackleDB
                            profile = ShackleDB.get_user(effective_user_id)
                            if profile and "blacklistedApps" in profile:
                                custom_blacklist = profile["blacklistedApps"]
                                if isinstance(custom_blacklist, list):
                                    self.os_locker.blacklist = list(custom_blacklist)
                                    logger.info(f"[DAEMON] Loaded blacklist for '{effective_user_id}': {self.os_locker.blacklist}")
                        except Exception as e:
                            logger.warning(f"[DAEMON] WARNING: Failed to load blacklist on session start: {e}")
                        return
                    else:
                        logger.warning("[DAEMON] /v1/session/start returned no session_id.")
                elif resp.status_code == 403:
                    logger.warning(f"[DAEMON] Backend rejected session start (penalty lockout): {resp.json().get('detail')}")
                else:
                    logger.warning(f"[DAEMON] /v1/session/start returned {resp.status_code}.")
            except Exception as e:
                logger.error(f"[DAEMON] /v1/session/start unreachable: {e}")

            self.session_active = False
            self.session_id = ""
            logger.warning("[DAEMON] Session start failed — no local fallback used.")
        elif not active and self.session_active:
            try:
                eff_duration = duration_minutes if duration_minutes != 45 else (getattr(self, 'session_duration', 45) or 45)
                eff_xp = xp_earned if xp_earned is not None else eff_duration

                requests.post(
                    f"{self.api_url}/v1/session/end",
                    params={
                        "session_id": self.session_id,
                        "user_id": self.user_id,
                        "xp_earned": eff_xp,
                        "duration_minutes": eff_duration
                    },
                    timeout=5
                )
                logger.info(f"[DAEMON] Session ended via backend for ID: {self.session_id} (xp_earned={eff_xp}, duration_minutes={eff_duration})")
            except Exception as e:
                logger.error(f"[DAEMON] /v1/session/end failed ({e}) — session closed locally only.")
            self.session_active = False
            self.session_id = ""
            logger.info("[DAEMON] Session deactivated.")

    def get_daemon_status(self) -> dict:
        try:
            status = self.break_manager.get_status()
            return {
                "session_active": self.session_active,
                "strike_count": self.strike_count,
                "last_vision_status": self.last_vision_status,
                "active_violation_type": status.get("active_violation_type"),
                "grace_seconds_left": status.get("remaining_seconds") if status.get("is_absent") else None
            }
        except Exception as e:
            logger.error(f"[DAEMON] get_daemon_status() error: {e}")
            return {
                "session_active": self.session_active,
                "strike_count": self.strike_count,
                "last_vision_status": self.last_vision_status,
                "active_violation_type": None,
                "grace_seconds_left": None
            }

    def lock_apps(self, duration_minutes: int = 45, user_id: str = None) -> str:
        try:
            effective_user_id = user_id or self.user_id
            self.set_session_active(True, duration_minutes=duration_minutes, user_id=effective_user_id)
            if self.session_active and self.session_id:
                logger.info(f"[DAEMON] lock_apps() — session enforcement active ({duration_minutes}m). ID: {self.session_id}")
                return self.session_id
            else:
                logger.warning("[DAEMON] lock_apps() — failed to start backend session. Returning empty.")
                return ""
        except Exception as e:
            logger.error(f"[DAEMON] lock_apps() error: {e}")
            return ""

    def get_active_session_id(self) -> str:
        return self.session_id if self.session_active else ""

    def unlock_apps(self) -> bool:
        try:
            self.set_session_active(False)
            logger.info("[DAEMON] unlock_apps() called — session enforcement deactivated.")
            return True
        except Exception as e:
            logger.error(f"[DAEMON] unlock_apps() error: {e}")
            return False

    def get_available_apps(self) -> list:
        try:
            import psutil
            category_map = {
                "discord": ("Social Media", "MessageSquare"),
                "slack": ("Social Media", "MessageSquare"),
                "telegram": ("Social Media", "Send"),
                "whatsapp": ("Social Media", "MessageCircle"),
                "twitter": ("Social Media", "Twitter"),
                "xbox": ("Gaming", "Gamepad2"),
                "battlenet": ("Gaming", "Gamepad2"),
                "steam": ("Gaming", "Gamepad2"),
                "riotclient": ("Gaming", "Swords"),
                "leagueclient": ("Gaming", "Swords"),
                "epicgames": ("Gaming", "Package"),
                "minecraft": ("Gaming", "Zap"),
                "spotify": ("Entertainment", "Music"),
                "netflix": ("Entertainment", "Play"),
                "vlc": ("Entertainment", "Play"),
                "chrome": ("Browser", "Chrome"),
                "firefox": ("Browser", "Globe"),
                "msedge": ("Browser", "Globe"),
                "tiktok": ("Entertainment", "Play"),
                "instagram": ("Social Media", "Instagram"),
                "snapchat": ("Social Media", "Snapchat"),
            }

            seen = set()
            result = []
            for proc in psutil.process_iter(["name"]):
                raw_name = proc.info.get("name") or ""
                if not raw_name or not raw_name.lower().endswith(".exe"):
                    continue
                if raw_name.lower() in seen:
                    continue
                seen.add(raw_name.lower())

                matched = False
                for key, (cat, ic) in category_map.items():
                    if key in raw_name.lower():
                        matched = True
                        display_name = raw_name.replace(".exe", "").replace(".", " ").replace("-", " ").title()
                        result.append({
                            "name": display_name,
                            "processName": raw_name,
                            "category": cat,
                            "icon": ic,
                        })
                        break
            result.sort(key=lambda a: a["name"])
            return result
        except Exception as e:
            logger.error(f"[DAEMON] get_available_apps() error: {e}")
            return []

    def add_to_blacklist(self, process_name: str) -> bool:
        try:
            self.os_locker.add_to_blacklist(process_name)
            logger.info(f"[DAEMON] add_to_blacklist() — added '{process_name}'")
            return True
        except Exception as e:
            logger.error(f"[DAEMON] add_to_blacklist() error: {e}")
            return False

    def remove_from_blacklist(self, process_name: str) -> bool:
        try:
            self.os_locker.remove_from_blacklist(process_name)
            logger.info(f"[DAEMON] remove_from_blacklist() — removed '{process_name}'")
            return True
        except Exception as e:
            logger.error(f"[DAEMON] remove_from_blacklist() error: {e}")
            return False

    def set_book_mode(self, active: bool) -> bool:
        try:
            if self.vision_initialized and self.vision_engine:
                self.vision_engine.set_book_mode(active)
            if active:
                self.break_manager.set_grace("distracted", 180)
                self.break_manager.set_grace("reading_paused", 180)
            else:
                self.break_manager.set_grace("distracted", 120)
                self.break_manager.set_grace("reading_paused", 180)
            logger.info(f"[DAEMON] set_book_mode({active}) executed successfully.")
            return True
        except Exception as e:
            logger.warning(f"[DAEMON WARNING] Failed setting Book Mode: {e}")
            return False

    def send_heartbeat(self):
        heartbeat_thread = threading.Thread(target=self._execute_heartbeat_network_call, daemon=True)
        heartbeat_thread.start()

    def _execute_heartbeat_network_call(self):
        try:
            try:
                window_title = self.get_active_window_title()
            except Exception:
                window_title = "Unknown Operating System Context"

            if not self.session_id:
                return

            face_detected = self.last_vision_status not in ["absent", "abandoned", "error"]

            heartbeat_payload = {
                "session_id": self.session_id,
                "user_id": self.user_id,
                "apm": int(self._cached_telemetry_snapshot.get("apm", 0)),
                "current_process": window_title,
                "face_detected": bool(face_detected)
            }
            requests.post(f"{self.api_url}/v1/session/heartbeat", json=heartbeat_payload, timeout=3)
        except Exception:
            pass  

    def execute_light_bomb(self):
        logger.warning("\n⚡ EXECUTE LIGHT BOMB PROTOCOL ⚡")
        try:
            import tkinter as tk
            def launch():
                root = tk.Tk()
                root.configure(bg='white')
                root.attributes("-fullscreen", True)
                root.attributes("-topmost", True)
                root.overrideredirect(True)
                root.bind("<Escape>", lambda e: root.destroy())
                root.after(2500, root.destroy)
                root.mainloop()

            t = threading.Thread(target=launch, daemon=True)
            t.start()
        except Exception as e:
            logger.error(f"[LIGHT BOMB ERROR] Failed to instantiate fullscreen window: {e}")

    def run(self):
        self.is_running = True
        logger.info(f"🛡️ Shackle AI Daemon Active for Session: {self.session_id}")

        # Run startup diagnostic self-test once at daemon boot
        try:
            self._run_startup_self_test()
        except Exception as e:
            logger.error(f"[DAEMON SELF-TEST ERROR] Failed executing startup self-test: {e}")

        try:
            while self.is_running and (self.stop_event is None or not self.stop_event.is_set()):
                time.sleep(3)
                if self.stop_event and self.stop_event.is_set():
                    break

                if self.session_active:
                    try:
                        evaluation = self.evaluate_environment()
                        if evaluation.get("is_violation"):
                            self.trigger_strike(evaluation)

                            backoff_duration = 15
                            for _ in range(backoff_duration):
                                if self.stop_event and self.stop_event.is_set():
                                    return
                                time.sleep(1)

                        self.send_heartbeat()
                    except Exception as e:
                        logger.error(f"[DAEMON LOOP ERROR] Error during tick execution: {e}")
                        continue

        except Exception as e:
            logger.error(f"[DAEMON THREAD CRASH] Error: {e}")
        finally:
            self.shutdown()

    def shutdown(self):
        with self._shutdown_lock:
            if self._shutdown_called:
                return
            self._shutdown_called = True

        logger.info("[SYSTEM] Shutting down Daemon components...")
        self.is_running = False

        if self.vision_initialized and self.vision_engine:
            self.vision_engine.release()

        if self.telemetry_initialized and self.telemetry_engine:
            self.telemetry_engine.shutdown()

        logger.info("Shutdown complete. You are un-Shackled.")


if __name__ == "__main__":
    logger.info("Starting Shackle AI Non-Blocking Telemetry Tracker...")
    telemetry = TelemetryEngine()

    try:
        while True:
            time.sleep(5)
            snapshot = telemetry.get_telemetry_snapshot()
            logger.info(
                f"[{time.strftime('%H:%M:%S')}] State: {snapshot['status'].upper()} | "
                f"KPM: {snapshot.get('kpm', 0)} | APM: {snapshot.get('apm', 0)} | "
                f"Spoof Counter: {telemetry.rapid_fire_count:.1f} | "
                f"Msg: {snapshot['message']}"
            )

    except KeyboardInterrupt:
        telemetry.shutdown()
        logger.info("Telemetry engine safely shut down.")
