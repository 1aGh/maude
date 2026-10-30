// edit-ops/convert-kind.ts — S7.25 `artboard.convert-kind` (08 ak-convert, ak-convert-after): "Change kind makes a copy".
//
//   params { artboard: string, paper: string, orientation?: 'portrait' | 'landscape', keepOriginal?: boolean }
//
// A fixed size (an Instagram post) becomes a print artboard (an A6) WITHOUT being rewritten: by default the A6 is made
// from a COPY, spliced beside the post, and the post's bytes are untouched. `keepOriginal: false` (the dialog's switch
// turned off) changes the artboard itself — one ⌘Z brings it back.
//
// What the new artboard is (kinds/convert.ts says it in words, and is the arithmetic):
//   kind="print"  print={{ paper, orientation, bleedMm }}  width / height = trim + 2 × bleed in px
//   its children are wrapped in ONE `<div style={{ zoom }}>` — the design scaled to the paper's width (text stays text),
//   the extra height is the artboard's own `background`
//   a `safeZones` prop is dropped (print has its own safe margin); the label is "<label> · A6"
//
// `detail` says what was made (`copy`, `madeFrom`, the plan's words) so the dialog's toast and the `artboardMeta.madeFrom`
// write that follows (the shell, through `PATCH /_api/present-meta`) need no second read.
//
// Same result by hand: `canvas-tsx.md` § "Change an artboard's kind".

import { artboardRects, placeBeside, placeCopy } from '../ai/copy-meta.ts';
import {
  applyDuplicateArtboard,
  applyResizeArtboard,
  applySetArtboardKind,
  applySetArtboardPrint,
  applySetArtboardSafeZones,
  applyWrapArtboardChildren,
  CanvasEditError,
} from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { type ConvertPlan, planConvert } from '../kinds/convert.ts';
import { artboardFactsOf } from './artboard-facts.ts';
import { ARTBOARD_ID_RE } from './artboard-resize.ts';
import { refuse } from './constraints.ts';
import { artboardLabels, copyName } from './duplicate-at-width.ts';
import type { EditOp, LayoutPatch, ResolvedEditOp } from './types.ts';

export const CONVERT_LABEL = 'Change kind';
const PAPER_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A free id for the copy: `<id>-a6`, then `<id>-a6-2`… */
function freshId(base: string, taken: ReadonlySet<string>): string {
  const head = base.slice(0, 56);
  if (!taken.has(head)) return head;
  for (let n = 2; ; n++) {
    const id = `${head}-${n}`;
    if (!taken.has(id)) return id;
  }
}

const num4 = (n: number) => String(Math.round(n * 10000) / 10000);

/** The scaling wrapper — one element, all its numbers literal, so a v1 peer reads it as any other `<div>`. */
export function wrapperOpen(plan: ConvertPlan, srcW: number, srcH: number): string {
  const margin = plan.offsetX > 0 ? `, marginLeft: ${Math.round(plan.offsetX / plan.scale)}` : '';
  return `<div style={{ position: 'relative', flex: 'none', width: ${Math.round(srcW)}, height: ${Math.round(srcH)}, zoom: ${num4(plan.scale)}${margin} }}>`;
}

function paramsOf(req: ResolvedEditOp) {
  const id = req.params.artboard;
  if (typeof id !== 'string' || !ARTBOARD_ID_RE.test(id))
    return refuse(req, 'That artboard is not on this canvas.', '');
  const paper = req.params.paper;
  if (typeof paper !== 'string' || !PAPER_RE.test(paper))
    return refuse(req, 'Pick a paper size.', id);
  const o = req.params.orientation;
  if (o !== undefined && o !== 'portrait' && o !== 'landscape')
    return refuse(req, 'Orientation is portrait or landscape.', id);
  const keep = req.params.keepOriginal;
  if (keep !== undefined && typeof keep !== 'boolean')
    return refuse(req, 'Keeping the original is on or off.', id);
  return {
    id,
    paper,
    orientation: o as 'portrait' | 'landscape' | undefined,
    keepOriginal: keep !== false,
  };
}

/**
 * p8-bugs3 #6 (08 ak-convert-after) — "the A6 copy is beside the post": the copy has no place of its own, so the
 * canvas would draw it in the default-grid slot its position in the file gives it — on top of any board the person
 * has placed there. Every board is pinned where it is drawn NOW (splicing the copy shifts the later default-grid
 * slots), the copy goes right of the post at the gutter, and what that slot covers in the post's row moves over
 * (`placeBeside`, the one rule an AI's copy follows); when the row cannot shift, the first clear spot.
 */
function beside(
  before: string,
  layout: unknown,
  sourceId: string,
  copyId: string,
  w: number,
  h: number
): LayoutPatch | null {
  const drawn = artboardRects(before, layout);
  if (!drawn.some((r) => r.id === sourceId)) return null;
  const rects = [...drawn, { id: copyId, x: 0, y: 0, w, h }];
  const put = placeBeside(rects, copyId, sourceId);
  const at = put?.at ?? placeCopy(rects, copyId, sourceId);
  if (!at) return null;
  const shifts = put?.shifts ?? [];
  return {
    pin: drawn.map((r) => ({ id: r.id, x: r.x, y: r.y })),
    set: [{ id: copyId, x: at.x, y: at.y }, ...shifts],
  };
}

const heldBy = (req: { params: Record<string, unknown> }) =>
  typeof req.params.artboard === 'string' ? [req.params.artboard] : [];

export const artboardConvertKind: EditOp = {
  id: 'artboard.convert-kind',
  artboards: heldBy,
  apply(source, req) {
    const p = paramsOf(req);
    const facts = artboardFactsOf(source, p.id);
    if (!facts) return refuse(req, 'That artboard is not on this canvas.', p.id);
    if (facts.kind !== 'digital')
      return refuse(
        req,
        'Only a fixed size can be made into a print; change a page or a video by hand.',
        p.id
      );
    if (facts.widthPx === null || facts.heightPx === null)
      return refuse(req, 'This artboard’s size is not a number, so it cannot be scaled.', p.id);
    const labels = artboardLabels(source);
    const label = labels.get(p.id) ?? p.id;
    const plan = planConvert(
      {
        id: p.id,
        label,
        widthPx: facts.widthPx,
        heightPx: facts.heightPx,
        background: facts.background,
        safeZones: facts.safeZones,
      },
      { paper: p.paper, ...(p.orientation ? { orientation: p.orientation } : {}) }
    );
    if (!plan) return refuse(req, 'That is not a paper size Maude knows.', p.id);

    let out = source;
    let target = p.id;
    try {
      if (p.keepOriginal) {
        const walk = walkIdElements(source, req.file);
        if (!walk.ok)
          return refuse(req, 'This canvas does not parse; fix it before editing.', p.id);
        const ids = new Set(
          walk.elements
            .filter((e) => e.tag === 'DCArtboard' && e.artboard)
            .map((e) => e.artboard as string)
        );
        const taken = new Set(labels.values());
        const copyLabel = taken.has(plan.copyLabel)
          ? copyName(plan.copyLabel, taken)
          : plan.copyLabel;
        target = freshId(`${p.id}-${plan.print.paper}`, ids);
        out = applyDuplicateArtboard(req.file, out, p.id, null, {
          id: target,
          label: copyLabel,
        }).source;
      }
      out = applySetArtboardKind(req.file, out, target, 'print').source;
      out = applySetArtboardPrint(req.file, out, target, plan.print).source;
      out = applyResizeArtboard(req.file, out, target, plan.widthPx, plan.heightPx).source;
      if (facts.safeZones) out = applySetArtboardSafeZones(req.file, out, target, null).source;
      out = applyWrapArtboardChildren(
        req.file,
        out,
        target,
        wrapperOpen(plan, facts.widthPx, facts.heightPx),
        '</div>'
      ).source;
    } catch (e) {
      if (e instanceof CanvasEditError) return refuse(req, e.message, p.id);
      throw e;
    }
    const finalLabel = artboardLabels(out).get(target) ?? plan.copyLabel;
    const layout = p.keepOriginal
      ? beside(source, req.ctx?.layout, p.id, target, plan.widthPx, plan.heightPx)
      : null;
    return {
      source: out,
      ...(p.keepOriginal ? { created: [{ artboard: target, element: target }] } : {}),
      ...(layout ? { layout } : {}),
      detail: {
        artboard: target,
        copy: p.keepOriginal,
        paper: plan.paperName,
        ...(p.keepOriginal ? { madeFrom: { artboard: p.id, label } } : {}),
        label: finalLabel,
        extraPct: plan.extraPct,
        fill: plan.fill,
      },
      action: {
        kind: 'edit',
        label: p.keepOriginal
          ? `Made the ${plan.paperName} copy`
          : `Changed ${label} to ${plan.paperName} print`,
      },
    };
  },
};
