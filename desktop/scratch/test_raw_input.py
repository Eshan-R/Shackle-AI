import sys
import time
import threading
import ctypes
from ctypes import wintypes

if sys.platform == "win32":
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
    RI_MOUSE_LEFT_BUTTON_DOWN = 0x0001
    RI_MOUSE_RIGHT_BUTTON_DOWN = 0x0004
    RI_MOUSE_WHEEL = 0x0400

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
                err = kernel32.GetLastError()
                print(f"[RAW INPUT FAIL] RegisterClassExW failed error={err}")
                return

            self.hwnd = user32.CreateWindowExW(
                0, class_name, "ShackleRawInputWindow",
                0, 0, 0, 0, 0, HWND_MESSAGE, None, hinstance, None
            )

            if not self.hwnd:
                err = kernel32.GetLastError()
                print(f"[RAW INPUT FAIL] CreateWindowExW failed error={err}")
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
                err = kernel32.GetLastError()
                print(f"[RAW INPUT FAIL] RegisterRawInputDevices failed error={err}")
                return

            self.running = True
            print("[RAW INPUT SUCCESS] Registered Raw Input Devices with RIDEV_INPUTSINK!")

            msg = wintypes.MSG()
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))

            self.running = False
        except Exception as ex:
            print(f"[RAW INPUT EXCEPTION] {ex}")

    def stop(self):
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_DESTROY, 0, 0)


if __name__ == "__main__":
    count = [0, 0]
    def on_k():
        count[0] += 1
        print(f"Key press event captured via Raw Input! Total: {count[0]}")

    def on_m():
        count[1] += 1
        print(f"Mouse event captured via Raw Input! Total: {count[1]}")

    listener = Win32RawInputListener(on_key_callback=on_k, on_mouse_callback=on_m)
    listener.start()
    print(f"Raw Input Listener Running: {listener.running}")
    time.sleep(2)
    listener.stop()
