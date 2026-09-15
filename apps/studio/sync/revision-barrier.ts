// Revision visibility — plan T14 (DDR-241).
//
// One accepted action can change several canvases (a folder move, an agent's
// multi-file edit, a restore). The hub stamps every document it writes for a
// revision with `acceptedRevision` and the number of documents in that
// revision (`acceptedCohort`). A receiving studio must not leave its checkout —
// which is what the renderer and the file tree read — holding half of such a
// revision: canvas A at revision 12 importing a canvas B still at 11 is a
// state the project never had.
//
// So each document's projection ARRIVES here when it is ready to write the
// revision, and the barrier releases the whole cohort together, in one tick,
// once every document has arrived. A document this peer does not hold yet (one
// created in the same action arrives by pull) or will never hold (outside its
// groups) must not wedge the others: after `timeoutMs` the barrier releases
// what it has. A document that is already on disk at the revision (a fresh
// projection's first write) reports `present` and holds nothing.

export interface RevisionBarrier {
  /**
   * A projection is ready to write `revision`. Returns true when the write is
   * HELD — `release` runs later (possibly synchronously, before this returns,
   * when this arrival completes the cohort).
   */
  arrive(revision: number, cohort: number, key: string, release: () => void): boolean;
  /** A document already on disk at `revision` — counts, holds nothing. */
  present(revision: number, cohort: number, key: string): void;
  /** Revisions still waiting (tests/diagnostics). */
  waiting(): number[];
  stop(): void;
}

interface Cohort {
  expected: number;
  arrived: Set<string>;
  held: Map<string, () => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createRevisionBarrier(
  opts: { timeoutMs?: number; log?: Pick<Console, 'warn'> } = {}
) {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const log = opts.log ?? console;
  const cohorts = new Map<number, Cohort>();
  /** Revisions already released — a late arrival writes straight through. */
  let releasedUpTo = 0;
  const released = new Set<number>();
  /**
   * Documents that reported `present` before anyone waited on their revision
   * (a pulled document can land before its sibling's update is flushed). Kept
   * briefly so the cohort, when it opens, already counts them.
   */
  const early = new Map<number, Set<string>>();

  function release(revision: number, reason: 'complete' | 'timeout'): void {
    const c = cohorts.get(revision);
    if (!c) return;
    cohorts.delete(revision);
    if (c.timer) clearTimeout(c.timer);
    released.add(revision);
    if (released.size > 512) {
      // Bounded memory: forget the oldest half; they are long settled.
      const sorted = [...released].sort((a, b) => a - b);
      for (const r of sorted.slice(0, 256)) released.delete(r);
      releasedUpTo = Math.max(releasedUpTo, sorted[255] ?? 0);
    }
    if (reason === 'timeout') {
      log.warn(
        `[sync/revision] revision ${revision}: ${c.arrived.size} of ${c.expected} documents here — showing them without the rest.`
      );
    }
    // One tick: every held write runs back to back.
    for (const fn of c.held.values()) {
      try {
        fn();
      } catch (err) {
        log.warn(`[sync/revision] a held write failed: ${(err as Error).message}`);
      }
    }
  }

  function cohortFor(revision: number, expected: number): Cohort | null {
    if (released.has(revision) || revision <= releasedUpTo) return null;
    let c = cohorts.get(revision);
    if (!c) {
      c = { expected, arrived: new Set(early.get(revision) ?? []), held: new Map(), timer: null };
      early.delete(revision);
      c.timer = setTimeout(() => release(revision, 'timeout'), timeoutMs);
      cohorts.set(revision, c);
    }
    return c;
  }

  const barrier: RevisionBarrier = {
    arrive(revision, cohort, key, fn) {
      if (!(cohort > 1) || !Number.isInteger(revision)) return false;
      const c = cohortFor(revision, cohort);
      if (!c) return false;
      c.arrived.add(key);
      c.held.set(key, fn);
      if (c.arrived.size >= c.expected) release(revision, 'complete');
      return true;
    },
    present(revision, cohort, key) {
      if (!(cohort > 1) || !Number.isInteger(revision)) return;
      // Counts toward a revision somebody is waiting on; never opens one — a
      // document already on disk has nothing to wait for.
      const c = cohorts.get(revision);
      if (!c) {
        if (released.has(revision) || revision <= releasedUpTo) return;
        const set = early.get(revision) ?? new Set<string>();
        set.add(key);
        early.set(revision, set);
        if (early.size > 64) early.delete(Math.min(...early.keys()));
        return;
      }
      c.arrived.add(key);
      if (c.arrived.size >= c.expected) release(revision, 'complete');
    },
    waiting: () => [...cohorts.keys()],
    stop() {
      for (const c of cohorts.values()) if (c.timer) clearTimeout(c.timer);
      cohorts.clear();
      early.clear();
    },
  };
  return barrier;
}
