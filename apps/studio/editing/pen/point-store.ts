// editing/pen/point-store.ts — the point being edited, said to the shell (14 Editing, ed-pen's Point card).
//
// Point editing lives in the canvas (points.tsx); the inspector is the shell's. The one thing the shell needs from the
// canvas is WHICH point is selected and where it is — "Corner Smooth · X 640 · Y 490". It rides the selection payload the
// canvas already posts (a path's `attrs`, like its point count `data-dc-pen-points`), so there is no new message: the
// selection is re-posted when the point changes. The store is keyed by the svg element and never written into the file.
// Pure: no DOM beyond the element used as a key.

import { type PathModel, type Pt, pointType } from '../../edit-ops/path-model.ts';

export interface PenPointInfo {
  sub: number;
  i: number;
  kind: 'smooth' | 'sharp';
  /** the point in its container's px (the numbers the Point card shows and `path.edit` takes) */
  x: number;
  y: number;
}

const store = new WeakMap<object, PenPointInfo>();

export const setPenPoint = (svg: object, info: PenPointInfo | null): void => {
  if (info) store.set(svg, info);
  else store.delete(svg);
};
export const getPenPoint = (svg: object): PenPointInfo | null => store.get(svg) ?? null;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The selected point of a model in the svg's local px, said in container px (`origin` = the svg's own box). */
export function penPointInfo(
  model: PathModel,
  at: { sub: number; i: number },
  origin: Pt
): PenPointInfo | null {
  const s = model.subs[at.sub];
  const p = s?.points[at.i];
  if (!s || !p) return null;
  return {
    sub: at.sub,
    i: at.i,
    kind: pointType(s, at.i),
    x: r2(p.x + origin.x),
    y: r2(p.y + origin.y),
  };
}

/** The attribute value the selection payload carries: "0,2,smooth,640,490". */
export const penPointAttr = (info: PenPointInfo | null): string =>
  info ? `${info.sub},${info.i},${info.kind},${info.x},${info.y}` : '';

/** Read it back (the shell side); null when absent or not a point. */
export function parsePenPointAttr(v: unknown): PenPointInfo | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,4}),(\d{1,4}),(smooth|sharp),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(v);
  if (!m) return null;
  return {
    sub: Number(m[1]),
    i: Number(m[2]),
    kind: m[3] as 'smooth' | 'sharp',
    x: Number(m[4]),
    y: Number(m[5]),
  };
}
