/** A poll gap this far above the 20 ms interval means the process did not run. */
const FROZEN_GAP_MS = 500;

/**
 * Wait for `fn()` for `ms` of time this process actually RAN.
 *
 * A wall-clock deadline also charges time the process spent not running — a
 * runner starved by the rest of the machine, a stopped process, a clock step.
 * The deadline then expires on the first tick after the freeze, before the
 * socket data queued behind it is read, and the test reports a hub that never
 * answered when the hub was never asked (the V2-8.1 red of 2026-10-31: every
 * other step of the restart test ran in its usual ~55 ms, then the v2 peer
 * "waited" exactly the 8 s deadline). So the clock is monotonic and a frozen
 * gap is charged as one poll. A hub that really never answers still fails:
 * the loop keeps ticking and every tick is charged.
 *
 * `explain` (optional) returns text appended to the failure message.
 */
export async function until(fn, ms = 8000, what = 'condition', explain = null) {
  let ran = 0;
  let frozen = 0;
  let last = performance.now();
  while (!(await fn())) {
    if (ran >= ms) {
      const why = explain ? ` — ${explain()}` : '';
      throw new Error(
        `${what} not reached before deadline (ran ${Math.round(ran)} ms, frozen ${Math.round(frozen)} ms)${why}`
      );
    }
    await new Promise((r) => setTimeout(r, 20));
    const now = performance.now();
    const gap = now - last;
    last = now;
    if (gap > FROZEN_GAP_MS) frozen += gap;
    ran += gap > FROZEN_GAP_MS ? 20 : gap;
  }
}
