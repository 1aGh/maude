// edit-ops/print.ts — S7.23 `artboard.set-print` and `artboard.set-print-guides` (08 ak-print-letak).
//
//   artboard.set-print         params { artboard, paper?, orientation?, bleedMm?, marginMm?, sizeMm?: [w, h] | null, showGuides? }
//   artboard.set-print-guides  params { artboard, visible: boolean | null }
//
// The print inspector speaks paper and millimetres; the file keeps what it always kept — a `print` prop (design
// intent) and the artboard's width / height in px (DDR-027; px = trim + 2 × bleed). `set-print` changes the prop AND
// the px size in ONE write, so the two never drift apart and one ⌘Z takes both back (kinds/print-edit.ts is the
// arithmetic). `set-print-guides` is C25: the artboard's own switch for its bleed / trim / margin guides, stored as
// `print.showGuides`; `null` removes it, and the artboard follows View › Advanced › Print guides again. Neither op
// touches the bytes of anything else on the canvas; a print prop's other keys are kept as they stand.
//
// Only a print artboard has a paper: any other kind is refused in words (switching kind is S7.25's "Change kind").
// Same result by hand: `canvas-tsx.md` § "Artboard props that Maude 2 adds".

import {
  applyResizeArtboard,
  applySetArtboardPrint,
  CanvasEditError,
  readArtboardPrintProp,
} from '../canvas-edit.ts';
import { nextPrint, type PrintPatch } from '../kinds/print-edit.ts';
import { ARTBOARD_ID_RE } from './artboard-resize.ts';
import { refuse } from './constraints.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

const NOT_PRINT = 'That artboard is not a print artboard; change its kind first.';

function artboardOf(req: ResolvedEditOp): string {
  const id = req.params.artboard;
  if (typeof id !== 'string' || !ARTBOARD_ID_RE.test(id))
    return refuse(req, 'That artboard is not on this canvas.', '');
  return id;
}

function patchOf(req: ResolvedEditOp, id: string): PrintPatch {
  const p = req.params;
  const patch: PrintPatch = {};
  if (p.paper !== undefined) patch.paper = p.paper as string;
  if (p.orientation !== undefined) patch.orientation = p.orientation as PrintPatch['orientation'];
  for (const key of ['bleedMm', 'marginMm'] as const) {
    if (p[key] === undefined) continue;
    const n = Number(p[key]);
    if (!Number.isFinite(n)) return refuse(req, 'That number is not a number.', id);
    patch[key] = n;
  }
  if (p.sizeMm !== undefined) {
    if (p.sizeMm === null) patch.sizeMm = null;
    else if (Array.isArray(p.sizeMm) && p.sizeMm.length === 2)
      patch.sizeMm = [Number(p.sizeMm[0]), Number(p.sizeMm[1])];
    else return refuse(req, 'Give the size as width and height in millimetres.', id);
  }
  if (p.showGuides !== undefined) patch.showGuides = p.showGuides as boolean | null;
  return patch;
}

function write(
  req: ResolvedEditOp,
  source: string,
  id: string,
  patch: PrintPatch,
  resize: boolean
): { source: string } {
  const current = readArtboardPrintProp(req.file, source, id, { arrays: true });
  if (!current) return refuse(req, NOT_PRINT, id);
  let next: ReturnType<typeof nextPrint>;
  try {
    next = nextPrint(current, patch);
  } catch (e) {
    if (e instanceof RangeError) return refuse(req, e.message, id);
    throw e;
  }
  let out = source;
  if (resize) out = applyResizeArtboard(req.file, out, id, next.widthPx, next.heightPx).source;
  return { source: applySetArtboardPrint(req.file, out, id, next.print).source };
}

const heldBy = (req: { params: Record<string, unknown> }) =>
  typeof req.params.artboard === 'string' ? [req.params.artboard] : [];

export const artboardSetPrint: EditOp = {
  id: 'artboard.set-print',
  // An AI run holding the artboard refuses the change, like a resize.
  artboards: heldBy,
  apply(source, req) {
    const id = artboardOf(req);
    const patch = patchOf(req, id);
    if (Object.keys(patch).length === 0)
      throw new CanvasEditError('Nothing to change.', { canvas: req.file, id });
    return write(req, source, id, patch, true);
  },
};

export const artboardSetPrintGuides: EditOp = {
  id: 'artboard.set-print-guides',
  artboards: heldBy,
  apply(source, req) {
    const id = artboardOf(req);
    const v = req.params.visible;
    if (v !== null && typeof v !== 'boolean')
      return refuse(req, 'Print guides are on, off, or follow View.', id);
    return write(req, source, id, { showGuides: v }, false);
  },
};
