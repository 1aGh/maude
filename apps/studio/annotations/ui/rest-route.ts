/**
 * @file       annotations/ui/rest-route.ts — an elbow arrow keeps its route at rest (S4.11)
 * @scope      apps/studio/annotations/ui/rest-route.ts
 * @purpose    S4.10 routed an elbow arrow around other artboards while an artboard was dragged
 *             (annotations/ui/ride.ts); at rest `ArrowView` fell back to the plain single-corner
 *             elbow. This is the at-rest half: for every elbow arrow it asks the SAME budgeted router
 *             (annotations/route.ts) for the SETTLE route (grid 20) against the artboards the arrow
 *             is not sitting on, and holds the points on `RenderItem.ends.route`, so the picture
 *             after the drag is the picture the drag settled on.
 *
 *             Pure and DOM-free: the artboard rects and the router are injected. The router is
 *             called with an unlimited budget here (the layer calls this from a memo, not a frame
 *             loop); its per-arrow cache keeps a re-render cheap.
 *
 *             Also home of `labelPoint`: where an arrow's words sit (the middle of the line the
 *             arrow is actually drawn along, route included), so a label follows every re-route.
 */

import type { ArrowRouter, Point, RouteJob } from '../route.ts';
import type { AnnotationElement } from '../types.ts';
import type { RenderItem, ResolvedEnds } from './render-model.ts';
import { straightCrosses } from './ride.ts';

export interface BoardRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const inside = (b: BoardRect, p: Point): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** An arrow routes only when it is an elbow with both ends resolved. */
export const isElbow = (el: AnnotationElement): boolean =>
  el.type === 'arrow' && el.line === 'elbow';

/** The obstacle set for one arrow: every artboard that neither end sits on. */
export function obstaclesFor(
  boards: readonly BoardRect[],
  start: Point,
  goal: Point
): Array<{ x: number; y: number; width: number; height: number }> {
  return boards
    .filter((b) => !inside(b, start) && !inside(b, goal))
    .map((b) => ({ x: b.x, y: b.y, width: b.w, height: b.h }));
}

/**
 * `items` with every elbow arrow's settle route on `ends.route`. Items that are not elbows, and
 * elbows with nothing in their way, are returned as the SAME objects (their node skips re-render);
 * an elbow whose route is just its two-corner default keeps drawing the default (no `route`).
 */
export function routeElbowsAtRest(
  items: readonly RenderItem[],
  boards: readonly BoardRect[],
  router: ArrowRouter,
  mode: 'settle' | 'drag' = 'settle'
): RenderItem[] {
  const jobs: RouteJob[] = [];
  for (const it of items) {
    if (!it.ends || !isElbow(it.el)) continue;
    const start = { x: it.ends.x1, y: it.ends.y1 };
    const goal = { x: it.ends.x2, y: it.ends.y2 };
    const obstacles = obstaclesFor(boards, start, goal);
    if (!obstacles.length) continue;
    // A free elbow nothing is in the way of keeps the plain corner (the v1 look, no routing cost).
    // An arrow bound to a canvas host is always routed: it rode with the drag's re-route, and the
    // picture at rest must be the picture the drag settled on.
    if (!isBound(it.el) && !cornerCrosses(start, goal, obstacles)) continue;
    jobs.push({ id: it.el.id, start, goal, obstacles });
  }
  if (!jobs.length) return items as RenderItem[];
  // At rest the route is final: tick the router's time-sliced queue until it has settled every
  // arrow. While a gesture is in flight (`drag`) one budgeted frame is enough — an arrow that did
  // not fit keeps its last route with its end following (the router's `stale` state).
  let report = router.frame(jobs, mode);
  if (mode === 'settle')
    for (let i = 0; i < 24 && report.pending > 0; i++) report = router.frame(jobs, mode);
  return items.map((it) => {
    const r = report.routes.get(it.el.id);
    if (!r || r.points.length < 2 || !it.ends) return it;
    const ends: ResolvedEnds = { ...it.ends, route: r.points };
    return { ...it, ends };
  });
}

const isBound = (el: AnnotationElement): boolean => !!el.startHost || !!el.endHost;

/** The single-corner elbow (dominant axis first) as two segments — does either cross an obstacle? */
function cornerCrosses(
  a: Point,
  b: Point,
  obstacles: ReadonlyArray<{ x: number; y: number; width: number; height: number }>
): boolean {
  const corner: Point =
    Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  const rects = obstacles.map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height }));
  return straightCrosses(a, corner, rects) !== null || straightCrosses(corner, b, rects) !== null;
}

/** Length-weighted middle of a polyline. */
export function polylineMid(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (total === 0) return { ...(points[0] as Point) };
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg && seg > 0) {
      const t = left / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= seg;
  }
  return { ...(points[points.length - 1] as Point) };
}

/**
 * Where an arrow's words sit: the middle of the line as drawn. Straight: the chord's middle.
 * Curved: the quadratic's t=½ point (canvas-arrowheads.ts bows the control point by 22 % of the
 * chord, so the middle is 11 % of the chord off the chord). Elbow: the middle of the routed
 * polyline, else of the single-corner default.
 */
export function labelPoint(el: AnnotationElement, ends: ResolvedEnds): Point {
  const a = { x: ends.x1, y: ends.y1 };
  const b = { x: ends.x2, y: ends.y2 };
  if (el.line === 'elbow') {
    if (ends.route && ends.route.length >= 2) return polylineMid(ends.route);
    const corner: Point =
      Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return polylineMid([a, corner, b]);
  }
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (el.line === 'curved') {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = len * 0.22 * 0.5;
    return { x: mx + (-dy / len) * off, y: my + (dx / len) * off };
  }
  return { x: mx, y: my };
}
