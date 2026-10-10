// selection-scope.js — which selection belongs to which canvas (V2-2.8 P2).
//
// The shell keeps ONE `selected` value while the person switches canvases, so two consumers must
// ask "is this selection about the canvas I am looking at?":
//   • the server's `selected` restore after our own select: an ECHO is only a restore for the
//     same canvas file — a restore for another canvas (or none, after a switch) must apply, or the
//     previous canvas's selection stays in the shell;
//   • the Export dialog: it may scope to the selected artboard/element only when that selection is
//     on the active canvas — otherwise Export targeted the previous canvas's artboard.

const first = (sel) => (Array.isArray(sel) ? sel[0] : sel) ?? null;

/** Is this incoming `selected` frame the echo of our own recent select (to be dropped)? */
export function isOwnSelectEcho(incoming, previous, lastLocalSelectAt, now = Date.now()) {
  if (now - lastLocalSelectAt >= 2000) return false;
  const one = first(incoming);
  const prev = first(previous);
  return one != null && prev != null && one.file === prev.file;
}

/** The Export dialog's selection inputs, scoped to the active canvas. */
export function exportSelectionFor(selected, activePath, canvasActiveArtboard) {
  const sel = first(selected);
  const onActive = sel != null && sel.file === activePath;
  return {
    activeArtboardId: (onActive ? sel.artboardId : null) ?? canvasActiveArtboard ?? null,
    selection: onActive && sel.selector ? { selector: sel.selector, file: sel.file } : null,
  };
}
