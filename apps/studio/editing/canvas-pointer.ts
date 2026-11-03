// editing/canvas-pointer.ts — rc3 r4-12: the canvas tells the shell "a press landed in me", so the shell's open
// menus close on a click into the canvas.
//
// The canvas is an iframe on another origin (DDR-054): a press in it never reaches the shell document. Chromium
// moves focus into the iframe and so blurs the shell window, which the shell's menus listened for; WebKit (the
// packaged app's WKWebView) does not move focus on a press that lands on nothing focusable, so no blur arrives
// and a left-panel menu stayed open until esc. This notice is the door that does not depend on focus.
//
// The press itself is untouched: the listener is passive, in the capture phase (a handler that stops the event
// cannot hide it) and never prevents anything, so the click still selects what it was meant to. One notice per
// press, no payload — the shell only learns that a press happened (`canvas-pointerdown` in the dgn table).

/** The canvas → shell notice: a press landed in this canvas. */
export function sendCanvasPointerDown(win: Window): void {
  try {
    if (win.parent && win.parent !== win)
      win.parent.postMessage({ dgn: 'canvas-pointerdown' }, '*');
  } catch {
    /* detached */
  }
}

/** Listen for presses in `win` and tell the shell about each. Returns the cleanup. */
export function installCanvasPointerNotice(win: Window): () => void {
  if (!win.parent || win.parent === win) return () => {};
  const onDown = () => sendCanvasPointerDown(win);
  win.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  return () => win.removeEventListener('pointerdown', onDown, { capture: true });
}
