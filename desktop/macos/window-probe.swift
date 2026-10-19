import AppKit
import CoreGraphics
import Darwin
import Foundation

struct Options {
    var bundleIDs: Set<String>
    var appPath: String?
    var companionBundleID: String
    var intervalMilliseconds = 16
    var once = false
}

func optionValues(_ name: String) -> [String] {
    var values: [String] = []
    var index = 1
    while index < CommandLine.arguments.count {
        if CommandLine.arguments[index] == name, index + 1 < CommandLine.arguments.count {
            values.append(CommandLine.arguments[index + 1])
            index += 2
            continue
        }
        index += 1
    }
    return values
}

func parseOptions() -> Options {
    let environment = ProcessInfo.processInfo.environment
    var identifiers = optionValues("--bundle-id").flatMap {
        $0.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
    }
    if identifiers.isEmpty, let configured = environment["WHALE_CODEX_BUNDLE_ID"], !configured.isEmpty {
        identifiers = configured.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
    }
    if identifiers.isEmpty {
        identifiers = ["com.openai.codex"]
    }
    let interval = optionValues("--interval-ms").last.flatMap(Int.init) ?? 16
    return Options(
        bundleIDs: Set(identifiers.filter { !$0.isEmpty }),
        appPath: optionValues("--app-path").last ?? environment["WHALE_CODEX_APP_PATH"],
        companionBundleID: optionValues("--companion-bundle-id").last ?? "com.codex-dragon-maiden-widget.codex.desktop",
        intervalMilliseconds: max(8, interval),
        once: CommandLine.arguments.contains("--once")
    )
}

func expectedApplicationPaths(_ options: Options) -> Set<String> {
    var paths = Set<String>()
    if let appPath = options.appPath {
        paths.insert(URL(fileURLWithPath: appPath).standardizedFileURL.path)
    }
    for bundleID in options.bundleIDs {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
            paths.insert(url.standardizedFileURL.path)
        }
    }
    return paths
}

func executablePath(_ pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: 4096)
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    return String(cString: buffer)
}

func matchingProcessIDs(_ options: Options) -> [pid_t] {
    let expectedPaths = expectedApplicationPaths(options)
    let estimatedBytes = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
    let capacity = max(64, Int(estimatedBytes) / MemoryLayout<pid_t>.size + 32)
    var pids = [pid_t](repeating: 0, count: capacity)
    let bytes = pids.withUnsafeMutableBytes { buffer in
        proc_listpids(UInt32(PROC_ALL_PIDS), 0, buffer.baseAddress, Int32(buffer.count))
    }
    guard bytes > 0 else { return [] }
    let count = Int(bytes) / MemoryLayout<pid_t>.size
    return pids.prefix(count).filter { pid in
        guard pid > 0, let executable = executablePath(pid) else { return false }
        if expectedPaths.contains(where: { executable.hasPrefix($0 + "/Contents/MacOS/") }) {
            return true
        }
        // An explicitly selected app must not also attach to an unrelated
        // ChatGPT installation just because of its filename.
        return false
    }
}

struct HostWindow {
    let windowNumber: UInt32
    let ownerPID: pid_t
    let bounds: CGRect
}

func hostWindow(for processIDs: [pid_t]) -> HostWindow? {
    let processIDs = Set(processIDs)
    guard !processIDs.isEmpty,
          let rawWindows = CGWindowListCopyWindowInfo(
              [.optionOnScreenOnly, .excludeDesktopElements],
              kCGNullWindowID
          ) as? [[String: Any]]
    else { return nil }

    let candidates: [HostWindow] = rawWindows.compactMap { info in
        guard let ownerPID = info[kCGWindowOwnerPID as String] as? pid_t,
              processIDs.contains(ownerPID),
              let windowNumber = info[kCGWindowNumber as String] as? UInt32,
              let boundsDictionary = info[kCGWindowBounds as String] as? NSDictionary,
              let x = boundsDictionary["X"] as? CGFloat,
              let y = boundsDictionary["Y"] as? CGFloat,
              let width = boundsDictionary["Width"] as? CGFloat,
              let height = boundsDictionary["Height"] as? CGFloat
        else { return nil }
        let bounds = CGRect(x: x, y: y, width: width, height: height)
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
        let onscreen = info[kCGWindowIsOnscreen as String] as? Bool ?? true
        guard layer == 0, alpha > 0.01, onscreen,
              bounds.width >= 320, bounds.height >= 200
        else { return nil }
        return HostWindow(windowNumber: windowNumber, ownerPID: ownerPID, bounds: bounds)
    }

    let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return candidates.first(where: { $0.ownerPID == frontmostPID }) ?? candidates.first
}

func emit(_ state: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

let options = parseOptions()
var lastWindowNumber: UInt32 = 0
var lastOwnerPID: pid_t = 0
var lastBounds = CGRect.zero
var lastEncoded = ""
var lastHeartbeat = Date.distantPast
var cachedProcessIDs: [pid_t] = []
var lastProcessScan = Date.distantPast

while true {
    autoreleasepool {
        if Date().timeIntervalSince(lastProcessScan) >= 0.25 {
            cachedProcessIDs = matchingProcessIDs(options)
            lastProcessScan = Date()
        }
        let processIDs = cachedProcessIDs
        let window = hostWindow(for: processIDs)
        if let window {
            lastWindowNumber = window.windowNumber
            lastOwnerPID = window.ownerPID
            lastBounds = window.bounds
        }

        let hostAlive = !processIDs.isEmpty
        let frontmost = NSWorkspace.shared.frontmostApplication
        // A floating macOS overlay has no native owner window. Keep it behind
        // unrelated applications by hiding in follow mode when they activate.
        // Clicking our pet or opening its settings must keep it visible.
        let foreground = processIDs.contains(frontmost?.processIdentifier ?? 0)
            || frontmost?.bundleIdentifier == options.companionBundleID
        let visible = hostAlive && window != nil && foreground
        let bounds = window?.bounds ?? lastBounds
        let primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
        let cocoaBounds = CGRect(x: bounds.minX, y: primaryTop - bounds.maxY, width: bounds.width, height: bounds.height)
        let display = NSScreen.screens.max {
            let a = $0.frame.intersection(cocoaBounds), b = $1.frame.intersection(cocoaBounds)
            return (a.isNull ? 0 : a.width * a.height) < (b.isNull ? 0 : b.width * b.height)
        }
        let scale = display?.backingScaleFactor ?? 1
        let ownerPID = window?.ownerPID ?? processIDs.first ?? 0
        let hostApplication = NSRunningApplication(processIdentifier: ownerPID)
        let launchTime = hostApplication?.launchDate?.timeIntervalSince1970 ?? 0
        var state: [String: Any] = [
            "hostAlive": hostAlive,
            "hostPid": hostAlive ? ownerPID : lastOwnerPID,
            "hostSession": hostAlive ? "\(ownerPID):\(launchTime)" : "",
            "window": String(window?.windowNumber ?? lastWindowNumber),
            "visible": visible,
            "attached": visible,
            "nativeFollowing": false,
            "followMode": "macos-cgwindow-poll",
            "dpi": 72.0 * scale,
            "bounds": [
                "x": Double(bounds.origin.x),
                "y": Double(bounds.origin.y),
                "width": Double(bounds.width),
                "height": Double(bounds.height)
            ],
            "bundleId": hostApplication?.bundleIdentifier as Any? ?? NSNull()
        ]
        if ProcessInfo.processInfo.environment["WHALE_PROBE_DEBUG"] == "1" {
            state["processIds"] = processIDs
            state["foregroundPid"] = frontmost?.processIdentifier ?? 0
            state["foregroundBundleId"] = frontmost?.bundleIdentifier ?? ""
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])
            let encoded = String(data: data, encoding: .utf8) ?? ""
            let now = Date()
            if encoded != lastEncoded || now.timeIntervalSince(lastHeartbeat) >= 1 {
                try emit(state)
                lastEncoded = encoded
                lastHeartbeat = now
            }
        } catch {
            FileHandle.standardError.write(Data("window probe serialization failed\n".utf8))
        }
    }

    if options.once { break }
    // NSWorkspace refreshes application state through run-loop notifications.
    // Sleeping here leaves frontmostApplication cached at its startup value.
    RunLoop.current.run(until: Date(timeIntervalSinceNow: Double(options.intervalMilliseconds) / 1000.0))
}
