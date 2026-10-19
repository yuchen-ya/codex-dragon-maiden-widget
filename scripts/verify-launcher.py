"""Exercise the GUI launcher and inspect real Windows windows/process ancestry."""
import argparse
import ctypes
from ctypes import wintypes as w
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import time

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
user = ctypes.WinDLL('user32', use_last_error=True)
kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
kernel.CloseHandle.argtypes = [w.HANDLE]

class Entry(ctypes.Structure):
    _fields_ = [('size',w.DWORD),('usage',w.DWORD),('pid',w.DWORD),('heap',ctypes.c_size_t),('module',w.DWORD),('threads',w.DWORD),('parent',w.DWORD),('priority',w.LONG),('flags',w.DWORD),('name',w.WCHAR*260)]

kernel.Process32FirstW.argtypes = [w.HANDLE, ctypes.POINTER(Entry)]
kernel.Process32NextW.argtypes = [w.HANDLE, ctypes.POINTER(Entry)]

def processes():
    result = {}
    handle = kernel.CreateToolhelp32Snapshot(2, 0)
    entry = Entry(); entry.size = ctypes.sizeof(entry)
    try:
        ok = kernel.Process32FirstW(handle, ctypes.byref(entry))
        while ok:
            result[entry.pid] = {'pid':entry.pid, 'parent':entry.parent, 'name':entry.name}
            ok = kernel.Process32NextW(handle, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(handle)
    return result

callback_type = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
user.EnumWindows.argtypes = [callback_type, w.LPARAM]
user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
user.IsWindowVisible.argtypes = [w.HWND]

def windows():
    result = []
    @callback_type
    def collect(hwnd, _):
        if user.IsWindowVisible(hwnd):
            name = ctypes.create_unicode_buffer(256)
            user.GetClassNameW(hwnd, name, 256)
            pid = w.DWORD(); user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            result.append({'handle':int(hwnd), 'pid':pid.value, 'class':name.value})
        return True
    user.EnumWindows(collect, 0)
    return result

def terminals(items):
    return [item for item in items if 'CASCADIA' in item['class'].upper() or item['class'] == 'ConsoleWindowClass']

def read(file):
    try:
        return json.loads(Path(file).read_text('utf-8-sig'))
    except (OSError, ValueError):
        return {}

class WindowWatch:
    def __init__(self):
        self.before = terminals(windows())
        self.known = {(item['handle'], item['pid']) for item in self.before}
        self.new = {}
        self.samples = 0
    def sample(self):
        for item in terminals(windows()):
            key = (item['handle'], item['pid'])
            if key not in self.known:
                self.new[key] = item
        self.samples += 1
    def report(self):
        return {'samples':self.samples, 'before':self.before, 'after':terminals(windows()), 'newVisibleTerminals':list(self.new.values())}

def pe_subsystem(file):
    with open(file, 'rb') as stream:
        stream.seek(0x3c)
        pe = struct.unpack('<I', stream.read(4))[0]
        stream.seek(pe + 24 + 68)
        return struct.unpack('<H', stream.read(2))[0]

def poll_child(child, watch, timeout=12):
    deadline = time.monotonic() + timeout
    while child.poll() is None and time.monotonic() < deadline:
        watch.sample(); time.sleep(.01)
    out, error = child.communicate(timeout=3)
    assert not out and not error, 'GUI host must not require a console for output'
    return child.returncode

def unit(launcher, output):
    assert pe_subsystem(launcher) == 2, 'Expected Windows GUI subsystem'
    base = Path(tempfile.mkdtemp(prefix='whale-launcher-test-'))
    checks, traces = [], []
    for label, exit_code, seconds in [('normal',0,1.2), ('nonzero',17,1.2), ('termination',0,20)]:
        folder = base / (label + ' space 中文')
        folder.mkdir()
        script = folder / 'supervisor.ps1'
        script.write_text('''param([string]$DataDir)
@{ pid=$PID; stdin=[Console]::IsInputRedirected; stdout=[Console]::IsOutputRedirected; stderr=[Console]::IsErrorRedirected } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDir 'fixture.json') -Encoding utf8
for ($i=0;$i -lt 300;$i++) { [Console]::Out.WriteLine(('stdout ' + ('x' * 300))); [Console]::Error.WriteLine(('stderr ' + ('y' * 300))) }
Start-Sleep -Milliseconds ''' + str(round(seconds*1000)) + '\nexit ' + str(exit_code) + '\n', encoding='utf-8-sig')
        watch = WindowWatch()
        # No CREATE_NO_WINDOW on this parent: its PE subsystem itself must prevent a terminal.
        child = subprocess.Popen([str(launcher),'--script',str(script),'--data',str(folder)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        state = {}
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and child.poll() is None:
            watch.sample(); state = read(folder/'launcher-state.json')
            if state and read(folder/'fixture.json'):
                break
            time.sleep(.01)
        assert state.get('pid') == child.pid, read(folder/'launcher-error.json')
        assert state['host'] == 'WinExe' and state['consoleAttached'] is False
        assert state['createNoWindow'] and state['redirectedStreams'] and state['killChildrenOnExit']
        worker = read(folder/'fixture.json')
        assert worker['pid'] == state['supervisorPid'] and worker['stdin'] and worker['stdout'] and worker['stderr']
        assert processes()[state['supervisorPid']]['parent'] == child.pid
        assert not any(item['pid'] in (child.pid,state['supervisorPid']) for item in windows())
        if label == 'termination':
            child.kill()  # Only the freshly spawned fixture GUI host; its job owns the fake worker.
            poll_child(child, watch)
            deadline = time.monotonic() + 4
            while state['supervisorPid'] in processes() and time.monotonic() < deadline:
                watch.sample(); time.sleep(.02)
            assert state['supervisorPid'] not in processes(), 'Launcher termination left an orphan monitor'
            checks.append('launcher termination closes its job and removes the child monitor')
        else:
            code = poll_child(child, watch)
            assert code == exit_code, (code,read(folder/'launcher-error.json'))
            assert not (folder/'launcher-state.json').exists()
            if exit_code:
                error = read(folder/'launcher-error.json')
                assert error['exitCode'] == exit_code and len(error['diagnosticTail']) <= 8192
                checks.append('nonzero worker exit reaches Task Scheduler and output remains bounded')
            else:
                checks.append('GUI host starts and drains a monitor with redirected streams and Unicode paths')
        assert not watch.new, watch.report()
        traces.append(watch.report())
    return {'ok':True,'checks':checks,'subsystem':2,'traces':traces,'fixtureDirectory':str(base)}

def install(root, data):
    before_worker = read(data/'supervisor-state.json')
    before_runtime = read(data/'runtime.json')
    watch = WindowWatch()
    command = [r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-File',str(root/'scripts/install-follow.ps1'),'-DataDir',str(data)]
    child = subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
    deadline = time.monotonic() + 35
    while child.poll() is None and time.monotonic() < deadline:
        watch.sample(); time.sleep(.01)
    out,error = child.communicate(timeout=3)
    def decode(raw):
        try:
            return raw.decode('utf-8')
        except UnicodeDecodeError:
            return raw.decode('cp' + str(kernel.GetACP()), errors='replace')
    out,error = decode(out),decode(error)
    assert child.returncode == 0, (out,error)
    deadline = time.monotonic() + 25
    state, worker, runtime, follow = {}, {}, {}, {}
    while time.monotonic() < deadline:
        watch.sample()
        state = read(data/'launcher-state.json'); worker = read(data/'supervisor-state.json')
        runtime = read(data/'runtime.json'); follow = read(data/'follow-state.json')
        if state and worker.get('pid') == state.get('supervisorPid') and worker.get('pid') != before_worker.get('pid') and runtime.get('pid') != before_runtime.get('pid') and follow.get('childPid') == runtime.get('pid') and follow.get('state',{}).get('attached'):
            break
        time.sleep(.05)
    assert state and worker.get('pid') == state.get('supervisorPid'), read(data/'launcher-error.json')
    assert worker['pid'] != before_worker.get('pid') and runtime.get('pid') != before_runtime.get('pid')
    assert follow.get('childPid') == runtime.get('pid') and follow.get('state',{}).get('attached')
    table = processes()
    assert table[worker['pid']]['parent'] == state['pid']
    parent = table.get(table[state['pid']]['parent'],{})
    assert parent.get('name','').lower() in ('svchost.exe','taskeng.exe','taskhostw.exe'), parent
    assert pe_subsystem(state['executable']) == 2
    assert not any(item['pid'] in (state['pid'],worker['pid']) for item in windows())
    assert not watch.new, watch.report()
    return {'ok':True,'checks':['registered task uses the GUI launcher','GUI launcher is owned by Windows service','monitor has no visible window','no new visible terminal during actual task migration/startup','companion recovered and attached to Codex'], 'launcher':state, 'monitorPid':worker['pid'], 'companionPid':runtime['pid'], 'parent':parent, 'windowWatch':watch.report()}

parser = argparse.ArgumentParser()
parser.add_argument('mode',choices=['unit','install'])
parser.add_argument('--launcher',type=Path)
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument('--data',type=Path,default=Path.home()/'.codex/whale-widget')
parser.add_argument('--output',type=Path,required=True)
args = parser.parse_args()
args.output.parent.mkdir(parents=True,exist_ok=True)
try:
    result = unit(args.launcher,args.output) if args.mode == 'unit' else install(args.root,args.data)
except Exception as error:
    args.output.write_text(json.dumps({'ok':False,'error':repr(error)},ensure_ascii=False,indent=2),encoding='utf-8')
    raise
args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
