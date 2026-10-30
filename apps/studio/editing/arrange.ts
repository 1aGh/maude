// editing/arrange.ts — the canvas half of align, distribute and rotate (S2.7, ed-obj-multi).
//
// Objects: the canvas MEASURES (where each object is, in world px, and where its own `left` / `top`
// are) and asks the shell for one edit-op (edit-ops/arrange.ts says what the writer does with it).
// Artboards: the selection's rects go through `DragStateBus.commitPositions` — the one door every
// artboard-position commit uses, so annotations ride along (contract S2-S4-artboard-motion-ids §2).
// The maths is the same function for both (`equal-spacing-detector.ts`), so objects and artboards
// can never align differently.
//
// Pure where it can be (the measuring takes its rects as arguments, so it runs without layout).

import { alignLabel, equalSpacingLabel } from '../commands/equal-spacing-command.ts';
import { resolveSelectionEl } from '../dom-selection.ts';
import type { ArrangeItem } from '../edit-ops/arrange.ts';
import { TIDY_LABEL, tidyArtboards } from '../edit-ops/tidy.ts';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import {
  type AlignAxisMode,
  computeAlign,
  computeDistribute,
  type KeyedRect,
} from '../equal-spacing-detector.ts';
import type { CommandRecord } from '../undo-stack.ts';
import type { Selection } from '../use-selection-set.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';

// ── what the bar offers ───────────────────────────────────────────────────────────────────────

export interface ArrangeSpec {
  /** the tooltip, and the undo label */
  label: string;
  /** the maths: align to an edge / midline, or distribute on an axis */
  align?: AlignAxisMode;
  distribute?: 'x' | 'y';
}

export const ARRANGE: Record<string, ArrangeSpec> = {
  'align.left': { label: 'Align left', align: 'left' },
  'align.hcentre': { label: 'Align horizontal centres', align: 'center-x' },
  'align.right': { label: 'Align right', align: 'right' },
  'align.top': { label: 'Align top', align: 'top' },
  'align.vmiddle': { label: 'Align vertical middles', align: 'center-y' },
  'align.bottom': { label: 'Align bottom', align: 'bottom' },
  'distribute.h': { label: 'Distribute horizontally', distribute: 'x' },
  'distribute.v': { label: 'Distribute vertically', distribute: 'y' },
};
export const ARRANGE_ACTIONS = Object.keys(ARRANGE) as ArrangeAction[];
export type ArrangeAction =
  | 'align.left'
  | 'align.hcentre'
  | 'align.right'
  | 'align.top'
  | 'align.vmiddle'
  | 'align.bottom'
  | 'distribute.h'
  | 'distribute.v';

export const isArrangeAction = (id: unknown): id is ArrangeAction =>
  typeof id === 'string' && Object.hasOwn(ARRANGE, id);

/** How many it takes: alignment is defined for two, spacing needs one between. */
export const minimumFor = (action: ArrangeAction): number =>
  (ARRANGE[action] as ArrangeSpec).distribute ? 3 : 2;

export const NOT_ENOUGH_LINE = 'Select three or more to space them evenly.';

// ── the bar's label ───────────────────────────────────────────────────────────────────────────

export interface BarModel {
  kind: 'objects' | 'artboards';
  count: number;
  /** "3 objects" / "4 artboards" — what the bar says first */
  label: string;
}

/** The bar for a selection: 2+ objects, or 2+ artboards; never a mix, never one. */
export function barModel(selected: readonly Selection[]): BarModel | null {
  const objects = selected.filter((s) => s.id && s.artboardId).length;
  const boards = selected.filter((s) => !s.id && s.artboardId).length;
  if (objects >= 2 && boards === 0)
    return { kind: 'objects', count: objects, label: `${objects} objects` };
  if (boards >= 2 && objects === 0)
    return { kind: 'artboards', count: boards, label: `${boards} artboards` };
  return null;
}

// ── objects: measure ──────────────────────────────────────────────────────────────────────────

export const FREE_PLACEMENT_LINE =
  'Align moves objects that are placed freely. Right-click ▸ Advanced ▸ Convert children to absolute position first.';

export interface Placement {
  left: number;
  top: number;
}

/** `left` / `top` of an object that is placed freely; null for one that sits in a layout. */
export function placementOf(
  cs: Pick<CSSStyleDeclaration, 'position' | 'left' | 'top'>
): Placement | null {
  if (cs.position !== 'absolute' && cs.position !== 'fixed') return null;
  const left = Number.parseFloat(cs.left);
  const top = Number.parseFloat(cs.top);
  return Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A measured object: its visual box in world px (screen ÷ scale) and its own left / top. */
export function itemFrom(rect: RectLike, scale: number, place: Placement): ArrangeItem {
  const k = scale > 0 ? scale : 1;
  return { x: rect.left / k, y: rect.top / k, w: rect.width / k, h: rect.height / k, ...place };
}

/** Screen px per world unit around `el` (the artboard body is laid out unscaled, drawn scaled). */
export function worldScaleOf(el: Element): number {
  const body = el.closest('.dc-artboard-body') as HTMLElement | null;
  if (!body?.offsetWidth) return 1;
  const k = body.getBoundingClientRect().width / body.offsetWidth;
  return k > 0 ? k : 1;
}

export interface ObjectTarget {
  ref: ElementRef;
  el: HTMLElement;
}

/** The selected objects as (ref, element) pairs, in selection order; entries without a stamp are skipped. */
export function objectTargets(selected: readonly Selection[], doc: Document): ObjectTarget[] {
  const out: ObjectTarget[] = [];
  for (const s of selected) {
    if (!s.id || !s.artboardId) continue;
    const el = resolveSelectionEl(doc, s) as HTMLElement | null;
    if (!el) continue;
    out.push({
      ref: s.index
        ? { artboard: s.artboardId, element: s.id, occurrence: s.index }
        : { artboard: s.artboardId, element: s.id },
      el,
    });
  }
  return out;
}

export type Measured = { ok: true; items: ArrangeItem[] } | { ok: false; message: string };

/** Measure every target; all-or-nothing (a half-aligned selection is worse than none). */
export function measureTargets(targets: readonly ObjectTarget[], win: Window = window): Measured {
  const items: ArrangeItem[] = [];
  for (const t of targets) {
    const place = placementOf(win.getComputedStyle(t.el));
    if (!place) return { ok: false, message: FREE_PLACEMENT_LINE };
    items.push(itemFrom(t.el.getBoundingClientRect(), worldScaleOf(t.el), place));
  }
  return { ok: true, items };
}

// ── objects: run ──────────────────────────────────────────────────────────────────────────────

export interface ArrangeDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
}

/**
 * One align / distribute / rotate edit-op. A legacy link (no kernel action id) gets ONE revert
 * record, exactly like the object menu's ops; with an `actionId` S5's projection owns the undo.
 */
export async function runArranged(
  op: string,
  label: string,
  refs: readonly ElementRef[],
  params: Record<string, unknown>,
  deps: ArrangeDeps = {}
): Promise<EditOpResult | null> {
  if (refs.length === 0) return null;
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  const result = await run({ op, targets: [...refs], params });
  if (!result.ok) {
    deps.toast?.(result.message || 'That did not go through.', 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    // null on the op log: the write is a kernel action there, ⌘Z is the shell's projection
    const rec = editOpRecord(result.writeId, label);
    if (rec) deps.record?.(rec);
  }
  return result;
}

export function runArrange(
  action: ArrangeAction,
  refs: readonly ElementRef[],
  items: readonly ArrangeItem[],
  deps: ArrangeDeps = {}
): Promise<EditOpResult | null> {
  return runArranged(action, (ARRANGE[action] as ArrangeSpec).label, refs, { items }, deps);
}

// ── the guide that says where things landed ───────────────────────────────────────────────────

export interface Guide {
  /** 'x': a vertical line at screen x `at`; 'y': a horizontal one at screen y `at` */
  axis: 'x' | 'y';
  at: number;
  /** the line's extent along the other axis, screen px */
  from: number;
  to: number;
  /** "X 64" / "Y 230" — the line's place in the artboard, world px */
  chip: string;
}

export interface Shot {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The guide for an align action over the objects' SCREEN boxes before the move; null for distribute. */
export function alignGuide(
  action: ArrangeAction,
  shots: readonly Shot[],
  scale: number,
  origin: { left: number; top: number }
): Guide | null {
  const mode = (ARRANGE[action] as ArrangeSpec).align;
  if (!mode || shots.length < 2) return null;
  const xs = shots.flatMap((s) => [s.left, s.right]);
  const ys = shots.flatMap((s) => [s.top, s.bottom]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = scale > 0 ? scale : 1;
  const world = (px: number, o: number) => Math.round((px - o) / k);
  if (mode === 'left' || mode === 'right' || mode === 'center-x') {
    const at = mode === 'left' ? x0 : mode === 'right' ? x1 : (x0 + x1) / 2;
    return { axis: 'x', at, from: y0, to: y1, chip: `X ${world(at, origin.left)}` };
  }
  const at = mode === 'top' ? y0 : mode === 'bottom' ? y1 : (y0 + y1) / 2;
  return { axis: 'y', at, from: x0, to: x1, chip: `Y ${world(at, origin.top)}` };
}

// ── artboards ─────────────────────────────────────────────────────────────────────────────────

export interface BoardRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CommitBus {
  commitPositions(
    moved: { id: string; x: number; y: number }[],
    opts?: { label?: string; undoGroup?: string }
  ): void;
}

/** Where each artboard goes (only the ones that move). Same maths as the objects, ids as keys. */
export function artboardMoves(
  action: ArrangeAction,
  rects: readonly BoardRect[]
): { id: string; x: number; y: number }[] {
  const spec = ARRANGE[action] as ArrangeSpec;
  const keyed: KeyedRect[] = rects.map((r) => ({ key: r.id, x: r.x, y: r.y, w: r.w, h: r.h }));
  const moved = spec.align
    ? computeAlign(keyed, spec.align)
    : computeDistribute(keyed, spec.distribute ?? 'x');
  const by = new Map(rects.map((r) => [r.id, r]));
  // an align moves one axis, a distribute the other: the axis not named keeps the board's own value
  return moved
    .map((m) => {
      const r = by.get(m.key) as BoardRect;
      const horizontal = spec.align
        ? spec.align === 'left' || spec.align === 'right' || spec.align === 'center-x'
        : spec.distribute === 'x';
      return { id: m.key, x: horizontal ? m.x : r.x, y: horizontal ? r.y : m.y };
    })
    .filter((m) => {
      const r = by.get(m.id) as BoardRect;
      return Math.round(m.x) !== Math.round(r.x) || Math.round(m.y) !== Math.round(r.y);
    });
}

/** Align / distribute artboards through the bus's commit (annotations ride along). True when anything moved. */
export function arrangeArtboards(
  action: ArrangeAction,
  rects: readonly BoardRect[],
  bus: CommitBus
): boolean {
  if (rects.length < minimumFor(action)) return false;
  const moved = artboardMoves(action, rects);
  if (moved.length === 0) return false;
  const spec = ARRANGE[action] as ArrangeSpec;
  bus.commitPositions(moved, {
    label: spec.align ? alignLabel(spec.align, rects.length) : equalSpacingLabel(rects.length),
  });
  return true;
}

/**
 * `arrangeArtboards`, and when the boards already sit as asked (nothing to move) say so — a click on Align top over
 * boards that share their top edge must not look like a button that does nothing. `say` gets the line.
 */
export function arrangeBoardsOrSay(
  action: ArrangeAction,
  rects: readonly BoardRect[],
  bus: CommitBus,
  say: (line: string) => void
): boolean {
  const moved = arrangeArtboards(action, rects, bus);
  if (!moved && rects.length >= minimumFor(action))
    say((ARRANGE[action] as ArrangeSpec).align ? 'Already aligned.' : 'Already evenly spaced.');
  return moved;
}

// ── Tidy up (S2.9) ────────────────────────────────────────────────────────────────────────────

/** Registry id: the align bar's "Tidy up" over 2+ artboards (and ⌘K). One commit, one ⌘Z. */
export const TIDY_ACTION = 'artboard.tidy';
/** The tooltip, and the words of the dashed preview. */
export const TIDY_TIP = 'One row, even gaps';
export const TIDY_MINIMUM = 2;

/** Where every board of the selection would sit after Tidy (all of them, moved or not — the preview shows the row). */
export function tidyPreviewRects(rects: readonly BoardRect[]): BoardRect[] {
  if (rects.length < TIDY_MINIMUM) return [];
  const moves = new Map(tidyArtboards(rects).map((m) => [m.id, m]));
  return rects.map((r) => ({ ...r, ...(moves.get(r.id) ?? {}) }));
}

/** Tidy the selected artboards through the bus's commit (annotations ride along). True when anything moved. */
export function tidyBoards(rects: readonly BoardRect[], bus: CommitBus): boolean {
  if (rects.length < TIDY_MINIMUM) return false;
  const moved = tidyArtboards(rects);
  if (moved.length === 0) return false;
  bus.commitPositions(moved, { label: TIDY_LABEL(rects.length) });
  return true;
}
