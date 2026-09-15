// Cloud Phase 2 Task 3 — backup + the restore DRILL.
//
// The exit gate is "restore drill green", not "backup job runs". A backup you
// have never restored is a hypothesis. Every test here therefore ends by
// asserting something about the RESTORED database, not about the upload.
//
// The S3 path is exercised against a real in-process HTTP server implementing
// enough of the S3 API (PUT/GET/DELETE/ListObjectsV2, SigV4 header present) to
// prove the client's wire behaviour without standing up MinIO. The file target
// is a first-class destination, not a stand-in.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  BACKUP_DATABASES,
  fileTarget,
  listBackups,
  restoreDrill,
  restoreLatest,
  runBackup,
  s3Target,
  snapshotDatabase,
  snapshotPrefix,
  targetFromEnv,
  verifyRestored,
} from '../src/backup.mjs';
import { signRequest } from '../src/s3.mjs';
import { openSqliteProjectStore } from '../src/project-transactions/store-sqlite.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let dataDir;
let backupDir;
let scratchDir;

/** Build a data dir that looks like a hub that has been used. */
function seedHub({ documents = ['ui-screen', 'settings'], payload = 'canvas bytes' } = {}) {
  const db = new Database(join(dataDir, 'hub.db'));
  db.exec('CREATE TABLE IF NOT EXISTS "documents" (name TEXT PRIMARY KEY, data BLOB)');
  const insert = db.prepare('INSERT OR REPLACE INTO "documents" (name, data) VALUES (?, ?)');
  for (const name of documents) insert.run(name, Buffer.from(`${payload}:${name}`));
  db.close();

  const tokens = new Database(join(dataDir, 'tokens.db'));
  tokens.exec('CREATE TABLE IF NOT EXISTS tokens (label TEXT PRIMARY KEY)');
  tokens.prepare('INSERT OR REPLACE INTO tokens (label) VALUES (?)').run('ci-runner');
  tokens.close();
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-backup-data-'));
  backupDir = mkdtempSync(join(tmpdir(), 'maude-backup-dest-'));
  scratchDir = join(mkdtempSync(join(tmpdir(), 'maude-backup-scratch-')), 'restore');
});

afterEach(() => {
  for (const d of [dataDir, backupDir, scratchDir]) {
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ snapshot

test('snapshotDatabase produces a gzipped, openable copy of a LIVE database', () => {
  seedHub();
  // Hold a write handle open — `cp` here would risk a torn file; VACUUM INTO
  // is the reason this is safe.
  const live = new Database(join(dataDir, 'hub.db'));
  live
    .prepare('INSERT OR REPLACE INTO "documents" (name, data) VALUES (?, ?)')
    .run('while-open', Buffer.from('x'));

  const gz = snapshotDatabase(dataDir, 'hub.db');
  live.close();

  assert.ok(gz && gz.length > 0);
  const out = join(backupDir, 'hub.db');
  writeFileSync(out, gunzipSync(gz));
  const restored = new Database(out, { readonly: true, fileMustExist: true });
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM "documents"').get().n, 3);
  restored.close();
});

test('snapshotDatabase returns null for a database that does not exist', () => {
  // A hub that has never minted a user has no users.db. Not a failure.
  assert.equal(snapshotDatabase(dataDir, 'users.db'), null);
});

test('snapshotDatabase leaves no scratch files behind', () => {
  seedHub();
  snapshotDatabase(dataDir, 'hub.db');
  const leftovers = readFileSync
    ? require('node:fs')
        .readdirSync(dataDir)
        .filter((f) => f.startsWith('.backup-'))
    : [];
  assert.deepEqual(leftovers, []);
});

test('snapshotPrefix is lexically sortable, so "latest" needs no date parsing', () => {
  const a = snapshotPrefix(new Date('2026-07-28T20:30:00Z'));
  const b = snapshotPrefix(new Date('2026-07-28T21:00:00Z'));
  const c = snapshotPrefix(new Date('2026-12-01T00:00:00Z'));
  assert.equal(a, 'backups/20260728T203000Z');
  assert.deepEqual([c, a, b].sort(), [a, b, c]);
});

// -------------------------------------------------------------- backup + restore

test('runBackup writes every present database plus a manifest', async () => {
  seedHub();
  const target = fileTarget(backupDir);
  const result = await runBackup({ dataDir, target, now: new Date('2026-07-28T20:30:00Z') });

  assert.equal(result.prefix, 'backups/20260728T203000Z');
  assert.deepEqual(
    result.files.map((f) => f.name).sort(),
    ['hub.db', 'tokens.db'],
    'users.db is absent from this hub and is correctly skipped'
  );
  assert.ok(existsSync(join(backupDir, `${result.prefix}/hub.db.gz`)));
  assert.ok(existsSync(join(backupDir, `${result.prefix}/manifest.json`)));
  // BACKUP_DATABASES is the contract — if a future db is added it must be here.
  //
  // `journal.db` joined it with Sync v2 (DDR-226): the file journal must ride
  // the SAME generation as the documents and the checkout, because a restore
  // that brings back documents beside an older journal hands every peer a
  // rewound cursor. `tombstones.db` is deliberately still absent — its failure
  // mode is a resurrected canvas and it expires in 30 days regardless.
  // `project-store.sqlite` joined with accepted revisions (DDR-241 / plan
  // T30): it IS the project's canonical history once a project switches.
  assert.deepEqual(BACKUP_DATABASES, [
    'hub.db',
    'tokens.db',
    'users.db',
    'journal.db',
    'project-store.sqlite',
  ]);
});

test('runBackup on an empty data dir fails loudly instead of writing an empty generation', async () => {
  await assert.rejects(
    () => runBackup({ dataDir, target: fileTarget(backupDir) }),
    /nothing to back up/
  );
});

test('a generation with no manifest is IGNORED — a crashed upload is not restorable', async () => {
  seedHub();
  const target = fileTarget(backupDir);
  await runBackup({ dataDir, target, now: new Date('2026-07-28T20:00:00Z') });
  // Simulate a crash between the data upload and the manifest.
  await target.put('backups/20260728T210000Z/hub.db.gz', Buffer.from('partial'));

  const generations = await listBackups(target);
  assert.deepEqual(generations, ['backups/20260728T200000Z']);
  // ...and restoring picks the complete one, not the newer broken one.
  const restored = await restoreLatest({ target, destDir: scratchDir });
  assert.equal(restored.generation, 'backups/20260728T200000Z');
});

test('restoreLatest REFUSES to overwrite an existing database unless forced', async () => {
  seedHub();
  const target = fileTarget(backupDir);
  await runBackup({ dataDir, target });
  // Restoring on top of a live data directory is the one operation that can
  // lose more than it recovers.
  await assert.rejects(() => restoreLatest({ target, destDir: dataDir }), /already exists/);
  await restoreLatest({ target, destDir: dataDir, force: true });
});

test('retention keeps the newest N generations and deletes the rest entirely', async () => {
  seedHub();
  const target = fileTarget(backupDir);
  for (let i = 0; i < 5; i++) {
    await runBackup({
      dataDir,
      target,
      keep: 3,
      now: new Date(Date.UTC(2026, 6, 28, 20, i, 0)),
    });
  }
  const generations = await listBackups(target);
  assert.equal(generations.length, 3);
  assert.deepEqual(generations, [
    'backups/20260728T200200Z',
    'backups/20260728T200300Z',
    'backups/20260728T200400Z',
  ]);
  // Pruning removes the data too, not just the manifest.
  const all = await target.list('backups/');
  assert.equal(
    all.filter((o) => o.key.startsWith('backups/20260728T200000Z')).length,
    0,
    'a pruned generation leaves no orphaned blobs'
  );
});

// ------------------------------------------------------------------ the drill

test('the restore drill passes on a good backup and names the sentinel', async () => {
  seedHub({ documents: ['ui-screen', 'settings', 'ws/acme/main/dashboard'] });
  const target = fileTarget(backupDir);
  await runBackup({ dataDir, target });

  const verdict = await restoreDrill({
    target,
    scratchDir,
    sentinel: 'ws/acme/main/dashboard',
  });

  assert.equal(verdict.ok, true, `drill should pass: ${verdict.problems.join('; ')}`);
  assert.equal(verdict.integrity, 'ok');
  assert.equal(verdict.documents, 3);
  assert.deepEqual(verdict.sentinel, {
    name: 'ws/acme/main/dashboard',
    present: true,
    bytes: Buffer.from('canvas bytes:ws/acme/main/dashboard').length,
  });
  assert.deepEqual(verdict.problems, []);
  // The drill never touches the live data directory.
  assert.ok(existsSync(join(dataDir, 'hub.db')));
});

test('the drill FAILS on a backup that restores empty — the failure mode that matters', async () => {
  // A readable-but-empty database is indistinguishable from a working one until
  // the day you need it. This is the case a backup job alone would call success.
  const db = new Database(join(dataDir, 'hub.db'));
  db.exec('CREATE TABLE IF NOT EXISTS "documents" (name TEXT PRIMARY KEY, data BLOB)');
  db.close();

  const target = fileTarget(backupDir);
  await runBackup({ dataDir, target });
  const verdict = await restoreDrill({ target, scratchDir });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.documents, 0);
  assert.match(verdict.problems.join(' '), /zero documents/);
});

test('the drill FAILS when the sentinel document is missing', async () => {
  seedHub({ documents: ['ui-screen'] });
  const target = fileTarget(backupDir);
  await runBackup({ dataDir, target });
  const verdict = await restoreDrill({ target, scratchDir, sentinel: 'not-in-this-backup' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.sentinel.present, false);
  assert.match(verdict.problems.join(' '), /sentinel document .* is absent/);
});

test('Yjs payloads survive the round trip byte-for-byte (never JSON→binary)', async () => {
  // The phase-9.2 anti-pattern. Bytes that are not valid UTF-8 are exactly what
  // a JSON round trip mangles, so the fixture uses some.
  const payload = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x7f, 0x80, 0xc3, 0x28]);
  const db = new Database(join(dataDir, 'hub.db'));
  db.exec('CREATE TABLE IF NOT EXISTS "documents" (name TEXT PRIMARY KEY, data BLOB)');
  db.prepare('INSERT INTO "documents" (name, data) VALUES (?, ?)').run('binary-doc', payload);
  db.close();

  const target = fileTarget(backupDir);
  await runBackup({ dataDir, target });
  await restoreLatest({ target, destDir: scratchDir });

  const restored = new Database(join(scratchDir, 'hub.db'), { readonly: true });
  const row = restored.prepare('SELECT data FROM "documents" WHERE name = ?').get('binary-doc');
  restored.close();
  assert.ok(Buffer.isBuffer(row.data));
  assert.deepEqual([...row.data], [...payload], 'binary must survive verbatim');
});

test('verifyRestored reports a missing hub.db rather than throwing', () => {
  const verdict = verifyRestored(scratchDir);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.integrity, 'missing');
  assert.match(verdict.problems.join(' '), /hub\.db is absent/);
});

// ------------------------------------------------------------------- targets

test('targetFromEnv resolves file://, an S3 env set, or nothing', () => {
  assert.equal(targetFromEnv({}), null, 'no destination configured = no backups, not a crash');
  assert.match(
    targetFromEnv({ MAUDE_BACKUP_TARGET: `file://${backupDir}` }).describe,
    /^file:\/\//
  );
  const s3 = targetFromEnv({
    MAUDE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
    MAUDE_S3_BUCKET: 'maude-backups',
    MAUDE_S3_ACCESS_KEY_ID: 'AKIA',
    MAUDE_S3_SECRET_ACCESS_KEY: 'secret',
  });
  assert.match(s3.describe, /^s3:\/\/maude-backups/);
  // A partial S3 env must not half-configure a target.
  assert.equal(targetFromEnv({ MAUDE_S3_BUCKET: 'x', MAUDE_S3_ENDPOINT: 'y' }), null);
});

test('SigV4 signing produces a stable, correctly-shaped canonical request', () => {
  const cfg = {
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    bucket: 'maude-backups',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI',
    region: 'auto',
  };
  const now = new Date('2026-07-28T20:30:00Z');
  const a = signRequest(cfg, {
    method: 'PUT',
    key: 'backups/x/hub.db.gz',
    body: Buffer.from('hi'),
    now,
  });
  const b = signRequest(cfg, {
    method: 'PUT',
    key: 'backups/x/hub.db.gz',
    body: Buffer.from('hi'),
    now,
  });

  assert.equal(a.headers.authorization, b.headers.authorization, 'signing must be deterministic');
  assert.match(
    a.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260728\/auto\/s3\/aws4_request, /
  );
  assert.match(
    a.headers.authorization,
    /SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
  );
  assert.equal(a.headers['x-amz-date'], '20260728T203000Z');
  assert.ok(a.canonicalRequest.startsWith('PUT\n/maude-backups/backups/x/hub.db.gz\n\n'));
  // A different body must change the signature (payload is signed, not skipped).
  const different = signRequest(cfg, {
    method: 'PUT',
    key: 'backups/x/hub.db.gz',
    body: Buffer.from('ho'),
    now,
  });
  assert.notEqual(a.headers.authorization, different.headers.authorization);
});

test('the S3 target round-trips a full backup + drill against a live S3-shaped server', async (t) => {
  // Not MinIO, but a real socket and the real client code path: signed
  // requests, path-style URLs, ListObjectsV2 XML, gzip blobs.
  /** @type {Map<string, Buffer>} */
  const store = new Map();
  const seenAuth = [];
  const server = createServer((req, res) => {
    seenAuth.push(req.headers.authorization ?? '');
    const url = new URL(req.url, 'http://x');
    const key = decodeURIComponent(
      url.pathname.replace('/maude-backups/', '').replace('/maude-backups', '')
    );

    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        store.set(key, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"deadbeef"' }).end();
      });
      return;
    }
    if (req.method === 'DELETE') {
      store.delete(key);
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const contents = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(
          ([k, v]) =>
            `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-07-28T20:30:00.000Z</LastModified></Contents>`
        )
        .join('');
      res
        .writeHead(200, { 'Content-Type': 'application/xml' })
        .end(
          `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
        );
      return;
    }
    if (req.method === 'GET') {
      const body = store.get(key);
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200).end(body);
      return;
    }
    res.writeHead(405).end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const target = s3Target({
    endpoint: `http://127.0.0.1:${port}`,
    bucket: 'maude-backups',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
    region: 'auto',
  });

  seedHub({ documents: ['ui-screen', 'ws/acme/main/dashboard'] });
  const result = await runBackup({ dataDir, target });
  assert.equal(result.files.length, 2);

  const verdict = await restoreDrill({ target, scratchDir, sentinel: 'ws/acme/main/dashboard' });
  assert.equal(verdict.ok, true, verdict.problems.join('; '));
  assert.equal(verdict.documents, 2);
  assert.equal(verdict.sentinel.present, true);

  // Every request was signed — an unsigned request would 403 against real R2.
  assert.ok(seenAuth.length > 0);
  assert.ok(
    seenAuth.every((a) => a.startsWith('AWS4-HMAC-SHA256 Credential=')),
    'every request must carry a SigV4 Authorization header'
  );
});

// Plan T30 — accepted revisions ride the same generation as the documents,
// and a forced restore never replays a stale write-ahead log over them.
test('the accepted-revisions store is backed up and restored with the project', async () => {
  seedHub();
  const store = openSqliteProjectStore(dataDir);
  const switched = await store.setMode({ mode: 'transactions', expectEpoch: 0 });
  store.close?.();
  const target = fileTarget(backupDir);
  const result = await runBackup({ dataDir, target });
  assert.ok(result.files.map((f) => f.name).includes('project-store.sqlite'));

  const restored = await restoreLatest({ target, destDir: scratchDir });
  assert.ok(restored.restored.includes('project-store.sqlite'));
  const back = openSqliteProjectStore(scratchDir);
  const state = await back.state();
  assert.equal(state.mode, 'transactions');
  assert.equal(state.epoch, switched.epoch);
  back.close?.();

  // A forced restore over a live WAL database drops the old log first.
  writeFileSync(join(dataDir, 'project-store.sqlite-wal'), 'stale write-ahead log');
  await restoreLatest({ target, destDir: dataDir, force: true });
  assert.equal(existsSync(join(dataDir, 'project-store.sqlite-wal')), false);
});
