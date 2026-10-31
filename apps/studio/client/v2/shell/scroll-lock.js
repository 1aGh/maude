// client/v2/shell/scroll-lock.js — rc.1 finding 20: the shell never scrolls.
//
// The window is one fixed stage: the strip, the pill, the islands and the canvas are positioned in it, and only
// the panels scroll INSIDE themselves. `overflow: hidden` stops the person's wheel but not a program — a focus()
// or scrollIntoView() on something past the edge, a selection drag's autoscroll, find-in-page — so the whole UI
// could end up scrolled up under the tab bar with no way back (Michal's picture 18).
//
// CSS handles the shell root (`overflow: clip`, which is not a scroll container at all); the document itself can
// still be scrolled by script (the viewport treats `clip` as `hidden`), so this puts it back. Scroll events do
// not bubble, but they DO reach a capturing window listener: one listener covers the document, `body`, `.maude`
// and `.sh-shell`. Nothing in the app scrolls those on purpose, so any non-zero offset on them is the bug.

const SHELL_SELECTOR = '.sh-shell, .maude';

/** Put every shell-level scroll offset back to 0. Returns true when something had moved. */
export function resetShellScroll(doc = document) {
  let moved = false;
  const root = doc.scrollingElement || doc.documentElement;
  for (const el of [root, doc.documentElement, doc.body, ...doc.querySelectorAll(SHELL_SELECTOR)]) {
    if (!el) continue;
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
      moved = true;
    }
  }
  return moved;
}

/** Is `target` one of the elements that must never scroll (the document or the shell's own roots)? */
function isShellRoot(target, doc) {
  if (!target) return false;
  if (target === doc || target === doc.documentElement || target === doc.body) return true;
  return typeof target.matches === 'function' && target.matches(SHELL_SELECTOR);
}

/**
 * Install the guard on `doc`; returns the uninstall. Idempotent per document.
 */
export function installShellScrollLock(doc = document) {
  const win = doc.defaultView;
  if (!win) return () => {};
  const on = (e) => {
    if (isShellRoot(e.target, doc)) resetShellScroll(doc);
  };
  win.addEventListener('scroll', on, { capture: true, passive: true });
  resetShellScroll(doc);
  return () => win.removeEventListener('scroll', on, { capture: true });
}
