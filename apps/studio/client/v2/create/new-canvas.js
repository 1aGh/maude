// client/v2/create/new-canvas.js — S6.1: ⌘N (File ▸ New canvas) makes a blank canvas and opens it.
//
// One function for every door onto `canvas.new` — the ⌘N key, the menu row, the ⌘K row — so they cannot
// drift. The server names it (C4: "Untitled canvas", " 2", …), so there is no composer, no name to type and
// nothing to wait on but one local POST. The brief board keeps its own door, `canvas.new-brief`.

import { currentNewCanvasDs } from '../ds/new-canvas-default.js';
import { dispatchCanvasOp } from '../left-panel/left-panel-bus.js';

/** The line when the POST fails: what happened · what is safe · one verb (CONTRACT §4). */
export const NEW_CANVAS_FAILED = 'Could not make a canvas. Nothing was changed. Try again.';

/**
 * POST a blank canvas and open it.
 * @param {{ fetchImpl?: typeof fetch, open?: (file: string) => void, toast?: (message: string) => void,
 *           fromPrompt?: string, designSystem?: string }} [deps]
 * @returns {Promise<{ ok: true, file: string } | { ok: false, error: string }>}
 */
export async function createBlankCanvas(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const open = deps.open ?? ((file) => dispatchCanvasOp('open', file));
  const body = deps.fromPrompt ? { kind: 'blank', fromPrompt: deps.fromPrompt } : { kind: 'blank' };
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
    return { ok: true, file: j.file };
  } catch (e) {
    deps.toast?.(NEW_CANVAS_FAILED);
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

/** The tree's brief-board composer — `canvas.new-brief` ("New brief board"), what `canvas.new` did in v1. */
export function openBriefBoardComposer(d) {
  d.openPanelExclusive('tree');
  setTimeout(
    () => globalThis.document?.querySelector('[aria-label="New canvas"]')?.click(),
    60
  );
}
