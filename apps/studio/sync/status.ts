// Sync status surface — Phase 9 Task 8.
//
// Single source of truth for "what is the hub link doing right now", consumed
// by three readers:
//   1. `.design/_sync.json` on disk    — `maude design status` reads it.
//   2. the dev-server bus ('sync:status') — broadcast to browser tabs over WS
//      so the canvas chrome can render the offline/synced/escalation banner.
//   3. GET /_sync-status                — poll fallback for the browser banner.
//
// The store merges the ConnectionMonitor snapshot (online/offline/queuedOps/…)
// with a bounded list of recent conflict notifications (cold-start hub-wins,
// git-pull divergence). Writes are best-effort + atomic-ish (tmp + rename via
// the injected writer); a failed write never throws into the sync hot path.

import type { AssetPushProgress } from './asset-push.ts';
import type { SyncStatusSnapshot } from './connection-state.ts';
import type { SeedProgress } from './seed-progress.ts';

// `cold-start-hub-wins` stays in the union for OLD payload readers (additive
// evolution — the NoSyncablePayload discriminator pattern); new conflicts are
// recorded as `cold-start-diverged` with the DDR-102 winner + snapshot refs.
export type ConflictKind =
  | 'cold-start-hub-wins'
  | 'cold-start-diverged'
  | 'git-pull'
  | 'body-rejected';

export interface SyncConflict {
  slug: string;
  kind: ConflictKind;
  at: number;
  /** DDR-102 — which side the newest-wins resolution kept. */
  winner?: 'local' | 'hub';
  /** DDR-102 — ISO timestamps of the `_history/<slug>/` snapshots taken before
   *  resolution (`/design:rollback` recovery). */
  snapshots?: { local?: string; hub?: string };
  /** DDR-102 fail-closed (F1) — the local snapshot didn't land, so a hub-wins
   *  overwrite was refused (local kept). Surfaces the degraded `_history/` write. */
  snapshotFailed?: boolean;
  /** #121 — source refused before materializing or importing. */
  reason?: 'invalid-source' | 'local-edit' | 'history-failed' | 'merge-budget';
}

export interface SyncStatusPayload extends SyncStatusSnapshot {
  /** Linked hub URL (informational; the token is never included). */
  url: string;
  /** Number of canvases the runtime is syncing. */
  canvases: number;
  /** Recent conflict notifications (most-recent-last, capped). */
  conflicts: SyncConflict[];
  /**
   * When the ConnectionMonitor last spoke, as distinct from when this payload
   * was built (`updatedAt`). Additive — see the note in `payload()`.
   */
  connectionUpdatedAt?: number;
  /**
   * Phase 9.2 (DDR-064) — true when the unified single-shared-doc model is
   * active (MAUDE_SHARED_DOC). Lets `maude design status` + the browser banner
   * show which collaboration model is running. Absent/false = the two-doc path.
   */
  sharedDoc?: boolean;
  /**
   * feature-sync-progress-modal — the DDR-217 asset push's live progress
   * (additive; absent until the first push emit of a boot). Rides the same
   * payload as the doc counts so the Sync panel has one source, not two.
   */
  assets?: AssetPushProgress;
  /**
   * feature-sync-file-plane — Plane B's counts (additive; absent until the
   * first flag-on file pull of a boot). `conflicts` names losers parked in
   * `_trash/<rel>-conflict-<ts>` — the panel line points there, because a
   * conflict a person cannot find is silent loss with extra steps.
   */
  files?: FilePlaneStatus;
  /**
   * feature-before-first-external-users Task 1 — consent-class notices
   * (DDR-064 A7 shared-doc, DDR-079 TSX bodies). These lived only in
   * `console.warn`, which a terminal-free desktop user never sees — the same
   * disease the breaker `held` field cured one section up. Additive; absent
   * until the first notice of a boot. The client renders them in the Sync
   * panel and keeps a machine-local dismiss ack keyed on (id, hub url).
   */
  notices?: SyncNotice[];
}

export interface SyncNotice {
  /** Stable, human-readable key (`shared-doc`, `tsx-bodies`) — the dismiss
   *  ack and the once-per-boot dedupe both key on it. */
  id: string;
  /** One paragraph, in the user's terms — what now leaves this machine and
   *  which config key opts out. */
  text: string;
  severity: 'info' | 'warn';
  at: number;
}

export interface FilePlaneStatus {
  /** Plane files present and equal after the last pass — the steady state. */
  synced: number;
  /** Cumulative files landed this boot. */
  pulled: number;
  /** Cumulative conflicts this boot (either winner); losers are in _trash/. */
  conflicts: number;
  /** Sync v2 — cumulative files sent UP this boot. The v1 lane had no push
   *  half of its own, so this is absent on a journal-less hub. */
  pushed?: number;
  /**
   * A BREAKER IS HOLDING, and this is how anyone finds out.
   *
   * The breakers shipped with their state living only in a `console.warn` and
   * a return field nothing read — so a hold was permanent, invisible, and had
   * no exit. That is worse than DDR-214's "a status surface that lies": the
   * surface was simply absent, while the release leaned on these controls as
   * its justification for shipping deletion without a soak.
   *
   * `kind` says which one, `paths` says what is waiting, and `answer` names
   * the config key that releases it — a hold a person cannot resolve is not a
   * safety control, it is a stall.
   */
  held?: {
    kind: 'delete-out' | 'delete-in' | 'first-anchor' | 'reanchor';
    count: number;
    paths: string[];
    /** One sentence, in the user's terms, about what is waiting and why. */
    detail: string;
  }[];
  /**
   * Files this lane could NOT move on the last pass — issue #109.
   *
   * `held` covers the breakers, which are deliberate refusals this machine
   * made. This covers the other half: a transfer the hub refused, or a write
   * that failed. It had no field at all, so ~200 refused assets rendered as a
   * status bar reading `synced` and a person seeing broken images with no
   * cause anywhere but a terminal they never open. Same disease `held` was
   * added to cure, one lane over.
   */
  failed?: number;
  /**
   * The hub asked us to slow down and the WHOLE LANE is paused until `until`.
   *
   * Distinguished from `failed` because the answer is different: nothing is
   * wrong, nothing is lost, and there is nothing to do but wait — which is
   * exactly what a person cannot infer from a count of failures.
   */
  rateLimited?: { until: number; waiting: number };
  /**
   * THE DORUČENKA (DDR-226 §7) — per-path delivery state.
   *
   * The counts above are what the old lane reported, and they are exactly
   * what could not answer the question three days of dogfood kept asking:
   * "where is THIS file". A total says how many are fine; it cannot point at
   * the one that is not.
   *
   * The counts stay beside it deliberately. A panel derived from the same
   * source it displays cannot be cross-checked, and DDR-214's whole lesson is
   * that a status surface has to be falsifiable — so the raw counters remain
   * as the thing to disagree with.
   */
  delivery?: Record<string, string>;
  /**
   * How many delivery rows were dropped from `delivery` by its cap.
   *
   * The map used to be unbounded — one entry per ledger row, so 2 961 keys for
   * a real project, re-serialized into `_sync.json` AND broadcast over the
   * WebSocket on EVERY status change, including 200 ms-throttled asset-progress
   * emits. Same bounding shape `items`/`itemsTruncated` already uses.
   */
  deliveryTruncated?: number;
  /**
   * THE DENOMINATOR (feature-large-project-seed).
   *
   * Derived from the LEDGER rather than from per-pass results — see
   * `seed-progress.ts` for why the per-pass counters read zero for twenty
   * minutes while 2 961 rows changed underneath them. The raw counters above
   * stay beside it deliberately: a panel derived from the same source it
   * displays cannot be cross-checked, and DDR-214's lesson is that a status
   * surface has to be falsifiable.
   */
  progress?: SeedProgress;
}

export interface SyncStatusStoreOptions {
  url: string;
  canvases: number;
  /** Phase 9.2 (DDR-064) — surfaced in the payload so readers show the model. */
  sharedDoc?: boolean;
  /** Persist the JSON payload (best-effort). */
  write: (payload: SyncStatusPayload) => void;
  /** Broadcast the payload to browser tabs (best-effort). */
  broadcast?: (payload: SyncStatusPayload) => void;
  /** Max conflict notifications retained. Default 20. */
  maxConflicts?: number;
  /** Floor between two writes/broadcasts. 0 disables coalescing (tests). */
  flushIntervalMs?: number;
  now?: () => number;
}

export interface SyncStatusStore {
  /** Merge a fresh ConnectionMonitor snapshot + persist + broadcast. */
  update(snapshot: SyncStatusSnapshot): void;
  /** Record a conflict notification + persist + broadcast. */
  addConflict(conflict: Omit<SyncConflict, 'at'>): void;
  /** feature-sync-progress-modal — merge asset-push progress + persist +
   *  broadcast. Kept in the store (not the monitor): assets are a push lane,
   *  not a connection, and the monitor's state machine must not learn them. */
  updateAssets(progress: AssetPushProgress): void;
  /** feature-sync-file-plane — merge Plane B counts + persist + broadcast.
   *  Same reasoning as `updateAssets`: a lane, not a connection. */
  updateFiles(files: FilePlaneStatus): void;
  /** Record a consent-class notice (A7) + persist + broadcast. Idempotent by
   *  `id` — the notice sites fire once per boot, and a repeat is a no-op
   *  rather than a duplicate row. */
  notice(notice: Omit<SyncNotice, 'at'>): void;
  /** Remove a resolved source-sync warning; consent notices are untouched. */
  clearSourceConflict(slug: string): void;
  /** Current payload (defensive copy). */
  get(): SyncStatusPayload;
}

const DEFAULT_MAX_CONFLICTS = 20;

/** Floor between two status writes/broadcasts. Matches `asset-push.ts`'s own
 *  `PROGRESS_INTERVAL_MS` — the lane that emits fastest sets the pace. */
export const STATUS_FLUSH_MS = 200;

/** Delivery rows one payload carries, actionable-first. See `deliveryTruncated`. */
export const MAX_DELIVERY_ROWS = 300;

export function createSyncStatusStore(opts: SyncStatusStoreOptions): SyncStatusStore {
  const now = opts.now ?? Date.now;
  const maxConflicts = opts.maxConflicts ?? DEFAULT_MAX_CONFLICTS;
  const flushIntervalMs = opts.flushIntervalMs ?? STATUS_FLUSH_MS;
  const conflicts: SyncConflict[] = [];

  let snapshot: SyncStatusSnapshot = {
    // Same reason the monitor is seeded `connecting` (see connection-state.ts):
    // this is the payload a reader gets BEFORE the first monitor snapshot lands,
    // so seeding it `online` re-introduced the born-connected lie one layer out.
    state: 'connecting',
    queuedOps: 0,
    lastSyncAt: null,
    offlineSince: null,
    flash: null,
    updatedAt: now(),
  };

  let assets: AssetPushProgress | undefined;
  let files: FilePlaneStatus | undefined;
  const notices: SyncNotice[] = [];

  function payload(): SyncStatusPayload {
    return {
      ...snapshot,
      // WHEN THIS PAYLOAD WAS BUILT, not when the connection monitor last
      // spoke. `updatedAt` arrived here by spreading the monitor's snapshot,
      // which only `update()` refreshes — so `updateFiles()` and
      // `updateAssets()` flushed payloads carrying a stale timestamp ABOUT
      // THEMSELVES. Measured at 130 s stale against a ledger that was current
      // to within a second, on a file being rewritten continuously. A
      // freshness stamp that lies is worse than none: it is what a person (and
      // `maude design status`) uses to decide whether sync is alive at all.
      updatedAt: now(),
      // The monitor's own stamp, preserved under a name that says what it is,
      // so nothing that depended on the old meaning silently changes meaning.
      connectionUpdatedAt: snapshot.updatedAt,
      url: opts.url,
      canvases: opts.canvases,
      conflicts: conflicts.slice(),
      ...(opts.sharedDoc ? { sharedDoc: true } : {}),
      ...(assets ? { assets } : {}),
      ...(files ? { files } : {}),
      ...(notices.length ? { notices: notices.slice() } : {}),
    };
  }

  /**
   * Write + broadcast, COALESCED.
   *
   * Every emit used to re-serialize the whole payload — including an unbounded
   * per-path delivery map — to disk and to every open tab. During a seed the
   * asset lane alone emits every 200 ms, and the file lane emits per pass, so
   * the cost was paid continuously for a payload nobody could read that fast.
   *
   * `immediate` is not an optimisation escape hatch: conflicts, notices and
   * terminal transitions are the events a person is waiting on, and delaying
   * those by even a debounce window is the class of lie this file exists to
   * avoid.
   */
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFlush = false;

  function emit(): void {
    const p = payload();
    try {
      opts.write(p);
    } catch {
      /* best-effort — never throw into the sync hot path */
    }
    try {
      opts.broadcast?.(p);
    } catch {
      /* best-effort */
    }
  }

  function flush(immediate = false): void {
    if (flushIntervalMs <= 0) {
      emit();
      return;
    }
    if (!immediate && flushTimer !== null) {
      pendingFlush = true;
      return;
    }
    // An immediate flush jumps the queue but still OPENS the window — without
    // that, every urgent write was followed by a free un-coalesced one, so a
    // conflict during a seed re-admitted the whole burst it was jumping ahead of.
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingFlush = false;
    emit();
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Only if something arrived while we were waiting — an idle store must
      // not keep a timer alive forever.
      if (pendingFlush) {
        pendingFlush = false;
        flush();
      }
    }, flushIntervalMs);
    flushTimer.unref?.();
  }

  return {
    update(next) {
      const changed = snapshot.state !== next.state;
      snapshot = next;
      // A connection state CHANGE is the headline; a heartbeat is not.
      flush(changed);
    },
    addConflict(conflict) {
      conflicts.push({ ...conflict, at: now() });
      if (conflicts.length > maxConflicts) conflicts.splice(0, conflicts.length - maxConflicts);
      flush(true);
    },
    updateAssets(progress) {
      assets = progress;
      flush();
    },
    updateFiles(next) {
      files = next;
      // A finished or stalled seed is what a person is waiting to see; a
      // mid-seed tick is not.
      flush(next.progress?.phase === 'converged' || next.progress?.phase === 'blocked');
    },
    notice(next) {
      if (notices.some((n) => n.id === next.id)) return;
      notices.push({ ...next, at: now() });
      flush(true);
    },
    clearSourceConflict(slug) {
      const id = `source-conflict-${slug}`;
      const index = notices.findIndex((n) => n.id === id);
      if (index < 0) return;
      notices.splice(index, 1);
      flush(true);
    },
    get: payload,
  };
}
