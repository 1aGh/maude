// The file plane — Sync v2 Increment 3 (DDR-226 §§3–7).
//
// ONE lane, both directions, one decision function. This module is what
// replaces the sprawl: the asset sweep, the fast-lane push, the asset pull and
// the manifest file-pull all answered a slice of "what should happen to this
// file", each with its own trigger, its own idea of the answer, and its own
// echo suppression. Here there is a single question asked per path —
// `decideFile(local, remote, ancestor)` — and a single place that carries out
// whatever it says.
//
// ── The pass ────────────────────────────────────────────────────────────────
//
//   1. Read the hub's journal from our cursor (or from 0 when re-anchoring).
//      Its compaction IS the remote manifest; a delta read is the steady state.
//   2. Scan local disk through the classifier, hashing only files whose
//      (size, mtime) no longer match the ledger's stat cache.
//   3. For every path in the union, ask `decideFile`.
//   4. Do what it said, in an order that survives being killed: bytes land
//      before ancestors move, conflicts park before they adopt.
//
// ── Why the cursor is not just an optimization ──────────────────────────────
//
// A cursor means the hub can answer "what changed since 412" instead of
// "here is everything", which is what lets a poke be cheap enough to act on
// immediately. But it also carries the safety property: a cursor the hub
// cannot honour comes back as `reanchor`, and we then re-read from 0 rather
// than assuming nothing changed. "No cursor" must never render as "no news".
//
// ── Deletion (Increment 6) ──────────────────────────────────────────────────
//
// A deletion is a JOURNAL ROW, never an absence. Absence is not authority
// (DDR-076): a path missing from a page means "no news", and a file missing
// from a tree means "gone from THIS disk" — neither is a statement about what
// the project holds. So a delete travels as a tombstone with a CAS
// precondition, exactly like a write, and an edit that raced it wins.
//
// Nothing is ever unlinked. Losers go to `_trash/` on both ends, which is
// runtime state (DDR-115) and therefore never replicates — one person's delete
// must not become everyone's copy of the deleted file. On the hub the
// object-storage blob is content-addressed, so a delete leaves it
// unreferenced rather than destroyed.
//
// And the breakers are the load-bearing part, because the dangerous shapes are
// ordinary: a branch switch, a `git clean`, a half-finished restore. See
// `DELETE_BREAKER_MAX`.

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  type Dirent,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { conflictCopyName, decideFile, type FileState } from './decide-file.ts';
import type { DeliveryState, FileLedger } from './file-ledger.ts';
import {
  type CanvasGroupLike,
  classifyProjectFile,
  type FileClass,
  isFilePlaneClass,
} from './file-membership.ts';
import { fetchJournal, type JournalEntry } from './journal-client.ts';
import { createPullBudget } from './pull-budget.ts';
import { failureReason, isBackpressure, retryAfterMs } from './retry-after.ts';
import { classifyTransportError } from './transport-error.ts';

/** How long to wait for one file's bytes. Generous — these run to videos. */
const GET_TIMEOUT_MS = 120_000;
const PUT_TIMEOUT_MS = 120_000;

/** Refuse an implausible body rather than streaming it to disk. This is the
 *  PULL/receive cap and is deliberately generous — it bounds what we will
 *  accept, not what a hub will. Plan T18: the project-file ceiling the hub
 *  uses too (`apps/hub/src/file-limits.mjs`), so a real video moves. */
export const MAX_FILE_BYTES = (() => {
  const raw = Number(process.env.MAUDE_MAX_PROJECT_FILE_BYTES);
  return Number.isFinite(raw) && raw >= 95 * 1024 * 1024
    ? Math.min(raw, 8192 * 1024 * 1024)
    : 2048 * 1024 * 1024;
})();

/** T18 — above this a download streams to disk (and resumes) instead of
 *  being held in memory. */
export const STREAM_DOWNLOAD_ABOVE_BYTES = 32 * 1024 * 1024;

/** sha256 of a file, read in 1 MiB chunks (T18 — a video is never held whole). */
export function sha256File(abs: string): string {
  const hash = createHash('sha256');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(abs, 'r');
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * What the door accepts, until it tells us otherwise.
 *
 * Mirrors `MAX_FILE_BYTES` in `apps/hub/src/file-door.mjs`, and the two used to
 * disagree by a factor of five: the client queued anything under 512 MB, the
 * door refused anything over 95 MB, and nothing anywhere reconciled the two.
 * The result was a 164.9 MB image and a 465.8 MB video re-uploaded on every
 * pass of every boot, forever, each one burning a request slot and landing an
 * anonymous `stuck`. This constant is only the FALLBACK — a hub that answers
 * `/api/file-limits` is authoritative, because a hardcoded mirror of someone
 * else's constant is the same trap one level down.
 */
export const DEFAULT_HUB_MAX_FILE_BYTES = 95 * 1024 * 1024;

/**
 * The narrowest ceiling we will believe from a hub, and the longest quota pause
 * we will accept from one.
 *
 * DDR-054 makes the hub untrusted to peers, and `/api/file-limits` hands it two
 * levers over this client that nothing else does: a `maxFileBytes` of 1 would
 * push a whole project into the terminal `refused` state — files reported as
 * permanently unsendable, which is a lie a peer should not be able to tell
 * about your disk — and a far-future `quotaResetsAt` would park the lane for as
 * long as it liked. Both are clamped to a range where an honest hub is
 * unaffected and a hostile one buys a bounded delay at worst.
 */
export const MIN_TRUSTED_MAX_FILE_BYTES = 1024 * 1024;

/** How long a `/api/file-limits` answer is believed before we ask again. Short
 *  relative to the hub's hourly quota window, so a reading can never strand a
 *  client for the rest of its life. */
export const HUB_LIMITS_TTL_MS = 10 * 60_000;
export const MAX_TRUSTED_QUOTA_PAUSE_MS = 2 * 60 * 60_000;

/** How many files one pass will move. The remainder is the next pass's work. */
const MAX_FILES_PER_PASS = 200;

/**
 * How many HTTP REQUESTS one pass will issue. Issue #109.
 *
 * `MAX_FILES_PER_PASS` counts what MOVED, and `applyOne` returns false when a
 * transfer fails — so under any refusal the counter stood still and the loop
 * ran to the end of `work`, one request per path, with no ceiling at all. The
 * cap stopped bounding the request rate at exactly the moment it was the only
 * thing that could. Against a hub that meters per minute, that is not a client
 * hitting a limit, it is a client manufacturing one.
 *
 * So the hard ceiling counts REQUESTS, which is the quantity the hub actually
 * meters, and it is charged whether the answer was bytes or a refusal.
 */
export const MAX_REQUESTS_PER_PASS = 200;

/**
 * How many consecutive `reanchor` answers before we stop obeying them.
 *
 * A re-anchor is a full compaction read plus `pruneRemotes`, and it sets
 * `degraded`, under which every differing path parks a copy of the hub's
 * bytes. A hub that answers `reanchor` to everything is therefore a
 * disk-filling primitive rather than a peer with a rotated epoch.
 */
export const REANCHOR_STORM_LIMIT = 5;

/**
 * F-11 (post-1.0 burn-down) — how long a re-anchor hold lasts before ONE more
 * attempt is allowed. The counter used to be reset only by a pass the hub did
 * NOT answer `reanchor` to — but the held branch returns before that line, so
 * once over the limit every later pass was held too and the plane was bricked
 * until a desktop restart (its comment claimed otherwise). A hub that
 * legitimately rotates its epoch six times (a cell restarted repeatedly, a
 * restore drill) must converge eventually; a hostile hub that answers
 * `reanchor` forever must still be capped. Time gives both: held for the
 * window, then exactly one retry — a storm costs one full read per window,
 * a real rotation recovers on the first quiet retry.
 */
export const REANCHOR_HOLD_RECOVERY_MS = 15 * 20_000; // 15 poll ticks (index.ts REMOTE_POLL_MS)

/**
 * How many FIRST-ANCHOR conflicts one pass will resolve before it stops and asks.
 *
 * The flip-day shape, and it is structural rather than hypothetical: a project
 * that has been linked with the file plane off has a hub `system/**` that is
 * stale by construction, so the first pass with it on finds dozens of paths
 * where both sides have content and this machine has never reconciled either —
 * every one a `diverged` with no ancestor. Resolving them silently means a
 * person opens their editor to a tree of `*.maude-conflict-*` files they did
 * not ask for and cannot easily undo in bulk.
 *
 * Under the limit it is ordinary conflict handling. Over it, the pass holds
 * everything, reports the count, and waits for a bulk keep-local / keep-cloud
 * answer — with the Open-decision-2 fallback of proceeding conservatively
 * (park, propagate nothing) if nobody answers, so a headless desktop cannot
 * stall forever.
 */
export const FIRST_ANCHOR_STORM_LIMIT = 10;

/**
 * Deletion breakers — DDR-226 §8, and the only protection now that
 * `propagateDeletes` ships ON rather than after a soak release.
 *
 * The shapes these exist for are ordinary, not exotic. A branch switch removes
 * half the design folder; a `git clean` removes all of it; a botched restore on
 * one machine looks exactly like a deliberate purge to every other. In each
 * case the mechanism is working perfectly and the outcome is a disaster, so
 * the rule is a rate, not a permission: past `MAX` files or `MAX_FRACTION` of
 * what this machine tracks, in one pass, nothing is removed and the pass says
 * what it was about to do.
 *
 * Both directions, because both are lossy. Outbound turns a local accident
 * into everyone's; inbound turns a hostile or broken hub into a local wipe.
 */
export const DELETE_BREAKER_MAX = 10;
export const DELETE_BREAKER_MAX_FRACTION = 0.25;

/**
 * The window the budget is measured over, and the ceiling inside it.
 *
 * The first version of this breaker counted ONE PASS and reset completely on
 * the next, which makes it a rate limit rather than a budget — and a rate
 * limit is the wrong control here, because the thing it guards against is
 * cumulative. Ten per pass, six passes a minute once a hub can poke, and a
 * two-hundred-file project is gone in three minutes with the limit never once
 * tripping. Two per pass was under every arm of it unconditionally, at every
 * project size, forever.
 *
 * So the count is cumulative, windowed, and PERSISTED on the ledger —
 * otherwise "restart the app" is the bypass. A window rather than a lifetime
 * total because a real project does delete a lot of files eventually, just
 * not forty of them in an hour without somebody meaning it.
 */
export const DELETE_BUDGET_WINDOW_MS = 60 * 60 * 1000;
export const DELETE_BUDGET_PER_WINDOW = 25;

/**
 * The proportion arm needs a small floor — in a project tracking one file,
 * deleting that file is 100% — but the floor used to be the hole: at 3, two
 * deletions per pass were under every arm forever. It is safe at 2 now only
 * because the BUDGET arm catches the patient drain independently. Neither
 * number is load-bearing alone; the three together are.
 */
export const DELETE_BREAKER_MIN_FOR_FRACTION = 2;

/**
 * Consecutive unreachable transfers before the whole lane holds.
 *
 * Small, because the signal is unambiguous: five files in a row that could not
 * open a socket is not five file problems. Larger would just mean more wasted
 * requests before reaching the same conclusion.
 */
export const UNREACHABLE_STREAK_LIMIT = 5;

/** How long the lane waits after deciding the peer is unreachable. Shorter than
 *  a metering pause — nobody asked for this one, so we should check back sooner. */
export const UNREACHABLE_HOLD_MS = 30_000;

/**
 * How many delivery rows one payload carries.
 *
 * The rows are sorted actionable-first so the cap only ever truncates the
 * already-aggregated healthy tail — a person looking for one broken file still
 * finds it, and the total they should compare against comes from
 * `progress.tracked` rather than from counting keys.
 */
export const MAX_DORUCEKA_ROWS = 300;

/** The last delete-hold we logged, so the same hold is not re-announced every
 *  pass. Observed 47 times in a 72-line log, burying everything else. */
let lastDeleteHoldKey = '';

/** Sort key: what needs a person first. */
function deliveryRank(state: DeliveryState): number {
  switch (state) {
    case 'conflict':
      return 0;
    case 'refused':
      return 1;
    case 'stuck':
      return 2;
    case 'referenced-but-unoffered':
      return 3;
    case 'pushing':
      return 4;
    case 'local-only':
      return 5;
    default:
      return 6;
  }
}

/** Walk depth ceiling — matches the classifier's own shape cap. */
const MAX_WALK_DEPTH = 8;

/** Directories no plane path can live under. */
const SKIPPED_DIRS = new Set(['_trash', '_history', '_untrusted', '_smoke', 'node_modules']);

export interface FilePlaneResult {
  pulled: string[];
  pushed: string[];
  conflicts: { rel: string; copy: string | null }[];
  /** Refused by re-classification or per-class admission. */
  dropped: { rel: string; reason: string }[];
  failed: { rel: string; reason: string }[];
  /** Present and equal — the converged steady state. */
  synced: number;
  /** The hub asked us to start over. */
  reanchored: boolean;
  /** The pass stopped on the aggregate byte budget. */
  budgetExhausted?: true;
  /**
   * The hub asked us to slow down (429), so the WHOLE PLANE is held until
   * `until` — not this file, not this pass.
   *
   * A rate limit is the one refusal where retrying is the thing making it
   * worse, so it is the one refusal that must reach further than the request
   * that met it. `waiting` is how many paths this pass had left to do, so a
   * person is told the size of the pause rather than left reading a status
   * line that says `synced`.
   */
  rateLimited?: {
    until: number;
    retryAfterMs: number;
    waiting: number;
    /**
     * WHY the lane is holding — the two need different words.
     *
     * `hub-asked` is a peer metering us: nothing is wrong, wait. `unreachable`
     * is a peer we could not reach at all, which is the shape a restarting
     * cell produces — and telling a person "the workspace asked us to slow
     * down" when in fact nothing answered is a status surface that lies
     * (DDR-214). Absent reads as `hub-asked`, the pre-existing meaning.
     */
    cause?: 'hub-asked' | 'unreachable' | 'quota';
  };
  /** The pass stopped because it had spent its request ceiling. */
  requestsExhausted?: true;
  /** The door refused our credential; a renewal was requested and the pass ended. */
  authRefused?: true;
  /**
   * Paths skipped this pass because they are inside their per-path backoff
   * window. NOT a failure and NOT converged — work that is deliberately
   * waiting, which is a third thing the counters had no way to say.
   */
  backedOff?: number;
  /** Files removed this pass — `parked` names the `_trash/` copy when there is one. */
  deleted: { rel: string; parked: string | null }[];
  /** A delete burst tripped a breaker; nothing was removed. */
  deleteHeld?: { direction: 'out' | 'in'; count: number; paths: string[] };
  /** Consecutive `reanchor` answers tripped the storm limit; the pass held. */
  reanchorHeld?: true;
  /**
   * More first-anchor conflicts than one pass will decide alone. The paths are
   * listed so the panel can offer one keep-local / keep-cloud for all of them.
   */
  firstAnchorHeld?: { count: number; paths: string[] };
}

export interface FilePlaneOptions {
  designRoot: string;
  hubUrl: string;
  /** Read at call time — silent renewal swaps the credential in place. */
  token: () => string;
  ledger: FileLedger;
  canvasGroups?: readonly CanvasGroupLike[];
  /**
   * Whether `code-module` entries may LAND here. Computed by the caller from
   * LOCAL state (hubs.json role / loopback pairing) — never from anything the
   * hub said. The hub gates the write side too now, but a gate on one side is
   * half a gate, so both ask.
   */
  allowCodeModules: boolean;
  /** Names conflict copies. Same exposure class as `syncMeta.by` (hostname). */
  label: string;
  /** Increment 6. Off means a local absence is HELD, never propagated. */
  propagateDeletes?: boolean;
  /**
   * The user's bulk answer to a first-anchor storm — `'keep-local'` pushes
   * ours over theirs, `'keep-cloud'` takes theirs and parks ours. Absent means
   * a storm holds and asks (see `FIRST_ANCHOR_STORM_LIMIT`).
   */
  resolveFirstAnchor?: 'keep-local' | 'keep-cloud';
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'log' | 'warn'>;
  now?: () => number;
  maxPassBytes?: number;
  /**
   * The door refused our CREDENTIAL (401/403), not our request.
   *
   * The plane had no 401 handling at all: a refusal fell through the generic
   * path and landed as a per-path reason `HTTP 401 — unauthorized`, so a
   * credential that expired mid-seed produced hundreds of "stuck" files and
   * NOTHING ever asked for a new one. Renewal was reachable only from the doc
   * lane's WebSocket auth failure — and on a converged project the doc lane has
   * no handshakes left to fail.
   *
   * Wired by `sync/index.ts` to the same single-flight `renewCredentialNow()`
   * the doc lane uses. Never a second renewal path: that one already has the
   * 60 s floor and the no-progress cap that stopped a reproduced 2 342
   * renewals/s storm.
   */
  onAuthFailure?: (rel: string, status: number) => void;
  /**
   * A pass delivered at least one file.
   *
   * Feeds `renewalsSinceProgress` in `sync/index.ts`, whose cap otherwise
   * counts only DOC handshakes — so during a long seed against an already
   * converged doc lane the runtime stopped renewing after three renewals while
   * the file plane was still working.
   */
  onProgress?: () => void;
}

interface SyncableLocalFile {
  rel: string;
  abs: string;
  hash: string;
  size: number;
  mtimeMs: number;
  cls: FileClass;
  oversized?: undefined;
}

/**
 * Present here, eligible, and over the plane's ceiling (audit 2026-09-13 P1
 * #4). It is IN the inventory — absent from it, it was indistinguishable from
 * a local delete (a grown asset was deleted on the hub) and from a missing
 * local copy (a hub copy overwrote it). Never hashed: reading half a gigabyte
 * to label a row it cannot move is the cost the ceiling exists to avoid.
 */
interface OversizedLocalFile {
  rel: string;
  abs: string;
  hash: null;
  size: number;
  mtimeMs: number;
  cls: FileClass;
  oversized: true;
}

type LocalFile = SyncableLocalFile | OversizedLocalFile;

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Walk the design root and hash what the classifier admits.
 *
 * The stat cache is what makes this cheap: a converged project re-reads
 * nothing, because every file's `(size, mtimeMs)` still matches the ledger.
 */
export function scanLocalFiles(
  designRoot: string,
  ledger: FileLedger,
  canvasGroups?: readonly CanvasGroupLike[]
): Map<string, LocalFile> {
  const found: { rel: string; abs: string; size: number; mtimeMs: number }[] = [];

  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') || SKIPPED_DIRS.has(name)) continue;
      if (name.startsWith('_') && entry.isDirectory()) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(childAbs, childRel, depth + 1);
        continue;
      }
      // A symlink never enters the plane — on either side.
      if (!entry.isFile()) continue;
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      found.push({ rel: childRel, abs: childAbs, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(designRoot, '', 1);

  // Classify against the walked SNAPSHOT, so the sibling-css split cannot race
  // a concurrent write (the same discipline the hub manifest uses).
  const names = new Set(found.map((f) => f.rel));
  const opts = { canvasGroups, hasFile: (r: string) => names.has(r) };

  const out = new Map<string, LocalFile>();
  for (const f of found) {
    const cls = classifyProjectFile(f.rel, opts);
    if (!isFilePlaneClass(cls)) continue;
    if (f.size > MAX_FILE_BYTES) {
      out.set(f.rel, { ...f, cls, hash: null, oversized: true });
      continue;
    }
    let hash = ledger.cachedHash(f.rel, f.size, f.mtimeMs);
    if (hash === null) {
      try {
        hash = sha256File(f.abs);
      } catch {
        continue;
      }
      ledger.noteLocal(f.rel, hash, f.size, f.mtimeMs);
    }
    out.set(f.rel, { rel: f.rel, abs: f.abs, hash, size: f.size, mtimeMs: f.mtimeMs, cls });
  }
  return out;
}

/**
 * Fold journal entries into "what the hub currently holds", newest row wins.
 */
export function foldRemote(entries: JournalEntry[]): Map<string, JournalEntry> {
  const out = new Map<string, JournalEntry>();
  for (const e of entries) {
    const prev = out.get(e.path);
    if (!prev || e.seq > prev.seq) out.set(e.path, e);
  }
  return out;
}

export interface FilePlane {
  /** One full pass. Never throws. */
  reconcile(): Promise<FilePlaneResult>;
  /** Paths whose delivery state the panel should show. BOUNDED — see
   *  `MAX_DORUCEKA_ROWS`; `dorucekaTotal()` is how many there really are. */
  doruceka(): Record<string, DeliveryState>;
  /** How many rows the ledger holds, before the doručenka's cap. */
  dorucekaTotal(): number;
}

export function createFilePlane(opts: FilePlaneOptions): FilePlane {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console;
  const now = opts.now ?? Date.now;
  const base = opts.hubUrl.replace(/\/+$/, '');
  const { ledger, designRoot } = opts;
  /**
   * The design root with its own symlinks resolved. Containment is judged
   * against THIS, not the configured string — otherwise a project reached
   * through a symlinked path (a Syncthing tree, a `/tmp` fixture on macOS)
   * fails its own containment check for every legitimate write.
   */
  const realRoot = (() => {
    try {
      return realpathSync(designRoot);
    } catch {
      return designRoot;
    }
  })();

  const auth = () => ({ authorization: `Bearer ${opts.token()}` });

  /**
   * A thrown transfer error, in words a PERSON can act on.
   *
   * These used to store `(err as Error).message` verbatim, which is Bun's
   * wording, not ours — so 484 undelivered files in an 8.8 GB project were
   * labelled "Was there a typo in the url or port?" while the real fault was a
   * cell restarting in a loop (2026-09-03). The runtime's own text is kept, but
   * in the log where a maintainer reads it, not in the panel where a customer
   * does.
   */
  function transportFailure(err: unknown, rel: string, logger: typeof log): string {
    const c = classifyTransportError(err);
    logger.warn?.(`[sync/files] ${rel}: ${c.text} — ${c.raw}`);
    if (c.class === 'unreachable') {
      unreachableInARow += 1;
      // A PEER THAT IS NOT THERE IS A WALL, not N separate file failures.
      //
      // Without this, a restarting cell drained the whole request ceiling into
      // a closed socket every pass — 314 PUTs across 44 paths in 10 s — and
      // every one of them came back as a per-file `stuck`, so the panel showed
      // hundreds of broken files instead of one unreachable workspace.
      if (unreachableInARow >= UNREACHABLE_STREAK_LIMIT && hitRateLimit === null) {
        hitRateLimit = { retryAfterMs: UNREACHABLE_HOLD_MS, cause: 'unreachable' };
      }
    } else {
      unreachableInARow = 0;
    }
    return c.text;
  }

  /** Consecutive passes the hub answered `reanchor` to. Reset by any that did
   *  not — and decayed by time once held (F-11), so a hold is a window, never
   *  a brick. */
  let reanchorsInARow = 0;
  let reanchorHeldSince = 0;

  /**
   * When the plane may talk to the hub again. Issue #109.
   *
   * A 429 is the one refusal where the retry IS the cause: every re-request
   * inside the window keeps the bucket empty, and the pass only advances its
   * cursor on a clean run, so the identical work set came round every 400 ms.
   * The hold therefore belongs to the PLANE, not to the file that met the
   * wall — the same shape as the re-anchor hold above, and for the same
   * reason: obedience to a hub has to be capped somewhere.
   */
  let rateLimitedUntil = 0;
  /** Set when a refusal this pass was a 429; the pass stops on it. */
  let hitRateLimit: {
    retryAfterMs: number;
    cause: 'hub-asked' | 'unreachable' | 'quota';
  } | null = null;
  /** Consecutive `unreachable` classifications this pass. */
  let unreachableInARow = 0;
  /** The door refused our credential this pass. */
  let authRefused = false;
  /** Bytes this pass has successfully pushed, charged against the window. */
  let quotaSpentThisPass = 0;
  /** The door's own ceilings, learned once per boot. Null until asked. */
  let hubLimits: {
    maxFileBytes: number;
    quotaResetsAt?: number;
    quotaUsed?: number;
    quotaBytesPerWindow?: number;
    /** T18 — the hub takes resumable upload sessions up to this size. */
    maxSessionBytes?: number;
    partBytes?: number;
  } | null = null;
  /** When the limits were last learned. 0 = never. */
  let hubLimitsAt = 0;

  /**
   * Ask the door what it accepts. Once per boot, best-effort.
   *
   * A hub too old to answer (404) is not an error — it gets the fallback, which
   * is what every hub did before this route existed.
   */
  async function ensureHubLimits(): Promise<void> {
    // RE-ASK WHEN THEY GO STALE, and when the quota window should have rolled.
    //
    // Asking exactly once per boot was a serious bug: `quotaUsed` is a point-in-
    // time reading, so a client that booted with the allowance nearly spent
    // computed a headroom of ~0 and then refused every upload FOREVER — long
    // after the hub's hourly window had reset — until someone restarted the
    // process. A stale ceiling is a slow client; a stale quota reading is a
    // client that has silently stopped.
    const stale = hubLimitsAt === 0 || now() - hubLimitsAt > HUB_LIMITS_TTL_MS;
    const windowRolled =
      hubLimits?.quotaResetsAt !== undefined && now() >= (hubLimits.quotaResetsAt as number);
    if (!stale && !windowRolled) return;
    hubLimitsAt = now();
    try {
      const res = await fetchImpl(`${base}/api/file-limits`, {
        headers: auth(),
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        maxFileBytes?: unknown;
        quotaResetsAt?: unknown;
        quotaUsed?: unknown;
        quotaBytesPerWindow?: unknown;
        uploadSessions?: unknown;
        maxSessionBytes?: unknown;
        partBytes?: unknown;
      };
      if (
        Number.isFinite(body?.maxFileBytes) &&
        (body.maxFileBytes as number) >= MIN_TRUSTED_MAX_FILE_BYTES
      ) {
        hubLimits = {
          // Never BELOW our own floor, never above our own receive cap. A hub
          // may be stricter than the default; it may not declare a project
          // unsendable.
          maxFileBytes: Math.min(body.maxFileBytes as number, MAX_FILE_BYTES),
          ...(Number.isFinite(body?.quotaResetsAt)
            ? { quotaResetsAt: body.quotaResetsAt as number }
            : {}),
          ...(Number.isFinite(body?.quotaUsed) ? { quotaUsed: body.quotaUsed as number } : {}),
          ...(Number.isFinite(body?.quotaBytesPerWindow)
            ? { quotaBytesPerWindow: body.quotaBytesPerWindow as number }
            : {}),
          // T18 — sessions, clamped like every other hub-supplied lever: never
          // past our own receive cap, parts between 1 and 64 MiB.
          ...(body?.uploadSessions === true && Number.isFinite(body?.maxSessionBytes)
            ? {
                maxSessionBytes: Math.min(body.maxSessionBytes as number, MAX_FILE_BYTES),
                partBytes: Math.min(
                  Math.max(Number(body.partBytes) || 8 * 1024 * 1024, 1024 * 1024),
                  64 * 1024 * 1024
                ),
              }
            : {}),
        };
      }
    } catch {
      /* the fallback is the pre-existing behaviour */
    }
  }

  /** The single-PUT ceiling in force right now. */
  function singlePutCeiling(): number {
    return hubLimits?.maxFileBytes ?? DEFAULT_HUB_MAX_FILE_BYTES;
  }

  /** The push ceiling in force right now — sessions raise it (T18). */
  function pushCeiling(): number {
    return Math.max(singlePutCeiling(), hubLimits?.maxSessionBytes ?? 0);
  }

  /**
   * Bytes still available inside the hub's current write window, or null when
   * the hub did not say.
   *
   * PACING, NOT A NEW LIMIT — the door's quota stays authoritative. The point
   * is to stop cleanly at the wall instead of driving into it: an 8.8 GB
   * project against a 2 GiB/hour allowance spends at least two full windows,
   * and discovering that as a 507 once per remaining file turns an ordinary,
   * expected wait into hundreds of refusals.
   */
  function quotaHeadroom(): number | null {
    const cap = hubLimits?.quotaBytesPerWindow;
    const used = hubLimits?.quotaUsed;
    if (!Number.isFinite(cap) || !Number.isFinite(used)) return null;
    return Math.max(0, (cap as number) - (used as number));
  }

  /** Human bytes, for a message a person reads. */
  function mb(n: number): string {
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  /** HTTP requests issued by THIS pass — the ceiling the hub actually meters. */
  let requestsThisPass = 0;

  /**
   * Turn a refusal into words, and a 429 into the plane's hold.
   *
   * Every non-ok response on this lane comes through here, so there is one
   * answer to "was that a fault or a wall" rather than one per call site.
   */
  async function refusal(res: Response): Promise<{
    ok: false;
    reason: string;
    rateLimited?: true;
    quotaExhausted?: true;
    quotaResetsAt?: number;
  }> {
    // 507 — the per-token hourly WRITE QUOTA is spent (file-door.mjs
    // `QUOTA_BYTES_PER_WINDOW`, 2 GiB). Not a fault and not a rate limit: the
    // credential is fine, the file is fine, and the only answer is the next
    // window. On an 8.8 GB project this is at least two windows of ordinary
    // waiting, so it needs its own word or a person reads it as broken.
    if (res.status === 507) {
      const resetsAt = hubLimits?.quotaResetsAt;
      return {
        ok: false,
        reason: "This project's upload allowance for the hour is used up",
        quotaExhausted: true,
        ...(Number.isFinite(resetsAt) ? { quotaResetsAt: resetsAt as number } : {}),
      };
    }
    // OUR CREDENTIAL, NOT OUR REQUEST. Ask for a new one — once, through the
    // lane that already has the rate discipline — and end the pass: every
    // remaining request would be refused the same way.
    if (res.status === 401 || res.status === 403) {
      authRefused = true;
      return { ok: false, reason: 'The workspace did not accept this connection' };
    }
    const reason = await failureReason(res);
    // BACKPRESSURE, not just 429 — a cell that is starting answers 503 with a
    // Retry-After, and firing this pass's remaining request budget into that
    // window is how a slow start becomes a failed one.
    if (!isBackpressure(res)) return { ok: false, reason };
    const wait = retryAfterMs(res.headers?.get?.('retry-after') ?? null);
    // The LONGEST wait any refusal this pass asked for. Coming back early is
    // how a hold becomes another storm.
    if (hitRateLimit === null || wait > hitRateLimit.retryAfterMs) {
      hitRateLimit = { retryAfterMs: wait, cause: 'hub-asked' };
    }
    return { ok: false, reason, rateLimited: true };
  }

  /** Fetch one file's bytes and verify them against the hash we were promised. */
  async function fetchVerified(
    rel: string,
    expectHash: string,
    ceiling: number
  ): Promise<
    | { ok: true; bytes: Uint8Array; file?: undefined; size: number }
    | { ok: true; file: string; bytes?: undefined; size: number }
    | { ok: false; reason: string; overCap?: true; rateLimited?: true }
  > {
    let res: Response;
    requestsThisPass += 1;
    // T18 — a partial download of these exact bytes resumes where it stopped.
    const staged = path.join(designRoot, '_state', 'downloads', `${expectHash}.part`);
    let resumeFrom = 0;
    try {
      resumeFrom = statSync(staged).size;
    } catch {
      /* nothing staged */
    }
    try {
      res = await fetchImpl(
        `${base}/_project-file/${rel.split('/').map(encodeURIComponent).join('/')}`,
        {
          headers: { ...auth(), ...(resumeFrom > 0 ? { range: `bytes=${resumeFrom}-` } : {}) },
          signal: AbortSignal.timeout(GET_TIMEOUT_MS),
        }
      );
    } catch (err) {
      return { ok: false, reason: transportFailure(err, rel, log) };
    }
    if (res.status === 416) {
      // The staged part is not a prefix of what the hub holds now: start over.
      rmSync(staged, { force: true });
      return { ok: false, reason: 'the partial download no longer matches — restarting it' };
    }
    if (!res.ok) return await refusal(res);
    const resumed = res.status === 206 && resumeFrom > 0;

    // The cap is consulted BEFORE the body exists, and again as it arrives.
    // Buffering first and measuring after is not a cap at all: a hub answering
    // with a body that never ends fills this process's heap for the whole
    // timeout window and the check never gets to run. The hub's own
    // `streamAndHash` has always had this shape; the asymmetry was the bug.
    const cap = Math.max(0, Math.min(MAX_FILE_BYTES, ceiling));
    const declared = Number(res.headers?.get?.('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > cap) {
      return {
        ok: false,
        reason: `over the cap before a byte was read (${declared} B > ${cap} B)`,
        overCap: true,
      };
    }

    // T18 — a large body streams to the staging file (appending after a
    // resume) and is verified from disk; memory stays one chunk.
    if (resumed || (Number.isFinite(declared) && declared > STREAM_DOWNLOAD_ABOVE_BYTES)) {
      if (!resumed) rmSync(staged, { force: true });
      mkdirSync(path.dirname(staged), { recursive: true });
      const body = res.body;
      if (!body?.getReader) return { ok: false, reason: 'no response stream' };
      const reader = body.getReader();
      let total = resumed ? resumeFrom : 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > cap) {
            await reader.cancel().catch(() => {});
            rmSync(staged, { force: true });
            return { ok: false, reason: `over the cap mid-stream (${total} B > ${cap} B)`, overCap: true };
          }
          appendFileSync(staged, value);
        }
      } catch (err) {
        // What arrived stays staged: the next pass asks for the rest.
        return { ok: false, reason: transportFailure(err, '<response body>', log) };
      }
      let got: string;
      try {
        got = sha256File(staged);
      } catch {
        return { ok: false, reason: 'could not read the downloaded file back' };
      }
      if (got !== expectHash) {
        rmSync(staged, { force: true });
        return { ok: false, reason: 'content hash mismatch (racing a write?)' };
      }
      return { ok: true, file: staged, size: total };
    }

    const bytes = await readCapped(res, cap);
    if (!bytes.ok) return bytes;
    // The hub may REFUSE to serve; it must never be able to SUBSTITUTE.
    const got = sha256(bytes.bytes);
    if (got !== expectHash) {
      return { ok: false, reason: 'content hash mismatch (racing a write?)' };
    }
    return { ok: true, bytes: bytes.bytes, size: bytes.bytes.byteLength };
  }

  /**
   * Read a response body, abandoning it the moment it exceeds `cap`.
   *
   * Falls back to `arrayBuffer()` only when the response has no readable
   * stream (a test double, or a runtime without one) — there the length check
   * is still after the fact, but a double is not the threat.
   */
  async function readCapped(
    res: Response,
    cap: number
  ): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string; overCap?: true }> {
    const body = res.body;
    if (!body?.getReader) {
      const all = new Uint8Array(await res.arrayBuffer());
      if (all.byteLength > cap) {
        return {
          ok: false,
          reason: `implausible size (${all.byteLength} B > ${cap} B)`,
          overCap: true,
        };
      }
      return { ok: true, bytes: all };
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > cap) {
          await reader.cancel().catch(() => {});
          return {
            ok: false,
            reason: `over the cap mid-stream (${total} B > ${cap} B)`,
            overCap: true,
          };
        }
        chunks.push(value);
      }
    } catch (err) {
      return { ok: false, reason: transportFailure(err, '<response body>', log) };
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { ok: true, bytes };
  }

  /**
   * What the hub CLAIMS a row costs — a hint, never the fact.
   *
   * A missing or absurd `size` charges nothing, which is exactly the hole
   * `chargeOverrun` closes: a hub declaring `size: 0` for two hundred 512 MB
   * rows would otherwise land ~100 GB per pass against a budget that never
   * moved — literally the arithmetic `pull-budget.ts` exists to prevent.
   */
  function claimedSize(row?: { size?: number | null }): number {
    const n = row?.size;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Charge what actually arrived, over and above what was claimed.
   *
   * `file-pull.ts` — the lane this replaces — has always done this, with a
   * comment saying an understated size must not buy a bigger transfer. The
   * rule survives the rewrite.
   */
  function chargeOverrun(
    budget: ReturnType<typeof createPullBudget>,
    rel: string,
    actual: number,
    claimed: number,
    out: FilePlaneResult
  ): boolean {
    if (actual <= claimed) return true;
    if (budget.take(actual - claimed)) return true;
    out.failed.push({
      rel,
      reason: `pass byte budget reached (declared ${claimed} B, sent ${actual} B)`,
    });
    out.budgetExhausted = true;
    return false;
  }

  /**
   * `realpathSync` for a path that does not exist yet — resolve the deepest
   * ancestor that DOES exist and re-attach the tail. `path.join` is lexical
   * and never touches disk, which is exactly why it is not a containment check.
   */
  function realpathOfDeepestExisting(p: string): string {
    let cur = p;
    for (;;) {
      try {
        // RE-ATTACH THE TAIL. Resolving the deepest existing ancestor and
        // returning just that loses every directory below it that does not
        // exist yet — which flattens `system/deep/a.css` to `a.css` on exactly
        // the fresh-link path where none of those directories exist. The hub's
        // own helper has always done this; this one was written without it.
        return path.join(realpathSync(cur), path.relative(cur, p));
      } catch {
        const up = path.dirname(cur);
        if (up === cur) return p;
        cur = up;
      }
    }
  }

  /**
   * Where `rel` may actually be written, or null.
   *
   * The lane this replaced carried a lexical containment assertion; this one
   * carried neither that nor the refusal to overwrite a non-file. Lexical
   * traversal is still blocked upstream (the classifier's shape gate refuses
   * `..`, absolutes, backslashes and control chars, and `journal-client.ts`
   * re-validates independently) — but a SYMLINKED INTERMEDIATE DIRECTORY is a
   * different question, and `writeFileSync` + `renameSync` follow those
   * happily. `<designRoot>/system/ds/assets -> ~/.ssh` would land
   * `system/ds/assets/config.css` outside the design root entirely.
   *
   * The hub defends this case explicitly on its own write surfaces; the
   * receiver did not, which is an asymmetry against DDR-226 §9's "receivers
   * re-shape-validate paths and re-classify locally". Same two-guard shape as
   * the hub's: resolve the real parent, assert it is under the real root, and
   * then do every filesystem op on `join(realParent, basename)`.
   */
  function safeTarget(rel: string): { abs: string; parent: string } | null {
    const lexical = path.join(designRoot, rel);
    const abs = realpathOfDeepestExisting(lexical);
    const parent = path.dirname(abs);
    if (parent !== realRoot && !parent.startsWith(realRoot + path.sep)) {
      log.warn?.(
        `[sync/files] refusing ${rel}: it resolves outside the design root (a symlinked directory on the path)`
      );
      return null;
    }
    // A directory, a symlink, a socket — anything that is not a regular file
    // sitting where a file belongs is refused rather than replaced.
    try {
      if (!statSync(abs).isFile()) {
        log.warn?.(`[sync/files] refusing ${rel}: the target exists and is not a regular file`);
        return null;
      }
    } catch {
      /* absent is the normal case for a create */
    }
    return { abs, parent };
  }

  /**
   * Would this peer ever accept `rel` at all? The cheap gate, run before a
   * hub-named path is allowed to become persistent state.
   *
   * Deliberately weaker than the admission check at decision time: it has no
   * scanned local map, so it asks the disk directly. Anything it lets through
   * is still fully re-classified there.
   */
  function admissible(rel: string): boolean {
    const cls = classifyProjectFile(rel, {
      canvasGroups: opts.canvasGroups,
      hasFile: (r) => existsSync(path.join(designRoot, r)),
    });
    return isFilePlaneClass(cls);
  }

  /** Land bytes at `rel`, atomically. Throws on failure — `adoptAfter` catches.
   *  A streamed download (T18) is moved into place from its staging file. */
  function materialize(rel: string, payload: { bytes?: Uint8Array; file?: string }): void {
    const target = safeTarget(rel);
    if (!target) throw new Error(`refusing to write ${rel} — it does not resolve inside the root`);
    mkdirSync(target.parent, { recursive: true });
    if (payload.file) {
      renameSync(payload.file, target.abs);
      return;
    }
    const tmp = `${target.abs}.part`;
    writeFileSync(tmp, payload.bytes ?? new Uint8Array());
    renameSync(tmp, target.abs);
  }

  /** Copy the local file aside under a name both ends can see. Returns the rel. */
  function parkLocal(rel: string): string | null {
    const abs = path.join(designRoot, rel);
    const copyRel = conflictCopyName(rel, now(), opts.label);
    const target = safeTarget(copyRel);
    if (!target) return null;
    try {
      const bytes = readFileSync(abs);
      mkdirSync(target.parent, { recursive: true });
      const tmp = `${target.abs}.part`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, target.abs);
      return copyRel;
    } catch (err) {
      log.warn?.(`[sync/files] could not park ${rel}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Upload one file with a compare-and-swap against the state we decided from.
   */
  async function push(
    local: SyncableLocalFile,
    expect: string | null
  ): Promise<
    | { ok: true; seq: number | null }
    | { ok: false; conflict: true; current: string | null }
    | {
        ok: false;
        conflict?: false;
        reason: string;
        rateLimited?: true;
        tooLarge?: true;
        quotaExhausted?: true;
        quotaResetsAt?: number;
      }
  > {
    // PRE-FLIGHT AGAINST THE DOOR'S OWN CEILING, before a byte is read.
    //
    // `tooLarge` is TERMINAL: the returned reason is stored and the caller
    // parks the path rather than re-queueing it. A file the door will never
    // accept must stop costing a request slot every pass — that is what the
    // 465.8 MB video did, on every boot, forever.
    // PACE AGAINST THE WINDOW. `quotaSpentThisPass` is what we know we have
    // added since the hub last told us where it stood.
    const headroom = quotaHeadroom();
    if (headroom !== null && quotaSpentThisPass + local.size > headroom) {
      holdForQuota(hubLimits?.quotaResetsAt ?? null);
      return {
        ok: false,
        quotaExhausted: true,
        reason: "This project's upload allowance for the hour is used up",
        ...(hubLimits?.quotaResetsAt ? { quotaResetsAt: hubLimits.quotaResetsAt } : {}),
      };
    }
    if (local.size > pushCeiling()) {
      return {
        ok: false,
        tooLarge: true,
        reason: `Too big for this workspace — ${mb(local.size)}, and the limit is ${mb(pushCeiling())}`,
      };
    }
    // T18 — past one request: a resumable session, in verified parts.
    if (local.size > singlePutCeiling()) return pushSession(local, expect);
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(local.abs);
    } catch (err) {
      // A LOCAL DISK READ, not a transfer. Classifying it as a transport
      // failure would tell a person the workspace is unreachable when the file
      // is simply gone or unreadable — a wrong answer is worse than a vague one.
      log.warn?.(
        `[sync/files] ${local.rel}: could not read from disk — ${String((err as Error)?.message ?? err).slice(0, 200)}`
      );
      return { ok: false, reason: 'Could not read this file from disk' };
    }
    // In flight, so a journal row carrying this hash reads as our own echo
    // rather than as a remote change we must react to.
    ledger.outboxAdd(local.hash);
    requestsThisPass += 1;
    try {
      const res = await fetchImpl(
        `${base}/api/file/${local.rel.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'PUT',
          headers: {
            ...auth(),
            'content-type': 'application/octet-stream',
            'x-maude-content-sha256': local.hash,
            'x-maude-expect-hash': expect ?? 'none',
          },
          body: bytes as unknown as BodyInit,
          signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
        }
      );
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { current?: unknown };
        return {
          ok: false,
          conflict: true,
          current: typeof body?.current === 'string' ? body.current : null,
        };
      }
      if (!res.ok) return await refusal(res);
      const body = (await res.json().catch(() => ({}))) as { seq?: unknown };
      return { ok: true, seq: typeof body?.seq === 'number' ? body.seq : null };
    } catch (err) {
      return { ok: false, reason: transportFailure(err, local.rel, log) };
    } finally {
      ledger.outboxDone(local.hash);
    }
  }

  /**
   * T18 — upload a large file as a resumable session. The hub makes creation
   * idempotent for the same (person, path, bytes), so a restarted app resumes
   * by asking again and sending only the parts the hub does not hold. Memory
   * is one part; the whole object is verified by the hub before it lands.
   */
  async function pushSession(
    local: SyncableLocalFile,
    expect: string | null
  ): Promise<Awaited<ReturnType<typeof push>>> {
    const json = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, unknown>;
    ledger.outboxAdd(local.hash);
    requestsThisPass += 1;
    try {
      const created = await fetchImpl(`${base}/api/file-uploads`, {
        method: 'POST',
        headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({
          path: local.rel,
          size: local.size,
          sha256: local.hash,
          expectHash: expect ?? 'none',
        }),
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      });
      if (!created.ok) return await refusal(created);
      const s = await json(created);
      const id = typeof s.id === 'string' ? s.id : '';
      const partBytes = Number(s.partBytes);
      const parts = Number(s.parts);
      if (!/^up_[0-9a-f]{32}$/.test(id) || !(partBytes > 0) || !(parts > 0)) {
        return { ok: false, reason: 'The workspace answered the upload with nonsense' };
      }
      const have = new Set(Array.isArray(s.received) ? (s.received as number[]) : []);
      const buf = Buffer.allocUnsafe(partBytes);
      const fd = openSync(local.abs, 'r');
      try {
        for (let n = 0; n < parts; n += 1) {
          if (have.has(n)) continue;
          const len = Math.min(partBytes, local.size - n * partBytes);
          const read = readSync(fd, buf, 0, len, n * partBytes);
          if (read !== len) return { ok: false, reason: 'The file changed while it was uploading' };
          const part = Buffer.from(buf.subarray(0, len));
          let res: Response | null = null;
          let lastErr: unknown = null;
          for (let attempt = 0; attempt < 3 && !res?.ok; attempt += 1) {
            try {
              res = await fetchImpl(`${base}/api/file-uploads/${id}/${n}`, {
                method: 'PUT',
                headers: {
                  ...auth(),
                  'content-type': 'application/octet-stream',
                  'x-maude-part-sha256': sha256(part),
                },
                body: part as unknown as BodyInit,
                signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
              });
              if (res.status === 429 || res.status === 507) return await refusal(res);
            } catch (err) {
              lastErr = err;
              res = null;
            }
          }
          if (!res) return { ok: false, reason: transportFailure(lastErr, local.rel, log) };
          if (!res.ok) return await refusal(res);
        }
      } finally {
        closeSync(fd);
      }
      const done = await fetchImpl(`${base}/api/file-uploads/${id}/complete`, {
        method: 'POST',
        headers: auth(),
        signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
      });
      if (done.status === 409) {
        const body = await json(done);
        if (Array.isArray(body.received)) {
          // Parts the hub lost between our PUTs and the completion: the next
          // pass resumes and sends exactly those.
          return { ok: false, reason: 'Upload interrupted — it resumes on the next pass' };
        }
        return { ok: false, conflict: true, current: typeof body.current === 'string' ? body.current : null };
      }
      if (!done.ok) return await refusal(done);
      const body = await json(done);
      return { ok: true, seq: typeof body.seq === 'number' ? body.seq : null };
    } catch (err) {
      return { ok: false, reason: transportFailure(err, local.rel, log) };
    } finally {
      ledger.outboxDone(local.hash);
    }
  }

  /**
   * Tell the hub a file is gone here — Increment 6.
   *
   * Carries the same `x-maude-expect-hash` precondition a write does, and for
   * the same reason: a delete that raced somebody's edit must LOSE. The hub
   * answers 409 with what it now holds, the next pass re-decides against that,
   * and `local-deleted-but-remote-moved` brings their work back instead of
   * removing it. An edit beats a delete, enforced at the door rather than hoped
   * for by ordering.
   */
  async function pushDelete(
    rel: string,
    expect: string | null
  ): Promise<
    { ok: true } | { ok: false; conflict: true } | { ok: false; reason: string; rateLimited?: true }
  > {
    requestsThisPass += 1;
    try {
      const res = await fetchImpl(
        `${base}/api/file/${rel.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'DELETE',
          headers: { ...auth(), 'x-maude-expect-hash': expect ?? 'none' },
          signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
        }
      );
      if (res.status === 409) return { ok: false, conflict: true };
      if (!res.ok) return await refusal(res);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: transportFailure(err, rel, log) };
    }
  }

  /** Move a file into `_trash/<stamp>/<rel>`; returns the trash rel or null. */
  function quarantineLocal(rel: string): string | null {
    const abs = path.join(designRoot, rel);
    if (!existsSync(abs)) return null;
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const destRel = `_trash/${stamp}/${rel}`;
    // THROUGH `safeTarget`, like every other write on this side. This was the
    // one path that skipped it, and it is the worst one to skip: the
    // DESTINATION is where a file goes to be recoverable, so a symlinked
    // `_trash/` that lands it outside the design root turns "quarantined,
    // never unlinked" into a deletion with extra steps.
    const target = safeTarget(destRel);
    if (!target) {
      log.warn?.(
        `[sync/files] refusing to quarantine ${rel} — _trash/ does not resolve inside the root`
      );
      return null;
    }
    try {
      mkdirSync(target.parent, { recursive: true });
      renameSync(abs, target.abs);
      return destRel;
    } catch (err) {
      log.warn?.(`[sync/files] could not quarantine ${rel}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Arm the plane-wide hold if this pass met a 429, and say so on the result.
   *
   * Called on EVERY exit from a pass, including the early ones — a refusal on
   * the cursor read is the same wall as a refusal on a file, and the pass that
   * discovers it is usually the cheap one.
   */
  /**
   * The hourly write quota is spent. Hold the LANE until it resets.
   *
   * Distinct from a rate limit even though both pause: a rate limit is the hub
   * metering request RATE, a quota is a byte budget for a window. On an 8.8 GB
   * project against a 2 GiB/hour quota this is not an edge case — it is at
   * least two full windows of ordinary, expected waiting, and a person who is
   * not told that reads a stalled panel as a broken one.
   */
  function holdForQuota(resetsAt: number | null): void {
    // CLAMPED. `resetsAt` is hub-supplied; unclamped, a peer could name a reset
    // a year out and stop this machine syncing until someone restarted it.
    const raw = (resetsAt ?? now() + 3_600_000) - now();
    const wait = Math.min(MAX_TRUSTED_QUOTA_PAUSE_MS, Math.max(60_000, raw));
    if (hitRateLimit === null || wait > hitRateLimit.retryAfterMs) {
      hitRateLimit = { retryAfterMs: wait, cause: 'quota' };
    }
  }

  function holdIfRateLimited(out: FilePlaneResult, waiting: number): FilePlaneResult {
    // Idempotent: the apply loop arms the hold itself (it is the only caller
    // that knows how many paths were left), and the pass tail then calls this
    // again as a backstop. Re-arming would push the window out and log twice.
    if (hitRateLimit === null || out.rateLimited) return out;
    const wait = hitRateLimit.retryAfterMs;
    const cause = hitRateLimit.cause;
    rateLimitedUntil = now() + wait;
    out.rateLimited = { until: rateLimitedUntil, retryAfterMs: wait, waiting, cause };
    const why =
      cause === 'unreachable'
        ? 'the project could not be reached'
        : cause === 'quota'
          ? "this project's upload allowance for the hour is used up"
          : 'the project is asking this machine to slow down (HTTP 429)';
    log.warn?.(
      `[sync/files] ${why}. Pausing the file lane for ${Math.round(wait / 1000)} s${
        waiting > 0 ? `; ${waiting} file(s) still to come` : ''
      }. Nothing is lost — they arrive when the pause lifts.`
    );
    return out;
  }

  async function reconcile(): Promise<FilePlaneResult> {
    const out: FilePlaneResult = {
      pulled: [],
      pushed: [],
      conflicts: [],
      dropped: [],
      failed: [],
      deleted: [],
      synced: 0,
      reanchored: false,
    };

    // ── 0. Is the door shut? ─────────────────────────────────────────────
    //
    // BEFORE the journal read, because the journal read is a request too, and
    // it draws on the very bucket we are waiting to refill. A held pass that
    // still asks the hub for a page is not held.
    if (now() < rateLimitedUntil) {
      out.rateLimited = {
        until: rateLimitedUntil,
        retryAfterMs: rateLimitedUntil - now(),
        // The pass that armed the hold counted what it had LEFT; a held pass
        // has not looked, so it reports what the ledger still calls stuck.
        // Close enough to be useful, and honest about being a count of rows
        // rather than a promise about the next pass.
        waiting: Object.values(ledger.rows()).filter((r) => r.state === 'stuck').length,
      };
      return out;
    }
    hitRateLimit = null;
    unreachableInARow = 0;
    authRefused = false;
    quotaSpentThisPass = 0;
    await ensureHubLimits();
    requestsThisPass = 0;

    // ── 1. The hub's side ────────────────────────────────────────────────
    const startedFrom = ledger.cursor();
    let fullRead = startedFrom === 0;
    let page = await fetchJournal({
      hubUrl: opts.hubUrl,
      token: opts.token(),
      since: startedFrom,
      epoch: ledger.epoch(),
      fetchImpl,
      onRefused: async (res) => {
        await refusal(res);
      },
    });
    // Unreachable / refused / journal-less: this pass does nothing, and the
    // next one asks again. NEVER "nothing changed".
    if (page === null) return holdIfRateLimited(out, 0);

    // Whether our ANCESTORS still describe the hub's log.
    //
    // Computed BEFORE re-anchoring, because re-anchoring adopts the hub's
    // epoch — ask afterwards and the answer is always "fine", and the degraded
    // rows in the decision table could never fire at all. The whole point of
    // those rows is the pass that discovers the log moved out from under us.
    let degraded = ledger.isDegraded(page.epoch);

    if (page.reanchor) {
      // A RE-ANCHOR STORM IS A DISK-FILLING PRIMITIVE, so obedience is capped.
      //
      // Re-anchoring is a full compaction read plus `pruneRemotes`, and it sets
      // `degraded`, under which every differing path parks a copy of the hub's
      // bytes. A hub that answers `reanchor` to every request therefore drives
      // unbounded work and (before the park memo) unbounded files. Past the
      // limit the pass holds and says so; after REANCHOR_HOLD_RECOVERY_MS one
      // fresh attempt is allowed, so a legitimate epoch rotation still
      // converges while a storm stays capped at one full read per window.
      reanchorsInARow += 1;
      if (reanchorsInARow > REANCHOR_STORM_LIMIT) {
        // F-11 — the hold is a WINDOW, not a brick. Once the recovery window
        // has passed, allow exactly one fresh attempt (counter back to 1): a
        // legitimate epoch-rotation burst converges on its first quiet retry,
        // while a hub that answers `reanchor` forever is capped at one full
        // read per window instead of bricking the plane until a restart.
        if (reanchorHeldSince === 0) reanchorHeldSince = now();
        if (now() - reanchorHeldSince < REANCHOR_HOLD_RECOVERY_MS) {
          log.warn?.(
            `[sync/files] the hub has asked to re-anchor ${reanchorsInARow} times in a row — holding this pass (retry allowed in ${Math.ceil((REANCHOR_HOLD_RECOVERY_MS - (now() - reanchorHeldSince)) / 60000)} min). Ancestors are untouched and nothing was overwritten.`
          );
          out.reanchorHeld = true;
          return out;
        }
        reanchorsInARow = 1;
        reanchorHeldSince = 0;
      }
      out.reanchored = true;
      log.warn?.(
        `[sync/files] re-anchoring against the hub (${page.reason ?? 'cursor not in this log'}).`
      );
      // A cursor we held that the hub cannot honour means our anchor is not in
      // their log — whether the epoch rotated or the log rewound underneath
      // it. Either way the ancestors stop being overwrite authority for this
      // pass; they are demoted, not discarded.
      if (startedFrom > 0) degraded = true;
      ledger.reanchor(page.epoch);
      fullRead = true;
      page = await fetchJournal({
        hubUrl: opts.hubUrl,
        token: opts.token(),
        since: 0,
        fetchImpl,
        onRefused: async (res) => {
          await refusal(res);
        },
      });
      if (page === null || page.reanchor) return holdIfRateLimited(out, 0);
    }

    if (!out.reanchored) {
      reanchorsInARow = 0;
      reanchorHeldSince = 0;
    }

    // THE HUB'S SIDE IS THE LEDGER'S REPLICA, UPDATED BY THIS PAGE — not the
    // page itself. A delta says "these changed"; it says nothing at all about
    // the paths it omits. Reading that silence as "the hub does not have them"
    // would push every converged file back up on every pass, and would be
    // absence-as-authority (DDR-076) rebuilt one layer above the table that
    // forbids it. Only a FULL read may retract a remembered remote.
    const delta = foldRemote(page.entries);
    for (const [rel, row] of delta) {
      // CLASSIFY BEFORE REMEMBERING. Admission used to run at decision time
      // only, which meant every path the hub named — including a page of pure
      // junk — became a ledger row on disk and a key in `_sync.json` first,
      // and a second `stuck` row immediately after. One response could grow
      // this machine's persistent state without bound, and the rows were never
      // pruned by count, so the poisoning survived restarts. The full
      // admission below is unchanged; this is the cheaper gate in front of it.
      if (!admissible(rel)) {
        // Reported, so a refusal is never silent — but not REMEMBERED. `drop`
        // declines to mint a row for a path this machine does not already
        // track, so the pass says what it refused without the hub being able
        // to grow our ledger by naming things.
        drop(out, rel, 'the hub offered a path this peer does not admit', ledger);
        delta.delete(rel);
        continue;
      }
      ledger.noteRemote(rel, row.deleted ? null : row.sha256, row.seq);
    }
    if (fullRead) ledger.pruneRemotes(new Set(delta.keys()));

    // ── 2. Ours ──────────────────────────────────────────────────────────
    const local = scanLocalFiles(designRoot, ledger, opts.canvasGroups);

    // ── 3. Decide ────────────────────────────────────────────────────────
    let work: {
      rel: string;
      decision: ReturnType<typeof decideFile>;
      local: SyncableLocalFile | undefined;
      row: JournalEntry | undefined;
      remoteHash: string | null;
    }[] = [];

    // Every path either side knows about — including ones only the LEDGER
    // remembers, which is how a file that stopped changing still gets checked.
    const paths = new Set<string>([
      ...local.keys(),
      ...delta.keys(),
      ...Object.keys(ledger.rows()),
    ]);
    for (const rel of paths) {
      const row = delta.get(rel);
      const here = local.get(rel);
      // HELD, NOT ABSENT. A file this peer cannot move is still a file: no
      // decision may read it as deleted here or missing here.
      if (here?.oversized) {
        holdOversized(out, ledger, here);
        continue;
      }
      // What the hub holds: this page when it spoke about the path, otherwise
      // what we last learned. `undefined` (never learned) reads as null only
      // after a full read has had the chance to say so.
      const remoteHash = row ? (row.deleted ? null : row.sha256) : (ledger.remoteOf(rel) ?? null);

      // ADMISSION RUNS FOR EVERY PATH THE HUB OFFERS — not only for the ones
      // this page happened to mention.
      //
      // Gating on "the delta carried a row" was a hole with teeth: a cursor
      // read is silent about unchanged paths, so a code module refused on the
      // pass that introduced it sailed straight through on the next tick,
      // sourced from the remembered remote with no gate in front of it. The
      // admission belongs to the OFFER, not to the notification.
      if (remoteHash !== null) {
        // THIS peer's verdict on the path, not the hub's. A disagreement is a
        // drop, not a negotiation (DDR-054: the hub's class is a hint).
        const cls = classifyProjectFile(rel, {
          canvasGroups: opts.canvasGroups,
          hasFile: (r) => local.has(r) || existsSync(path.join(designRoot, r)),
        });
        if (!isFilePlaneClass(cls)) {
          drop(out, rel, `classifies '${cls}' here`, ledger);
          continue;
        }
        if (cls === 'code-module' && !opts.allowCodeModules) {
          drop(
            out,
            rel,
            'code modules replicate only from an owner-vouched or loopback hub',
            ledger
          );
          continue;
        }
      }

      const state: FileState = {
        path: rel,
        local: here?.hash ?? null,
        remote: remoteHash,
        ancestor: ledger.ancestorOf(rel),
        ...(row?.deleted ? { remoteTombstone: true } : {}),
        ...(degraded ? { epochChanged: true } : {}),
        ...(remoteHash && ledger.outboxHas(remoteHash) ? { selfInFlight: true } : {}),
        ...(opts.propagateDeletes ? { propagateDeletes: true } : {}),
      };
      const decision = decideFile(state);
      if (decision.action === 'noop' && !decision.parkRemote) {
        if (decision.adoptAncestor && here) {
          // Record agreement so the next pass is a stat and nothing more.
          //
          // The state comes from the REMEMBERED remote, not from this page. A
          // converged file is precisely the one a delta never mentions, so
          // reading `row` here made every settled file report `local-only` —
          // a panel saying "not delivered" about files that had been on the
          // hub for hours. That is the status-lies failure DDR-214 exists to
          // end, and it is worse than no panel: it teaches people to distrust
          // the one surface meant to answer the question.
          void ledger.adoptAfter(rel, here.hash, () => {}, {
            ...(row ? { remoteSeq: row.seq } : {}),
            size: here.size,
            mtimeMs: here.mtimeMs,
            state: remoteHash !== null ? 'on-hub' : 'local-only',
          });
          out.synced += 1;
        }
        continue;
      }
      work.push({ rel, decision, local: here, row, remoteHash });
    }

    // DELETION BREAKERS. Counted before anything is applied, in both
    // directions, because a delete you have already done is not one a prompt
    // can take back.
    const tracked = Object.keys(ledger.rows()).length;

    /**
     * Three arms, and the cumulative one is the load-bearing addition.
     *
     *   burst      — more than `MAX` in one pass. The accident shape.
     *   proportion — more than a quarter of what this machine tracks. Catches
     *                a small project where ten is most of it.
     *   budget     — more than `PER_WINDOW` across the whole window, counting
     *                what previous passes already applied. Catches the patient
     *                drain the first two are blind to, and survives a restart.
     */
    const overBreaker = (direction: 'out' | 'in', n: number): boolean => {
      const already = ledger.deletesInWindow(direction, DELETE_BUDGET_WINDOW_MS);
      if (n > DELETE_BREAKER_MAX) return true;
      if (
        n >= DELETE_BREAKER_MIN_FOR_FRACTION &&
        tracked > 0 &&
        n / tracked > DELETE_BREAKER_MAX_FRACTION
      ) {
        return true;
      }
      return already + n > DELETE_BUDGET_PER_WINDOW;
    };

    for (const direction of ['out', 'in'] as const) {
      const action = direction === 'out' ? 'propagate-delete' : 'quarantine';
      const hits = work.filter((w) => w.decision.action === action);
      if (hits.length === 0 || !overBreaker(direction, hits.length)) continue;
      const paths = hits.map((w) => w.rel).sort();
      // ONCE PER DISTINCT HOLD, not once per pass.
      //
      // The `held` entry reaches the Sync panel on every pass regardless, so
      // this line is repetition rather than signal — and it repeated 47 times
      // in a 72-line log, burying every other line a person needed to see.
      const holdKey = `${direction}:${paths.join('|')}`;
      const alreadyAnnounced = lastDeleteHoldKey === holdKey;
      lastDeleteHoldKey = holdKey;
      if (!alreadyAnnounced)
        log.warn?.(
          direction === 'out'
            ? `[sync/files] ${paths.length} of ${tracked} tracked files are gone from this machine — NOT telling the project. If that was a branch switch or a bad restore, nothing is lost; if you meant it, confirm the deletion.`
            : `[sync/files] the project wants to remove ${paths.length} of ${tracked} tracked files here — holding. Nothing was deleted.`
        );
      out.deleteHeld = { direction, count: paths.length, paths: paths.slice(0, 200) };
      for (const w of hits) {
        ledger.setState(w.rel, 'conflict', {
          reason:
            direction === 'out'
              ? 'gone from this machine, as part of a batch too large to propagate unasked'
              : 'the project wants this removed, as part of a batch too large to apply unasked',
        });
      }
      work = work.filter((w) => !hits.includes(w));
    }

    // FLIP-DAY BREAKER. Counted before anything is applied, because the point
    // is to not have parked forty files by the time anyone notices.
    const firstAnchor = work.filter(
      (w) =>
        w.decision.action === 'conflict-aside' &&
        ledger.ancestorOf(w.rel) === null &&
        w.local !== undefined
    );
    if (firstAnchor.length > 0 && opts.resolveFirstAnchor === 'keep-local') {
      // Ours wins the set: drop the pull half of each conflict and let the
      // push half send local up. Nothing is parked, because nothing is lost —
      // the hub's copy is still in its own journal and its own object storage.
      for (const w of firstAnchor) {
        w.decision = {
          action: 'push',
          reason: 'you chose to keep this machine’s copies for the whole set',
        };
      }
    }
    if (firstAnchor.length > FIRST_ANCHOR_STORM_LIMIT && !opts.resolveFirstAnchor) {
      const paths = firstAnchor.map((w) => w.rel).sort();
      log.warn?.(
        `[sync/files] ${paths.length} files differ on both sides and this machine has never reconciled any of them — holding, rather than parking ${paths.length} conflict copies. Choose keep-local or keep-cloud for the set.`
      );
      out.firstAnchorHeld = { count: paths.length, paths: paths.slice(0, 200) };
      for (const w of firstAnchor) {
        ledger.setState(w.rel, 'conflict', {
          reason: 'both sides have content and neither has been reconciled here yet',
        });
      }
      // Everything that is NOT a first-anchor conflict still flows: holding a
      // whole pass over one class would stall ordinary sync too.
      work = work.filter((w) => !firstAnchor.includes(w));
    }

    // ── 4. Apply ─────────────────────────────────────────────────────────
    //
    // Referenced assets first (DDR-223's strokes→bytes coupling): a picture a
    // just-arrived annotation points at is the one a person is staring at.
    const referenced = referencedAssetNames(designRoot);
    work.sort((a, b) => rank(a.rel, referenced) - rank(b.rel, referenced));

    const budget = createPullBudget({
      label: 'sync/files',
      log,
      ...(opts.maxPassBytes !== undefined ? { maxBytes: opts.maxPassBytes } : {}),
    });

    let moved = 0;
    let seen = 0;
    for (const item of work) {
      // TWO CEILINGS, because they bound different things and only one of them
      // survives a bad day. `moved` bounds what LANDS — disk writes, parked
      // copies, ledger churn — and it is the one a healthy pass hits. Requests
      // bound what we ASK, and it is the one that matters when nothing is
      // landing, which is precisely when the first counter stops moving
      // (issue #109).
      if (moved >= MAX_FILES_PER_PASS || requestsThisPass >= MAX_REQUESTS_PER_PASS) {
        if (requestsThisPass >= MAX_REQUESTS_PER_PASS) out.requestsExhausted = true;
        log.warn?.(
          `[sync/files] ${work.length - seen} more path(s) to reconcile; taking them next pass.`
        );
        break;
      }
      if (budget.exhausted()) {
        out.budgetExhausted = true;
        break;
      }
      // A PATH INSIDE ITS BACKOFF WINDOW COSTS NOTHING.
      //
      // Checked BEFORE the ceilings deliberately: charging a skipped path
      // against `MAX_REQUESTS_PER_PASS` would let a handful of permanently
      // failing paths starve every healthy one — which is how two runs against
      // an 8.8 GB project moved zero files while sending 616 MB (2026-09-03).
      if (ledger.isBackedOff(item.rel, now())) {
        seen += 1;
        out.backedOff = (out.backedOff ?? 0) + 1;
        continue;
      }
      seen += 1;
      const before = {
        failed: out.failed.length,
        pushed: out.pushed.length,
        pulled: out.pulled.length,
      };
      const handled = await applyOne(item, out, budget);
      if (handled) moved += 1;
      // Arm or clear this path's window from what the pass actually did with
      // it. A rate limit is excluded: that is the DOOR's state, not this
      // path's, and punishing the file for it would push a whole project into
      // backoff for something none of its files did.
      if (hitRateLimit === null) {
        if (out.failed.length > before.failed) {
          const delay = ledger.noteAttemptFailed(item.rel, now());
          log.warn?.(
            `[sync/files] ${item.rel}: backing off ${Math.round(delay / 1000)}s before the next attempt`
          );
        } else if (
          out.pushed.length > before.pushed ||
          out.pulled.length > before.pulled ||
          handled
        ) {
          ledger.noteAttemptOk(item.rel);
        }
      }
      // A RATE LIMIT ENDS THE PASS. Every other refusal is about one file and
      // the next one is worth trying; this one is about the door, and the
      // remaining requests would do nothing but hold it shut for longer.
      if (authRefused) {
        // ONE notification for the whole pass. `renewCredentialNow()` is
        // single-flight with a 60 s floor, so 803 refused paths collapse to one
        // renewal — but there is no reason to call it 803 times to find out.
        opts.onAuthFailure?.(item.rel, 401);
        out.authRefused = true;
        log.warn?.(
          `[sync/files] the workspace did not accept this connection; asking for a fresh credential and stopping this pass (${work.length - seen} path(s) still to do).`
        );
        break;
      }
      if (hitRateLimit !== null) {
        holdIfRateLimited(out, work.length - seen);
        break;
      }
    }
    if (out.pushed.length > 0 || out.pulled.length > 0) opts.onProgress?.();

    // ── 5. Position ──────────────────────────────────────────────────────
    //
    // Only advance the cursor when the pass actually consumed the page. A
    // partial pass re-reads the same range next time, which is free (the
    // decisions for already-converged paths are `noop`).
    if (!page.truncated && out.failed.length === 0) {
      ledger.setPosition(page.epoch, page.head);
    } else {
      ledger.setPosition(page.epoch, ledger.cursor());
    }
    ledger.flush();

    if (out.pulled.length || out.pushed.length || out.conflicts.length) {
      log.log?.(
        `[sync/files] ${out.pulled.length} down, ${out.pushed.length} up, ${out.conflicts.length} conflict(s), ${out.synced} already in step${
          out.failed.length ? `, ${out.failed.length} failed` : ''
        }.`
      );
    }
    // CHARGE WHAT ACTUALLY HAPPENED against the window, per direction. Applied
    // deletions only — a decision the breaker held, or one that failed, costs
    // nothing, or a hub could exhaust the budget with attempts.
    ledger.noteDeletes(
      'out',
      out.deleted.filter((d) => d.parked === null).map((d) => d.rel),
      DELETE_BUDGET_WINDOW_MS
    );
    ledger.noteDeletes(
      'in',
      out.deleted.filter((d) => d.parked !== null).map((d) => d.rel),
      DELETE_BUDGET_WINDOW_MS
    );

    // The backstop. The loop arms the hold itself so it can report how many
    // paths it had left; this catches a 429 met anywhere else in the pass —
    // and is idempotent, because arming a hold twice is arming it once.
    return holdIfRateLimited(out, 0);
  }

  async function applyOne(
    item: {
      rel: string;
      decision: ReturnType<typeof decideFile>;
      local?: SyncableLocalFile;
      row?: JournalEntry;
      remoteHash: string | null;
    },
    out: FilePlaneResult,
    budget: ReturnType<typeof createPullBudget>
  ): Promise<boolean> {
    const { rel, decision, local: here, row, remoteHash } = item;

    switch (decision.action) {
      case 'noop': {
        // Only the epoch-degraded rows reach here: keep local, park THEIR
        // copy so it is recoverable, and let the push half send ours up.
        if (decision.parkRemote && remoteHash) {
          // ONCE per remote hash. The decision is `noop`, so the ancestor
          // deliberately does not move and the next pass sees the identical
          // state — without this memo a hub that re-anchors every request
          // (or merely rotates its epoch, which is a legitimate event) writes
          // a fresh timestamped copy of every diverged path on every pass,
          // and each copy is then scanned as `create-up` and pushed back up.
          //
          // B13 — honoured only while the copy it names STILL EXISTS. The
          // memo's claim is "a recoverable copy was made"; after the user
          // deleted it or a `_trash/` prune swept it, skipping the park on the
          // memo's word would be a noop with no recoverable copy anywhere.
          {
            const memoRow = ledger.row(rel);
            if (
              memoRow?.parkedRemote === remoteHash &&
              memoRow.conflictCopy &&
              existsSync(path.join(designRoot, memoRow.conflictCopy))
            ) {
              return true;
            }
          }
          const claim = claimedSize(row);
          if (!budget.take(claim)) {
            out.budgetExhausted = true;
            return false;
          }
          const got = await fetchVerified(rel, remoteHash, budget.remaining() + claim);
          if (!got.ok) {
            if (got.overCap && budget.remaining() + claim < MAX_FILE_BYTES) {
              out.budgetExhausted = true;
            }
            return false;
          }
          if (!chargeOverrun(budget, rel, got.size, claim, out)) return false;
          const copyRel = conflictCopyName(rel, now(), 'hub');
          try {
            materialize(copyRel, got);
            ledger.setState(rel, 'conflict', {
              reason: 'the hub’s log restarted; their copy is parked beside yours',
              conflictCopy: copyRel,
              parkedRemote: remoteHash,
            });
            out.conflicts.push({ rel, copy: copyRel });
          } catch (err) {
            log.warn?.(
              `[sync/files] ${rel}: could not park the conflicting copy — ${String((err as Error)?.message ?? err).slice(0, 200)}`
            );
            out.failed.push({ rel, reason: 'Could not write the conflicting copy to disk' });
          }
        }
        return true;
      }

      case 'pull': {
        // From the REMEMBERED remote, not only from this page. A pull that
        // failed last pass leaves the hub's hash known and this page silent
        // about it; sourcing the fetch from the page alone would mean a
        // transient 500 permanently stranded the file.
        if (!remoteHash) return false;
        const claim = claimedSize(row);
        if (!budget.take(claim)) {
          out.budgetExhausted = true;
          return false;
        }
        const got = await fetchVerified(rel, remoteHash, budget.remaining() + claim);
        if (!got.ok) {
          out.failed.push({ rel, reason: got.reason });
          ledger.setState(rel, 'stuck', { reason: got.reason });
          // Refused because it would not fit in what is LEFT, not because it is
          // implausible on its own: that is the budget speaking, so the pass
          // says so and the next one picks the file up with a full budget.
          if (got.overCap && budget.remaining() + claim < MAX_FILE_BYTES) {
            out.budgetExhausted = true;
          }
          return false;
        }
        if (!chargeOverrun(budget, rel, got.size, claim, out)) return false;
        const landed = await ledger.adoptAfter(rel, remoteHash, () => materialize(rel, got), {
          ...(row ? { remoteSeq: row.seq } : {}),
          state: 'on-hub',
        });
        if (landed) {
          // Re-stat so the cache matches what is now on disk, or the very next
          // pass re-hashes everything it just wrote.
          restat(rel);
          out.pulled.push(rel);
        } else {
          out.failed.push({ rel, reason: 'could not materialize' });
        }
        return landed;
      }

      case 'push':
      case 'revive': {
        if (!here) return false;
        ledger.setState(rel, 'pushing');
        const expect = decision.action === 'revive' ? null : remoteHash;
        const res = await push(here, expect);
        if (res.ok) {
          await ledger.adoptAfter(rel, here.hash, () => {}, {
            ...(res.seq !== null ? { remoteSeq: res.seq } : {}),
            size: here.size,
            mtimeMs: here.mtimeMs,
            state: 'on-hub',
          });
          // Charge the window. The hub's own figure is authoritative and
          // refreshes next boot; this is what keeps a single long pass from
          // overrunning a window it was told the start of.
          quotaSpentThisPass += here.size;
          out.pushed.push(rel);
          return true;
        }
        if (res.conflict) {
          // The hub moved under us. Do NOT retry blindly — re-decide next
          // pass against what it actually holds now, which is exactly what a
          // cursor read will hand us.
          ledger.setState(rel, 'conflict', {
            reason: 'the hub changed this file while the upload was in flight',
          });
          out.conflicts.push({ rel, copy: null });
          return true;
        }
        // A WALL, NOT A FAILURE — and the two need different answers.
        //
        // `tooLarge` will never succeed however long we wait, and `quota` will
        // never succeed inside this window. Both used to land as an anonymous
        // `stuck` that the next pass re-attempted at full rate: that is how two
        // files (164.9 MB + 465.8 MB) spent every boot burning request slots,
        // and how the panel showed "stuck" for something no retry could fix.
        // `refused` is terminal for this pass and skipped by the backoff.
        if (res.tooLarge || res.quotaExhausted) {
          ledger.setState(rel, 'refused', {
            reason: res.reason,
            blockedClass: res.tooLarge ? 'too-large' : 'quota',
          });
          out.dropped.push({ rel, reason: res.reason });
          if (res.quotaExhausted) {
            // A quota is a WINDOW, so hold the whole lane until it resets
            // rather than discovering it once per remaining file.
            holdForQuota(res.quotaResetsAt ?? null);
          }
          return true;
        }
        out.failed.push({ rel, reason: res.reason });
        ledger.setState(rel, 'stuck', { reason: res.reason });
        return false;
      }

      case 'conflict-aside': {
        if (!remoteHash || !here) return false;
        const claim = claimedSize(row);
        if (!budget.take(claim)) {
          out.budgetExhausted = true;
          return false;
        }
        // PARK FIRST. If the copy does not land, the overwrite is refused —
        // DDR-102's fail-closed rule, applied to files: a loser we cannot
        // recover is a loser we must not create.
        const copyRel = parkLocal(rel);
        if (copyRel === null) {
          out.failed.push({ rel, reason: 'could not park the local copy — refusing to overwrite' });
          ledger.setState(rel, 'stuck', {
            reason: 'both sides changed this file and the local copy could not be parked',
          });
          return false;
        }
        const got = await fetchVerified(rel, remoteHash, budget.remaining() + claim);
        if (!got.ok) {
          out.failed.push({ rel, reason: got.reason });
          if (got.overCap && budget.remaining() + claim < MAX_FILE_BYTES) {
            out.budgetExhausted = true;
          }
          return false;
        }
        if (!chargeOverrun(budget, rel, got.size, claim, out)) return false;
        const landed = await ledger.adoptAfter(rel, remoteHash, () => materialize(rel, got), {
          ...(row ? { remoteSeq: row.seq } : {}),
          state: 'conflict',
        });
        if (!landed) {
          out.failed.push({ rel, reason: 'could not materialize the hub copy' });
          return false;
        }
        restat(rel);
        ledger.setState(rel, 'conflict', {
          reason: 'both sides changed this file; your version is beside it',
          conflictCopy: copyRel,
        });
        out.conflicts.push({ rel, copy: copyRel });
        // The copy travels too, so BOTH ends see the conflict rather than only
        // the machine that happened to lose.
        const copyLocal = statLocal(copyRel);
        if (copyLocal) {
          const res = await push(copyLocal, null);
          if (res.ok) out.pushed.push(copyRel);
        }
        return true;
      }

      case 'quarantine': {
        // The hub deleted a file this machine still holds UNCHANGED. Quarantine
        // rather than unlink: `_trash/` is the recoverability spine, and it is
        // runtime state (DDR-115), so one person's delete never replicates as
        // everyone's copy of the deleted file.
        const parked = quarantineLocal(rel);
        if (parked === null) {
          // PARK FIRST, the same fail-closed rule the conflict path follows: a
          // loser we cannot recover is a loser we must not create. Reporting a
          // delete here and forgetting the row would also resurrect the file
          // on the next pass, because with no ancestor it reads as brand new.
          out.failed.push({ rel, reason: 'could not quarantine — refusing to delete' });
          ledger.setState(rel, 'stuck', {
            reason:
              'the project deleted this file and it could not be moved to _trash/, so it was kept',
          });
          return false;
        }
        ledger.forget(rel);
        out.deleted.push({ rel, parked });
        return true;
      }

      case 'propagate-delete': {
        // Gone here, and the hub still holds exactly what we last reconciled —
        // the Syncthing rule. The CAS carries our ancestor, so an edit that
        // landed in between wins and this comes back as a conflict instead.
        const res = await pushDelete(rel, ledger.ancestorOf(rel));
        if (res.ok) {
          ledger.forget(rel);
          out.deleted.push({ rel, parked: null });
          return true;
        }
        if ('conflict' in res && res.conflict) {
          // Somebody edited it after we last saw it. Say nothing further; the
          // next pass reads their row and `local-deleted-but-remote-moved`
          // brings the file back.
          ledger.setState(rel, 'stuck', {
            reason: 'deleted here, but somebody changed it on the hub — their edit wins',
          });
          return false;
        }
        out.failed.push({ rel, reason: 'reason' in res ? res.reason : 'delete refused' });
        return false;
      }

      default: {
        const never: never = decision.action;
        throw new Error(`file-plane: unhandled action ${String(never)}`);
      }
    }
  }

  function restat(rel: string): void {
    try {
      const st = statSync(path.join(designRoot, rel));
      const row = ledger.row(rel);
      if (row?.syncedHash) ledger.noteLocal(rel, row.syncedHash, st.size, st.mtimeMs);
    } catch {
      /* the next pass re-hashes it */
    }
  }

  function statLocal(rel: string): SyncableLocalFile | null {
    const abs = path.join(designRoot, rel);
    try {
      const st = statSync(abs);
      const hash = sha256(readFileSync(abs));
      return { rel, abs, hash, size: st.size, mtimeMs: st.mtimeMs, cls: 'inert-media' };
    } catch {
      return null;
    }
  }

  return {
    reconcile,
    doruceka() {
      // BOUNDED, ACTIONABLE-FIRST. This used to return one entry per ledger
      // row — 2 961 keys for a real project — and `status.ts` re-serialized the
      // whole object into `_sync.json` and every open tab on EVERY status
      // change. The cap only ever drops the healthy tail, so the row a person
      // is looking for is the one that survives. Same shape as
      // `items`/`itemsTruncated`, whose lesson this lane skipped.
      const all = Object.entries(ledger.rows()).map(
        ([rel, row]) => [rel, row.state ?? 'local-only'] as const
      );
      all.sort((a, b) => deliveryRank(a[1]) - deliveryRank(b[1]));
      const out: Record<string, DeliveryState> = {};
      for (const [rel, state] of all.slice(0, MAX_DORUCEKA_ROWS)) out[rel] = state;
      return out;
    },
    dorucekaTotal() {
      return Object.keys(ledger.rows()).length;
    },
  };
}

function drop(out: FilePlaneResult, rel: string, reason: string, ledger?: FileLedger): void {
  out.dropped.push({ rel, reason });
  // Only for a path this machine actually tracks. A path we have never held
  // and will never accept is not "stuck" — it is not ours, and minting a row
  // to say so is how a hostile page turned one response into permanent state.
  if (ledger && !ledger.row(rel)) return;
  // A REFUSAL OUTRANKS EVERYTHING (DDR-214, applied to files). A path this
  // peer declines is not "local-only" — it is not here at all, and never will
  // be until something changes. Letting it fall through to the default state
  // would put a file in the panel's ordinary column that is in fact being
  // actively refused, which is the shape of "we didn't know it was stuck".
  ledger?.setState(rel, 'stuck', { reason });
}

function holdOversized(out: FilePlaneResult, ledger: FileLedger, file: OversizedLocalFile): void {
  const mb = (n: number) => Math.round(n / (1024 * 1024));
  const reason = `too big to sync — ${mb(file.size)} MB is over the ${mb(MAX_FILE_BYTES)} MB limit`;
  out.dropped.push({ rel: file.rel, reason });
  const row = ledger.row(file.rel);
  // Unchanged rows stay unwritten: this runs every pass for as long as the
  // file stays too big, and the ledger flushes on every setState.
  if (row?.state === 'refused' && row.blockedClass === 'too-large' && row.reason === reason) return;
  ledger.setState(file.rel, 'refused', { reason, blockedClass: 'too-large' });
}

/** `assets/<name>` referenced anywhere in the tree — the priority front-queue. */
function referencedAssetNames(designRoot: string): Set<string> {
  const out = new Set<string>();
  const RE = /assets\/([A-Za-z0-9._-]+\.[A-Za-z0-9]+)/g;
  const SCANNED = /\.(?:annotations\.svg|tsx|jsx|css|meta\.json)$/i;
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'assets') continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!SCANNED.test(entry.name)) continue;
      try {
        for (const m of readFileSync(abs, 'utf8').matchAll(RE)) {
          if (m[1]) out.add(m[1]);
        }
      } catch {
        /* unreadable is not referenced */
      }
    }
  };
  walk(designRoot, 1);
  return out;
}

/** 0 = a referenced asset (front of the queue), 1 = everything else. */
function rank(rel: string, referenced: Set<string>): number {
  const slash = rel.lastIndexOf('/');
  const base = slash === -1 ? rel : rel.slice(slash + 1);
  return referenced.has(base) ? 0 : 1;
}
