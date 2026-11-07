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
  /** `tracked - delivered - blocked - held - ignored`, floored at 0. */
  remaining: number;
  /**
   * Issue #207 — rows in a folder the project does not sync (`linkedHub.ignoreFolders`). A
   * person's choice, not waiting and not a fault: their own count, outside `remaining`.
   */
  ignored?: number;
  /**
   * Issue #204 — rows this Mac REFUSES to take (a code module from a hub it has not vouched for).
   * Not waiting — nothing moves them but a person's consent — and not "blocked" on the hub's side
   * either, so they get their own count and their own words, said once. Always set by
   * `computeSeedProgress`; optional only so older snapshots still type.
   */
  held?: number;
  /**
   * fix/207 — `held` split by WHY. The status line used to say "N held: shared code not accepted"
   * for both, and on Michal's desktop 6 555 render PNGs moved out of the project (held by the
   * delete rule, `DELETED_HERE_HELD_REASON`) read as 6 942 files of shared code. Always set by
   * `computeSeedProgress`; optional only so older snapshots still type.
   */
  heldCode?: number;
  heldDeletedHere?: number;
  /** Issue #207 (7b) — deleted on this Mac in a large batch, waiting for the person's answer. */
  heldDeleteAsk?: number;
  /**
   * Outstanding rows whose last attempt FAILED and that wait out a backoff (`stuck`, `attempts`
   * ≥ 1) — counted inside `remaining` (they are not delivered), named here so a status line can say
   * "retrying" and which file, instead of "waiting" forever (#204 follow-up). `retryingFile` is the
   * first such row and its reason.
   */
  retrying?: number;
  retryingFile?: { rel: string; reason: string };
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

/**
 * 2.0.5 — the ledger reason for a file this person deleted here while the project keeps deletes
 * to itself (`linkedHub.propagateDeletes: false`). Neither side will move it, so it is held — and
 * no longer counted as delivered, which the field ledger did for 1 814 files that were not here.
 */
export const DELETED_HERE_HELD_REASON =
  'deleted on this Mac — this project does not sync deletions, so the project keeps it and it is not put back here';

/** A row the receiver itself refuses, by consent: held, not waiting. */
export function isHeldByConsent(row: LedgerRow): boolean {
  return (
    row.state === 'stuck' &&
    (row.reason === CODE_MODULE_HELD_REASON || row.reason === DELETED_HERE_HELD_REASON)
  );
}

/**
 * fix/207 — the paths THIS Mac holds because it has not allowed shared code from the hub: the rows
 * behind Sync details' "Allow shared code…" (a `code-consent` held row). Sorted, so the panel's list
 * is stable between passes.
 */
export function codeConsentHeldPaths(rows: Readonly<Record<string, LedgerRow>>): string[] {
  const out: string[] = [];
  for (const [rel, row] of Object.entries(rows))
    if (row.state === 'stuck' && row.reason === CODE_MODULE_HELD_REASON) out.push(rel);
  return out.sort();
}

/**
 * fix/207 — Sync details' sentence for that row (CONTRACT §4: what happened · what is safe · one
 * verb). The verb is the row's button, Allow shared code… — the only place the answer changes in
 * the app (the summary used to read "shared code not accepted on this Mac", a choice nobody could
 * make there).
 */
export function codeConsentHeldDetail(count: number): string {
  const n = count.toLocaleString('en-US');
  return count === 1
    ? '1 file of shared code from this project is waiting: shared code reaches this Mac only once you allow it. Nothing is lost. Allow shared code and it arrives with the next sync.'
    : `${n} files of shared code from this project are waiting: shared code reaches this Mac only once you allow it. Nothing is lost. Allow shared code and they arrive with the next sync.`;
}

/**
 * fix/207 — the status line's words for what this Mac holds, one phrase per reason, so a deleted
 * PNG is never "shared code" and no phrase names a choice the app does not offer.
 */
export function heldWords(
  p: Pick<SeedProgress, 'heldCode' | 'heldDeletedHere' | 'heldDeleteAsk'>
): string[] {
  const out: string[] = [];
  const files = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`;
  const code = p.heldCode ?? 0;
  const deleted = p.heldDeletedHere ?? 0;
  const ask = p.heldDeleteAsk ?? 0;
  if (ask > 0)
    out.push(
      `${files(ask)} deleted on this Mac ${ask === 1 ? 'waits' : 'wait'} for your answer (Sync details)`
    );
  if (code > 0)
    out.push(
      `${files(code)} of shared code ${code === 1 ? 'waits' : 'wait'} for your yes (Sync details)`
    );
  if (deleted > 0) out.push(`${files(deleted)} deleted on this Mac stay deleted here`);
  return out;
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
  let heldCode = 0;
  let heldDeletedHere = 0;
  let heldDeleteAsk = 0;
  let ignored = 0;
  let retrying = 0;
  let retryingFile: { rel: string; reason: string } | undefined;
  const blockedCounts = new Map<BlockedClass, number>();

  for (const [rel, row] of Object.entries(rows)) {
    tracked += 1;
    const state = row.state;
    if (state && DELIVERED.has(state)) {
      delivered += 1;
      continue;
    }
    if (state === 'ignored') {
      ignored += 1;
      continue;
    }
    // Issue #207 (7b) — a delete waiting for the person's answer, and a file kept on the hub: held
    // here by a choice (asked, or made), never "waiting" to move.
    if (state === 'delete-held') {
      held += 1;
      heldDeleteAsk += 1;
      continue;
    }
    if (state === 'hub-only') {
      held += 1;
      heldDeletedHere += 1;
      continue;
    }
    if (isHeldByConsent(row)) {
      held += 1;
      if (row.reason === CODE_MODULE_HELD_REASON) heldCode += 1;
      else heldDeletedHere += 1;
      continue;
    }
    if (state && BLOCKED.has(state)) {
      const cls = classifyBlocked(row);
      blockedCounts.set(cls, (blockedCounts.get(cls) ?? 0) + 1);
      continue;
    }
    if (state === 'stuck' && (row.attempts ?? 0) >= 1) {
      retrying += 1;
      if (retryingFile === undefined || rel < retryingFile.rel) {
        retryingFile = { rel, reason: row.reason ?? 'the last attempt failed' };
      }
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
  const remaining = Math.max(0, tracked - delivered - blockedTotal - held - ignored);

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
    heldCode,
    heldDeletedHere,
    ...(heldDeleteAsk > 0 ? { heldDeleteAsk } : {}),
    ...(ignored > 0 ? { ignored } : {}),
    retrying,
    ...(retryingFile ? { retryingFile } : {}),
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
