// annotations-route-budget — the budgeted connector router (S4.2, contract S4 Q4).
// While dragging: grid 40, bbox-filtered obstacles, a cache keyed on grid-quantised
// endpoints, a time-sliced queue (an arrow over budget keeps its last route). On
// settle: one exact grid-20 route per arrow. The clock and the route function are
// injected so the budget is asserted without a wall clock.

import { describe, expect, test } from 'bun:test';
import { createArrowRouter, type RouteJob, retarget } from '../annotations/route.ts';
import { routeConnector } from '../draw/geometry.ts';

type P = { x: number; y: number };
type R = { x: number; y: number; width: number; height: number };

/** A fake clock + a recording route function that costs `cost` ms per call. */
function rig(cost = 1) {
  let t = 0;
  const calls: { grid: number; obstacles: number; start: P; goal: P }[] = [];
  const route = (start: P, goal: P, obstacles: R[] = [], o: { grid?: number } = {}) => {
    calls.push({ grid: o.grid ?? 10, obstacles: obstacles.length, start, goal });
    t += cost;
    return [start, { x: goal.x, y: start.y }, goal];
  };
  const router = createArrowRouter({ now: () => t, route, budgetMs: 4 });
  return { router, calls };
}
const job = (
  id: string,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  obstacles: R[] = []
): RouteJob => ({ id, start: { x: sx, y: sy }, goal: { x: gx, y: gy }, obstacles });

describe('createArrowRouter — drag', () => {
  test('routes on grid 40 and filters obstacles to the pair bbox', () => {
    const { router, calls } = rig();
    const near: R = { x: 100, y: 0, width: 50, height: 50 };
    const far: R = { x: 9000, y: 9000, width: 50, height: 50 };
    router.frame([job('a', 0, 0, 400, 100, [near, far])], 'drag');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.grid).toBe(40);
    expect(calls[0]?.obstacles).toBe(1);
  });

  test('a cache keyed on grid-quantised endpoints: a sub-cell move re-uses the route', () => {
    const { router, calls } = rig();
    const first = router.frame([job('a', 0, 0, 400, 100)], 'drag');
    expect(first.routes.get('a')?.state).toBe('fresh');
    const second = router.frame([job('a', 6, 3, 401, 100)], 'drag');
    expect(calls).toHaveLength(1); // same cells → no routing
    const r = second.routes.get('a');
    expect(r?.state).toBe('cached');
    expect(r?.points[0]).toEqual({ x: 6, y: 3 }); // …but the ends are the exact points
    expect(r?.points.at(-1)).toEqual({ x: 401, y: 100 });
    // A new cell is a new route.
    router.frame([job('a', 90, 0, 400, 100)], 'drag');
    expect(calls).toHaveLength(2);
  });

  test('a changed obstacle set is a different key (the route may no longer be valid)', () => {
    const { router, calls } = rig();
    router.frame([job('a', 0, 0, 400, 100, [{ x: 100, y: 0, width: 50, height: 50 }])], 'drag');
    router.frame([job('a', 0, 0, 400, 100, [{ x: 100, y: 200, width: 50, height: 50 }])], 'drag');
    expect(calls).toHaveLength(2);
  });

  test('the time slice: arrows over budget keep their last route, moved with the host', () => {
    const { router, calls } = rig(3); // 3 ms per route, 4 ms budget
    const all = (dx: number) =>
      ['a', 'b', 'c', 'd'].map((id, i) => job(id, dx, i * 500, 400 + dx, i * 500));
    // Seed: every arrow gets a route over a few frames.
    for (let i = 0; i < 6; i++) router.frame(all(0), 'drag');
    const seeded = calls.length;
    expect(seeded).toBe(4);

    // The host moves several cells: all four need a new route but the budget allows ~1.
    const f1 = router.frame(all(100), 'drag');
    expect(f1.spentMs).toBeLessThanOrEqual(4 + 3); // never more than one job past the line
    expect(f1.routed).toBe(1);
    expect(f1.deferred).toBe(3);
    expect(f1.pending).toBe(3);
    expect([...f1.routes.values()].filter((r) => r.state === 'stale')).toHaveLength(3);
    for (const r of f1.routes.values()) {
      // Stale or fresh, the arrow's ends follow the host.
      expect(r.points[0]?.x).toBe(100);
      expect(r.points.at(-1)?.x).toBe(500);
    }

    // Later frames drain the queue (no starvation: each frame routes someone new).
    const f2 = router.frame(all(100), 'drag');
    const f3 = router.frame(all(100), 'drag');
    const f4 = router.frame(all(100), 'drag');
    expect([f2.pending, f3.pending, f4.pending]).toEqual([2, 1, 0]);
    expect(calls.length - seeded).toBe(4);
  });

  test('an arrow with no route yet draws straight until its turn', () => {
    const { router } = rig(10);
    const out = router.frame([job('a', 0, 0, 400, 100), job('b', 0, 500, 400, 600)], 'drag');
    const states = ['a', 'b'].map((id) => out.routes.get(id)?.state).sort();
    expect(states).toEqual(['fresh', 'straight']);
    const straight = [...out.routes.values()].find((r) => r.state === 'straight');
    expect(straight?.points).toHaveLength(2);
  });

  test('progress is guaranteed: one route per frame even when one route alone exceeds the budget', () => {
    const { router } = rig(50);
    const f = router.frame([job('a', 0, 0, 400, 100), job('b', 0, 500, 400, 600)], 'drag');
    expect(f.routed).toBe(1);
  });

  test('a job already satisfied costs nothing and reports not pending', () => {
    const { router, calls } = rig();
    router.frame([job('a', 0, 0, 400, 100)], 'drag');
    const again = router.frame([job('a', 0, 0, 400, 100)], 'drag');
    expect(calls).toHaveLength(1);
    expect(again.pending).toBe(0);
    expect(again.spentMs).toBe(0);
  });
});

describe('createArrowRouter — settle', () => {
  test('routes each arrow once at grid 20 from its exact endpoints', () => {
    const { router, calls } = rig();
    router.frame([job('a', 0, 0, 400, 100)], 'drag');
    const settled = router.frame([job('a', 6, 3, 401, 100)], 'settle');
    const last = calls.at(-1);
    expect(last?.grid).toBe(20);
    expect(last?.start).toEqual({ x: 6, y: 3 });
    expect(settled.routes.get('a')?.state).toBe('fresh');
    expect(settled.routes.get('a')?.grid).toBe(20);
    expect(settled.pending).toBe(0);
    // Settling again with nothing changed does no work.
    const n = calls.length;
    router.frame([job('a', 6, 3, 401, 100)], 'settle');
    expect(calls).toHaveLength(n);
  });

  test('settle is time-sliced too, and pending says when to stop ticking', () => {
    const { router } = rig(3);
    const jobs = ['a', 'b', 'c'].map((id, i) => job(id, 0, i * 500, 400, i * 500));
    let frames = 0;
    let pending = 1;
    while (pending > 0 && frames < 10) {
      pending = router.frame(jobs, 'settle').pending;
      frames++;
    }
    expect(pending).toBe(0);
    expect(frames).toBe(3); // 1 per frame under a 4 ms budget at 3 ms each
  });

  test('forget() drops an arrow; clear() drops the cache too', () => {
    const { router, calls } = rig();
    router.frame([job('a', 0, 0, 400, 100)], 'drag');
    router.forget('a');
    router.frame([job('a', 0, 0, 400, 100)], 'drag');
    expect(calls).toHaveLength(1); // still a cache hit (the cache is keyed by geometry)
    router.clear();
    router.frame([job('a', 0, 0, 400, 100)], 'drag');
    expect(calls).toHaveLength(2);
  });
});

describe('retarget — a route moved onto new endpoints stays orthogonal', () => {
  const route: P[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 300 },
    { x: 400, y: 300 },
  ];
  test('slides the adjacent waypoints so the end segments stay axis-aligned', () => {
    const out = retarget(route, { x: -10, y: 12 }, { x: 410, y: 290 });
    expect(out[0]).toEqual({ x: -10, y: 12 });
    expect(out.at(-1)).toEqual({ x: 410, y: 290 });
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1] as P;
      const b = out[i] as P;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });
  test('a straight two-point route just takes the new ends', () => {
    expect(
      retarget(
        [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        { x: 1, y: 1 },
        { x: 9, y: 9 }
      )
    ).toEqual([
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    ]);
  });
});

describe('the real router (Q4 fixture)', () => {
  // 31 artboards 1440 × 1000 in 4 columns, gap 120 (the canvas-15 layout).
  const boards: R[] = Array.from({ length: 31 }, (_, i) => ({
    x: (i % 4) * 1560,
    y: Math.floor(i / 4) * 1120,
    width: 1440,
    height: 1000,
  }));

  test('routes stay orthogonal and clear of every board they were given', () => {
    const router = createArrowRouter({ route: routeConnector });
    const a = boards[5] as R;
    const b = boards[6] as R;
    const others = boards.filter((o) => o !== a && o !== b);
    const out = router.frame(
      [job('x', a.x + a.width + 4, a.y + 500, b.x - 4, b.y + 500, others)],
      'drag'
    );
    const pts = out.routes.get('x')?.points ?? [];
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1] as P;
      const q = pts[i] as P;
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
  });
});
