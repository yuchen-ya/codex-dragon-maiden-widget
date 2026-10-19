"""Read-only Win32 window metadata for isolated and live rendering checks."""
import ctypes, json, sys
from ctypes import wintypes

api = ctypes.WinDLL('user32', use_last_error=True)
api.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
api.GetWindowLongPtrW.restype = ctypes.c_ssize_t
api.GetForegroundWindow.restype = wintypes.HWND
api.IsWindowVisible.argtypes = [wintypes.HWND]
api.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
api.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
api.SetThreadDpiAwarenessContext.argtypes = [wintypes.HANDLE]
api.SetThreadDpiAwarenessContext.restype = wintypes.HANDLE
api.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))

def probe(handle):
    rect, pid = wintypes.RECT(), wintypes.DWORD()
    api.GetWindowRect(handle, ctypes.byref(rect))
    api.GetWindowThreadProcessId(handle, ctypes.byref(pid))
    style = api.GetWindowLongPtrW(handle, -20) & 0xffffffff
    return dict(handle=str(handle), pid=pid.value, visible=bool(api.IsWindowVisible(handle)),
                exStyle=hex(style), toolWindow=bool(style & 0x80), noActivate=bool(style & 0x08000000),
                transparent=bool(style & 0x20), layered=bool(style & 0x80000), appWindow=bool(style & 0x40000),
                foreground=str(api.GetForegroundWindow() or 0), bounds=[rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top])

if sys.argv[1:] and sys.argv[1] == '--terminals':
    windows = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    @callback_type
    def visit(handle, _):
        if api.IsWindowVisible(handle):
            name = ctypes.create_unicode_buffer(256)
            api.GetClassNameW(handle, name, 256)
            if name.value in ('ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow'):
                windows.append(dict(probe(handle), windowClass=name.value))
        return True
    api.EnumWindows(visit, 0)
    print(json.dumps(windows))
else:
    print(json.dumps(probe(int(sys.argv[1]))))
