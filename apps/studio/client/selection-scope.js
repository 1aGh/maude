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

/**
 * S8.2 — what the Export sheet needs to know about the selection, scoped to the active canvas:
 * `hasSelection` (nothing selected → ⇧⌘E exports This canvas), the selected DCArtboard ids, and the V2-1.4
 * element ids (a selected element carries `id`; a bare artboard selection has `artboardId` and no `id`).
 */
export function exportSelectionV2(selected, activePath) {
  const list = (Array.isArray(selected) ? selected : [selected]).filter(
    (s) => s && s.file === activePath
  );
  const artboards = [];
  const elements = [];
  for (const s of list) {
    if (s.id) elements.push(String(s.id));
    else if (s.artboardId && !artboards.includes(s.artboardId))
      artboards.push(String(s.artboardId));
  }
  return {
    hasSelection: list.length > 0,
    selectedArtboards: artboards,
    selectedElements: elements,
  };
}

/**
 * S2.22 G4/G6 — what the shell holds after the canvas's `select-set`: nothing, the one object (with the
 * canvas's crumbs / kind / refs when `described` adds them) or, for several, the WHOLE list. The inspector reads
 * that list to say "4 artboards · Mixed … Changes go to all 4."; keeping only the head hid every multi-selection.
 */
export function shellSelectionOf(payload, described = (s) => s) {
  if (payload == null) return null;
  if (!Array.isArray(payload)) return described(payload);
  if (payload.length === 0) return null;
  if (payload.length === 1) return described(payload[0]);
  return payload;
}

/** How long after a reload the shell waits before it puts the selection back: the canvas's own select of what it just
 *  made (a drawing, a paste — `selectWhenRendered` polls every 100 ms) goes first, so the restore never clobbers it. */
export const RESTORE_LEAD_MS = 250;

const SCREEN_SELECTOR = /^\[data-dc-screen="([^"]+)"\]$/;

/** Is `sel` the whole-artboard selection of `artboardId` on `file`? The server's echo drops `artboardId`, so the
 *  `[data-dc-screen="…"]` selector is the identity that survives it. */
export function isArtboardSelectionOf(sel, artboardId, file) {
  if (!sel || !artboardId || (sel.file && sel.file !== file) || sel.id) return false;
  return sel.artboardId === artboardId || sel.selector === `[data-dc-screen="${artboardId}"]`;
}

/**
 * S2.22 G2 — what to re-select once a canvas has (re)loaded after a write. An element goes back by its id; a
 * whole artboard (no id) by its name — a resize, a kind or a style write reloads the canvas, and the selection
 * must still be on the board afterwards, with its new size.
 * @returns {{ kind: 'element', sel: any } | { kind: 'artboard', artboardId: string, file: string } | null}
 */
export function restoreAfterLoad(selected, file) {
  const sel = Array.isArray(selected) ? selected[0] : selected;
  // S2.23 G1 — the canvas's own `select-set` carries no `file` (the shell knows which canvas it is): a selection
  // without one belongs to the canvas that just loaded, and goes back like one that names it.
  if (!sel || (sel.file && sel.file !== file)) return null;
  if (sel.id) return { kind: 'element', sel: sel.file ? sel : { ...sel, file } };
  const artboardId = sel.artboardId || SCREEN_SELECTOR.exec(sel.selector || '')?.[1] || null;
  return artboardId ? { kind: 'artboard', artboardId, file } : null;
}

/**
 * S2.24 G2 — the `select-by-id` message that puts `selected` back on the canvas of `file`, or null when there is
 * nothing to put back. A list of several is left alone: the canvas holds all of it, and one id would collapse it.
 */
export function restorePostOf(selected, file) {
  if (Array.isArray(selected) && selected.length > 1) return null;
  const back = restoreAfterLoad(selected, file);
  if (!back) return null;
  if (back.kind === 'artboard') return { dgn: 'select-by-id', artboardId: back.artboardId };
  return {
    dgn: 'select-by-id',
    id: back.sel.id,
    artboardId: back.sel.artboardId ?? null,
    index: back.sel.index ?? 0,
  };
}

/** The rungs after the first: a fresh iframe mounts its listener 100 ms .. seconds after `loaded`. */
const RESTORE_RUNGS_MS = [450, 1200, 2500, 5000];

/**
 * S2.24 G2/G1 — put the selection back on a canvas that just reloaded or was just written to, on a retry ladder,
 * reading the selection WHEN EACH RUNG FIRES. Deciding at `loaded` time lost the drawn rectangle: the old tree
 * flushes its `select-set` a beat after the new tree's `loaded`, so a restore planned for the board was dropped
 * as superseded and the canvas never drew a selection on the shape the inspector showed. Posting is idempotent
 * (the canvas answers a repeat with the same selection and does not move the camera).
 * @returns {() => void} cancel
 */
export function startSelectionRestore({
  file,
  lead = RESTORE_LEAD_MS,
  getSelected,
  post,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h) },
}) {
  const handles = [lead, ...RESTORE_RUNGS_MS].map((ms) =>
    timers.set(() => {
      const msg = restorePostOf(getSelected(), file);
      if (msg) post(msg);
    }, ms)
  );
  return () => {
    for (const h of handles) timers.clear(h);
  };
}
