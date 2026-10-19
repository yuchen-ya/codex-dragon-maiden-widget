using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Compiled as Windows GUI (WinExe). It intentionally creates no windows.
internal static class WhaleLauncher {
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object TailLock = new object();
    static readonly StringBuilder Tail = new StringBuilder();

    static string Argument(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            slashes = 0; result.Append(c);
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    static string Identity(string path) {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(path.ToLowerInvariant()))).Replace("-", "").Substring(0, 24);
    }
    static void WriteJson(string file, object value) {
        string temporary = file + "." + Process.GetCurrentProcess().Id + ".tmp";
        File.WriteAllText(temporary, Json.Serialize(value), new UTF8Encoding(false));
        if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
    }
    static void Capture(object sender, DataReceivedEventArgs args) {
        if (args.Data == null) return;
        lock (TailLock) {
            Tail.AppendLine(args.Data);
            if (Tail.Length > 8192) Tail.Remove(0, Tail.Length - 8192);
        }
    }
    static void RemoveOwnState(string file, int pid) {
        try {
            if (!File.Exists(file)) return;
            var saved = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
            if (saved.ContainsKey("pid") && Convert.ToInt32(saved["pid"]) == pid) File.Delete(file);
        } catch { }
    }
    [STAThread]
    static int Main(string[] args) {
        string dataDir = null, script = null;
        int ownPid = Process.GetCurrentProcess().Id;
        try {
            for (int i = 0; i < args.Length; i += 2) {
                if (i + 1 >= args.Length) throw new ArgumentException("Incomplete launcher arguments.");
                if (args[i] == "--script") script = Path.GetFullPath(args[i + 1]);
                else if (args[i] == "--data") dataDir = Path.GetFullPath(args[i + 1]);
                else throw new ArgumentException("Unknown launcher argument.");
            }
            if (dataDir == null || script == null || !File.Exists(script) || !string.Equals(Path.GetFileName(script), "supervisor.ps1", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("A supervisor script and data directory are required.");
            Directory.CreateDirectory(dataDir);
            bool fresh;
            using (var mutex = new Mutex(true, "Local\\CodexWhaleLauncher-" + Identity(dataDir), out fresh)) {
                if (!fresh) return 0;
                try {
                    var start = new ProcessStartInfo {
                        FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                        Arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " + Argument(script) + " -DataDir " + Argument(dataDir),
                        WorkingDirectory = dataDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardInput = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };
                    start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                    string stateFile = Path.Combine(dataDir, "launcher-state.json");
                    using (var job = new ChildJob())
                    using (var child = new Process { StartInfo = start }) {
                        if (!child.Start()) throw new InvalidOperationException("Supervisor did not start.");
                        try { job.Assign(child); }
                        catch { try { child.Kill(); } catch { } throw; }
                        child.OutputDataReceived += Capture; child.ErrorDataReceived += Capture;
                        child.BeginOutputReadLine(); child.BeginErrorReadLine();
                        child.StandardInput.Close();
                        WriteJson(stateFile, new {
                            pid = ownPid, supervisorPid = child.Id,
                            startedAt = DateTime.UtcNow.ToString("o"),
                            host = "WinExe", consoleAttached = GetConsoleWindow() != IntPtr.Zero,
                            createNoWindow = true, redirectedStreams = true, killChildrenOnExit = true,
                            script = script, executable = Process.GetCurrentProcess().MainModule.FileName
                        });
                        try {
                            // Stay alive so the Windows task tracks the real monitor lifetime.
                            child.WaitForExit();
                            int code = child.ExitCode;
                            if (code != 0) WriteJson(Path.Combine(dataDir, "launcher-error.json"), new { at = DateTime.UtcNow.ToString("o"), exitCode = code, message = "Supervisor exited with an error.", diagnosticTail = Tail.ToString() });
                            return code;
                        } finally { RemoveOwnState(stateFile, ownPid); }
                    }
                } finally { mutex.ReleaseMutex(); }
            }
        } catch (Exception error) {
            if (dataDir != null) {
                try { WriteJson(Path.Combine(dataDir, "launcher-error.json"), new { at = DateTime.UtcNow.ToString("o"), message = error.Message }); } catch { }
                RemoveOwnState(Path.Combine(dataDir, "launcher-state.json"), ownPid);
            }
            return 1;
        }
    }

    // A launcher crash must not leave an untracked monitor/companion behind.
    sealed class ChildJob : IDisposable {
        [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
            public long ProcessTime, JobTime;
            public uint Flags;
            public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveProcesses;
            public UIntPtr Affinity;
            public uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        IntPtr handle;
        public ChildJob() {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)))) {
                int error = Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error);
            }
        }
        public void Assign(Process child) { if (!AssignProcessToJobObject(handle, child.Handle)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
        public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    }
}
