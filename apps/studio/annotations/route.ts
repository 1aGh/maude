/**
 * @file       annotations/route.ts — the budgeted connector router
 * @scope      apps/studio/annotations/route.ts
 * @purpose    Orthogonal routes for arrows bound to artboards / elements, kept
 *             inside a frame budget while a host is dragged (contract S4 Q4,
 *             measured on the 31-board canvas-15 layout with
 *             `test/e2e/annotations-route-bench.mjs`).
 *
 *             `routeConnector` (draw/geometry.ts) is an A* on a grid: grid 20
 *             costs ~9 ms for 4 neighbour arrows, grid 40 with obstacles cut to
 *             the pair's bbox ~1.8 ms. The contract is therefore:
 *
 *               DRAG    grid 40, bbox-filtered obstacles, a cache keyed on
 *                       grid-quantised endpoints, and a time-sliced queue — at
 *                       most `budgetMs` (4) of routing per frame; an arrow that
 *                       does not fit keeps its LAST route with the moving end
 *                       following the host (`retarget`) and goes first next frame.
 *               SETTLE  one exact grid-20 route per arrow, same slicing.
 *
 *             Pure and clock-injected: no DOM, no timers. The caller owns the rAF
 *             loop and keeps ticking while `pending > 0`.
 */

import { type Rect, routeConnector } from '../draw/geometry.ts';
import type { Point } from '../draw/primitives.ts';

export type { Point, Rect };

export type RouteMode = 'drag' | 'settle';

export interface RouteJob {
  /** The arrow id (the router keeps per-arrow state under it). */
  id: string;
  start: Point;
  goal: Point;
  /**
   * Every obstacle on the canvas EXCEPT the arrow's own two hosts. The router
   * cuts them to the pair's bbox; pass the full set, not a pre-filtered one.
   */
  obstacles: readonly Rect[];
}

/**
 * - `fresh`    routed this frame
 * - `cached`   an earlier route re-used (same quantised cells / exact endpoints)
 * - `stale`    over budget: the last route, ends moved onto the new endpoints
 * - `straight` over budget and never routed: a straight two-point line
 */
export type RouteState = 'fresh' | 'cached' | 'stale' | 'straight';

export interface RouteResult {
  points: Point[];
  state: RouteState;
  /** Grid the points were routed on (40 drag / 20 settle); 0 for `straight`. */
  grid: number;
}

export interface FrameReport {
  routes: Map<string, RouteResult>;
  /** Wall time spent routing this frame (per the injected clock). */
  spentMs: number;
  routed: number;
  /** Jobs that needed a route but did not fit the budget. */
  deferred: number;
  /** Jobs whose result is not final for this mode. Keep ticking while > 0. */
  pending: number;
}

export type RouteFn = (
  start: Point,
  goal: Point,
  obstacles?: Rect[],
  opts?: { grid?: number; padding?: number; turnPenalty?: number }
) => Point[];

export interface RouterOptions {
  /** Routing budget per frame, ms (contract: 4). */
  budgetMs?: number;
  /** Grid while dragging (contract: 40). */
  dragGrid?: number;
  /** Grid on settle (contract: 20). */
  settleGrid?: number;
  /** Obstacle inflation, world px. */
  padding?: number;
  /** Obstacles farther than this from the pair's bbox are dropped, world px. */
  filterMargin?: number;
  /** Route cache entries kept (LRU). */
  cacheSize?: number;
  now?: () => number;
  route?: RouteFn;
}

export interface ArrowRouter {
  frame(jobs: readonly RouteJob[], mode: RouteMode): FrameReport;
  /** Drop the per-arrow state of an arrow that no longer exists. */
  forget(id: string): void;
  /** Drop every route and every cache entry. */
  clear(): void;
}

interface Last {
  points: Point[];
  grid: number;
  /** Key of the job this route satisfied. */
  key: string;
}

/**
 * Move a route onto new endpoints keeping every segment axis-aligned: the first
 * and last point become the endpoints and the waypoint next to each slides along
 * the segment's own axis. A 2-point route is just the two ends.
 */
export function retarget(points: readonly Point[], start: Point, goal: Point): Point[] {
  const n = points.length;
  if (n < 2) return [start, goal];
  const out = points.map((p) => ({ ...p }));
  if (n === 2) return [{ ...start }, { ...goal }];
  const horizontalFirst = (out[0] as Point).y === (out[1] as Point).y;
  const horizontalLast = (out[n - 1] as Point).y === (out[n - 2] as Point).y;
  const second = out[1] as Point;
  out[0] = { ...start };
  if (horizontalFirst) second.y = start.y;
  else second.x = start.x;
  const prev = out[n - 2] as Point;
  out[n - 1] = { ...goal };
  if (horizontalLast) prev.y = goal.y;
  else prev.x = goal.x;
  return out;
}

/** Cells a grid route over these inputs would search (the A* cost driver). */
function cellsFor(start: Point, goal: Point, obs: readonly Rect[], grid: number): number {
  let minX = Math.min(start.x, goal.x);
  let minY = Math.min(start.y, goal.y);
  let maxX = Math.max(start.x, goal.x);
  let maxY = Math.max(start.y, goal.y);
  for (const o of obs) {
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + o.width);
    maxY = Math.max(maxY, o.y + o.height);
  }
  return ((maxX - minX) / grid + 2) * ((maxY - minY) / grid + 2);
}

/** Headroom on the cost estimate: an A* search varies ~30 % around its cells-based cost. */
const COST_SAFETY = 1.5;

export function createArrowRouter(opts: RouterOptions = {}): ArrowRouter {
  const budget = opts.budgetMs ?? 4;
  const dragGrid = opts.dragGrid ?? 40;
  const settleGrid = opts.settleGrid ?? 20;
  const padding = opts.padding ?? 24;
  const margin = opts.filterMargin ?? 200;
  const cacheMax = opts.cacheSize ?? 512;
  const now = opts.now ?? (() => performance.now());
  const route: RouteFn = opts.route ?? routeConnector;

  const cache = new Map<string, Point[]>();
  const last = new Map<string, Last>();
  /** Arrows that missed the previous frame's budget — they go first (no starvation). */
  let starved: string[] = [];
  /** Observed routing cost, ms per searched cell (0 = unknown yet). */
  let msPerCell = 0;

  const remember = (key: string, pts: Point[]): void => {
    cache.delete(key);
    cache.set(key, pts);
    if (cache.size > cacheMax) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  function frame(jobs: readonly RouteJob[], mode: RouteMode): FrameReport {
    const grid = mode === 'drag' ? dragGrid : settleGrid;
    const t0 = now();
    const routes = new Map<string, RouteResult>();
    let routed = 0;
    let deferred = 0;
    let pending = 0;
    const nextStarved: string[] = [];

    // Arrows that missed the last frame first, then the rest in caller order.
    const rank = new Map(starved.map((id, i) => [id, i]));
    const ordered = [...jobs].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));

    for (const job of ordered) {
      // Cut the obstacles to the pair's bbox (+ margin).
      const bx0 = Math.min(job.start.x, job.goal.x) - margin;
      const by0 = Math.min(job.start.y, job.goal.y) - margin;
      const bx1 = Math.max(job.start.x, job.goal.x) + margin;
      const by1 = Math.max(job.start.y, job.goal.y) + margin;
      const obs = job.obstacles.filter(
        (o) => o.x < bx1 && o.x + o.width > bx0 && o.y < by1 && o.y + o.height > by0
      );
      const sig = obs
        .map(
          (o) =>
            `${Math.round(o.x)},${Math.round(o.y)},${Math.round(o.width)},${Math.round(o.height)}`
        )
        .join(';');
      // Drag keys on grid cells (a sub-cell move re-uses the route); settle on the exact points.
      const q = (v: number): number =>
        mode === 'drag' ? Math.round(v / grid) : Math.round(v * 100) / 100;
      const key = `${mode}|${grid}|${q(job.start.x)},${q(job.start.y)}|${q(job.goal.x)},${q(job.goal.y)}|${sig}`;

      const prior = last.get(job.id);
      const hit = prior?.key === key ? prior.points : cache.get(key);
      if (hit) {
        const points = mode === 'drag' ? retarget(hit, job.start, job.goal) : hit;
        last.set(job.id, { points, grid, key });
        remember(key, hit);
        routes.set(job.id, { points, state: 'cached', grid });
        continue;
      }

      // Over budget → keep the last route (ends follow the host) and go first next frame.
      // One route per frame always runs, so a slow arrow cannot stall the queue.
      const est = cellsFor(job.start, job.goal, obs, grid) * msPerCell * COST_SAFETY;
      if (routed > 0 && now() - t0 + est > budget) {
        deferred++;
        pending++;
        nextStarved.push(job.id);
        if (prior) {
          routes.set(job.id, {
            points: retarget(prior.points, job.start, job.goal),
            state: 'stale',
            grid: prior.grid,
          });
        } else {
          routes.set(job.id, { points: [job.start, job.goal], state: 'straight', grid: 0 });
        }
        continue;
      }

      const before = now();
      const points = route(job.start, job.goal, obs.slice(), { grid, padding });
      const cost = now() - before;
      const cells = cellsFor(job.start, job.goal, obs, grid);
      if (cells > 0 && cost > 0) {
        const observed = cost / cells;
        msPerCell = msPerCell === 0 ? observed : msPerCell * 0.5 + observed * 0.5;
      }
      routed++;
      remember(key, points);
      last.set(job.id, { points, grid, key });
      routes.set(job.id, { points, state: 'fresh', grid });
    }

    starved = nextStarved;
    // A drag-grid route is not final for a settle, but it IS what a settle's stale frame shows.
    return { routes, spentMs: now() - t0, routed, deferred, pending };
  }

  return {
    frame,
    forget(id) {
      last.delete(id);
      starved = starved.filter((s) => s !== id);
    },
    clear() {
      cache.clear();
      last.clear();
      starved = [];
    },
  };
}
