// webkit-drag-probe.swift — a REAL WebKit drag in a WKWebView (the engine the Maude app runs), for webkit-asset-drop.mjs.
//
// Why native: WebDriver cannot drive one. The app's wdio plugin dispatches synthetic JS events, and safaridriver starts a
// drag but never moves it (its session follows the hardware cursor). A synthetic `DataTransfer` skips exactly the code
// that decides who may receive a drag. This probe takes the TestWebKitAPI DragAndDropSimulator shape: real mouse events
// make WebKit start its own drag (its drag pasteboard, its origin tagging); the dragging session WebKit asks the view to
// begin is recorded instead of started (no hardware cursor is involved), and the destination side runs on the real drag
// pasteboard (draggingEntered → draggingUpdated… → performDragOperation → the source's end). Nothing here moves the
// person's mouse or needs an accessibility grant.
//
// Environment: PROBE_URL; PROBE_SETUP_JS (run once the page is loaded); PROBE_READY_JS (polled until true);
// PROBE_FROM_JS / PROBE_TO_JS (return [x, y] in page coordinates); PROBE_MODE `page` (drag the element at FROM) or
// `file` (a drag from outside the page carrying PROBE_FILE, as a Finder drag does); PROBE_LOG_JS (printed at the end).
// Prints `RESULT {json}` and exits 0, or exits 2/3 with the reason.
import AppKit
import ObjectiveC
import WebKit

final class DragInfo: NSObject, NSDraggingInfo {
  var loc = NSPoint.zero
  weak var src: AnyObject?
  weak var win: NSWindow?
  var draggingDestinationWindow: NSWindow? { win }
  var draggingSourceOperationMask: NSDragOperation { [.copy, .move, .generic, .link] }
  var draggingLocation: NSPoint { loc }
  var draggedImageLocation: NSPoint { loc }
  var draggedImage: NSImage? { nil }
  var draggingPasteboard: NSPasteboard { NSPasteboard(name: .drag) }
  var draggingSource: Any? { src }
  var draggingSequenceNumber: Int { 1 }
  func slideDraggedImage(to screenPoint: NSPoint) {}
  override func namesOfPromisedFilesDropped(atDestination dropDestination: URL) -> [String]? { nil }
  var draggingFormation: NSDraggingFormation = .default
  var animatesToDestination: Bool = false
  var numberOfValidItemsForDrop: Int = 1
  func enumerateDraggingItems(
    options enumOpts: NSDraggingItemEnumerationOptions = [], for view: NSView?,
    classes classArray: [AnyClass], searchOptions: [NSPasteboard.ReadingOptionKey: Any] = [:],
    using block: (NSDraggingItem, Int, UnsafeMutablePointer<ObjCBool>) -> Void
  ) {}
  var springLoadingHighlight: NSSpringLoadingHighlight { .none }
  func resetSpringLoading() {}
}

let env = ProcessInfo.processInfo.environment
func need(_ k: String) -> String {
  guard let v = env[k], !v.isEmpty else {
    print("HARNESS missing \(k)")
    exit(2)
  }
  return v
}
let url = URL(string: need("PROBE_URL"))!
let mode = env["PROBE_MODE"] ?? "page"
let W = 1280.0
let H = 800.0

// WebKit asks a view to begin the dragging session (the modern call or the legacy one): record it, start none.
var dragStarted = false
var dragSource: AnyObject?
let beginBlock: @convention(block) (AnyObject, NSArray, NSEvent, AnyObject) -> AnyObject? = { _, _, _, source in
  dragStarted = true
  dragSource = source
  return nil
}
let legacyBlock:
  @convention(block) (AnyObject, AnyObject?, NSPoint, NSSize, NSEvent?, AnyObject?, AnyObject?, Bool) -> Void = {
    _, _, _, _, _, _, source, _ in
    dragStarted = true
    dragSource = source
  }
let beginSel = #selector(NSView.beginDraggingSession(with:event:source:))
let legacySel = NSSelectorFromString("dragImage:at:offset:event:pasteboard:source:slideBack:")
for cls in [NSView.self, WKWebView.self] as [AnyClass] {
  if let m = class_getInstanceMethod(cls, beginSel) { method_setImplementation(m, imp_implementationWithBlock(beginBlock)) }
  if let m = class_getInstanceMethod(cls, legacySel) { method_setImplementation(m, imp_implementationWithBlock(legacyBlock)) }
}
if let m = class_getInstanceMethod(NSWindow.self, legacySel) { method_setImplementation(m, imp_implementationWithBlock(legacyBlock)) }

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let win = NSWindow(
  contentRect: NSRect(x: 40, y: 40, width: W, height: H), styleMask: [.titled], backing: .buffered, defer: false)
// floating: a covered WKWebView is throttled (timers, rAF), which would stall the studio mid-run
win.level = .floating
let cfg = WKWebViewConfiguration()
cfg.websiteDataStore = .nonPersistent()
let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: W, height: H), configuration: cfg)
win.contentView = wv
win.orderFrontRegardless()
wv.load(URLRequest(url: url))

func spin(_ s: Double) { RunLoop.current.run(until: Date().addingTimeInterval(s)) }
func js(_ code: String) -> String {
  var out: String?
  var done = false
  wv.evaluateJavaScript(code) { r, e in
    if let e = e { out = "ERR \(e.localizedDescription)" } else if let r = r { out = "\(r)" } else { out = "null" }
    done = true
  }
  let t = Date().addingTimeInterval(10)
  while !done && Date() < t { spin(0.02) }
  return out ?? "TIMEOUT"
}
func until(_ cond: String, _ secs: Double) -> Bool {
  let t = Date().addingTimeInterval(secs)
  while Date() < t {
    if js("(() => { try { return !!(\(cond)) ? 'yes' : 'no' } catch (e) { return 'no' } })()") == "yes" { return true }
    spin(0.25)
  }
  return false
}
func point(_ code: String) -> NSPoint? {
  let s = js("JSON.stringify((() => { \(code) })())")
  guard let d = s.data(using: .utf8), let a = try? JSONSerialization.jsonObject(with: d) as? [Double], a.count == 2
  else { return nil }
  return NSPoint(x: a[0], y: a[1])
}
func winPoint(_ p: NSPoint) -> NSPoint { wv.convert(NSPoint(x: p.x, y: wv.isFlipped ? p.y : H - p.y), to: nil) }
func mouse(_ type: NSEvent.EventType, _ p: NSPoint) {
  let e = NSEvent.mouseEvent(
    with: type, location: winPoint(p), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
    windowNumber: win.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
    pressure: type == .leftMouseUp ? 0 : 1)!
  switch type {
  case .leftMouseDown: wv.mouseDown(with: e)
  case .leftMouseDragged: wv.mouseDragged(with: e)
  default: wv.mouseUp(with: e)
  }
}
func done(_ code: Int32, _ fields: [String: Any]) -> Never {
  var f = fields
  f["log"] = js(env["PROBE_LOG_JS"] ?? "JSON.stringify(window.__probeLog || [])")
  let d = try! JSONSerialization.data(withJSONObject: f)
  print("RESULT " + String(data: d, encoding: .utf8)!)
  exit(code)
}

if !until("document.readyState === 'complete'", 30) { done(2, ["stage": "load"]) }
if let setup = env["PROBE_SETUP_JS"] { _ = js("(async () => { \(setup) })(); 'ok'") }
if !until(env["PROBE_READY_JS"] ?? "true", 60) { done(2, ["stage": "ready"]) }
spin(0.5)
guard let from = point(need("PROBE_FROM_JS")), let to = point(need("PROBE_TO_JS")) else { done(2, ["stage": "points"]) }

let info = DragInfo()
info.win = win
if mode == "file" {
  // a drag from outside the page (Finder): the file is on the drag pasteboard, no page started it
  let pb = NSPasteboard(name: .drag)
  pb.clearContents()
  pb.writeObjects([NSURL(fileURLWithPath: need("PROBE_FILE"))])
  dragStarted = true
} else {
  mouse(.leftMouseDown, from)
  spin(0.05)
  for i in 1...10 where !dragStarted {
    mouse(.leftMouseDragged, NSPoint(x: from.x + Double(i) * 2, y: from.y + Double(i) * 2))
    spin(0.04)
  }
  let t0 = Date().addingTimeInterval(3)
  while !dragStarted && Date() < t0 { spin(0.05) }
  if !dragStarted {
    mouse(.leftMouseUp, from)
    done(3, ["stage": "drag-start", "dragStarted": false])
  }
  info.src = dragSource
}
let types = NSPasteboard(name: .drag).types?.map { $0.rawValue } ?? []
info.loc = winPoint(mode == "file" ? to : from)
var op = wv.draggingEntered(info)
spin(0.1)
let steps = 16
for i in 1...steps {
  let p = NSPoint(
    x: from.x + (to.x - from.x) * Double(i) / Double(steps), y: from.y + (to.y - from.y) * Double(i) / Double(steps))
  info.loc = winPoint(mode == "file" ? to : p)
  op = wv.draggingUpdated(info)
  spin(0.06)
}
// let the page answer the last dragover (the ring, the drop effect) before it is let go
for _ in 0..<4 {
  spin(0.15)
  op = wv.draggingUpdated(info)
}
let accepted = op.rawValue
let prepared = wv.prepareForDragOperation(info)
let performed = wv.performDragOperation(info)
spin(0.2)
wv.concludeDragOperation(info)
if mode != "file" {
  // the source learns how the drag ended (dragend)
  let endSel = NSSelectorFromString("draggingSession:endedAtPoint:operation:")
  if wv.responds(to: endSel) {
    typealias End = @convention(c) (AnyObject, Selector, AnyObject?, NSPoint, UInt) -> Void
    unsafeBitCast(wv.method(for: endSel), to: End.self)(wv, endSel, nil, info.loc, UInt(accepted))
  }
}
spin(Double(env["PROBE_SETTLE_S"] ?? "2.5") ?? 2.5)
done(0, [
  "stage": "dropped", "pasteboardTypes": types, "acceptedOperation": accepted, "prepared": prepared,
  "performed": performed, "from": [from.x, from.y], "to": [to.x, to.y],
])
