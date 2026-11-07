// The project owner's confirmed bulk purge — 2.0.7 #8.
//
//   POST /api/file-purge  { prefix | paths, dryRun: true }
//     → { ok, dryRun, count, bytes, sample, missing, confirm, expiresAt, batchSize }
//   POST /api/file-purge  { prefix | paths, confirm }
//     → { ok, purged, purgedBytes, remaining, done, trash, retryAfterMs }
//
// The file door's DELETE holds every caller to a window budget (journal.mjs):
// the member one, or the owner's own, higher one. A deletion past it is not an
// accident shape any more — it is a decision, so it gets a decision's shape:
//
//   1. a DRY RUN resolves the set (an explicit list, or every live file under a
//      folder prefix), lists it — count, bytes, sample paths — and hands back a
//      one-off confirmation bound to that exact set (path + hash of every file),
//      to the credential that asked, for a short time;
//   2. each CONFIRM re-resolves the set and refuses (and spends the
//      confirmation) unless it is still exactly what the owner saw, less what
//      this purge already removed; then deletes one bounded batch through the
//      door's own delete steps (`deleteCheckoutFile`): CAS against the hash the
//      owner saw, quarantine under ONE `_trash/<stamp>/` folder, a journaled
//      `owner-purge` tombstone. Batches are paced (`retryAfterMs`).
//
// The window budget is not asked for a confirmed file — that is the point — but
// nothing else is skipped, and the R2 tail replay still counts every tombstone.
//
// Who: the project OWNER only (the `delete` capability on the row, then
// `who.owner` — `isProjectOwnerMatch` — in the handler; a member, a viewer, a
// canvas-scoped token and a canvas-only session are refused). Where: the main
// origin only — a `project` row with no canvas door, so the canvas host's row
// (which carries no handler) never reaches it. Bearer-authenticated, so a
// browser cannot be made to send it (no ambient cookie). Every step is
// appended to `<dataDir>/purge-audit.jsonl` (0600).

import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { currentHashFor, deleteCheckoutFile, trashStampNow } from './file-door.mjs';
import { sha256File } from './file-limits.mjs';
import { resolveCheckoutFileWrite } from './file-manifest.mjs';
import { sanitizeForLog } from './log-safety.mjs';

export const PURGE_PATH = '/api/file-purge';
/** Files one confirm call deletes, at most. */
export const PURGE_BATCH = 100;
/** The pause the hub asks for between two batches of one purge. */
export const PURGE_BATCH_INTERVAL_MS = 1000;
/** How long a dry run's confirmation stays good. */
export const PURGE_PLAN_TTL_MS = 15 * 60 * 1000;
/** The most files one purge names — the file walk's own cap. */
export const MAX_PURGE_FILES = 20_000;
/** Paths shown in a dry run's sample. */
const SAMPLE = 20;
/** An explicit list of MAX_PURGE_FILES paths fits. */
const MAX_BODY = 4 * 1024 * 1024;

/** confirm-hash → plan. In memory on purpose: a restart spends every confirmation. */
const plans = new Map();
/** Live plans kept at once; a new dry run past it drops the oldest (memory stays bounded). */
const MAX_PLANS = 4;

/** Test seam: forget every plan. */
export function resetPurgePlans() {
  plans.clear();
}

const digest = (text) => createHash('sha256').update(text).digest('hex');

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) return { tooLarge: true };
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return { body: {} };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: null };
  }
}

/**
 * The set a request names, normalized: `{ kind: 'prefix', prefix }` or
 * `{ kind: 'paths', paths }` (sorted, unique). `null` when it names neither, both,
 * or something no purge may name (runtime state, a parent segment, the root).
 */
export function normalizeSpec(body) {
  const hasPrefix = typeof body?.prefix === 'string';
  const hasPaths = Array.isArray(body?.paths);
  if (hasPrefix === hasPaths) return null;
  if (hasPrefix) {
    const prefix = body.prefix;
    if (prefix.length === 0 || prefix.length > 512 || !isPlainRel(prefix)) return null;
    return { kind: 'prefix', prefix };
  }
  if (body.paths.length === 0 || body.paths.length > MAX_PURGE_FILES) return null;
  if (!body.paths.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 1024)) {
    return null;
  }
  if (!body.paths.every(isPlainRel)) return null;
  return { kind: 'paths', paths: [...new Set(body.paths)].sort() };
}

/** A design-root-relative path: no leading `/`, no `.`/`..`/empty inner segment, no `_*` first segment. */
function isPlainRel(rel) {
  if (rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) return false;
  const segments = rel.split('/');
  if (segments[0].startsWith('_') || segments[0].startsWith('.')) return false;
  // A trailing '/' (a folder prefix) leaves one empty LAST segment; nothing else may be empty.
  return segments.every(
    (s, i) => s !== '.' && s !== '..' && (s.length > 0 || i === segments.length - 1)
  );
}

/**
 * Resolve a spec against the hub's journal + checkout: the live files it names,
 * each with the hash the hub holds now. Sorted by path.
 *
 * @returns {{ entries: Array<{ path: string, sha256: string, size: number }>, missing: string[], tooMany?: true }}
 */
export function resolvePurgeSet({ journal, designRoot }, spec) {
  const entries = new Map();
  const missing = [];
  const consider = (rel, knownSha = null, knownSize = null) => {
    const target = resolveCheckoutFileWrite(designRoot, rel);
    if (!target.ok) {
      missing.push(rel);
      return;
    }
    const landing = target.realRel;
    const onDisk = existsSync(target.abs);
    const sha =
      knownSha ?? currentHashFor(journal, landing) ?? (onDisk ? hashOrNull(target.abs) : null);
    if (!sha) {
      missing.push(rel);
      return;
    }
    let size = knownSize;
    if (typeof size !== 'number') size = journal.latestFor(landing)?.size ?? null;
    if (typeof size !== 'number') size = onDisk ? statSync(target.abs).size : 0;
    entries.set(landing, { path: landing, sha256: sha, size });
  };
  if (spec.kind === 'paths') {
    for (const rel of spec.paths) consider(rel);
  } else {
    // A prefix names what the hub's journal holds live under it — the set every
    // peer syncs. A file on disk the journal has not met yet is named by path.
    for (const row of journal.compaction()) {
      if (row.deleted || !row.sha256 || !row.path.startsWith(spec.prefix)) continue;
      if (entries.size >= MAX_PURGE_FILES) return { entries: [], missing, tooMany: true };
      consider(row.path, row.sha256, row.size);
    }
  }
  if (entries.size > MAX_PURGE_FILES) return { entries: [], missing, tooMany: true };
  return {
    entries: [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
    missing,
  };
}

function hashOrNull(abs) {
  try {
    return sha256File(abs);
  } catch {
    return null;
  }
}

function audit(dataDir, line) {
  const record = { at: new Date().toISOString(), ...line };
  console.log(`[hub] owner purge ${sanitizeForLog(JSON.stringify(record))}`);
  if (!dataDir) return;
  const file = join(dataDir, 'purge-audit.jsonl');
  try {
    appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch (err) {
    console.error(`[hub] owner purge audit write failed: ${err.message}`);
  }
}

/** The handler. `deps.auth(request)` → who; `deps.purge()` → the checkout's doors. */
export async function handleOwnerPurge(ctx) {
  const { request, method, respondJson, deps } = ctx;
  if (method !== 'POST') {
    respondJson(405, { ok: false, code: 'method' });
    return true;
  }
  // The table never routes the canvas host here; a handler that is somehow
  // reached from it still refuses (DDR-054: a privileged write is in neither
  // canvas allowlist).
  if (ctx.canvasHost) {
    respondJson(404, { ok: false, code: 'not-found' });
    return true;
  }
  const who = deps?.auth?.(request);
  if (!who) {
    respondJson(401, { ok: false, code: 'unauthenticated' });
    return true;
  }
  if (who.access?.canvasOnly === true) {
    respondJson(403, { ok: false, error: 'not-in-scope', reason: 'not-in-scope' });
    return true;
  }
  if (!who.owner || who.readOnly) {
    respondJson(403, {
      ok: false,
      code: 'forbidden',
      error: 'only the project owner can purge files',
    });
    return true;
  }
  const doors = deps?.purge?.();
  if (!doors?.journal || !doors.designRoot) {
    respondJson(405, { ok: false, code: 'unavailable', error: 'this hub does not hold files' });
    return true;
  }
  const now = doors.now ?? Date.now;
  const interval = doors.batchIntervalMs ?? PURGE_BATCH_INTERVAL_MS;

  const { body, tooLarge } = await readJson(request);
  if (tooLarge) {
    respondJson(413, { ok: false, code: 'too-large' });
    return true;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    respondJson(400, { ok: false, code: 'invalid' });
    return true;
  }
  const spec = normalizeSpec(body);
  if (!spec) {
    respondJson(400, {
      ok: false,
      code: 'invalid',
      error: 'name a folder prefix or a list of paths (not runtime state, not the whole project)',
    });
    return true;
  }
  const specDigest = digest(JSON.stringify(spec));

  if (typeof body.confirm !== 'string' || body.confirm.length === 0) {
    return dryRun({ respondJson, doors, who, spec, specDigest, now, interval });
  }
  return confirm({ respondJson, doors, who, spec, specDigest, now, interval, token: body.confirm });
}

function dryRun({ respondJson, doors, who, spec, specDigest, now, interval }) {
  const set = resolvePurgeSet(doors, spec);
  if (set.tooMany) {
    respondJson(413, {
      ok: false,
      code: 'too-many',
      error: `a purge names at most ${MAX_PURGE_FILES} files — split it`,
    });
    return true;
  }
  const bytes = set.entries.reduce((n, e) => n + (e.size ?? 0), 0);
  const base = {
    ok: true,
    dryRun: true,
    count: set.entries.length,
    bytes,
    sample: set.entries.slice(0, SAMPLE).map((e) => e.path),
    missing: set.missing.length,
    missingSample: set.missing.slice(0, SAMPLE),
    batchSize: PURGE_BATCH,
  };
  if (set.entries.length === 0) {
    respondJson(200, base);
    return true;
  }
  const token = randomBytes(32).toString('base64url');
  const id = digest(token);
  const at = now();
  for (const [key, old] of plans) if (old.expiresAt <= at) plans.delete(key);
  while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value);
  plans.set(id, {
    actor: who.actor,
    specDigest,
    remaining: new Map(set.entries.map((e) => [e.path, e])),
    expiresAt: at + PURGE_PLAN_TTL_MS,
    lastBatchAt: null,
    inFlight: false,
    trashStamp: trashStampNow(new Date()),
  });
  audit(doors.dataDir, {
    event: 'purge-plan',
    actor: who.actor,
    plan: id.slice(0, 12),
    kind: spec.kind,
    ...(spec.kind === 'prefix' ? { prefix: spec.prefix } : {}),
    count: set.entries.length,
    bytes,
  });
  respondJson(200, {
    ...base,
    confirm: token,
    expiresAt: at + PURGE_PLAN_TTL_MS,
    retryAfterMs: interval,
  });
  return true;
}

async function confirm({ respondJson, doors, who, spec, specDigest, now, interval, token }) {
  const id = digest(token);
  const plan = plans.get(id);
  const at = now();
  if (!plan || plan.expiresAt <= at) {
    if (plan) plans.delete(id);
    respondJson(410, {
      ok: false,
      code: 'confirm-unknown',
      error: 'no dry run matches this confirmation (or it expired) — run the dry run again',
    });
    return true;
  }
  if (plan.actor !== who.actor) {
    respondJson(403, {
      ok: false,
      code: 'forbidden',
      error: 'this confirmation belongs to another credential',
    });
    return true;
  }
  if (plan.inFlight) {
    respondJson(429, { ok: false, code: 'busy', retryAfterMs: interval });
    return true;
  }
  if (plan.lastBatchAt !== null && at - plan.lastBatchAt < interval) {
    respondJson(429, {
      ok: false,
      code: 'paced',
      retryAfterMs: interval - (at - plan.lastBatchAt),
    });
    return true;
  }
  const refuse = (reason, extra = {}) => {
    plans.delete(id);
    audit(doors.dataDir, {
      event: 'purge-refused',
      actor: who.actor,
      plan: id.slice(0, 12),
      reason,
      ...extra,
    });
    respondJson(409, {
      ok: false,
      code: 'set-changed',
      error: 'the files changed since the dry run — run the dry run again',
      ...extra,
    });
    return true;
  };
  if (plan.specDigest !== specDigest) return refuse('different-set');

  plan.inFlight = true;
  try {
    // The set must still be EXACTLY what the owner saw, less what this purge
    // already removed: no file added, none edited, none gone by another hand.
    const current = resolvePurgeSet(doors, spec);
    if (current.tooMany) return refuse('too-many');
    let added = 0;
    let changed = 0;
    for (const e of current.entries) {
      const seen = plan.remaining.get(e.path);
      if (!seen) added += 1;
      else if (seen.sha256 !== e.sha256) changed += 1;
    }
    const gone = plan.remaining.size - (current.entries.length - added);
    if (added || changed || gone) return refuse('set-changed', { added, changed, gone });

    const batch = [...plan.remaining.values()].slice(0, PURGE_BATCH);
    let purged = 0;
    let purgedBytes = 0;
    let failed = null;
    for (const e of batch) {
      const target = resolveCheckoutFileWrite(doors.designRoot, e.path);
      if (!target.ok || target.realRel !== e.path) {
        failed = { path: e.path, status: 409 };
        break;
      }
      const r = await deleteCheckoutFile({
        ctx: doors,
        landing: e.path,
        target,
        expect: e.sha256,
        role: 'owner',
        purge: true,
        trashStamp: plan.trashStamp,
      });
      if (r.status !== 200) {
        failed = { path: e.path, status: r.status };
        break;
      }
      plan.remaining.delete(e.path);
      purged += 1;
      purgedBytes += e.size ?? 0;
    }
    plan.lastBatchAt = now();
    const done = plan.remaining.size === 0;
    audit(doors.dataDir, {
      event: 'purge-batch',
      actor: who.actor,
      plan: id.slice(0, 12),
      purged,
      purgedBytes,
      remaining: plan.remaining.size,
      ...(failed ? { failed } : {}),
    });
    if (failed?.status === 409) {
      // The file moved between the re-resolve and its lock: the set changed.
      return refuse('set-changed', { purged, changed: 1 });
    }
    if (done) {
      plans.delete(id);
      audit(doors.dataDir, { event: 'purge-done', actor: who.actor, plan: id.slice(0, 12) });
    }
    respondJson(failed ? 503 : 200, {
      ok: !failed,
      purged,
      purgedBytes,
      remaining: plan.remaining.size,
      done,
      trash: `_trash/${plan.trashStamp}`,
      retryAfterMs: interval,
      ...(failed ? { code: 'retryable', failed } : {}),
    });
    return true;
  } finally {
    plan.inFlight = false;
  }
}

export const OWNER_PURGE_ROWS = Object.freeze([
  {
    path: PURGE_PATH,
    // `delete` is the owner's capability (PROJECT_ONLY); the handler then asks
    // for the project-wide owner itself. No `canvasDoor`: a canvas-only session
    // is refused before the handler runs.
    cap: Object.freeze({ safe: 'delete', unsafe: 'delete' }),
    scope: 'project',
    handler: handleOwnerPurge,
  },
]);
