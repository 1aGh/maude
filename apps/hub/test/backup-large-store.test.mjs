// A backup of a project store of realistic size completes, or fails LOUDLY.
//
// Found on a live team server (2026-11-25): the last complete generation was a
// fortnight old. Every one since held the four small databases and nothing
// else — no project store, no checkout, no manifest — and the data folder was
// collecting 385 MB `.backup-project-store.sqlite-*` scratch files. Nothing in
// the log. The store had grown past what the old snapshot step could do inside
// a container's stop window: `VACUUM INTO` + `readFileSync` + `gzipSync`, all
// synchronous, then ONE request for the whole compressed store with no
// deadline. Stopped half-way, its `finally` never ran.
//
// The store here is generated at a few hundred MB, the S3 is a fake over a
// real socket (multipart included), and the old code fails these tests.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  backupWorkBytes,
  listBackups,
  prefixedTarget,
  pruneIncompleteGenerations,
  runBackup,
  s3Target,
  scheduleBackups,
  sweepStaleSnapshots,
} from '../src/backup.mjs';
import { ensureWorkspaceId } from '../src/workspace-identity.mjs';
import { rm, tmpDir, until } from './_acl-docs-fixture.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const BUCKET = 'big-backups';
const STORE_MB = 260;

/** S3 over a real socket: single PUT, multipart (start / part / complete / abort), GET, DELETE, list. */
function fakeS3() {
  const store = new Map();
  const uploads = new Map();
  const seen = { largestBody: 0, requests: 0 };
  const rules = { fail: null, hang: null };
  const hung = new Set();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const key = decodeURIComponent(
      url.pathname.replace(`/${BUCKET}/`, '').replace(`/${BUCKET}`, '')
    );
    const q = url.searchParams;
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
    });
    req.on('end', () => {
      seen.requests += 1;
      seen.largestBody = Math.max(seen.largestBody, size);
      const body = Buffer.concat(chunks);
      const writes = req.method === 'PUT' || req.method === 'POST';
      if (writes && rules.hang?.test(key)) {
        hung.add(res); // never answered
        return;
      }
      if (writes && rules.fail?.test(key)) {
        res
          .writeHead(500, { 'Content-Type': 'application/xml' })
          .end('<Error><Code>InternalError</Code></Error>');
        return;
      }
      if (req.method === 'POST' && q.has('uploads')) {
        const id = randomBytes(8).toString('hex');
        uploads.set(id, new Map());
        res
          .writeHead(200)
          .end(
            `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`
          );
      } else if (req.method === 'PUT' && q.has('partNumber')) {
        uploads.get(q.get('uploadId'))?.set(Number(q.get('partNumber')), body);
        res.writeHead(200, { ETag: `"p${q.get('partNumber')}"` }).end();
      } else if (req.method === 'POST' && q.has('uploadId')) {
        const parts = uploads.get(q.get('uploadId'));
        store.set(
          key,
          Buffer.concat([...parts.keys()].sort((a, b) => a - b).map((n) => parts.get(n)))
        );
        uploads.delete(q.get('uploadId'));
        res.writeHead(200).end('<CompleteMultipartUploadResult/>');
      } else if (req.method === 'DELETE' && q.has('uploadId')) {
        uploads.delete(q.get('uploadId'));
        res.writeHead(204).end();
      } else if (req.method === 'PUT') {
        store.set(key, body);
        res.writeHead(200, { ETag: '"x"' }).end();
      } else if (req.method === 'DELETE') {
        store.delete(key);
        res.writeHead(204).end();
      } else if (req.method === 'GET' && q.get('list-type') === '2') {
        const prefix = q.get('prefix') ?? '';
        const contents = [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`)
          .join('');
        res
          .writeHead(200, { 'Content-Type': 'application/xml' })
          .end(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
      } else if (req.method === 'GET') {
        const found = store.get(key);
        if (found) res.writeHead(200, { 'Content-Length': found.length }).end(found);
        else res.writeHead(404).end();
      } else res.writeHead(405).end();
    });
  });
  return { server, store, uploads, seen, rules, hung };
}

let s3;
let target;
let dataDir;
let rows = 0;
const attempts = [];
const keys = () => [...s3.store.keys()].sort();
const scratchFiles = () => readdirSync(dataDir).filter((n) => n.startsWith('.backup-'));

before(async () => {
  s3 = fakeS3();
  await new Promise((r) => s3.server.listen(0, '127.0.0.1', r));
  target = prefixedTarget(
    s3Target({
      endpoint: `http://127.0.0.1:${s3.server.address().port}`,
      bucket: BUCKET,
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'k',
      region: 'auto',
    }),
    'team'
  );
  dataDir = tmpDir('maude-backup-big-');
  for (const name of ['hub.db', 'users.db']) {
    const small = new Database(join(dataDir, name));
    small.exec('CREATE TABLE t (x TEXT)');
    small.prepare('INSERT INTO t VALUES (?)').run(name);
    small.close();
  }
  // A project store of realistic size and compressibility (text with a random part), in WAL like the live one.
  const db = new Database(join(dataDir, 'project-store.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE blobs (hash TEXT PRIMARY KEY, body TEXT NOT NULL, size INTEGER NOT NULL)');
  const ins = db.prepare('INSERT INTO blobs VALUES (?, ?, ?)');
  const fill = db.transaction((n) => {
    for (let i = 0; i < n; i++) {
      const b = `export default () => <div data-x="${randomBytes(6000).toString('base64')}">${'<p>seeded by a test</p>'.repeat(900)}</div>;`;
      ins.run(randomBytes(16).toString('hex'), b, b.length);
      rows += 1;
    }
  });
  while (statSync(join(dataDir, 'project-store.sqlite')).size < STORE_MB * 1024 * 1024) fill(2000);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
});
after(async () => {
  for (const res of s3.hung) res.destroy();
  s3.server.closeAllConnections?.();
  await new Promise((r) => s3.server.close(r));
  rm(dataDir);
});

describe(`a ${STORE_MB} MB project store`, () => {
  test('is backed up whole — in parts, without freezing the hub, leaving no scratch file', async () => {
    assert.ok(backupWorkBytes(dataDir) > STORE_MB * 1024 * 1024);
    // How long does this process answer nothing? (What every connected person feels.)
    let worstFreeze = 0;
    let last = performance.now();
    const beat = setInterval(() => {
      const now = performance.now();
      worstFreeze = Math.max(worstFreeze, now - last - 20);
      last = now;
    }, 20);
    const started = performance.now();
    const out = await runBackup({ dataDir, target, onAttempt: (a) => attempts.push(a) });
    const tookMs = performance.now() - started;
    clearInterval(beat);

    assert.deepEqual(
      out.files.map((f) => f.name),
      ['hub.db', 'users.db', 'project-store.sqlite']
    );
    assert.ok(
      keys().includes(`team/${out.prefix}/project-store.sqlite.gz`),
      'the store is in the generation'
    );
    assert.ok(keys().includes(`team/${out.prefix}/manifest.json`), 'and so is the manifest');
    assert.deepEqual(await listBackups(target), [out.prefix]);
    assert.equal(attempts.at(-1).ok, true);

    // The uploaded copy is the store: every row is there.
    const restored = join(dataDir, 'restored.sqlite');
    writeFileSync(restored, gunzipSync(s3.store.get(`team/${out.prefix}/project-store.sqlite.gz`)));
    const check = new Database(restored, { readonly: true });
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM blobs').get().n, rows);
    assert.equal(check.pragma('integrity_check', { simple: true }), 'ok');
    check.close();
    rm(restored);

    assert.ok(
      s3.seen.largestBody <= 17 * 1024 * 1024,
      `no request carried more than one 16 MB part (largest: ${(s3.seen.largestBody / 1048576).toFixed(1)} MB)`
    );
    assert.ok(
      worstFreeze < 1000,
      `the hub was never frozen for a second (worst: ${Math.round(worstFreeze)} ms)`
    );
    assert.deepEqual(scratchFiles(), [], 'no scratch file left in the data folder');
    assert.ok(tookMs < 120_000, `bounded: ${Math.round(tookMs)} ms for ${STORE_MB} MB`);
  });

  test('a store upload that fails is a rejected backup with the reason — nothing left that looks like one', async () => {
    const before_ = keys();
    s3.rules.fail = /project-store\.sqlite\.gz$/;
    const later = new Date(Date.now() + 5000);
    await assert.rejects(
      runBackup({ dataDir, target, now: later, onAttempt: (a) => attempts.push(a) }),
      /project-store\.sqlite\.gz.*(500|failed)/
    );
    s3.rules.fail = null;
    const a = attempts.at(-1);
    assert.equal(a.ok, false);
    assert.match(a.message, /project-store/);
    assert.deepEqual(
      keys(),
      before_,
      'the half generation was taken away: no hub.db.gz without a manifest'
    );
    assert.equal(s3.uploads.size, 0, 'the multipart upload was aborted');
    assert.deepEqual(scratchFiles(), []);
    assert.equal((await listBackups(target)).length, 1);
  });

  test('a store upload that never answers ends as a failure, not as a backup that hangs for ever', async () => {
    s3.rules.hang = /project-store\.sqlite\.gz$/;
    const slow = prefixedTarget(
      {
        ...s3Target({
          endpoint: `http://127.0.0.1:${s3.server.address().port}`,
          bucket: BUCKET,
          accessKeyId: 'AKIATEST',
          secretAccessKey: 'k',
          region: 'auto',
        }),
      },
      'team'
    );
    const quick = {
      ...slow,
      putFile: (key, abs) => slow.putFile(key, abs, { partTimeoutMs: 400 }),
    };
    const started = Date.now();
    await assert.rejects(
      runBackup({
        dataDir,
        target: quick,
        now: new Date(Date.now() + 9000),
        onAttempt: (a) => attempts.push(a),
      }),
      /timed out|aborted|failed after retries/i
    );
    s3.rules.hang = null;
    assert.ok(Date.now() - started < 60_000);
    assert.equal(attempts.at(-1).ok, false);
    assert.deepEqual(scratchFiles(), []);
    assert.equal(
      (await listBackups(target)).length,
      1,
      'still exactly the one complete generation'
    );
  });

  test('the whole backup has a deadline', async () => {
    await assert.rejects(
      runBackup({
        dataDir,
        target,
        now: new Date(Date.now() + 13_000),
        deadlineMs: 1,
        onAttempt: (a) => attempts.push(a),
      }),
      /took longer than/
    );
    assert.equal(attempts.at(-1).ok, false);
    assert.deepEqual(scratchFiles(), []);
  });
});

describe('what a stopped process left behind', () => {
  test('scratch snapshots in the data folder are swept at boot', () => {
    for (const n of [
      '.backup-project-store.sqlite-7-1794257227301',
      '.backup-project-store.sqlite-7-1795566515404-journal',
      '.backup-hub.db-6-1.gz',
    ]) {
      writeFileSync(join(dataDir, n), 'left behind');
    }
    const swept = sweepStaleSnapshots(dataDir);
    assert.equal(swept.removed, 3);
    assert.ok(swept.bytes > 0);
    assert.deepEqual(scratchFiles(), []);
    assert.ok(existsSync(join(dataDir, 'project-store.sqlite')), 'and nothing else');
  });

  test('generations with no manifest are removed once they are a day old — never a fresh one, never in a shared keyspace', async () => {
    const workspace = ensureWorkspaceId(dataDir);
    const old = 'backups/20261110T211500Z';
    const fresh = `backups/${new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')}`;
    for (const gen of [old, fresh]) {
      for (const f of ['hub.db.gz', 'journal.db.gz', 'tokens.db.gz', 'users.db.gz'])
        await target.put(`${gen}/${f}`, Buffer.from('x'));
    }
    await target.put(`${old}/notes.txt`, Buffer.from('not a backup file'));
    const complete = await listBackups(target);

    // …not while another workspace's generation is in the keyspace: it might be theirs.
    const foreign = 'backups/20261101T000000Z';
    await target.put(
      `${foreign}/manifest.json`,
      Buffer.from(JSON.stringify({ version: 2, workspace: 'someone-else', files: [] }))
    );
    assert.deepEqual(await pruneIncompleteGenerations({ target, workspace }), []);
    await target.remove(`${foreign}/manifest.json`);

    assert.deepEqual(await pruneIncompleteGenerations({ target, workspace }), [old]);
    const left = keys();
    assert.ok(
      !left.some((k) => k.startsWith(`team/${old}/`) && k.endsWith('.gz')),
      'the old half generation is gone'
    );
    assert.ok(left.includes(`team/${old}/notes.txt`), 'only the names a backup writes');
    assert.ok(left.includes(`team/${fresh}/hub.db.gz`), 'a fresh one may still be uploading');
    assert.deepEqual(await listBackups(target), complete, 'complete generations are untouched');
  });
});

describe('when backups run', () => {
  test('the first one is minutes after boot, not a whole interval — unless a recent one exists', async () => {
    const small = tmpDir('maude-backup-first-');
    const db = new Database(join(small, 'hub.db'));
    db.exec('CREATE TABLE t (x)');
    db.close();
    const made = [];
    const t = {
      ...target,
      list: async () => [],
      put: async (k) => made.push(k),
      putFile: async (k) => made.push(k),
      remove: async () => {},
    };
    const stop = scheduleBackups({
      dataDir: small,
      target: t,
      intervalMs: 6 * 3600_000,
      firstAfterMs: 40,
      log: {},
    });
    await until(
      () => made.some((k) => k.endsWith('manifest.json')),
      5000,
      'the first backup soon after boot'
    );
    stop();

    made.length = 0;
    const stop2 = scheduleBackups({
      dataDir: small,
      target: t,
      intervalMs: 6 * 3600_000,
      firstAfterMs: 40,
      skipFirst: () => true,
      log: {},
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(made, [], 'a recent backup exists: the schedule waits its interval');
    stop2();
    rm(small);
  });

  test('on shutdown a job too big for the stop window is not started — and that is said', async () => {
    const said = [];
    const made = [];
    const t = {
      ...target,
      list: async () => [],
      put: async (k) => made.push(k),
      putFile: async (k) => made.push(k),
      remove: async () => {},
    };
    const logs = [];
    const stop = scheduleBackups({
      dataDir,
      target: t,
      intervalMs: 6 * 3600_000,
      onAttempt: (a) => said.push(a),
      log: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
    });
    const started = Date.now();
    assert.equal(await stop.final(), null);
    assert.ok(Date.now() - started < 500, 'it returns at once');
    assert.deepEqual(made, [], 'nothing was uploaded: no half generation, no scratch file');
    assert.deepEqual(scratchFiles(), []);
    assert.equal(said.length, 1);
    assert.equal(said[0].skipped, true);
    assert.match(said[0].message, /too much to back up while stopping/);
    assert.ok(logs.some((l) => /shutdown backup skipped/.test(l)));

    // A small hub still takes its last generation on shutdown.
    const small = tmpDir('maude-backup-final-');
    const db = new Database(join(small, 'hub.db'));
    db.exec('CREATE TABLE t (x)');
    db.close();
    const stop2 = scheduleBackups({ dataDir: small, target: t, intervalMs: 6 * 3600_000, log: {} });
    assert.ok((await stop2.final())?.prefix);
    rm(small);
  });
});
