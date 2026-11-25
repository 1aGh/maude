// The Overview tells the truth about backups — on S3 as on a folder, and
// after a restart.
//
// Seen on a live team server (2026-11-25): the bucket held a backup from every
// six hours and one written minutes earlier, and the Overview said "No backup
// yet · Waiting for the first one"; Activity had no "backup" row at all. Two
// causes, both invisible to tests that ran a 30-second schedule against a
// folder inside ONE process:
//   • the backup state lived only in memory since boot, and the schedule's
//     first tick is a whole interval (six hours) after boot;
//   • the activity row was written only after the upload, the prune and the
//     return — a hub stopped in that tail (a container's stop timeout, over a
//     real network) left a backup in the bucket and nothing in the log.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { closeAudit, listAudit } from '../src/audit-log.mjs';
import { backupSummary, runBackup } from '../src/backup.mjs';
import { closeUsers } from '../src/users.mjs';
import { rm, startHub, tmpDir, until } from './_acl-docs-fixture.mjs';

const BUCKET = 'team-backups';
const S3_ENV = [
  'MAUDE_S3_ENDPOINT',
  'MAUDE_S3_BUCKET',
  'MAUDE_S3_ACCESS_KEY_ID',
  'MAUDE_S3_SECRET_ACCESS_KEY',
  'MAUDE_S3_REGION',
  'MAUDE_BACKUP_PREFIX',
  'MAUDE_BACKUP_INTERVAL_MS',
];

/** A real socket speaking enough S3 for the hub's client: PUT, GET, DELETE, ListObjectsV2. */
function fakeS3() {
  const store = new Map();
  const state = { failPuts: false };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const key = decodeURIComponent(
      url.pathname.replace(`/${BUCKET}/`, '').replace(`/${BUCKET}`, '')
    );
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (state.failPuts) {
          res
            .writeHead(503, { 'Content-Type': 'application/xml' })
            .end('<Error><Code>SlowDown</Code></Error>');
          return;
        }
        store.set(key, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"x"' }).end();
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
            `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-11-25T00:00:00.000Z</LastModified></Contents>`
        )
        .join('');
      res
        .writeHead(200, { 'Content-Type': 'application/xml' })
        .end(
          `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
        );
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const body = store.get(key);
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, { 'Content-Length': body.length })
        .end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(405).end();
  });
  return { server, store, state };
}

let s3;
let dataDir;
let hub = null;
const saved = {};

before(async () => {
  s3 = fakeS3();
  await new Promise((r) => s3.server.listen(0, '127.0.0.1', r));
  for (const k of S3_ENV) saved[k] = process.env[k];
  Object.assign(process.env, {
    MAUDE_S3_ENDPOINT: `http://127.0.0.1:${s3.server.address().port}`,
    MAUDE_S3_BUCKET: BUCKET,
    MAUDE_S3_ACCESS_KEY_ID: 'AKIATEST',
    MAUDE_S3_SECRET_ACCESS_KEY: 'test-secret-key',
    MAUDE_S3_REGION: 'auto',
    MAUDE_BACKUP_PREFIX: 'team',
    // The production shape: the first scheduled backup is six hours after boot.
    MAUDE_BACKUP_INTERVAL_MS: String(6 * 3600_000),
  });
  dataDir = tmpDir('maude-backup-overview-');
});
after(async () => {
  await hub?.close();
  for (const k of S3_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise((r) => s3.server.close(r));
  closeAudit(dataDir);
  closeUsers(dataDir);
  rm(dataDir);
});

const boot = async () => {
  hub = await startHub(dataDir, { rateLimit: false, env: {} });
};
const stopHub = async () => {
  await hub.close();
  hub = null;
  closeAudit(dataDir);
};
const backupsLine = async () => {
  const res = await fetch(`${hub.http}/admin/api/overview`, {
    headers: { authorization: 'Bearer test-secret' },
  });
  return (await res.json()).health.find((h) => h.key === 'backups');
};
const generations = () => [...s3.store.keys()].filter((k) => k.endsWith('/manifest.json')).sort();
const backupRows = () => listAudit(dataDir, { kind: 'backup' });

describe('backups on an S3-shaped target', () => {
  test('before the first one: "No backup yet" is said only when the bucket really holds none', async () => {
    await boot();
    await until(
      async () => (await backupsLine()).value === 'No backup yet',
      5000,
      'the empty bucket being read'
    );
    assert.equal((await backupsLine()).state, 'warn');
  });

  test('a backup made, then a RESTART: the Overview says when, how many are kept, and Activity has the row with its size', async () => {
    const made = await hub.built.finalBackup();
    assert.ok(made?.prefix, 'the backup ran');
    assert.equal(generations().length, 1);
    assert.match(generations()[0], /^team\/backups\/\d{8}T\d{6}Z\/manifest\.json$/);
    const saidBefore = (await backupsLine()).at;
    const row = backupRows()[0];
    assert.equal(row.actor, 'Server');
    assert.match(row.detail, /^Backup made · [\d.]+ (B|KB|MB|GB)$/, 'success, with its size');

    await stopHub();
    await boot(); // six hours until this process's first scheduled backup
    await until(
      async () => (await backupsLine()).state === 'ok',
      5000,
      'the last backup being read back'
    );
    const line = await backupsLine();
    assert.equal(line.value, 'Last backup');
    assert.ok(Math.abs(line.at - Date.now()) < 120_000, 'its real time, not "since boot"');
    assert.equal(line.word, '1 kept');
    assert.equal(
      line.at,
      saidBefore,
      'the same moment it named before the restart, to the millisecond'
    );
    assert.equal(line.kept, 1);
    assert.equal(backupRows().length, 1, 'reading it back is not a second backup');
  });

  test('a backup the hub never got to log (stopped right after the upload) is still shown, and logged once at the next boot', async () => {
    await stopHub();
    // What a hub killed in the tail of its shutdown leaves: the generation in the bucket, nothing on disk about it.
    const { s3Target, prefixedTarget } = await import('../src/backup.mjs');
    const target = prefixedTarget(
      s3Target({
        endpoint: process.env.MAUDE_S3_ENDPOINT,
        bucket: BUCKET,
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'test-secret-key',
        region: 'auto',
      }),
      'team'
    );
    // A later second than the first generation (their names are second-precise).
    const later = new Date(Date.now() + 2000);
    await runBackup({ dataDir, target, now: later });
    assert.equal(generations().length, 2);
    assert.equal((await backupSummary(target)).count, 2);

    await boot();
    await until(
      async () => (await backupsLine()).word === '2 kept',
      5000,
      'both generations being counted'
    );
    const line = await backupsLine();
    assert.ok(Math.abs(line.at - later.getTime()) < 2000, 'the newest one');
    await until(() => backupRows().length === 2, 3000, 'the unlogged backup being logged');
    assert.match(backupRows()[0].detail, /found/i);
    await stopHub();
    await boot();
    await until(async () => (await backupsLine()).word === '2 kept', 5000, 'the listing');
    assert.equal(backupRows().length, 2, 'once — not again at every boot');
  });

  test('a failed attempt is a clear "Failing" with the reason, the last good backup still named — and it survives a restart', async () => {
    // Generations are named to the second: be in a LATER second than the one made 'two seconds from now' above.
    await new Promise((r) => setTimeout(r, 3200));
    s3.state.failPuts = true;
    const failed = await hub.built.finalBackup();
    assert.equal(failed, null);
    let line = await backupsLine();
    assert.equal(line.state, 'bad');
    assert.equal(line.value, 'Failing');
    assert.match(line.word, /503|SlowDown|failed/i);
    assert.ok(line.at > 0, 'the last good one is still shown');
    const row = backupRows()[0];
    assert.match(row.detail, /^Backup failed: /);

    await stopHub();
    await boot();
    await until(
      async () => (await backupsLine()).state === 'bad',
      5000,
      'the failure being remembered'
    );
    line = await backupsLine();
    assert.equal(line.value, 'Failing');

    s3.state.failPuts = false;
    assert.ok((await hub.built.finalBackup())?.prefix);
    line = await backupsLine();
    assert.equal(line.state, 'ok');
    assert.equal(line.word, '3 kept');
  });
});
