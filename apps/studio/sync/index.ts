// Sync runtime entry point — Phase 9 Task 4 wiring.
//
// Public surface for the dev-server boot:
//
//   const runtime = createSyncRuntime(ctx);
//   if (runtime) await runtime.start();
//   // ... later ...
//   await runtime.stop();
//
// Returns null when the project is unlinked (`.design/config.json` has no
// `linkedHub` field) — preserves solo mode behavior bit-for-bit. When linked:
// resolves the per-machine token, opens one HocuspocusProvider + sync agent
// per canvas, and wires the existing ctx.bus 'fs:any' events through the
// agent's echo guard.
//
// HocuspocusProvider import is dynamic so a misconfigured project (linked but
// the provider lib didn't install for some reason) prints a useful error
// instead of crashing the dev-server boot.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { renewHubCredential } from '../cloud/renew.ts';
import { Y_TYPES } from '../collab/persistence.ts';
import type { Context, LinkedHub } from '../context.ts';
import { createHistory } from '../history.ts';
import { SYNTHETIC_FS_DELAY_MS } from '../hmr-broadcast.ts';
import { type CanvasSyncAgent, createCanvasSyncAgent } from './agent.ts';
import { isPushableAssetRel, pushAssets } from './asset-push.ts';
import { atomicWrite } from './atomic-write.ts';
import { type CellPairing, resolveCellPairing, sanitizeForLog } from './cell-pairing.ts';
import {
  canvasPathFromDoc,
  clearMovedTo,
  movedToFromDoc,
  stampCanvasPath,
  stampMovedTo,
} from './codec.ts';
import {
  type ConnectionMonitor,
  createConnectionMonitor,
  type ProviderStatus,
} from './connection-state.ts';
import { createCtlProvider } from './ctl-provider.ts';
import { createRescanScheduler, diffCanvasSet, type RescanScheduler } from './discovery.ts';
import { createDocNameResolver } from './doc-name.ts';
import { createEchoGuard } from './echo-guard.ts';
import { createFileLedger } from './file-ledger.ts';
import { createFilePlane, MAX_DORUCEKA_ROWS } from './file-plane.ts';
import { type FilePullResult, pullFiles } from './file-pull.ts';
import { createFsReader, type FsReader } from './fs-mirror.ts';
import { type HubDocRow, hubHolds, indexHubDocs } from './hub-listing.ts';
import { getHubRecord } from './hubs-config.ts';
import { loadJournal, type SyncJournal } from './journal.ts';
import { hasLedger, hubCapabilities } from './journal-client.ts';
import { isLoopbackHost } from './loopback.ts';
import { migrateFlatFallback } from './migrate-flat-fallback.ts';
import { migrateSeed } from './migrate-seed.ts';
import { ORIGINS } from './origins.ts';
import { createDocProjection, type DocProjection } from './projection.ts';
import {
  describeRemoteDiff,
  diffRemoteDocs,
  fetchRemoteListing,
  pullTargets,
  type RemoteTombstone,
  resolvePulledTarget,
  slugFromDocName,
  stateDocumentGone,
  tombstonedSlugs,
} from './remote-docs.ts';
import { computeSeedProgress } from './seed-progress.ts';
import { createSyncStatusStore, type SyncStatusStore } from './status.ts';
import { quarantineCanvas } from './tombstone-apply.ts';
import { writeUntrustedMarkers } from './untrusted.ts';

/** A minimum-surface stand-in for the HocuspocusProvider's runtime API. */
export interface SyncProvider {
  readonly document: Y.Doc;
  /**
   * The provider's hub-synced Awareness, when it exposes one. Phase 9 Task 5
   * bridges this to the collab Room's Awareness so cursors relay through the
   * hub. Optional — a provider without awareness (or a test stub) just skips
   * the bridge.
   */
  readonly awareness?: Awareness;
  /**
   * Resolves when the first hub sync handshake completes.
   *
   * `signal` lets a caller that gives up ALSO detach the underlying listener.
   * Without it, every abandoned wait leaks a `synced` listener plus its closure
   * for the life of the provider — bounded at one per slug while a wedged
   * single-flight latch kept the caller from retrying, and UNBOUNDED the moment
   * that latch was correctly fixed to release (verification review 2026-09-03,
   * N2): one per slug per settle window per flap, all firing at once if a sync
   * ever lands. Optional, so a test stub or a provider without the plumbing is
   * unaffected.
   */
  onceSynced(signal?: AbortSignal): Promise<void>;
  /**
   * Subscribe to WS connection-status transitions (Phase 9 Task 8 offline
   * mode). Returns an unsubscribe fn. Optional — a test stub or a provider
   * without status events just isn't monitored (treated as always-online).
   */
  onStatus?(cb: (status: ProviderStatus) => void): () => void;
  /**
   * DDR-102 — subscribe to hub auth rejections for this document. Returns an
   * unsubscribe fn. Optional — a stub without it just isn't classified.
   */
  onAuthFailed?(cb: (info: { reason: string }) => void): () => void;
  destroy(): void;
}

/* ------------------------------------------------- auth-failure classification */

/** DDR-102 — rejection classes the runtime distinguishes. `rate-limit` and
 *  `generic` are transient (the runtime re-authenticates the refused document
 *  after one hub window, paced and backed off — see `AUTH_TRANSIENT_RETRY_MS`);
 *  `not-authorized` and `invalid-token` are permanent (retrying spams the hub
 *  bucket — destroy the provider and re-probe on a slow timer instead). */
export type AuthFailureClass = 'rate-limit' | 'not-authorized' | 'invalid-token' | 'generic';

/** Map a raw hub rejection reason to a class. New hubs send distinct reasons
 *  (DDR-102 hub fix); old hubs send the Hocuspocus default `permission-denied`
 *  → `generic` (interop-safe degradation). */
export function classifyAuthFailure(raw: string): AuthFailureClass {
  const s = raw.toLowerCase();
  // Permanent classes FIRST. The hub's invalid-token bucket refuses with
  // "invalid token — rate limited, retry in up to 60s": both substrings are
  // present, and testing 'rate limit' first filed an expired credential under
  // the transient class — so the runtime retried into the very bucket
  // refusing it, and the one cause that needed a person never surfaced.
  if (s.includes('invalid token')) return 'invalid-token';
  if (s.includes('not authorized')) return 'not-authorized';
  if (s.includes('rate limit')) return 'rate-limit';
  return 'generic';
}

export const AUTH_WARN_DEBOUNCE_MS = 2_000;
export const AUTH_REPROBE_MS = 5 * 60 * 1000;
/**
 * How long a transiently-refused document (`rate-limit` / `generic`) waits
 * before the runtime asks the hub again — one full hub window, since the
 * refusal itself says "retry in up to 60s".
 *
 * The runtime owns this retry because nothing else will do it. These classes
 * used to be left to "the provider's built-in backoff", which does not exist
 * per document under DDR-102 multiplexing: a provider re-sends its token only
 * when the SHARED socket opens, and a partial refusal never closes a socket
 * that the documents which did authenticate keep busy. 16 of 112 canvases sat
 * `auth-rejected` for the life of the process that way (RCA
 * issue-sync-rate-limited-docs-never-retried, 2026-09-11).
 *
 * Repeat refusals of the same document double this, capped at the re-probe
 * interval; a handshake that lands resets it.
 */
export const AUTH_TRANSIENT_RETRY_MS = 60_000;
/** Random spread added to each transient retry, so peers refused in the same
 *  burst do not all come back on the window boundary together. */
export const AUTH_TRANSIENT_JITTER_MS = 15_000;
/**
 * Most transient re-authentications inside any `AUTH_TRANSIENT_RETRY_MS` span.
 * A quarter of the hub's default valid-token ceiling (600/min): a 16-document
 * retry never notices it, and a 1 000-canvas project cannot turn its own
 * recovery into the next burst (the F1 lesson, applied to this lane).
 */
export const AUTH_TRANSIENT_BATCH = 150;
export const BOOT_SETTLE_TIMEOUT_MS = 15_000;
/** F1 — minimum wall-clock between renewal attempts. A burst of rejections
 *  collapses to one renewal (single-flight); the NEXT burst waits this out. */
export const RENEW_MIN_INTERVAL_MS = 60_000;
/**
 * F1 — consecutive successful renewals with NO PROGRESS in between before the
 * runtime stops renewing and lets the link surface as refused/stalled.
 *
 * The cap itself is load-bearing: it is what stopped a reproduced 2 342
 * renewals/s storm (2026-08-10 security review). What changed on 2026-09-03 is
 * the definition of "progress".
 *
 * It used to mean ONLY a completed doc handshake, on the reasoning that "a
 * renewal that fixed the credential clears at least one doc". That is true
 * exactly when the doc lane is the lane with work. During a long file seed
 * against an already-converged doc lane (85/87 synced, no handshakes left to
 * land) there is nothing to clear — so every legitimate pre-expiry renewal
 * burned a slot, three of them exhausted the cap, and the runtime stopped
 * renewing while the file plane was still transferring. A delivered FILE now
 * counts too (`onProgress` on the file plane).
 */
export const RENEW_MAX_WITHOUT_PROGRESS = 3;
/** F2 — setTimeout clamps delays above this (2^31-1) to 1 ms, turning a
 *  far-future expiry into a tight renewal loop. Clamp before we hand it over. */
/**
 * Quiet window before a canvas-set change triggers a rescan.
 *
 * Slightly longer than `canvas-list-watch.ts`'s own 150 ms, on purpose: a create
 * writes the `.tsx` and then the `.meta.json`, and attaching in the gap would
 * sync a canvas whose sidecar is about to say `syncable: false`. Letting the
 * cheaper watcher settle first means the rescan sees a finished canvas.
 */
export const DISCOVERY_DEBOUNCE_MS = 400;

/**
 * How often a peer re-asks the hub what the project contains.
 *
 * The floor is set by what a person would call "immediately" for a canvas
 * somebody else just made, and the ceiling by the fact that this runs per peer,
 * per project, forever. 20 s is a name-and-size listing — a few hundred bytes —
 * and it is the ONLY discovery lane a hub of any version can serve.
 */
export const REMOTE_POLL_MS = 20_000;

/** Floor between two serve-log seed-progress lines. Long enough not to become
 *  the next thing that buries the log. */
export const SEED_PROGRESS_LOG_MS = 15_000;
/** How often the stall watchdog looks (issue #118). Cheap — one snapshot. */
export const STALL_CHECK_MS = 30_000;
/**
 * "Socket connected, not one document synced" for this long is a stall, not a
 * slow handshake. Comfortably above a cold cell's worst observed wake (a
 * measured `/health` on a sleeping cell answered in 14 s) and above the boot
 * settle ceiling, so a healthy-but-slow link is never interrupted.
 */
export const STALL_RECONNECT_AFTER_MS = 3 * 60 * 1000;
/** Floor between watchdog-forced reconnects — a hub that is simply down must
 *  not be turned into a reconnect storm by its own silence. */
export const STALL_RECONNECT_MIN_MS = 5 * 60 * 1000;
/**
 * Per-ATTEMPT deadline for the shared hub socket.
 *
 * The provider defaults to `timeout: 0` — no deadline at all — and its retry
 * attempt resolves only on the first MESSAGE. A DO holding an upgrade open
 * while a container boots therefore parks one attempt indefinitely, and
 * `onClose` refuses to re-arm while a retry chain is live
 * (`if (!this.cancelWebsocketRetry …)`), so the whole socket goes deaf. A
 * finite attempt is what turns that into a retry.
 */
/**
 * Random spread added ONCE per runtime to the stall threshold.
 *
 * A cell sleeping (or a hub restarting) drops every peer's socket in the same
 * instant, so without this every peer's threshold expires inside one
 * `STALL_CHECK_MS` tick of every other and they all re-authenticate N documents
 * at once — the DDR-102 2026-06-11 retry storm, re-armed automatically every
 * few minutes (attacker review 2026-09-03, F6). The floor below backs off on
 * repeat for the same reason.
 */
export const STALL_JITTER_MS = 120 * 1000;
/** Ceiling for the backed-off floor between forced reconnects. */
export const STALL_RECONNECT_MAX_MS = 30 * 60 * 1000;

/**
 * Settle window before a local write triggers a file-plane pass.
 *
 * Long enough that saving a file (which many editors do as several writes)
 * costs one pass, short enough that "I dropped a picture in" still feels
 * immediate.
 */
export const FILE_PASS_DEBOUNCE_MS = 400;

/**
 * The floor between two file-plane passes — issue #109.
 *
 * The debounce coalesces a burst of local writes; it does nothing about a
 * steady drip, and a hub's file-event channel is a steady drip by design
 * ("cloud changes now arrive in seconds"). 400 ms of spacing times 200
 * requests a pass is 30k requests a minute at a door that opens 600 times.
 * Two seconds is still well inside "arrives in seconds" and puts the client's
 * ceiling an order of magnitude below the server's instead of above it.
 */
export const MIN_PASS_INTERVAL_MS = 2_000;

/**
 * Settling delay for an OFF-SCHEDULE poll (reconnect).
 *
 * Not zero: a reconnect is a burst — every provider re-handshakes — and asking
 * the hub for the listing in the middle of that buys a slower answer and a
 * needless second one. Short enough that a person does not experience it.
 */
export const REMOTE_POLL_SOON_MS = 1_500;

/**
 * The floor between two POKE-DRIVEN passes — DDR-226 §9's promised cooldown.
 *
 * `pollRemoteSoon` coalesces a burst, which is a debounce, not a cooldown: it
 * caps how many passes a burst collapses into and says nothing about sustained
 * rate. A hub emitting a poke every 1.5 s therefore drove a full document poll
 * + asset pass + `.design/` tree walk at roughly 13x the intended cadence,
 * indefinitely, with no counter that tripped — sustained CPU, disk and battery
 * on the victim, from the component DDR-054 calls untrusted, and the multiplier
 * that made the conflict-copy amplification practical.
 *
 * Half the scheduled poll: fast enough that a poke is still the reason cloud
 * edits arrive in seconds, bounded enough that spam buys almost nothing.
 */
export const POKE_COOLDOWN_MS = REMOTE_POLL_MS / 2;

/**
 * How many previously-unknown canvases one listing may land.
 *
 * A ceiling on the TOTAL is not enough on its own: a hub that answers with
 * thousands of names would still create thousands of files, providers and
 * `_untrusted` entries inside a single tick before anything else got to run.
 * A real project gains canvases a few at a time; a burst larger than this is a
 * hub behaving unlike any project, and the rest simply arrive on later polls.
 */
export const MAX_PULLS_PER_POLL = 25;

export const MAX_TIMER_DELAY_MS = 2_147_483_647;
/** F2 — a hub-reported `expiresAt` further out than this is not believed for
 *  scheduling (cloud cells issue ≤ 12 h; a month is already implausible). */
export const MAX_CREDENTIAL_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A hub-reported `expiresAt` sane enough to schedule against, or null.
 *
 * F2: the value crosses the DDR-054 trust boundary (a hub picks it) and is fed
 * to `setTimeout`. A non-integer, a past stamp, or one absurdly far out (skew,
 * or a hostile hub planting a far-future value to arm a tight loop) must not
 * schedule a renewal — null means "no timer", the safe pre-existing behaviour.
 * A credential already expired simply falls to the invalid-token path instead.
 */
export function validExpiry(raw: unknown, nowMs: number = Date.now()): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw <= nowMs) return null;
  if (raw - nowMs > MAX_CREDENTIAL_LIFETIME_MS) return null;
  return raw;
}

const AUTH_CLASS_HINT: Record<AuthFailureClass, string> = {
  'rate-limit':
    'refused on volume — retrying these in ~60 s, in paced batches (no restart needed). If this repeats every boot, the hub’s HUB_CONN_RATE_LIMIT is below this project’s size (DDR-102 hubs default to 600/min for valid tokens; every canvas authenticates separately).',
  'not-authorized':
    "the token's scope does not cover these canvases — mint a hub-wide token (`maude hub token generate --scope '*'` or an admin-UI invite) and re-link. Retries stopped; re-probing in 5 min.",
  'invalid-token':
    'the stored token was rejected — re-run `maude design link <url> --token …` on this machine. Retries stopped; re-probing in 5 min.',
  generic:
    'the hub refused auth without a specific reason (older hub?) — retrying these in ~60 s; if it keeps refusing, check `maude design status` and the hub logs.',
};

/**
 * Structural surface of the collab registry the runtime needs for Task 5.
 * Defined here (rather than imported from collab/) to avoid a dev-server
 * module cycle — the real `Registry` satisfies it.
 */
export interface AwarenessRegistry {
  attachHubAwareness(slug: string, awareness: Awareness): () => void;
  /** Phase 9.1 — relay a hub-pushed comment/annotation snapshot into a live
   *  room (wholesale, in-process) so the peer's canvas reflects it immediately
   *  and the room's own debounced persist can't clobber the synced state back.
   *  Optional so file-sync-only tests can pass a minimal registry. */
  syncRoomFromComments?(slug: string, comments: readonly unknown[]): void;
  syncRoomFromAnnotations?(slug: string, svg: string): void;
  /**
   * Phase 9.2 (DDR-064) — the single cached `Y.Doc` for a slug. When present
   * AND `ctx.sharedDoc` is set, the runtime attaches the HocuspocusProvider to
   * THIS doc instead of a fresh one (the convergence: one doc, both providers).
   * Optional so file-sync-only tests can pass a minimal registry.
   */
  getDoc?(slug: string): Y.Doc;
  /** Keep a shared-doc room alive while its provider is attached (drop guard). */
  pin?(slug: string): void;
  /** Release the shared-doc pin on runtime stop. */
  unpin?(slug: string): void;
}

/** Factory the runtime calls per discovered canvas. Default uses Hocuspocus. */
export type ProviderFactory = (args: {
  url: string;
  token: string;
  documentName: string;
  /**
   * Phase 9.2 (DDR-064) — when set, the provider MUST attach to this existing
   * `Y.Doc` (the shared room doc) instead of creating its own. The runtime
   * passes it only when `ctx.sharedDoc` is on and the registry exposes
   * `getDoc`. Default factory: `args.document ?? new Y.Doc()`.
   */
  document?: Y.Doc;
}) => SyncProvider | Promise<SyncProvider>;

export interface SyncRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Take ownership of canvases discovered AFTER `start()` — the incremental
   * half of `start()`'s boot set. Returns how many were newly attached
   * (already-attached slugs are skipped, not re-opened).
   *
   * Deliberately NOT a restart: a restart re-links every canvas in the project
   * and costs a full handshake fan-out, which is why the Resync button is
   * rate-limited. Adoption is per-canvas and cheap, so it can run on every
   * discovery without the user authorising anything.
   */
  adopt(canvases: readonly CanvasDescriptor[]): Promise<number>;
  /**
   * Give up canvases that left the project. Returns how many were released.
   *
   * NOT A DELETION, and the distinction is the whole delete lane: this says
   * "this machine stopped carrying it", which the project is right to ignore.
   * Stating that a canvas is GONE travels on the `canvas-deleted` bus event that
   * `api.ts` emits from its privileged delete route — the one signal that
   * carries intent rather than a filesystem observation.
   */
  release(slugs: readonly string[]): Promise<number>;
  /**
   * Run the local canvas rescan immediately instead of waiting for the debounce.
   *
   * The discovery loop is event-driven (`canvas-list-update`); this is the seam
   * tests use to make it deterministic, and the hook a caller can use to force a
   * check without paying for a full runtime cycle the way Resync does.
   */
  rescanNow(): Promise<void>;
  /**
   * Ask the hub what the project contains right now, and pull down anything
   * this peer does not have — the remote half of `rescanNow`, off the poll's
   * schedule. Test seam, and the hook behind a manual "check now".
   */
  pullRemoteNow(): Promise<void>;
  /** Number of active per-canvas agents. */
  size(): number;
  /** Test inspection — get the agent for a slug if one was created. */
  agentFor(slug: string): CanvasSyncAgent | undefined;
  /** Current offline/sync status payload (Task 8), or null when unlinked. */
  status(): import('./status.ts').SyncStatusPayload | null;
  /**
   * Stop the asset sweep child, if one is running. `false` means there was
   * nothing to cancel — the caller reports that, rather than pretending.
   * Scoped to the sweep on purpose: killing a reconnect mid-handshake is not a
   * meaningful gesture, killing a multi-hundred-megabyte upload is.
   */
  cancelAssetSweep(): boolean;
  /**
   * The MOVE protocol's first half (codec `stampMovedTo`): stamp this slug's
   * document retired-by-move to `toRel`, push the stamp to the hub, then
   * release the canvas. Called by `moveCanvas` BEFORE it renames the file —
   * which is also why this must not quarantine anything: the file at the old
   * path is about to be renamed by the caller, not thrown away.
   *
   * Returns false when this runtime does not carry the slug (not synced, or
   * flag-off) — the caller then proceeds with the plain local move.
   */
  retireForMove(fromSlug: string, toRel: string): Promise<boolean>;
}

export interface CreateSyncRuntimeOptions {
  /** Override the HocuspocusProvider factory (test injection). */
  providerFactory?: ProviderFactory;
  /** Force-enable/disable adopt mode (overrides cfg.linkedHub.adopt). */
  adopt?: boolean;
  /** Discovery override — pass an explicit canvas list instead of scanning. */
  canvases?: CanvasDescriptor[];
  /**
   * Collab registry — when provided, each provider's Awareness is bridged to
   * the matching Room so cursors relay through the hub (Task 5). Omitted in
   * unit tests that only exercise the file-sync path.
   */
  registry?: AwarenessRegistry;
  /**
   * Stall-watchdog timings + clock. TEST INJECTION ONLY (see `stallCheck`).
   *
   * The watchdog shipped with no behavioural coverage at all — three review
   * rounds each found a HIGH inside it, and none of them could have been caught
   * by a test, because nothing could reach it: it required the OWNED factory
   * and real wall-clock minutes. This is the seam that makes its predicate,
   * its jitter and its backoff assertable.
   */
  stall?: {
    checkMs?: number;
    afterMs?: number;
    minMs?: number;
    jitterMs?: number;
    now?: () => number;
  };
  /**
   * Override the offline-mode connection monitor (Task 8 test injection —
   * lets tests pass injectable timers/clock). Defaults to a real monitor that
   * writes `_sync.json` + broadcasts 'sync:status' on the bus.
   */
  connectionMonitor?: ConnectionMonitor;
  /** Override the status store (Task 8 test injection). */
  statusStore?: SyncStatusStore;
  /**
   * DDR-102 — auth-failure + boot-settle knobs (test injection, mirrors the
   * connection-state injectable-timer pattern).
   */
  auth?: {
    /** Debounce for the ONE aggregated rejection warn. Default 2 s. */
    warnDebounceMs?: number;
    /** Re-probe interval for permanently-rejected docs. Default 5 min. */
    reprobeMs?: number;
    /** Boot summary settle ceiling. Default 15 s. */
    settleTimeoutMs?: number;
    setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (h: ReturnType<typeof setTimeout>) => void;
    /**
     * Silent credential renewal (cloud workspaces). Called single-flight at
     * ~80 % of the stored credential's remaining life and on any
     * `invalid-token` rejection; a non-null return swaps the runtime's token
     * in place and re-probes rejected docs immediately. Default: the Maude
     * Cloud renewal lane (`cloud/renew.ts`); it answers null for a machine
     * that is not signed in, so self-hosted hubs keep today's behaviour.
     * Never called under cell pairing (the cell's token comes from its env).
     */
    renewCredential?: () => Promise<{ token: string; expiresAt: number | null } | null>;
    /** F1 — clock for the renewal frequency floor (test injection). Default Date.now. */
    now?: () => number;
    /** F1 — minimum ms between renewal attempts. Default RENEW_MIN_INTERVAL_MS. */
    renewMinIntervalMs?: number;
    /** F1 — consecutive no-progress renewals before giving up. Default RENEW_MAX_WITHOUT_PROGRESS. */
    renewMaxWithoutProgress?: number;
    /** Base wait before a transient refusal is retried. Default AUTH_TRANSIENT_RETRY_MS. */
    transientRetryMs?: number;
    /** Max random spread per transient retry. Default AUTH_TRANSIENT_JITTER_MS. */
    transientJitterMs?: number;
    /** Transient re-auths allowed per `transientRetryMs` span. Default AUTH_TRANSIENT_BATCH. */
    transientBatch?: number;
    /** Jitter source (test injection). Default Math.random. */
    random?: () => number;
  };
}

/**
 * One canvas the sync runtime tracks. `slug` is the stable doc-name shared
 * with the hub; the three `paths` are absolute on-disk locations the agent
 * mirrors.
 */
export interface CanvasDescriptor {
  slug: string;
  html: string;
  comments: string;
  annotations: string;
  /** The canvas `.meta.json` sidecar (sibling of the body). Phase 9.1 Gap 2 —
   *  shared keys (layout/artboards) sync; per-user viewport stays local. */
  meta: string;
  /** The canvas's sibling `.css` (Phase 9.1 Gap 3), synced as opaque text. */
  css: string;
}

/**
 * Build the sync runtime, or return null when the project isn't linked to a
 * hub. Idempotent — callers can safely invoke this on every boot.
 */
export function createSyncRuntime(
  ctx: Context,
  opts: CreateSyncRuntimeOptions = {}
): SyncRuntime | null {
  // A CELL'S HISTORY BELONGS TO THE CELL — Cloud Phase 27 D2 — WITH EXACTLY ONE
  // EXCEPTION, which is desktop↔cloud live pairing (variant C2).
  //
  // `.design/config.json` is the TENANT's file, versioned in their repo, and
  // `linkedHub` is whatever hub their desktop was linked to when they committed
  // it. Honouring that inside a cell would do two things nobody asked for: dial
  // OUT from the cell to a third-party hub carrying the project's canvases, and
  // start a SECOND autocommit over the working tree the hub is already
  // committing — the exact duplication that phase exists to delete.
  //
  // Both of those remain refused. What is now permitted is the cell talking to
  // ITSELF: a loopback, commit-disabled, shared-doc provider to its own hub, so
  // the browser's collab doc and the desktop's Hocuspocus doc become ONE doc and
  // presence + edits cross. The conditions live in `cell-pairing.ts` and every
  // one of them is a hard gate — see that file for why each exists.
  //
  // Note the ORDER: pairing is resolved from the ENVIRONMENT (which the hub owns
  // and the tenant cannot write) BEFORE `ctx.cfg.linkedHub` is consulted, and it
  // takes only the workspace id from the tenant's config. A cell with pairing on
  // and no `linkedHub` in the tenant's file still pairs; a cell with pairing off
  // and a `linkedHub` pointing anywhere still refuses.
  const workspaceMode = process.env.MAUDE_WORKSPACE_MODE === '1';
  const pairingVerdict = resolveCellPairing();
  const cellPairing: CellPairing | null = pairingVerdict.pairing;
  if (workspaceMode && !cellPairing) {
    if (pairingVerdict.detail) {
      // The operator asked for pairing and we refused — say why, loudly.
      console.warn(`[sync] cell pairing refused — ${pairingVerdict.detail}`);
    }
    console.warn(
      `[sync] ignoring linkedHub ${ctx.cfg.linkedHub?.url ?? '(none)'} — in a workspace cell the hub owns history and sync. (DDR-209 / Phase 27 D2)`
    );
    return null;
  }

  // The hub URL the providers dial. Under pairing it is the hub's own loopback
  // address, NEVER the tenant's `linkedHub.url`. `workspaceId` is the one field
  // taken from the tenant's config, because it decides the wire document name
  // and the desktop resolves it the same way — see cell-pairing.ts.
  const linked: LinkedHub | undefined = cellPairing
    ? {
        url: cellPairing.url,
        linkedAt: 0,
        ...(ctx.cfg.linkedHub?.workspaceId ? { workspaceId: ctx.cfg.linkedHub.workspaceId } : {}),
      }
    : ctx.cfg.linkedHub;
  if (!linked) return null;
  const linkedHub = linked;
  if (cellPairing) {
    console.log(
      `[sync] cell pairing ON — loopback shared-doc provider to ${sanitizeForLog(linkedHub.url)}; autocommit disabled (the hub is the sole committer). DDR-209 threaded, not reversed.`
    );
  }

  // DDR-054 §2a — CI environment gate. Closes the supply-chain side-door
  // where a future CI workflow runs `maude design serve` and a PR-controlled
  // linkedHub.url silently grants a remote actor write access in an
  // environment carrying GITHUB_TOKEN. Override via MAUDE_SYNC_IN_CI=1.
  if (
    !process.env.MAUDE_SYNC_IN_CI &&
    (process.env.CI === 'true' || process.env.CI === '1' || !!process.env.GITHUB_ACTIONS)
  ) {
    console.warn(
      '[sync] disabled in CI environment (CI / GITHUB_ACTIONS detected). DDR-054 §2a. Set MAUDE_SYNC_IN_CI=1 to override.'
    );
    return null;
  }

  // DDR-054 §2e — scheme allowlist. Refuse plaintext to non-loopback hosts
  // (closes attacker F9 cleartext token exfil and the F2 last-mile chain).
  const schemeError = checkUrlScheme(linkedHub.url);
  if (schemeError) {
    console.error(`[sync] refusing to start: ${schemeError}`);
    return null;
  }

  // DDR-192 §5 — slug → wire documentName. Only the WIRE name is namespaced;
  // every local map (providers, agents, projections, _history/) stays keyed by
  // the flat slug. Opt-in for now (see createDocNameResolver's rollout rule);
  // a bad MAUDE_HUB_NAMESPACED=1 with no resolvable workspace id throws here
  // rather than silently falling back into a shared namespace.
  let docNameFor: (slug: string) => string;
  try {
    docNameFor = createDocNameResolver({
      repoRoot: ctx.paths.repoRoot,
      explicitWorkspaceId: linkedHub.workspaceId,
      flag: process.env.MAUDE_HUB_NAMESPACED,
    });
  } catch (err) {
    console.error(`[sync] refusing to start: ${(err as Error).message}`);
    return null;
  }

  // NO autocommit lives in this runtime (Sync v2 Increment 0, DDR-226).
  //
  // Cloud Phase 3 Task 1 built one here for workspace cells, gated
  // `workspaceMode && !cellPairing` — but that condition is UNREACHABLE: the
  // gate at the top of this function already returns null for exactly
  // `workspaceMode && !cellPairing`, so the object was always null and the
  // writer-wrap / editorOf / stop-flush that depended on it never ran. Two
  // independent readers confirmed it before the wiring was removed.
  //
  // It is not coming back on either side of the split:
  //   - In a CELL the hub is the sole committer (`afterStoreDocument` →
  //     workspace-agent), and `cell-pairing.ts` refuses to pair at all without
  //     MAUDE_SYNC_NO_AUTOCOMMIT=1 — DDR-198/209/213.
  //   - On a DESKTOP the developer's own git IS the history and committing
  //     under them would be an intrusion — DDR-119.
  //
  // The ENGINE itself (`./autocommit.ts`) is very much alive: the hub imports
  // it (`apps/hub/src/workspace-agent.mjs`, copied into the image by
  // `apps/hub/Dockerfile`) so there is exactly ONE copy of the append-only
  // commit rules — DDR-198's single-engine rule. Do not delete that module
  // when removing wiring from this file.

  // Under pairing the credential is the hub's own derived cell token, handed to
  // this process in its environment. `~/.config/maude/hubs.json` is a PERSON's
  // credential store and does not exist in a cell (HOME=/tmp) — which is exactly
  // why the old guard was unreachable by accident rather than by design.
  const storedRecord = cellPairing ? null : getHubRecord(linkedHub.url);
  const resolvedToken = cellPairing ? cellPairing.token : (storedRecord?.token ?? null);
  if (!resolvedToken) {
    console.warn(
      `[sync] linked to ${linkedHub.url} but no token in ~/.config/maude/hubs.json. Re-run 'maude design link' on this machine. Solo mode for now.`
    );
    return null;
  }
  // MUTABLE on purpose: silent renewal swaps it in place, and connectCanvas
  // reads it at call time — so every provider (re)created after a renewal
  // carries the fresh credential without a runtime restart.
  let token: string = resolvedToken;
  // Through validExpiry (F2) — the stored value came off disk written from a
  // hub body, so a bogus/far-future stamp must not schedule a renewal at boot.
  let tokenExpiresAt: number | null = validExpiry(storedRecord?.expiresAt);

  // feature-sync-file-plane — Plane B, behind its flag. The flag gates ONLY
  // the new plane (the downward file pull here + the widened sweep inside
  // `listPushableAssets`); with it off, behavior is today's, byte-for-byte.
  // DEFAULT ON (Increment 4). The plane ships enabled once its security gate
  // closed: the whole set of findings from the two-seat review is fixed, the
  // door gates scope + role on the real landing path, the receiver defends its
  // own root, budgets charge real bytes, and the storms — poke, re-anchor,
  // first-anchor, mass-delete — all have breakers that hold rather than act.
  //
  // `linkedHub.syncFiles: false` is the per-project opt-out and stays the
  // documented rollback: a config key, not a terminal command (DDR-177).
  const syncFilesOn =
    linkedHub.syncFiles !== false &&
    (process.env.MAUDE_SYNC_FILES !== '0' || linkedHub.syncFiles === true);
  // The gate for `code-module` entries — genuinely local state, at last.
  //
  // This used to read `storedRecord?.role === 'owner'`, described in the
  // receiving lane as "never anything the hub said". It was exactly what the
  // hub said: `role` is copied from the sign-in response on every login, so a
  // hostile hub answering `user.role: "owner"` once set its own receive gate
  // forever after. That matters more than the canvas case it resembles — a
  // `.tsx` renders in the sandboxed canvas origin, but a `.ts`/`.mjs` landing
  // outside the canvas-owned lane is read by the AGENT and by every
  // `maude design *` helper.
  //
  // Now: an explicit per-hub consent recorded at link time and never rewritten
  // by a login response, or this cell's own loopback pairing — where the hub
  // and the checkout are one trust domain and there is no remote party.
  const allowCodeModules = cellPairing !== null || storedRecord?.codeModulesAllowed === true;

  // DDR-102 — the default factory multiplexes every provider over ONE shared
  // WebSocket per hub URL; the runtime owns its disposal (stop(), after the
  // providers detach). An injected test factory has no shared socket.
  const ownedFactory = opts.providerFactory ? null : createDefaultProviderFactory();
  const providerFactory = opts.providerFactory ?? (ownedFactory as ProviderFactory);
  const echoGuard = createEchoGuard();
  const agents = new Map<string, CanvasSyncAgent>();
  // Phase 9.2 (DDR-064) — under sharedDoc the disk handler is a loop-free
  // projection (sole owner of html/css/meta doc→file + all-types file→doc),
  // created INSTEAD of an agent. Exactly one of agents/projections is populated
  // per run (chosen by useSharedDoc).
  const projections = new Map<string, DocProjection>();
  const providers = new Map<string, SyncProvider>();
  // KEYED BY SLUG, not flat arrays.
  //
  // These used to be two bare lists drained only by `stop()`, which was right
  // while the canvas set was fixed at boot. Continuous discovery makes a canvas
  // leave the runtime on its own (deleted on disk, moved out of a synced group),
  // and releasing one means running exactly ITS closures — a flat list cannot
  // say which those are. `stop()` still drains everything, in the same two
  // phases and the same order as before.
  const awarenessDetaches = new Map<string, Array<() => void>>();
  const statusDetaches = new Map<string, Array<() => void>>();
  const noteDetach = (map: Map<string, Array<() => void>>, slug: string, fn: () => void): void => {
    const list = map.get(slug);
    if (list) list.push(fn);
    else map.set(slug, [fn]);
  };
  const runDetaches = (map: Map<string, Array<() => void>>, slug: string): void => {
    for (const detach of map.get(slug) ?? []) {
      try {
        detach();
      } catch {
        /* best-effort — registry teardown also clears bridges on destroyAll */
      }
    }
    map.delete(slug);
  };
  // Phase 9.2 (DDR-064) — slugs pinned in the registry because a provider is
  // attached to their shared doc; released on stop(). Empty unless sharedDoc.
  const pinnedSlugs = new Set<string>();
  // The shared-doc convergence path is active only when the flag is ON AND the
  // registry can hand us the canvas's single doc. Flag OFF / no registry / a
  // minimal test registry without getDoc → the proven two-doc path, unchanged.
  const useSharedDoc = !!ctx.sharedDoc && typeof opts.registry?.getDoc === 'function';
  let fsReader: FsReader | null = null;
  let busUnsub: (() => void) | null = null;
  let started = false;
  let stopped = false;
  // ---- THE LEGACY PUSH CLIENT (journal-less hubs only) --------------------
  //
  // Sync v2 Increment 5 deleted the transfer engines: the out-of-process asset
  // sweep, its worker child, the per-file fast push and the reference-derived
  // pull. Their replacement is the journal file plane — one lane, both
  // directions, one decision function (`file-plane.ts`). What remains HERE is
  // the compat client for hubs that carry NO journal (self-hosted, not yet
  // upgraded): the same bounded, sequential `pushAssets` pass the pre-v2
  // desktop ran, retained at least two releases after the burn-down (Open
  // decision 4) and gated on the SAME capability probe that builds the plane —
  // a journal hub never sees it, so the two lanes cannot overlap.
  //
  // IN-PROCESS is safe now. The 2026-08-11 crash the out-of-process boundary
  // was built for was an HTTP/1.1 keep-alive desync after a refused PUT, fixed
  // at the transport (UPLOAD_CONNECTION_HEADERS in `asset-push.ts`), and the
  // pass is sequential with a per-request time budget — the same class of work
  // every poll already does in-process.
  let legacyPushTimer: ReturnType<typeof setTimeout> | null = null;
  let legacyPushRunning = false;
  let legacyPushAgain = false;
  /** Set by the panel's cancel (a multi-hundred-MB upload must be killable). */
  let legacyPushCancel = false;
  /**
   * The push-lane verdict, decided ONCE per boot (compat matrix §10):
   * `null` = the capability probe is still in flight (pushes wait);
   * `false` = the hub carries a journal and the plane owns pushes;
   * `true` = journal-less hub ⇒ this legacy client carries the upward lane.
   */
  let legacyLane: boolean | null = null;
  /** A pass was owed before the lane was decided — run it on the verdict. */
  let legacyBootPush: string | null = null;

  /** Run the legacy push now — single-flight with a trailing re-run. */
  function runLegacyPush(hubUrl: string): void {
    if (stopped || cellPairing || legacyLane !== true) return; // the cell never pushes
    if (legacyPushRunning) {
      legacyPushAgain = true;
      return;
    }
    legacyPushRunning = true;
    legacyPushCancel = false;
    pushAssets({
      designRoot: ctx.paths.designRoot,
      hubUrl,
      // Read at call time — silent renewal swaps the credential in place.
      token: () => token,
      canvasGroups: ctx.cfg.canvasGroups,
      cancelled: () => legacyPushCancel || stopped,
      // feature-sync-progress-modal — same `sync:status` payload as ever, so
      // the Sync panel needs no idea which lane fed it. Guarded on `stopped`:
      // a late emit must not write `_sync.json` post-teardown.
      onProgress: (p) => {
        if (!stopped) statusStore?.updateAssets?.(p);
      },
    })
      .catch(() => {
        /* pushAssets never throws; this is a belt for the promise chain */
      })
      .finally(() => {
        legacyPushRunning = false;
        // A file that changed WHILE this pass ran was not in its list — the
        // trailing re-run keeps "I pasted two images quickly" from uploading
        // only the first.
        if (legacyPushAgain && !stopped) {
          legacyPushAgain = false;
          scheduleLegacyPush(hubUrl);
        }
      });
  }

  /**
   * Coalesce a burst of asset writes into one pass.
   *
   * Dragging six images onto a canvas is six `fs:any` events inside a second,
   * and each pass costs one presence probe over the wire. The debounce makes
   * that one probe; the trailing re-run makes a change during a pass a second
   * pass rather than a lost upload.
   */
  function scheduleLegacyPush(hubUrl: string): void {
    if (stopped || cellPairing) return;
    if (legacyLane === null) {
      // Undecided — remember that a pass is owed; the verdict honours it.
      legacyBootPush = hubUrl;
      return;
    }
    if (legacyLane === false) return; // the plane owns pushes on this hub
    if (legacyPushRunning) {
      legacyPushAgain = true;
      return;
    }
    if (legacyPushTimer !== null) clearTimeout(legacyPushTimer);
    legacyPushTimer = setTimeout(() => {
      legacyPushTimer = null;
      runLegacyPush(hubUrl);
    }, ASSET_SWEEP_DEBOUNCE_MS);
    legacyPushTimer.unref?.();
  }

  /** The capability probe settled (or could not run): decide the push lane. */
  function decidePushLane(legacy: boolean): void {
    if (legacyLane !== null) return; // first verdict wins — one lane per boot
    legacyLane = legacy;
    if (legacy && legacyBootPush !== null && !stopped) {
      const url = legacyBootPush;
      legacyBootPush = null;
      runLegacyPush(url);
    }
  }

  // Task 8 — offline-mode status surface, initialized in start() once the
  // canvas count is known. The store writes `_sync.json` + broadcasts
  // 'sync:status' on the bus; the monitor aggregates provider WS status into
  // online/offline/escalated and feeds every change to the store.
  let statusStore: SyncStatusStore | null = null;
  let monitor: ConnectionMonitor | null = null;
  // DDR-102 — the per-machine sync journal (divergence detector). Created in
  // start() (after the hub URL is known), flushed + stopped in stop().
  let journal: SyncJournal | null = null;

  // DDR-102 — auth-failure intelligence state (timers cleared in stop()).
  type TimerHandle = ReturnType<typeof setTimeout>;
  const authSetTimer = opts.auth?.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const authClearTimer = opts.auth?.clearTimer ?? ((h: TimerHandle) => clearTimeout(h));
  const warnDebounceMs = opts.auth?.warnDebounceMs ?? AUTH_WARN_DEBOUNCE_MS;
  const reprobeMs = opts.auth?.reprobeMs ?? AUTH_REPROBE_MS;
  const settleTimeoutMs = opts.auth?.settleTimeoutMs ?? BOOT_SETTLE_TIMEOUT_MS;
  const pendingAuthWarn = new Map<AuthFailureClass, Set<string>>();
  /** Latest rejection class per slug — feeds the boot summary detail. */
  const rejectedReasons = new Map<string, AuthFailureClass>();
  /**
   * EVERY document the hub has refused this episode, in ANY class.
   *
   * `rejectedPermanent` holds only the two classes that destroy the provider;
   * `generic` (what every pre-DDR-102 hub sends) and `rate-limit` are absent
   * from it by design. Anything asking "has the hub refused this document?"
   * must ask HERE — reading `rejectedPermanent` for that question is how a
   * transient refusal got laundered into a green row (attacker review
   * 2026-09-03, F3). Emptied only by `clearRejection`, i.e. by a handshake the
   * hub actually completed.
   */
  const rejectedAny = new Set<string>();
  /** Permanently-rejected docs awaiting a slow re-probe (provider destroyed). */
  const rejectedPermanent = new Map<
    string,
    { canvas: CanvasDescriptor; canvasPaths: import('./agent.ts').CanvasSyncPaths; doc: Y.Doc }
  >();
  /**
   * Transiently-refused docs (`rate-limit` / `generic`) awaiting the paced
   * retry — see `AUTH_TRANSIENT_RETRY_MS`. Unlike `rejectedPermanent` the
   * provider is KEPT until the retry swaps it (a refused provider sends nothing
   * more, so there is no storm to stop), and the retry acts only if `provider`
   * is still the live one: a release or another recovery path that replaced it
   * in the meantime owns the document now. `dueAt` is on the `renewNow` clock.
   */
  const rejectedTransient = new Map<
    string,
    {
      canvas: CanvasDescriptor;
      canvasPaths: import('./agent.ts').CanvasSyncPaths;
      doc: Y.Doc;
      provider: SyncProvider;
      dueAt: number;
    }
  >();
  /** Consecutive transient refusals per slug — the backoff exponent. Emptied
   *  by `clearRejection`, i.e. by a handshake the hub completed. */
  const transientStrikes = new Map<string, number>();
  /** When each transient re-auth of the last window went out — the sliding
   *  budget. Never longer than `transientBatch`. */
  const transientSpent: number[] = [];
  let transientRetryTimer: TimerHandle | null = null;
  /**
   * First-connect setup still OWED to a pulled canvas whose first handshake
   * has not landed (`connectCanvas` defers it — the body path is unknown until
   * the document arrives). Every reconnect passes it back in: without it a
   * refusal at that first handshake stranded the setup, and the hub's eventual
   * yes synced the document into memory while nothing ever wrote it to disk.
   */
  const owedSetups = new Map<string, (provider: SyncProvider) => void>();
  let authWarnTimer: TimerHandle | null = null;
  let reprobeTimer: TimerHandle | null = null;
  let renewTimer: TimerHandle | null = null;
  /** Single-flight guard: 73 rejected docs must trigger ONE renewal, not 73. */
  let renewInFlight: Promise<boolean> | null = null;
  // F1 (2026-08-10 security review) — RATE DISCIPLINE on the renew↔reprobe
  // cycle. Single-flight bounds concurrency; these bound FREQUENCY. Without
  // them a legitimate cell refusing on VOLUME (its invalid-token bucket, which
  // now answers "invalid token — rate limited") classifies permanent →
  // triggers renewal → renewal succeeds (the token was never the problem) →
  // reprobeNow reconnects all N docs → the bucket refuses them again → loop.
  // Reproduced at 2342 renewals/s. This is the exact retry-storm class the
  // whole change exists to end, one level up — so it gets a floor AND a cap.
  const renewNow = opts.auth?.now ?? (() => Date.now());
  const renewMinIntervalMs = opts.auth?.renewMinIntervalMs ?? RENEW_MIN_INTERVAL_MS;
  const renewMaxWithoutProgress = opts.auth?.renewMaxWithoutProgress ?? RENEW_MAX_WITHOUT_PROGRESS;
  const transientRetryMs = opts.auth?.transientRetryMs ?? AUTH_TRANSIENT_RETRY_MS;
  const transientJitterMs = opts.auth?.transientJitterMs ?? AUTH_TRANSIENT_JITTER_MS;
  const transientBatch = Math.max(1, opts.auth?.transientBatch ?? AUTH_TRANSIENT_BATCH);
  const authRandom = opts.auth?.random ?? Math.random;
  /** Wall-clock of the last renewal attempt (0 = never). The floor. */
  let lastRenewAt = 0;
  /** Successful renewals since the last completed handshake. The cap: a
   *  renewal that keeps succeeding while nothing connects is not fixing
   *  anything — stop, and let the link surface as refused/stalled. Reset to 0
   *  at every `connected` doc (the handshake-success point). */
  let renewalsSinceProgress = 0;
  /**
   * When a document last reached `connected` — the ONLY evidence that this link
   * is doing its job. Seeded at runtime construction so the stall watchdog
   * (`armStallWatchdog`) measures from "when we started trying", exactly like
   * `SyncStatusSnapshot.startedAt`, rather than from a promotion that may never
   * come. Moves on first connect, on re-probe and on reconnect re-promotion.
   */
  let lastPromotionAt = 0;
  // Silent credential renewal (cloud). Absent under cell pairing — the cell's
  // token arrives via its environment and is the hub's own to rotate.
  const renewCredential = cellPairing
    ? null
    : (opts.auth?.renewCredential ??
      (async () => {
        const r = await renewHubCredential(linkedHub.url);
        if (r.ok) return { token: r.token, expiresAt: r.expiresAt };
        // The reason was computed and thrown away. `renewHubCredential`
        // distinguishes signed-out from revoked from removed-from-project from
        // unreachable — each a different sentence to a person — and every one of
        // them reached the log as the same silence. Say which.
        console.warn(`[sync] hub credential renewal declined: ${r.reason}`);
        return null;
      }));
  const settleTimers = new Set<TimerHandle>();
  /** Pending synthetic `fs:any` emissions (cell pairing only), keyed by the
   *  design-root-relative path so a second write to the same file inside the
   *  delay window replaces the pending timer instead of scheduling a second
   *  one. Cleared on stop() so a teardown can't fire a reload for a runtime
   *  that no longer exists. */
  const announceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Assigned by `start()`. Adopting a canvas needs the boot closure (the
   * journal, the history, the status store, `connectCanvas`), so the function
   * is built there and published here for `adopt()` to reach. Null in solo mode
   * and after `stop()`.
   */
  let attachOne: ((canvas: CanvasDescriptor, boot: boolean) => Promise<void>) | null = null;

  /** Continuous local discovery — armed at the end of `start()`, torn down in
   *  `stop()`. See the block that creates it and `discovery.ts`. */
  let discoveryRescan: RescanScheduler | null = null;
  let discoveryUnsub: (() => void) | null = null;
  /** The outbound delete-lane subscriptions — see `noteToHub`. */
  let deletedUnsub: (() => void) | null = null;
  let createdUnsub: (() => void) | null = null;
  /** Periodic remote-document poll — the hub-side half of discovery. */
  let remotePollTimer: ReturnType<typeof setInterval> | null = null;
  /** The stall watchdog's tick — see `stallCheck` in `start()`. */
  let stallTimer: ReturnType<typeof setInterval> | null = null;
  /** Wall-clock of the last watchdog-forced reconnect (0 = never). The floor
   *  that keeps a silent hub from becoming a reconnect storm. */
  let lastForcedReconnectAt = 0;
  /** Forced reconnects so far — the exponent of the backing-off floor. */
  let forcedReconnects = 0;
  /** This runtime's slice of `STALL_JITTER_MS`, drawn once so peers that lost
   *  their sockets together do not fire together. */
  const stallNow = opts.stall?.now ?? (() => Date.now());
  // Seeded from the same clock the watchdog reads, so "nothing has settled
  // since we started trying" is measured against a consistent origin.
  lastPromotionAt = stallNow();
  const stallCheckMs = opts.stall?.checkMs ?? STALL_CHECK_MS;
  const stallAfterMs = opts.stall?.afterMs ?? STALL_RECONNECT_AFTER_MS;
  const stallMinMs = opts.stall?.minMs ?? STALL_RECONNECT_MIN_MS;
  const stallJitterMs = opts.stall?.jitterMs ?? Math.floor(Math.random() * STALL_JITTER_MS);
  /**
   * The file-event control channel (Sync v2 Increment 2), when the hub
   * advertises one. Null on a journal-less hub, in a cell (the child holds it
   * there), and whenever `linkedHub.fileEvents` is false.
   */
  let fileEventsCtl: import('./ctl-provider.ts').CtlProvider | null = null;
  /**
   * Cancels the boot-time capability probe. A `stop()` that leaves a `/health`
   * fetch in flight is a timer keeping a dying process alive and a promise
   * landing in torn-down state — the class of thing that shows up as a flaky
   * suite long before it shows up as a bug.
   */
  let fileEventsProbe: AbortController | null = null;
  /**
   * The Sync v2 file plane — ONE lane, both directions, one decision table.
   *
   * Null on a journal-less hub (the compat matrix keeps the v1 manifest pull
   * for those), and null when `linkedHub.syncFiles` is off. Built once the
   * capability probe answers, so a hub that cannot support it never sees a
   * request it does not understand.
   */
  let filePlane: import('./file-plane.ts').FilePlane | null = null;
  let fileLedger: import('./file-ledger.ts').FileLedger | null = null;
  /** Cumulative files sent up this boot — the doručenka's push half. */
  let filePushed = 0;
  /** Debounce for a plane pass triggered by a local write. */
  let filePassTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The HONESTY COUNTER. Pokes received this run, beside the polls that found
   * work anyway. Relaxing the 20 s poll to 60 s is gated on this proving the
   * channel is not silently missing events in dogfood (DDR-226 §10) — a
   * number, not a feeling, and deliberately reported rather than assumed.
   */
  let pokesSeen = 0;
  /** Assigned by `start()`; the seam `pullRemoteNow()` and tests reach. */
  let remotePull: (() => Promise<void>) | null = null;
  /**
   * Run a file-plane pass shortly, coalesced.
   *
   * THE PUSH HALF'S TRIGGER. A local write does not upload anything by itself
   * any more: it invalidates the stat cache for that path and asks for a pass,
   * and the pass decides — push, pull, conflict or nothing — through the same
   * table every other trigger uses. That is the difference from the fast lane
   * it replaces, which had its own idea of what a change meant and needed a
   * probe-guard to keep from re-uploading what the pull had just written.
   */
  function schedulePlanePass(): void {
    if (stopped || filePassTimer !== null) return;
    filePassTimer = setTimeout(() => {
      filePassTimer = null;
      void runPlanePass();
    }, FILE_PASS_DEBOUNCE_MS);
    filePassTimer.unref?.();
  }
  /**
   * The ONE way a pass runs — issue #109.
   *
   * There were two entry points (this debounce and the 20 s poll) and no
   * mutual exclusion between them, so a busy file-event channel could start a
   * pass every 400 ms and overlap it with the poll's. Each pass is up to
   * `MAX_REQUESTS_PER_PASS` requests against a hub that meters per minute, so
   * the client's own ceiling was an order of magnitude above the server's and
   * it manufactured the rate limit it then failed on.
   *
   * A pass in flight absorbs the request (the running pass reads the same
   * disk and the same cursor, so a second one would decide the identical
   * work), and passes are floored `MIN_PASS_INTERVAL_MS` apart.
   */
  let planePassInFlight = false;
  let lastPlanePassAt = 0;
  let planePassWaiter: Promise<void> | null = null;
  async function runPlanePass(opts?: { floor?: boolean }): Promise<void> {
    // Captured, not re-read: `stop()` clears `filePlane`, and a pass that has
    // already decided to run must not dereference the field it was cleared to.
    const lane = filePlane;
    if (stopped || !lane) return;
    // A pass already running IS this pass: it reads the same disk and the same
    // cursor, so the caller waits for its answer rather than racing it. The
    // poll's `await` therefore still means "a pass has happened".
    if (planePassInFlight) return await (planePassWaiter ?? Promise.resolve());
    const since = Date.now() - lastPlanePassAt;
    // The floor governs POKES. The 20 s poll and the explicit `pullRemoteNow`
    // seam are already bounded by their own callers, and silently deferring a
    // caller that awaited a pass would be its own lie.
    if (opts?.floor !== false && since < MIN_PASS_INTERVAL_MS) {
      // Not dropped — deferred. A poke that arrives inside the floor still has
      // news, and losing it means a local edit waits for the next 20 s tick.
      schedulePlanePassAfter(MIN_PASS_INTERVAL_MS - since);
      return;
    }
    planePassInFlight = true;
    lastPlanePassAt = Date.now();
    const run = (async () => {
      try {
        const r = await lane.reconcile();
        planeResultSink?.(r);
      } catch (err) {
        console.error('[sync/files] pass failed:', err);
      } finally {
        planePassInFlight = false;
        planePassWaiter = null;
      }
    })();
    planePassWaiter = run;
    await run;
  }
  /** Re-arm the debounce timer at a specific delay (the floor's deferral). */
  function schedulePlanePassAfter(ms: number): void {
    if (stopped || filePassTimer !== null) return;
    filePassTimer = setTimeout(() => {
      filePassTimer = null;
      void runPlanePass();
    }, ms);
    filePassTimer.unref?.();
  }
  /** Assigned by `start()` so a pass reports into the same status the poll does. */
  let planeResultSink: ((r: import('./file-plane.ts').FilePlaneResult) => void) | null = null;

  /**
   * Ask for an off-schedule remote poll, coalesced.
   *
   * Reachable before `start()` finishes wiring `remotePull` (the monitor is
   * built first and can emit during boot), so it is a no-op until there is
   * something to call — the boot pull has just run at that point anyway.
   */
  let remotePollSoonTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the last poke-driven pass actually started. */
  let lastPokePassAt = 0;
  /** Pokes refused by the cooldown since the last one that ran. */
  let pokesThrottled = 0;

  /**
   * @param opts.cooled  apply the anti-spam floor. True for hub-driven pokes
   *                     AND reconnect-driven passes (F-12 — a churned socket
   *                     is hub-controlled too; a genuine one-off reconnect
   *                     still runs immediately because nothing poked
   *                     recently); false only for boot.
   */
  function pollRemoteSoon(opts: { cooled?: boolean } = {}): void {
    if (stopped || remotePollSoonTimer !== null) return;
    if (opts.cooled) {
      const since = Date.now() - lastPokePassAt;
      if (since < POKE_COOLDOWN_MS) {
        // Folded into the scheduled tick rather than dropped: the poll
        // underneath is still the reconciler, so a throttled poke costs
        // latency and never correctness.
        pokesThrottled += 1;
        return;
      }
    }
    remotePollSoonTimer = setTimeout(() => {
      remotePollSoonTimer = null;
      if (stopped) return;
      if (opts.cooled) {
        lastPokePassAt = Date.now();
        if (pokesThrottled > 0) {
          console.warn(
            `[sync/ctl] ${pokesThrottled} poke(s) folded into this pass — the hub is poking faster than once per ${POKE_COOLDOWN_MS / 1000}s.`
          );
          pokesThrottled = 0;
        }
      }
      void remotePull?.().catch(() => {
        /* the scheduled poll retries — a missed opportunistic one is not news */
      });
    }, REMOTE_POLL_SOON_MS);
    remotePollSoonTimer.unref?.();
  }
  /** Every slug this run brought down, so the panel's "came down from the
   *  project" list accumulates instead of being replaced by the latest batch. */
  const everPulled = new Set<string>();

  /**
   * Every slug the PROJECT has deleted, as this run has learned it.
   *
   * The hub drops its `documents` row best-effort while the tombstone is the
   * durable part, so a deleted canvas can still appear in one more listing. This
   * set is what stops the pull lane from treating that listing as an invitation
   * to write the canvas back — the resurrection, arrived at from the other side.
   */
  const tombstoned = new Set<string>();

  /**
   * The LIVE descriptor set, by slug.
   *
   * `start()`'s `canvases` array is the BOOT set and stops being the truth the
   * moment a canvas is adopted or released. The DDR-054 §3 F3 untrusted markers
   * must describe what is actually attached — a marker naming a canvas that
   * left, or silently omitting one that arrived, is the control pointing at a
   * phantom. Descriptors are held BY REFERENCE: `relocatePulled` mutates them in
   * place, and the map must see that.
   */
  const descriptors = new Map<string, CanvasDescriptor>();

  /** Warnings already emitted, so a per-poll refusal is said once, not forever. */
  const warnedOnce = new Set<string>();
  function warnOnce(key: string, message: string): void {
    if (warnedOnce.has(key)) return;
    warnedOnce.add(key);
    console.warn(message);
  }

  /**
   * May a HUB-AUTHORED body of this shape be written to this disk at all?
   *
   * The local lane has asked this since 9.1-B: `scanCanvases` admits a `.tsx`
   * only when the cross-origin sandbox is active AND the project has not opted
   * out (`walk` → `resolveSyncable`; DDR-060 couples the two, DDR-079 sets the
   * default). The PULL lane never asked it — so a peer running with the sandbox
   * off, or with `linkedHub.syncTsx: false` set precisely to keep hub `.tsx` off
   * this machine, still received hub-authored `.tsx` bodies and rendered them.
   * With the sandbox off that render is on the MAIN origin, which is the exact
   * execution the coupling exists to prevent.
   *
   * The gap predates continuous discovery — it was reachable once per connect —
   * but a lane that re-asks every 20 s makes "the opt-out holds for a moment"
   * indistinguishable from "the opt-out does nothing".
   */
  function admitPulledBody(slug: string, bodyAbs: string): boolean {
    if (!bodyAbs.toLowerCase().endsWith('.tsx')) return true;
    const splitActive = !!ctx.canvasOrigin;
    const projectSyncTsx = linkedHub.syncTsx !== false;
    if (splitActive && projectSyncTsx) return true;
    warnOnce(
      `pull-tsx-refused:${splitActive ? 'opt-out' : 'sandbox-off'}`,
      `[sync] refusing hub-authored .tsx canvases (first: ${slug}) — ` +
        (splitActive
          ? 'this project set linkedHub.syncTsx: false.'
          : 'the cross-origin sandbox is off (MAUDE_CANVAS_ORIGIN_SPLIT=0), and TSX sync with it — DDR-060.') +
        ' The same gate the local scan applies, now applied to what the hub sends.'
    );
    return false;
  }

  /**
   * Give up ONE canvas — the inverse of `attachOne`.
   *
   * Order is deliberate and is NOT `stop()`'s order. `stop()` unpins before it
   * flushes because the whole process is going away and the rooms are being
   * torn down anyway; here the room OUTLIVES the release, so the doc→file
   * projection must flush FIRST and the pin is dropped last. Unpinning early
   * would hand the room to the last-browser-leaves drop while the projector was
   * still writing through it.
   *
   * The shared WebSocket is deliberately untouched: it belongs to the runtime,
   * not to a canvas, and the next adopt will need it. Only `stop()` disposes it.
   */
  /**
   * Slugs THIS process is retiring via `retireForMove` right now. The
   * retirement watcher below fires on every doc update — including our own
   * stamp — and its job on a PASSIVE peer (quarantine the stale local file)
   * would destroy the very file `moveCanvas` is about to rename here.
   */
  const movingLocally = new Set<string>();
  /** Retirements already being handled, so the per-update watcher fires once. */
  const retiring = new Set<string>();
  /**
   * Documents this runtime has SEEN retired. The hub goes on listing a retired
   * document (nothing deletes docs until Increment 6), so without this memory
   * the remote pull re-fetched the same retired docs every poll — connect,
   * learn the fact, release, repeat — an infinite churn that saturated the
   * membership queue, held every LIVE document in `pending` forever, and
   * showed up to the user as "HUB SYNC stalled" with annotations not crossing.
   */
  const retiredDocs = new Set<string>();

  /**
   * What the hub's last listing said each document HOLDS, in bytes.
   *
   * The one fact that separates "this canvas is mine and the hub has never
   * heard of it" from "this canvas is the hub's, already written to my disk by
   * something else". On a cell BOTH are true of a brand-new file: the hub's
   * workspace agent projects every document onto the checkout, and the studio
   * child then scans that checkout and finds a canvas it has no descriptor for.
   * Seeding the doc from it is the DDR-102 F1 collision — two machines each
   * clear-and-rebuild their own replica, and the merge CONCATENATES the two
   * runs, so the body arrives doubled (two `export default`s, `0 ARTBOARDS`)
   * on every peer. Consulted by the adopt guard in `migrateSeed`.
   */
  let hubDocIndex: ReadonlyMap<string, number> = new Map<string, number>();

  /**
   * Slugs whose refusal has already asked for a rescan. Once per slug per
   * process — see `nudgeRescanFor`, which fires on a REPEATING poll.
   */
  const rescanNudged = new Set<string>();

  /**
   * Slugs whose pull this runtime has refused. `retiredDocs` exists to stop a
   * hub-listed document being re-fetched forever; a REFUSED one needs the same
   * memo. Without it `releaseOne` drops the descriptor, the next poll sees the
   * document as hub-only again, and every 20 s buys a full handshake plus a Y
   * state transfer that ends in the same refusal — the churn shape that named
   * `retiredDocs` in the first place, on a lane whose own comment says volume
   * is a security property. Bounded like the sets beside it.
   *
   * Keyed slug → the path that blocked it, because the refusal is not forever:
   * `admitPullTarget` refuses on a file that EXISTS, and a user may delete it.
   * Re-checking that one path costs a `statSync`; re-checking by handshake costs
   * a document transfer. So the memo is dropped the moment its reason is gone.
   */
  const refusedPulls = new Map<string, string>();

  /** Distinct hub-invented names are not a budget this process pays forever. */
  const NUDGE_MEMO_CAP = 512;

  /**
   * The hub is advertising a document we are not syncing, and there is a file
   * in the way. Ask the scan.
   *
   * On a cell this is the ordinary case, not an edge one: the hub's workspace
   * agent projects every document onto the checkout, so a canvas created on
   * another machine arrives as a FILE this process never wrote. The chain that
   * is supposed to notice — `fs:any` → `canvas-list-watch` → rescan — is driven
   * by `fs.watch` on a desktop and by the ctl healer in a container, and the
   * healer announces JOURNAL rows. A canvas body is not journaled (it is Plane
   * A), so in a container nothing announced it and the child never adopted it:
   * the canvas showed up in the tree, and an edit made to it in the cloud was
   * silently reverted by the hub's next projection, because no provider on this
   * side was carrying the change up.
   *
   * The refusal itself is the signal — it means "a file is already there" — and
   * `scanCanvases` is the authority on whether that file belongs in the sync
   * set (`syncable: false` and the sandbox gate are ITS rules, so a genuinely
   * opted-out canvas stays out and simply refuses again next poll).
   */
  const nudgeRescanFor = (slug: string): void => {
    if (rescanNudged.has(slug) || rescanNudged.size >= NUDGE_MEMO_CAP) return;
    rescanNudged.add(slug);
    discoveryRescan?.schedule();
  };

  /**
   * Record one listing's byte counts, keyed by the FULL document name.
   *
   * NOT by slug. `slugFromDocName` strips `ws/<workspace>/<branch>/`, and this
   * map answers "does the hub hold MY document" — so a flattened key makes a
   * `hero` on `main` answer for a DIFFERENT peer's `hero` on `feat/x`, which
   * defers that peer's seed forever while logging that state is on its way.
   * Nothing would be coming. A peer token is commonly `scope: '*'`, so one
   * listing spans every namespace on the hub and no hostile hub is required —
   * one member creating a same-named canvas on another branch is enough.
   * `diffRemoteDocs`, twelve lines below, compares namespaced names for exactly
   * this reason; one input must not have two key spaces.
   *
   * A FAILED listing leaves the previous answer standing rather than clearing
   * it: an empty map means "the hub holds nothing", which re-opens the DDR-102
   * F1 doubling this guard exists to close — and it would be re-opened by the
   * party the guard defends against simply refusing to answer.
   */
  const noteHubListing = (docs: readonly HubDocRow[] | null): void => {
    if (docs === null) return;
    hubDocIndex = indexHubDocs(docs);
  };

  /**
   * A retired document arrived (another machine moved this canvas): release
   * the canvas and QUARANTINE the stale local copy into `_trash/` — never
   * unlink, the DDR-102 recoverability spine. Safe against a plain deletion
   * ambiguity because `movedTo` is an explicit statement that the content
   * lives on at the new path (see codec stampMovedTo).
   */
  async function onRetirementSeen(slug: string): Promise<void> {
    const desc = descriptors.get(slug);
    const provider = providers.get(slug);
    const movedTo = provider ? movedToFromDoc(provider.document) : null;
    await releaseOne(slug);
    if (!desc) return;
    // HOLD until the canvas provably lives at its new path — parking the old
    // copy while the new document is still materialising would leave a window
    // with NO visible copy at all, and on a cell (where this process shares
    // the checkout with the hub) it can even race the mover's own rename.
    // The doc guards already made the old file write-inert, so waiting costs
    // nothing but tidiness. If the new path never shows up, the stale file
    // stays — a recoverable ghost beats a lost canvas.
    if (movedTo) {
      const norm = movedTo.replace(/\\/g, '/');
      const newAbs = path.resolve(ctx.paths.designRoot, norm);
      const contained =
        newAbs === ctx.paths.designRoot || newAbs.startsWith(ctx.paths.designRoot + path.sep);
      if (!contained) return; // hostile path — never act on it
      // A DOCUMENT THAT MOVED TO WHERE IT ALREADY IS DID NOT MOVE.
      //
      // `retireForMove` stamps the OLD slug's doc, and the moved file is then
      // adopted under the NEW slug — whose doc carries the same `movedTo`, now
      // pointing at its own path. Without this guard the receiver reads that as
      // "this canvas moved elsewhere", waits for the destination (it exists —
      // it IS the destination), and parks the file it just created. The canvas
      // vanishes from the UI on the very machine that moved it, on both sides,
      // and the trash entry is named after the NEW slug — which is what makes
      // the logs read as a delivery failure rather than as self-deletion.
      if (desc.html && path.resolve(desc.html) === newAbs) return;
      const deadline = Date.now() + 60_000;
      while (!existsSync(newAbs) && Date.now() < deadline && !stopped) {
        await new Promise((r) => setTimeout(r, 1_000));
      }
      if (!existsSync(newAbs)) {
        console.warn(
          `[sync/${slug}] retired document's new path never appeared (${norm}) — keeping the old copy in place.`
        );
        return;
      }
    }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const trashDir = path.join(ctx.paths.designRoot, '_trash', `${stamp}__moved-${slug}`);
      let any = false;
      for (const abs of [desc.html, desc.meta, desc.css, desc.annotations]) {
        if (!abs || !existsSync(abs)) continue;
        if (!any) mkdirSync(trashDir, { recursive: true });
        any = true;
        renameSync(abs, path.join(trashDir, path.basename(abs)));
      }
      if (any) {
        console.log(
          `[sync/${slug}] canvas was moved on another machine — stale local copy parked in _trash/ (recoverable).`
        );
        ctx.bus.emit('canvas-list-update');
      }
    } catch (err) {
      // Quarantine is best-effort: the doc guards already made the file
      // write-inert, so a failed park costs tidiness, not correctness.
      console.warn(`[sync/${slug}] could not park the pre-move copy:`, err);
    }
  }

  /** Watch one provider's doc for a retirement stamp arriving off the wire. */
  function watchForRetirement(slug: string, doc: Y.Doc): void {
    const onUpdate = () => {
      if (retiring.has(slug) || movingLocally.has(slug)) return;
      if (movedToFromDoc(doc) === null) return;
      retiredDocs.add(slug);
      retiring.add(slug);
      doc.off('update', onUpdate);
      void onRetirementSeen(slug).finally(() => retiring.delete(slug));
    };
    doc.on('update', onUpdate);
    noteDetach(statusDetaches, slug, () => doc.off('update', onUpdate));
  }

  async function releaseOne(slug: string): Promise<boolean> {
    const known = agents.has(slug) || projections.has(slug) || providers.has(slug);
    if (!known) return false;
    runDetaches(awarenessDetaches, slug);
    runDetaches(statusDetaches, slug);
    const agent = agents.get(slug);
    if (agent) {
      try {
        await agent.flush();
        agent.stop();
      } catch {
        /* best-effort */
      }
      agents.delete(slug);
    }
    const projection = projections.get(slug);
    if (projection) {
      try {
        await projection.flush();
        projection.stop();
      } catch {
        /* best-effort */
      }
      projections.delete(slug);
    }
    const provider = providers.get(slug);
    if (provider) {
      try {
        provider.destroy();
      } catch {
        /* best-effort */
      }
      providers.delete(slug);
    }
    if (pinnedSlugs.delete(slug)) {
      try {
        opts.registry?.unpin?.(slug);
      } catch {
        /* best-effort */
      }
    }
    descriptors.delete(slug);
    // Drop the row too — a released canvas that stayed `pending` in the status
    // payload would be a permanent "still syncing" the user can never clear.
    monitor?.forgetDoc(slug);
    rejectedPermanent.delete(slug);
    rejectedTransient.delete(slug);
    transientStrikes.delete(slug);
    owedSetups.delete(slug);
    rejectedReasons.delete(slug);
    return true;
  }

  /**
   * The move protocol's sending half — see the SyncRuntime interface doc.
   *
   * Ordering is the whole design: stamp FIRST (through the live provider, so
   * the hub and every peer receive the statement), give the socket a moment to
   * actually send it, THEN release. Releasing first would destroy the provider
   * with the stamp still in its outbox, and the old document would live on as
   * if the move never happened — which is exactly the resurrection bug.
   */
  async function retireForMove(fromSlug: string, toRel: string): Promise<boolean> {
    const provider = providers.get(fromSlug);
    if (!provider) return false;
    movingLocally.add(fromSlug);
    try {
      stampMovedTo(provider.document, toRel, ORIGINS.DISK_PROJECTION);
      // Best-effort delivery wait. Hocuspocus exposes no per-update ack; an
      // unsynced-changes probe where available, a short grace where not. A
      // stamp that misses this window still lands via the hub's own store of
      // the doc IF any other peer holds it — and if none does, the old doc
      // has no audience to resurrect for.
      const p = provider as unknown as { hasUnsyncedChanges?: boolean };
      const deadline = Date.now() + 1_500;
      while (p.hasUnsyncedChanges === true && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (typeof p.hasUnsyncedChanges !== 'boolean') {
        await new Promise((r) => setTimeout(r, 400));
      }
      retiredDocs.add(fromSlug);
      await releaseOne(fromSlug);
      console.log(`[sync/${fromSlug}] retired for move → ${toRel}`);
      return true;
    } finally {
      movingLocally.delete(fromSlug);
    }
  }

  async function start(): Promise<void> {
    if (started || stopped) return;
    started = true;

    // A NEW PROCESS MUST NOT SERVE THE OLD ONE'S VERDICT.
    //
    // `_sync.json` is a file, and `/_sync-status` returns whatever is in it.
    // The first honest snapshot of THIS run is not written until every provider
    // has been constructed — after a scan and a 6-second listing fetch — and
    // until then the endpoint, the CLI and the browser banner were all reading
    // the last run's counters as if they were current. That is how a live fleet
    // showed `0 synced · 73 rejected` for a process whose own log said
    // `76/76 synced` against a hub that was accepting the credential: the
    // rejections were real, and they were from a previous session.
    //
    // Per-document verdicts are NOT rehydratable — a verdict is about a
    // handshake this process has not made yet. So the file is reset to the
    // honest seed (`connecting`, nothing known) the moment the runtime starts.
    resetPersistedStatus(ctx, linkedHub.url);

    // Fix 4 (sync RCA 2026-08-10) — one-shot quarantine of the pre-fix-5 flat
    // fallback twins, BEFORE the scan: a flat twin that survived into the scan
    // would sync as its own document and re-seed the duplicate on every peer.
    // Skipped under cell pairing — a cell's checkout is the hub's to manage,
    // and quarantining there would dirty a tree the hub commits.
    if (!cellPairing) {
      migrateFlatFallback({
        designRoot: ctx.paths.designRoot,
        designRel: ctx.paths.designRel,
      });
    }

    const scan = opts.canvases ? { canvases: opts.canvases, tsxCount: 0 } : await scanCanvases(ctx);
    // DDR-064 pre-cutover A4 + A6 — two files must never share a document, and
    // the pinned set must be bounded. See `admitCanvases`.
    const localCanvases = admitCanvases(scan.canvases, useSharedDoc);

    // PULL THE REST OF THE PROJECT DOWN.
    //
    // The scan above only sees this machine's disk, and Yjs cannot enumerate —
    // so before this, a document that existed only on the hub was invisible to
    // a peer forever. A desktop carrying 72 of a project's 75 canvases synced
    // 72, reported "72/72 synced", and was accurate about the wrong universe.
    // That is what "Open in Maude does nothing" was.
    //
    // A project you have access to is a project you get, in full and in both
    // directions. Hub-only documents become real local files (flat under the
    // design root — see `pullTargets` for why flat); local-only canvases go up
    // as they always did. Best-effort: an older hub without the listing route,
    // or an unreachable one, syncs exactly as before.
    // `token`, not the boot-time `resolvedToken`: silent renewal swaps the live
    // credential in place, so reading it at call time is what every other hub
    // call here does. Identical at boot; correct if start() ever re-runs after
    // a renewal (and it types, which `resolvedToken`'s `string | null` did not).
    const remoteListing = await fetchRemoteListing(linkedHub.url, token);
    // BOOT LEARNS THE DELETIONS BEFORE IT PULLS ANYTHING. The peer-side apply
    // lives further down (it needs the live descriptor map), so this boot pass
    // only has to make sure the pull does not fetch a canvas the project has
    // deleted — the first poll then quarantines whatever is still on disk. Doing
    // it in the other order would materialise a deleted canvas on every launch
    // and delete it again seconds later, which is worse than the bug.
    for (const stone of remoteListing?.tombstones ?? []) {
      const slug = slugFromDocName(stone.name);
      if (slug) tombstoned.add(slug);
    }
    noteHubListing(remoteListing?.documents ?? null);
    const remoteDiff = diffRemoteDocs(
      localCanvases.map((c) => docNameFor(c.slug)),
      remoteListing?.documents ?? null
    );
    // PROVISIONAL targets. The listing carries names and byte counts only — a
    // document's own `syncMeta.path` lives INSIDE it, so every target here is
    // the fallback, and each one is re-resolved in `handleSynced` once that
    // document has actually synced. See `relocatePulled` below.
    //
    // A FRESH LINK HAS DECLARED NOTHING. A design root with no canvases of its
    // own and no `config.json` is a folder somebody just pointed at a project.
    // `config.json` is not synced, so such a peer has only the DEFAULT groups
    // (`system`, `ui`) — and a project whose author calls their group `screens`
    // would have every single incoming path refused as out-of-group and land
    // flat and invisible. That is the empty-folder case, and it is the one this
    // whole change exists for.
    //
    // So on that one boot, an undeclared group is accepted (rules 1-7 are
    // untouched — a path still has to slug back to its own document), and the
    // groups actually seen are then WRITTEN into a config.json, additively. The
    // relaxation therefore applies once: the next boot has a config.
    // EMPTINESS IS A FACT ABOUT THE FOLDER, not about the scan. `scanCanvases`
    // walks only DECLARED groups and applies the syncable + sandbox gates, so a
    // project with real work in it scans to zero whenever `syncTsx:false`, the
    // sandbox is off, or its canvases sit in a group it never declared — and
    // treating that as "a bare folder somebody just pointed at a project" would
    // let a hub author a `config.json` into a project that had work in it.
    let freshLink =
      localCanvases.length === 0 && !existsSync(designConfigPath(ctx)) && designRootIsBare(ctx);
    const learnedGroups = new Set<string>();
    // True once THIS boot wrote the config. Until then an existing file is
    // somebody's own declaration and is never touched; afterwards it is ours to
    // extend as further groups arrive.
    let ownsSeededConfig = false;
    const noteLearnedGroup = (group: string): void => {
      if (!freshLink || learnedGroups.has(group)) return;
      learnedGroups.add(group);
      if (existsSync(designConfigPath(ctx)) && !ownsSeededConfig) return;
      if (seedProjectConfig(ctx, learnedGroups, ownsSeededConfig)) ownsSeededConfig = true;
      // ONE GROUP, ONCE. `freshLink` was a `const`, so after the first config
      // was written every FURTHER undeclared group was accepted and appended —
      // the relaxation perpetuating itself instead of closing, and a hub free to
      // plant an unbounded set of directories in a single session. The project
      // has now declared itself; everything after this is checked against that
      // declaration like any other boot.
      freshLink = false;
      pathOpts.allowUndeclaredGroup = false;
    };
    const pathOpts: {
      designRel: string;
      canvasGroups: Context['cfg']['canvasGroups'];
      allowUndeclaredGroup: boolean;
      onRefused: (slug: string, reason: string) => void;
    } = {
      designRel: ctx.paths.designRel,
      canvasGroups: ctx.cfg.canvasGroups,
      allowUndeclaredGroup: freshLink,
      onRefused: (slug: string, reason: string) =>
        console.warn(`[sync/${slug}] ignoring the path this document carries — ${reason}`),
    };
    const pulled = pullTargets(
      remoteDiff.hubOnly,
      ctx.paths.designRoot,
      path.join,
      path.resolve,
      path.sep,
      { ...pathOpts, realpath: realpathOfDeepestExisting }
    );
    const pullNote = describeRemoteDiff(remoteDiff);
    if (pullNote) console.log(`[sync] ${pullNote}`);
    /** Descriptor paths for one slug at one body path. The sidecar rules live
     *  here, once: `.meta.json`/`.css` are SIBLINGS of the body, while
     *  `.annotations.svg` is keyed by the flat slug at the design root — the
     *  asymmetry `workspace-files.mjs` documents, and which moving the body
     *  must not quietly change. */
    const descriptorFor = (slug: string, bodyAbs: string): CanvasDescriptor => ({
      slug,
      html: bodyAbs,
      comments: path.join(ctx.paths.commentsDir, `${slug}.json`),
      annotations: path.join(ctx.paths.designRoot, `${slug}.annotations.svg`),
      meta: bodyAbs.replace(/\.tsx$/i, '.meta.json'),
      css: bodyAbs.replace(/\.tsx$/i, '.css'),
    });
    // Which slugs came DOWN this run. Only these get their body path re-decided
    // after their document syncs — a canvas already on this disk has its path
    // from the disk, and letting the wire move it would be exactly the
    // "a peer relocates another peer's work" hazard the hub refuses too.
    // A PULL MAY NEVER TARGET A FILE THAT IS ALREADY ON THIS DISK.
    //
    // "Hub-only" means "no local DESCRIPTOR", which is not the same as "no local
    // file": `scanCanvases` omits a canvas whose `.meta.json` says
    // `syncable: false` (a security opt-out a hub must not be able to flip) and
    // one the sandbox gate excluded. Such a canvas is classified hub-only and
    // pulled, and its target — whether the fallback or a carried path — is the
    // real file. Note the fallback collides on its own: `ui-card` falls back to
    // `ui/card.tsx`, which IS `ui/Card.tsx` on a case-insensitive filesystem, so
    // checking only the carried path would leave the same overwrite reachable
    // with no path at all.
    //
    // Refusing the canvas is the conservative answer and the recoverable one:
    // the project keeps the file it has, and the document is still on the hub.
    //
    // APPLIED TO THE FALLBACK TOO, not only to a carried path. The fallback is
    // derived from the slug and the slug is derived from the path, so it lands
    // in the same place: `system-colors_and_type` falls back to
    // `system/colors_and_type.tsx` whether or not a path arrives. Checking only
    // the carried path leaves every one of these reachable with no path at all.
    // The boot pull asks the SAME two questions the incremental one does — the
    // sandbox/opt-out gate on a hub-authored body, and the pinned-room ceiling.
    // Both were missing here too; the incremental lane just made their absence
    // permanent instead of momentary. See `admitPulledBody` and MAX_PULLS_PER_POLL.
    const admittedPulls = pulled
      // A canvas the project deleted is never pulled, however it is still listed.
      .filter((t) => !tombstoned.has(t.slug))
      .filter((t) => admitPullTarget(ctx, t.slug, t.bodyAbs))
      .filter((t) => admitPulledBody(t.slug, t.bodyAbs))
      .slice(0, Math.max(0, maxPinnedRooms() - localCanvases.length));
    const pulledSlugs = new Set(admittedPulls.map((t) => t.slug));
    for (const t of admittedPulls) everPulled.add(t.slug);
    /**
     * Tell the panel EVERYTHING that came down this run, boot included.
     *
     * `notePulled` REPLACES the list, and the boot pull used to pass its own
     * slugs directly — so the first mid-session pull erased every boot-pulled
     * canvas from the surface, which is precisely what `everPulled` exists to
     * stop. One accumulating set, one caller.
     */
    const notePulledAll = (): void => mon.notePulled([...everPulled]);
    /**
     * Slugs pulled AFTER boot, which never get the fresh-link relaxation.
     *
     * `allowUndeclaredGroup` exists for exactly one moment: the first connect of
     * a bare folder somebody just pointed at a project, which has declared no
     * canvas groups and would otherwise refuse every incoming path. It closes as
     * soon as one group is learned. A mid-session pull is not that moment — and
     * because `relocatePulled` reads `pathOpts` at call time, a project that
     * never learned a group would otherwise leave the relaxation open for every
     * later arrival, which is an unbounded directory-creation primitive for the
     * hub. Membership in this set overrides the flag, per canvas.
     */
    const strictPullSlugs = new Set<string>();
    const canvases = [
      ...localCanvases,
      ...admittedPulls.map((t) => descriptorFor(t.slug, t.bodyAbs)),
    ];
    /**
     * Seed the live descriptor set from the boot set — see `descriptors`.
     */
    for (const c of canvases) descriptors.set(c.slug, c);
    // T4.5 (DDR-054 §3 F3) — every syncable canvas can receive hub-pushed
    // content, so the whole set is untrusted Claude-context. Mark it (writes
    // `_untrusted/INDEX.json` + a managed `.claudeignore` block; clears both
    // when the set is empty). Best-effort — never throws into boot.
    //
    // NOT under cell pairing. The markers exist for Claude Code reading the
    // checkout, and nothing runs Claude against a cell's tree. `.claudeignore`
    // is a REPO-ROOT file, so writing it here would put a machine-authored file
    // into the tenant's repository, which the hub would then commit and mirror
    // to their GitHub — a change to somebody's repo that nobody asked for. The
    // canvases are no less untrusted; the audience for the marker is absent.
    //
    // MARKED AT THE PATH THE BODY ACTUALLY LANDS AT. A pulled canvas's target is
    // provisional here — the listing carries no path, so every pulled entry is
    // the fallback, and `relocatePulled` moves it once that document arrives.
    // The markers used to be computed ONLY from this provisional set and never
    // recomputed, so for a hub-only document carrying a nested path the
    // `_untrusted/INDEX.json` + `.claudeignore` block named a file that is never
    // created, while the genuinely hub-pushed body sat at the real path listed
    // nowhere. That is the DDR-054 §3 F3 control pointing at a phantom.
    //
    // So it is written twice: once now (so the markers exist before any provider
    // is built) and once after the pulls settle, from the final descriptors.
    // Reads the LIVE set, not the boot array — see `descriptors`.
    const markUntrusted = (): void => {
      if (cellPairing) return;
      // Plane B's landed set comes from the ledger, which is the only place
      // that knows what the hub actually delivered here. A path that never
      // arrived is not marked (the markers pointing at a phantom is the exact
      // failure the two-write dance above exists to avoid).
      const planeFiles = fileLedger
        ? Object.entries(fileLedger.rows())
            .filter(([, row]) => row.syncedHash !== null)
            .map(([rel]) => rel)
        : [];
      writeUntrustedMarkers(ctx, [...descriptors.values()], linkedHub.url, planeFiles);
    };
    markUntrusted();
    if (canvases.length === 0) {
      // DDR-060 / 9.1-D — the silent early-return made linked mode look healthy
      // while syncing nothing (TSX-only projects: discovery admits .html only,
      // .tsx needs the opt-in + sandbox gate that 9.1-A/B ship). Surface the gap
      // loudly: a warn, a `_sync.json` the CLI + browser banner read, and a bus
      // broadcast so open tabs render it immediately.
      surfaceNoSyncable(ctx, linkedHub.url, scan.tsxCount);
      // A PROJECT WITH NOTHING IN IT YET IS STILL A PROJECT.
      //
      // This return happens before the status store, the monitor and the fs
      // reader exist, so the continuous-discovery machinery at the bottom of
      // start() is never reached — and a person who links an empty project and
      // then makes their first canvas would be back to "nothing syncs until you
      // restart", which is the whole bug, reached from its emptiest corner.
      //
      // A full cycle IS the right answer here and only here: there is no runtime
      // state to preserve, and one is exactly what a first canvas needs. The
      // supervisor owns cycling (it holds the serialization), so this asks
      // rather than acts — see `server.ts`.
      const watchForFirst = createRescanScheduler({
        debounceMs: DISCOVERY_DEBOUNCE_MS,
        onError: (err) => console.error('[sync] first-canvas watch failed:', err),
        run: async () => {
          if (stopped || opts.canvases) return;
          const again = await scanCanvases(ctx);
          if (admitCanvases(again.canvases, useSharedDoc).length === 0) return;
          console.log('[sync] the project has its first syncable canvas — starting sync.');
          ctx.bus.emit('sync:needs-restart');
        },
      });
      discoveryRescan = watchForFirst;
      discoveryUnsub = ctx.bus.on('canvas-list-update', () => watchForFirst.schedule());
      return;
    }

    // The store is created BEFORE the consent notices below so they land in
    // the payload (feature-before-first-external-users Task 1): a notice that
    // exists only as a console.warn never reaches a terminal-free desktop
    // user — the same disease the breaker `held` field cured.
    statusStore =
      opts.statusStore ??
      createSyncStatusStore({
        url: linkedHub.url,
        canvases: canvases.length,
        sharedDoc: useSharedDoc,
        write: (payload) => {
          const file = path.join(ctx.paths.designRoot, '_sync.json');
          writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        },
        broadcast: (payload) => ctx.bus.emit('sync:status', payload),
      });
    const store = statusStore;

    // DDR-079 — TSX sync defaults ON, so every linked non-loopback project that
    // ships .tsx broadcasts the WebRTC/self-nav exfil residual (the sandbox
    // contains execution but not that lane) to every synced canvas. The default
    // traded a footgun (silent 0-syncable) for this surface, so the surface must
    // be LOUD: a banner on every `serve` naming the count + the opt-outs. Fires
    // unless explicitly opted out (`syncTsx: false`); loopback hubs (local dev)
    // skip it — no remote exfil concern.
    const tsxBodyCount = canvases.filter((c) => c.html.toLowerCase().endsWith('.tsx')).length;
    if (linkedHub.syncTsx !== false && tsxBodyCount > 0 && !isLoopbackHubUrl(linkedHub.url)) {
      const tsxNotice = `${tsxBodyCount} TSX canvas ${tsxBodyCount === 1 ? 'body' : 'bodies'} will sync to ${linkedHub.url} (TSX sync is ON by default — DDR-079). The sandbox contains execution, but a WebRTC/self-nav exfil residual applies to every synced canvas — link only hubs you operate or trust. Opt out: linkedHub.syncTsx=false (whole project) or a canvas .meta.json "syncable": false (one canvas).`;
      console.warn(`[sync] ${tsxNotice}`);
      store.notice({ id: 'tsx-bodies', severity: 'warn', text: tsxNotice });
    }

    // DDR-064 pre-cutover A7 — one-time notice, before any doc is attached.
    // Terminal once per process; the payload notice fires every boot (the
    // client keeps its own per-(id, hub) dismiss ack, so re-announcing after a
    // restart costs nothing and a NEW hub url resurfaces it by design).
    if (useSharedDoc && !cellPairing) {
      noticeSharedDocOnce(linkedHub.url, false);
      store.notice({
        id: 'shared-doc',
        severity: 'warn',
        text: sharedDocNoticeText(linkedHub.url),
      });
    }
    monitor =
      opts.connectionMonitor ?? createConnectionMonitor({ onChange: (snap) => store.update(snap) });
    const mon = monitor;

    const reader = createFsReader({
      rootDir: ctx.paths.designRoot,
      accept: (rel) => {
        const ext = path.extname(rel).toLowerCase();
        // `.tsx` added in T3 (9.1-B) so local edits to an opted-in syncable
        // `.tsx` body propagate. Non-syncable `.tsx` changes still notify but
        // match no agent in onRead (descriptor-scoped) → harmless no-op.
        // `.css` added in Gap 3 so the canvas's sibling stylesheet syncs.
        return (
          ext === '.html' || ext === '.tsx' || ext === '.json' || ext === '.svg' || ext === '.css'
        );
      },
      onRead: (evt) => {
        const abs = path.join(ctx.paths.designRoot, evt.path);
        // Dispatch to whichever disk handler owns this path. Only one of
        // agents/projections is populated (useSharedDoc decides); the projector
        // exposes the same applyFromFs(evt) shape as the agent.
        for (const agent of agents.values()) {
          if (agent.applyFromFs({ path: abs, bytes: evt.bytes, hash: evt.hash })) return;
        }
        for (const proj of projections.values()) {
          if (proj.applyFromFs({ path: abs, bytes: evt.bytes, hash: evt.hash })) return;
        }
      },
    });
    fsReader = reader;

    busUnsub = ctx.bus.on('fs:any', (rel: string) => {
      reader.notify(rel);
      // AN ASSET THAT APPEARS AFTER BOOT HAS TO GO UP NOW, NOT NEXT LAUNCH.
      //
      // The push used to fire from exactly one place — `start()` — so a picture
      // pasted into an annotation reached the cloud only on the next boot or
      // Resync. Meanwhile the annotation itself syncs through the doc in
      // milliseconds, so the other side rendered an `<image>` pointing at bytes
      // nobody had sent: a permanent empty frame that looked like a broken path.
      // Reported three times in one day on alligators, each time with a
      // different asset, which is what finally named it.
      //
      // On a Sync v2 hub the plane's own trigger below carries this moment;
      // the legacy schedule is a no-op there (`legacyLane === false`).
      if (isPushableAssetRel(rel, ctx.cfg.canvasGroups)) {
        scheduleLegacyPush(linkedHub.url);
      }
      // Sync v2 — the file plane's own trigger. Invalidating the stat cache
      // first is the exact, cheap version of the mtime-granularity guard: the
      // watcher KNOWS this path moved, so the next scan must read it rather
      // than trust a timestamp that a same-length edit could have left alone.
      if (fileLedger) {
        fileLedger.noteChanged(rel.split('\\').join('/'));
        schedulePlanePass();
      }
    });

    /**
     * Tell the rest of the server that a doc→file projection write landed.
     *
     * Only wired under cell pairing. In a container the recursive `fs.watch`
     * misses our atomic tmp+rename writes, so a peer's edit reaches the doc and
     * the disk and then stops: no `fs:any`, no `canvas-hmr`, and the other
     * person's canvas iframe stays on the old render until they reload by hand.
     * That is the same gap `createContainerWriteBridge` closes for API writes —
     * it cannot close this one, because it triggers off `activity:suppress` and
     * the projector never arms it.
     *
     * Delayed by the bridge's margin so a watcher that DOES fire gets there
     * first; the HMR broadcaster coalesces per file within its own debounce, so
     * both arriving is one reload, not two.
     *
     * Keyed by path, mirroring `createContainerWriteBridge`'s own
     * clear-and-replace pattern rather than a flat timer bag — html/css/meta
     * can each flush and re-flush across cold-start `reconcile()` plus the
     * first real edit landing moments later, and two announcements for the
     * SAME file inside the delay window would have been two `fs:any` events,
     * i.e. two reloads for one edit. A per-path replace collapses that back
     * to one, same as the sibling mechanism this is modeled on (not reused
     * directly — that one lives in `ws.ts`/`hmr-broadcast.ts` and arms off
     * `activity:suppress`, a server-boot-scoped bus the sync runtime doesn't
     * otherwise depend on; duplicating the small delay-then-emit shape here
     * keeps this runtime testable standalone, the way every test in
     * `shared-doc-cell-pairing.test.ts` relies on).
     */
    const announceWrite = (abs: string): void => {
      const rel = path.relative(ctx.paths.designRoot, abs).split(path.sep).join('/');
      // Outside the design root there is nothing for the canvas layer to reload.
      if (!rel || rel.startsWith('..')) return;
      const prev = announceTimers.get(rel);
      if (prev) clearTimeout(prev);
      announceTimers.set(
        rel,
        setTimeout(() => {
          announceTimers.delete(rel);
          if (stopped) return;
          ctx.bus.emit('fs:any', rel);
        }, SYNTHETIC_FS_DELAY_MS)
      );
    };

    const adoptOnce = opts.adopt ?? !!linkedHub.adopt;
    let adoptReconciled = 0;
    const adoptTarget = canvases.length;

    // DDR-102 — journal + snapshot wiring for the conflict protocol. The
    // journal is per-hub (relink to a different hub wipes it); snapshots land
    // in `_history/<slug>/` via history.ts so /design:rollback recovers them.
    journal = loadJournal(ctx.paths.designRoot);
    journal.invalidateIfHubChanged(linkedHub.url);
    const history = createHistory(ctx);

    // ---- DDR-102 helpers: auth aggregation, re-probe, settle bookkeeping ----

    const flushAuthWarn = (): void => {
      authWarnTimer = null;
      if (stopped || pendingAuthWarn.size === 0) return;
      const lines: string[] = [];
      for (const [cls, slugs] of pendingAuthWarn) {
        const list = [...slugs];
        const shown = list.slice(0, 10).join(', ');
        const more = list.length > 10 ? ` (+${list.length - 10} more)` : '';
        lines.push(
          `  ${list.length} canvas(es) [${cls}]: ${shown}${more}\n    → ${AUTH_CLASS_HINT[cls]}`
        );
      }
      pendingAuthWarn.clear();
      console.warn(`[sync] hub auth rejections (${linkedHub.url}):\n${lines.join('\n')}`);
    };

    /** Reconnect every permanently-rejected doc now. Idempotent — the map is
     *  drained, so a second call during the same burst is a no-op. */
    const reprobeNow = (): void => {
      if (stopped) return;
      if (reprobeTimer !== null) {
        authClearTimer(reprobeTimer);
        reprobeTimer = null;
      }
      const entries = [...rejectedPermanent.values()];
      rejectedPermanent.clear();
      for (const entry of entries) {
        mon.noteDocState(entry.canvas.slug, 'pending');
        void connectCanvas(
          entry.canvas,
          entry.canvasPaths,
          entry.doc,
          owedSetups.get(entry.canvas.slug)
        ).catch((err) => {
          console.error(`[sync/${entry.canvas.slug}] re-probe failed:`, err);
        });
      }
    };

    const scheduleReprobe = (): void => {
      if (reprobeTimer !== null || stopped) return;
      reprobeTimer = authSetTimer(() => {
        reprobeTimer = null;
        reprobeNow();
      }, reprobeMs);
    };

    /**
     * Arm the transient lane's ONE timer (single-flight) for the earliest due
     * document — or, when the sliding budget is spent, for the moment its
     * oldest re-auth leaves the window — plus jitter.
     */
    const armTransientRetry = (): void => {
      if (transientRetryTimer !== null || stopped || rejectedTransient.size === 0) return;
      let at = Number.POSITIVE_INFINITY;
      for (const e of rejectedTransient.values()) at = Math.min(at, e.dueAt);
      const oldestSpend = transientSpent[0];
      if (transientSpent.length >= transientBatch && oldestSpend !== undefined) {
        at = Math.max(at, oldestSpend + transientRetryMs);
      }
      const delay = Math.max(0, at - renewNow()) + Math.floor(authRandom() * transientJitterMs);
      transientRetryTimer = authSetTimer(
        () => {
          transientRetryTimer = null;
          retryTransientNow();
        },
        Math.min(MAX_TIMER_DELAY_MS, delay)
      );
    };

    /**
     * Re-authenticate the due transiently-refused documents — only those, never
     * the shared socket — up to the budget, oldest first; the rest wait for the
     * next arm. The swap is the re-probe's: destroy the refused provider and
     * reconnect on the SAME doc, so the agent and projection wiring carry over.
     * A provider attached to an already-open socket sends its token at once
     * (`HocuspocusProviderWebsocket.attach` → `provider.onOpen`).
     */
    const retryTransientNow = (): void => {
      if (stopped) return;
      const now = renewNow();
      while (transientSpent.length > 0 && now - (transientSpent[0] ?? now) >= transientRetryMs) {
        transientSpent.shift();
      }
      const due = [...rejectedTransient.entries()]
        .filter(([, e]) => e.dueAt <= now)
        .sort((x, y) => x[1].dueAt - y[1].dueAt)
        .slice(0, Math.max(0, transientBatch - transientSpent.length));
      for (const [slug, entry] of due) {
        rejectedTransient.delete(slug);
        if (providers.get(slug) !== entry.provider) continue;
        transientSpent.push(now);
        providers.delete(slug);
        try {
          entry.provider.destroy();
        } catch {
          /* best-effort */
        }
        mon.noteDocState(slug, 'pending');
        // Not a boot connect — a retry must never join the one-shot boot summary.
        void connectCanvas(
          entry.canvas,
          entry.canvasPaths,
          entry.doc,
          owedSetups.get(slug),
          false
        ).catch((err) => {
          console.error(`[sync/${slug}] transient re-auth failed:`, err);
        });
      }
      armTransientRetry();
    };

    /**
     * Renew the hub credential in place — single-flight, silent, and never
     * worse than failure: an unrenewable credential leaves the stored one
     * untouched and every existing behaviour (slow re-probe, refused status)
     * exactly as it was.
     */
    const renewCredentialNow = (): Promise<boolean> => {
      if (!renewCredential || stopped) return Promise.resolve(false);
      if (renewInFlight) return renewInFlight;
      // F1 — the cap: renewals that keep succeeding without a handshake landing
      // are not fixing anything (a real fix clears at least one doc, which
      // resets this to 0). Stop, and let the docs' own rejected state surface
      // as refused/stalled — both name "reconnect the workspace".
      if (renewalsSinceProgress >= renewMaxWithoutProgress) return Promise.resolve(false);
      // F1 — the floor: one renewal per interval, whatever the outcome. Stamped
      // here (commit point), not on success, so a failing renewal also waits.
      const sinceLast = renewNow() - lastRenewAt;
      if (lastRenewAt !== 0 && sinceLast < renewMinIntervalMs) return Promise.resolve(false);
      lastRenewAt = renewNow();
      renewInFlight = (async () => {
        try {
          const fresh = await renewCredential();
          if (stopped || !fresh || typeof fresh.token !== 'string' || !fresh.token) return false;
          token = fresh.token;
          tokenExpiresAt = validExpiry(fresh.expiresAt);
          renewalsSinceProgress++;
          console.log(`[sync] hub credential renewed for ${linkedHub.url}`);
          scheduleRenewal();
          return true;
        } catch (err) {
          console.warn(`[sync] hub credential renewal failed: ${(err as Error).message}`);
          return false;
        } finally {
          renewInFlight = null;
        }
      })();
      return renewInFlight;
    };

    /**
     * Arm the pre-expiry renewal at ~80 % of the credential's REMAINING life
     * (never sooner than a minute out). No stored expiry — a self-hosted hub,
     * or a credential written before expiry was persisted — means no timer:
     * exactly the old behaviour. A failed renewal retries on the re-probe
     * cadence; once the credential actually dies, the invalid-token path
     * below triggers renewal anyway, so the timer is an optimization, not the
     * safety net.
     */
    const scheduleRenewal = (): void => {
      if (renewTimer !== null) {
        authClearTimer(renewTimer);
        renewTimer = null;
      }
      if (!renewCredential || stopped || tokenExpiresAt === null) return;
      // F2 — clamp both ends. The lower floor keeps a near-expiry credential
      // from arming an immediate timer; the upper clamp stops a far-future
      // `expiresAt` (validExpiry already rejects > 30 d, but a peer's clock
      // skew can still land the *delay* past setTimeout's int32 ceiling, where
      // it silently fires at 1 ms) from becoming a tight loop.
      const raw = (tokenExpiresAt - renewNow()) * 0.8;
      const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(60_000, raw));
      renewTimer = authSetTimer(() => {
        renewTimer = null;
        void renewCredentialNow().then((ok) => {
          // F4 — a failed pre-expiry renewal RE-ARMS on the slow cadence
          // (through scheduleRenewal, so the frequency floor + cap still
          // apply) instead of leaving the process with no scheduled renewal
          // for the rest of its life.
          if (!ok && !stopped && tokenExpiresAt !== null) {
            renewTimer = authSetTimer(() => {
              renewTimer = null;
              void renewCredentialNow().then((ok2) => {
                if (!ok2) scheduleRenewal();
              });
            }, reprobeMs);
          }
        });
      }, delay);
    };

    const handleAuthFailure = (
      canvas: CanvasDescriptor,
      canvasPaths: import('./agent.ts').CanvasSyncPaths,
      provider: SyncProvider,
      rawReason: string
    ): void => {
      if (stopped) return;
      const reasonClass = classifyAuthFailure(rawReason);
      // feature-sync-progress-modal — the class rides into the per-item list so
      // a rejected row in the Sync panel can say WHY (our vocabulary, not the
      // hub's raw message).
      mon.noteDocState(canvas.slug, 'auth-rejected', reasonClass);
      rejectedReasons.set(canvas.slug, reasonClass);
      // Every class, including the transient ones that keep their provider —
      // see `rejectedAny`. This is the set the reconnect path consults.
      rejectedAny.add(canvas.slug);
      // Aggregate console output: ONE debounced warn for the whole burst.
      if (!pendingAuthWarn.has(reasonClass)) pendingAuthWarn.set(reasonClass, new Set());
      pendingAuthWarn.get(reasonClass)?.add(canvas.slug);
      if (authWarnTimer === null) authWarnTimer = authSetTimer(flushAuthWarn, warnDebounceMs);
      // Permanent classes: retrying only spams the hub (and its rate bucket) —
      // destroy the provider and re-probe on a slow timer. Transient classes
      // (rate-limit / generic) get the paced retry below.
      if (reasonClass === 'not-authorized' || reasonClass === 'invalid-token') {
        rejectedTransient.delete(canvas.slug);
        if (!rejectedPermanent.has(canvas.slug)) {
          rejectedPermanent.set(canvas.slug, { canvas, canvasPaths, doc: provider.document });
          providers.delete(canvas.slug);
          try {
            provider.destroy();
          } catch {
            /* best-effort */
          }
          scheduleReprobe();
        }
        // An invalid token is the one refusal the runtime can FIX: the stored
        // credential expired (≤ 12 h cell sessions, Phase 23 B2) while the
        // account next to it is still signed in. Renew silently — single-flight
        // across the whole burst — and on success reconnect the rejected docs
        // NOW instead of making the user wait out the slow re-probe (or press
        // Connect again, which is all this ever needed).
        if (reasonClass === 'invalid-token') {
          void renewCredentialNow().then((renewed) => {
            if (renewed) reprobeNow();
          });
        }
      } else if (!rejectedTransient.has(canvas.slug)) {
        // THE HUB MAY WELL SAY YES NEXT WINDOW — BUT NOTHING WOULD ASK IT.
        //
        // These classes used to be left to "the provider's built-in backoff".
        // Under DDR-102 multiplexing that backoff is the SOCKET's reconnect
        // loop, and a partial refusal never closes a socket the other
        // documents keep healthy — so a refused document stayed refused until
        // the process ended. Queue it for the runtime's own retry instead: one
        // hub window out, doubling on each repeat (capped at the re-probe
        // interval), reset by a handshake that lands. The `has` guard keeps a
        // repeated event for one refusal from counting as a second strike.
        const strikes = (transientStrikes.get(canvas.slug) ?? 0) + 1;
        transientStrikes.set(canvas.slug, strikes);
        const wait = Math.min(
          Math.max(transientRetryMs, reprobeMs),
          transientRetryMs * 2 ** (strikes - 1)
        );
        rejectedTransient.set(canvas.slug, {
          canvas,
          canvasPaths,
          doc: provider.document,
          provider,
          dueAt: renewNow() + wait,
        });
        armTransientRetry();
      }
    };

    /**
     * A HANDSHAKE THAT COMPLETED IS NOT A REJECTED DOCUMENT.
     *
     * `auth-rejected` is deliberately sticky — a dropped socket must not launder
     * a rotated credential into a spinner. But the verdict is about the HUB'S
     * ANSWER, and the hub has just given a different one: this document
     * connected. Clearing it here, at the top of the post-handshake path, means
     * a re-probe that succeeds clears the record even if the reconcile below
     * then fails for a reason that has nothing to do with authentication — which
     * is how `0 synced · 73 rejected` survived on a link the hub was accepting.
     *
     * A GENUINE rejection still says so: nothing clears until a handshake for
     * that document actually completes.
     */
    const clearRejection = (slug: string): void => {
      rejectedPermanent.delete(slug);
      rejectedTransient.delete(slug);
      transientStrikes.delete(slug);
      rejectedAny.delete(slug);
      if (!rejectedReasons.delete(slug)) return;
      console.log(`[sync/${slug}] the hub accepted this document — clearing its refusal.`);
    };

    /**
     * Stamp `syncMeta.path` from where this canvas actually is on THIS disk —
     * never echoed from the wire, so a value some receiver refused is never
     * laundered onward by being re-sent. Best-effort: a failure never costs
     * the canvas its sync.
     */
    const stampFromLocalFile = (doc: Y.Doc, htmlAbs: string): void => {
      try {
        const rel = path.relative(ctx.paths.designRoot, htmlAbs).split(path.sep).join('/');
        if (rel && !rel.startsWith('..')) stampCanvasPath(doc, rel, ORIGINS.DISK_PROJECTION);
      } catch {
        /* best-effort bookkeeping — never costs the canvas its sync */
      }
    };

    /** Post-handshake reconcile — shared by first connect and re-probe. */
    const handleSynced = async (
      canvas: CanvasDescriptor,
      canvasPaths: import('./agent.ts').CanvasSyncPaths,
      provider: SyncProvider
    ): Promise<void> => {
      if (stopped) return;
      // A RETIRED document (codec stampMovedTo) has nothing to reconcile —
      // its canvas moved to a new path in a new document. Seen here mostly by
      // a machine that pulled the project down after the move: connect, learn
      // the fact, let go. The watcher handles a stale local copy.
      const movedTo = movedToFromDoc(provider.document);
      if (movedTo !== null) {
        // A DOCUMENT THAT SAYS IT MOVED TO WHERE IT ALREADY IS DID NOT MOVE.
        //
        // The stamp lives inside the document, and a move renames the canvas's
        // `_state/<slug>.ydoc.bin` cache onto the new slug — so the NEW document
        // opened with the OLD one's last word, "I have moved away". Every peer
        // released it as retired, the destination path never appeared anywhere
        // but on the machine that did the move, and the whole thing read as
        // "folders don't sync": each side showed its own move and the other's
        // canvas still at the root. `canvas-artifacts.ts` stops producing this
        // (the cache is dropped, not carried); clearing the stamp is what
        // REPAIRS the trees that already have it, and because it is a doc edit
        // the correction reaches every peer that believed it.
        const movedAbs = path.resolve(
          ctx.paths.designRoot,
          movedTo.replace(/\\/g, '/').replace(/^\/+/, '')
        );
        // ONLY A LOCAL DESCRIPTOR MAY BE REPAIRED. For a PULLED canvas
        // `canvas.html` is the provisional slug-derived target, not a path this
        // disk chose — and `relocatePulled` returns early for a retired document,
        // so it never went through `resolvePulledTarget`, the `canvas-path.ts`
        // rules, or the re-ask of `admitPullTarget`. A hub picks the document
        // NAME (hence that provisional path) and writes `movedTo`, so it would
        // control BOTH sides of this equality — turning a repair into a write to
        // an unvalidated path, which is the resurrection primitive the retirement
        // release exists to deny. The repair is for the machine that did the
        // move, whose descriptor came from its own scan.
        if (
          !pulledSlugs.has(canvas.slug) &&
          canvas.html &&
          path.resolve(canvas.html) === movedAbs
        ) {
          if (clearMovedTo(provider.document, ORIGINS.MIGRATION)) {
            console.log(
              `[sync/${canvas.slug}] this document is stamped as moved to its OWN path — clearing the stale retirement and keeping the canvas.`
            );
          }
        } else {
          // Remembered, so the remote pull never fetches this document again —
          // logging this line every 20 s forever was the symptom that found the
          // churn.
          retiredDocs.add(canvas.slug);
          console.log(
            `[sync/${canvas.slug}] document is retired (canvas moved to ${movedTo}) — releasing.`
          );
          void onRetirementSeen(canvas.slug);
          return;
        }
      }
      clearRejection(canvas.slug);
      // Not `connected` yet — the reconcile below is what makes that true. But
      // no longer refused, and the difference is the whole point: `pending` says
      // "still settling", `auth-rejected` says "go fix your credential".
      mon.noteDocState(canvas.slug, 'pending');
      const projection = projections.get(canvas.slug);
      const agent = agents.get(canvas.slug);
      if (projection) {
        // Phase E (DDR-064 Task 9) — one-time authoritative seed BEFORE
        // materializing: escapes the duplication trap by picking ONE source
        // inside a MIGRATION transaction. DDR-102: body divergence now takes
        // the journal-gated conflict path (dual snapshot + newest-wins)
        // instead of blind hub-wins. The room file-seed is disabled for this
        // pinned slug (createCollab shouldSeed).
        const relBody = path.relative(ctx.paths.repoRoot, canvas.html);
        const result = await migrateSeed({
          slug: canvas.slug,
          doc: provider.document,
          paths: canvasPaths,
          historyDir: path.join(ctx.paths.historyDir, canvas.slug),
          journal: journal ?? undefined,
          snapshot: async (content, reason) => {
            try {
              const snap = await history.writeSnapshot(relBody, content, reason);
              return snap.ts;
            } catch {
              return null;
            }
          },
          onConflict: (info) => store.addConflict(info),
          hubHasState: (slug) => hubHolds(hubDocIndex, docNameFor(slug)),
        });
        if (result === 'local-adopt') {
          console.log(`[sync/${canvas.slug}] shared-doc: adopted local state (hub was empty).`);
        } else if (result === 'defer-hub-state') {
          console.log(
            `[sync/${canvas.slug}] shared-doc: not seeding — the hub already holds this ` +
              'document; waiting for its state to arrive.'
          );
        } else if (result === 'conflict-local-wins' || result === 'conflict-hub-wins') {
          console.warn(
            `[sync/${canvas.slug}] shared-doc: diverged — kept the ${
              result === 'conflict-local-wins' ? 'local' : 'hub'
            } version (newest-wins); the other is in _history/${canvas.slug}/ — recover via /design:rollback.`
          );
        }
        // Then materialize the converged doc to disk (safe — never clobbers
        // non-empty local with an empty doc value).
        projection.reconcile();
      } else if (agent) {
        await agent.reconcile();
        if (adoptOnce) {
          adoptReconciled++;
          if (adoptReconciled === adoptTarget) {
            // All canvases adopted — clear the flag from .design/config.json
            // so re-running serve doesn't re-trigger. DDR-054 §2i.
            clearAdoptFlag(ctx);
          }
        }
      }
      // The path travels back OUT — re-stamped post-reconcile as the belt to
      // connectCanvas's pre-handshake braces (fix 5): this also covers a PULLED
      // canvas, whose real local path exists only after relocatePulled ran.
      stampFromLocalFile(provider.document, canvasPaths.html);

      // DDR-102 — honest status: the handshake + reconcile completed.
      mon.noteDocState(canvas.slug, 'connected');
      mon.noteSyncActivity(canvas.slug);
      lastPromotionAt = stallNow();
      forcedReconnects = 0;
      // F1 — a completed handshake IS progress: a renewal actually helped, so
      // the no-progress cap resets. Without this a healthy link that renews
      // legitimately every 12 h would burn one cap slot per renewal forever.
      renewalsSinceProgress = 0;
    };

    /**
     * `handleSynced`, with the one guarantee its body cannot make for itself.
     *
     * Everything from `migrateSeed` to `agent.reconcile()` can throw, and the
     * rejection was swallowed by `settleWait` — so a document whose reconcile
     * failed never reached the `connected` line and sat on whatever its last
     * verdict was, forever, with nothing on screen or in the log saying why.
     * A reconcile failure is a real failure and is now LOUD; it leaves the
     * document `pending` (set at the top of `handleSynced`), which is what it
     * is: connected to the hub, not yet settled on disk.
     */
    const runHandleSynced = async (
      canvas: CanvasDescriptor,
      canvasPaths: import('./agent.ts').CanvasSyncPaths,
      provider: SyncProvider
    ): Promise<void> => {
      try {
        await handleSynced(canvas, canvasPaths, provider);
      } catch (err) {
        console.error(`[sync/${canvas.slug}] post-handshake reconcile failed:`, err);
      }
    };

    /**
     * A DOCUMENT THAT RE-HANDSHAKES IS A SYNCED DOCUMENT AGAIN.
     *
     * The bug this closes (issue #118), stated plainly: `noteDocState(slug,
     * 'connected')` had exactly ONE call site — the post-handshake reconcile
     * inside `connectCanvas`, which runs at attach, adopt and auth-re-probe and
     * at no other time. A dropped socket demotes every `connected` document to
     * `pending` (`noteProviderStatus`, deliberately — a document whose socket is
     * gone is not a synced document), and NOTHING re-promoted it when the socket
     * came back. The demotion was therefore permanent for the life of the
     * runtime: observed live as `state:"online", docs:{synced:0, pending:85}`
     * fifteen minutes after a boot whose own log line read `85/87 synced`.
     *
     * Downstream that reads as the worst kind of wrong: `syncPresentation` sees
     * "connected to the hub, zero documents settled, and it has been like that a
     * while" and reports a STALL blamed on the credential — so the remedy the
     * product offered (reconnect the workspace) was the one thing that could not
     * help, and the Resync it prompts re-handshakes every document against a
     * cold cell and lands on `offline`.
     *
     * What this does NOT do is re-run `handleSynced`. That path carries
     * migrate-seed, cold-start divergence resolution and history snapshots — a
     * one-time authoritative seed, correctly named as such, and firing it for
     * every canvas on every reconnect would turn a network blip into a
     * conflict-resolution storm. The honest signal is narrower and sufficient:
     * the hub completed a sync handshake for THIS document, so it is connected
     * again. Nothing on disk is touched.
     *
     * Single-flight per slug — a flapping socket must not stack one pending
     * promise per transition — and every guard is re-checked AFTER the await,
     * because a runtime can stop, and a canvas can be released, while we wait.
     */
    const repromoting = new Set<string>();
    const repromoteOnReconnect = async (slug: string, provider: SyncProvider): Promise<void> => {
      if (stopped || repromoting.has(slug)) return;
      // REFUSED IS REFUSED, WHATEVER THE CLASS.
      //
      // This guard read `rejectedPermanent`, and that map holds only the two
      // PERMANENT classes — `generic` and `rate-limit` keep their provider
      // until the transient retry swaps it, and never enter it. `generic` is what
      // EVERY pre-DDR-102 hub sends. So a refusal in a transient class passed
      // straight through this guard and got overwritten with `connected`
      // (attacker review 2026-09-03, F3): the hub was dropping this document's
      // writes while the panel rendered it green, `docs.rejected` fell back to
      // 0, and the `refused` branch — plus the offline-long "git push as
      // backup" escalation — could never fire. `rejectedAny` is the honest set:
      // every class enters it, `clearRejection` is the only thing that empties
      // it, and it is checked on BOTH sides of the await because the refusal
      // that matters is the one that lands while we are waiting.
      if (rejectedAny.has(slug)) return;
      repromoting.add(slug);
      try {
        // BOUNDED, because `onceSynced()` can never settle.
        //
        // `handleAuthFailure` on a permanent class calls `provider.destroy()`,
        // and destroy emits `destroy`, never `synced` — so the promise below
        // stays pending for the life of the process, `finally` never runs, and
        // the slug stays latched in `repromoting` forever. Every later genuine
        // reconnect for that document would then return at the guard above:
        // issue #118 recreated per-document, permanently, by its own fix
        // (attacker review 2026-09-03, F4). `settleWait` already exists for
        // exactly this ("never hangs the summary on an auth-rejected provider
        // whose handshake never completes") — reuse it rather than invent a
        // second ceiling.
        //
        // `settleWait` resolves on the TIMEOUT as well as on success, so the
        // flag is what separates "the handshake landed" from "we stopped
        // waiting for it". Without it the timeout would promote the document.
        let landed = false;
        // The ceiling below stops us WAITING; the abort is what stops us
        // LISTENING. Skipping it leaked a `synced` listener + closure per
        // abandoned wait, forever (N2) — invisible while the latch bug meant we
        // never retried, unbounded once that was fixed.
        const giveUp = new AbortController();
        try {
          await settleWait(
            provider.onceSynced(giveUp.signal).then(() => {
              landed = true;
            })
          );
        } finally {
          giveUp.abort();
        }
        if (!landed || stopped) return;
        // Still ours, still not refused — either can have changed in flight.
        if (providers.get(slug) !== provider || rejectedAny.has(slug)) return;
        // ONE mutator, not two. `noteSyncActivity` promotes pending→connected
        // AND stamps the clock in a single emit, and it is the one that refuses
        // to resurrect an `auth-rejected` document — so it is both cheaper and
        // safer here than pairing it with `noteDocState`. Every emit is a
        // synchronous `_sync.json` write plus a fan-out to every open tab, and
        // `noteSyncActivity` has no change-dedupe of its own: on an 85-canvas
        // project the pair cost ~340 writes per hub-driven flap against ~170
        // for the demotion alone (defender F4 / attacker F5).
        //
        // Residual, stated rather than hidden: a completed handshake is not
        // proof that a byte was persisted, so a hub that flaps the socket and
        // completes empty sync steps can keep `lastSyncAt` fresh. That is
        // narrower than the socket-transition stamp this change removed from
        // `goOnline`, but it is the same shape, and it wants a separate
        // `noteHandshake()` the day the monitor grows one.
        mon.noteSyncActivity(slug);
        lastPromotionAt = stallNow();
        // A recovery that WORKED must not leave the floor ratcheted. Without
        // this, seven stall-and-recover cycles over a long session pin the
        // watchdog's floor at its 30-minute cap, so the next genuine stall waits
        // half an hour for help (verification review 2026-09-03, N3).
        forcedReconnects = 0;
        // A completed handshake is progress, exactly as it is on the first
        // connect — see the `renewalsSinceProgress` reset in `handleSynced`.
        renewalsSinceProgress = 0;
      } finally {
        repromoting.delete(slug);
      }
    };

    /** onceSynced() with the boot-settle ceiling — never hangs the summary on
     *  an auth-rejected provider (whose handshake never completes). */
    const settleWait = (p: Promise<void>): Promise<void> =>
      new Promise<void>((resolve) => {
        const h = authSetTimer(() => {
          settleTimers.delete(h);
          resolve();
        }, settleTimeoutMs);
        settleTimers.add(h);
        p.then(
          () => {
            settleTimers.delete(h);
            authClearTimer(h);
            resolve();
          },
          () => {
            settleTimers.delete(h);
            authClearTimer(h);
            resolve();
          }
        );
      });
    const bootWaits: Promise<void>[] = [];

    /**
     * Create + wire a provider for a canvas. Used by the boot loop and by the
     * permanent-rejection re-probe (which passes the EXISTING doc so the
     * agent/projection wiring — doc-scoped — survives the provider swap).
     */
    /**
     * Re-decide where a PULLED canvas goes, now that its document has synced.
     *
     * The listing (`GET /api/documents`) carries names and byte counts only —
     * the path lives INSIDE the document, so it cannot be known when the target
     * is first computed. This runs in the gap: after the handshake, before
     * anything is written. Nothing is on disk yet for a pulled canvas, so this
     * is a decision rather than a move.
     *
     * Local canvases never reach here. Their path comes from this disk, and
     * letting a remote value relocate them is the same hazard the hub refuses
     * with `pathIndex` — a peer moving another peer's work.
     */
    const relocatePulled = (
      canvas: CanvasDescriptor,
      canvasPaths: import('./agent.ts').CanvasSyncPaths,
      doc: Y.Doc
    ): boolean => {
      if (!pulledSlugs.has(canvas.slug)) return true;
      // A retired document (codec stampMovedTo) is not a canvas to place — its
      // content lives at the new path in a different document. Deciding a
      // location here would materialise a ghost on a machine pulling the
      // project down fresh; handleSynced releases it a moment later.
      if (movedToFromDoc(doc) !== null) return true;
      const resolved = resolvePulledTarget({
        slug: canvas.slug,
        path: canvasPathFromDoc(doc),
        designRoot: ctx.paths.designRoot,
        designRel: ctx.paths.designRel,
        canvasGroups: ctx.cfg.canvasGroups,
        join: path.join,
        resolve: path.resolve,
        sep: path.sep,
        realpath: realpathOfDeepestExisting,
        // The fresh-link relaxation is boot-only, per canvas — see
        // `strictPullSlugs` for why reading `pathOpts` alone is not enough.
        allowUndeclaredGroup: pathOpts.allowUndeclaredGroup && !strictPullSlugs.has(canvas.slug),
        onRefused: (reason) => pathOpts.onRefused(canvas.slug, reason),
      });
      // A DOCUMENT WHOSE PATH WAS REFUSED IS NOT A DOCUMENT TO WRITE SOMEWHERE
      // ELSE. Falling through here left the descriptor on the PROVISIONAL
      // target — `<group>/<rest-of-slug>.tsx` — and the reconcile below then
      // materialised the document there. Since `canvasSlugFromRel` is lossy
      // (`ui/Desk A.tsx` → `ui-desk_a`), that provisional name is a DIFFERENT
      // file from the one the document names, so the peer ended up holding the
      // canvas twice: `ui/Desk A.tsx` (correct) and `ui/desk_a.tsx` (a ghost).
      // Both then flatten to one slug, which is a collision — and a collision
      // takes the canvas OUT of sync on that machine entirely. The refusal has
      // to end the pull, not redirect it.
      if (!resolved) return false;

      // NEVER ONTO A FILE THAT ALREADY EXISTS.
      //
      // `relocatePulled`'s premise is that nothing is on disk for a pulled
      // canvas — but "pulled" only means "no LOCAL DESCRIPTOR", and `scanCanvases`
      // omits a canvas whose `.meta.json` says `syncable: false` (a security
      // opt-out) or whose `.tsx` the sandbox gate excluded. Such a canvas is
      // classified hub-only and pulled, and before this feature that was benign:
      // the body landed flat at the design root, inside no canvas group, loaded
      // by nothing. Honouring a remote path would land it on the real file and
      // let a hub overwrite exactly the canvas the user opted OUT of syncing.
      // The same admission the provisional target already passed, re-asked of
      // the destination the document actually chose.
      if (resolved.fromPath && !admitPullTarget(ctx, canvas.slug, resolved.bodyAbs)) return false;
      // The TOP-level component only — `canvasGroups` names a group, not every
      // folder inside it (`ui/2026/social/x.tsx` declares `ui`). A body that
      // landed at the design root has no group and teaches nothing.
      const [group, ...rest] = path
        .relative(ctx.paths.designRoot, resolved.bodyAbs)
        .split(path.sep);
      if (group && rest.length > 0) noteLearnedGroup(group);
      if (resolved.bodyAbs === canvas.html) return true;
      const next = descriptorFor(canvas.slug, resolved.bodyAbs);
      // Mutated in place: the descriptor and the paths object are already held
      // by the status surfaces and by the setup closure below, and handing them
      // a second object would leave half the runtime writing to the old path.
      Object.assign(canvas, next);
      canvasPaths.html = next.html;
      canvasPaths.meta = next.meta;
      canvasPaths.css = next.css;
      console.log(
        `[sync/${canvas.slug}] pulled into ${path.relative(ctx.paths.designRoot, next.html)}`
      );
      // RE-MARK NOW, not at the end of boot. The markers were computed from the
      // provisional descriptor set and the descriptors are mutated in place
      // here, so between this line and the end of boot the `_untrusted` index
      // would name a file that does not exist while the hub-pushed body it
      // exists to flag sits somewhere unlisted. Deferring the re-mark to the
      // boot-settle handler leaves exactly that window open — and that handler
      // is fire-and-forget, so a short-lived process never reaches it at all.
      // One small write per relocation is the right price for a marker that is
      // never wrong.
      markUntrusted();
      return true;
    };

    const connectCanvas = async (
      canvas: CanvasDescriptor,
      canvasPaths: import('./agent.ts').CanvasSyncPaths,
      document?: Y.Doc,
      setup?: (provider: SyncProvider) => void,
      /**
       * Does this connect belong to the BOOT set?
       *
       * Only a boot connect may enqueue a `bootWaits` entry. The boot summary
       * (`Promise.allSettled(bootWaits)`) is a one-shot report about the set the
       * runtime opened at start; a canvas adopted later must never be able to
       * join a list that has already been awaited — and, once discovery is
       * continuous, an unbounded stream of them would grow that array for the
       * life of the process. Defaults true so the re-probe path (which has
       * always pushed) is byte-for-byte unchanged.
       */
      boot = true
    ): Promise<SyncProvider> => {
      const provider = await providerFactory({
        url: linkedHub.url,
        token,
        documentName: docNameFor(canvas.slug),
        document,
      });
      providers.set(canvas.slug, provider);
      // Fix 5 (sync RCA 2026-08-10): stamp the canvas path BEFORE the
      // handshake, not only after reconcile. The path derives from this peer's
      // real local file, so it is known NOW — and the hub's FIRST
      // onDocumentStored must see it, or it memoises a flat fallback in its
      // pathIndex and a stub is born. Pulled canvases are the one exception:
      // their local path is a guess until the document arrives, and a guessed
      // stamp would be laundered into every other peer (handleSynced stamps
      // them after relocatePulled instead).
      if (!pulledSlugs.has(canvas.slug)) {
        stampFromLocalFile(provider.document, canvasPaths.html);
      }
      // First-connect setup (agent/projection creation + doc-scoped wiring)
      // MUST run before handleSynced — that function resolves the
      // agent/projection from the maps, and a test stub's onceSynced can
      // settle on the very next microtask.
      //
      // For a PULLED canvas it must run AFTER the handshake instead, because
      // the agent is constructed around a body path this peer cannot know until
      // the document arrives. Ordering, not skipping: the two still happen in
      // the same order relative to each other.
      const deferSetup = !!setup && pulledSlugs.has(canvas.slug);
      if (!deferSetup) setup?.(provider);
      else if (setup) owedSetups.set(canvas.slug, setup);

      // Task 8 — feed this provider's WS status into the offline monitor.
      // Per-provider, so a socket that never dropped never triggers a poll.
      let wasDisconnected = false;
      if (provider.onStatus) {
        noteDetach(
          statusDetaches,
          canvas.slug,
          provider.onStatus((s) => {
            mon.noteProviderStatus(canvas.slug, s);
            // COMING BACK IS THE MOMENT MOST LIKELY TO HAVE MISSED SOMETHING.
            //
            // A peer that was away for an hour has an hour of other people's
            // canvases to learn about, and making it sit out the poll interval
            // ON TOP of the outage is the one wait that is both longest and
            // least excusable. The signal is the socket returning, taken from
            // the provider rather than from the monitor's snapshot: a caller
            // that injects its own monitor (every test, and anything later)
            // would otherwise silently lose this.
            //
            // A reconnect storm is N providers reporting at once —
            // `pollRemoteSoon` coalesces them into one request.
            //
            // COOLED (F-12, post-1.0 burn-down): a reconnect is not purely
            // locally caused — a hub that churns the WebSocket drives this
            // trigger at whatever the provider's backoff allows, and the poke
            // cooldown never saw it. The cooled path already gives the shape
            // wanted here: a genuine one-off reconnect (nothing poked
            // recently) runs immediately; a churn folds into the scheduled
            // tick, costing latency and never correctness.
            if (s === 'connected' && wasDisconnected) {
              pollRemoteSoon({ cooled: true });
              // …and re-establish this DOCUMENT's truth, not just the project's.
              // The poll above asks the hub what canvases exist; it says nothing
              // about whether THIS one is synced again, and for a long time
              // nothing did. See `repromoteOnReconnect`.
              void repromoteOnReconnect(canvas.slug, provider);
            }
            wasDisconnected = s !== 'connected';
          })
        );
      } else {
        // No status events (test stub) — treat as connected so the monitor
        // doesn't sit in the boot 'connecting' state forever.
        mon.noteProviderStatus(canvas.slug, 'connected');
      }
      // DDR-102 — classify + aggregate hub auth rejections.
      if (provider.onAuthFailed) {
        noteDetach(
          statusDetaches,
          canvas.slug,
          provider.onAuthFailed(({ reason }) =>
            handleAuthFailure(canvas, canvasPaths, provider, reason)
          )
        );
      }
      // Task 5 — bridge the provider's hub-synced Awareness to the Room so
      // browser cursors relay cross-machine. No-op when the provider exposes
      // no awareness or no registry was passed (file-sync-only tests).
      if (opts.registry && provider.awareness) {
        noteDetach(
          awarenessDetaches,
          canvas.slug,
          opts.registry.attachHubAwareness(canvas.slug, provider.awareness)
        );
      }
      // Cold-start reconcile fires once the provider has hub state.
      const synced = provider.onceSynced().then(() => {
        if (deferSetup) {
          // Settled either way below — run, or the canvas is released.
          owedSetups.delete(canvas.slug);
          // Abandon before `setup?.()`, so no projection and no agent is ever
          // built for a canvas we are not going to place — nothing exists that
          // could flush the document onto the provisional path on the way out.
          if (!relocatePulled(canvas, canvasPaths, provider.document)) {
            pulledSlugs.delete(canvas.slug);
            if (canvas.html) refusedPulls.set(canvas.slug, canvas.html);
            // The document names a path we would not write to — which on a cell
            // usually means the file is already there. See `nudgeRescanFor`.
            nudgeRescanFor(canvas.slug);
            return releaseOne(canvas.slug).then(() => undefined);
          }
          setup?.(provider);
        }
        return runHandleSynced(canvas, canvasPaths, provider);
      });
      if (boot) bootWaits.push(settleWait(synced));
      return provider;
    };

    /**
     * Take ownership of ONE canvas: pin its shared doc if there is one, open a
     * provider, and build the disk handler behind it.
     *
     * Extracted from the boot loop so the SAME path can be reached after boot —
     * document discovery is continuous, not a snapshot taken at `start()`, and a
     * canvas that appears later must be adopted by exactly this code rather than
     * by a second, drifting copy of it. Every branch below is the boot
     * behaviour, unchanged; `boot` only decides whether the connect joins the
     * one-shot boot summary.
     */
    const attachCanvas = async (canvas: CanvasDescriptor, boot: boolean): Promise<void> => {
      try {
        // By reference — `relocatePulled` mutates this object in place.
        descriptors.set(canvas.slug, canvas);
        // Phase 9.2 (DDR-064) — when sharedDoc is on, the provider attaches to
        // the collab room's single Y.Doc (registry.getDoc) instead of a fresh
        // one, so browser edits flow straight into the doc that syncs to the
        // hub — no disk hop, no relay, no clobber. Pin the room so the
        // last-browser-leaves drop can't destroy the doc out from under the
        // provider. NB: cold-start seeding of a divergent local+hub doc is the
        // duplication trap (Risk 1) — made safe by Phase E (migrate-seed); the
        // flag stays OFF until then.
        const sharedYDoc = useSharedDoc ? opts.registry?.getDoc?.(canvas.slug) : undefined;
        if (useSharedDoc && sharedYDoc) {
          opts.registry?.pin?.(canvas.slug);
          pinnedSlugs.add(canvas.slug);
        }
        const canvasPaths = {
          html: canvas.html,
          comments: canvas.comments,
          annotations: canvas.annotations,
          meta: canvas.meta,
          css: canvas.css,
        };
        mon.noteDocState(canvas.slug, 'pending');
        await connectCanvas(
          canvas,
          canvasPaths,
          sharedYDoc,
          (provider) => {
            // Phase 9.2 (DDR-064) — the disk handler. Under sharedDoc it's a
            // loop-free projection (html/css/meta doc→file + all-types file→doc;
            // the collab room keeps comments/annotations doc→file, so no
            // double-write). Flag-OFF keeps the proven two-doc agent. Created
            // ONCE here (first connect) — a DDR-102 re-probe swaps only the
            // provider; everything below is doc-scoped and survives.
            let agent: CanvasSyncAgent | undefined;
            if (useSharedDoc && sharedYDoc) {
              const projection = createDocProjection({
                slug: canvas.slug,
                doc: provider.document,
                paths: canvasPaths,
                echoGuard,
                journal: journal ?? undefined,
                // Cell pairing only — see the DocProjectionOptions.onWrote doc.
                // The synthetic event is delayed by the same margin the container
                // write bridge uses, so a watcher that DOES fire wins the race and
                // the HMR broadcaster's per-file coalescing collapses the pair
                // into one `canvas-hmr`. The projector's own echo guard drops the
                // resulting file→doc read, so this cannot loop.
                ...(cellPairing ? { onWrote: announceWrite } : {}),
              });
              projection.start();
              projections.set(canvas.slug, projection);
            } else {
              const relBody = path.relative(ctx.paths.repoRoot, canvas.html);
              agent = createCanvasSyncAgent({
                slug: canvas.slug,
                doc: provider.document,
                paths: canvasPaths,
                echoGuard,
                adopt: adoptOnce,
                journal: journal ?? undefined,
                snapshot: async (content, reason) => {
                  try {
                    const snap = await history.writeSnapshot(relBody, content, reason);
                    return snap.ts;
                  } catch {
                    return null; // best-effort — resolution proceeds without refs
                  }
                },
                onConflict: (info) => store.addConflict(info),
              });
              agent.start();
              agents.set(canvas.slug, agent);
            }
            // The move protocol's receiving half — a `movedTo` stamp arriving
            // on this doc means another machine moved the canvas; park the
            // stale local copy and let go. (The write-inert guards in
            // agent/projection are the belt; this is the braces that also
            // cleans up.)
            watchForRetirement(canvas.slug, provider.document);

            // Count local edits (agent-origin doc updates) toward queuedOps while
            // the hub is unreachable — the banner's "N edits queued" figure. Under
            // sharedDoc there is no agent origin to key off (browser edits carry a
            // RoomConn origin); queued-edit counting in that mode is a known gap
            // (offline-banner accuracy only, not data) deferred past Phase C.
            if (agent) {
              const agentOrigin = agent.origin;
              const onLocalUpdate = (_u: Uint8Array, origin: unknown) => {
                if (origin === agentOrigin) mon.noteLocalEdit();
              };
              provider.document.on('update', onLocalUpdate);
              noteDetach(statusDetaches, canvas.slug, () =>
                provider.document.off('update', onLocalUpdate)
              );
            }

            // Relay hub-pushed comment/annotation changes straight into the live
            // room — IN-PROCESS + synchronous, so the room's in-memory doc is
            // updated BEFORE its 800ms persist timer can flush stale pre-sync state
            // back over the file (the disk-mediated re-seed in createCollab loses
            // that race under an actively-edited peer; this is the tight path that
            // actually closes the "comment reverts" clobber). Wholesale-replace via
            // syncRoomFrom* → no duplication. Skip agent-origin updates (our own
            // disk→doc apply — the file is authoritative there; a local design:edit
            // reaches the room via createCollab's fs hook instead).
            //
            // CRITICAL: observe the comment + annotation Y-types SEPARATELY, not the
            // whole-doc update. A whole-doc relay re-applies BOTH types on every
            // change, so a comment sync would re-push the (stale) annotation and
            // clobber an annotation the peer just drew but hasn't synced yet — and
            // vice versa. Per-type observers keep the two lanes independent.
            //
            // Phase 9.2 (DDR-064): under sharedDoc the provider IS attached to the
            // room's doc, so there is no second doc to relay into — the room already
            // has every change. Skipping the relay is what RETIRES the
            // wholesale-replace clobber path (the Phase 9.1 ceiling): with one doc,
            // CRDT merge handles concurrency, no last-writer-wins blob copy.
            const reg = opts.registry;
            if (!useSharedDoc && agent && reg?.syncRoomFromComments) {
              const agentOrigin = agent.origin;
              const slug = canvas.slug;
              const provComments = provider.document.getArray(Y_TYPES.comments);
              const provAnn = provider.document.getMap(Y_TYPES.annotations);
              const onComments = (_e: unknown, tx: { origin: unknown }) => {
                if (tx.origin === agentOrigin) return;
                reg.syncRoomFromComments?.(slug, provComments.toArray());
              };
              const onAnn = (_e: unknown, tx: { origin: unknown }) => {
                if (tx.origin === agentOrigin) return;
                const svg = provAnn.get('svg');
                if (typeof svg === 'string') reg.syncRoomFromAnnotations?.(slug, svg);
              };
              provComments.observe(onComments);
              provAnn.observe(onAnn);
              noteDetach(statusDetaches, canvas.slug, () => {
                provComments.unobserve(onComments);
                provAnn.unobserve(onAnn);
              });
            }
          },
          boot
        );
      } catch (err) {
        console.error(`[sync/${canvas.slug}] failed to start:`, err);
      }
    };

    attachOne = attachCanvas;

    for (const canvas of canvases) {
      await attachCanvas(canvas, true);
    }

    // Persist an initial status snapshot so `_sync.json` exists — and `maude
    // design status` + the browser banner report "agent running" — from the
    // moment serve boots. The ConnectionMonitor only emits on *transitions* and
    // starts in 'online', so on a clean fast localhost connect (provider
    // reaches 'connected' at/before subscribe → no transition fires) nothing
    // would otherwise be written, and status would read "idle / sync agent not
    // running" while sync is in fact healthy. This was the observed bug.
    store.update(mon.snapshot());

    // DDR-102 — honest boot output. The old single line printed
    // "83/83 canvas(es) syncing" BEFORE any handshake completed; per-canvas
    // auth rejections were invisible. Print a short linking line now and the
    // real summary once the handshakes settle (or the 15 s ceiling passes —
    // auth-rejected providers never resolve onceSynced, so the ceiling keeps
    // boot from hanging). Late canvases just update `_sync.json`.
    console.log(
      `[sync] linking to ${linkedHub.url} (${canvases.length} canvases)…${useSharedDoc ? ' (shared-doc)' : ''}${adoptOnce ? ' (adopt mode — pushing local up)' : ''}`
    );
    void Promise.allSettled(bootWaits).then(() => {
      if (stopped) return;
      const snap = mon.snapshot();
      const docs = snap.docs ?? { synced: 0, pending: 0, rejected: 0 };
      const parts = [`${docs.synced}/${canvases.length} synced`];
      if (docs.rejected > 0) {
        const sample = (snap.rejectedSlugs ?? []).slice(0, 3).join(', ');
        const classes = [...new Set(rejectedReasons.values())].join('/') || 'unknown';
        parts.push(
          `${docs.rejected} auth-rejected (${sample}${docs.rejected > 3 ? ', …' : ''} — ${classes})`
        );
      }
      if (docs.pending > 0) parts.push(`${docs.pending} pending`);
      console.log(
        `[sync] ${linkedHub.url}: ${parts.join(' · ')} · shared-doc:${useSharedDoc ? 'on' : 'off'}`
      );
      // What this run brought DOWN, recorded for `_sync.json` and the UI.
      //
      // This used to record `remoteDiff` under the name `remoteGap` — "what the
      // project has that this machine does not". By the time it ran, that was
      // false: the diff is taken BEFORE providers are built and recorded after
      // the pull, so it named exactly the canvases that had just arrived and
      // were sitting on disk. `pulled` is the same list under the name that is
      // true, and it is the fact the user is told to act on.
      notePulledAll();
      // Re-mark from the FINAL descriptors — `relocatePulled` mutates them in
      // place after each handshake, and the markers are the one consumer that
      // read them before that and would otherwise never read them again.
      markUntrusted();

      // DDR-217 (fix 6) — mirror local assets up AFTER the handshakes settle
      // (they carry the canvases; assets ride behind, never in front). Not
      // under pairing: a cell's assets are already on the cell. Fire-and-forget
      // — a miss is retried on the next boot for free. Journal-less hubs only:
      // on a Sync v2 hub the plane's first pass carries the same moment.
      if (!cellPairing && !stopped) {
        scheduleLegacyPush(linkedHub.url);
      }
    });

    // ─── DISCOVERY IS CONTINUOUS FROM HERE ────────────────────────────────
    //
    // Everything above is the BOOT set. `canvas-list-watch.ts` already notices
    // when the openable-canvas set changes on disk from ANY source (the API, the
    // ACP agent, a terminal `cp`, `git checkout`, or the hub's own workspace
    // agent writing a peer's new canvas into a cell's checkout) and emits
    // `canvas-list-update`. Nothing was listening on behalf of sync. This is
    // that listener.
    //
    // The payload is used ONLY as a nudge — never as data. See `discovery.ts`
    // for why the authoritative answer is a full rescan through the same
    // `scanCanvases` boot used.
    const rescan = createRescanScheduler({
      debounceMs: DISCOVERY_DEBOUNCE_MS,
      onError: (err) => console.error('[sync] canvas rescan failed:', err),
      run: async () => {
        if (stopped) return;
        // An explicit canvas list (test injection) means the caller owns
        // membership; rescanning would silently overrule them.
        if (opts.canvases) return;
        const fresh = await scanCanvases(ctx);
        const admitted = admitCanvases(fresh.canvases, useSharedDoc);
        const bySlug = new Map(admitted.map((c) => [c.slug, c]));
        // THE PULL PIN IS A RACE GUARD, NOT A PERMANENT EXEMPTION.
        //
        // A pulled canvas is kept out of `removed` because its body is written
        // AFTER the handshake, so a scan taken in that window is not evidence
        // it left the project. That window closes the moment the file exists —
        // and the pin was never released, so it did not close at all. The cost
        // is exactly the control this file calls "a security opt-out a hub must
        // not be able to flip": a pulled canvas whose `.meta.json` says
        // `syncable: false` was dropped by the scan, held by the pin, and kept
        // receiving hub writes for the life of the process. On a cell that is
        // days. Once the body is on disk the ordinary rules apply to it.
        for (const slug of [...pulledSlugs]) {
          const body = descriptors.get(slug)?.html;
          if (body && existsSync(body)) pulledSlugs.delete(slug);
        }
        const { added, removed } = diffCanvasSet(
          [...agents.keys(), ...projections.keys()],
          bySlug.keys(),
          pulledSlugs
        );
        if (added.length === 0 && removed.length === 0) return;
        if (removed.length > 0) {
          for (const slug of removed) await releaseOne(slug);
          console.log(`[sync] released ${removed.length} canvas(es): ${removed.join(', ')}`);
          // The marker set shrank. It describes what a peer can WRITE to, so a
          // stale entry over-lists — the safe direction, and still wrong: it is
          // the one mitigation standing between an untrusted pull and what the
          // agent reads.
          markUntrusted();
        }
        const incoming = added.map((slug) => bySlug.get(slug)).filter((c) => !!c);
        for (const canvas of incoming) {
          if (agents.has(canvas.slug) || projections.has(canvas.slug)) continue;
          if (providers.has(canvas.slug)) continue;
          await attachCanvas(canvas, false);
        }
        if (incoming.length > 0) {
          console.log(
            `[sync] adopted ${incoming.length} new canvas(es): ${incoming.map((c) => c.slug).join(', ')}`
          );
          // The set the DDR-054 §3 F3 markers describe just grew.
          markUntrusted();
        }
      },
    });
    discoveryRescan = rescan;
    discoveryUnsub = ctx.bus.on('canvas-list-update', () => rescan.schedule());

    // The OUTBOUND half of the delete lane. `api.ts` emits these two only from
    // its privileged create/delete routes, never from the filesystem watcher —
    // see the comment at the emit site for why that distinction is what makes
    // them safe to act on.
    const noteToHub = (slug: unknown, revive: boolean): void => {
      if (typeof slug !== 'string' || !slug) return;
      if (revive) tombstoned.delete(slug);
      else tombstoned.add(slug);
      void stateDocumentGone(linkedHub.url, token, docNameFor(slug), { revive }).then((ok) => {
        if (!ok) {
          console.warn(
            `[sync] could not tell the project that ${slug} was ${revive ? 're-created' : 'deleted'} — it stays ${revive ? 'buried' : 'in the project'} for other peers until this succeeds.`
          );
        }
      });
    };
    deletedUnsub = ctx.bus.on('canvas-deleted', (p: { slug?: unknown }) =>
      noteToHub(p?.slug, false)
    );
    createdUnsub = ctx.bus.on('canvas-created', (p: { slug?: unknown }) =>
      noteToHub(p?.slug, true)
    );

    /**
     * Apply the project's deletions to this machine.
     *
     * The runtime releases the canvas first and moves the bytes second: a live
     * agent flushing its Y.Doc onto a path we are about to rename is how a
     * "deleted" canvas comes back as a half-written file.
     *
     * `tombstoned` outlives the individual poll. The hub drops the `documents`
     * row on a best-effort basis, so a tombstone and a still-listed document can
     * coexist for a tick; without a local memory of what was deleted, that
     * window is enough for the pull lane to fetch the canvas straight back.
     */
    const applyTombstones = async (stones: readonly RemoteTombstone[]): Promise<void> => {
      if (stones.length === 0) return;
      // Remember EVERY deletion, including names this peer never had — that is
      // what makes the pull lane below refuse a document the project deleted but
      // whose row has not gone yet.
      for (const stone of stones) {
        const slug = slugFromDocName(stone.name);
        if (slug) tombstoned.add(slug);
      }
      const gone = tombstonedSlugs(stones, descriptors.keys());
      if (gone.length === 0) return;
      for (const slug of gone) {
        const canvas = descriptors.get(slug);
        await releaseOne(slug);
        if (canvas) {
          quarantineCanvas({
            designRoot: ctx.paths.designRoot,
            slug,
            lanes: {
              html: canvas.html,
              meta: canvas.meta,
              css: canvas.css,
              annotations: canvas.annotations,
            },
          });
        }
        descriptors.delete(slug);
      }
      console.log(`[sync] the project deleted ${gone.length} canvas(es): ${gone.join(', ')}`);
      // The set the DDR-054 §3 F3 markers describe just shrank.
      markUntrusted();
    };

    // ─── THE HUB HALF OF DISCOVERY ────────────────────────────────────────
    //
    // The rescan above sees this DISK. A document that exists only on the hub
    // is invisible to it — Yjs has no enumeration, so a peer learns of a
    // document only by being told its name. Boot asks once
    // (`GET /api/documents`), which is why a canvas created in the cloud after
    // this peer connected could never arrive: the desktop had already asked.
    //
    // So keep asking. This is deliberately a POLL and not a push: the listing
    // route is the ONLY document-enumeration surface every hub version exposes,
    // including self-hosted ones nobody is going to upgrade, and a fix that
    // required a new hub would leave exactly the installations that reported the
    // bug still broken. It is cheap (names + byte counts, one request), it
    // inherits `fetchRemoteDocs`'s never-fatal posture, and it rides the same
    // scope gate the sync itself does — a token that may not open a document is
    // not told the document exists.
    const pullRemoteOnce = async (): Promise<void> => {
      if (stopped) return;
      // Read `token` at call time: a silent renewal swaps it in place.
      const listing = await fetchRemoteListing(linkedHub.url, token);
      // null = unreachable, refused, or a hub without the route. Not an error
      // here any more than it is at boot — sync continues, we ask again later.
      if (listing === null) return;
      // ABSENCE BEFORE PRESENCE. A canvas the project deleted must leave before
      // the pull runs, or a slug that is tombstoned AND still listed (the window
      // between the tombstone and the row actually going) would be trashed and
      // immediately pulled back — the resurrection this lane exists to end,
      // reintroduced inside one tick.
      await applyTombstones(listing.tombstones);
      noteHubListing(listing.documents);
      const diff = diffRemoteDocs(
        [...descriptors.keys()].map((slug) => docNameFor(slug)),
        listing.documents
      );
      if (diff.hubOnly.length === 0) return;
      const targets = pullTargets(
        diff.hubOnly,
        ctx.paths.designRoot,
        path.join,
        path.resolve,
        path.sep,
        {
          ...pathOpts,
          // NEVER the fresh-link relaxation after boot. See `strictPullSlugs`.
          allowUndeclaredGroup: false,
          realpath: realpathOfDeepestExisting,
        }
      );
      const admitted = targets
        // A canvas the project deleted is not a canvas to fetch, even while the
        // hub is still listing it — see `tombstoned`.
        .filter((t) => !tombstoned.has(t.slug))
        .filter((t) => {
          // The reason is gone ⇒ so is the memo. See `refusedPulls`.
          const blocker = refusedPulls.get(t.slug);
          if (blocker === undefined) return true;
          if (existsSync(blocker)) return false;
          refusedPulls.delete(t.slug);
          return true;
        })
        .filter((t) => {
          if (admitPullTarget(ctx, t.slug, t.bodyAbs)) return true;
          refusedPulls.set(t.slug, t.bodyAbs);
          nudgeRescanFor(t.slug);
          return false;
        })
        .filter((t) => admitPulledBody(t.slug, t.bodyAbs));
      const fresh = admitted
        .filter((t) => !agents.has(t.slug) && !projections.has(t.slug) && !providers.has(t.slug))
        // A document this runtime has seen retired is not a canvas to fetch —
        // the hub keeps listing it, and re-pulling it every poll was the
        // connect/release churn described at `retiredDocs`.
        .filter((t) => !retiredDocs.has(t.slug));
      if (fresh.length === 0) return;
      // VOLUME IS A SECURITY PROPERTY HERE, NOT A PERFORMANCE ONE.
      //
      // Every accepted name becomes a real file in the design root, a provider,
      // a pinned Y.Doc, and (on a desktop) something autocommit puts into the
      // person's git history and `_untrusted/INDEX.json` offers to Claude. The
      // hub is untrusted to peers (DDR-054), and before continuous discovery
      // the damage was bounded by there being exactly ONE listing, at connect.
      // Asking every 20 s for the life of the process removes that bound: a
      // hostile hub can drip distinct names forever. So the pull lane gets the
      // ceiling the LOCAL lane has always had (`admitCanvases` → DDR-064 A6),
      // plus a per-poll cap so one answer cannot land thousands at once.
      const room = Math.max(0, maxPinnedRooms() - (agents.size + projections.size));
      const budget = Math.min(room, MAX_PULLS_PER_POLL);
      const accepted = fresh.slice(0, budget);
      if (accepted.length < fresh.length) {
        // Named loudly. A silent cap reads as "sync is broken" with no cause —
        // the same reason `admitCanvases` shouts about its own ceiling.
        warnOnce(
          `pull-cap:${room === 0 ? 'ceiling' : 'batch'}`,
          `[sync] the project offers ${fresh.length} more canvas(es) than this peer will take in one pass (${accepted.length} accepted; ceiling ${maxPinnedRooms()}, per-pass cap ${MAX_PULLS_PER_POLL}). Raise MAUDE_MAX_PINNED_ROOMS if this project is genuinely this large.`
        );
      }
      if (accepted.length === 0) return;
      for (const target of accepted) {
        pulledSlugs.add(target.slug);
        strictPullSlugs.add(target.slug);
        everPulled.add(target.slug);
        await attachCanvas(descriptorFor(target.slug, target.bodyAbs), false);
      }
      console.log(
        `[sync] pulled ${accepted.length} canvas(es) down from the project: ${accepted
          .map((t) => t.slug)
          .join(', ')}`
      );
      // Both controls describe the set, and the set just grew.
      notePulledAll();
      markUntrusted();
    };
    // Cumulative per boot — the Sync panel's one line. `synced` is the last
    // pass's converged count; `pulled`/`conflicts` accumulate.
    const fileTotals = { synced: 0, pulled: 0, conflicts: 0 };
    /** Previous progress, for `startedAt` continuity across ticks. */
    let lastSeedProgress: import('./seed-progress.ts').SeedProgress | null = null;
    /** When the last serve-log progress line went out, and what it said. */
    let lastProgressLogAt = 0;
    let lastProgressLine = '';
    /**
     * ONE LINE, PERIODICALLY, WHILE A SEED IS RUNNING.
     *
     * After boot the file plane printed NOTHING. Two runs of 14 and 6 minutes
     * that moved zero files were, from the terminal, indistinguishable from two
     * runs that were working — the only repeated line was a delete-breaker
     * warning that fired 47 times and buried everything else. The doc lane has
     * printed its one-shot summary since Phase 9; this is the file plane's.
     *
     * Rate-limited AND deduped: a converged project prints nothing at all, and
     * a stalled one prints the same line at most once every 15 s rather than
     * once per pass.
     */
    const reportSeedProgress = (
      p: import('./seed-progress.ts').SeedProgress,
      r: import('./file-plane.ts').FilePlaneResult
    ): void => {
      if (p.phase === 'converged') return;
      const blockedTotal = p.blocked.reduce((n, b) => n + b.count, 0);
      const bits = [`${p.delivered} / ${p.tracked} delivered`];
      if (p.remaining > 0) bits.push(`${p.remaining} waiting`);
      if (blockedTotal > 0) bits.push(`${blockedTotal} need attention`);
      if (r.backedOff) bits.push(`${r.backedOff} backing off`);
      let tail = '';
      if (r.rateLimited) {
        const secs = Math.max(1, Math.round((r.rateLimited.until - Date.now()) / 1000));
        const why =
          r.rateLimited.cause === 'unreachable'
            ? 'could not reach the workspace'
            : r.rateLimited.cause === 'quota'
              ? 'hourly upload allowance used up'
              : 'the workspace asked us to slow down';
        tail = ` · paused ${secs}s (${why})`;
      } else if (p.passCapped) {
        tail = ` · more next pass (${p.passCapped} ceiling)`;
      }
      const line = `[sync/files] ${bits.join(' · ')}${tail}`;
      const nowMs = Date.now();
      if (line === lastProgressLine && nowMs - lastProgressLogAt < SEED_PROGRESS_LOG_MS) return;
      if (nowMs - lastProgressLogAt < SEED_PROGRESS_LOG_MS) return;
      lastProgressLogAt = nowMs;
      lastProgressLine = line;
      console.log(line);
    };
    /** When the last pass ended, so a throughput sample has a window. */
    let lastPassEndedAt = 0;
    /**
     * Bytes that actually LANDED in the last pass, over the wall-clock since
     * the previous one.
     *
     * Bytes DELIVERED, never bytes sent. The 2026-09-03 misreading was exactly
     * this distinction: 616 MB left the machine across two runs and zero files
     * landed, so a rate computed from egress said "about ten minutes" when the
     * true answer was "never".
     */
    const throughputSample = (
      r: import('./file-plane.ts').FilePlaneResult
    ): { bytes: number; ms: number } | null => {
      const landed = r.pushed.length + r.pulled.length;
      const nowMs = Date.now();
      const ms = lastPassEndedAt > 0 ? nowMs - lastPassEndedAt : 0;
      lastPassEndedAt = nowMs;
      if (landed === 0 || ms <= 0) return null;
      const rows = fileLedger?.rows() ?? {};
      let bytes = 0;
      for (const rel of [...r.pushed, ...r.pulled]) {
        const size = rows[rel]?.size;
        if (Number.isFinite(size)) bytes += size as number;
      }
      return bytes > 0 ? { bytes, ms } : null;
    };
    const noteFilePull = (result: FilePullResult): void => {
      fileTotals.synced = result.skipped + result.pulled.length;
      fileTotals.pulled += result.pulled.length;
      fileTotals.conflicts += result.conflicts.length;
      statusStore?.updateFiles?.({ ...fileTotals });
    };
    /**
     * The v2 pass's counts, PLUS the doručenka.
     *
     * The counts alone are what the old lane reported, and they are exactly
     * what could not answer "where is file X" — the question three days of
     * dogfood kept asking. The per-path states ride beside them so the panel
     * can point at one file instead of a total, and the raw counters stay so a
     * lying panel is cross-checkable against them (DDR-214).
     */
    const noteFilePlane = (result: import('./file-plane.ts').FilePlaneResult): void => {
      fileTotals.synced = result.synced + result.pulled.length;
      fileTotals.pulled += result.pulled.length;
      fileTotals.conflicts += result.conflicts.length;
      filePushed += result.pushed.length;
      // EVERY HOLD REACHES THE PANEL. Without this the breakers were a
      // `console.warn` in a process log, and DDR-177's premise is that the
      // target user never opens a terminal — so a control whose only output
      // is a log line is a control nobody can act on.
      const held: NonNullable<import('./status.ts').FilePlaneStatus['held']> = [];
      if (result.deleteHeld) {
        held.push({
          kind: result.deleteHeld.direction === 'out' ? 'delete-out' : 'delete-in',
          count: result.deleteHeld.count,
          paths: result.deleteHeld.paths,
          detail:
            result.deleteHeld.direction === 'out'
              ? `${result.deleteHeld.count} files are gone from this machine — more than sync will remove from the project without you saying so. Nothing was deleted anywhere else. Set linkedHub.propagateDeletes: false to stop asking, or delete them again once you have confirmed this was deliberate.`
              : `The project wants to remove ${result.deleteHeld.count} files here — more than sync will delete without you saying so. Nothing was removed. They stay until you accept or the project puts them back.`,
        });
      }
      if (result.firstAnchorHeld) {
        held.push({
          kind: 'first-anchor',
          count: result.firstAnchorHeld.count,
          paths: result.firstAnchorHeld.paths,
          detail: `${result.firstAnchorHeld.count} files differ between this machine and the project, and neither copy has been reconciled here yet. Set linkedHub.resolveFirstAnchor to "keep-local" or "keep-cloud" to settle the whole set at once.`,
        });
      }
      if (result.reanchorHeld) {
        held.push({
          kind: 'reanchor',
          count: 0,
          paths: [],
          detail:
            'The project has asked to start over repeatedly, which is what a broken or hostile hub looks like. Nothing was overwritten. Sync retries by itself; if this persists, the hub needs looking at.',
        });
      }
      // THE DENOMINATOR, from the LEDGER — not from this pass.
      //
      // `fileTotals` below is derived from per-pass results, and a pass that
      // converges nothing is legitimately all zeros: that is why `_sync.json`
      // read `synced: 0, pushed: 0, pulled: 0` for twenty minutes while 2 961
      // ledger rows changed underneath it. The raw counters STAY beside this
      // (DDR-214: a panel derived from the same source it displays cannot be
      // cross-checked), but the progress a person reads comes from the source
      // that was correct the whole time.
      const progress = filePlane
        ? computeSeedProgress({
            rows: fileLedger?.rows() ?? {},
            now: Date.now(),
            pausedUntil: result.rateLimited?.until ?? null,
            pauseCause: result.rateLimited?.cause ?? null,
            ...(result.requestsExhausted
              ? { passCapped: 'requests' as const }
              : result.budgetExhausted
                ? { passCapped: 'bytes' as const }
                : {}),
            previous: lastSeedProgress,
            deliveredSince: throughputSample(result),
          })
        : null;
      if (progress) {
        lastSeedProgress = progress;
        reportSeedProgress(progress, result);
      }
      statusStore?.updateFiles?.({
        ...fileTotals,
        pushed: filePushed,
        ...(progress ? { progress } : {}),
        ...(filePlane
          ? {
              delivery: filePlane.doruceka(),
              ...(filePlane.dorucekaTotal() > MAX_DORUCEKA_ROWS
                ? { deliveryTruncated: filePlane.dorucekaTotal() - MAX_DORUCEKA_ROWS }
                : {}),
            }
          : {}),
        ...(held.length > 0 ? { held } : {}),
        // A FAILED TRANSFER IS NOT A SYNCED ONE (issue #109). These had no
        // field to land in, so a pass that refused every file still rendered
        // as `synced` and the only trace was the console lines below — on a
        // product whose premise is that nobody opens a terminal.
        ...(result.failed.length > 0 ? { failed: result.failed.length } : {}),
        ...(result.rateLimited
          ? {
              rateLimited: {
                until: result.rateLimited.until,
                waiting: result.rateLimited.waiting,
              },
            }
          : {}),
      });
      if (result.rateLimited) {
        // Once per boot (the store dedupes by id): a pause is not an error,
        // and the panel should say so in words rather than leave a person to
        // read a failure count and guess.
        statusStore?.notice?.({
          id: 'files-rate-limited',
          severity: 'info',
          text: `The workspace asked this machine to slow down, so file syncing is paused for a moment. ${
            result.rateLimited.waiting > 0
              ? `${result.rateLimited.waiting} file(s) are still on their way — nothing is lost, they arrive when the pause lifts.`
              : 'Nothing is lost; it resumes by itself.'
          }`,
        });
      }
      for (const f of result.failed) {
        console.warn(`[sync/files] ${f.rel}: ${f.reason}`);
      }
      // A pass that landed bytes widened the hub-written set, so the
      // untrusted-context markers have to describe it. Cheap and idempotent —
      // the writer rebuilds the whole set each call — but only when something
      // actually arrived, so a converged pass costs nothing.
      if (result.pulled.length > 0 || result.conflicts.length > 0) markUntrusted();
    };
    planeResultSink = noteFilePlane;
    /**
     * Plane B's downward pass — after the doc poll and the asset pull, so a
     * canvas that arrived this tick has its design system resolved in the
     * same tick. Flag-gated; a no-op when off.
     *
     * On a cell the hub shares the checkout, so every manifest entry is
     * hash-equal by construction and the pass skips itself — deliberately
     * NOT special-cased: the invariant covers it, and a special case would
     * be one more branch that can drift.
     */
    const pullFilesOnce = async (): Promise<void> => {
      if (stopped || !syncFilesOn) return;
      // Sync v2 (DDR-226) — when the hub carries a journal, the file plane is
      // the ONE lane: a cursor read, one decision per path, and both
      // directions from the same pass. The v1 manifest pull stays for
      // journal-less hubs, which the compat matrix keeps working through the
      // burn-down window.
      if (filePlane) {
        // Through the SAME door as the poke path, so the two can never overlap
        // (issue #109). `floor: false` — this caller is already bounded, and a
        // deferral would make an awaited pass silently not happen.
        await runPlanePass({ floor: false });
        return;
      }
      const result = await pullFiles({
        designRoot: ctx.paths.designRoot,
        hubUrl: linkedHub.url,
        token: () => token,
        canvasGroups: ctx.cfg.canvasGroups,
        allowCodeModules,
      });
      noteFilePull(result);
    };
    const pollRemote = (): void => {
      void pullRemoteOnce()
        .then(() => pullFilesOnce())
        .catch((err) => console.error('[sync] remote poll failed:', err));
    };
    remotePull = async () => {
      await pullRemoteOnce();
      await pullFilesOnce();
    };
    remotePollTimer = setInterval(pollRemote, REMOTE_POLL_MS);
    // `setInterval` keeps a Bun process alive; a poll is not a reason for the
    // dev server to refuse to exit.
    remotePollTimer.unref?.();

    // ── The stall watchdog (issue #118) ────────────────────────────────────
    //
    // WE CANNOT TRUST THE SOCKET TO NOTICE. `HocuspocusProviderWebsocket`
    // reports `connected` from the raw WS `open` event — before a token is
    // presented, before a byte comes back — and its own silence watchdog
    // (`checkConnection`) returns early while `lastMessageReceived === 0`,
    // which is precisely the state every fresh connection starts in. So a
    // socket that upgrades at the edge and then hears nothing (a cell woken
    // from `sleepAfter`, still restoring behind a DO that has accepted the
    // request) is PERMANENTLY "connected" with its watchdog switched off. No
    // close event, no retry, no reconnect — and therefore, before this, no
    // recovery short of the person pressing Resync.
    //
    // This is the liveness check the runtime should have owned all along: it
    // judges the link by whether any DOCUMENT has settled, which is the thing
    // the user actually wants, and it is the one signal a half-open socket
    // cannot fake. When nothing has settled for long enough, force the socket
    // down and back up; every provider re-authenticates on the new one and
    // `repromoteOnReconnect` collects the result.
    //
    // Deliberately narrow, because a false positive costs a full re-handshake
    // of every canvas:
    //   • `state === 'online'`  — offline already has its own recovery path.
    //   • `synced === 0 && pending > 0` — some progress means it is working,
    //     just slowly; this is only for the total stall.
    //   • `rejected === 0` — a refusal is the auth lane's: renew + re-probe for
    //     the permanent classes, the paced per-document retry for the
    //     transient ones. Cycling the socket would re-authenticate EVERY
    //     document to recover a few, and a volume refusal is exactly when
    //     that burst hurts most.
    //   • a floor between forced reconnects, so a hub that is simply down
    //     cannot be turned into a reconnect storm by its own silence.
    // The socket-cycling capability, resolved once.
    //
    // Was `ownedFactory`, which is null whenever a factory is INJECTED — so the
    // watchdog silently no-op'd in every test that could have exercised it, and
    // its jitter and backoff had no coverage at all (verification review
    // 2026-09-03). An injected factory that offers `reconnect()` is just as
    // usable. The `typeof` check is also the N4 guard: `sockets` is a
    // `Map<string, any>` and the provider is a caret dependency, so a 4.x minor
    // that renames this would otherwise degrade to a watchdog that can never
    // recover, saying nothing.
    const reconnectable: { reconnect(): void } | null =
      ownedFactory ??
      (typeof (providerFactory as Partial<DisposableProviderFactory>).reconnect === 'function'
        ? (providerFactory as DisposableProviderFactory)
        : null);
    const stallCheck = (): void => {
      if (stopped || !reconnectable) return;
      const snap = mon.snapshot();
      const docs = snap.docs;
      if (snap.state !== 'online' || !docs) return;
      if (docs.synced > 0 || docs.pending === 0 || docs.rejected > 0) return;
      const now = stallNow();
      if (now - lastPromotionAt < stallAfterMs + stallJitterMs) return;
      // The floor DOUBLES per forced reconnect (5 → 10 → 20 → capped at 30 min).
      // A hub that is simply down would otherwise buy a fresh N-document auth
      // burst from every peer every five minutes, forever.
      const floor = Math.min(STALL_RECONNECT_MAX_MS, stallMinMs * 2 ** forcedReconnects);
      if (lastForcedReconnectAt !== 0 && now - lastForcedReconnectAt < floor) return;
      lastForcedReconnectAt = now;
      forcedReconnects += 1;
      console.warn(
        `[sync] the hub socket says connected but not one of ${docs.pending} document(s) has ` +
          `synced in ${Math.round((now - lastPromotionAt) / 60_000)} minute(s) — forcing a reconnect.`
      );
      try {
        reconnectable.reconnect();
      } catch (err) {
        console.warn(`[sync] forced reconnect failed: ${(err as Error).message}`);
      }
    };
    stallTimer = setInterval(stallCheck, stallCheckMs);
    stallTimer.unref?.();

    // ── Sync v2 Increment 2 — the poke, desktop side (DDR-226 §4) ──────────
    //
    // CAPABILITY-GATED, and the gate is the compat matrix (§10, BINDING): a
    // journal-less self-hosted hub must see exactly today's client. So we ask
    // `/health` first and attach nothing unless it says `ledger`.
    //
    // THE POLL STAYS AT 20 s. The poke is additive this release — it makes the
    // common case fast, and the honesty counter below is what earns the right
    // to relax the poll later. Relaxing it now would trade a measured cadence
    // for an unmeasured one.
    //
    // Not started in a cell: there the CHILD holds this channel (ws.ts), and
    // its job is healing the UI rather than triggering pulls.
    if (!cellPairing && ctx.cfg.linkedHub?.fileEvents !== false) {
      fileEventsProbe = new AbortController();
      void hubCapabilities({ hubUrl: linkedHub.url, signal: fileEventsProbe.signal })
        .then((caps) => {
          if (stopped) return;
          if (!hasLedger(caps)) {
            // No journal on this hub ⇒ the legacy client carries the upward
            // lane, exactly as the pre-v2 desktop did (Open decision 4).
            decidePushLane(true);
            return;
          }
          // The hub carries a journal, so the file plane becomes the ONE lane
          // for this project. Built here rather than at start(): a client must
          // never send a journal request to a hub that would not understand
          // it (compat matrix §10 — BINDING).
          if (syncFilesOn && !filePlane) {
            fileLedger = createFileLedger({
              designRoot: ctx.paths.designRoot,
              hubUrl: linkedHub.url,
            });
            filePlane = createFilePlane({
              designRoot: ctx.paths.designRoot,
              hubUrl: linkedHub.url,
              token: () => token,
              // THE FILE PLANE CAN NOW ASK FOR A CREDENTIAL. It could not
              // before: renewal was reachable only from the doc lane's
              // WebSocket auth failure, so a token that expired mid-seed left
              // hundreds of files refused with nothing ever asking for a new
              // one (2026-09-03). Same single-flight entry point the doc lane
              // uses — never a second renewal path.
              onAuthFailure: () => {
                void renewCredentialNow();
              },
              // A DELIVERED FILE IS PROGRESS. `renewalsSinceProgress` counted
              // only doc handshakes, and a converged doc lane has none left to
              // land — so during a long seed the cap was reached and the
              // runtime stopped renewing while the file plane was still
              // working.
              onProgress: () => {
                renewalsSinceProgress = 0;
              },
              ledger: fileLedger,
              canvasGroups: ctx.cfg.canvasGroups,
              allowCodeModules,
              // Increment 6, DEFAULT ON: a hub-owned mirror that ignores
              // deletes contradicts the model it is selling — you delete a
              // file and it comes back. `linkedHub.propagateDeletes: false`
              // is the per-project opt-out; the breakers hold either way.
              propagateDeletes: linkedHub.propagateDeletes !== false,
              // The answer to a first-anchor hold. A config key rather than a
              // prompt because the hold outlives the pass that raised it, and
              // DDR-177's user has no terminal to answer in.
              ...(linkedHub.resolveFirstAnchor === 'keep-local' ||
              linkedHub.resolveFirstAnchor === 'keep-cloud'
                ? { resolveFirstAnchor: linkedHub.resolveFirstAnchor }
                : {}),
              // Same exposure class as `syncMeta.by`, and the same reasoning:
              // a conflict copy nobody can attribute is a conflict copy nobody
              // resolves.
              label: hostname().slice(0, 32),
            });
            console.log(
              '[sync/files] journal file plane active — one lane, both directions, per-file delivery state in the Sync panel.'
            );
            // Anything the local disk already differs on goes now, rather than
            // at the first 20 s tick.
            schedulePlanePass();
          }
          // A ledger hub with the plane ON owns pushes; with the file-plane
          // flag OFF the legacy client still carries the DDR-217 assets lane.
          decidePushLane(filePlane === null);
          fileEventsCtl = createCtlProvider({
            url: linkedHub.url,
            token,
            onPoke: () => {
              // Reuses `pollRemoteSoon` rather than calling the file lanes
              // directly, for two reasons: it already coalesces a burst into
              // one pass (a fresh link appends hundreds of rows), and it is
              // the exact path a reconnect takes — one behaviour to reason
              // about instead of two that can drift.
              //
              // The PULL itself is unchanged: missing-only, idempotent, and
              // re-validating everything it accepts. So a poke can at worst
              // cost one early pass, and the scheduled poll remains the
              // reconciler underneath it.
              pokesSeen += 1;
              pollRemoteSoon({ cooled: true });
            },
          });
          console.log(
            '[sync/ctl] file-event channel attached — cloud changes now arrive in seconds instead of on the 20 s tick.'
          );
        })
        .catch(() => {
          // No capability probe ⇒ no channel ⇒ exactly today's behaviour —
          // which, for pushes, is the legacy client.
          decidePushLane(true);
        });
    } else if (!cellPairing) {
      // The probe is opted out (`linkedHub.fileEvents: false`), so no verdict
      // will ever arrive — the legacy client is the lane, as it always was.
      decidePushLane(true);
    }

    // Arm the pre-expiry renewal from the credential that just booted. Placed
    // last — the timer needs nothing from boot, and boot needs nothing from it
    // (a credential that dies mid-boot lands in the invalid-token path, which
    // triggers renewal on its own).
    scheduleRenewal();
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    fileEventsProbe?.abort();
    fileEventsProbe = null;
    if (filePassTimer !== null) clearTimeout(filePassTimer);
    filePassTimer = null;
    planeResultSink = null;
    // Persist the ledger on the way out. Losing it is safe (a re-anchor, never
    // a loss) but paying for one on every restart would be needless noise.
    fileLedger?.stop();
    fileLedger = null;
    filePlane = null;
    // The control channel is a doorbell into this runtime; it goes with it.
    // Reported on the way out so the poke-miss question is answerable from a
    // session's log rather than from a hunch (DDR-226 §10).
    if (fileEventsCtl) {
      console.log(
        `[sync/ctl] file-event channel closing — ${pokesSeen} poke(s) received, ${fileEventsCtl.malformed()} refused.`
      );
      fileEventsCtl.stop();
      fileEventsCtl = null;
    }
    // Nothing may be adopted into a runtime that is going away.
    attachOne = null;
    discoveryUnsub?.();
    discoveryUnsub = null;
    deletedUnsub?.();
    deletedUnsub = null;
    createdUnsub?.();
    createdUnsub = null;
    discoveryRescan?.stop();
    discoveryRescan = null;
    if (remotePollTimer !== null) clearInterval(remotePollTimer);
    remotePollTimer = null;
    if (stallTimer !== null) clearInterval(stallTimer);
    stallTimer = null;
    if (remotePollSoonTimer !== null) clearTimeout(remotePollSoonTimer);
    remotePollSoonTimer = null;
    remotePull = null;
    // A push pass that outlives its runtime keeps uploading a project the
    // person just closed — and `restart()` (the Resync button) calls stop() on
    // every press, so without this each press would leave another one running.
    if (legacyPushTimer !== null) clearTimeout(legacyPushTimer);
    legacyPushTimer = null;
    legacyPushAgain = false;
    legacyPushCancel = true;
    legacyBootPush = null;
    // (No autocommit flush here — this runtime constructs no committer; the
    // hub's own `afterStoreDocument` engine owns the SIGTERM-ordered flush.
    // See the note at the top of createSyncRuntime. DDR-226 Increment 0.)
    for (const slug of [...awarenessDetaches.keys()]) runDetaches(awarenessDetaches, slug);
    awarenessDetaches.clear();
    // Phase 9.2 (DDR-064) — release shared-doc pins so the rooms can be dropped
    // / destroyed normally on shutdown. Empty unless sharedDoc was active.
    for (const slug of pinnedSlugs) {
      try {
        opts.registry?.unpin?.(slug);
      } catch {
        /* best-effort */
      }
    }
    pinnedSlugs.clear();
    for (const slug of [...statusDetaches.keys()]) runDetaches(statusDetaches, slug);
    statusDetaches.clear();
    monitor?.stop();
    journal?.stop(); // flushes the pending debounce
    journal = null;
    // DDR-102 — auth/settle timers.
    if (authWarnTimer !== null) {
      authClearTimer(authWarnTimer);
      authWarnTimer = null;
    }
    if (reprobeTimer !== null) {
      authClearTimer(reprobeTimer);
      reprobeTimer = null;
    }
    if (transientRetryTimer !== null) {
      authClearTimer(transientRetryTimer);
      transientRetryTimer = null;
    }
    if (renewTimer !== null) {
      authClearTimer(renewTimer);
      renewTimer = null;
    }
    for (const h of settleTimers) authClearTimer(h);
    settleTimers.clear();
    for (const h of announceTimers.values()) clearTimeout(h);
    announceTimers.clear();
    rejectedPermanent.clear();
    rejectedTransient.clear();
    transientStrikes.clear();
    transientSpent.length = 0;
    owedSetups.clear();
    busUnsub?.();
    busUnsub = null;
    fsReader?.stop();
    fsReader = null;
    for (const agent of agents.values()) {
      try {
        await agent.flush();
        agent.stop();
      } catch {
        /* best-effort */
      }
    }
    agents.clear();
    // Phase 9.2 (DDR-064) — final doc→file flush + stop the projectors BEFORE
    // tearing down providers (so the converged doc lands on disk). The shared
    // doc itself is owned by the collab room and destroyed by registry teardown,
    // not here.
    for (const proj of projections.values()) {
      try {
        await proj.flush();
        proj.stop();
      } catch {
        /* best-effort */
      }
    }
    projections.clear();
    for (const provider of providers.values()) {
      try {
        provider.destroy();
      } catch {
        /* best-effort */
      }
    }
    providers.clear();
    // DDR-102 — destroy the shared WebSocket(s) AFTER the providers detached.
    ownedFactory?.dispose();
  }

  // One chain for every membership change, so an adopt cannot interleave with a
  // release of the same slug (rename arrives as remove+add) or with `stop()`
  // tearing the maps down underneath it. This is the runtime's own ordering and
  // is separate from the SUPERVISOR's chain, which serializes whole start/stop
  // cycles — an adopt is not a cycle and must not make `busy()` true.
  let membership: Promise<unknown> = Promise.resolve();
  function serializeMembership<T>(work: () => Promise<T>): Promise<T> {
    const next = membership.then(work, work);
    membership = next.catch(() => {});
    return next;
  }

  return {
    start,
    stop,
    adopt: (incoming) =>
      serializeMembership(async () => {
        if (stopped || !attachOne) return 0;
        let attached = 0;
        for (const canvas of incoming) {
          // Already ours — adopting twice would open a second provider on the
          // same document and give this peer two votes in every merge.
          if (agents.has(canvas.slug) || projections.has(canvas.slug)) continue;
          if (providers.has(canvas.slug)) continue;
          await attachOne(canvas, false);
          attached += 1;
        }
        return attached;
      }),
    release: (slugs) =>
      serializeMembership(async () => {
        let released = 0;
        for (const slug of slugs) if (await releaseOne(slug)) released += 1;
        return released;
      }),
    rescanNow: () => discoveryRescan?.flush() ?? Promise.resolve(),
    pullRemoteNow: () => remotePull?.() ?? Promise.resolve(),
    // Under sharedDoc the per-canvas handler is a projection, not an agent;
    // count both so size() reflects the synced-canvas count in either mode.
    size: () => agents.size + projections.size,
    agentFor: (slug) => agents.get(slug),
    status: () => statusStore?.get() ?? null,
    cancelAssetSweep: () => {
      if (!legacyPushRunning) return false;
      legacyPushCancel = true;
      return true;
    },
    retireForMove: (fromSlug, toRel) => serializeMembership(() => retireForMove(fromSlug, toRel)),
  };
}

/* ------------------------------------------------ DDR-064 pre-cutover gates */

/**
 * Upper bound on shared-doc canvases held live in one process — DDR-064
 * pre-cutover A6.
 *
 * Every shared-doc canvas is a PINNED room: a `Y.Doc` plus its history, kept in
 * memory for as long as a provider is attached, deliberately immune to the
 * last-browser-leaves drop. That immunity is what makes the ceiling necessary —
 * nothing else will ever reclaim them.
 *
 * Set well above any real project (the largest in-house one is 83 canvases) so
 * that in practice this is a runaway guard, not a product limit. Raise it with
 * `MAUDE_MAX_PINNED_ROOMS` if a real project ever meets it — and if one does,
 * that is a signal worth reading rather than a number worth bumping.
 */
/** Coalesce a burst of asset writes (dragging six images on) into one sweep. */
const ASSET_SWEEP_DEBOUNCE_MS = 1500;

export const DEFAULT_MAX_PINNED_ROOMS = 500;

function maxPinnedRooms(): number {
  const raw = Number.parseInt(process.env.MAUDE_MAX_PINNED_ROOMS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_PINNED_ROOMS;
}

/**
 * Filter the discovered set down to what may safely be synced.
 *
 * **A4 — slug collisions.** `slugFor` flattens `/` to `-`, so `ui/a/b.tsx` and
 * `ui/a-b.tsx` produce the same slug. Two files on one document is not a
 * degraded experience, it is silent cross-contamination: each would receive the
 * other's body as a remote change and write it over itself, forever. Neither
 * file is more correct than the other, so BOTH are excluded rather than one
 * being picked — refusing to sync two canvases is recoverable by renaming a
 * file; overwriting one with the other is not.
 *
 * **A6 — pinned-room ceiling.** Under shared-doc, admit at most
 * `maxPinnedRooms()`. Named loudly, because the ones past the ceiling stop
 * syncing and silence there would read as "sync is broken" with no cause.
 *
 * Exported for the pre-cutover tests.
 */
export function admitCanvases(
  canvases: readonly CanvasDescriptor[],
  sharedDoc: boolean
): CanvasDescriptor[] {
  const bySlug = new Map<string, CanvasDescriptor[]>();
  for (const c of canvases) {
    const group = bySlug.get(c.slug);
    if (group) group.push(c);
    else bySlug.set(c.slug, [c]);
  }

  const admitted: CanvasDescriptor[] = [];
  const collisions: string[] = [];
  for (const [slug, group] of bySlug) {
    if (group.length > 1) {
      collisions.push(`${slug} ← ${group.map((c) => c.html).join(' , ')}`);
      continue;
    }
    admitted.push(group[0] as CanvasDescriptor);
  }
  if (collisions.length > 0) {
    console.error(
      `[sync] ${collisions.length} slug collision(s) — these canvases are NOT syncing, because two files sharing one document would overwrite each other (DDR-064 A4). Rename one of each pair:\n${collisions
        .map((c) => `  ${c}`)
        .join('\n')}`
    );
  }

  if (!sharedDoc) return admitted;
  const cap = maxPinnedRooms();
  if (admitted.length <= cap) return admitted;
  const dropped = admitted.length - cap;
  console.error(
    `[sync] ${admitted.length} syncable canvases exceeds the shared-doc pinned-room ceiling of ${cap} (DDR-064 A6) — ${dropped} will NOT sync. Raise MAUDE_MAX_PINNED_ROOMS if this project is genuinely this large.`
  );
  return admitted.slice(0, cap);
}

/**
 * DDR-064 pre-cutover A7 — say, once, that a shared document is now crossing
 * the network.
 *
 * Under shared-doc the browser's live editing buffer IS the object that syncs to
 * the hub. That is a real change in what leaves this machine and when, and the
 * checklist asks for it to be stated rather than inferred from a release note.
 *
 * A cell is the exception, and deliberately so: the operator turned pairing on
 * per project, the hub is the cell's own loopback, and nothing leaves the
 * container. Consent was given by configuration, and repeating it at every
 * canvas boot would train an operator to skip the line that matters.
 */
let sharedDocNoticeShown = false;
function sharedDocNoticeText(url: string): string {
  return `shared-doc is ON for ${url} — your live editing buffer for each canvas is now the same object that syncs to the hub, not a copy reconciled through disk (DDR-064). Link only hubs you operate or trust.`;
}
function noticeSharedDocOnce(url: string, cellPairing: boolean): void {
  if (cellPairing || sharedDocNoticeShown) return;
  sharedDocNoticeShown = true;
  console.warn(`[sync] ${sharedDocNoticeText(url)}`);
}

/* ---------------------------------------------------------------- discovery */

/**
 * Scan `<designRoot>/{ui,system}/` for `.html` canvas files and return one
 * CanvasDescriptor per. Mirrors the existing api.ts file-tree scan but
 * specialised for the sync runtime (we only need the three paths per canvas,
 * not the full metadata).
 *
 * DDR-054 §2b / DDR-060 — `.tsx` canvases are deliberately EXCLUDED from sync.
 * The dev-server transpiles `.tsx` to JavaScript and serves it as
 * `application/javascript` in iframe same-origin; a hostile hub pushing
 * arbitrary TypeScript source would result in RCE (the audit's CRITICAL F1).
 * Since Phase 3.6 made `.tsx` the ONLY canvas format, this means real projects
 * discover zero syncable canvases — surfaced loudly by `surfaceNoSyncable`
 * (9.1-D) rather than silently. The per-canvas opt-in (`.meta.json.syncable:
 * true`) + CSP/sandbox gate that make `.tsx` syncable land in 9.1-A/B.
 */
export async function discoverCanvases(ctx: Context): Promise<CanvasDescriptor[]> {
  return (await scanCanvases(ctx)).canvases;
}

/** Result of a canvas-group scan: syncable descriptors + a tally of the .tsx
 *  canvases that exist but are NOT yet syncable (DDR-060 — they need the
 *  per-canvas opt-in + sandbox gate). The tsx count feeds 9.1-D's loud
 *  zero-syncable surface so the message can say *why* nothing syncs. */
export interface CanvasScan {
  canvases: CanvasDescriptor[];
  tsxCount: number;
}

export async function scanCanvases(ctx: Context): Promise<CanvasScan> {
  const out: CanvasDescriptor[] = [];
  const counter = { tsx: 0 };
  // T3 (9.1-B) — LOAD-BEARING coupling (the plan's "two locks flip together"
  // invariant): a `.tsx` body is admitted to sync ONLY when the cross-origin
  // CSP/sandbox containment is active (`ctx.canvasOrigin` is set — Lock 2). The
  // sandbox is now ON BY DEFAULT, but a user can opt out with
  // MAUDE_CANVAS_ORIGIN_SPLIT=0; if they do, `canvasOrigin` is undefined and NO
  // `.tsx` syncs — the per-canvas opt-in is inert without the sandbox, and
  // decoupling them would re-open the CRITICAL F1 RCE (DDR-060, DDR-054 §F1).
  const splitActive = !!ctx.canvasOrigin;
  // DDR-079 (supersedes DDR-072) — TSX sync defaults ON for a linked project.
  // Absence of the flag = ON: a freshly-linked peer sees the project's TSX
  // without a hidden per-project opt-in (the recurring "I linked but my teammate
  // sees nothing" footgun). `linkedHub.syncTsx: false` is the explicit
  // project-wide opt-out; a per-canvas `.meta.json "syncable": false` still wins
  // for one canvas (see resolveSyncable). The Lock-2 sandbox coupling
  // (`splitActive`) is UNTOUCHED — a `.tsx` still syncs ONLY when the cross-origin
  // containment is active; decoupling them would re-open the F1 RCE (DDR-060).
  const projectSyncTsx = ctx.cfg.linkedHub?.syncTsx !== false;
  for (const group of ctx.cfg.canvasGroups) {
    const groupAbs = path.join(ctx.paths.designRoot, group.path);
    if (!existsSync(groupAbs)) continue;
    await walk(
      groupAbs,
      ctx.paths.designRoot,
      ctx.paths.commentsDir,
      ctx.paths.designRel,
      out,
      counter,
      splitActive,
      projectSyncTsx
    );
  }
  return { canvases: out, tsxCount: counter.tsx };
}

/**
 * T3 (9.1-B) + DDR-079 (was DDR-072) — resolve whether a `.tsx` body is syncable.
 *
 * Tri-state precedence:
 *  1. The sibling `<name>.meta.json` `"syncable"` boolean ALWAYS wins when
 *     present (`true` opts in, `false` opts out) — set by a human editing the
 *     sidecar; deliberately NOT in the untrusted `/_api/canvas-meta` PATCH
 *     whitelist (api.ts), so a hostile canvas/hub cannot flip its own body into
 *     or out of the sync set.
 *  2. Otherwise fall back to `projectSyncTsx` — which now defaults to TRUE
 *     (DDR-079); `linkedHub.syncTsx: false` is the explicit project-wide opt-out.
 *
 * Missing sidecar / parse error → no explicit verdict → the project default (on).
 */
function resolveSyncable(bodyAbs: string, projectSyncTsx: boolean): boolean {
  const metaAbs = bodyAbs.replace(/\.(tsx|html)$/i, '.meta.json');
  try {
    const obj = JSON.parse(readFileSync(metaAbs, 'utf8'));
    if (obj && typeof obj === 'object' && typeof obj.syncable === 'boolean') {
      return obj.syncable; // per-canvas verdict wins (true OR explicit false)
    }
  } catch {
    /* missing / unparseable sidecar → defer to the project default below */
  }
  return projectSyncTsx;
}

async function walk(
  dirAbs: string,
  designRoot: string,
  commentsDir: string,
  designRel: string,
  acc: CanvasDescriptor[],
  counter: { tsx: number },
  splitActive: boolean,
  projectSyncTsx: boolean
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      // Skip plugin runtime dirs.
      if (entry.name.startsWith('_')) continue;
      await walk(
        abs,
        designRoot,
        commentsDir,
        designRel,
        acc,
        counter,
        splitActive,
        projectSyncTsx
      );
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    // T3 (9.1-B) + DDR-072 — a `.tsx` syncs ONLY when the sandbox is active AND
    // it resolves to syncable (per-canvas sidecar verdict, else the project-level
    // `linkedHub.syncTsx` default — see resolveSyncable + the splitActive
    // coupling above). Otherwise tally it for 9.1-D's loud zero-syncable surface
    // so the message can explain *why* it isn't syncing.
    if (ext === '.tsx') {
      if (!(splitActive && resolveSyncable(abs, projectSyncTsx))) {
        counter.tsx += 1;
        continue;
      }
      // falls through to descriptor push (body = the .tsx file)
    } else if (ext !== '.html') {
      continue;
    }
    const slug = slugFor(abs, designRoot, designRel);
    acc.push({
      // `html` is the canvas BODY path — `.html` or an opted-in `.tsx`. The
      // sync codec treats the body as opaque Y.Text, so the field name is
      // historical; both formats round-trip identically (DDR-060).
      slug,
      html: abs,
      comments: path.join(commentsDir, `${slug}.json`),
      annotations: path.join(designRoot, `${slug}.annotations.svg`),
      // The `.meta.json` sidecar sits next to the body: `Foo.tsx` → `Foo.meta.json`.
      meta: abs.replace(/\.(tsx|html)$/i, '.meta.json'),
      // The `.css` sibling: `Foo.tsx` → `Foo.css` (absent for inline-CSS canvases).
      css: abs.replace(/\.(tsx|html)$/i, '.css'),
    });
  }
}

/**
 * Blank the persisted status for a process that has just started.
 *
 * Deliberately NOT a rehydration. Presentation state (which hub, how many
 * canvases) is knowable up front; a per-document verdict is not — it is the
 * outcome of a handshake this process has yet to make. Carrying one over is how
 * a stale `auth-rejected` outlives the credential rotation that fixed it.
 *
 * Best-effort, like every other write to this file: a status that cannot be
 * written must not stop a project from syncing.
 */
function resetPersistedStatus(ctx: Context, url: string): void {
  try {
    atomicWrite(
      path.join(ctx.paths.designRoot, '_sync.json'),
      `${JSON.stringify(
        {
          url,
          canvases: 0,
          conflicts: [],
          state: 'connecting',
          queuedOps: 0,
          lastSyncAt: null,
          offlineSince: null,
          flash: null,
          updatedAt: Date.now(),
          docs: { synced: 0, pending: 0, rejected: 0 },
        },
        null,
        2
      )}\n`
    );
  } catch {
    /* best-effort — see the doc comment */
  }
}

/**
 * May a pulled canvas be materialised at this path?
 *
 * Asked of the PROVISIONAL target and again of whatever the document's own
 * `syncMeta.path` resolves to, because the two can be the same place: the
 * fallback is derived from the slug and the slug from the path, so
 * `system-colors_and_type` targets `system/colors_and_type.tsx` with or without
 * a path on the wire. A guard on the carried path alone is a guard on the
 * loudest half of the problem.
 *
 * Two refusals, both about what ALREADY occupies the location — which is
 * precisely what rule 7 does not speak to. Rule 7 ties a path to its own
 * DOCUMENT; it has nothing to say about the file already sitting there.
 */
function admitPullTarget(ctx: Context, slug: string, bodyAbs: string): boolean {
  const rel = path.relative(ctx.paths.designRoot, bodyAbs);
  // 1. A file that is already on this disk. "Hub-only" means "no local
  //    DESCRIPTOR", not "no local file": `scanCanvases` omits a canvas whose
  //    `.meta.json` says `syncable: false` — a security opt-out a hub must not
  //    be able to flip — and one the TSX sandbox gate excluded. Such a canvas is
  //    classified hub-only and pulled, and its target is the real file. Note
  //    `existsSync` settles the case-insensitive collision for free: `ui/card.tsx`
  //    IS `ui/Card.tsx` on macOS, and that is exactly how the fallback reaches a
  //    file the project meant to keep out of the sync set.
  if (existsSync(bodyAbs)) {
    console.warn(
      `[sync/${slug}] not pulling — ${rel} already exists on this machine and is not in ` +
        "this project's sync set (a `syncable: false` sidecar, or the TSX sandbox gate). " +
        'The local file is kept.'
    );
    return false;
  }
  // 2. A file that means something other than "a canvas". The `.css` and
  //    `.meta.json` siblings are derived from the body path and `system` is a
  //    DEFAULT canvas group, so `system-colors_and_type` writes its css lane
  //    straight over `tokensCssRel` — the stylesheet the dev server serves.
  if (collidesWithServedPaths(ctx, bodyAbs)) {
    console.warn(`[sync/${slug}] not pulling — ${rel} would overwrite a served project file.`);
    return false;
  }
  return true;
}

/**
 * True when the design root holds nothing but runtime state.
 *
 * The emptiness question the fresh-link relaxation actually needs to ask. It is
 * NOT "did the scan find canvases": the scan walks declared groups only and
 * applies the syncable + sandbox gates, so it returns zero for several projects
 * that are anything but bare.
 */
function designRootIsBare(ctx: Context): boolean {
  try {
    return readdirSync(ctx.paths.designRoot).every(
      (name) => name.startsWith('_') || name === '.git'
    );
  } catch {
    // No design root at all is as bare as it gets.
    return true;
  }
}

/**
 * True when a pulled body's sidecars would land on a file that means something
 * other than "a canvas".
 *
 * `.css` and `.meta.json` are derived from the body path, and `system` is a
 * DEFAULT canvas group — so a hub-chosen path inside it can put an attacker's
 * css lane exactly where `tokensCssRel` is served from. Rule 7 ties a path to
 * its own DOCUMENT; it says nothing about what already occupies that location.
 */
function collidesWithServedPaths(ctx: Context, bodyAbs: string): boolean {
  const served = new Set<string>();
  const add = (rel: unknown): void => {
    if (typeof rel === 'string' && rel) served.add(path.resolve(ctx.paths.designRoot, rel));
  };
  add(ctx.cfg.tokensCssRel);
  for (const ds of ctx.cfg.designSystems ?? []) add(ds?.tokensCssRel);
  add('config.json');
  const stem = bodyAbs.replace(/\.tsx$/i, '');
  return [bodyAbs, `${stem}.css`, `${stem}.meta.json`].some((p) => served.has(path.resolve(p)));
}

/**
 * `realpathSync`, but for a path that does not exist yet.
 *
 * `realpathSync` throws ENOENT on the file we are about to create, so walk up to
 * the deepest ancestor that DOES exist, resolve that, and re-attach the tail.
 * Any symlink already on the path is therefore followed, which is the whole
 * point: `path.resolve` is lexical, and `mkdirSync(recursive: true)` traverses a
 * symlinked directory without complaint.
 */
function realpathOfDeepestExisting(p: string): string {
  let cur = p;
  for (;;) {
    try {
      return path.join(realpathSync(cur), path.relative(cur, p));
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      cur = parent;
    }
  }
}

/** `<designRoot>/config.json` — the project's own declaration of itself. */
function designConfigPath(ctx: Context): string {
  return path.join(ctx.paths.designRoot, 'config.json');
}

/**
 * Give a freshly-linked, previously-empty folder a config of its own.
 *
 * A project pulled into a bare directory has no `config.json` (it is not part
 * of the sync lane), so it runs on the DEFAULT canvas groups — and a project
 * whose author calls their group `screens` would be listed by nothing. This
 * writes what the pull actually brought down, so the next boot needs no
 * relaxation and the tree lists the project it just received.
 *
 * ADDITIVE AND ONE-SHOT. It refuses outright if a config already exists — a
 * user's own declaration is never edited by the sync runtime, and the caller's
 * `freshLink` gate means this cannot run on a project that had canvases.
 * Best-effort: a read-only design root costs the project its tidiness, never
 * its sync.
 */
function seedProjectConfig(
  ctx: Context,
  learnedGroups: ReadonlySet<string>,
  owned: boolean
): boolean {
  const file = designConfigPath(ctx);
  if (existsSync(file) && !owned) return false;
  const declared = (ctx.cfg.canvasGroups ?? []).map((g) => g.path);
  const groups = [...declared, ...[...learnedGroups].filter((g) => !declared.includes(g))];
  try {
    atomicWrite(
      file,
      `${JSON.stringify(
        {
          name: ctx.cfg.name,
          designRoot: ctx.paths.designRel,
          canvasGroups: groups.map((p) => ({ label: p, path: p })),
        },
        null,
        2
      )}\n`
    );
    console.log(`[sync] wrote ${ctx.paths.designRel}/config.json (${groups.join(', ')}).`);
    return true;
  } catch (err) {
    console.warn(`[sync] could not write ${ctx.paths.designRel}/config.json: ${String(err)}`);
    return false;
  }
}

/**
 * The shape written to `<designRoot>/_sync.json` (and broadcast on the
 * 'sync:status' bus) when the project is linked but has zero syncable
 * canvases. DDR-060 / 9.1-D. Distinct from the live SyncStatusPayload — the
 * `notSyncable` discriminator lets the CLI status line and the browser banner
 * render the "linked but nothing syncs" state instead of a healthy one.
 */
export interface NoSyncablePayload {
  linked: true;
  notSyncable: true;
  url: string;
  reason: string;
  /** Count of .tsx canvases present (syncable once 9.1-A/B land). */
  tsxCount: number;
  canvases: 0;
  updatedAt: number;
}

/** Build the zero-syncable payload (exported for the CLI + tests). */
export function buildNoSyncablePayload(
  url: string,
  tsxCount: number,
  designRoot: string
): NoSyncablePayload {
  const reason =
    tsxCount > 0
      ? `${tsxCount} TSX canvas(es) found but none are syncable. TSX sync is ON by default (DDR-079), so this means it was opted OUT — either project-wide (.design/config.json linkedHub.syncTsx: false) or per canvas (.meta.json "syncable": false) — OR the cross-origin sandbox is off (MAUDE_CANVAS_ORIGIN_SPLIT=0 disables it, and TSX sync with it — DDR-060). Remove the opt-out / re-enable the sandbox to sync.`
      : `no canvases found under ${designRoot}.`;
  return {
    linked: true,
    notSyncable: true,
    url,
    reason,
    tsxCount,
    canvases: 0,
    updatedAt: Date.now(),
  };
}

/**
 * 9.1-D — replace the silent zero-canvas early-return with a loud surface:
 * a warn line, a `_sync.json` the CLI + browser read, and a bus broadcast.
 * Best-effort on the write/broadcast — a failure there must never throw into
 * the boot path (solo mode for unlinked projects is unaffected either way).
 */
function surfaceNoSyncable(ctx: Context, url: string, tsxCount: number): void {
  const payload = buildNoSyncablePayload(url, tsxCount, ctx.paths.designRoot);
  console.warn(`[sync] linked to ${url} but 0 syncable canvases — ${payload.reason}`);
  try {
    const file = path.join(ctx.paths.designRoot, '_sync.json');
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    /* best-effort — never throw into boot */
  }
  try {
    ctx.bus.emit('sync:status', payload);
  } catch {
    /* best-effort */
  }
}

function slugFor(absPath: string, designRoot: string, designRel: string): string {
  let rel = path.relative(designRoot, absPath);
  rel = rel.replace(/\\/g, '/');
  // Mirror api.fileSlug(): collapse path separators to '-', strip extension.
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  if (rel.startsWith(prefix)) rel = rel.slice(prefix.length);
  return rel
    .replace(/\//g, '-')
    .replace(/\s+/g, '_')
    .replace(/\.(tsx|html)$/i, '')
    .replace(/^\.+/, '')
    .toLowerCase();
}

/* ---------------------------------------------------------------- default provider */

/**
 * A ProviderFactory whose shared resources (the per-hub WebSocket) the runtime
 * can dispose on stop(). The call signature stays the plain ProviderFactory
 * shape so injected test stubs are unaffected.
 */
export interface DisposableProviderFactory extends ProviderFactory {
  /** Destroy the shared HocuspocusProviderWebsocket(s). Call AFTER provider
   *  destroys — a provider detach sends a Close message over the socket. */
  dispose(): void;
  /**
   * Take every shared socket down and bring it back up (issue #118).
   *
   * The escape hatch for a socket that reports `connected` and carries nothing
   * — see the stall watchdog in `start()`. Providers are NOT destroyed and are
   * NOT re-created: they stay attached across the cycle and re-authenticate on
   * the new socket, exactly as they do after any ordinary drop, so this costs a
   * handshake and never a re-attach.
   */
  reconnect(): void;
}

/**
 * The production provider factory — DDR-102: ONE shared
 * `HocuspocusProviderWebsocket` per hub URL, with every canvas's
 * `HocuspocusProvider` attached to it, instead of one socket per canvas.
 * An 83-canvas project used to open 83 WebSockets at boot — the auth burst
 * tripped the hub's per-token rate limit (100/min) the moment two peers
 * booted together, and the per-socket retry storm then pinned the bucket
 * forever (the 2026-06-11 incident). NB: the hub still authenticates once per
 * DOCUMENT (each provider sends its own Auth message on socket open), so the
 * hub-side valid-token bucket resize is the companion fix — the multiplexing
 * kills the SOCKET burst and collapses the retry storm to one reconnect loop.
 *
 * Module + socket creation are lazy so tests / unlinked projects don't pay
 * the load cost. `loadModule` is injectable for unit tests.
 */
export function createDefaultProviderFactory(
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import of optional dep.
  loadModule?: () => Promise<any>
): DisposableProviderFactory {
  // biome-ignore lint/suspicious/noExplicitAny: provider runtime typed at call site.
  let mod: any = null;
  // wsUrl → shared HocuspocusProviderWebsocket (one per hub URL; in practice a
  // runtime only ever talks to one hub, but the map keeps the contract exact).
  // biome-ignore lint/suspicious/noExplicitAny: provider runtime typed at call site.
  const sockets = new Map<string, any>();

  const factory = async (args: {
    url: string;
    token: string;
    documentName: string;
    document?: Y.Doc;
  }): Promise<SyncProvider> => {
    if (!mod) {
      try {
        mod = await (loadModule ? loadModule() : import('@hocuspocus/provider'));
      } catch (err) {
        throw new Error(
          `@hocuspocus/provider unavailable — install it under apps/studio/. (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }
    // Hocuspocus accepts ws:// or wss://; the linked URL is http(s)://, so swap
    // the scheme. The provider also accepts http(s):// and upgrades internally
    // in newer versions, but ws:// is explicit + portable.
    const wsUrl = toWsUrl(args.url);
    let socket = sockets.get(wsUrl);
    if (!socket) {
      // CONFIGURED, not defaulted (issue #118). The socket used to be built
      // from the URL alone, which inherited `timeout: 0` — no per-attempt
      // deadline — and that is the property that let one parked connection
      // attempt silence the whole link for as long as the process lived. The
      // other two are pinned rather than inherited so a provider upgrade cannot
      // move them without someone noticing here.
      // NO `timeout`. It is tempting — the default is 0, meaning a connection
      // attempt has no deadline at all — and it is a TRAP: `@lifeomic/attempt`
      // handles a timeout by calling `reject` DIRECTLY, bypassing the `onError`
      // path that is the only thing which schedules another attempt. So the
      // deadline does not retry the attempt, it ENDS THE CHAIN — and since
      // every one of hocuspocus's `connect()` call sites floats the promise and
      // this process registers no `unhandledRejection` handler, a hub merely
      // being slow would take the dev server down (security review 2026-09-03,
      // F2). A hub slower than the deadline is the NORMAL case this whole fix
      // is about: a sleeping cell's `/health` measured 14 s, and a container
      // cold-boot is routinely worse.
      //
      // Liveness is the runtime's job instead — see the stall watchdog in
      // `start()`, which is a layer we control and can make safe.
      socket = new mod.HocuspocusProviderWebsocket({
        url: wsUrl,
        messageReconnectTimeout: 30_000,
        maxDelay: 30_000,
      });
      sockets.set(wsUrl, socket);
    }
    // Phase 9.2 (DDR-064) — attach to the shared room doc when the runtime
    // injected one; otherwise own a fresh doc (the legacy two-doc path).
    const document = args.document ?? new Y.Doc();
    // DDR-102 — rejections fan out to the runtime's aggregator (ONE debounced
    // warn with a reason-correct hint) instead of one 5-line warn per document
    // per retry. The reason is sanitized here, classified by the runtime.
    const authFailedCbs = new Set<(info: { reason: string }) => void>();
    // biome-ignore lint/suspicious/noExplicitAny: provider runtime is typed at the call site.
    const provider: any = new mod.HocuspocusProvider({
      websocketProvider: socket,
      name: args.documentName,
      token: args.token,
      document,
      onAuthenticationFailed: (data: { reason?: string }) => {
        const reason = (data?.reason ?? 'permission-denied').replace(/[\r\n]/g, ' ').slice(0, 200);
        for (const cb of authFailedCbs) cb({ reason });
      },
    });
    // With an injected websocketProvider the provider does NOT auto-attach
    // (manageSocket=false in @hocuspocus/provider 4.x) — attach explicitly.
    provider.attach();

    // `provider.synced` IS NOT TRUSTWORTHY ACROSS A STATUS TRANSITION.
    //
    // A provider learns a socket died only from the `close` EVENT, and the
    // library itself does not always raise one: `checkConnection()`'s
    // force-close branch (`closeTries > 2`) CALLS `this.onClose({code:4408})`
    // directly, and `cleanupWebSocket()` has already detached the raw handlers
    // by then — so no `close` is emitted, no provider's `boundOnClose` runs,
    // and every provider keeps `isSynced === true` through the teardown. That
    // branch is reached by exactly the failure this whole change is about: a
    // link that WAS healthy and then went quiet for 30 s.
    //
    // It gets worse quietly. `set synced` is a no-op when the value is
    // unchanged, so a provider left stale-true does not emit `synced` on its
    // NEXT genuine handshake either — the flag is wrong in both directions.
    //
    // Before this change the staleness was inert (nothing re-promoted on it).
    // `repromoteOnReconnect` makes it authoritative: `onceSynced()`
    // short-circuits on that field, so it would resolve instantly and report a
    // handshake that never happened, for every document, then disarm the stall
    // watchdog through its own `docs.synced > 0` guard (verification review
    // 2026-09-03, NEW-1 — the same defect as N1, arriving through the library
    // instead of through us).
    //
    // So: model the reset the missing event would have done. Assigning `false`
    // only flips the flag (the setter emits on `true` alone), which is exactly
    // the `synced` half of `HocuspocusProvider.onClose()` and none of its
    // awareness side effects — those belong to the real close event, and still
    // run when there is one.
    const resetSyncedOnDrop = (evt: { status?: string }): void => {
      if (evt?.status && evt.status !== 'connected' && provider.synced) provider.synced = false;
    };
    socket.on('status', resetSyncedOnDrop);

    return {
      document,
      // HocuspocusProvider creates a hub-synced Awareness by default; expose it
      // so the runtime can bridge it to the collab Room (Task 5).
      awareness: provider.awareness as Awareness | undefined,
      onStatus(cb: (status: ProviderStatus) => void): () => void {
        // The shared socket emits 'status' on every WS transition and every
        // ATTACHED provider re-emits it (forwardStatus), so per-provider
        // subscription keeps working under multiplexing.
        const handler = (evt: { status?: string }) => {
          const s = evt?.status;
          if (s === 'connected' || s === 'connecting' || s === 'disconnected') cb(s);
        };
        provider.on('status', handler);
        // Seed the subscriber with the CURRENT status immediately. On
        // localhost the WS can reach 'connected'/synced before this listener
        // attaches — waiting for the *next* transition would leave the
        // connection monitor un-seeded and `_sync.json` never written. The
        // socket (not the provider) owns the live status under multiplexing.
        const cur = socket.status;
        if (cur === 'connected' || cur === 'connecting' || cur === 'disconnected') cb(cur);
        return () => provider.off('status', handler);
      },
      onAuthFailed(cb: (info: { reason: string }) => void): () => void {
        authFailedCbs.add(cb);
        return () => authFailedCbs.delete(cb);
      },
      onceSynced(signal?: AbortSignal): Promise<void> {
        return new Promise<void>((resolve) => {
          if (provider.synced) {
            resolve();
            return;
          }
          const handler = () => {
            cleanup();
            resolve();
          };
          // Detach on abort as well as on success — see the interface doc. The
          // promise is deliberately NOT rejected: callers race it against their
          // own ceiling and read a separate flag, so a rejection here would be
          // an unhandled one at every site that stops waiting.
          const cleanup = () => {
            provider.off('synced', handler);
            signal?.removeEventListener('abort', cleanup);
          };
          if (signal?.aborted) {
            resolve();
            return;
          }
          provider.on('synced', handler);
          signal?.addEventListener('abort', cleanup, { once: true });
        });
      },
      destroy() {
        socket.off('status', resetSyncedOnDrop);
        // Detaches from the shared socket (sends a per-document Close); the
        // socket itself is destroyed by dispose() after all providers.
        provider.destroy();
      },
    };
  };

  return Object.assign(factory, {
    dispose(): void {
      for (const socket of sockets.values()) {
        try {
          socket.destroy();
        } catch {
          /* best-effort */
        }
      }
      sockets.clear();
    },
    reconnect(): void {
      for (const socket of sockets.values()) {
        try {
          // NOT `disconnect()` + `connect()` — that pair WEDGES THE SOCKET SHUT,
          // deterministically, in exactly the state this is called from
          // (security review 2026-09-03, F1). `disconnect()` sets
          // `shouldConnect = false` and closes the WS without touching
          // `status`; the close event is asynchronous, so the immediately
          // following `connect()` hits its own first guard —
          // `if (this.status === WebSocketStatus.Connected) return;` — which
          // sits ABOVE the line that would restore `shouldConnect`. When the
          // close finally lands, `onClose`'s re-arm reads
          // `!cancelWebsocketRetry && shouldConnect` → false, and nothing else
          // re-arms it. The recovery action would have turned a stall that
          // survives a restart into a link that never reconnects again.
          //
          // So take the path the library is actually built around: close the
          // raw socket and let its OWN close-driven reconnect run — byte for
          // byte what happens when the hub drops us, which is the best-tested
          // path in the provider. `shouldConnect` stays true, and
          // `cancelWebsocketRetry` is already clear (only `onOpen` clears it,
          // and a socket reporting `connected` has been through `onOpen`).
          //
          // `connect()` is the fallback for the no-live-socket case ONLY, where
          // status is not `Connected` and it therefore does not early-return.
          //
          // EMIT THE EVENT — do not call the handler.
          //
          // `HocuspocusProviderWebsocket.onClose()` looks like the right entry
          // point (`checkConnection()` calls it with this exact 4408 frame) and
          // calling it directly is WRONG in a way that is invisible until you
          // read who else listens. That method emits `status` and `disconnect`
          // — never `close`. Each attached PROVIDER learns about a drop through
          // `websocketProvider.on('close', boundOnClose)`, and
          // `HocuspocusProvider.onClose()` is the only thing that resets
          // `isAuthenticated` and `synced`. Skip the event and every provider
          // keeps `synced === true` across the reconnect; `set synced` is a
          // no-op when unchanged, so the NEXT real handshake emits nothing
          // either, and `onceSynced()` — which short-circuits on that field —
          // resolves instantly for all 85 documents against a socket that has
          // completed no handshake at all. The recovery would have manufactured
          // `docs.synced = 85` out of nothing, and then disarmed the watchdog
          // permanently through its own `docs.synced > 0` guard (verification
          // review 2026-09-03, N1).
          //
          // Emitting is what the raw socket's own handler does
          // (`onCloseHandler = (payload) => this.emit('close', {event: payload})`),
          // and the constructor registers `this.on('close', this.onClose)` —
          // so this runs every provider's reset AND the socket's own cleanup +
          // re-arm. THAT is "byte for byte what happens when the hub drops us";
          // the handler call only resembled it.
          socket.emit('close', { event: { code: 4408, reason: 'forced' } });
        } catch (err) {
          console.warn(`[sync] socket reconnect failed: ${(err as Error).message}`);
        }
      }
    },
  });
}

/** Convert an http(s):// URL to ws(s):// for the HocuspocusProvider. */
export function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`;
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`;
  return httpUrl;
}

/**
 * Rewrite .design/config.json to drop `linkedHub.adopt`. Called once after
 * all canvases finish their first adopt-reconcile. DDR-054 §2i (defender I5).
 * Best-effort — failure logs and leaves the disk flag in place; the only
 * downstream cost is the user being prompted to re-run adopt.
 */
function clearAdoptFlag(ctx: Context): void {
  const cfgPath = path.join(ctx.paths.repoRoot, '.design', 'config.json');
  if (!existsSync(cfgPath)) return;
  try {
    const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
      linkedHub?: { adopt?: boolean; lastAdoptedAt?: number };
    };
    if (!raw?.linkedHub?.adopt) return;
    raw.linkedHub.adopt = undefined;
    raw.linkedHub.lastAdoptedAt = Date.now();
    // Strip undefined values via stringify/parse so the JSON output is clean.
    const cleaned = JSON.parse(JSON.stringify(raw));
    writeFileSync(cfgPath, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
    console.log('[sync] adopt complete — cleared linkedHub.adopt from .design/config.json');
  } catch (err) {
    console.warn(
      '[sync] failed to clear linkedHub.adopt:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Refuse non-loopback ws:// / http:// (cleartext token exposure to MITM).
 * DDR-054 §2e (attacker F9). Returns null on accept, error string on refuse.
 *
 * Loopback hosts (localhost, 127.0.0.1, [::1], ::1) keep ws:// allowed for
 * local hub development. Non-http(s)/ws(s) schemes are refused outright.
 */
export function checkUrlScheme(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `invalid hub URL: ${url}`;
  }
  const proto = u.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:' && proto !== 'ws:' && proto !== 'wss:') {
    return `unsupported hub URL scheme: ${proto} (expected https:// or wss://)`;
  }
  const isPlaintext = proto === 'http:' || proto === 'ws:';
  if (!isPlaintext) return null;
  if (!isLoopbackHost(u.hostname)) {
    return `plaintext URL (${proto}//) is only allowed for loopback hosts. Use wss:// for ${u.hostname.toLowerCase()} or change the host to localhost.`;
  }
  return null;
}

/**
 * DDR-072 — true when the hub URL points at a loopback host (localhost,
 * 127.0.0.1, ::1). Used to suppress the `syncTsx` boot banner for local dev
 * hubs (no remote exfil concern). Unparseable URL → treated as non-loopback
 * (fail loud / show the banner). Mirrors checkUrlScheme's loopback host set —
 * literally, both call `isLoopbackHost` (`sync/loopback.ts`).
 */
export function isLoopbackHubUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
