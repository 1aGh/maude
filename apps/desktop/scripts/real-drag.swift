// real-drag.swift — a REAL OS drag for check-real-drop.mjs. IT MOVES THE MOUSE (CGEvent at the HID tap; needs the
// calling app to hold the Accessibility grant). Compiled by the check into a temp dir; never shipped.
//   real-drag window <pid>       → prints "x y w h" of the pid's largest on-screen window (CG global, top-left origin)
//   real-drag drag x1 y1 x2 y2   → mouse down at 1, drag to 2, hover, up (an in-app HTML5 drag, e.g. an Assets tile)
//   real-drag file <path> x2 y2  → a Finder-like file drag: a small helper window at FROM_X (default 50) starts an
//                                  NSDraggingSession carrying the file URL; the cursor carries it to 2 and releases
// The cursor is put back where it was afterwards.
import AppKit
import CoreGraphics

let args = CommandLine.arguments
func post(_ type: CGEventType, _ p: CGPoint) {
  let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!
  e.post(tap: .cghidEventTap)
}
func path(_ a: CGPoint, _ b: CGPoint, steps: Int, dt: useconds_t, type: CGEventType) {
  for i in 1...steps {
    let t = CGFloat(i) / CGFloat(steps)
    post(type, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
    usleep(dt)
  }
}
func gesture(_ a: CGPoint, _ b: CGPoint) {
  post(.mouseMoved, a)
  usleep(150_000)
  post(.leftMouseDown, a)
  usleep(120_000)
  // a small first move past WebKit's drag hysteresis, then the trip, then a hover so dragover fires over the target
  path(a, CGPoint(x: a.x + 12, y: a.y + 12), steps: 6, dt: 30_000, type: .leftMouseDragged)
  path(CGPoint(x: a.x + 12, y: a.y + 12), b, steps: 40, dt: 20_000, type: .leftMouseDragged)
  for _ in 0..<15 {
    post(.leftMouseDragged, b)
    usleep(40_000)
  }
  post(.leftMouseUp, b)
  usleep(300_000)
}

let restore = CGEvent(source: nil)!.location
defer { post(.mouseMoved, restore) }

switch args.count > 1 ? args[1] : "" {
case "window":
  let pid = Int32(args[2])!
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
  var best: CGRect? = nil
  for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
    let b = w[kCGWindowBounds as String] as! [String: CGFloat]
    let r = CGRect(x: b["X"]!, y: b["Y"]!, width: b["Width"]!, height: b["Height"]!)
    if best == nil || r.width * r.height > best!.width * best!.height { best = r }
  }
  guard let r = best else { print("none"); exit(3) }
  print("\(Int(r.minX)) \(Int(r.minY)) \(Int(r.width)) \(Int(r.height))")
  exit(0)
case "drag":
  let v = args[2...5].map { CGFloat(Double($0)!) }
  gesture(CGPoint(x: v[0], y: v[1]), CGPoint(x: v[2], y: v[3]))
  post(.mouseMoved, restore)
  exit(0)
case "file":
  let file = URL(fileURLWithPath: args[2])
  let to = CGPoint(x: CGFloat(Double(args[3])!), y: CGFloat(Double(args[4])!))
  final class Source: NSView, NSDraggingSource {
    var file: URL!
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func draw(_ r: NSRect) { NSColor.systemOrange.setFill(); r.fill() }
    func draggingSession(_ s: NSDraggingSession, sourceOperationMaskFor c: NSDraggingContext) -> NSDragOperation { .copy }
    override func mouseDragged(with event: NSEvent) {
      guard !started else { return }
      started = true
      let item = NSDraggingItem(pasteboardWriter: file as NSURL)
      let img = NSImage(size: NSSize(width: 32, height: 32))
      item.setDraggingFrame(NSRect(x: 0, y: 0, width: 32, height: 32), contents: img)
      beginDraggingSession(with: [item], event: event, source: self)
    }
    var started = false
    func draggingSession(_ s: NSDraggingSession, endedAt p: NSPoint, operation: NSDragOperation) {
      print("SESSION_ENDED operation=\(operation.rawValue)")
      fflush(stdout)
    }
  }
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  // the helper window sits 140 pt left of the target's screen, CG → Cocoa y flip
  let screenH = NSScreen.screens[0].frame.height
  let from = CGPoint(x: Double(ProcessInfo.processInfo.environment["FROM_X"] ?? "50")!, y: to.y)
  let win = NSWindow(contentRect: NSRect(x: from.x - 30, y: screenH - from.y - 30, width: 60, height: 60),
                     styleMask: [.borderless], backing: .buffered, defer: false)
  win.level = .popUpMenu
  let v = Source(frame: NSRect(x: 0, y: 0, width: 60, height: 60))
  v.file = file
  win.contentView = v
  win.orderFrontRegardless()
  DispatchQueue.global().asyncAfter(deadline: .now() + 0.6) {
    gesture(from, to)
    usleep(500_000)
    post(.mouseMoved, restore)
    DispatchQueue.main.async { app.terminate(nil) }
  }
  app.run()
default:
  print("usage: realdrag window <pid> | drag x1 y1 x2 y2 | file <path> x y")
  exit(2)
}
