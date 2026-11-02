import CoreGraphics
import AppKit
let name = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Maude"
let apps = NSWorkspace.shared.runningApplications.filter { $0.localizedName == name }
for a in apps { print("app pid=\(a.processIdentifier) bundle=\(a.bundleURL?.path ?? "-") hidden=\(a.isHidden) active=\(a.isActive)") }
let pids = Set(apps.map { Int($0.processIdentifier) })
let all = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
let on = Set(((CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []).compactMap { $0[kCGWindowNumber as String] as? Int })
for w in all where pids.contains((w[kCGWindowOwnerPID as String] as? Int) ?? -1) {
  print("win \(w[kCGWindowNumber as String] ?? 0) layer=\(w[kCGWindowLayer as String] ?? "-") onscreenKey=\(w[kCGWindowIsOnscreen as String] ?? "-") inOnList=\(on.contains((w[kCGWindowNumber as String] as? Int) ?? -1)) alpha=\(w[kCGWindowAlpha as String] ?? "-") bounds=\(w[kCGWindowBounds as String] ?? "-")")
}
