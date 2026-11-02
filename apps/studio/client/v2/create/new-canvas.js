// client/v2/create/new-canvas.js — S6.1: ⌘N (File ▸ New canvas) makes a blank canvas and opens it.
//
// One function for every door onto `canvas.new` — the ⌘N key, the menu row, the ⌘K row, the Canvases panel's
// "+ New canvas" — so they cannot drift. With no `name` the server names it (C4: "Untitled canvas", " 2", …) and
// it is one local POST; the panel row asks for the name in place FIRST and passes it, so the file is written
// once, under its final name (a rename afterwards re-keys the slug sidecars, DDR-198). `sizes: true` is the
// R2-P2 rule (TD2): a new canvas opens with the size picker up. The brief canvas keeps its own door,
// `canvas.new-brief`. R3 (6): the person's own doors ask for the name first, in a dialog (`openNewCanvasDialog`).

import { currentNewCanvasDs } from '../ds/new-canvas-default.js';
import { dispatchCanvasOp } from '../left-panel/left-panel-bus.js';
import { requestNameDialog } from './name-dialog-bus.js';
import { requestSizePicker } from './open-sizes.js';

/** The line when the POST fails: what happened · what is safe · one verb (CONTRACT §4). */
export const NEW_CANVAS_FAILED = 'Could not make a canvas. Nothing was changed. Try again.';

/**
 * POST a blank canvas and open it.
 * @param {{ fetchImpl?: typeof fetch, open?: (file: string) => void, toast?: (message: string) => void,
 *           fromPrompt?: string, designSystem?: string, name?: string, sizes?: boolean }} [deps]
 * @returns {Promise<{ ok: true, file: string } | { ok: false, error: string }>}
 */
export async function createBlankCanvas(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const open = deps.open ?? ((file) => dispatchCanvasOp('open', file));
  const body = deps.fromPrompt ? { kind: 'blank', fromPrompt: deps.fromPrompt } : { kind: 'blank' };
  if (deps.name) body.name = deps.name;
  // S10.13 — the system its folder passes on (else none: the server uses the project's default)
  const designSystem = deps.designSystem ?? currentNewCanvasDs();
  if (designSystem) body.designSystem = designSystem;
  try {
    const r = await fetchImpl('/_api/canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || typeof j.file !== 'string') {
      deps.toast?.(NEW_CANVAS_FAILED);
      return { ok: false, error: j.error || `create failed (${r.status})` };
    }
    open(j.file);
    if (deps.sizes) requestSizePicker(j.file);
    return { ok: true, file: j.file };
  } catch (e) {
    deps.toast?.(NEW_CANVAS_FAILED);
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

/**
 * R3 (6): every door onto `canvas.new` that is a person's own pick (⌘K, ⌘N, the menu, the panel's "+") asks for the
 * name in a small centered dialog straight away — it used to make "Untitled canvas" at once, or (the brief) open an
 * input in the left panel that nobody saw. The dialog's Create is what calls `createBlankCanvas`.
 */
export function openNewCanvasDialog(target) {
  requestNameDialog({ kind: 'canvas', ...(target ? { target } : {}) });
}

/** `canvas.new-brief` ("New brief canvas"), what `canvas.new` did in v1: the same dialog, then the brief is stamped. */
export function openBriefBoardComposer(_d) {
  requestNameDialog({ kind: 'brief' });
}
