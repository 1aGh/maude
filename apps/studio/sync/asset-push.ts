// THE LEGACY PUSH CLIENT — journal-less hubs only (Sync v2 Increment 5).
//
// On any hub that carries a journal, the file plane (`file-plane.ts`) is the
// one lane for every project file, both directions, and this module is never
// invoked (the capability probe in `sync/index.ts` decides the lane once per
// boot). What remains here is the compat client for self-hosted hubs that
// have not upgraded: the bounded, sequential, in-process push pass the pre-v2
// desktop ran. Retained AT LEAST TWO RELEASES after the burn-down (Open
// decision 4 of the journal arc) — delete it only against a compat matrix
// that says the window has closed.
//
// Original charter (still accurate for the hubs this serves) — DDR-217, the
// 2026-08-11 addendum, and the feature-sync-file-plane widening (binding
// decision maude/sync-two-plane-manifest-architecture):
//
// The sync lanes are text-only (`html`/`css`/`meta`/`syncMeta`), so a
// desktop-linked project's other files never reached the cell — first seen as
// grey boxes (binary assets), then as a whole design system that never
// arrived (the 103-file RCA). The desktop is the one peer that HAS the bytes
// and already holds an authenticated channel to the hub, so it pushes them.
//
// MEMBERSHIP IS THE CLASSIFIER'S (`file-membership.ts`) — the same positive
// enumeration the downward plane and the hub's own admission use: inert
// media, companion text (`brand.css`, `README.md`), and code modules
// (`_brand-css.ts`), with `canvas-owned` (the CRDT lanes') and `never`
// (config, runtime state, everything unclassified) excluded. The old
// assets-dir walk + binary-extension pair lived here; it is subsumed, not
// joined, by the classifier.
//
// TWO ROUTES REMAIN, split by PATH (`routeFor`):
//
//   1. TOP-LEVEL content-addressed uploads (`<designRoot>/assets/<sha8>.<ext>`)
//      — referenced by the `/assets/<key>` shortcut, served on the cloud from
//      the BUCKET proxy. Push → `PUT /assets/<key>` (bucket + checkout mirror).
//   2. EVERYTHING ELSE (DS assets, stylesheets, docs, shared modules) —
//      referenced by designRoot path, served from the CHECKOUT. Push →
//      `PUT /_asset-file/<designRoot-rel>` (classifier-gated on the hub too).
//
// Both are probe-first (skip what the cloud already holds) and streamed. The
// HUB's validation is the authoritative gate at each trust boundary; the
// filters here are the courtesy layer that keeps junk off the wire.

import { randomBytes } from 'node:crypto';
import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { type CanvasGroupLike, classifyProjectFile, isFilePlaneClass } from './file-membership.ts';
import { failureReason, retryAfterMs } from './retry-after.ts';

/** Max designRoot-relative depth (matches the classifier's 8-segment cap). */
const MAX_SEGMENTS = 8;

/** A 2 GB file in an assets dir is a mistake — don't move it silently. */
const MAX_PUSH_BYTES = 512 * 1024 * 1024;

export interface AssetPushResult {
  pushed: string[];
  skipped: number;
  failed: { key: string; reason: string }[];
  /**
   * The hub answered the upload `405`: it holds no checkout, so it cannot store media at all. The pass ended there —
   * the rest were never tried and are NOT failures (they stay on this Mac). `sync/media-gate.ts` stops further passes.
   */
  refused?: 'no-checkout';
}

/**
 * feature-sync-progress-modal — incremental asset-push progress, emitted onto
 * the sync bus so the Sync panel can show assets moving instead of a silent
 * gap between "canvases synced" and a log line at the end. Keys are LOCAL
 * designRoot-relative paths (never hub-supplied); `failures` is capped at
 * MAX_LISTED_FAILURES with `failedCount` carrying the true number.
 */
export interface AssetPushProgress {
  /** Total pushable assets found this boot. */
  total: number;
  /** Files settled so far (pushed + skipped + failed). */
  done: number;
  pushed: number;
  skipped: number;
  failedCount: number;
  /** First MAX_LISTED_FAILURES failures — enough to name the broken paths. */
  failures: { key: string; reason: string }[];
  /** The designRoot-relative path on the wire right now, null when finished. */
  active: string | null;
  /** True exactly once, on the final emit (also fires when total is 0). */
  finished: boolean;
  /** Set on the final emit when the hub has no media checkout (see `AssetPushResult.refused`). */
  refused?: 'no-checkout';
}

/** Cap on `failures` in a progress emit (same spirit as MAX_REJECTED_SLUGS —
 *  the payload reaches `_sync.json` + every open tab, so it stays bounded). */
export const MAX_LISTED_FAILURES = 20;

/** Total time ONE sweep may spend waiting out 429s. The paced retry exists to
 *  keep an un-upgraded hub livable, not to turn a boot into an hour-long
 *  background stall — past this, the remaining refusals fail fast and the
 *  next-boot backstop takes them. */
const MAX_SWEEP_BACKOFF_MS = 5 * 60_000;

/**
 * Every upload closes its connection. NOT an optimization — a correctness
 * requirement, learned the expensive way (2026-08-11, second pass).
 *
 * A peer that refuses a PUT **before reading the body** (the cloud studio door
 * answering 401, the edge answering 503) leaves unread request bytes in an
 * HTTP/1.1 keep-alive socket. The connection is then desynchronized: the next
 * request Bun sends over it NEVER gets a response. With no retry that stayed
 * invisible — the refusal was reported and the sweep moved on. The moment a
 * retry re-sent on that same pooled socket, the sweep wedged forever and the
 * dev-server sidecar died with it (Bun segfault, 4 crash-loops, alligators).
 * Measured: `connection: close` on the retry ALONE does not help (the retry is
 * handed the already-poisoned socket) — it has to be on the request that may be
 * refused, i.e. every PUT. One TLS handshake per asset against multi-MB bodies
 * is not a cost worth reasoning about.
 */
const UPLOAD_CONNECTION_HEADERS = { connection: 'close' } as const;

/**
 * THE PER-REQUEST TIME BUDGETS BELOW STAY — reviewed and kept, RCA step 3
 * (feature-sync-resync-and-out-of-process-sweep, Task 7).
 *
 * They were suspects: the crash reports went from `abort_signal(2)` to
 * `abort_signal(79)` in the same change that introduced them, which reads like
 * a cause. Two things settle it the other way.
 *
 * First, the count is what a bounded sweep LOOKS like — 79 in-flight budgets
 * over a 182-file sweep is one per request, not a leak. Second, the actual
 * fault was isolated elsewhere and fixed: an HTTP/1.1 keep-alive desync after a
 * peer refused a PUT before draining its body (see UPLOAD_CONNECTION_HEADERS).
 * That fix is also why this pass runs in-process again — the out-of-process
 * boundary (deleted in Increment 5) was protecting the editor from a transport
 * fault that no longer exists.
 *
 * Removing them would trade a suspicion for a certainty: a request with no
 * budget is how a sweep hangs forever with nothing to report — the exact
 * invisibility this whole feature exists to end. So they stay.
 */

/** HEAD is a small, bodyless probe — a hub that has not answered in 30 s is not
 *  about to. */
const HEAD_TIMEOUT_MS = 30_000;

/** The batch probe asks about a whole project at once, and the hub may have to
 *  reach the object store for a few hundred keys — but it is still one small
 *  request, so a minute is generous. */
const PROBE_TIMEOUT_MS = 60_000;

/**
 * How long one upload may take before the sweep abandons it: a fixed floor plus
 * an allowance for the bytes at a deliberately pessimistic 100 kB/s, capped.
 * The backstop for anything that wedges a connection the way the keep-alive
 * desync above did — a sweep that hangs forever takes the whole dev-server with
 * it, and "this asset failed, next boot retries it" is always the better end.
 */
export function putTimeoutMs(bytes: number): number {
  return Math.min(10 * 60_000, 60_000 + (Number.isFinite(bytes) ? bytes : 0) / 100);
}

/** Min ms between mid-flight progress emits. A 90-file DS at LAN speed would
 *  otherwise broadcast 90 payloads in a couple of seconds; failures and the
 *  final emit always go out regardless. */
const PROGRESS_INTERVAL_MS = 200;

/**
 * Canvas groups + the file-plane flag from `<designRoot>/config.json`. Read
 * here rather than threaded through the worker protocol: the sweep runs
 * out-of-process, and the config is the ONE source both processes share.
 */
function readProjectConfig(designRoot: string): {
  canvasGroups?: readonly CanvasGroupLike[];
  syncFiles: boolean;
} {
  let parsed: { canvasGroups?: unknown; linkedHub?: { syncFiles?: unknown } } | null = null;
  try {
    parsed = JSON.parse(readFileSync(path.join(designRoot, 'config.json'), 'utf8'));
  } catch {
    parsed = null;
  }
  return {
    canvasGroups: Array.isArray(parsed?.canvasGroups)
      ? (parsed.canvasGroups as CanvasGroupLike[])
      : undefined,
    // Default ON — mirrors `sync/index.ts`. Both read the same key and a drift
    // between them would mean the sweep and the plane disagree about which
    // files exist, which is the jurisdiction overlap Sync v2 exists to end.
    syncFiles:
      parsed?.linkedHub?.syncFiles !== false &&
      (process.env.MAUDE_SYNC_FILES !== '0' || parsed?.linkedHub?.syncFiles === true),
  };
}

/**
 * Would `listPushableAssets` have returned this designRoot-relative path?
 *
 * The cheap, no-disk half of the same rule, for deciding whether an `fs:any`
 * event is worth a sweep. Classifier-judged, with NO tree knowledge on
 * purpose: this is a scheduling hint, and the conservative direction is
 * answering true — a group `.css` whose sibling status is unknowable here
 * answers true and lets the sweep itself decide with the disk in hand. A
 * `false` means a file silently never uploads until the next boot, which is
 * the bug this predicate exists to end.
 */
export function isPushableAssetRel(
  rel: string,
  canvasGroups?: readonly CanvasGroupLike[]
): boolean {
  if (typeof rel !== 'string' || !rel) return false;
  const norm = rel.replace(/\\/g, '/');
  return isFilePlaneClass(classifyProjectFile(norm, { canvasGroups }));
}

/**
 * Every pushable project file under designRoot, as a designRoot-relative
 * path: the classifier's three flowing classes, judged against the walked
 * snapshot (so a canvas's sibling css is recognized as canvas-owned and
 * stays home). Skips runtime-state directories (`_*`), dotfiles,
 * `node_modules`; refuses oversized files. Missing root → [].
 */
export function listPushableAssets(
  designRoot: string,
  opts: { canvasGroups?: readonly CanvasGroupLike[]; syncFiles?: boolean } = {}
): string[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > MAX_SEGMENTS) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') || name === 'node_modules') continue;
      if (name.startsWith('_') && entry.isDirectory()) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        walk(path.join(dir, name), childRel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks stay home
      try {
        if (statSync(path.join(dir, name)).size > MAX_PUSH_BYTES) continue;
      } catch {
        continue;
      }
      found.push(childRel);
    }
  };
  walk(designRoot, '', 1);

  const cfg = readProjectConfig(designRoot);
  const syncFiles = opts.syncFiles ?? cfg.syncFiles;
  const fileSet = new Set(found);
  const clsOpts = {
    canvasGroups: opts.canvasGroups ?? cfg.canvasGroups,
    hasFile: (r: string) => fileSet.has(r),
  };
  return found
    .filter((rel) => {
      const cls = classifyProjectFile(rel, clsOpts);
      if (!isFilePlaneClass(cls)) return false;
      if (syncFiles) return true;
      // Flag OFF ⇒ today's DDR-217 lane, unchanged in reach: binary media
      // under some `assets/` directory. The file plane (companion text, code
      // modules, media outside assets/) waits for `linkedHub.syncFiles` /
      // MAUDE_SYNC_FILES=1 — the flag gates ONLY the new plane.
      return cls === 'inert-media' && rel.split('/').slice(0, -1).includes('assets');
    })
    .sort();
}

/** Where a given asset pushes: the bucket-backed route (top-level `assets/`) or
 *  the checkout route (a nested `…/assets/…` served from disk). */
function routeFor(rel: string): { url: string } {
  const parts = rel.split('/');
  if (parts[0] === 'assets') {
    // Top-level content-addressed → the bucket `/assets/<key>` route.
    return { url: `/assets/${parts.slice(1).join('/')}` };
  }
  // DS / brand asset served from the checkout → the checkout-file route, keyed
  // by its FULL designRoot-relative path.
  return { url: `/_asset-file/${rel.split('/').map(encodeURIComponent).join('/')}` };
}

/**
 * Ask the hub, in ONE request, which of these it already holds — or null when
 * this hub cannot answer (then the caller falls back to per-file probes).
 *
 * WHY THIS EXISTS (RCA 2026-08-11 part 2). The sweep used to ask per file with
 * `HEAD`, and on a Cloud cell a HEAD never arrives as a HEAD — it is converted
 * to GET before it reaches the hub. So the DS half's probe answered `405` and
 * the sweep re-uploaded that project's ENTIRE asset set on every boot, while
 * the bucket half's converted probe took the hub's GET branch and pulled whole
 * objects out of R2 to answer an existence question. `POST` survives the trip,
 * and one request replaces N.
 *
 * A hub that does not know this route answers 404/405 — that is NOT "it holds
 * nothing", it is "ask the old way", so it returns null rather than an empty
 * set. Getting that backwards would skip every upload against every hub older
 * than this change.
 */
async function probePresent(ctx: {
  fetchImpl: typeof fetch;
  base: string;
  headers: Record<string, string>;
  paths: string[];
}): Promise<Set<string> | null> {
  try {
    const res = await ctx.fetchImpl(`${ctx.base}/_asset-probe`, {
      method: 'POST',
      headers: { ...ctx.headers, 'content-type': 'application/json' },
      // S8.19 (contract S8-S9-asset-presence §5.2): the sweep's one batch is
      // also "this Mac holds these, and this sweep is done" — the hub's asset
      // presence store learns who holds what. Optional fields: a hub that
      // predates them ignores them and answers exactly as before.
      body: JSON.stringify({
        paths: ctx.paths,
        held: true,
        sweep: { id: `s${Date.now().toString(36)}${randomBytes(6).toString('hex')}`, final: true },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { present?: unknown };
    // Hub-supplied (DDR-054): keep only strings we actually asked about, so a
    // malformed or hostile answer can never make us skip a file we never named.
    if (!Array.isArray(data?.present)) return null;
    const asked = new Set(ctx.paths);
    return new Set(data.present.filter((p): p is string => typeof p === 'string' && asked.has(p)));
  } catch {
    return null;
  }
}

/**
 * One upload, with the two retries that are worth having in-boot.
 *
 * 429 — the hub tells us when to come back (`Retry-After`), so come back then,
 * ONCE. Before the 2026-08-11 fix the write lane sat in a 5/min per-IP bucket
 * and the sweep ignored the header entirely, so a 182-asset project burned the
 * window and moved ~5 files per boot. The hub half of the fix is the real
 * one — this half is what keeps a not-yet-upgraded hub (the fleet rolls only on
 * a release tag) finishing a sweep instead of grinding.
 *
 * 5xx — one immediate retry, because a transient edge/proxy hiccup on a 30 MB
 * body should not need a whole new boot to get past.
 *
 * A second refusal is a real failure: report it and move on (the next-boot
 * backstop is unchanged).
 */
async function putWithRetry(ctx: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  file: string;
  sleep: (ms: number) => Promise<void>;
  /** Mutable per-sweep pause budget, shared across every asset. */
  backoff: { remainingMs: number };
  timeoutFor: (bytes: number) => number;
}): Promise<Response> {
  const send = (): Promise<Response> => {
    const body = Bun.file(ctx.file);
    return ctx.fetchImpl(ctx.url, {
      method: 'PUT',
      headers: {
        ...ctx.headers,
        ...UPLOAD_CONNECTION_HEADERS,
        // Bun derives this from the file anyway (measured) — stated explicitly
        // so a body length is never something a future body type has to guess.
        'content-length': String(body.size),
      },
      body,
      signal: AbortSignal.timeout(ctx.timeoutFor(body.size)),
    });
  };
  const first = await send();
  if (first.status === 429) {
    const wait = retryAfterMs(first.headers?.get?.('retry-after') ?? null);
    if (wait > ctx.backoff.remainingMs) return first;
    ctx.backoff.remainingMs -= wait;
    await ctx.sleep(wait);
    return send();
  }
  if (first.status >= 500) return send();
  return first;
}

/**
 * Mirror local assets up to the hub. Idempotent and skip-first (one HEAD per
 * asset per boot; upload only on a miss), sequential on purpose — assets run
 * to videos, and saturating the link a fresh sync is also using would starve
 * the handshakes this rides behind. Never throws; a failed upload is retried
 * for free on the next boot.
 */
export async function pushAssets(opts: {
  designRoot: string;
  hubUrl: string;
  /** Read at call time — silent renewal swaps the credential in place. */
  token: () => string;
  /** Declared canvas groups; absent ⇒ read from `<designRoot>/config.json`
   *  (the out-of-process worker's path — see `readProjectConfig`). */
  canvasGroups?: readonly CanvasGroupLike[];
  /** The file-plane flag; absent ⇒ read from config/env the same way. */
  syncFiles?: boolean;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'log' | 'warn'>;
  /** feature-sync-progress-modal — incremental progress (throttled; failures
   *  and the final emit always fire). Never throws into the push loop. */
  onProgress?: (progress: AssetPushProgress) => void;
  /** Injectable clock for the throttle (tests). */
  now?: () => number;
  /** Asked before every upload — true abandons the rest of the pass (the Sync
   *  panel's cancel; a multi-hundred-MB upload must be killable). The final
   *  progress emit still fires, so the panel never freezes mid-count. */
  cancelled?: () => boolean;
  /** Injectable pause for the 429 backoff (tests — a fake clock, not a wait). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable per-request time budget (tests — seconds, not minutes). */
  timeoutFor?: (bytes: number) => number;
}): Promise<AssetPushResult> {
  const { designRoot, hubUrl } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console;
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ??
    ((ms: number) =>
      new Promise<void>((res) => {
        setTimeout(res, ms);
      }));
  const timeoutFor = opts.timeoutFor ?? putTimeoutMs;
  // Shared across the whole sweep — see MAX_SWEEP_BACKOFF_MS.
  const backoff = { remainingMs: MAX_SWEEP_BACKOFF_MS };
  const base = hubUrl.replace(/\/+$/, '');
  const out: AssetPushResult = { pushed: [], skipped: 0, failed: [] };

  const assets = listPushableAssets(designRoot, {
    canvasGroups: opts.canvasGroups,
    syncFiles: opts.syncFiles,
  });
  // -Infinity seeds the throttle open, so the first emit always passes.
  let lastEmit = -Infinity;
  const emitProgress = (active: string | null, finished: boolean, force = false): void => {
    if (!opts.onProgress) return;
    const t = now();
    if (!force && t - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = t;
    try {
      opts.onProgress({
        total: assets.length,
        done: out.pushed.length + out.skipped + out.failed.length,
        pushed: out.pushed.length,
        skipped: out.skipped,
        failedCount: out.failed.length,
        failures: out.failed.slice(0, MAX_LISTED_FAILURES),
        active,
        finished,
        ...(out.refused ? { refused: out.refused } : {}),
      });
    } catch {
      /* a broken listener must never break the push */
    }
  };

  // One question for the whole set, when the hub can answer it. Null = this hub
  // predates the route, so every file falls back to its own probe below.
  const known =
    assets.length > 0
      ? await probePresent({
          fetchImpl,
          base,
          headers: { authorization: `Bearer ${opts.token()}` },
          paths: assets,
        })
      : null;

  for (const rel of assets) {
    if (opts.cancelled?.()) break;
    emitProgress(rel, false);
    const url = `${base}${routeFor(rel).url}`;
    const headers = { authorization: `Bearer ${opts.token()}` };
    if (known) {
      if (known.has(rel)) {
        out.skipped += 1;
        continue;
      }
      // The batch answered, and it said this one is missing — no per-file probe
      // can add anything, so go straight to the upload.
    }
    try {
      const head = known
        ? null
        : await fetchImpl(url, {
            method: 'HEAD',
            headers,
            signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
          });
      if (head?.ok) {
        out.skipped += 1;
        continue;
      }
      // A hub that refuses the PROBE refuses the upload — pushing the body
      // anyway just streams megabytes at a door that already said no. The
      // cloud studio door answers exactly this for a route the deployed hub
      // does not have yet, once per asset, for the whole DS asset set.
      //
      // Only 401/403 mean that. Every OTHER refusal — notably the 405 a cell
      // returns when it turned our HEAD into a GET — means "I cannot answer",
      // NOT "I do not have it", so it falls through to the upload rather than
      // being read as a refusal.
      if (head && (head.status === 401 || head.status === 403)) {
        out.failed.push({ key: rel, reason: await failureReason(head) });
        emitProgress(rel, false, true);
        continue;
      }
      const put = await putWithRetry({
        fetchImpl,
        url,
        headers,
        file: path.join(designRoot, rel),
        sleep,
        backoff,
        timeoutFor,
      });
      if (put.ok) out.pushed.push(rel);
      else if (put.status === 405) {
        // `this hub does not accept file writes`: no checkout, so no file can ever land here. Stop the pass — the
        // next file would get the same answer — and say it is not a failure; the media stays on this Mac.
        out.refused = 'no-checkout';
        break;
      } else {
        out.failed.push({ key: rel, reason: await failureReason(put) });
        emitProgress(rel, false, true);
      }
    } catch (err) {
      const e = err as Error;
      out.failed.push({
        key: rel,
        // "TimeoutError: The operation timed out" tells a person nothing about
        // which limit fired; name the budget instead.
        reason: e.name === 'TimeoutError' ? 'timed out — the hub stopped answering' : e.message,
      });
      emitProgress(rel, false, true);
    }
  }
  // No assets → no emits at all: a project without an assets/ dir should not
  // grow an empty assets section in its Sync panel.
  if (assets.length > 0) emitProgress(null, true, true);

  if (out.pushed.length > 0) {
    log.log?.(
      `[sync/assets] pushed ${out.pushed.length} asset(s) to ${base} (${out.skipped} already there)`
    );
  }
  if (out.failed.length > 0) {
    log.warn?.(
      `[sync/assets] ${out.failed.length} asset(s) did not reach ${base} (retried next boot): ${out.failed
        .slice(0, 3)
        .map((f) => `${f.key} — ${f.reason}`)
        .join('; ')}`
    );
  }
  return out;
}
