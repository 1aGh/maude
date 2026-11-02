// client/v2/preview/preview-back.js — S3.10a: the one runner behind registry `preview.back`.
//
// The mounted Preview chrome (preview-chrome-host.jsx) registers its back; the menu runner, ⌘K and the
// PreviewBar's "‹ Homepage" button all call `runPreviewBack()`. Nothing mounted, or nothing on the stack,
// means nothing happens. A leaf module on purpose: the menu runner imports it without pulling in the shell.

/** @type {null | (() => unknown)} */
let runBack = null;

export function setPreviewBack(fn) {
  runBack = fn;
}

/** Removes only what `fn` set, so a late unmount never clears a newer host. */
export function clearPreviewBack(fn) {
  if (runBack === fn) runBack = null;
}

export function runPreviewBack() {
  return runBack ? runBack() : null;
}
