// client/v2/shell/canvas-pointer.js — rc3 r4-12: "a press landed in the canvas", as a shell-window event.
//
// The canvas iframe (another origin, DDR-054) posts `{dgn:'canvas-pointerdown'}` on every press
// (editing/canvas-pointer.ts); the shell's canvas bridge accepts it from the active canvas only (the dgn table's
// `active` gate) and calls `announceCanvasPointer()`. Anything in the shell that closes on "a click anywhere
// else" listens with `onCanvasPointer` — use-dismiss-outside.js does, so every menu built on it closes on a
// click into the canvas even where the shell window gets no blur for it (WebKit, the packaged app).

export const CANVAS_POINTER_EVENT = 'maude:canvas-pointerdown';

/** Tell the shell's listeners that a press landed in the canvas. */
export function announceCanvasPointer(win = typeof window === 'undefined' ? null : window) {
  win?.dispatchEvent(new Event(CANVAS_POINTER_EVENT));
}

/** Run `fn` on each press in the canvas. Returns the unsubscribe. */
export function onCanvasPointer(fn, win = typeof window === 'undefined' ? null : window) {
  if (!win) return () => {};
  win.addEventListener(CANVAS_POINTER_EVENT, fn);
  return () => win.removeEventListener(CANVAS_POINTER_EVENT, fn);
}
