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

/** Is this incoming `selected` frame the echo of our own recent select (to be dropped)?
 *  `local` = `{ at, sel, file }`: what THIS shell selected (or cleared), when, and on which canvas
 *  file — recorded at the select itself, because the rendered selection lags the server's
 *  loopback echo. Inside the window everything about the SAME canvas is dropped, exactly as v1
 *  did (an echo of an older select must not overwrite a newer drill or multi-select). Only a
 *  frame about ANOTHER canvas applies (the restore that follows a canvas switch), and so does a
 *  null after a non-null select of ours (a canvas with nothing parked; our select was never null). */
export function isOwnSelectEcho(incoming, local, now = Date.now()) {
  if (!local || now - local.at >= 2000) return false;
  const one = first(incoming);
  if (one == null) return first(local.sel) == null;
  return one.file === local.file;
}

/** The `local` record for a select (or clear) THIS shell just made on `activePath`. */
export function localSelectRecord(sel, activePath, now = Date.now()) {
  return { at: now, sel: sel ?? null, file: first(sel)?.file ?? activePath ?? null };
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
