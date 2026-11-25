// Doc-store backup + restore — Cloud Phase 2 Task 3.
//
// What is backed up: `hub.db` (the Hocuspocus document store — the actual
// designs), `tokens.db`, `users.db`. Snapshots are taken with SQLite's
// `VACUUM INTO`, which produces a consistent copy of a LIVE database without
// stopping the hub. Copying the file with `cp` while a write is in flight
// yields a torn database that restores as corruption, and you find out at the
// worst possible moment — which is the entire reason a restore DRILL exists
// rather than just a backup job.
//
// SQLite stays the primary store. Hocuspocus' `extension-s3` is deliberately
// NOT swapped in (DDR-052 keeps it a named option, unproven here).
//
// Yjs updates are stored VERBATIM as the binary blobs Hocuspocus wrote. The
// phase-9.2 anti-pattern is round-tripping them through JSON: it loses
// information the CRDT needs and cannot be undone later.
//
// Targets are pluggable so the drill is testable without standing up MinIO:
//   file://<absolute-path>   local directory (dev, and a perfectly good
//                            destination for a self-hoster with a mounted disk)
//   s3://                    any S3-compatible endpoint, R2 included

import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync, gzipSync } from 'node:zlib';

import { bundleRepo, REPO_BUNDLE, restoreRepo } from './repo-checkpoint.mjs';
import {
  deleteObject,
  getObject,
  listObjects,
  putObjectFromFile,
  s3ConfigFromEnv,
  sendSigned,
} from './s3.mjs';
import {
  decideBackupWrite,
  decideRestoreOwnership,
  ensureWorkspaceId,
  manifestOwner,
} from './workspace-identity.mjs';

const require = createRequire(import.meta.url);

/**
 * The databases a hub must be able to come back from.
 *
 * `journal.db` joined the set with Sync v2 (DDR-226): unlike `tombstones.db`
 * — which is deliberately NOT here, because its failure mode is a resurrected
 * canvas and it expires in 30 days anyway — a lost file journal silently
 * rewinds every peer's cursor. It therefore rides the SAME generation as the
 * documents and the checkout, which is the DDR-199 rule that mixing generations
 * is corruption. The tail in object storage covers the ≤6 h gap between
 * generations; this covers everything older.
 *
 * `snapshotDatabase` returns null for a database that does not exist and the
 * restore only restores what a generation's manifest lists, so adding a name
 * here is backwards-compatible in both directions.
 */
export const BACKUP_DATABASES = [
  'hub.db',
  'tokens.db',
  'users.db',
  'journal.db',
  // Accepted revisions (DDR-241, plan T30): the project's canonical history.
  // A restore without it would bring back documents the store has never
  // heard of — or none at all once the project saves through it.
  'project-store.sqlite',
  // S10.18a-2: team-library grants (hashed tokens only) — without it every rollout would
  // 401 the projects that linked this design system until the owner mints again.
  'ds-grants.db',
  // The kept activity log (audit-log.mjs): "who did that, and when" has to
  // outlive the disk it was written on, like the accounts it is about.
  'audit.db',
];

/** Default retention: keep this many snapshot generations. */
const DEFAULT_KEEP = 14;

// ------------------------------------------------------------------- targets

/**
 * A backup target is four functions. Keeping the interface this small is what
 * makes the local-directory target a first-class destination rather than a
 * test fixture — a self-hoster backing up to a mounted volume is a real
 * deployment, not a lesser one.
 *
 * @typedef {object} BackupTarget
 * @property {(key: string, body: Buffer) => Promise<unknown>} put
 * @property {(key: string) => Promise<Buffer|null>} get
 * @property {(prefix: string) => Promise<Array<{key: string, size: number}>>} list
 * @property {(key: string) => Promise<unknown>} remove
 * @property {string} describe
 */

/** @returns {BackupTarget} */
export function fileTarget(root) {
  const base = root.replace(/^file:\/\//, '');
  return {
    describe: `file://${base}`,
    async put(key, body) {
      const full = join(base, key);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
      return { key, bytes: body.length };
    },
    /** A file already on disk goes over as a copy — never through memory. */
    async putFile(key, abs) {
      const full = join(base, key);
      mkdirSync(join(full, '..'), { recursive: true });
      copyFileSync(abs, full);
      return { key, bytes: statSync(full).size };
    },
    async get(key) {
      const full = join(base, key);
      return existsSync(full) ? readFileSync(full) : null;
    },
    async list(prefix) {
      const out = [];
      const walk = (dir, rel) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          const childAbs = join(dir, entry.name);
          if (entry.isDirectory()) walk(childAbs, childRel);
          else if (childRel.startsWith(prefix)) {
            out.push({ key: childRel, size: statSync(childAbs).size });
          }
        }
      };
      walk(base, '');
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
    async remove(key) {
      rmSync(join(base, key), { force: true });
    },
  };
}

/** @returns {BackupTarget} */
export function s3Target(cfg) {
  return {
    describe: `s3://${cfg.bucket} @ ${cfg.endpoint}`,
    // EVERY upload has a deadline. Without one a connection that stops
    // answering is a backup that never ends and never says so — the schedule
    // then waits on it for ever and no later backup starts.
    put: (key, body) => timedPut(cfg, key, body, PART_TIMEOUT_MS),
    // A snapshot goes up FROM ITS FILE: above 16 MB as a multipart upload,
    // 16 MB a part, each part retried and each with the same deadline.
    putFile: (key, abs, { partTimeoutMs = PART_TIMEOUT_MS } = {}) =>
      statSync(abs).size <= MULTIPART_ABOVE_BYTES
        ? timedPut(cfg, key, readFileSync(abs), partTimeoutMs)
        : putObjectFromFile(cfg, key, abs, {
            threshold: MULTIPART_ABOVE_BYTES,
            deps: {
              send: (opts) =>
                sendSigned(cfg, { ...opts, signal: AbortSignal.timeout(partTimeoutMs) }),
            },
          }),
    get: (key) => getObject(cfg, key),
    list: (prefix) => listObjects(cfg, prefix),
    remove: (key) => deleteObject(cfg, key),
  };
}

/**
 * Namespace every key of a target under `prefix`.
 *
 * TENANT ISOLATION, and it is not optional. Cells share one bucket, so without
 * this every cell writes its generations to the same `backups/` keys and each
 * tenant's backup silently overwrites the last one to run — with `restoreLatest`
 * then rehydrating one tenant's cell from another tenant's documents. The cell
 * entrypoint has exported MAUDE_BACKUP_PREFIX since Phase 5; nothing read it
 * until Cloud Phase 15, which means the isolation the comment describes did not
 * exist.
 *
 * `list` strips the prefix back off, so callers keep working in unprefixed
 * key-space and the whole thing is invisible above this line.
 */
export function prefixedTarget(target, prefix) {
  const clean = String(prefix).replace(/^\/+|\/+$/g, '');
  if (!clean) return target;
  const at = (key) => `${clean}/${key}`;
  return {
    describe: `${target.describe} [${clean}/]`,
    put: (key, body) => target.put(at(key), body),
    ...(target.putFile ? { putFile: (key, abs, opts) => target.putFile(at(key), abs, opts) } : {}),
    get: (key) => target.get(at(key)),
    remove: (key) => target.remove(at(key)),
    list: async (p) =>
      (await target.list(at(p))).map((o) => ({ ...o, key: o.key.slice(clean.length + 1) })),
  };
}

/**
 * Resolve the configured target, or null when the operator configured none.
 * `MAUDE_BACKUP_TARGET=file:///var/backups/maude` or a full S3 env set.
 *
 * `MAUDE_BACKUP_PREFIX` scopes it to one tenant (see prefixedTarget).
 */
export function targetFromEnv(env = process.env) {
  return targetFromConfig(env, s3ConfigFromEnv(env));
}

/**
 * Same resolution, but with the S3 credentials supplied by the caller —
 * Cloud Phase 25 A-1. In a platform cell the credentials are temporary and
 * refreshed by `s3-creds.mjs`, so the scheduler resolves its target per tick
 * through this instead of pinning boot-time values.
 */
export function targetFromConfig(env = process.env, s3 = null, { prefixed = true } = {}) {
  const explicit = env.MAUDE_BACKUP_TARGET;
  const base = explicit?.startsWith('file://') ? fileTarget(explicit) : s3 ? s3Target(s3) : null;
  if (!base) return null;
  // `prefixed: false` hands back the BARE target — the only way to ask "is
  // there anything at the bucket root?" once a prefix is configured. Phase 0
  // F3's orphan net needs exactly that, and asking the prefixed target twice
  // would look in `<prefix>/backups/` both times and always answer zero: a
  // check that passes review and does nothing.
  if (!prefixed) return base;
  return env.MAUDE_BACKUP_PREFIX ? prefixedTarget(base, env.MAUDE_BACKUP_PREFIX) : base;
}

/** The bare target, ignoring any configured prefix. See `targetFromConfig`. */
export function baseTargetFromEnv(env = process.env) {
  return targetFromConfig(env, s3ConfigFromEnv(env), { prefixed: false });
}

/**
 * Who owns the generations in this keyspace? — Phase 0 F6, ADVISORY ONLY.
 *
 * Identity (F1) is forward-only: it makes every NEW generation say whose it is
 * and stops the destruction from here on. It says nothing about a bucket whose
 * generations are already interleaved from before the upgrade — those are all
 * version 1, indistinguishable, and still being pruned across. This reports
 * that state so a human can act on it.
 *
 * It NEVER gates a boot or a restore. Owner counts and timestamp spacing are
 * evidence, not a condition: a merged series that happens to look evenly spaced
 * would pass, and a single-owner series whose hub was down for a day would
 * fail. Conditions gate machines; heuristics inform humans.
 */
export async function inspectKeyspace(target, { workspace = null } = {}) {
  const generations = await listBackups(target);
  const owners = new Map();
  for (const gen of generations) owners.set(gen, manifestOwner(await readManifest(target, gen)));

  const distinct = new Set([...owners.values()].filter(Boolean));
  const unidentified = [...owners.values()].filter((o) => !o).length;
  const foreign = [...distinct].filter((o) => o !== workspace);

  return {
    describe: target.describe,
    generations: generations.length,
    unidentified,
    owners: [...distinct],
    foreign,
    // `shared` is what a human should look at, and it is deliberately
    // conservative about the unidentified ones: they are only suspicious when
    // something foreign is also present.
    shared: foreign.length > 0,
    verdict:
      foreign.length > 0
        ? 'SHARED — generations from another workspace are present in this keyspace'
        : unidentified > 0
          ? 'unidentified generations present (written before workspace identity existed)'
          : 'single owner',
  };
}

// ------------------------------------------------------------------ snapshot

/**
 * `VACUUM INTO` one database and return the gzipped bytes.
 *
 * Returns null when the file doesn't exist — a hub that has never minted a
 * user has no users.db, and that is not a backup failure.
 */
export function snapshotDatabase(dataDir, name, { tmpDir } = {}) {
  const source = join(dataDir, name);
  if (!existsSync(source)) return null;
  const Database = require('better-sqlite3');
  const scratchDir = tmpDir ?? dataDir;
  const scratch = join(scratchDir, `.backup-${name}-${process.pid}-${Date.now()}`);
  rmSync(scratch, { force: true });
  const db = new Database(source, { readonly: true });
  try {
    // Parameter binding is not available for VACUUM INTO, so the path is
    // interpolated — it is ours (never user input) and single quotes are
    // escaped anyway rather than trusting that to stay true.
    db.exec(`VACUUM INTO '${scratch.replace(/'/g, "''")}'`);
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  try {
    return gzipSync(readFileSync(scratch));
  } finally {
    rmSync(scratch, { force: true });
  }
}

/** A snapshot larger than this is uploaded in parts. */
const MULTIPART_ABOVE_BYTES = 16 * 1024 * 1024;

/** One PUT with a deadline; the error says which object and why. */
async function timedPut(cfg, key, body, timeoutMs) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  let res;
  try {
    res = await sendSigned(cfg, {
      method: 'PUT',
      key,
      body: buf,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const why =
      err?.name === 'TimeoutError'
        ? `timed out after ${Math.round(timeoutMs / 1000)} s`
        : (err?.message ?? err);
    throw new Error(`S3 PUT ${key} failed: ${why}`);
  }
  if (!res.ok) {
    throw new Error(`S3 PUT ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return { key, bytes: buf.length, etag: res.headers.get('etag') };
}

/** A process takes its first scheduled backup this long after it starts. */
export const FIRST_BACKUP_AFTER_MS = 3 * 60_000;
/** The most database bytes a backup on SHUTDOWN will take on (raw, before compression). */
export const SHUTDOWN_MAX_BYTES = 32 * 1024 * 1024;

/** One request of an upload — a 16 MB part, or a small file — may take this long. */
export const PART_TIMEOUT_MS = 5 * 60_000;
/** A whole backup may take this long; past it the attempt is stopped and reported. */
export const BACKUP_DEADLINE_MS = 60 * 60_000;
/** Pages copied per step of the online backup (4096-byte pages: 16 MB), between which the hub serves. */
const SNAPSHOT_PAGES_PER_STEP = 4096;
/** Past this the snapshot stops yielding and finishes in one step (a busy store restarts a slow copy). */
const SNAPSHOT_YIELD_MS = 30_000;

/**
 * Snapshot one database to a gzipped FILE, without holding the event loop or
 * the database in memory. Returns `{ path, bytes }`, or null when the database
 * does not exist. The caller removes `path`.
 *
 * WHY NOT `snapshotDatabase` (the function above, kept for small databases
 * and its tests): it is `VACUUM INTO` + `readFileSync` + `gzipSync`, all
 * synchronous. On a project store of a few hundred MB that is seconds to tens
 * of seconds in which this process answers nothing — and a process stopped in
 * the middle (a container's 10 s stop grace) leaves the scratch file behind,
 * because its `finally` never runs. That is what filled a live `/data` with
 * 385 MB `.backup-project-store.sqlite-*` files and left a fortnight of
 * generations with no project store and no manifest (2026-11-25).
 *
 * Here: SQLite's online backup, a step at a time (the hub serves between
 * steps); then a streaming gzip (zlib's thread pool); and the scratch copy is
 * removed in a `finally` that an `await` can reach.
 */
export async function snapshotDatabaseFile(dataDir, name, { tmpDir } = {}) {
  const source = join(dataDir, name);
  if (!existsSync(source)) return null;
  const Database = require('better-sqlite3');
  const scratch = join(tmpDir ?? dataDir, `${SCRATCH_PREFIX}${name}-${process.pid}-${Date.now()}`);
  const gz = `${scratch}.gz`;
  rmSync(scratch, { force: true });
  const started = Date.now();
  const db = new Database(source, { readonly: true });
  try {
    await db.backup(scratch, {
      progress: () =>
        Date.now() - started > SNAPSHOT_YIELD_MS ? 2 ** 30 : SNAPSHOT_PAGES_PER_STEP,
    });
    await pipeline(createReadStream(scratch), createGzip(), createWriteStream(gz));
    return { path: gz, bytes: statSync(gz).size };
  } catch (err) {
    rmSync(gz, { force: true });
    throw err;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    rmSync(scratch, { force: true });
    rmSync(`${scratch}-journal`, { force: true });
  }
}

/** Every scratch file a snapshot makes starts with this, in the data dir. */
const SCRATCH_PREFIX = '.backup-';

/**
 * Remove snapshot scratch files a previous process left behind (it was stopped
 * mid-snapshot). Called at BOOT, when no snapshot of this process exists yet —
 * so everything with the prefix is stale. Returns `{ removed, bytes }`.
 */
export function sweepStaleSnapshots(dataDir) {
  let removed = 0;
  let bytes = 0;
  try {
    for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(SCRATCH_PREFIX)) continue;
      const full = join(dataDir, entry.name);
      try {
        bytes += statSync(full).size;
        rmSync(full, { force: true });
        removed += 1;
      } catch {
        /* one stubborn file must not stop the sweep */
      }
    }
  } catch {
    /* no data dir yet */
  }
  return { removed, bytes };
}

/** How big the databases a backup would snapshot are, in bytes — the size of the job. */
export function backupWorkBytes(dataDir) {
  let total = 0;
  for (const name of BACKUP_DATABASES) {
    try {
      total += statSync(join(dataDir, name)).size;
    } catch {
      /* absent */
    }
  }
  return total;
}

/** `backups/20260728T203000Z/hub.db.gz` — sortable, so "latest" is lexical. */
export function snapshotPrefix(now = new Date()) {
  return `backups/${now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')}`;
}

/**
 * Take one full snapshot generation and write it to the target.
 *
 * A manifest is written LAST, on purpose: its presence is what marks a
 * generation complete. A crash mid-upload leaves an unlisted, ignorable partial
 * rather than a directory that looks restorable and isn't.
 */
/**
 * `onAttempt` is THE ONE PLACE every backup attempt reports its end — the
 * schedule's tick, the last generation on shutdown, the one before a
 * conversion, a manual run:
 *
 *   { ok: true,  prefix, at, bytes, files }   the manifest is in the target —
 *       reported the moment it is, BEFORE the prune, so a hub stopped in the
 *       tail of a shutdown has still said what it did;
 *   { ok: false, at, message, code?, conflictWith? }   it did not get there.
 *
 * Exactly one call per attempt. It never makes a backup fail.
 */
export async function runBackup({ onAttempt = null, ...args }) {
  let reported = false;
  const report = (attempt) => {
    if (reported || !onAttempt) return;
    reported = true;
    try {
      onAttempt(attempt);
    } catch {
      /* a listener must never fail the backup it is told about */
    }
  };
  try {
    return await takeBackup(args, report);
  } catch (err) {
    report({
      ok: false,
      at: Date.now(),
      message: String(err?.message ?? err).slice(0, 300),
      ...(err?.code ? { code: err.code } : {}),
      ...(err?.conflictWith ? { conflictWith: err.conflictWith } : {}),
    });
    throw err;
  }
}

async function takeBackup(
  {
    dataDir,
    target,
    now = new Date(),
    keep = DEFAULT_KEEP,
    repoDir = null,
    run = null,
    workspace = null,
    deadlineMs = BACKUP_DEADLINE_MS,
  },
  report
) {
  if (!target) throw new Error('runBackup: no target configured');

  // WHOSE KEYSPACE IS THIS? (Phase 0 F1.) Asked BEFORE a single object is
  // written, because the destruction this guards is on the write path: two
  // hubs sharing one bucket interleave into one time-sorted keyspace and
  // `pruneOldBackups` then deletes across the merge. Refusing here costs hub B
  // its backups and costs hub A nothing; the previous behaviour cost hub A its
  // history. The refusal is a typed error so the caller can render it as STATE
  // rather than leaving it as a log line nobody tails (F5).
  const workspaceId = workspace ?? ensureWorkspaceId(dataDir);
  const existing = await listBackups(target);
  // Every owner, not just the newest — a single future-dated key must not be
  // able to hide a real conflict beneath it, nor pin a false one on top.
  const owners = [];
  for (const gen of existing) owners.push(manifestOwner(await readManifest(target, gen)));
  const allowed = decideBackupWrite({ localId: workspaceId, owners });
  if (!allowed.ok) {
    const err = new Error(
      `runBackup: ${allowed.reason} (owner ${allowed.conflictWith}, this workspace ${workspaceId}). ` +
        'Give this hub its own MAUDE_BACKUP_PREFIX, or point it at its own bucket.'
    );
    err.code = IDENTITY_CONFLICT;
    err.conflictWith = allowed.conflictWith;
    throw err;
  }

  const prefix = snapshotPrefix(now);
  const files = [];
  // Everything this attempt wrote, so a failure can take it away again: a
  // generation that stops half-way must not sit in the target looking like one.
  const written = [];
  let complete = false;
  const startedAt = Date.now();
  const inTime = (step) => {
    if (Date.now() - startedAt > deadlineMs) {
      throw new Error(
        `runBackup: stopped at ${step} — the backup took longer than ${Math.round(deadlineMs / 60_000)} min`
      );
    }
  };
  try {
    for (const name of BACKUP_DATABASES) {
      inTime(name);
      const snap = await snapshotDatabaseFile(dataDir, name);
      if (!snap) continue;
      try {
        const key = `${prefix}/${name}.gz`;
        written.push(key);
        await putFile(target, key, snap.path);
        files.push({ name, bytes: snap.bytes });
      } finally {
        rmSync(snap.path, { force: true });
      }
    }
    if (files.length === 0) throw new Error('runBackup: nothing to back up (no databases found)');

    // Cloud Phase 15 — the checkout rides in the SAME generation as the
    // databases. Documents from 03:00 restored beside a checkout from 02:00
    // would give a workspace whose documents reference canvases the checkout
    // does not have; consistency between the two is why this is not a separate
    // schedule. A cell with no commits yet contributes nothing, which is a
    // normal state and not a failure.
    let repo = null;
    if (repoDir && run) {
      inTime('the checkout');
      const bundled = await bundleRepo(repoDir, run);
      if (bundled.state === 'ok') {
        written.push(`${prefix}/${REPO_BUNDLE}`);
        await target.put(`${prefix}/${REPO_BUNDLE}`, bundled.bytes);
        repo = { name: REPO_BUNDLE, bytes: bundled.bytes.length };
      } else if (bundled.state === 'failed') {
        // Loud, but the databases are already up. Throwing here would discard
        // a good document backup because the checkout lane had a bad day.
        console.error(`[backup] the checkout was NOT included: ${bundled.reason}`);
      }
    }

    // version 2 — the generation now names its owner. Additive, so a reader that
    // predates this still finds every field it knows.
    const manifest = {
      version: 2,
      workspace: workspaceId,
      createdAt: now.toISOString(),
      files,
      ...(repo ? { repo } : {}),
    };
    inTime('the manifest');
    await target.put(`${prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
    complete = true;
    // The generation is complete: say so NOW (see `onAttempt`).
    report({
      ok: true,
      prefix,
      at: now.getTime(),
      bytes: files.reduce((n, f) => n + f.bytes, 0) + (repo?.bytes ?? 0),
      files: files.length + (repo ? 1 : 0),
    });

    const pruned = await pruneOldBackups({ target, keep, workspace: workspaceId });
    // …and what earlier attempts left half-done (stopped mid-upload).
    const swept = await pruneIncompleteGenerations({ target, workspace: workspaceId }).catch(
      () => []
    );
    return { prefix, files, manifest, repo, pruned, swept };
  } catch (err) {
    // No manifest, so nothing reads this as a backup — take it away anyway.
    if (!complete) for (const key of written) await target.remove(key).catch(() => {});
    throw err;
  }
}

/** Upload a file: from disk when the target can, else through memory. */
function putFile(target, key, abs) {
  return target.putFile ? target.putFile(key, abs) : target.put(key, readFileSync(abs));
}

/** A half-written generation younger than this may still be in flight somewhere. */
export const INCOMPLETE_GRACE_MS = 24 * 3600_000;

/**
 * Remove generations that never got their manifest — an attempt that was
 * stopped mid-upload. They are not backups (nothing lists or restores them)
 * but they look like backups to a person reading the bucket, and they cost
 * storage every six hours.
 *
 * As careful as `pruneOldBackups`, for the same reason: with no manifest a
 * generation names no owner. So it is removed only when NOTHING in the
 * keyspace belongs to another workspace, only when it is older than a day
 * (never an upload in flight), and only the object names a backup writes.
 */
export async function pruneIncompleteGenerations({
  target,
  workspace = null,
  now = Date.now(),
  olderThanMs = INCOMPLETE_GRACE_MS,
}) {
  if (workspace === null) return [];
  const objects = await target.list('backups/');
  const complete = new Set(
    objects
      .filter((o) => o.key.endsWith('/manifest.json'))
      .map((o) => o.key.slice(0, -'/manifest.json'.length))
  );
  for (const gen of complete) {
    const owner = manifestOwner(await readManifest(target, gen));
    if (owner && owner !== workspace) return [];
  }
  const ours = new Set([...BACKUP_DATABASES.map((n) => `${n}.gz`), REPO_BUNDLE]);
  const doomed = new Map();
  for (const o of objects) {
    const m = /^(backups\/[^/]+)\/([^/]+)$/.exec(o.key);
    if (!m || complete.has(m[1]) || !ours.has(m[2])) continue;
    const at = generationTime(m[1]);
    if (at === null || now - at < olderThanMs) continue;
    if (!doomed.has(m[1])) doomed.set(m[1], []);
    doomed.get(m[1]).push(o.key);
  }
  for (const keys of doomed.values()) for (const key of keys) await target.remove(key);
  return [...doomed.keys()].sort();
}

/** The error a write refusal raises, so callers can surface it as STATE. */
export const IDENTITY_CONFLICT = 'IDENTITY_CONFLICT';

/**
 * Read one generation's manifest, or null when it is unreadable.
 *
 * A generation whose manifest cannot be parsed is treated as ownerless rather
 * than as ours — the conservative direction everywhere in this module.
 */
export async function readManifest(target, generation) {
  try {
    const raw = await target.get(`${generation}/manifest.json`);
    return raw ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    return null;
  }
}

/** When a generation was taken, from its own name (`backups/20261125T031502Z`) — ms, or null. */
export function generationTime(generation) {
  const m = /(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(String(generation ?? ''));
  if (!m) return null;
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(at) ? at : null;
}

/**
 * What the TARGET itself holds: how many complete generations, and the newest
 * one's name, time and size. One listing and one manifest read — the answer
 * an Overview can give after a restart, when nothing in memory knows.
 */
export async function backupSummary(target) {
  const generations = await listBackups(target);
  const last = generations[generations.length - 1] ?? null;
  if (!last) return { count: 0, lastPrefix: null, lastAt: null, lastBytes: null };
  const manifest = await readManifest(target, last);
  const created = manifest?.createdAt ? Date.parse(manifest.createdAt) : Number.NaN;
  const bytes = Array.isArray(manifest?.files)
    ? manifest.files.reduce((n, f) => n + (Number(f.bytes) || 0), 0) +
      (Number(manifest?.repo?.bytes) || 0)
    : null;
  return {
    count: generations.length,
    lastPrefix: last,
    lastAt: Number.isFinite(created) ? created : generationTime(last),
    lastBytes: bytes,
  };
}

/** List complete generations (those that have a manifest), oldest first. */
export async function listBackups(target) {
  const objects = await target.list('backups/');
  const complete = objects
    .filter((o) => o.key.endsWith('/manifest.json'))
    .map((o) => o.key.slice(0, -'/manifest.json'.length));
  return complete.sort();
}

/**
 * Delete generations past `keep` — OURS ONLY (Phase 0 F1).
 *
 * This is the operation that actually destroys data, so it is the one that has
 * to be owner-aware. Before identity existed, two hubs at the bare bucket root
 * interleaved into one time-sorted keyspace and this function's count-only
 * `slice(0, length - keep)` deleted across the merge: hub A's history erased by
 * hub B's ticks, on a healthy day, with nothing failing. A boot-time guard
 * cannot reach that — it happens every six hours, nowhere near a boot.
 *
 * A generation is prunable only when it is provably ours. Anything else is
 * ORPHANED rather than deleted, which is the right direction to fail: an
 * orphan costs storage, a wrong delete costs the history.
 *
 * Legacy (version 1) generations name no owner. They are ours only when
 * nothing foreign is present anywhere in the keyspace — if another workspace
 * has stamped a generation here, the unstamped ones may equally be theirs.
 */
export async function pruneOldBackups({ target, keep = DEFAULT_KEEP, workspace = null }) {
  const generations = await listBackups(target);
  if (generations.length <= keep) return [];

  const owners = new Map();
  for (const gen of generations) owners.set(gen, manifestOwner(await readManifest(target, gen)));
  const foreignPresent = [...owners.values()].some((o) => o && o !== workspace);

  const doomed = generations.slice(0, generations.length - keep).filter((gen) => {
    const owner = owners.get(gen);
    if (owner) return owner === workspace;
    return !foreignPresent && workspace !== null;
  });
  if (doomed.length === 0) return [];

  const objects = await target.list('backups/');
  for (const gen of doomed) {
    for (const o of objects) {
      if (o.key.startsWith(`${gen}/`)) await target.remove(o.key);
    }
  }
  return doomed;
}

/**
 * Restore the newest complete generation into `destDir`.
 *
 * Refuses to overwrite existing databases unless `force` — a restore run
 * against a live data directory by mistake is the one operation that can lose
 * more than it recovers.
 */
export async function restoreLatest({
  target,
  destDir,
  force = false,
  which,
  repoDir = null,
  run = null,
  ownership = null,
}) {
  const generations = await listBackups(target);
  const latest = which ?? generations[generations.length - 1];
  if (!latest) throw new Error('restoreLatest: no complete backup generation found');

  const manifestRaw = await target.get(`${latest}/manifest.json`);
  if (!manifestRaw) throw new Error(`restoreLatest: manifest missing for ${latest}`);
  const manifest = JSON.parse(manifestRaw.toString('utf8'));

  // Phase 0 F2 — read-side ownership, when the caller asked for it. Opt-in on
  // purpose: `restore-drill` restores into a throwaway directory to prove the
  // bytes are intact, which is a question about the archive rather than about
  // who owns it. The boot path (`rehydrate.mjs`) always passes this.
  let adopt = null;
  if (ownership) {
    const verdict = decideRestoreOwnership({
      localId: ownership.localId ?? null,
      generationManifest: manifest,
      prefixSet: Boolean(ownership.prefixSet),
    });
    if (verdict.action === 'refuse') {
      const err = new Error(
        `restoreLatest: refusing ${latest} — ${verdict.reason} (owner ${verdict.conflictWith}).`
      );
      err.code = IDENTITY_CONFLICT;
      err.conflictWith = verdict.conflictWith;
      throw err;
    }
    if (verdict.action === 'adopt-and-restore') adopt = verdict.adopt;
  }

  mkdirSync(destDir, { recursive: true });
  const restored = [];
  for (const file of manifest.files) {
    // CONTAINMENT (F1). `file.name` comes from a manifest in object storage,
    // which is attacker-writable in any shared bucket. A legitimate generation
    // only ever lists the closed set of databases, so allowlist against it
    // rather than trying to sanitise a path: `../repo/.git/hooks/post-checkout`
    // would otherwise be written and then run by the very next autosave.
    if (!BACKUP_DATABASES.includes(file.name)) {
      throw new Error(
        `restoreLatest: refusing ${latest} — manifest lists "${file.name}", not a known database`
      );
    }
    const dest = join(destDir, file.name);
    if (existsSync(dest) && !force) {
      throw new Error(
        `restoreLatest: ${dest} already exists. Restore into an empty directory, ` +
          'or pass force to overwrite deliberately.'
      );
    }
    const gz = await target.get(`${latest}/${file.name}.gz`);
    if (!gz) throw new Error(`restoreLatest: ${latest}/${file.name}.gz missing`);
    // A forced restore over a WAL database must not leave the old write-ahead
    // log beside it: SQLite would replay it onto the restored bytes.
    rmSync(`${dest}-wal`, { force: true });
    rmSync(`${dest}-shm`, { force: true });
    writeFileSync(dest, gunzipSync(gz));
    restored.push(file.name);
  }

  // The checkout lane. Only when the caller asked for it AND the generation
  // carries one — an older generation predating Cloud Phase 15 has none, and
  // that must restore the databases rather than fail.
  let repo = null;
  if (repoDir && run && manifest.repo) {
    // Same containment as the databases: the bundle name is fixed, so a
    // manifest that names anything else is refused rather than fetched.
    if (manifest.repo.name !== REPO_BUNDLE) {
      throw new Error(
        `restoreLatest: refusing ${latest} — repo bundle named "${manifest.repo.name}", not ${REPO_BUNDLE}`
      );
    }
    const bytes = await target.get(`${latest}/${manifest.repo.name}`);
    if (!bytes) throw new Error(`restoreLatest: ${latest}/${manifest.repo.name} missing`);
    repo = await restoreRepo(repoDir, bytes, run, { force });
    if (repo.state === 'failed') {
      throw new Error(`restoreLatest: the checkout could not be restored — ${repo.reason}`);
    }
  }
  // `adopt` is how a hub that lost `/data` keeps writing as itself: the caller
  // persists it, so the next backup tick is recognised as this workspace's own
  // rather than as a second hub arriving in its keyspace.
  return { generation: latest, restored, manifest, repo, adopt };
}

// --------------------------------------------------------------- the drill

/**
 * Verify a restored data directory is actually usable.
 *
 * This is the part that makes a backup real. It opens the restored `hub.db`,
 * runs SQLite's own integrity check, counts documents, and — when a sentinel
 * document name is given — asserts that document is present with a non-empty
 * binary payload. A backup that restores to a readable-but-empty database is
 * indistinguishable from a working one until the day you need it.
 *
 * @returns {{ ok: boolean, integrity: string, documents: number,
 *             sentinel: null | { name: string, present: boolean, bytes: number },
 *             problems: string[] }}
 */
export function verifyRestored(destDir, { sentinel } = {}) {
  const problems = [];
  const hubDb = join(destDir, 'hub.db');
  if (!existsSync(hubDb)) {
    return {
      ok: false,
      integrity: 'missing',
      documents: 0,
      sentinel: null,
      problems: ['hub.db is absent from the restored directory'],
    };
  }
  const Database = require('better-sqlite3');
  const db = new Database(hubDb, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') problems.push(`SQLite integrity_check returned "${integrity}"`);

    const documents = db.prepare('SELECT COUNT(*) AS n FROM "documents"').get().n;
    if (documents === 0) problems.push('restored hub.db contains zero documents');

    let sentinelResult = null;
    if (sentinel) {
      const row = db
        .prepare('SELECT length(data) AS bytes FROM "documents" WHERE name = ?')
        .get(sentinel);
      const bytes = row?.bytes ?? 0;
      sentinelResult = { name: sentinel, present: !!row, bytes };
      if (!row) problems.push(`sentinel document "${sentinel}" is absent`);
      else if (bytes === 0) problems.push(`sentinel document "${sentinel}" restored with 0 bytes`);
    }

    return { ok: problems.length === 0, integrity, documents, sentinel: sentinelResult, problems };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * The full drill: restore the newest generation into a throwaway directory and
 * verify it. Never touches the live data directory.
 */
export async function restoreDrill({ target, scratchDir, sentinel, which }) {
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(scratchDir, { recursive: true });
  const restored = await restoreLatest({ target, destDir: scratchDir, which });
  const verdict = verifyRestored(scratchDir, { sentinel });
  return { ...verdict, generation: restored.generation, restored: restored.restored };
}

// ------------------------------------------------------------------ schedule

/**
 * Run `runBackup` on an interval. Returns a stop function.
 *
 * A failed backup logs loudly and does NOT stop the schedule — a transient
 * network error must not silently end all future backups, which is exactly how
 * "we had backups" becomes "we had backups until March".
 */
export function scheduleBackups({
  dataDir,
  target,
  intervalMs,
  keep = DEFAULT_KEEP,
  log = console,
  repoDir = null,
  run = null,
  /**
   * Fired after a generation completes. Sync v2 uses it to rotate the journal
   * tail: the generation's `journal.db` now carries every row up to this point,
   * so the tail no longer has to. Best-effort by construction — replay is
   * seq-guarded, so a missed rotation costs a slightly long tail and never a
   * wrong journal.
   */
  onGeneration = null,
  /**
   * Called right before a generation snapshots; its result is handed to
   * `onGeneration`. The documents' write-behind (docs-tail.mjs) starts a new
   * sequence here, so it knows which of its writes the generation covers.
   */
  beforeGeneration = null,
  /**
   * Fired after EVERY tick with the durability state — Phase 0 F5.
   *
   * This exists because the refusal above trades one silent failure for
   * another unless somebody sees it. `runBackup` refusing an identity conflict
   * means this hub is not destroying a peer's history AND is not protecting
   * its own; the catch below logs and the interval keeps running (correctly —
   * see the docstring), so without a state hook the whole event is one line
   * every six hours in a stream nobody tails. That is the shape of the bug
   * this track exists to end, inverted.
   *
   * Deliberately NOT wired to `/health`: that endpoint is liveness, it is
   * unauthenticated, and under compose restart policies or ECS health-based
   * replacement a degraded-but-serving hub would be killed or cycled.
   * Degradation is a report, not a liveness signal.
   */
  onStatus = null,
  /** Handed to every `runBackup` this schedule makes — see `runBackup`. */
  onAttempt = null,
  /**
   * The FIRST backup of a process is this long after boot, not a whole
   * interval: a hub restarted a few times a day (deploys) otherwise never
   * reaches its first tick, and goes days without a backup while looking
   * scheduled. `skipFirst()` true leaves it out (a recent backup already exists).
   */
  firstAfterMs = Math.min(intervalMs || 0, FIRST_BACKUP_AFTER_MS),
  skipFirst = () => false,
  /** The last generation on shutdown is taken only when the job is at most this big. */
  shutdownMaxBytes = SHUTDOWN_MAX_BYTES,
}) {
  if (!target || !intervalMs || intervalMs <= 0) {
    const none = () => {};
    none.final = async () => null;
    none.now = async () => null;
    none.running = () => false;
    return none;
  }
  let inflight = null;
  const tick = async () => {
    // A-1: `target` may be an async FACTORY — in a platform cell the storage
    // credentials are temporary, so each tick resolves the target against the
    // credentials that are valid NOW rather than the ones from boot.
    let resolved;
    try {
      resolved = typeof target === 'function' ? await target() : target;
    } catch (err) {
      log.error?.(`[hub] backup target unavailable: ${err.message}`);
      // An attempt that never reached `runBackup` is still an attempt that failed.
      try {
        onAttempt?.({
          ok: false,
          at: Date.now(),
          message: `backup target unavailable: ${err.message}`,
        });
      } catch {
        /* see runBackup */
      }
      onStatus?.({ state: 'failed', message: err.message, at: Date.now() });
      return null;
    }
    if (!resolved) return null;
    let covered = null;
    try {
      covered = await beforeGeneration?.();
    } catch (err) {
      log.error?.(`[hub] pre-generation hook failed: ${err.message}`);
    }
    return runBackup({ dataDir, target: resolved, keep, repoDir, run, onAttempt })
      .then(async (r) => {
        log.log?.(
          `[hub] backup ${r.prefix} (${r.files.length} file(s)${r.repo ? ' + checkout' : ''})`
        );
        onStatus?.({ state: 'ok', generation: r.prefix, at: Date.now() });
        try {
          await onGeneration?.(r, covered);
        } catch (err) {
          log.error?.(`[hub] post-generation hook failed: ${err.message}`);
        }
        return r;
      })
      .catch((err) => {
        log.error?.(`[hub] backup FAILED: ${err.message}`);
        onStatus?.({
          state: err.code === IDENTITY_CONFLICT ? 'identity-conflict' : 'failed',
          conflictWith: err.conflictWith ?? null,
          message: err.message,
          at: Date.now(),
        });
        return null;
      });
  };
  // One generation at a time: a tick that finds the last one still running
  // skips (the next tick covers it), and the final one waits for it.
  const guarded = () => {
    if (inflight) return inflight;
    inflight = tick().finally(() => {
      inflight = null;
    });
    return inflight;
  };
  const timer = setInterval(() => void guarded(), intervalMs);
  timer.unref?.();
  const first = setTimeout(() => {
    let skip = false;
    try {
      skip = Boolean(skipFirst());
    } catch {
      /* cannot tell ⇒ take the backup */
    }
    if (!skip) void guarded();
  }, firstAfterMs);
  first.unref?.();
  const stop = () => {
    clearInterval(timer);
    clearTimeout(first);
  };
  /** A backup asked for by a person. Joins the one in flight rather than starting a second. */
  stop.now = () => guarded();
  stop.running = () => inflight !== null;
  /**
   * The last generation, on a graceful shutdown. A cell's disk goes with the
   * container, and everything written since the previous tick — up to a whole
   * interval of legacy-mode documents — would go with it (F3 S17 on the cloud
   * cell, 2026-09-24). Resolves with the generation, or null when it failed.
   */
  stop.final = async () => {
    stop();
    if (inflight) await inflight;
    // NEVER START WHAT THE STOP WINDOW CANNOT FINISH. A container is given
    // about ten seconds between SIGTERM and SIGKILL; a few hundred MB of
    // project store cannot be snapshotted, compressed and uploaded in that —
    // and a backup killed half-way is worse than none (a generation with no
    // manifest, a scratch file left on the data disk). So a big job is not
    // attempted at shutdown at all, and SAYS so: the scheduled backups are the
    // backups of a hub this size, and the first one comes minutes after boot.
    const bytes = backupWorkBytes(dataDir);
    if (bytes > shutdownMaxBytes) {
      const message = `the data here is ${Math.round(bytes / 1048576)} MB — too much to back up while stopping; the scheduled backups cover it`;
      log.log?.(`[hub] shutdown backup skipped: ${message}`);
      try {
        onAttempt?.({ ok: false, skipped: true, at: Date.now(), message });
      } catch {
        /* see runBackup */
      }
      return null;
    }
    return guarded();
  };
  return stop;
}
