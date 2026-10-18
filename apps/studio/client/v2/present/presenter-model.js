// client/v2/present/presenter-model.js — S3.6b: the pure half of the presenter view (04 md-presenter).
//
// The Mac's screen while the audience sees the artboard on the second display: Now / Next / Notes, the
// clock, and the run drawn as the canvas itself. Everything here is DOM-free so the tests (and the
// component) share one answer to "which cell is which number".
//
// Inputs are the canvas's artboards IN CANVAS ORDER with their world rects (`{ id, label, x, y, w, h }`),
// and what `.meta.json` keeps for Present (`{ present: { order, skip }, notes }`, S3.5). The order
// Present plays is `order-notes-model.js`'s `initialModel` — the same one the "Order and notes…" sheet
// edits and `present/order.ts` plays — so the numbers here never disagree with the counter.

import { initialModel, runNumbers } from './order-notes-model.js';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** "12:48" — time since Present started; "1:02:03" past an hour. A bad number is "0:00". */
export function elapsedText(ms) {
  const total = finite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "14:05" — the wall clock, 24-hour; nothing for a bad date. */
export function wallText(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const two = (n) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

const hasRect = (a) =>
  finite(a?.x) && finite(a?.y) && finite(a?.w) && finite(a?.h) && a.w > 0 && a.h > 0;

/** A canvas that reported no layout (or a broken one): a plain grid, 16:10 cells, in canvas order. */
function gridRects(list) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
  return list.map((a, i) => ({
    ...a,
    x: (i % cols) * 176,
    y: Math.floor(i / cols) * 116,
    w: 160,
    h: 100,
  }));
}

/**
 * The order map's cells, normalised to the layout's top-left, plus the size of the whole layout.
 * @param {{ id: string, label?: string, x?: number, y?: number, w?: number, h?: number }[]} artboards
 *        canvas order
 * @param {{ present?: object | null, notes?: Record<string, string> } | null} saved
 * @param {string | null} currentId the presented artboard
 * @returns {{ cells: Cell[], width: number, height: number, run: string[], total: number, skipped: number }}
 *   Cell = { id, label, x, y, w, h, n: number | null, skipped, current }
 */
export function orderCells(artboards, saved, currentId = null) {
  const model = initialModel(artboards ?? [], saved ?? {});
  const byId = new Map((artboards ?? []).map((a) => [a?.id, a]));
  const known = model.rows.map((r) => byId.get(r.id)).filter(Boolean);
  const placed = known.every(hasRect) && known.length > 0 ? known : gridRects(known);
  const rect = new Map(placed.map((a) => [a.id, a]));
  const numbers = runNumbers(model);
  const anchorX = placed.length ? Math.min(...placed.map((a) => a.x)) : 0;
  const anchorY = placed.length ? Math.min(...placed.map((a) => a.y)) : 0;
  let width = 0;
  let height = 0;
  const cells = model.rows
    .filter((r) => rect.has(r.id))
    .map((r) => {
      const a = rect.get(r.id);
      const x = a.x - anchorX;
      const y = a.y - anchorY;
      width = Math.max(width, x + a.w);
      height = Math.max(height, y + a.h);
      return {
        id: r.id,
        label: r.label,
        x,
        y,
        w: a.w,
        h: a.h,
        n: numbers.get(r.id) ?? null,
        skipped: r.skipped,
        current: r.id === currentId,
      };
    });
  const run = model.rows.filter((r) => !r.skipped).map((r) => r.id);
  return {
    cells,
    width,
    height,
    run,
    custom: model.custom,
    total: model.rows.length,
    skipped: model.rows.filter((r) => r.skipped).length,
    notes: new Map(model.rows.map((r) => [r.id, r.notes])),
  };
}

/** "Order · 15 artboards · 1 skipped" (the order map's caption). */
export function orderCaption(total, skipped) {
  const head = `Order · ${total} ${total === 1 ? 'artboard' : 'artboards'}`;
  return skipped ? `${head} · ${skipped} skipped` : head;
}

/**
 * Where the presenter is, and what comes next.
 * @param run the run's ids, in play order (skipped ones left out)
 * @param position `{ index, artboardId }` from `present-position`
 * @returns {{ at: number, nowId: string | null, nextId: string | null }}
 *   `at` is the 0-based place in the run (the artboard's own place wins over a stale index)
 */
export function nowAndNext(run, position) {
  if (!position || !run.length) return { at: -1, nowId: null, nextId: null };
  const byId = typeof position.artboardId === 'string' ? run.indexOf(position.artboardId) : -1;
  const at = byId >= 0 ? byId : Number.isInteger(position.index) ? position.index : -1;
  const nowId = run[at] ?? null;
  return { at, nowId, nextId: nowId === null ? null : (run[at + 1] ?? null) };
}

/** Speaker notes as paragraphs: one per non-empty line. Text only — the caller never sets HTML. */
export function noteParagraphs(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The part of `.meta.json` the presenter view reads, in the shape `orderCells` takes.
 * @returns {{ present: object | null, notes: Record<string, string> }}
 */
export function savedFromMeta(meta) {
  const present =
    meta && typeof meta.present === 'object' && !Array.isArray(meta.present) ? meta.present : null;
  const notes = {};
  const am = meta?.artboardMeta;
  if (am && typeof am === 'object')
    for (const [id, v] of Object.entries(am))
      if (v && typeof v.notes === 'string' && v.notes) notes[id] = v.notes;
  return { present, notes };
}

/** What the top bar says about the audience screen. */
export function audienceLine(audience) {
  const name = audience?.displayName ? ` on ${audience.displayName}` : '';
  if (audience?.status === 'failed')
    return audience.message || `Couldn’t open the audience screen${name}.`;
  if (audience?.status === 'opening' || audience?.status === 'waiting')
    return `Opening the audience screen${name}…`;
  return `Audience${name}`;
}
