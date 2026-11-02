// client/v2/present/order-notes-model.js — S3.5: the "Order and notes…" sheet's model (CONTRACT §6
// [C31], S3-present-session §7). PURE.
//
// The sheet edits three things the canvas `.meta.json` keeps: the Present order (`present.order`, or
// none = canvas order), the skipped artboards (`present.skip`) and each artboard's speaker notes
// (`artboardMeta.<id>.notes`). It reads them back from `PATCH /_api/present-meta {file}` and saves
// only what changed, so a save that touched one note sends one note.
//
// `artboards` come in CANVAS order (row by row, left to right — the caller's, from the live rects or
// the canvas's own order); this model never re-derives it. The stored order is applied over it the way
// Present applies it (present/order.ts `presentRun`): ids the order names first, every other artboard
// after them in canvas order, ids the canvas no longer has dropped. So "Use canvas order" is always one
// press away and a new artboard added after the order was set still shows up.

/** The id grammar the sidecar stores (schema `$defs/artboardId`). Others can't be ordered or noted. */
export const STORABLE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_NOTE = 20000;

/**
 * @typedef {{ id: string, label?: string | null }} Artboard
 * @typedef {{ order?: string[] | null, skip?: string[] | null } | null} StoredPresent
 * @typedef {{ id: string, label: string, skipped: boolean, notes: string, storable: boolean }} Row
 * @typedef {{ rows: Row[], custom: boolean, canvas: string[] }} Model
 */

const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * The sheet's starting rows.
 * @param {Artboard[]} artboards in canvas order
 * @param {{ present?: StoredPresent, notes?: Record<string, string> }} saved what the route answered
 * @returns {Model}
 */
export function initialModel(artboards, saved) {
  const list = (artboards ?? []).filter((a) => a && typeof a.id === 'string' && a.id);
  const seen = new Set();
  const byId = new Map();
  for (const a of list)
    if (!seen.has(a.id)) {
      seen.add(a.id);
      byId.set(a.id, a);
    }
  const canvas = [...byId.keys()];
  const order = ids(saved?.present?.order).filter((id) => byId.has(id));
  const named = new Set(order);
  const ordered = [...order, ...canvas.filter((id) => !named.has(id))];
  const skip = new Set(ids(saved?.present?.skip));
  const notes = saved?.notes && typeof saved.notes === 'object' ? saved.notes : {};
  return {
    canvas,
    custom: order.length > 0,
    rows: ordered.map((id) => ({
      id,
      label: byId.get(id).label || id,
      skipped: skip.has(id),
      notes: typeof notes[id] === 'string' ? notes[id] : '',
      storable: STORABLE_ID.test(id),
    })),
  };
}

const sameOrder = (rows, canvas) =>
  rows.length === canvas.length && rows.every((r, i) => r.id === canvas[i]);

/** Move the row at `from` to `to` (clamped). The order becomes custom unless it lands on canvas order. */
export function moveRow(model, from, to) {
  const n = model.rows.length;
  if (from < 0 || from >= n) return model;
  const at = Math.max(0, Math.min(n - 1, to));
  if (at === from) return model;
  const rows = [...model.rows];
  const [row] = rows.splice(from, 1);
  rows.splice(at, 0, row);
  return { ...model, rows, custom: !sameOrder(rows, model.canvas) };
}

/** Move the row with `id` one step up (−1) or down (+1). */
export function stepRow(model, id, delta) {
  const i = model.rows.findIndex((r) => r.id === id);
  return i < 0 ? model : moveRow(model, i, i + delta);
}

export function toggleSkip(model, id) {
  return {
    ...model,
    rows: model.rows.map((r) => (r.id === id && r.storable ? { ...r, skipped: !r.skipped } : r)),
  };
}

export function setNote(model, id, text) {
  const notes = String(text ?? '').slice(0, MAX_NOTE);
  return {
    ...model,
    rows: model.rows.map((r) => (r.id === id && r.storable ? { ...r, notes } : r)),
  };
}

/** "Use canvas order": rows back in canvas order; skips and notes stay. */
export function toCanvasOrder(model) {
  const byId = new Map(model.rows.map((r) => [r.id, r]));
  return { ...model, custom: false, rows: model.canvas.map((id) => byId.get(id)).filter(Boolean) };
}

/** What the counter line says: "15 artboards · 1 skipped". */
export function countsLine(model) {
  const total = model.rows.length;
  const skipped = model.rows.filter((r) => r.skipped).length;
  const head = `${total} ${total === 1 ? 'artboard' : 'artboards'}`;
  return skipped ? `${head} · ${skipped} skipped` : head;
}

/** The run number of each row (skipped rows have none), as Present counts. */
export function runNumbers(model) {
  let n = 0;
  return new Map(model.rows.map((r) => [r.id, r.skipped ? null : ++n]));
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The PATCH body for what changed between `before` (the sheet's starting model) and `after`, without
 * `file` / `expected` (the hook adds them). Null = nothing to save.
 */
export function patchBody(before, after) {
  const body = {};
  const present = {};
  const order = (m) => (m.custom ? m.rows.filter((r) => r.storable).map((r) => r.id) : []);
  const skips = (m) => m.rows.filter((r) => r.skipped).map((r) => r.id);
  if (!sameList(order(before), order(after))) present.order = after.custom ? order(after) : null;
  const s0 = skips(before);
  const s1 = skips(after);
  if (!sameList([...s0].sort(), [...s1].sort())) present.skip = s1.length ? s1 : null;
  if (Object.keys(present).length) body.present = present;
  const was = new Map(before.rows.map((r) => [r.id, r.notes]));
  const notes = {};
  for (const r of after.rows)
    if (r.storable && (was.get(r.id) ?? '') !== r.notes)
      notes[r.id] = r.notes.trim() ? r.notes : null;
  if (Object.keys(notes).length) body.notes = notes;
  return Object.keys(body).length ? body : null;
}
