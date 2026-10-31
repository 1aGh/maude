// editing/pen/pen-geometry.ts — the arithmetic of the Pen (S2.14, ed-pen). Pure: numbers in, numbers out, no DOM —
// the overlays (draw.tsx, points.tsx) measure, this decides.
//
// Drawing (P):
//   · a press adds a SHARP point; a press that drags pulls handles out and makes it SMOOTH (the handle you pull is
//     the OUT handle, the other mirrors it; the first point has only the one);
//   · ⇧ snaps the next point to a 45° step from the last (the chip says "45°");
//   · a press on the first point of a path of two or more closes it ("Click here to close");
//   · ↵ / esc finish an open path (esc on a path of one point gives it up).
// All numbers are the container's own px (what the op wants), measured through a Frame at every event, so a pan or a
// zoom in the middle of a path moves nothing.
//
// Editing (double-click a path): hit-testing of anchors, handles and segments, and the live model a drag makes.

import {
  insertPoint,
  moveHandle,
  movePoint,
  nearestOnPath,
  type PathModel,
  type PathPoint,
  type Pt,
  pointType,
  removePoint,
  type SubPath,
  snap45,
  togglePointType,
} from '../../edit-ops/path-model.ts';

export const PEN_TOOL = 'el-pen';
export const isPenTool = (t: string | null | undefined): boolean => t === PEN_TOOL;

/** Screen px a press must stay within to count as a click (and not pull handles). */
export const PEN_DRAG = 4;
/** Screen px from the first point at which a press closes the path. */
export const CLOSE_RADIUS = 10;
/**
 * Where "Click here to close" sits, from the first point (screen px). Its corner lies INSIDE the close radius, so the
 * pointer travels from the point onto the chip without ever leaving the zone that shows it (r1 #8: at +16 / +8 the
 * chip vanished in the gap before the pointer reached it).
 */
export const CLOSE_CHIP_OFFSET: Pt = { x: 6, y: 4 };
/** Hit radii on screen (px). */
export const HIT_ANCHOR = 8;
export const HIT_HANDLE = 7;
export const HIT_SEGMENT = 7;

/** Container px ↔ screen px: `screen = origin + k × local`. */
export interface Frame {
  origin: Pt;
  k: number;
}
export const toScreen = (f: Frame, p: Pt): Pt => ({
  x: f.origin.x + f.k * p.x,
  y: f.origin.y + f.k * p.y,
});
export const fromScreen = (f: Frame, p: Pt): Pt => ({
  x: (p.x - f.origin.x) / (f.k > 0 ? f.k : 1),
  y: (p.y - f.origin.y) / (f.k > 0 ? f.k : 1),
});

/** A model on screen. */
export function mapPath(m: PathModel, fn: (p: Pt) => Pt): PathModel {
  return {
    subs: m.subs.map((s) => ({
      closed: s.closed,
      points: s.points.map((p) => ({
        ...fn(p),
        ...(p.in ? { in: fn(p.in) } : {}),
        ...(p.out ? { out: fn(p.out) } : {}),
      })),
    })),
  };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

// ── drawing ─────────────────────────────────────────────────────────────────────────────────

export interface Draft {
  /** anchors in container px */
  points: PathPoint[];
  /** the press in flight: its anchor and the press position (screen px) */
  press: { index: number; at: Pt; pulled: boolean; closing: boolean } | null;
}

export const emptyDraft = (): Draft => ({ points: [], press: null });

/** Where a new point lands: the pointer, or — ⇧ — the 45° step from the last point. */
export function landing(draft: Draft, local: Pt, shift: boolean): Pt {
  const last = draft.points[draft.points.length - 1];
  return shift && last ? snap45(last, local) : local;
}

/** Is `screen` close enough to the first point to close the path? */
export function overFirst(draft: Draft, f: Frame, screen: Pt): boolean {
  const first = draft.points[0];
  return !!first && draft.points.length >= 2 && dist(toScreen(f, first), screen) <= CLOSE_RADIUS;
}

/** A press: closes the path over the first point, else adds a sharp point there. */
export function press(draft: Draft, f: Frame, screen: Pt, shift: boolean): Draft {
  if (overFirst(draft, f, screen))
    return { ...draft, press: { index: 0, at: screen, pulled: false, closing: true } };
  const at = landing(draft, fromScreen(f, screen), shift);
  const points = [...draft.points, { x: at.x, y: at.y }];
  return { points, press: { index: points.length - 1, at: screen, pulled: false, closing: false } };
}

/** The pointer moved with the press down: past the threshold it pulls handles (smooth). */
export function pull(draft: Draft, f: Frame, screen: Pt): Draft {
  const p = draft.press;
  if (!p || p.closing) return draft;
  if (!p.pulled && dist(p.at, screen) < PEN_DRAG) return draft;
  const to = fromScreen(f, screen);
  const points = draft.points.map((q) => ({ ...q }));
  const a = points[p.index] as PathPoint;
  a.out = to;
  if (p.index > 0) a.in = { x: 2 * a.x - to.x, y: 2 * a.y - to.y };
  return { points, press: { ...p, pulled: true } };
}

/** The model of a draft (open unless `closed`). */
export function draftModel(draft: Draft, closed = false): PathModel {
  return { subs: [{ closed, points: draft.points }] };
}

/** Back out the last point (⌫ while drawing). */
export function undoPoint(draft: Draft): Draft {
  return { points: draft.points.slice(0, -1), press: null };
}

// ── editing ─────────────────────────────────────────────────────────────────────────────────

export type Hit =
  | { kind: 'handle'; sub: number; i: number; which: 'in' | 'out' }
  | { kind: 'anchor'; sub: number; i: number }
  | { kind: 'segment'; sub: number; seg: number; t: number };

export interface PointRef {
  sub: number;
  i: number;
}

/**
 * What a press at `screen` lands on: the SELECTED point's handles first (they sit over everything), then anchors,
 * then the path itself (a click on it adds a point). `model` is in the frame's local px.
 */
export function hitTest(
  model: PathModel,
  f: Frame,
  screen: Pt,
  selected: PointRef | null
): Hit | null {
  if (selected) {
    const p = model.subs[selected.sub]?.points[selected.i];
    if (p) {
      for (const which of ['in', 'out'] as const) {
        const h = p[which];
        if (h && dist(toScreen(f, h), screen) <= HIT_HANDLE)
          return { kind: 'handle', sub: selected.sub, i: selected.i, which };
      }
    }
  }
  let best: Hit | null = null;
  let bestD = HIT_ANCHOR;
  model.subs.forEach((s, si) => {
    s.points.forEach((p, i) => {
      const d = dist(toScreen(f, p), screen);
      if (d <= bestD) {
        bestD = d;
        best = { kind: 'anchor', sub: si, i };
      }
    });
  });
  if (best) return best;
  const near = nearestOnPath(model, fromScreen(f, screen));
  if (near && near.dist * f.k <= HIT_SEGMENT)
    return { kind: 'segment', sub: near.sub, seg: near.seg, t: near.t };
  return null;
}

/** The model after dragging a hit to `local` (⌥ breaks a handle). */
export function dragged(
  base: PathModel,
  hit: Hit,
  local: Pt,
  mods: { alt: boolean; shift: boolean }
): PathModel {
  const sub = base.subs[hit.kind === 'segment' ? hit.sub : hit.sub] as SubPath;
  let next: SubPath;
  if (hit.kind === 'anchor') next = movePoint(sub, hit.i, local);
  else if (hit.kind === 'handle') {
    const p = sub.points[hit.i] as PathPoint;
    next = moveHandle(sub, hit.i, hit.which, mods.shift ? snap45(p, local) : local, mods.alt);
  } else return base;
  return { subs: base.subs.map((s, k) => (k === hit.sub ? next : s)) };
}

/** A click on a segment adds a point there; returns the model and the new point. */
export function addedAt(
  base: PathModel,
  hit: Extract<Hit, { kind: 'segment' }>
): { model: PathModel; point: PointRef } {
  const sub = insertPoint(base.subs[hit.sub] as SubPath, hit.seg, hit.t);
  return {
    model: { subs: base.subs.map((s, k) => (k === hit.sub ? sub : s)) },
    point: { sub: hit.sub, i: hit.seg + 1 },
  };
}

/** Double-click a point: smooth ↔ sharp. */
export function toggled(base: PathModel, ref: PointRef): PathModel {
  return {
    subs: base.subs.map((s, k) => (k === ref.sub ? togglePointType(s, ref.i) : s)),
  };
}

/** ⌫ on the selected point; null when nothing is left to draw (the path keeps at least two points). */
export function removed(base: PathModel, ref: PointRef): PathModel | null {
  const sub = removePoint(base.subs[ref.sub] as SubPath, ref.i);
  if (!sub) return null;
  return { subs: base.subs.map((s, k) => (k === ref.sub ? sub : s)) };
}

/** The word the chip says beside the selected point. */
export function typeChip(model: PathModel, ref: PointRef): 'Smooth' | 'Sharp' {
  const s = model.subs[ref.sub];
  return s && pointType(s, ref.i) === 'smooth' ? 'Smooth' : 'Sharp';
}

/** "Pen · 4 points" — the inspector's chip. */
export const penChip = (points: number): string =>
  `Pen · ${points} ${points === 1 ? 'point' : 'points'}`;
