// edit-ops/guides.ts — S7.23 `artboard.set-guides`: an artboard's layout guides (View-only chrome, never exported).
//
//   params { artboard: string, guides: { columns?, rows?, grid? } | null }
//
//   columns / rows  { count: 1–64, gutter: 0–200, margin: 0–2000 }      grid  { size: 2–1000 }
//
// The whole `guides` prop is replaced (a caller sends the merged object); `null` removes it. It is design intent in
// the JSX (DDR-181) and drawn by the canvas only when View › Advanced › Guides is on — the Advanced › Guides row of
// every artboard, and 08 ak-advanced's "Guides + Add". Same result by hand: `canvas-tsx.md` § "Artboard props that
// Maude 2 adds". Registry action: `artboard.set-guides`.

import { applySetArtboardGuides } from '../canvas-edit.ts';
import { ARTBOARD_ID_RE } from './artboard-resize.ts';
import { refuse } from './constraints.ts';
import type { EditOp } from './types.ts';

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const within = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** The guides object as it will be written, or the sentence that says why not. */
export function checkGuides(
  raw: unknown
): { ok: true; guides: Record<string, unknown> } | { ok: false; message: string } {
  if (!isRec(raw)) return { ok: false, message: 'Give the guides as columns, rows or a grid.' };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (key === 'columns' || key === 'rows') {
      const d = raw[key];
      if (
        !isRec(d) ||
        !within(d.count, 1, 64) ||
        !within(d.gutter, 0, 200) ||
        !within(d.margin, 0, 2000)
      )
        return {
          ok: false,
          message: `${key === 'columns' ? 'Columns' : 'Rows'} are 1–64, a gutter of 0–200 and a margin of 0–2000.`,
        };
      out[key] = { count: Math.round(d.count), gutter: d.gutter, margin: d.margin };
    } else if (key === 'grid') {
      const d = raw.grid;
      if (!isRec(d) || !within(d.size, 2, 1000))
        return { ok: false, message: 'A grid is 2–1000 px.' };
      out.grid = { size: d.size };
    } else {
      return { ok: false, message: 'Guides are columns, rows or a grid.' };
    }
  }
  return { ok: true, guides: out };
}

export const artboardSetGuides: EditOp = {
  id: 'artboard.set-guides',
  artboards: (req) => (typeof req.params.artboard === 'string' ? [req.params.artboard] : []),
  apply(source, req) {
    const id = req.params.artboard;
    if (typeof id !== 'string' || !ARTBOARD_ID_RE.test(id))
      return refuse(req, 'That artboard is not on this canvas.', '');
    if (req.params.guides === null)
      return { source: applySetArtboardGuides(req.file, source, id, null).source };
    const g = checkGuides(req.params.guides);
    if (!g.ok) return refuse(req, g.message, id);
    return { source: applySetArtboardGuides(req.file, source, id, g.guides).source };
  },
};
