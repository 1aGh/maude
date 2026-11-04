// How fast the file plane talks to a hub — issue #204 (a 5 041-file cloud project took ≈ 1.5 h to
// reach a new Mac: 200 files per pass, ONE request at a time, and the next pass only on the 20 s
// tick — so the wall clock was the sum of every round trip plus the waits between passes).
//
// Two independent bounds, because they protect different things:
//
//   CONCURRENCY — how many transfers are in flight at once. A cold cell fills every first read of a
//   media file from its bucket with `MAX_CONCURRENT_FILLS = 4` slots and a 15 s deadline
//   (apps/hub/src/materializer.mjs); more parallel GETs than that only queue inside the cell until
//   they time out as `503 fetching from storage`. So we start AT the cell's fill width, may grow a
//   little past it on a hub that keeps up (a warm cache or a self-hosted disk), halve on a 429 and
//   step down on every storage miss — additive increase, multiplicative decrease.
//
//   RATE — how many requests start in any rolling minute. The hub meters every file read AND every
//   journal read against ONE per-label bucket of 600 a minute (`fileReadBuckets`, server.mjs), and
//   writes against a separate one of the same size. Concurrency alone does not bound that: on a fast
//   hub six parallel GETs of small files run past 600 in well under a minute, and a plane that then
//   meets a 429 is a client manufacturing the limit it fails on (issue #109). We stay at 480, leaving
//   the remaining fifth for the cursor reads, the presence report and anything else on the label.
//
// Leaf on purpose: no imports, a clock and a sleep injected, so the tests drive it without timers.

/** Transfers in flight at the start — the cold cell's bucket-fill width. */
export const PULL_CONCURRENCY_START = 4;
/** Never more than this, however well the hub keeps up. */
export const PULL_CONCURRENCY_MAX = 6;
/** Never fewer than one: a wall is a hold (the plane's job), not a zero. */
export const PULL_CONCURRENCY_MIN = 1;

/** Requests of one kind per rolling minute — under the hub's 600-per-label buckets. */
export const REQUESTS_PER_MINUTE = 480;
/**
 * A hub that advertises its read ceiling (`/api/file-limits` `readsPerMinute`, #204 — 1 800 on a
 * current hub) is paced at this share of it: the rest of the bucket is the cursor reads' and the
 * presence report's. The advertised figure is hub-supplied (DDR-054), so it is clamped: a hub can
 * slow its own sync down to `MIN_TRUSTED_READS_PER_MINUTE`, never talk us past the maximum.
 */
export const ADVERTISED_SHARE = 0.8;
export const MIN_TRUSTED_READS_PER_MINUTE = 60;
export const MAX_TRUSTED_READS_PER_MINUTE = 6000;
const WINDOW_MS = 60_000;

export type RequestKind = 'read' | 'write';

export interface PullPacer {
  /** How many transfers may be in flight right now. */
  limit(): number;
  /** The hub said slow down (a 429, a 5xx with Retry-After): halve. */
  onBackpressure(): void;
  /** The cell's bucket fill timed out for one file: one step down. */
  onStorageMiss(): void;
  /** A pass moved real work and met no wall: one step up. */
  onCleanPass(): void;
  /** The hub advertised its per-label read ceiling: pace reads at a share of it (clamped). */
  setReadCeiling(perMinute: number): void;
  /** Reads per rolling minute in force right now. */
  readsPerMinute(): number;
  /**
   * Wait until one more request of this kind fits in the rolling minute, then charge it. Resolves
   * at once while there is room — a pass that stays under the budget never waits at all.
   */
  admit(kind: RequestKind): Promise<void>;
}

export interface PullPacerOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  start?: number;
  max?: number;
  perMinute?: number;
}

export function createPullPacer(opts: PullPacerOptions = {}): PullPacer {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = Math.max(PULL_CONCURRENCY_MIN, opts.max ?? PULL_CONCURRENCY_MAX);
  const writesPerMinute = Math.max(1, opts.perMinute ?? REQUESTS_PER_MINUTE);
  let readsPerMinute = writesPerMinute;
  let limit = Math.min(max, Math.max(PULL_CONCURRENCY_MIN, opts.start ?? PULL_CONCURRENCY_START));
  // Start times of the requests inside the last minute, oldest first, per kind. Bounded by
  // `perMinute` — `admit` never lets one in past the ceiling.
  const starts: Record<RequestKind, number[]> = { read: [], write: [] };

  const prune = (log: number[], at: number): void => {
    while (log.length > 0 && at - (log[0] as number) >= WINDOW_MS) log.shift();
  };

  return {
    limit: () => limit,
    onBackpressure() {
      limit = Math.max(PULL_CONCURRENCY_MIN, Math.floor(limit / 2));
    },
    onStorageMiss() {
      limit = Math.max(PULL_CONCURRENCY_MIN, limit - 1);
    },
    onCleanPass() {
      limit = Math.min(max, limit + 1);
    },
    setReadCeiling(advertised) {
      if (!Number.isFinite(advertised) || advertised <= 0) return;
      const clamped = Math.min(
        MAX_TRUSTED_READS_PER_MINUTE,
        Math.max(MIN_TRUSTED_READS_PER_MINUTE, advertised)
      );
      readsPerMinute = Math.max(1, Math.floor(clamped * ADVERTISED_SHARE));
    },
    readsPerMinute: () => readsPerMinute,
    async admit(kind) {
      const log = starts[kind];
      const perMinute = kind === 'read' ? readsPerMinute : writesPerMinute;
      for (;;) {
        const at = now();
        prune(log, at);
        if (log.length < perMinute) {
          log.push(at);
          return;
        }
        // The oldest start leaves the window first; come back the moment it does.
        await sleep(Math.max(1, WINDOW_MS - (at - (log[0] as number))));
      }
    },
  };
}

/** The parts of a pass result the follow-up decision reads (a `FilePlaneResult` fits). */
export interface PassOutcome {
  pulled: readonly unknown[];
  pushed: readonly unknown[];
  rateLimited?: unknown;
  authRefused?: true;
  formatRefused?: unknown;
  reanchorHeld?: true;
  requestsExhausted?: true;
  filesCapped?: true;
  budgetExhausted?: true;
  nextAttemptInMs?: number;
}

/**
 * When the NEXT plane pass should run, instead of waiting for the poll tick — issue #204.
 *
 *   0     — the pass moved files and stopped on a COUNT ceiling: there is more of the same, now.
 *   ms    — a path is waiting out a short backoff (a storage miss): come back when it ends, never
 *           sooner than the pass floor.
 *   null  — leave it to the tick: a wall (rate limit, credential, format, re-anchor storm), a pass
 *           that moved nothing (so a pass whose requests all fail can never spin — issue #109), and
 *           a byte-budget stop (the 2 GiB per-pass ceiling, DDR-226 F6, stays a per-tick bound).
 */
export function followUpDelayMs(
  r: PassOutcome,
  timing: { pollMs: number; floorMs: number }
): number | null {
  if (r.rateLimited || r.authRefused || r.formatRefused || r.reanchorHeld) return null;
  const moved = r.pulled.length + r.pushed.length;
  if (moved > 0 && !r.budgetExhausted && (r.requestsExhausted || r.filesCapped)) return 0;
  if (r.nextAttemptInMs !== undefined && r.nextAttemptInMs < timing.pollMs) {
    return Math.max(timing.floorMs, r.nextAttemptInMs);
  }
  return null;
}
