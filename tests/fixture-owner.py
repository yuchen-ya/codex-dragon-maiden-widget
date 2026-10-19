"""Attach/detach only the two explicit fixture HWND/PID pairs for an owner test."""
import ctypes, json, sys
from ctypes import wintypes
api = ctypes.WinDLL('user32', use_last_error=True)
api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
api.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
api.SetWindowLongPtrW.restype = ctypes.c_ssize_t
api.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
api.GetWindow.restype = wintypes.HWND
overlay, overlay_pid, owner, owner_pid = map(int, sys.argv[1:])
for hwnd, expected in [(overlay, overlay_pid)] + ([(owner, owner_pid)] if owner else []):
    pid = wintypes.DWORD()
    api.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value != expected: raise RuntimeError('Fixture identity mismatch')
api.SetWindowLongPtrW(overlay, -8, owner)
dwm = ctypes.WinDLL('dwmapi')
dwm.DwmSetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
disabled = ctypes.c_int(1)
assert dwm.DwmSetWindowAttribute(overlay, 3, ctypes.byref(disabled), ctypes.sizeof(disabled)) == 0
assert (api.GetWindow(overlay, 4) or 0) == owner
print(json.dumps({'owner': str(owner), 'overlay': str(overlay)}))
