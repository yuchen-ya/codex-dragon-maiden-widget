"""Sample the OS cursor over a verified fixture's editor; never type or click."""
import ctypes,json,sys,time
from ctypes import wintypes as w
u=ctypes.WinDLL('user32',use_last_error=True)
class CursorInfo(ctypes.Structure):
    _fields_=[('cbSize',w.DWORD),('flags',w.DWORD),('hCursor',w.HANDLE),('ptScreenPos',w.POINT)]
u.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
u.GetCursorInfo.argtypes=[ctypes.POINTER(CursorInfo)]
u.LoadCursorW.argtypes=[w.HINSTANCE,ctypes.c_void_p];u.LoadCursorW.restype=w.HANDLE
u.GetCursorPos.argtypes=[ctypes.POINTER(w.POINT)]
u.SetThreadDpiAwarenessContext.argtypes=[w.HANDLE];u.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
hwnd,pid,x,y=map(int,sys.argv[1:]);actual=w.DWORD();u.GetWindowThreadProcessId(hwnd,ctypes.byref(actual))
if actual.value!=pid:raise RuntimeError('Fixture PID mismatch')
prior=w.POINT();u.GetCursorPos(ctypes.byref(prior));ibeam=u.LoadCursorW(None,ctypes.c_void_p(32513));arrow=u.LoadCursorW(None,ctypes.c_void_p(32512))
counts={'ibeam':0,'arrow':0,'other':0};changes=0;last=None
try:
    u.SetCursorPos(x,y);time.sleep(.15)
    for n in range(360):
        u.SetCursorPos(x+(n%50),y+(n%3));time.sleep(.003)
        info=CursorInfo();info.cbSize=ctypes.sizeof(info);u.GetCursorInfo(ctypes.byref(info))
        name='ibeam' if info.hCursor==ibeam else 'arrow' if info.hCursor==arrow else 'other';counts[name]+=1
        if last is not None and last!=name:changes+=1
        last=name
finally:u.SetCursorPos(prior.x,prior.y)
print(json.dumps({'counts':counts,'changes':changes,'samples':sum(counts.values())}))
