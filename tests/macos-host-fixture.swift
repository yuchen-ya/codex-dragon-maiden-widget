import AppKit
import Foundation
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 200, y: 150, width: 800, height: 550), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
window.title = "Dragon Maiden QA Host"
window.makeKeyAndOrderFront(nil)
DispatchQueue.global().async {
    while let command = readLine() {
        DispatchQueue.main.async {
            switch command {
            case "move": window.setFrame(NSRect(x: 240, y: 180, width: 700, height: 500), display: true)
            case "minimize": window.miniaturize(nil)
            case "restore": window.deminiaturize(nil); window.makeKeyAndOrderFront(nil); application.activate(ignoringOtherApps: true)
            case "hide": application.hide(nil)
            case "show": application.unhide(nil); window.makeKeyAndOrderFront(nil); application.activate(ignoringOtherApps: true)
            case "quit": application.terminate(nil)
            default: break
            }
        }
    }
}
DispatchQueue.main.async { window.makeKeyAndOrderFront(nil); application.activate(ignoringOtherApps: true) }
application.run()
