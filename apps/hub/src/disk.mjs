// Free-space awareness for the hub's disk — cell materializer Phase 0.
//
// A cloud cell's disk is 8 GB, ephemeral, and until this module nothing in the
// hub ever asked how full it was. Brno Alligators (2026-10-01) syncs ~7.8 GB,
// so boot hydrate + desktop pushes filled the disk, the first ENOSPC surfaced
// as an unhandled rejection, the process exited, the container cold-started,
// and the loop began again — 14 → 4 → 5 min uptimes, files churning in and
// out of the checkout each round.
//
// Three consumers, one answer:
//   • every write door refuses with 503 + Retry-After below the floor
//     (`diskPressureRefusal`) — the desktop reads that as backpressure, never
//     as a conflict (apps/studio/sync/retry-after.ts `isBackpressure`);
//   • boot hydrate stops at the floor instead of driving into it;
//   • `/health` reports it, so the operator sees pressure before the crash.
//
// 503, NOT 507: 507 is the hourly write-quota word and has its own UX on the
// desktop ("upload allowance used up"). A full disk is a hold, not a quota.

import { statfsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';

const GiB = 1024 * 1024 * 1024;

/** The floor never sits below this — a disk this small has no room for a
 *  git index rewrite, a SQLite WAL checkpoint and one more upload part. */
const MIN_FLOOR_BYTES = 1 * GiB;

/** …nor below this share of the disk… */
const FLOOR_FRACTION = 0.12;

/** …but the share stops growing here. A percentage floor is right for an 8 GB
 *  cell (where the 1 GiB minimum wins anyway) and absurd for a self-hosted
 *  hub or a laptop: 12 % of a 460 GB disk is a 55 GB floor that refused every
 *  write with 40 GB free. Room for the next write is an absolute amount. */
const MAX_FRACTION_FLOOR_BYTES = 4 * GiB;

/** How long one `statfs` answer is reused. Writes arrive in bursts (a desktop
 *  pushing 300 photos), and a syscall per request is cheap but not free; two
 *  seconds is shorter than any upload that could fill the gap. */
const CACHE_MS = 2_000;

/** `Retry-After` on a disk-pressure refusal. Long enough for a write-behind
 *  pass or an eviction to free space; the desktop clamps it anyway. */
export const DISK_PRESSURE_RETRY_AFTER_S = 120;

/** dir → { at, value } */
const cache = new Map();

/** Test seam: replace the `statfs` call. `null` restores the real one. */
let statfsImpl = null;
export function setStatfsForTests(fn) {
  statfsImpl = fn;
  cache.clear();
}

/**
 * The floor, in bytes, for a disk of `totalBytes`: max(1 GiB, min(12 %, 4 GiB)).
 *
 * `MAUDE_DISK_FLOOR_BYTES` overrides it outright — the E2E harness uses it to
 * make a small fixture look like an over-full disk, and an operator can use it
 * to buy room in an incident without a rebuild.
 */
export function floorBytes(env = process.env, totalBytes = 0) {
  const set = String(env.MAUDE_DISK_FLOOR_BYTES ?? '').trim();
  const raw = Number(set);
  if (set !== '' && Number.isFinite(raw) && raw >= 0) return Math.trunc(raw);
  return Math.max(
    MIN_FLOOR_BYTES,
    Math.min(MAX_FRACTION_FLOOR_BYTES, Math.floor(totalBytes * FLOOR_FRACTION))
  );
}

/**
 * `{ totalBytes, freeBytes }` for the filesystem holding `dir`, or null when it
 * cannot be read (a missing dir, a platform without statfs).
 *
 * Free means AVAILABLE TO US (`bavail`), not free on the device (`bfree`) —
 * the root-reserved blocks are not ours to fill.
 */
export async function diskStatus(dir, now = Date.now(), { fresh = false } = {}) {
  if (!dir) return null;
  const hit = cache.get(dir);
  if (!fresh && hit && now - hit.at < CACHE_MS) return hit.value;
  let value = null;
  try {
    const s = await (statfsImpl ?? statfs)(dir);
    const bsize = Number(s.bsize);
    value = {
      totalBytes: bsize * Number(s.blocks),
      freeBytes: bsize * Number(s.bavail),
    };
  } catch {
    value = null;
  }
  cache.set(dir, { at: now, value });
  return value;
}

/** The synchronous twin of `diskStatus`, sharing its cache — for `/health`,
 *  whose payload builder is synchronous. Ignores the async test seam. */
export function diskStatusSync(dir, now = Date.now()) {
  if (!dir) return null;
  const hit = cache.get(dir);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  let value = null;
  try {
    const s = statfsSync(dir);
    value = {
      totalBytes: Number(s.bsize) * Number(s.blocks),
      freeBytes: Number(s.bsize) * Number(s.bavail),
    };
  } catch {
    value = null;
  }
  cache.set(dir, { at: now, value });
  return value;
}

/** `diskReport`, synchronously (see `diskStatusSync`). */
export function diskReportSync(dir, env = process.env) {
  const st = diskStatusSync(dir);
  if (!st) return null;
  const floor = floorBytes(env, st.totalBytes);
  return { ...st, floorBytes: floor, pressure: st.freeBytes < floor };
}

/**
 * The whole picture for `/health` and the gates.
 *
 * An unreadable disk is NOT pressure: refusing every write because a syscall
 * failed would turn a monitoring gap into an outage.
 */
export async function diskReport(dir, env = process.env, { fresh = false } = {}) {
  // `fresh` bypasses the 2 s cache — the boot hydrate asks between downloads
  // of up to 2 GiB each, and a stale answer admits several of them at once.
  const st = await diskStatus(dir, Date.now(), { fresh });
  if (!st) return null;
  const floor = floorBytes(env, st.totalBytes);
  return { ...st, floorBytes: floor, pressure: st.freeBytes < floor };
}

export async function underPressure(dir, env = process.env) {
  return (await diskReport(dir, env))?.pressure === true;
}

/**
 * The write doors' gate. Null when the write may proceed; otherwise the body
 * of the refusal. Asked BEFORE the body is read — a gate after the body is
 * ENOSPC with extra steps.
 */
export async function diskPressureRefusal(dir, env = process.env) {
  const r = await diskReport(dir, env);
  if (!r?.pressure) return null;
  return { error: 'disk-pressure', freeBytes: r.freeBytes, floorBytes: r.floorBytes };
}

/** Answer a disk-pressure refusal: 503 + Retry-After, the backpressure word. */
export function respondDiskPressure(response, refusal) {
  const body = JSON.stringify(refusal);
  response
    .writeHead(503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
      'Retry-After': String(DISK_PRESSURE_RETRY_AFTER_S),
      Connection: 'close',
    })
    .end(body);
}

/**
 * Error codes that mean "the disk is FULL", not "the program is wrong".
 *
 * EIO is deliberately NOT here (the plan listed it; both Phase 0 security
 * reviews refused it). A full disk answers honestly — the write did not
 * happen. EIO means the disk gave a WRONG or failed answer, and the
 * write-behind re-reads checkout bytes to mirror them: surviving EIO is how a
 * transient fault becomes the durable copy in the bucket. It restarts the cell.
 */
const DISK_CODES = new Set(['ENOSPC', 'EDQUOT']);

export function isDiskError(err) {
  return Boolean(err && typeof err === 'object' && DISK_CODES.has(err.code));
}

/**
 * Process-level crash handlers. Installed by `runAsMain` only — tests import
 * `createHub` and must keep node:test's own handling.
 *
 * A DISK-FULL error escaping some fire-and-forget promise (a hydrate, a mirror, a
 * git write) used to exit the process, and on a cell an exit is a cold start
 * that re-runs the same hydrate into the same full disk. So those are logged
 * loudly, flagged as degraded on `/health`, and the hub keeps serving.
 *
 * EVERYTHING ELSE still exits — a corrupt-state error must restart the cell,
 * and swallowing it would trade a restart for silent wrong answers. What
 * changes is that it is logged first, with its stack.
 */
export function installCrashHandlers({
  proc = process,
  log = console,
  onDiskError = () => {},
  exit = (code) => proc.exit(code),
} = {}) {
  const handle = (kind) => (err) => {
    if (isDiskError(err)) {
      log.error?.(
        `[hub] DISK ${err.code} escaped as an ${kind}: ${err.message} — serving degraded, not exiting.`
      );
      try {
        onDiskError(err);
      } catch {
        /* the flag is best-effort; staying up is the point */
      }
      return;
    }
    log.error?.(`[hub] fatal ${kind}: ${err?.stack ?? err}`);
    exit(1);
  };
  proc.on('unhandledRejection', handle('unhandledRejection'));
  proc.on('uncaughtException', handle('uncaughtException'));
}
