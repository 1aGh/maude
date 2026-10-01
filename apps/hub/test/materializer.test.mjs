// The cell materializer — cell materializer Phase 1 (Task 8).
//
// On a cell the journal says what exists, the bucket holds the bytes, and the
// local disk is a bounded, disposable cache. The properties that matter are
// the safety ones: bucket bytes reach a client only after they hash to the
// journal row; a cache path comes only from a verified digest; pinned
// (unmirrored) bytes are never evicted; and a burst of misses costs one GET.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { blobPathFor, cacheBudgetFor, createMaterializer } from '../src/materializer.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const quiet = { log() {}, warn() {}, error() {} };

let designRoot;
let dataDir;
beforeEach(() => {
  designRoot = mkdtempSync(join(tmpdir(), 'mat-root-'));
  dataDir = mkdtempSync(join(tmpdir(), 'mat-data-'));
});
afterEach(() => {
  rmSync(designRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

/** A journal of live rows: rel → { body, mirrored }. */
function journalOf(rows) {
  const map = new Map(
    Object.entries(rows).map(([rel, r]) => [
      rel,
      {
        path: rel,
        sha256: r.sha256 ?? sha(r.body),
        size: Buffer.byteLength(r.body),
        deleted: r.deleted === true,
        mirroredAtMs: r.mirrored === false ? null : 1,
      },
    ])
  );
  return { latestFor: (rel) => map.get(rel) ?? null, map };
}

/** A bucket keyed like the write-behind: `files/<rel>` (no tenant prefix). */
function bucketOf(objects, { delayMs = 0 } = {}) {
  const gets = [];
  return {
    gets,
    getObjectToFile: async (_cfg, key, abs) => {
      gets.push(key);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (!(key in objects)) return null;
      writeFileSync(abs, objects[key]);
      return Buffer.byteLength(objects[key]);
    },
  };
}

function make({ rows, objects, budgetBytes = 1e9, clock, ...rest } = {}) {
  const bucket = bucketOf(objects ?? {}, rest.bucket);
  const journal = journalOf(rows ?? {});
  const m = createMaterializer({
    designRoot,
    indexPath: join(dataDir, 'materializer.json'),
    journal,
    s3: async () => ({ bucket: 'x' }),
    prefix: '',
    budgetBytes,
    log: quiet,
    deadlineMs: rest.deadlineMs ?? 5_000,
    minResidencyMs: rest.minResidencyMs ?? 0,
    deps: {
      getObjectToFile: bucket.getObjectToFile,
      ...(clock ? { now: clock } : {}),
    },
  });
  return { m, bucket, journal };
}

const P = 'system/ds/assets/photo.jpg';

describe('materialize', () => {
  it('miss → fill → verify, then a HIT without the bucket', async () => {
    const { m, bucket } = make({
      rows: { [P]: { body: 'JPEGBYTES' } },
      objects: { [`files/${P}`]: 'JPEGBYTES' },
    });
    const first = await m.materialize(P);
    assert.equal(first.sha, sha('JPEGBYTES'));
    assert.equal(readFileSync(first.path, 'utf8'), 'JPEGBYTES');
    assert.ok(first.path.startsWith(join(designRoot, '_cache', 'blobs')));
    const second = await m.materialize(P);
    assert.equal(second.path, first.path);
    assert.deepEqual(bucket.gets, [`files/${P}`], 'the hit never asked the bucket');
    assert.equal(m.stats().hits, 1);
    assert.equal(m.stats().fills, 1);
  });

  it('assets/<name> fills from the content-addressed legacy key', async () => {
    const rel = 'assets/aaaaaaaa.png';
    const { m, bucket } = make({
      rows: { [rel]: { body: 'PNG' } },
      objects: { 'assets/aaaaaaaa.png': 'PNG' },
    });
    assert.equal((await m.materialize(rel)).size, 3);
    assert.deepEqual(bucket.gets, ['assets/aaaaaaaa.png']);
  });

  it('a bucket object that does not hash to the row is NEVER served', async () => {
    // `files/<rel>` is path-keyed and overwritten in place: the bucket may
    // hold newer (or substituted) bytes than the row names.
    const { m } = make({
      rows: { [P]: { body: 'WHAT-THE-JOURNAL-SAYS' } },
      objects: { [`files/${P}`]: 'SOMETHING-ELSE' },
    });
    const res = await m.materialize(P);
    assert.deepEqual(res, { miss: 'mismatch' });
    assert.equal(existsSync(blobPathFor(m.cacheDir, sha('WHAT-THE-JOURNAL-SAYS'))), false);
    assert.equal(existsSync(blobPathFor(m.cacheDir, sha('SOMETHING-ELSE'))), false);
    assert.equal(m.stats().mismatches, 1);
  });

  it('typed misses: deleted, unknown, unmirrored, absent from the bucket', async () => {
    const { m } = make({
      rows: {
        'gone.png': { body: 'x', deleted: true },
        'local-only.png': { body: 'y', mirrored: false },
        'not-in-bucket.png': { body: 'z' },
      },
      objects: {},
    });
    assert.deepEqual(await m.materialize('gone.png'), { miss: 'absent' });
    assert.deepEqual(await m.materialize('never-heard-of.png'), { miss: 'absent' });
    assert.deepEqual(await m.materialize('local-only.png'), { miss: 'unmirrored' });
    assert.deepEqual(await m.materialize('not-in-bucket.png'), { miss: 'absent' });
  });

  it('concurrent misses for one sha cost ONE GET', async () => {
    const { m, bucket } = make({
      rows: { [P]: { body: 'B' }, 'copy.jpg': { body: 'B' } },
      objects: { [`files/${P}`]: 'B', 'files/copy.jpg': 'B' },
      bucket: { delayMs: 30 },
    });
    const all = await Promise.all([
      m.materialize(P),
      m.materialize(P),
      m.materialize(P),
      m.materialize('copy.jpg'), // same bytes, same sha → same flight
    ]);
    assert.equal(bucket.gets.length, 1);
    assert.ok(all.every((r) => r.sha === sha('B')));
  });

  it('a fill past the deadline is a timeout NOW and a hit for the next caller', async () => {
    const { m, bucket } = make({
      rows: { [P]: { body: 'SLOW' } },
      objects: { [`files/${P}`]: 'SLOW' },
      bucket: { delayMs: 80 },
      deadlineMs: 10,
    });
    assert.deepEqual(await m.materialize(P), { miss: 'timeout' });
    await new Promise((r) => setTimeout(r, 120));
    const later = await m.materialize(P);
    assert.equal(later.sha, sha('SLOW'));
    assert.equal(bucket.gets.length, 1, 'the fill kept going instead of restarting');
  });

  it('a hostile sha never becomes a path', async () => {
    const { m } = make({
      rows: { [P]: { body: 'x', sha256: '../../../etc/passwd' } },
      objects: { [`files/${P}`]: 'x' },
    });
    assert.deepEqual(await m.materialize(P), { miss: 'absent' });
    assert.equal(blobPathFor(m.cacheDir, '../x'), null);
    assert.equal(blobPathFor(m.cacheDir, 'A'.repeat(64)), null); // upper-case is not ours
    assert.throws(() => m.pin('../../evil', join(dataDir, 'f')), /sha256/);
  });
});

describe('pin, unpin and eviction', () => {
  it('evicts least-recently-used UNPINNED blobs down to the low watermark', async () => {
    let t = 1_000;
    const rows = {};
    const objects = {};
    for (const n of ['a', 'b', 'c', 'd']) {
      rows[`${n}.jpg`] = { body: n.repeat(100) };
      objects[`files/${n}.jpg`] = n.repeat(100);
    }
    // 400 bytes of budget: high water 320, low water 240.
    const { m } = make({ rows, objects, budgetBytes: 400, clock: () => t });
    for (const n of ['a', 'b', 'c']) {
      t += 10;
      await m.materialize(`${n}.jpg`);
    }
    t += 10;
    await m.materialize('a.jpg'); // a is now the most recent
    t += 10;
    await m.materialize('d.jpg'); // 300 + 100 > 320 → evict b (oldest), then c
    const s = m.stats();
    assert.ok(s.bytes <= 240 + 100, `cache at ${s.bytes}`);
    assert.ok(m.peek(sha('a'.repeat(100))), 'recently used survives');
    assert.equal(m.peek(sha('b'.repeat(100))), null, 'least recently used went first');
    assert.ok(s.evictions >= 1);
  });

  it('never evicts a pinned blob — unmirrored bytes exist nowhere else', async () => {
    let t = 1_000;
    const { m } = make({
      rows: { 'x.jpg': { body: 'x'.repeat(100) } },
      objects: { 'files/x.jpg': 'x'.repeat(100) },
      budgetBytes: 200,
      clock: () => t,
    });
    const upload = m.tempPath();
    writeFileSync(upload, 'U'.repeat(150));
    const pinned = m.pin(sha('U'.repeat(150)), upload);
    assert.equal(readFileSync(pinned, 'utf8'), 'U'.repeat(150));
    t += 10;
    // 150 pinned + 100 would pass the budget, and the pin cannot move.
    assert.deepEqual(await m.materialize('x.jpg'), { miss: 'full' });
    assert.ok(m.peek(sha('U'.repeat(150))));
    // Mirrored → unpinned → evictable; the fill now fits.
    m.unpin(sha('U'.repeat(150)));
    assert.equal((await m.materialize('x.jpg')).size, 100);
  });

  it('a freshly filled blob stays for the minimum residency (no thrash)', async () => {
    let t = 1_000;
    const rows = { 'a.jpg': { body: 'a'.repeat(100) }, 'b.jpg': { body: 'b'.repeat(100) } };
    const objects = { 'files/a.jpg': 'a'.repeat(100), 'files/b.jpg': 'b'.repeat(100) };
    const { m } = make({ rows, objects, budgetBytes: 150, clock: () => t, minResidencyMs: 60_000 });
    await m.materialize('a.jpg');
    t += 1_000; // well inside a's residency
    assert.deepEqual(await m.materialize('b.jpg'), { miss: 'full' });
    t += 60_000; // past it
    assert.equal((await m.materialize('b.jpg')).size, 100);
    assert.equal(m.peek(sha('a'.repeat(100))), null);
  });

  it('the index survives a restart; the disk stays the truth', async () => {
    const { m } = make({
      rows: { [P]: { body: 'KEEP' } },
      objects: { [`files/${P}`]: 'KEEP' },
    });
    await m.materialize(P);
    const up = m.tempPath();
    writeFileSync(up, 'PIN');
    m.pin(sha('PIN'), up);
    m.stop(); // flushes the index
    // A stray non-digest file in blobs/ is garbage, not a blob.
    writeFileSync(join(m.cacheDir, 'blobs', 'not-a-sha'), 'junk');
    const again = make({ rows: { [P]: { body: 'KEEP' } }, objects: {} }).m;
    assert.equal((await again.materialize(P)).sha, sha('KEEP'), 'a hit from the old cache');
    assert.equal(again.isPinned(sha('PIN')), true, 'pins survive');
    assert.equal(existsSync(join(again.cacheDir, 'blobs', 'not-a-sha')), false);
  });
});

describe('cacheBudgetFor — the same headroom rule as the boot hydrate', () => {
  const disk = (free, floor) => () => ({ totalBytes: 8e9, freeBytes: free, floorBytes: floor });

  it('is free + what the cache holds − two floors', () => {
    // 3 GB free, cache already 1 GB, floor 1 GB → 3 + 1 − 2 = 2 GB.
    assert.equal(
      cacheBudgetFor({ dir: '/x', cacheBytes: 1e9, env: {}, report: disk(3e9, 1e9) }),
      2e9
    );
  });

  it('never more than MAUDE_CACHE_BUDGET_BYTES, never below zero', () => {
    const env = { MAUDE_CACHE_BUDGET_BYTES: '500' };
    assert.equal(cacheBudgetFor({ dir: '/x', env, report: disk(3e9, 1e9) }), 500);
    assert.equal(cacheBudgetFor({ dir: '/x', env: {}, report: disk(1e9, 1e9) }), 0);
  });

  it('a budget FUNCTION is asked per fill — a shrinking disk shrinks the cache', async () => {
    let budget = 1e9;
    const m2 = createMaterializer({
      designRoot,
      indexPath: join(dataDir, 'm2.json'),
      journal: journalOf({ 'a.jpg': { body: 'a'.repeat(100) } }),
      s3: { bucket: 'x' },
      prefix: '',
      budgetBytes: () => budget,
      log: quiet,
      minResidencyMs: 0,
      deps: { getObjectToFile: bucketOf({ 'files/a.jpg': 'a'.repeat(100) }).getObjectToFile },
    });
    budget = 50; // a desktop push ate the room
    assert.deepEqual(await m2.materialize('a.jpg'), { miss: 'full' });
    budget = 1e9;
    assert.equal((await m2.materialize('a.jpg')).size, 100);
  });
});
