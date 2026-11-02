// Bound-arrow router bench (S4.2, contract S4 Q4) — NOT a CI gate: headless
// timings swing with machine load, so compare a delta against the printed spread.
//
//   bun apps/studio/test/e2e/annotations-route-bench.mjs [--boards 31] [--budget 4]
//
// Part 1 times `draw/geometry.ts` `routeConnector` raw on the canvas-15 layout
// (31 artboards 1440 × 1000, 4 columns, gap 120) at several grids — the numbers
// the Q4 budget was derived from. Part 2 drives the real budgeted router
// (`annotations/route.ts`) the way the layer will: one board dragged for 60
// frames with K bound arrows to boards 1–2 cells away, then a settle. It prints
// the per-frame routing time (the 4 ms contract), how many arrows were deferred,
// and the grid-20 settle cost. Needs bun (the router imports .ts).

import { createArrowRouter } from '../../annotations/route.ts';
import { routeConnector } from '../../draw/geometry.ts';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const BOARDS = opt('--boards', 31);
const BUDGET = opt('--budget', 4);

const boards = Array.from({ length: BOARDS }, (_, i) => ({
  x: (i % 4) * 1560,
  y: Math.floor(i / 4) * 1120,
  width: 1440,
  height: 1000,
}));

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const ms = (v) => `${v.toFixed(2)}ms`;

// ── Part 1: raw routeConnector ─────────────────────────────────────────────
function raw(label, grid, k, filtered) {
  const a = boards[5];
  const targets = [6, 9, 1, 4, 10, 2, 8, 7, 13, 0].slice(0, k).map((i) => boards[i]);
  const times = [];
  for (let it = 0; it < 60; it++) {
    const t0 = performance.now();
    for (const b of targets) {
      const x0 = Math.min(a.x, b.x) - 200;
      const y0 = Math.min(a.y, b.y) - 200;
      const x1 = Math.max(a.x + a.width, b.x + b.width) + 200;
      const y1 = Math.max(a.y + a.height, b.y + b.height) + 200;
      const others = boards.filter(
        (o) =>
          o !== a &&
          o !== b &&
          (!filtered || (o.x < x1 && o.x + o.width > x0 && o.y < y1 && o.y + o.height > y0))
      );
      routeConnector(
        { x: a.x + a.width + 4 + it, y: a.y + 500 },
        { x: b.x - 4, y: b.y + 500 },
        others,
        { grid, padding: 24 }
      );
    }
    times.push(performance.now() - t0);
  }
  console.log(
    `${label.padEnd(30)} grid=${String(grid).padEnd(3)} arrows=${String(k).padEnd(2)} p50=${ms(pct(times, 0.5))} p95=${ms(pct(times, 0.95))}`
  );
}
console.log(`== routeConnector, ${BOARDS} boards ==`);
for (const g of [20, 40]) for (const k of [1, 4, 10]) raw('neighbours, bbox-filtered', g, k, true);
raw('neighbours, ALL obstacles', 40, 4, false);

// ── Part 2: the budgeted router under a drag ───────────────────────────────
function drag(k) {
  const router = createArrowRouter({ budgetMs: BUDGET });
  const hostIdx = 5;
  const targets = [6, 9, 1, 4, 10, 2, 8, 7, 13, 0].slice(0, k);
  const frames = [];
  const deferred = [];
  const lastJobs = [];
  const jobsAt = (dx, dy) => {
    const a = { ...boards[hostIdx], x: boards[hostIdx].x + dx, y: boards[hostIdx].y + dy };
    return targets.map((ti, n) => {
      const b = boards[ti];
      const others = boards.filter((_o, i) => i !== hostIdx && i !== ti);
      return {
        id: `a${n}`,
        start: { x: a.x + a.width + 4, y: a.y + 500 },
        goal: { x: b.x - 4, y: b.y + 500 },
        obstacles: others,
      };
    });
  };
  // 60 frames of a drag moving 6 px down per frame. It stays in the gutter: a board dragged
  // over another makes the start cell blocked and the search ends at once (a fake 0.01 ms).
  for (let f = 0; f < 60; f++) {
    const jobs = jobsAt(0, f * 6);
    const r = router.frame(jobs, 'drag');
    frames.push(r.spentMs);
    deferred.push(r.deferred);
    lastJobs.splice(0, lastJobs.length, ...jobs);
  }
  const settleFrames = [];
  let pending = 1;
  while (pending > 0 && settleFrames.length < 100) {
    const r = router.frame(lastJobs, 'settle');
    settleFrames.push(r.spentMs);
    pending = r.pending;
  }
  console.log(
    `drag, ${String(k).padEnd(2)} bound arrows   frame p50=${ms(pct(frames, 0.5))} p95=${ms(pct(frames, 0.95))} max=${ms(Math.max(...frames))}  deferred/frame avg=${(deferred.reduce((x, y) => x + y, 0) / deferred.length).toFixed(2)}  settle: ${settleFrames.length} frames, ${ms(settleFrames.reduce((x, y) => x + y, 0))} total, worst ${ms(Math.max(...settleFrames))}`
  );
  return Math.max(...frames);
}
console.log(`\n== budgeted router (budget ${BUDGET} ms/frame), one dragged board ==`);
for (const k of [1, 4, 10]) drag(k);
console.log(
  '\nContract (Q4): per-frame routing <= budget + at most one job; perf.sh drag p95 <= 18 ms is the end-to-end gate.'
);
