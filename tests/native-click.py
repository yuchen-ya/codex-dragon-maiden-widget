"""One guarded OS mouse click on an explicitly identified fixture window."""
import ctypes, json, sys, time
from ctypes import wintypes

api = ctypes.WinDLL('user32', use_last_error=True)
api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
api.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
api.GetAncestor.restype = wintypes.HWND
api.WindowFromPoint.argtypes = [wintypes.POINT]
api.WindowFromPoint.restype = wintypes.HWND
api.GetForegroundWindow.restype = wintypes.HWND
api.SetThreadDpiAwarenessContext.argtypes = [wintypes.HANDLE]
api.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
class Mouse(ctypes.Structure):
    _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('data', wintypes.DWORD), ('flags', wintypes.DWORD), ('time', wintypes.DWORD), ('extra', ctypes.c_size_t)]
class Payload(ctypes.Union):
    _fields_ = [('mouse', Mouse)]
class Input(ctypes.Structure):
    _fields_ = [('kind', wintypes.DWORD), ('payload', Payload)]
api.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
api.SendInput.restype = wintypes.UINT
handle, expected_pid, x, y = map(int, sys.argv[1:])
pid = wintypes.DWORD()
api.GetWindowThreadProcessId(handle, ctypes.byref(pid))
if pid.value != expected_pid:
    raise RuntimeError('Fixture PID mismatch: no click sent')
old = wintypes.POINT()
api.GetCursorPos(ctypes.byref(old))
before = api.GetForegroundWindow() or 0
pressed = False
def send(flags):
    event = Input(0, Payload(mouse=Mouse(0, 0, 0, flags, 0, 0)))
    if api.SendInput(1, ctypes.byref(event), ctypes.sizeof(event)) != 1:
        raise RuntimeError('Windows input delivery failed')
try:
    api.SetCursorPos(x, y)
    time.sleep(.18)
    hit = api.WindowFromPoint(wintypes.POINT(x, y))
    if api.GetAncestor(hit, 2) != handle:
        raise RuntimeError('Fixture does not own this pixel: no click sent; target=%s hit=%s root=%s at=%s,%s' % (handle,hit,api.GetAncestor(hit,2),x,y))
    send(2); pressed = True
    time.sleep(.05)
    send(4); pressed = False
    time.sleep(.12)
    print(json.dumps(dict(foregroundBefore=str(before), foregroundAfter=str(api.GetForegroundWindow() or 0), target=str(handle))))
finally:
    if pressed: send(4)
    current = wintypes.POINT()
    api.GetCursorPos(ctypes.byref(current))
    if (current.x, current.y) == (x, y): api.SetCursorPos(old.x, old.y)
