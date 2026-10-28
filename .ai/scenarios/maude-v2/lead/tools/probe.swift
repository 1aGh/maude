// Is a real (taller than 200 pt, any layer: MAUDE_E2E_KEEP_FRONT floats it at layer 5) window of the app named "Maude" on screen, and who is frontmost? Matched by owner PID, not the
// CG owner name: a debug binary run outside a bundle reports its executable name there, not "Maude".
import CoreGraphics
import AppKit
let pids = Set(NSWorkspace.shared.runningApplications.filter { $0.localizedName == "Maude" }.map { Int($0.processIdentifier) })
let on = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
let all = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
let isMaude: ([String: Any]) -> Bool = { pids.contains(($0[kCGWindowOwnerPID as String] as? Int) ?? -1) && ((($0[kCGWindowBounds as String] as? [String: Any])?["Height"] as? Double) ?? 0) > 200 }
let owners = Set(all.filter(isMaude).compactMap { $0[kCGWindowOwnerName as String] as? String }).sorted().joined(separator: ",")
let maude = on.contains(where: isMaude)
let offscreen = all.filter(isMaude).count - on.filter(isMaude).count
let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
print("maude_on_screen=\(maude) maude_offscreen=\(offscreen) owners=\(owners) apps=\(pids.count) front=\(front)")
