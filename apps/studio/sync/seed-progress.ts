// How far the file plane has got — derived from the LEDGER, which is the one
// thing that stayed correct.
//
// THE PROBLEM THIS SOLVES. During two real runs against an 8.8 GB project the
// status payload reported `files: {synced: 0, pushed: 0, pulled: 0}` for twenty
// minutes while 2 961 ledger rows changed underneath it. The counters were not
// broken so much as mis-sourced: `sync/index.ts` derived them from PER-PASS
// results, and a pass where nothing converges is legitimately all zeros. The
// ledger, meanwhile, was current to within a second the whole time and nothing
// read it.
//
// And even correct counters could not answer the question a seed actually
// raises. `synced`, `pushed`, `pulled` are numerators with no denominator, so
// no surface could say "1 412 of 2 961" — only "1 412", which is
// indistinguishable from "1 412 and finished".
//
// A LEAF MODULE, like `limits.ts`, and for the same reason: `status.ts` will
// import this, and this must never import back. It takes ledger rows and
// returns a shape. No disk, no clock beyond what it is handed, no I/O.

import type { DeliveryState, LedgerRow } from './file-ledger.ts';

/** Why nothing is moving, when nothing is moving. */
export type BlockedClass = 'too-large' | 'quota' | 'unreachable' | 'refused';

export type SeedPhase =
  /** Walking the tree; the denominator is not final yet. */
  | 'scanning'
  /** Moving files, with work outstanding. */
  | 'seeding'
  /** A wall we are waiting out — a rate limit, a quota, an unreachable peer. */
  | 'paused'
  /** Outstanding work that no amount of waiting will move on its own. */
  | 'blocked'
  /** Nothing outstanding. */
  | 'converged';

export interface SeedProgress {
  phase: SeedPhase;
  /** Rows in scope — THE DENOMINATOR the old counters never had. */
  tracked: number;
  /** Rows in a terminal-good state. */
  delivered: number;
  /** `tracked - delivered - blocked - held`, floored at 0. */
  remaining: number;
  /**
   * Issue #204 — rows this Mac REFUSES to take (a code module from a hub it has not vouched for).
   * Not waiting — nothing moves them but a person's consent — and not "blocked" on the hub's side
   * either, so they get their own count and their own words, said once. Always set by
   * `computeSeedProgress`; optional only so older snapshots still type.
   */
  held?: number;
  /** Bytes still to move, as far as the ledger knows. Best-effort. */
  bytesRemaining: number;
  /** Outstanding rows no retry will clear on its own, by class. */
  blocked: { class: BlockedClass; count: number }[];
  /** Which ceiling ended the last pass, when one did. */
  passCapped?: 'requests' | 'files' | 'bytes';
  /** null until a real throughput sample exists — NEVER a guess. */
  etaMs: number | null;
  /** When this seed was first observed to have outstanding work. */
  startedAt: number | null;
}

/**
 * States that mean "this file is where it needs to be".
 *
 * `on-hub` counts. A stricter bar (`durable`, `everywhere`) would be more
 * truthful about replication but would make the denominator un-completable for
 * a project whose hub has not finished mirroring — a progress bar that never
 * reaches the end is worse than one that reaches it slightly early, and the
 * mirroring state has its own surface.
 */
const DELIVERED: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  'on-hub',
  'durable',
  'at-peer',
  'ui-healed',
  'everywhere',
]);

/**
 * The ledger reason the file plane writes for a code module this Mac will not take (file-plane.ts,
 * the admission gate). Matched EXACTLY — a reason built from a hub's words always starts `HTTP …` or
 * `The project’s server …`, so a peer cannot write this sentence into a row.
 */
export const CODE_MODULE_HELD_REASON =
  'code modules replicate only from an owner-vouched or loopback hub';

/** A row the receiver itself refuses, by consent: held, not waiting. */
export function isHeldByConsent(row: LedgerRow): boolean {
  return row.state === 'stuck' && row.reason === CODE_MODULE_HELD_REASON;
}

/** States that will not move again without something changing. */
const BLOCKED: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  'refused',
  'referenced-but-unoffered',
]);

export interface SeedProgressInput {
  rows: Record<string, LedgerRow>;
  now: number;
  /** The lane is holding until this instant, if it is. */
  pausedUntil?: number | null;
  /** Why it is holding — carried through to the phase and the wording. */
  pauseCause?: 'hub-asked' | 'unreachable' | 'quota' | null;
  /** Set when the last pass stopped on a ceiling rather than on the work. */
  passCapped?: 'requests' | 'files' | 'bytes';
  /** True while the first scan of this boot has not finished. */
  scanning?: boolean;
  /** Previous result, for `startedAt` continuity and the throughput sample. */
  previous?: SeedProgress | null;
  /** Bytes delivered since `previous` was computed, if the caller knows. */
  deliveredSince?: { bytes: number; ms: number } | null;
}

/**
 * Fold the ledger into one progress shape.
 *
 * Total and pure. Every field is derivable from the rows plus what the caller
 * observed; nothing is inferred from a wall clock this function reads itself.
 */
export function computeSeedProgress(input: SeedProgressInput): SeedProgress {
  const { rows, now } = input;
  let tracked = 0;
  let delivered = 0;
  let bytesRemaining = 0;
  let held = 0;
  const blockedCounts = new Map<BlockedClass, number>();

  for (const row of Object.values(rows)) {
    tracked += 1;
    const state = row.state;
    if (state && DELIVERED.has(state)) {
      delivered += 1;
      continue;
    }
    if (isHeldByConsent(row)) {
      held += 1;
      continue;
    }
    if (state && BLOCKED.has(state)) {
      const cls = classifyBlocked(row);
      blockedCounts.set(cls, (blockedCounts.get(cls) ?? 0) + 1);
      continue;
    }
    // Outstanding. `size` is the stat cache, so it is what we know rather than
    // what is true — a row we have never stat'd contributes nothing, which is
    // why `bytesRemaining` is documented as best-effort rather than exact.
    if (Number.isFinite(row.size)) bytesRemaining += row.size as number;
  }

  const blocked = [...blockedCounts.entries()]
    .map(([cls, count]) => ({ class: cls, count }))
    .sort((a, b) => b.count - a.count);
  const blockedTotal = blocked.reduce((n, b) => n + b.count, 0);
  const remaining = Math.max(0, tracked - delivered - blockedTotal - held);

  const paused =
    typeof input.pausedUntil === 'number' && Number.isFinite(input.pausedUntil)
      ? input.pausedUntil > now
      : false;

  const phase: SeedPhase = input.scanning
    ? 'scanning'
    : paused
      ? 'paused'
      : remaining > 0
        ? 'seeding'
        : blockedTotal > 0
          ? 'blocked'
          : 'converged';

  return {
    phase,
    tracked,
    delivered,
    remaining,
    held,
    bytesRemaining,
    blocked,
    ...(input.passCapped ? { passCapped: input.passCapped } : {}),
    etaMs: estimateEta(bytesRemaining, input.deliveredSince ?? null),
    startedAt: resolveStartedAt(input, remaining, now),
  };
}

/**
 * An ETA, or `null`.
 *
 * NULL UNTIL THERE IS A REAL SAMPLE, and that restraint is the point. During
 * the 2026-09-03 investigation a two-second throughput sample read as "4 MB/s,
 * about ten minutes left" and was reported to a person as such; the sustained
 * rate was ~270 kB/s of retry traffic and the true answer was "never". A
 * fabricated ETA does not merely mislead, it stops people looking.
 *
 * So: no sample, no number. And a sample of zero delivered bytes is not a
 * slow rate, it is no information at all.
 */
function estimateEta(
  bytesRemaining: number,
  sample: { bytes: number; ms: number } | null
): number | null {
  if (!sample || sample.bytes <= 0 || sample.ms <= 0) return null;
  const bytesPerMs = sample.bytes / sample.ms;
  if (!Number.isFinite(bytesPerMs) || bytesPerMs <= 0) return null;
  const ms = bytesRemaining / bytesPerMs;
  if (!Number.isFinite(ms)) return null;
  // A week is not an estimate, it is a way of saying we do not know.
  return ms > 7 * 24 * 3_600_000 ? null : Math.round(ms);
}

/** Keep the original start across ticks; clear it once there is nothing left. */
function resolveStartedAt(input: SeedProgressInput, remaining: number, now: number): number | null {
  if (remaining <= 0) return null;
  const prev = input.previous?.startedAt;
  return typeof prev === 'number' && Number.isFinite(prev) ? prev : now;
}

/**
 * Which wall this row is behind.
 *
 * FROM THE ROW'S OWN `blockedClass`, which the writer set at the moment it
 * refused. The first version matched on `row.reason` and claimed in this very
 * comment that the matching was "never on hub-supplied text" — which was wrong
 * by one hop: `reason` can be a `failureReason()` string embedding a bounded
 * snippet of a hub error body, so a hostile hub answering with a body
 * containing "too big" could steer how its own refusals were labelled. Only
 * cosmetic, and only in the panel, but a classifier a peer can influence is not
 * a classifier.
 *
 * The string fallback stays for rows written before the field existed — bounded
 * to our own sentences, and it degrades to `refused`, which is the honest
 * answer when we do not know.
 */
function classifyBlocked(row: LedgerRow): BlockedClass {
  if (row.blockedClass) return row.blockedClass;
  const reason = (row.reason ?? '').toLowerCase();
  if (reason.startsWith('too big')) return 'too-large';
  if (reason.startsWith("this project's upload allowance")) return 'quota';
  if (reason.startsWith('could not reach')) return 'unreachable';
  return 'refused';
}
