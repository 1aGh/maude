// A timing budget is a promise about the machine Maude runs on (a person's Mac), not about a shared CI
// runner. The GitHub runner measures ~2.5× slower on the same work (describeChanges p50 42.8 ms there vs
// 15.2 ms on the Mac), so a budget sized for the Mac sits inside the runner's noise and fails at random.
// On CI the budget scales by PERF_SLACK; it still catches the regression these tests exist for (an order of
// magnitude). Locally, and in the test lane, the budget is exactly what the spec says.
// MAUDE_PERF_SLACK overrides the factor anywhere (e.g. a loaded Mac mini lane).

export const PERF_SLACK = (() => {
  const set = Number(process.env.MAUDE_PERF_SLACK);
  if (Number.isFinite(set) && set >= 1) return set;
  return process.env.CI ? 2.5 : 1;
})();

/** The spec's budget in ms, scaled for the machine the test runs on. */
export function budget(ms: number): number {
  return ms * PERF_SLACK;
}

/** The fastest of `runs` timings of `fn` — one sample is one scheduler hiccup away from a false red. */
export function bestOf<T>(runs: number, fn: () => T): { ms: number; result: T } {
  let best = Number.POSITIVE_INFINITY;
  let result = fn();
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn();
    const ms = performance.now() - t0;
    if (ms < best) best = ms;
  }
  return { ms: best, result };
}
