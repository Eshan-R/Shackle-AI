import sys
import time
import threading
import logging
from collections import deque
from pynput import keyboard, mouse
from typing import Dict, Any

try:
    from logger_config import get_logger
    logger = get_logger("TelemetryEngine")
except ImportError:
    logger = logging.getLogger("TelemetryEngine")


# ── Win32 Raw Input API Listener (Bypasses Windows UIPI restrictions under Elevation) ──
if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    HWND_MESSAGE = wintypes.HWND(-3)
    WM_INPUT = 0x00FF
    WM_DESTROY = 0x0002
    RIM_TYPEMOUSE = 0
    RIM_TYPEKEYBOARD = 1
    RIDEV_INPUTSINK = 0x00000100
    RID_INPUT = 0x10000003

    RI_KEY_MAKE = 0
    HCURSOR = wintypes.HANDLE
    HICON = wintypes.HANDLE
    HBRUSH = wintypes.HANDLE
    LRESULT = ctypes.c_ssize_t

    class RAWINPUTDEVICE(ctypes.Structure):
        _fields_ = [
            ("usUsagePage", wintypes.USHORT),
            ("usUsage", wintypes.USHORT),
            ("dwFlags", wintypes.DWORD),
            ("hwndTarget", wintypes.HWND),
        ]

    class RAWINPUTHEADER(ctypes.Structure):
        _fields_ = [
            ("dwType", wintypes.DWORD),
            ("dwSize", wintypes.DWORD),
            ("hDevice", wintypes.HANDLE),
            ("wParam", wintypes.WPARAM),
        ]

    class BUTTONS_STR(ctypes.Structure):
        _fields_ = [
            ("usButtonFlags", wintypes.USHORT),
            ("usButtonData", wintypes.USHORT),
        ]

    class BUTTONS_UNION(ctypes.Union):
        _fields_ = [
            ("ulButtons", wintypes.ULONG),
            ("buttons", BUTTONS_STR),
        ]

    class RAWMOUSE(ctypes.Structure):
        _fields_ = [
            ("usFlags", wintypes.USHORT),
            ("buttonsUnion", BUTTONS_UNION),
            ("ulRawButtons", wintypes.ULONG),
            ("lLastX", wintypes.LONG),
            ("lLastY", wintypes.LONG),
            ("ulExtraInformation", wintypes.ULONG),
        ]

    class RAWKEYBOARD(ctypes.Structure):
        _fields_ = [
            ("MakeCode", wintypes.USHORT),
            ("Flags", wintypes.USHORT),
            ("Reserved", wintypes.USHORT),
            ("VKey", wintypes.USHORT),
            ("Message", wintypes.UINT),
            ("ExtraInformation", wintypes.ULONG),
        ]

    class RAWHID(ctypes.Structure):
        _fields_ = [
            ("dwSizeHid", wintypes.DWORD),
            ("dwCount", wintypes.DWORD),
            ("bRawData", wintypes.BYTE * 1),
        ]

    class RAWINPUTDATA(ctypes.Union):
        _fields_ = [
            ("mouse", RAWMOUSE),
            ("keyboard", RAWKEYBOARD),
            ("hid", RAWHID),
        ]

    class RAWINPUT(ctypes.Structure):
        _fields_ = [
            ("header", RAWINPUTHEADER),
            ("data", RAWINPUTDATA),
        ]

    class WNDCLASSEXW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.UINT),
            ("style", wintypes.UINT),
            ("lpfnWndProc", ctypes.c_void_p),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE),
            ("hIcon", HICON),
            ("hCursor", HCURSOR),
            ("hbrBackground", HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR),
            ("hIconSm", HICON),
        ]

    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR,
        wintypes.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID
    ]
    user32.CreateWindowExW.restype = wintypes.HWND

    user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.DefWindowProcW.restype = LRESULT

    user32.GetRawInputData.argtypes = [ctypes.c_void_p, wintypes.UINT, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.UINT]
    user32.GetRawInputData.restype = wintypes.UINT

    user32.RegisterRawInputDevices.argtypes = [ctypes.c_void_p, wintypes.UINT, wintypes.UINT]
    user32.RegisterRawInputDevices.restype = wintypes.BOOL

    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL

    user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    user32.GetMessageW.restype = wintypes.BOOL


    class Win32RawInputListener:
        """
        Background Win32 Raw Input API listener (WM_INPUT + RIDEV_INPUTSINK).
        Receives input events directly from kernel HID layer without UIPI cross-integrity filtering.
        """
        def __init__(self, on_key_callback=None, on_mouse_callback=None):
            self.on_key_callback = on_key_callback
            self.on_mouse_callback = on_mouse_callback
            self.running = False
            self.hwnd = None
            self.thread = None
            self.wnd_proc_ref = None

        def start(self):
            if sys.platform != "win32":
                return
            self.thread = threading.Thread(target=self._run_loop, daemon=True)
            self.thread.start()
            start = time.time()
            while not self.running and time.time() - start < 2.0:
                time.sleep(0.05)

        def _wnd_proc(self, hwnd, msg, wparam, lparam):
            if msg == WM_INPUT:
                dw_size = wintypes.DWORD(0)
                user32.GetRawInputData(
                    ctypes.c_void_p(lparam),
                    RID_INPUT,
                    None,
                    ctypes.byref(dw_size),
                    ctypes.sizeof(RAWINPUTHEADER)
                )

                if dw_size.value > 0:
                    raw_buffer = ctypes.create_string_buffer(dw_size.value)
                    if user32.GetRawInputData(
                        ctypes.c_void_p(lparam),
                        RID_INPUT,
                        raw_buffer,
                        ctypes.byref(dw_size),
                        ctypes.sizeof(RAWINPUTHEADER)
                    ) == dw_size.value:
                        raw_input = RAWINPUT.from_buffer(raw_buffer)

                        if raw_input.header.dwType == RIM_TYPEKEYBOARD:
                            kb = raw_input.data.keyboard
                            if kb.Flags == RI_KEY_MAKE or (kb.Flags & 1) == 0:
                                if self.on_key_callback:
                                    self.on_key_callback()

                        elif raw_input.header.dwType == RIM_TYPEMOUSE:
                            m = raw_input.data.mouse
                            btn_flags = m.buttonsUnion.buttons.usButtonFlags
                            if btn_flags != 0:
                                if self.on_mouse_callback:
                                    self.on_mouse_callback()

                return 0

            elif msg == WM_DESTROY:
                user32.PostQuitMessage(0)
                return 0

            return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

        def _run_loop(self):
            try:
                hinstance = kernel32.GetModuleHandleW(None)
                class_name = f"ShackleRawInputClass_{id(self)}"

                self.wnd_proc_ref = WNDPROC(self._wnd_proc)

                wndclass = WNDCLASSEXW()
                wndclass.cbSize = ctypes.sizeof(WNDCLASSEXW)
                wndclass.style = 0
                wndclass.lpfnWndProc = ctypes.cast(self.wnd_proc_ref, ctypes.c_void_p)
                wndclass.cbClsExtra = 0
                wndclass.cbWndExtra = 0
                wndclass.hInstance = hinstance
                wndclass.hIcon = None
                wndclass.hCursor = None
                wndclass.hbrBackground = None
                wndclass.lpszMenuName = None
                wndclass.lpszClassName = class_name
                wndclass.hIconSm = None

                atom = user32.RegisterClassExW(ctypes.byref(wndclass))
                if not atom:
                    logger.error(f"[RAW INPUT FAIL] RegisterClassExW failed: error={kernel32.GetLastError()}")
                    return

                self.hwnd = user32.CreateWindowExW(
                    0, class_name, "ShackleRawInputWindow",
                    0, 0, 0, 0, 0, HWND_MESSAGE, None, hinstance, None
                )

                if not self.hwnd:
                    logger.error(f"[RAW INPUT FAIL] CreateWindowExW failed: error={kernel32.GetLastError()}")
                    return

                devices = (RAWINPUTDEVICE * 2)()
                devices[0].usUsagePage = 1
                devices[0].usUsage = 6
                devices[0].dwFlags = RIDEV_INPUTSINK
                devices[0].hwndTarget = self.hwnd

                devices[1].usUsagePage = 1
                devices[1].usUsage = 2
                devices[1].dwFlags = RIDEV_INPUTSINK
                devices[1].hwndTarget = self.hwnd

                res = user32.RegisterRawInputDevices(devices, 2, ctypes.sizeof(RAWINPUTDEVICE))
                if not res:
                    logger.error(f"[RAW INPUT FAIL] RegisterRawInputDevices failed: error={kernel32.GetLastError()}")
                    return

                self.running = True
                logger.info("[RAW INPUT SUCCESS] Windows Raw Input API listener registered with RIDEV_INPUTSINK (UIPI Bypassed).")

                msg = wintypes.MSG()
                while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                    user32.TranslateMessage(ctypes.byref(msg))
                    user32.DispatchMessageW(ctypes.byref(msg))

                self.running = False
            except Exception as ex:
                logger.error(f"[RAW INPUT EXCEPTION] {ex}")

        def stop(self):
            if self.hwnd:
                user32.PostMessageW(self.hwnd, WM_DESTROY, 0, 0)


class TelemetryEngine:
    def __init__(self):
        """
        Initializes the privacy-first input tracking engine.
        We use rolling deques to keep track of event timestamps
        over the last 60 seconds.
        ABSOLUTELY NO KEY CHARACTERS ARE STORED.
        """
        self.keystroke_timestamps = deque(maxlen=1000)
        self.mouse_timestamps = deque(maxlen=1000)

        self.start_time = time.time()
        self.last_key_time = time.time()
        self.last_snapshot_time = time.time()
        self.last_zero_event_warning = 0.0
        self.total_captured_events = 0
        self.rapid_fire_count = 0.0
        self.is_running = True

        self.lock = threading.Lock()

        # Windows Elevation / UIPI Diagnostic
        self.is_elevated = False
        if sys.platform == "win32":
            try:
                self.is_elevated = bool(ctypes.windll.shell32.IsUserAnAdmin())
            except Exception:
                pass

        logger.info(f"[TELEMETRY DIAGNOSTIC] Telemetry Engine booting. Process Admin/Elevated: {self.is_elevated}")

        # Background decay thread for continuous linear spoof-counter decay
        self._decay_thread = threading.Thread(target=self._decay_loop, daemon=True)
        self._decay_thread.start()

        # ── ELEVATED VS STANDARD INPUT HOOK SELECTION ──
        if self.is_elevated and sys.platform == "win32":
            logger.info("[TELEMETRY] App running elevated: Initializing Win32 Raw Input API listener (bypasses UIPI restrictions).")
            try:
                self.raw_input_listener = Win32RawInputListener(
                    on_key_callback=self._on_raw_key,
                    on_mouse_callback=self._on_raw_mouse
                )
                self.raw_input_listener.start()
                # Expose as keyboard/mouse listener references for daemon self-test compatibility
                self.keyboard_listener = self.raw_input_listener
                self.mouse_listener = self.raw_input_listener
                logger.info("[SYSTEM] Win32 Raw Input API hooks bound successfully.")
            except Exception as e:
                logger.error(f"[SYSTEM WARNING] Win32 Raw Input API failed to bind: {e}")
        else:
            logger.info("[TELEMETRY] App running standard: Initializing pynput global hooks.")
            try:
                self.keyboard_listener = keyboard.Listener(on_press=self._on_key_press)
                self.mouse_listener = mouse.Listener(on_click=self._on_mouse_click, on_scroll=self._on_mouse_scroll)
                self.keyboard_listener.start()
                self.mouse_listener.start()
                logger.info("[SYSTEM] Telemetry low-level OS pynput hooks bound successfully.")
            except Exception as e:
                logger.error(f"[SYSTEM WARNING] Input telemetry hooks failed to bind: {e}")
                logger.error("Ensure your operating system has granted input monitoring accessibility options.")

    def _decay_loop(self):
        """Smoothly decays the rapid fire count every 1 second independently of snapshot calls."""
        while self.is_running:
            time.sleep(1.0)
            with self.lock:
                self.rapid_fire_count = max(0.0, self.rapid_fire_count - 15.0)

    def _on_raw_key(self):
        """Callback for Raw Input API keyboard press events."""
        current_time = time.time()
        with self.lock:
            time_delta = current_time - self.last_key_time
            if time_delta < 0.05:
                self.rapid_fire_count += 1.0
            
            self.keystroke_timestamps.append(current_time)
            self.last_key_time = current_time
            self.total_captured_events += 1

    def _on_raw_mouse(self):
        """Callback for Raw Input API mouse click/scroll events."""
        current_time = time.time()
        with self.lock:
            self.mouse_timestamps.append(current_time)
            self.total_captured_events += 1

    def _on_key_press(self, key):
        """Fires whenever a key is pressed (pynput fallback)."""
        current_time = time.time()
        with self.lock:
            time_delta = current_time - self.last_key_time
            if time_delta < 0.05:
                self.rapid_fire_count += 1.0
            
            self.keystroke_timestamps.append(current_time)
            self.last_key_time = current_time
            self.total_captured_events += 1

    def _on_mouse_click(self, x, y, button, pressed):
        """Logs mouse clicks safely (pynput fallback)."""
        if pressed:
            current_time = time.time()
            with self.lock:
                self.mouse_timestamps.append(current_time)
                self.total_captured_events += 1

    def _on_mouse_scroll(self, x, y, dx, dy):
        """Logs scrolling behavior as active engagement (pynput fallback)."""
        current_time = time.time()
        with self.lock:
            self.mouse_timestamps.append(current_time)
            self.total_captured_events += 1

    def _clean_old_events(self, current_time: float):
        """Removes timestamps older than 60 seconds. Called out-of-band from callbacks."""
        cutoff_time = current_time - 60.0

        # Clean keystrokes
        while self.keystroke_timestamps and self.keystroke_timestamps[0] < cutoff_time:
            self.keystroke_timestamps.popleft()

        # Clean mouse events
        while self.mouse_timestamps and self.mouse_timestamps[0] < cutoff_time:
            self.mouse_timestamps.popleft()

    def get_telemetry_snapshot(self) -> Dict[str, Any]:
        """
        Compiles current input dynamics to determine if the user is actively working,
        abandoning their desk, or trying to spoof the system.
        """
        current_time = time.time()

        with self.lock:
            # Clean old events inside lock block wrapper
            self._clean_old_events(current_time)

            kpm = len(self.keystroke_timestamps)
            cpm = len(self.mouse_timestamps)
            total_apm = kpm + cpm
            spoof_risk = self.rapid_fire_count
            total_events = self.total_captured_events

        # Periodic self-check for zero events captured after 30 seconds of active runtime
        elapsed_runtime = current_time - self.start_time
        if elapsed_runtime >= 30.0 and total_events == 0:
            if current_time - self.last_zero_event_warning >= 60.0:
                self.last_zero_event_warning = current_time
                logger.warning(
                    f"[TELEMETRY WARNING] Zero keyboard or mouse events captured after {int(elapsed_runtime)}s of monitoring. "
                    f"Elevated Admin context: {self.is_elevated}. Ensure input accessibility permissions are enabled."
                )

        # 1. Input Spoofing Detection Matrix
        if spoof_risk > 50:
            return {
                "status": "spoofing_detected",
                "kpm": kpm,
                "apm": total_apm,
                "message": "Unnatural input rhythm detected. Stop holding down a single key."
            }
        
        # 2. Genuine Deep Work State
        if total_apm > 15:
            return {
                "status": "active",
                "kpm": kpm,
                "apm": total_apm,
                "message": "Optimal input velocity. Deep work verified."
            }
        
        # 3. Micro-Pause / Reading Context
        if 0 < total_apm <= 15:
            return {
                "status": "reading",
                "kpm": kpm,
                "apm": total_apm,
                "message": "Low input rate. Verifying presence via vision engine or active window."
            }
        
        # 4. Absolute zero idle context
        return {
            "status": "idle",
            "kpm": kpm,
            "apm": total_apm,
            "message": "Zero keyboard or mouse input detected in the last 60 seconds."
        }
    
    def shutdown(self):
        """Safely terminates the background listening threads without hanging."""
        self.is_running = False
        try:
            if hasattr(self, 'raw_input_listener') and self.raw_input_listener:
                self.raw_input_listener.stop()
            if hasattr(self, 'keyboard_listener') and hasattr(self.keyboard_listener, 'stop') and self.keyboard_listener != getattr(self, 'raw_input_listener', None):
                self.keyboard_listener.stop()
            if hasattr(self, 'mouse_listener') and hasattr(self.mouse_listener, 'stop') and self.mouse_listener != getattr(self, 'raw_input_listener', None):
                self.mouse_listener.stop()
            logger.info("[SYSTEM] Telemetry engine loops unhooked cleanly.")
        except Exception as e:
            logger.warning(f"[WARNING] Error during telemetry shutdown: {e}")


if __name__ == "__main__":
    logger.info("Starting Shackle AI Telemetry Tracker (Privacy-Safe Mode)...")
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