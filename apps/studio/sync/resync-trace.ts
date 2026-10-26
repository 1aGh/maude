// sync/resync-trace.ts — S11.11: what Resync reports while it runs and when it is done.
//
// Resync is `syncControl.restart()`: the whole runtime is torn down and booted again, and the file
// plane then compares every tracked file with the cloud copy ("1 204 of 1 318") and sends what is
// newer here / fetches what is newer there. The restart returns long before that comparison is over,
// so the answer a person wants — "3 files sent, nothing else differed" — is only known later. This
// leaf watches the NEW runtime's own status payload (the counters are per runtime, so they start at
// zero for a resync) and, once the file plane has converged, says what happened:
//
//   • `view()`        → rides `GET /_sync-status` as `resync` while a trace is live or just finished
//   • the log line    → `[sync] resync · 1 318 checked · 3 sent · 0 conflicts` (Diagnostics › Logs)
//   • `summary`       → { checked, sent, fetched, conflicts } — the verb and the toast read it
//
// No I/O of its own: it is handed a `read()` for the status and a `log()`; the clock and the timer
// are injectable so the test drives it by hand.

import { groupDigits } from '../client/v2/diagnostics/resync-model.js';
import type { SyncStatusPayload } from './status.ts';

export interface ResyncSummary {
  /** Files compared (the ledger's tracked rows; canvases when the project has no file plane). */
  checked: number;
  /** Files that were newer here and went up. */
  sent: number;
  /** Files that were newer in the cloud and came down. */
  fetched: number;
  /** Files changed on both sides — parked as conflicts, listed in Sync details. */
  conflicts: number;
}

export type ResyncState =
  /** The comparison is still going. */
  | 'running'
  /** The file plane converged: `summary` is final. */
  | 'done'
  /** It stopped before converging (the cloud asked it to slow down, or something is blocked). */
  | 'attention';

export interface ResyncView {
  state: ResyncState;
  startedAt: number;
  finishedAt?: number;
  /** Files accounted for so far (delivered) and the total — the "1 204 of 1 318" pair. */
  done: number;
  total: number;
  summary: ResyncSummary;
}

/** The slice of `SyncRuntime.status()` the trace reads. */
export type ResyncStatusSource = Pick<SyncStatusPayload, 'canvases' | 'coldOpen'> & {
  files?: Partial<NonNullable<SyncStatusPayload['files']>>;
};

export { groupDigits };

/**
 * One reading of the new runtime's status → the view, or null while there is nothing to read yet.
 * Pure. `phase` is the file plane's own verdict (seed-progress.ts), not ours.
 */
export function readResync(
  status: ResyncStatusSource | null | undefined,
  expectFiles: boolean
): Omit<ResyncView, 'startedAt'> | null {
  if (!status) return null;
  const f = status.files;
  const sent = f?.pushed ?? 0;
  const fetched = f?.pulled ?? 0;
  const conflicts = f?.conflicts ?? 0;
  const p = f?.progress;
  if (p) {
    const total = p.tracked;
    const done = Math.min(total, p.delivered);
    const summary = { checked: total, sent, fetched, conflicts };
    if (p.phase === 'converged') return { state: 'done', done: total, total, summary };
    if (p.phase === 'paused' || p.phase === 'blocked')
      return { state: 'attention', done, total, summary };
    return { state: 'running', done, total, summary };
  }
  if (f?.lane === 'v1') {
    // A journal-less hub: no file plane, so no denominator. One v1 pass of the NEW runtime is the whole
    // comparison — the counters are this runtime's, so they are the resync's.
    const checked = f.synced ?? 0;
    return {
      state: 'done',
      done: checked,
      total: checked,
      summary: { checked, sent, fetched, conflicts },
    };
  }
  if (f) {
    // A file plane that has not yet walked its tree: nothing to count yet.
    return {
      state: 'running',
      done: 0,
      total: 0,
      summary: { checked: 0, sent, fetched, conflicts },
    };
  }
  // No file plane in this project (canvases only): the canvases coming into step IS the comparison.
  // When the project DOES sync files, an absent `files` only means the first pass has not reported.
  if (!expectFiles && typeof status.coldOpen?.canvasesMs === 'number') {
    const n = status.canvases ?? 0;
    return {
      state: 'done',
      done: n,
      total: n,
      summary: { checked: n, sent: 0, fetched: 0, conflicts: 0 },
    };
  }
  return null;
}

/** The line Diagnostics › Logs gets (the source column already says "sync"). */
export function resyncLogLine(s: ResyncSummary): string {
  return `[sync] resync · ${groupDigits(s.checked)} checked · ${groupDigits(s.sent)} sent · ${groupDigits(s.conflicts)} conflicts`;
}

export interface ResyncTraceOpts {
  /** The live runtime's status payload (null while the runtime is down / between cycles). */
  read: () => ResyncStatusSource | null | undefined;
  /** Does this project sync files (the plane's `syncFiles` setting)? Decides when "no files yet" means "none". */
  expectFiles?: () => boolean;
  log?: (line: string) => void;
  now?: () => number;
  /** Poll cadence; the timer is `unref`ed. */
  everyMs?: number;
  /** Stop watching after this long without converging. */
  giveUpMs?: number;
  /** Test seams for the timer. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** Called whenever the view changes (the route wires `ctx.bus` here when it wants a push). */
  onChange?: (v: ResyncView) => void;
}

export interface ResyncTrace {
  /** A resync was just started (the restart returned): watch the new runtime. */
  begin(): void;
  /** Take one reading now (the timer's tick; also what `view()` does lazily). */
  tick(): void;
  /** The current view, or null when no resync ran since the server started (or the last one is stale). */
  view(): ResyncView | null;
  stop(): void;
}

/** How long a finished trace stays visible on `/_sync-status` (the toast and the verb read it). */
const KEEP_FINISHED_MS = 10 * 60 * 1000;

export function createResyncTrace(opts: ResyncTraceOpts): ResyncTrace {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((l: string) => console.log(l));
  const everyMs = opts.everyMs ?? 500;
  const giveUpMs = opts.giveUpMs ?? 15 * 60 * 1000;
  const setTimer =
    opts.setTimer ??
    ((fn, ms) => {
      const t = setInterval(fn, ms);
      (t as { unref?: () => void }).unref?.();
      return t;
    });
  const clearTimer = opts.clearTimer ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));

  let current: ResyncView | null = null;
  let timer: unknown = null;

  const halt = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const tick = (): void => {
    if (!current || current.state !== 'running') {
      halt();
      return;
    }
    const r = readResync(opts.read(), opts.expectFiles?.() ?? false);
    let next: ResyncView = r ? { ...current, ...r } : current;
    if (next.state === 'running' && now() - next.startedAt > giveUpMs)
      next = { ...next, state: 'attention' };
    if (next.state !== 'running') {
      next = { ...next, finishedAt: now() };
      halt();
      log(resyncLogLine(next.summary));
    }
    const prev = current;
    current = next;
    if (
      next.state !== prev.state ||
      next.done !== prev.done ||
      next.total !== prev.total ||
      next.summary.sent !== prev.summary.sent ||
      next.summary.fetched !== prev.summary.fetched ||
      next.summary.conflicts !== prev.summary.conflicts
    )
      opts.onChange?.(next);
  };

  return {
    begin() {
      halt();
      current = {
        state: 'running',
        startedAt: now(),
        done: 0,
        total: 0,
        summary: { checked: 0, sent: 0, fetched: 0, conflicts: 0 },
      };
      opts.onChange?.(current);
      timer = setTimer(tick, everyMs);
    },
    tick,
    view() {
      if (!current) return null;
      if (current.state !== 'running' && now() - (current.finishedAt ?? 0) > KEEP_FINISHED_MS)
        return null;
      return current;
    },
    stop: halt,
  };
}
