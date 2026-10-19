"""Read the region of one explicitly identified test window; no mouse input."""
import ctypes,json,sys
from ctypes import wintypes
u=ctypes.WinDLL('user32',use_last_error=True);g=ctypes.WinDLL('gdi32',use_last_error=True)
u.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
u.GetWindowRgn.argtypes=[wintypes.HWND,wintypes.HANDLE]
u.SetThreadDpiAwarenessContext.argtypes=[wintypes.HANDLE];u.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
g.CreateRectRgn.argtypes=[ctypes.c_int]*4;g.CreateRectRgn.restype=wintypes.HANDLE
g.PtInRegion.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_int];g.DeleteObject.argtypes=[wintypes.HANDLE]
hwnd,pid,*points=map(int,sys.argv[1:]);actual=wintypes.DWORD();u.GetWindowThreadProcessId(hwnd,ctypes.byref(actual))
if actual.value!=pid:raise RuntimeError('Fixture PID mismatch')
region=g.CreateRectRgn(0,0,0,0)
try:
 kind=u.GetWindowRgn(hwnd,region)
 print(json.dumps({'kind':kind,'contains':[bool(g.PtInRegion(region,points[i],points[i+1])) for i in range(0,len(points),2)]}))
finally:g.DeleteObject(region)
