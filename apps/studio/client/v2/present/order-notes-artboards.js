// client/v2/present/order-notes-artboards.js — V2-5 A4 (S3.5 mount): the artboards the "Order and notes…"
// sheet lists, in CANVAS order (order-notes-model.js takes them that way and never re-derives it).
//
// The shell has no live artboard rects (they live in the canvas iframe, DDR-054), so it orders what the
// project knows: the index row's artboards (complete — a dynamic canvas's runtime harvest included) and
// the stored positions in the canvas `.meta.json` (`layout.artboards[] {id, x, y}`). When EVERY artboard
// has a stored position, the order is present/order.ts `canvasOrder` over those rects — the same rule
// Present plays by. Otherwise the canvas is (at least partly) auto-laid, and the auto grid fills row by
// row in declared order, so the declared order IS the canvas order.

import { canvasOrder } from '../../../present/order.ts';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * @param {{ indexRow?: { artboards?: Array<{ id: string, label?: string | null, w?: number | null, h?: number | null }> } | null,
 *           meta?: { artboards?: Array<{ id?: unknown, label?: unknown }>, layout?: { artboards?: Array<{ id?: unknown, x?: unknown, y?: unknown, width?: unknown, height?: unknown }> } } | null }} src
 * @returns {Array<{ id: string, label: string }>}
 */
export function orderNotesArtboards({ indexRow = null, meta = null } = {}) {
  const metaBoards = Array.isArray(meta?.artboards) ? meta.artboards : [];
  const metaLabel = new Map(
    metaBoards.filter((a) => a && typeof a.id === 'string').map((a) => [a.id, text(a.label)])
  );
  const fromIndex = Array.isArray(indexRow?.artboards) ? indexRow.artboards : [];
  const declared = (fromIndex.length ? fromIndex : metaBoards)
    .filter((a) => a && typeof a.id === 'string' && a.id)
    .map((a) => ({
      id: a.id,
      label: text(a.label) ?? metaLabel.get(a.id) ?? a.id,
      w: finite(a.w) ? a.w : null,
      h: finite(a.h) ? a.h : null,
    }));
  const seen = new Set();
  const list = declared.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  const stored = new Map();
  for (const p of Array.isArray(meta?.layout?.artboards) ? meta.layout.artboards : []) {
    if (p && typeof p.id === 'string' && finite(p.x) && finite(p.y)) stored.set(p.id, p);
  }
  const out = (ids) => {
    const byId = new Map(list.map((a) => [a.id, a]));
    return ids.map((id) => byId.get(id)).map((a) => ({ id: a.id, label: a.label }));
  };
  if (list.length === 0 || !list.every((a) => stored.has(a.id))) return out(list.map((a) => a.id));
  const rects = list.map((a) => {
    const p = stored.get(a.id);
    return {
      id: a.id,
      x: p.x,
      y: p.y,
      w: finite(p.width) ? p.width : (a.w ?? 0),
      h: finite(p.height) ? p.height : (a.h ?? 0),
    };
  });
  return out(canvasOrder(rects));
}

/** The index row for a repo-relative canvas path (`.design/ui/a.tsx` → row `ui/a.tsx`). */
export function indexRowFor(snapshot, path) {
  const designRel = snapshot?.project?.designRel;
  if (!path || !Array.isArray(snapshot?.canvases)) return null;
  const rel =
    designRel && path.startsWith(`${designRel}/`) ? path.slice(designRel.length + 1) : path;
  return snapshot.canvases.find((c) => c?.rel === rel) ?? null;
}

/** Read both sources once per open. Resolves to the sheet's `artboards` (never throws). */
export async function loadOrderNotesArtboards(path, fetchImpl = (...a) => fetch(...a)) {
  const json = async (url) => {
    try {
      const r = await fetchImpl(url, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const [meta, snapshot] = await Promise.all([
    json(`/_api/canvas-meta?file=${encodeURIComponent(path)}`),
    json('/_api/index'),
  ]);
  return orderNotesArtboards({ indexRow: indexRowFor(snapshot, path), meta });
}
