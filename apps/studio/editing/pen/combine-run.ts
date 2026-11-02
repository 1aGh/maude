// editing/pen/combine-run.ts — Combine shapes, asked of the canvas (S2.14, ed-pen: "Combine shapes").
//
// The inspector's Combine row, ⌘K and an agent's registry call all arrive as `run-action` `shape.combine.<kind>`; the
// canvas measures what it alone can see (each shape's box and corner radii in its PARENT's px, tokens already
// resolved) and sends ONE `shape.combine.<kind>` edit-op. The writer composes the SVG (edit-ops/combine.ts); the
// operands are removed in the same write, so it is one undo step. Several shapes in different frames, or fewer than
// two, are said in a plain line and write nothing.

import { showCanvasToast } from '../../canvas-notifications.tsx';
import { COMBINE_KINDS, type CombineKind } from '../../edit-ops/path-model.ts';
import type { EditOpResult, ElementRef } from '../../edit-ops/types.ts';
import type { CommandRecord } from '../../undo-stack.ts';
import type { Selection } from '../../use-selection-set.tsx';
import { type ObjectTarget, objectTargets } from '../arrange.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from '../edit-op.ts';

export const COMBINE_ACTIONS = COMBINE_KINDS.map((k) => `shape.combine.${k}`);
export const isCombineAction = (id: unknown): id is `shape.combine.${CombineKind}` =>
  typeof id === 'string' && COMBINE_ACTIONS.includes(id);

export const NEEDS_TWO_SHAPES = 'Combine needs two or more shapes.';
export const SAME_FRAME = 'Combine works on shapes that sit in the same frame.';

/** A border radius in px: `12px`, `50%` (of the shorter side), or `12px 4px` (the horizontal one). */
export function radiusPx(value: string, w: number, h: number): number {
  const first = (value || '').trim().split(/\s+/)[0] ?? '';
  const n = Number.parseFloat(first);
  if (!Number.isFinite(n)) return 0;
  return first.endsWith('%') ? (n / 100) * Math.min(w, h) : n;
}

export interface Operand {
  x: number;
  y: number;
  w: number;
  h: number;
  radii: [number, number, number, number];
}

/** A shape's box in its parent's px (the parent's padding edge is the origin, as the drawing tools measure). */
export function measureOperand(el: HTMLElement, parent: HTMLElement): Operand {
  const pr = parent.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const body = el.closest('.dc-artboard-body') as HTMLElement | null;
  const k = body?.offsetWidth ? body.getBoundingClientRect().width / body.offsetWidth : 1;
  const s = k > 0 ? k : 1;
  const w = r.width / s;
  const h = r.height / s;
  const cs = getComputedStyle(el);
  return {
    x: (r.left - pr.left - parent.clientLeft * s) / s,
    y: (r.top - pr.top - parent.clientTop * s) / s,
    w,
    h,
    radii: [
      radiusPx(cs.borderTopLeftRadius, w, h),
      radiusPx(cs.borderTopRightRadius, w, h),
      radiusPx(cs.borderBottomRightRadius, w, h),
      radiusPx(cs.borderBottomLeftRadius, w, h),
    ],
  };
}

/** The ask for these targets, or the line that says why not. */
export function planCombine(
  kind: CombineKind,
  targets: readonly ObjectTarget[]
): { ask: EditOpAsk } | { why: string } {
  if (targets.length < 2) return { why: NEEDS_TWO_SHAPES };
  const parent = targets[0]?.el.parentElement;
  if (!parent || targets.some((t) => t.el.parentElement !== parent)) return { why: SAME_FRAME };
  return {
    ask: {
      op: `shape.combine.${kind}`,
      targets: targets.map((t) => t.ref),
      params: { operands: targets.map((t) => measureOperand(t.el, parent as HTMLElement)) },
    },
  };
}

export interface CombineDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
  select?: (created: ElementRef[]) => void;
}

/** Run one Combine on the selection: ONE op, one undo step; resolves true when something was made. */
export async function runCombine(
  id: string,
  selected: readonly Selection[],
  deps: CombineDeps = {},
  doc: Document = document
): Promise<boolean> {
  const toast = deps.toast ?? ((m, k) => showCanvasToast(m, k === 'error' ? 'error' : 'info'));
  const kind = id.slice('shape.combine.'.length) as CombineKind;
  const plan = planCombine(kind, objectTargets(selected, doc));
  if ('why' in plan) {
    toast(plan.why, 'info');
    return false;
  }
  const r = await (deps.run ?? ((ask: EditOpAsk) => runEditOp(ask)))(plan.ask);
  if (!r.ok) {
    toast(r.message || 'That did not go through.', 'error');
    return false;
  }
  if (r.actionId === null && r.writeId) {
    const rec = editOpRecord(r.writeId, `Combine · ${kind}`);
    if (rec) deps.record?.(rec);
  }
  if (r.created?.length) deps.select?.(r.created);
  return true;
}
