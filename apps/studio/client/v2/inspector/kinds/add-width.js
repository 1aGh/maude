// client/v2/inspector/kinds/add-width.js — S7.21 (08 ak-web-widths): the toast after "Add a width".
//
// The inspector's "Add a width" asks the OPEN CANVAS to run `artboard.duplicate-at-width` (the canvas knows where
// the boards stand, so the copies land beside the source at the row's gap and nothing else moves — S2.10). The
// canvas's write reaches the server through the shell (`edit-op`, use-canvas-bridge.jsx), which is the one place
// that sees the answer. So the inspector files what it asked for here, and the bridge settles it when that write
// comes back:
//
//   expectAddedWidths({ artboardId, widths, sourceWord, undo })   the inspector, just before it asks
//   settleAddedWidths(body, result) → { message, action } | null  the bridge, with the edit-op request and its answer
//
// An answer that is not one the inspector asked for (the artboard menu's "Duplicate at another width ▸") settles to
// null — it keeps today's silence. A refusal drops the expectation (the canvas already said why).

import { addedWidthsWords } from './artboard-kinds-model.js';

const TTL_MS = 15_000;
/** @type {Array<{ artboardId: string, widths: number[], sourceWord: string, undo?: () => void, at: number }>} */
let pending = [];

const fresh = (now) => pending.filter((p) => now - p.at < TTL_MS);

/** The inspector is about to ask for copies of `artboardId` at `widths`. */
export function expectAddedWidths(p, now = Date.now()) {
  pending = [...fresh(now), { ...p, widths: [...p.widths], at: now }].slice(-8);
}

const sameWidths = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);

/**
 * @param {{ op?: string, params?: { items?: Array<{ artboard?: string, width?: number }> } }} body  the edit-op request
 * @param {{ ok?: boolean }} result  its answer
 * @returns {{ message: string, action?: { label: string, onClick: () => void } } | null}
 */
export function settleAddedWidths(body, result, now = Date.now()) {
  if (body?.op !== 'artboard.duplicate-at-width') return null;
  const items = body.params?.items ?? [];
  const id = items[0]?.artboard;
  const widths = items.map((i) => i?.width);
  const live = fresh(now);
  const hit = live.find((p) => p.artboardId === id && sameWidths(p.widths, widths));
  if (!hit) return null;
  pending = live.filter((p) => p !== hit);
  if (!result?.ok) return null;
  const message = addedWidthsWords(hit.widths, hit.sourceWord);
  return hit.undo
    ? { message, action: { label: 'Undo', onClick: () => hit.undo?.() } }
    : { message };
}

/** Tests only. */
export const pendingAddedWidths = () => pending.length;
export function resetAddedWidths() {
  pending = [];
}
