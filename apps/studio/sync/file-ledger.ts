// The desktop file ledger — Sync v2 Increment 3 (DDR-226 §3).
//
// Three jobs, one file:
//
//   1. **The ancestor store.** Per path, the hash this machine last reconciled
//      through. It is what turns "the two sides differ" from a coin flip into
//      a fact (see `decide-file.ts`).
//   2. **The stat cache.** `(size, mtimeMs) → hash`, so a boot reconcile hashes
//      only files that actually moved. On a converged project the steady-state
//      cost is a stat per file and no reads at all.
//   3. **The doručenka.** Per-path delivery state, so "where is file X" is a
//      lookup instead of archaeology across four logs (DDR-214's deferred
//      ledger, now due).
//
// It lives at `<designRoot>/_state/file-ledger/<hubId>.json`. `_state/` is
// already IGNORED in all four DDR-115 lists, so this adds no taxonomy churn and
// no `_*` path anybody has to remember to add anywhere.
//
// **Deleting it is always safe.** It holds no content — only hashes of content
// that exists elsewhere. Losing it forces a re-anchor: every path looks
// first-seen, differences become conflict-copies rather than overwrites, and
// the project converges noisily instead of losing anything.
//
// ── The write-ordering invariant, and why it lives HERE ─────────────────────
//
// The one rule that makes crashes survivable:
//
//     BYTES LAND FIRST. THE ANCESTOR MOVES SECOND.
//
// If we crash between the two, the ancestor LAGS: it names bytes older than
// what is on disk. The next pass then sees local ≠ ancestor and treats it as a
// local change — a conflict-copy at worst, noise. If the order were reversed
// the ancestor would LEAD: it would name bytes that never landed, and the next
// pass would read a real local file as "already reconciled" and let the hub
// overwrite it. That is the eraser class, and it is the reason the ordering is
// not left to callers to remember: `adoptAfter` takes the byte-landing as a
// callback and records the ancestor only on its success. There is no exported
// way to move an ancestor without landing something first.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { atomicWrite } from './atomic-write.ts';

/** Debounce for persisting the ledger. Same figure as the doc journal. */
export const LEDGER_FLUSH_MS = 1_000;

/**
 * Per-path failure backoff: base delay, ceiling, and the jitter that keeps a
 * few hundred failing paths from re-arriving in lockstep.
 *
 * The ceiling is ten minutes rather than something larger because a path that
 * is waiting is a path a person is waiting for. Ten minutes is long enough to
 * stop being the hub's problem and short enough that a recovered hub converges
 * without anyone restarting anything.
 */
export const BACKOFF_BASE_MS = 5_000;
export const MAX_BACKOFF_MS = 10 * 60_000;

/** Exponential with full jitter, clamped. Exported for the tests to reason
 *  about the bounds rather than the draw. */
export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.min(32, Math.trunc(attempts)));
  const ceiling = Math.min(MAX_BACKOFF_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
  // Full jitter: a uniform draw over the whole window, not a band around it.
  // The band shape still lets a synchronised cohort stay synchronised.
  return Math.max(BACKOFF_BASE_MS, Math.round(ceiling * (0.5 + 0.5 * random())));
}

/**
 * How recently a file must have been written for its stat cache to be
 * distrusted. Comfortably above any filesystem's timestamp granularity, and
 * well below "a file somebody stopped editing".
 */
const RECENT_WRITE_MS = 3_000;

/**
 * Where a file has got to, most-severe first.
 *
 * The ORDER is the semantics (DDR-214, applied to files): a refusal outranks a
 * cursor outranks any count. `synced`/`everywhere` is a positive assertion and
 * the pessimistic branch is the default — a state nobody set reads as
 * `local-only`, never as delivered.
 */
export type DeliveryState =
  /** Both sides changed it; a copy is parked and a person has to look. */
  | 'conflict'
  /** We tried and could not — the reason says what to fix. */
  | 'stuck'
  /**
   * The workspace will NOT take this file, and no amount of waiting changes
   * that — it is over the door's size ceiling, or the hourly allowance is
   * spent. Distinct from `stuck` because the answer is different: `stuck` is
   * retried, this is not, and a path that cannot succeed must stop costing a
   * request slot on every pass (2026-09-03: a 465.8 MB video did exactly that,
   * on every boot, forever).
   */
  | 'refused'
  /** Something references this asset and NO peer has ever offered it. */
  | 'referenced-but-unoffered'
  /** On this disk, and the hub has not acknowledged it. */
  | 'local-only'
  /** Upload in flight. */
  | 'pushing'
  /** The hub answered 2xx and gave it a seq. */
  | 'on-hub'
  /** The hub mirrored it to object storage. */
  | 'durable'
  /** At least one other peer's cursor has passed it (and did not refuse it). */
  | 'at-peer'
  /** A heal event was emitted for it (honestly: emitted, not render-acked). */
  | 'ui-healed'
  /** Everywhere we know of. */
  | 'everywhere';

export interface LedgerRow {
  /** THE ANCESTOR — the hash this machine last reconciled through. */
  syncedHash: string | null;
  /** The journal seq that ancestor corresponds to, when we learned it. */
  remoteSeq?: number;
  /**
   * THE HUB'S SIDE, as last learned — this peer's replica of the hub manifest.
   *
   * Load-bearing, and subtle. A cursor read returns a DELTA: a path absent
   * from the page means "no news about it", NOT "the hub does not have it".
   * Feeding that absence to `decideFile` as `remote: null` would read as
   * "the hub lost this file" and push every converged file back up on every
   * pass — absence treated as authority, which is the exact trap DDR-076
   * exists to close, reintroduced one layer up.
   *
   * So the delta UPDATES this, and only a full read (`since=0`) is allowed to
   * clear it.
   */
  remoteHash?: string | null;
  /**
   * STAT CACHE — the hash of what was last OBSERVED on disk, valid while
   * `(size, mtimeMs)` still match.
   *
   * Deliberately separate from `syncedHash`. They differ exactly when this
   * machine has an unreconciled local change, and that difference is the
   * signal `decideFile` reads. Folding them into one field would make the
   * cache hand back an ancestor for bytes that have since changed — which is
   * the ancestor-LEADS failure the whole ordering rule exists to prevent.
   */
  localHash?: string;
  /** Stat cache: the size `localHash` was computed for. */
  size?: number;
  /** Stat cache: the mtime `localHash` was computed for. */
  mtimeMs?: number;
  /** Doručenka. Absent reads as `local-only` — never as delivered. */
  state?: DeliveryState;
  /** One sentence a person can act on. Set with `stuck`/`conflict`. */
  reason?: string;
  /** Where the conflict copy was parked, so the panel can point at it. */
  conflictCopy?: string;
  /**
   * WHY this row is blocked, as a value WE chose — never re-derived from the
   * reason string.
   *
   * `reason` can embed a bounded snippet of a hub-supplied error body
   * (`failureReason()`), so matching on its text means a hostile hub can steer
   * how its own refusals are classified. The writer knows the class at the
   * moment it refuses; recording it removes the guess.
   */
  blockedClass?: 'too-large' | 'quota' | 'unreachable' | 'refused';
  /**
   * PER-PATH FAILURE BACKOFF — consecutive failed attempts for this path.
   *
   * The plane had none, so every pass re-attempted the identical failing set at
   * full rate: on 2026-09-03 a single sponsor logo went up 24 times in 10
   * seconds, and 314 PUTs covered only 44 distinct paths. That is not a retry
   * policy, it is the client helping a struggling hub struggle.
   */
  attempts?: number;
  /**
   * Earliest wall-clock this path may be attempted again.
   *
   * ON THE LEDGER, not in memory, for the same reason the deletion budget is:
   * otherwise "restart the app" is the bypass, and a restart is the ordinary
   * response to "sync seems stuck".
   */
  nextAttemptAt?: number;
  /**
   * The remote hash whose bytes we have ALREADY parked aside.
   *
   * Epoch-degraded parking is otherwise not idempotent: the decision is
   * `noop` + `parkRemote`, so the ancestor deliberately does not move and the
   * next pass finds the identical state — and the copy name carries a
   * millisecond stamp, so it produces a NEW file every time. A hub answering
   * `reanchor` on every request (or rotating its epoch, which is a legitimate
   * event) therefore fills the disk one conflict copy per diverged path per
   * pass, and each copy is then scanned as `create-up` and uploaded back.
   * Remembering which remote we parked makes the second pass a no-op.
   */
  parkedRemote?: string;
  pushedAt?: number;
  pulledAt?: number;
  healedAt?: number;
}

interface LedgerFileShape {
  version: 1;
  hubUrl: string | null;
  /** The journal epoch these ancestors were anchored against. */
  epoch: string | null;
  /** How far through the journal this machine has read. */
  cursor: number;
  updatedAt: number;
  rows: Record<string, LedgerRow>;
  /**
   * Deletions actually applied, per direction, within a rolling window.
   *
   * PERSISTED, and that is the whole point. The first version of the delete
   * breaker recomputed its limit from one pass's worth of decisions, which
   * makes it a rate limit and not a budget: ten per pass, six passes a minute
   * once the hub can poke, and a two-hundred-file project is gone in three
   * minutes without the limit ever tripping. Two per pass was under every arm
   * of it unconditionally, at every project size.
   *
   * A budget has to remember, and it has to remember across a restart, or
   * "restart the app" is the bypass.
   */
  deleteBudget?: { out: DeleteWindow; in: DeleteWindow };
}

/** Deletions applied since `since`, and where they went — for the report. */
interface DeleteWindow {
  since: number;
  count: number;
  recent: string[];
}

export interface FileLedger {
  /** The epoch our ancestors are anchored against, or null before first read. */
  epoch(): string | null;
  cursor(): number;
  /** True when the hub's epoch no longer matches ours — ancestors stop being
   *  overwrite authority until we re-anchor (decide-file's degraded rows). */
  isDegraded(hubEpoch: string | null): boolean;
  /** Adopt a hub epoch + cursor after a successful read. */
  setPosition(epoch: string | null, cursor: number): void;
  /** Forget the cursor (not the ancestors) and re-anchor against a new epoch. */
  reanchor(epoch: string | null): void;

  row(rel: string): LedgerRow | null;

  /**
   * How many deletions this direction has applied inside the live window.
   * Rolls the window forward when it has expired, so a caller only ever sees
   * the current budget.
   */
  deletesInWindow(direction: 'out' | 'in', windowMs: number): number;
  /** Charge applied deletions against the window. Persisted. */
  noteDeletes(direction: 'out' | 'in', rels: readonly string[], windowMs: number): void;
  ancestorOf(rel: string): string | null;
  /** The hub's hash for this path, as last learned. `undefined` = never learned. */
  remoteOf(rel: string): string | null | undefined;
  /** Record what the hub holds. A delta read UPDATES; only a full read clears. */
  noteRemote(rel: string, hash: string | null, seq?: number): void;
  /** After a FULL read: forget every remote we did not just see. */
  pruneRemotes(seen: Set<string>): void;
  /** All rows, for the doručenka. Defensive copy. */
  rows(): Record<string, LedgerRow>;

  /** Cached hash for a file whose (size, mtimeMs) still match. */
  cachedHash(rel: string, size: number, mtimeMs: number): string | null;
  /** This path just changed — drop its stat-cache entry so it is re-read. */
  noteChanged(rel: string): void;
  /** Remember a freshly computed local hash (stat cache only — NOT an ancestor). */
  noteLocal(rel: string, hash: string, size: number, mtimeMs: number): void;

  /**
   * Land bytes, THEN move the ancestor. The only way to move one.
   *
   * `land` must complete the byte-landing (tmp+rename) before it returns. If it
   * throws, the ancestor is untouched and the row is marked `stuck`.
   */
  adoptAfter(
    rel: string,
    hash: string,
    land: () => void | Promise<void>,
    meta?: { remoteSeq?: number; state?: DeliveryState; size?: number; mtimeMs?: number }
  ): Promise<boolean>;

  setState(rel: string, state: DeliveryState, extra?: Partial<LedgerRow>): void;
  forget(rel: string): void;

  /**
   * Is this path inside its backoff window right now?
   *
   * A path answering true must be skipped WITHOUT spending a request slot —
   * charging it against `MAX_REQUESTS_PER_PASS` would let a few permanently
   * failing paths starve every healthy one, which is the shape that made two
   * alligators runs move zero files while sending 616 MB.
   */
  isBackedOff(rel: string, now: number): boolean;
  /** Record one failed attempt and arm the next window. Returns the new delay. */
  noteAttemptFailed(rel: string, now: number): number;
  /** A path that worked: clear the counter and the window. */
  noteAttemptOk(rel: string): void;

  /** The outbox: hashes this machine has in flight, for self-echo detection. */
  outboxAdd(hash: string): void;
  outboxDone(hash: string): void;
  outboxHas(hash: string): boolean;

  flush(): void;
  stop(): void;
  /** Where this ledger persists. Tests and the panel read it. */
  file(): string;
}

/** A stable, filesystem-safe id for a hub URL. */
export function hubIdFor(url: string): string {
  // Deterministic and short. Not a secret: it names a file inside the user's
  // own runtime state, beside a `_sync.json` that already carries the URL.
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i += 1) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '').slice(0, 40);
    } catch {
      return 'hub';
    }
  })();
  return `${host || 'hub'}-${h.toString(16).padStart(8, '0')}`;
}

export interface FileLedgerOptions {
  designRoot: string;
  hubUrl: string;
  now?: () => number;
  flushMs?: number;
  log?: Pick<Console, 'warn'>;
}

export function createFileLedger(opts: FileLedgerOptions): FileLedger {
  const now = opts.now ?? Date.now;
  const flushMs = opts.flushMs ?? LEDGER_FLUSH_MS;
  const log = opts.log ?? console;
  const dir = path.join(opts.designRoot, '_state', 'file-ledger');
  const file = path.join(dir, `${hubIdFor(opts.hubUrl)}.json`);

  const data: LedgerFileShape = load();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const outbox = new Set<string>();
  /** The last state written, `updatedAt` excluded — see `persist`. */
  let lastPersisted: string | null = null;

  function load(): LedgerFileShape {
    const fresh: LedgerFileShape = {
      version: 1,
      hubUrl: opts.hubUrl,
      epoch: null,
      cursor: 0,
      updatedAt: now(),
      rows: {},
    };
    try {
      if (!existsSync(file)) return fresh;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LedgerFileShape>;
      // A ledger recorded against a DIFFERENT hub says nothing about this one:
      // the seqs belong to another log and the ancestors to another project.
      if (parsed?.hubUrl !== opts.hubUrl) return fresh;
      if (parsed.version !== 1 || typeof parsed.rows !== 'object' || parsed.rows === null) {
        return fresh;
      }
      return {
        version: 1,
        hubUrl: opts.hubUrl,
        epoch: typeof parsed.epoch === 'string' ? parsed.epoch : null,
        // `typeof` first: Number.isInteger is a runtime guard, not a narrowing
        // one, so a ledger written by an older build with no `cursor` key read
        // as `number` to the checker while being `undefined` at runtime.
        cursor:
          typeof parsed.cursor === 'number' && Number.isInteger(parsed.cursor) && parsed.cursor >= 0
            ? parsed.cursor
            : 0,
        updatedAt: now(),
        rows: sanitizeRows(parsed.rows as Record<string, unknown>),
      };
    } catch {
      // Corrupt is treated as absent — which forces a safe re-anchor rather
      // than acting on half-parsed ancestors.
      return fresh;
    }
  }

  function sanitizeRows(raw: Record<string, unknown>): Record<string, LedgerRow> {
    const out: Record<string, LedgerRow> = {};
    for (const [rel, value] of Object.entries(raw)) {
      // Proto-pollution reviver discipline, same as every other parse in this
      // tree: this file is on disk and a hostile writer is cheap to imagine.
      if (rel === '__proto__' || rel === 'constructor' || rel === 'prototype') continue;
      if (!value || typeof value !== 'object') continue;
      const r = value as LedgerRow;
      out[rel] = {
        syncedHash: typeof r.syncedHash === 'string' ? r.syncedHash : null,
        ...(typeof r.localHash === 'string' ? { localHash: r.localHash } : {}),
        ...(Number.isInteger(r.remoteSeq) ? { remoteSeq: r.remoteSeq } : {}),
        ...(typeof r.remoteHash === 'string' || r.remoteHash === null
          ? { remoteHash: r.remoteHash }
          : {}),
        ...(Number.isFinite(r.size) ? { size: r.size } : {}),
        ...(Number.isFinite(r.mtimeMs) ? { mtimeMs: r.mtimeMs } : {}),
        ...(typeof r.state === 'string' ? { state: r.state as DeliveryState } : {}),
        ...(typeof r.reason === 'string' ? { reason: r.reason.slice(0, 200) } : {}),
        ...(typeof r.conflictCopy === 'string' ? { conflictCopy: r.conflictCopy } : {}),
        ...(r.blockedClass === 'too-large' ||
        r.blockedClass === 'quota' ||
        r.blockedClass === 'unreachable' ||
        r.blockedClass === 'refused'
          ? { blockedClass: r.blockedClass }
          : {}),
        // BACKOFF STATE IS PART OF THE ROW, so it has to be part of the
        // allowlist. This is an allowlist, not a merge: a field missing from
        // here is written to disk and silently dropped on the next load, which
        // would make the backoff reset on every restart — the exact bypass
        // persisting it was meant to close.
        ...(Number.isFinite(r.attempts) && (r.attempts as number) >= 0
          ? { attempts: Math.min(Math.trunc(r.attempts as number), 1_000) }
          : {}),
        ...(Number.isFinite(r.nextAttemptAt) ? { nextAttemptAt: r.nextAttemptAt } : {}),
      };
    }
    return out;
  }

  function schedule(): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      persist();
    }, flushMs);
    timer.unref?.();
  }

  function persist(): void {
    try {
      // A WRITE THAT CHANGES NOTHING IS NOT FREE. Every plane pass ends in
      // `setPosition` + `flush`, and this file lives under the design root the
      // watcher reports on — so restamping `updatedAt` on an unchanged ledger
      // raised an `fs:any` that scheduled the next pass, which flushed again:
      // a self-fed journal read every ~2 s on a project nobody was touching,
      // and a cloud cell that never slept (2026-10-05, 10.55 instance-hours
      // overnight). Compare the state WITHOUT the stamp; write only news.
      const { updatedAt: _stamp, ...state } = data;
      const body = JSON.stringify(state);
      if (body === lastPersisted && existsSync(file)) return;
      mkdirSync(dir, { recursive: true });
      data.updatedAt = now();
      atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`);
      lastPersisted = body;
    } catch (err) {
      // Never throws into the sync hot path. A ledger we cannot persist costs
      // a re-anchor next boot, which is noise rather than loss.
      log.warn?.(`[sync/ledger] could not persist: ${(err as Error).message}`);
    }
  }

  function rowFor(rel: string): LedgerRow {
    const existing = data.rows[rel];
    if (existing) return existing;
    const created: LedgerRow = { syncedHash: null };
    data.rows[rel] = created;
    return created;
  }

  /** The live window for `direction`, rolled forward if it has expired. */
  function windowFor(direction: 'out' | 'in', windowMs: number): DeleteWindow {
    if (!data.deleteBudget) {
      data.deleteBudget = {
        out: { since: now(), count: 0, recent: [] },
        in: { since: now(), count: 0, recent: [] },
      };
    }
    const w = data.deleteBudget[direction];
    if (now() - w.since >= windowMs) {
      w.since = now();
      w.count = 0;
      w.recent = [];
    }
    return w;
  }

  return {
    epoch: () => data.epoch,
    cursor: () => data.cursor,

    deletesInWindow(direction, windowMs) {
      return windowFor(direction, windowMs).count;
    },

    noteDeletes(direction, rels, windowMs) {
      if (rels.length === 0) return;
      const w = windowFor(direction, windowMs);
      w.count += rels.length;
      // A short tail, so the panel can say WHAT went without the ledger
      // growing without bound on a busy project.
      w.recent = [...w.recent, ...rels].slice(-50);
      schedule();
    },

    isDegraded(hubEpoch) {
      // Before the first read we have no epoch and nothing to be degraded
      // against; a fresh ledger anchors on whatever the hub says.
      if (data.epoch === null || hubEpoch === null) return false;
      return data.epoch !== hubEpoch;
    },

    setPosition(epoch, cursor) {
      data.epoch = epoch;
      if (Number.isInteger(cursor) && cursor >= 0) data.cursor = cursor;
      schedule();
    },

    reanchor(epoch) {
      // The ancestors STAY. They still record what this machine last
      // reconciled, which is true regardless of what the hub's log did; they
      // simply stop being overwrite authority until the next clean read
      // (decide-file's degraded rows). Throwing them away would turn every
      // path into a first-anchor conflict for no gain.
      data.epoch = epoch;
      data.cursor = 0;
      schedule();
    },

    row: (rel) => data.rows[rel] ?? null,
    ancestorOf: (rel) => data.rows[rel]?.syncedHash ?? null,
    remoteOf: (rel) => data.rows[rel]?.remoteHash,

    noteRemote(rel, hash, seq) {
      const r = rowFor(rel);
      r.remoteHash = hash;
      if (seq !== undefined) r.remoteSeq = seq;
      schedule();
    },

    pruneRemotes(seen) {
      // ONLY a full compaction read may say "the hub does not have this".
      // Called with the set of paths that read carried; anything else loses
      // its remembered remote rather than keeping a value the hub has since
      // dropped.
      for (const [rel, r] of Object.entries(data.rows)) {
        if (!seen.has(rel) && r.remoteHash !== undefined) r.remoteHash = null;
      }
      schedule();
    },
    rows: () => JSON.parse(JSON.stringify(data.rows)) as Record<string, LedgerRow>,

    cachedHash(rel, size, mtimeMs) {
      const r = data.rows[rel];
      if (!r || r.size !== size || r.mtimeMs !== mtimeMs) return null;
      // THE MTIME-GRANULARITY GUARD. `(size, mtime)` is a good enough identity
      // for a file that has been sitting still, and a poor one for a file
      // edited moments ago: two same-length writes inside the filesystem's
      // timestamp resolution are indistinguishable, and trusting the cache
      // there means a real edit is simply never noticed. rsync has carried
      // this same guard for the same reason.
      //
      // So a recently-touched file is always re-read. It costs one hash of one
      // file at exactly the moment somebody is working on it, and it buys back
      // the class of silently-unsynced edit.
      if (now() - mtimeMs < RECENT_WRITE_MS) return null;
      return r.localHash ?? null;
    },

    noteChanged(rel) {
      // The watcher told us this path moved. Drop the stat cache for it so the
      // next scan reads the bytes rather than trusting a stamp — the cheap,
      // exact version of the guard above.
      const r = data.rows[rel];
      if (!r) return;
      r.localHash = undefined;
      r.size = undefined;
      r.mtimeMs = undefined;
      schedule();
    },

    noteLocal(rel, hash, size, mtimeMs) {
      // Records an OBSERVATION, never a reconciliation. This is what makes a
      // boot reconcile cheap: next time, a file whose (size, mtime) still
      // match is not read at all.
      const r = rowFor(rel);
      r.localHash = hash;
      r.size = size;
      r.mtimeMs = mtimeMs;
      // A file whose bytes differ from the ancestor has unsent work on it, and
      // saying so is the honest default — `local-only` is the pessimistic
      // branch, and nothing here may claim delivery.
      if (r.syncedHash !== hash && !r.state) r.state = 'local-only';
      schedule();
    },

    async adoptAfter(rel, hash, land, meta) {
      try {
        await land();
      } catch (err) {
        const r = rowFor(rel);
        r.state = 'stuck';
        r.reason = (err as Error).message.slice(0, 200);
        schedule();
        return false;
      }
      // ONLY here. Bytes are on disk; the ancestor may move.
      const r = rowFor(rel);
      r.syncedHash = hash;
      // The observation moves with it — what landed IS what is on disk now,
      // so leaving a stale `localHash` behind would make the very next pass
      // read a freshly-reconciled file as locally changed.
      r.localHash = hash;
      if (meta?.remoteSeq !== undefined) r.remoteSeq = meta.remoteSeq;
      if (meta?.size !== undefined) r.size = meta.size;
      if (meta?.mtimeMs !== undefined) r.mtimeMs = meta.mtimeMs;
      if (meta?.state) {
        r.state = meta.state;
      } else if (
        r.state === 'stuck' ||
        r.state === 'conflict' ||
        r.state === 'referenced-but-unoffered'
      ) {
        // A resolved problem must stop being reported as a problem. Dropping
        // the state (rather than inventing a cheerful one) leaves the row at
        // the pessimistic default — we no longer know it is stuck, and we are
        // not claiming it is delivered either. Leaving the old value would be
        // the "status lies" failure DDR-214 exists to end, just slower.
        r.state = undefined;
      }
      r.reason = undefined;
      r.conflictCopy = undefined;
      // B13 (post-1.0 burn-down) — the park memo dies with the conflict it
      // memoised. `parkedRemote` used to survive convergence forever, so once
      // hash H was memoised for a path, H was never parked again — after the
      // user deleted the copy, after the row re-diverged, after a `_trash/`
      // prune. A hub re-offering H a week later got a `noop` with no
      // recoverable copy anywhere, while the row still claimed one was made.
      r.parkedRemote = undefined;
      schedule();
      return true;
    },

    setState(rel, state, extra) {
      const r = rowFor(rel);
      r.state = state;
      if (extra) Object.assign(r, extra);
      schedule();
    },

    forget(rel) {
      delete data.rows[rel];
      schedule();
    },

    isBackedOff(rel, now) {
      const next = data.rows[rel]?.nextAttemptAt;
      if (!Number.isFinite(next)) return false;
      // A window that ends absurdly far out is a corrupted or hostile row, not
      // a backoff — treat it as expired rather than letting it park a path
      // forever. The ledger is a local file, but a restore or a clock jump can
      // still put nonsense in it.
      if ((next as number) - now > MAX_BACKOFF_MS) return false;
      return now < (next as number);
    },

    noteAttemptFailed(rel, now) {
      const r = rowFor(rel);
      const attempts = (Number.isFinite(r.attempts) ? (r.attempts as number) : 0) + 1;
      r.attempts = attempts;
      const delay = backoffDelayMs(attempts);
      r.nextAttemptAt = now + delay;
      schedule();
      return delay;
    },

    noteAttemptOk(rel) {
      const r = data.rows[rel];
      if (!r) return;
      if (r.attempts === undefined && r.nextAttemptAt === undefined) return;
      r.attempts = undefined;
      r.nextAttemptAt = undefined;
      schedule();
    },

    outboxAdd: (hash) => {
      outbox.add(hash);
    },
    outboxDone: (hash) => {
      outbox.delete(hash);
    },
    outboxHas: (hash) => outbox.has(hash),

    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      persist();
    },
    stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      persist();
    },
    file: () => file,
  };
}
