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

// The calling thread's CPU clock (CLOCK_THREAD_CPUTIME_ID), read through libc. Wall time counts every
// moment the thread waits for a core, and process CPU time (`process.cpuUsage`) counts the GC and JIT helper
// threads too (on a large describe, process CPU read ~50 % over wall on a quiet Mac); the thread clock is
// the work itself. Falls back to process CPU time where libc cannot be opened.
const threadCpuNs: () => number = (() => {
  try {
    const { dlopen, FFIType, ptr } = require('bun:ffi') as typeof import('bun:ffi');
    if (process.platform === 'darwin') {
      const lib = dlopen('/usr/lib/libSystem.B.dylib', {
        clock_gettime_nsec_np: { args: [FFIType.u32], returns: FFIType.u64 },
      });
      return () => Number(lib.symbols.clock_gettime_nsec_np(16)); // CLOCK_THREAD_CPUTIME_ID
    }
    if (process.platform === 'linux') {
      const lib = dlopen('libc.so.6', {
        clock_gettime: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
      });
      const ts = new BigInt64Array(2);
      const p = ptr(ts);
      return () => {
        lib.symbols.clock_gettime(3, p); // CLOCK_THREAD_CPUTIME_ID
        return Number(ts[0]) * 1e9 + Number(ts[1]);
      };
    }
  } catch {}
  return () => {
    const c = process.cpuUsage();
    return (c.user + c.system) * 1000;
  };
})();

/**
 * `fn`'s cost in CPU milliseconds of the calling thread instead of wall time — a budget that does not move
 * with machine load (#169 T8.1: the describe budget's p95 went over on the Mac mini while another suite ran).
 * Time spent waiting for a core is not counted; the work itself is. `wallMs` rides along for the log.
 */
export function cpuMs<T>(fn: () => T): { ms: number; wallMs: number; result: T } {
  const c0 = threadCpuNs();
  const t0 = performance.now();
  const result = fn();
  const wallMs = performance.now() - t0;
  return { ms: (threadCpuNs() - c0) / 1e6, wallMs, result };
}

// The machine's load, read off a fixed reference workload measured on the same thread clock, interleaved
// with the work under test. Even CPU time grows on a loaded machine (shared caches and memory bandwidth, an
// efficiency core): on the Mac mini lane under 30 busy processes a describe read +45 % thread CPU, and this
// reference +40 % with it, so their ratio held within 5 %. The reference is a large JSON AST deserialised and
// walked (allocation + GC, like oxc-parser's AST hand-over) and shares no code with Maude, so a regression in
// Maude never moves it.
const REFERENCE_TEXT = (() => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let pos = 0;
  const node = (depth: number): unknown => {
    const start = pos;
    pos += 1 + Math.floor(rnd() * 20);
    const kids =
      depth > 5 ? [] : Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => node(depth + 1));
    return {
      type: `Node${Math.floor(rnd() * 40)}`,
      start,
      end: pos,
      name: `n${start}`,
      children: kids,
    };
  };
  return JSON.stringify(Array.from({ length: 120 }, () => node(0)));
})();

/** What the reference workload costs on the Mac the budgets were set on (Apple Silicon, quiet), thread CPU ms. */
export const REFERENCE_MS = 14;

/** Run the reference workload once; its thread CPU ms. */
export function referenceMs(): number {
  // biome-ignore lint/suspicious/noExplicitAny: a plain JSON tree.
  const walk = (n: any): number =>
    n.end - n.start + n.name.length + n.children.reduce((s: number, c: unknown) => s + walk(c), 0);
  return cpuMs(() =>
    (JSON.parse(REFERENCE_TEXT) as unknown[]).reduce((s: number, n) => s + walk(n), 0)
  ).ms;
}

/**
 * How much slower than the reference Mac this run is, from reference samples taken alongside the work:
 * median / REFERENCE_MS, never below 1 — a faster machine is held to the spec's budget, never a tighter one.
 */
export function loadFactor(referenceSamples: number[]): number {
  const s = [...referenceSamples].sort((a, b) => a - b);
  const median = s[Math.floor((s.length - 1) / 2)] ?? REFERENCE_MS;
  return Math.max(1, median / REFERENCE_MS);
}
