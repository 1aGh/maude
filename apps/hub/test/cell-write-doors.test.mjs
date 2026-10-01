// The write doors on a cell — cell materializer Phase 1 (Task 12).
//
// On a cell, inert media with no checkout copy lands PINNED in the blob cache,
// the journal row carries the digest the door computed, the write-behind
// mirrors the pinned blob and then releases it, a delete keeps a recoverable
// bucket copy first, and code / companion text get a per-class ceiling.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createWriteBehind } from '../src/asset-lane.mjs';
import { handleFileDoor, resetQuotas } from '../src/file-door.mjs';
import { closeJournal, openJournal } from '../src/journal.mjs';
import { createMaterializer } from '../src/materializer.mjs';
import { addToken } from '../src/tokens.mjs';
import { handleUploadSessions } from '../src/upload-sessions.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const quiet = { log() {}, warn() {}, error() {} };

let dataDir;
let designRoot;
let token;
let ownerToken;
let bucket; // key → Buffer
let materializer;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cell-doors-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'cell-doors-root-'));
  mkdirSync(join(designRoot, 'system/ds/assets'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    '{"canvasGroups":[{"path":"ui"},{"path":"system"}]}'
  );
  token = addToken(dataDir, { label: 'peer', scope: '*' }).value;
  ownerToken = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
  bucket = new Map();
  resetQuotas();
  materializer = createMaterializer({
    designRoot,
    // Hub-owned, as on a cell (security review H1) — not under the checkout.
    cacheDir: join(dataDir, 'cache'),
    indexPath: join(dataDir, 'materializer.json'),
    journal: openJournal(dataDir),
    s3: { bucket: 'b' },
    prefix: '',
    budgetBytes: 1e9,
    minResidencyMs: 0,
    log: quiet,
    deps: {
      getObjectToFile: async (_c, key, abs) => {
        if (!bucket.has(key)) return null;
        writeFileSync(abs, bucket.get(key));
        return bucket.get(key).length;
      },
      putObjectFromFile: async (_c, key, abs) => {
        bucket.set(key, readFileSync(abs));
      },
    },
  });
});

afterEach(() => {
  materializer.stop();
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

function exchange({ body = null, headers = {}, bearer = token }) {
  const chunks = body === null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)];
  const request = {
    headers: { authorization: `Bearer ${bearer}`, ...headers },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
  let status = 0;
  let payload = '';
  const response = new Writable({
    write(c, _e, cb) {
      payload += c;
      cb();
    },
  });
  response.writeHead = (s) => {
    status = s;
    return response;
  };
  return {
    request,
    response,
    result: () => ({ status, json: payload ? JSON.parse(payload) : null }),
  };
}

const journal = () => openJournal(dataDir);
const hooks = () => ({
  onWritten: ({ path }) => journal().recordWrite({ designRoot, path, source: 'peer-put' }),
  onPinned: ({ path, sha256, bytes }) =>
    journal().recordVerifiedWrite({ designRoot, path, sha256, size: bytes, source: 'peer-put' }),
  onDeleted: ({ path }) =>
    journal().recordWrite({ designRoot, path, source: 'peer-put', deleted: true }),
});

async function put(rel, body, { bearer = token, headers = {}, cell = true } = {}) {
  const ex = exchange({ body, headers, bearer });
  await handleFileDoor({
    request: ex.request,
    response: ex.response,
    pathname: `/api/file/${rel}`,
    method: 'PUT',
    dataDir,
    secret: '',
    designRoot,
    journal: journal(),
    ...hooks(),
    ...(cell ? { materializer } : {}),
  });
  return ex.result();
}

async function del(rel, expect, bearer = token) {
  const ex = exchange({ headers: { 'x-maude-expect-hash': expect }, bearer });
  await handleFileDoor({
    request: ex.request,
    response: ex.response,
    pathname: `/api/file/${rel}`,
    method: 'DELETE',
    dataDir,
    secret: '',
    designRoot,
    journal: journal(),
    ...hooks(),
    materializer,
  });
  return ex.result();
}

const PHOTO = 'system/ds/assets/photo.jpg';

describe('PUT on a cell — inert media lands pinned in the cache', () => {
  it('the checkout path stays empty; the row carries the door-verified digest', async () => {
    const r = await put(PHOTO, 'JPEGBYTES');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.sha256, sha('JPEGBYTES'));
    assert.equal(
      existsSync(join(designRoot, PHOTO)),
      false,
      'never materialized at the checkout path'
    );
    assert.equal(materializer.isPinned(sha('JPEGBYTES')), true);
    const row = journal().latestFor(PHOTO);
    assert.equal(row.sha256, sha('JPEGBYTES'));
    assert.equal(row.size, 9);
    assert.equal(row.mirroredAtMs, null);
    // …and it is servable right away, before the mirror.
    assert.equal((await materializer.materialize(PHOTO)).sha, sha('JPEGBYTES'));
  });

  it('the write-behind mirrors the PINNED blob, then releases the pin', async () => {
    await put(PHOTO, 'JPEGBYTES');
    const wb = createWriteBehind({
      designRoot,
      s3: { bucket: 'b' },
      journal: journal(),
      prefix: '',
      log: quiet,
      materializer,
      deps: {
        putObject: async (_c, key, body) => {
          bucket.set(key, Buffer.from(body));
        },
      },
    });
    const res = await wb.flush();
    assert.equal(res.mirrored, 1);
    assert.equal(bucket.get(`files/${PHOTO}`).toString(), 'JPEGBYTES');
    assert.equal(materializer.isPinned(sha('JPEGBYTES')), false, 'durable ⇒ evictable');
    assert.notEqual(journal().latestFor(PHOTO).mirroredAtMs, null);
    wb.stop();
  });

  it('an existing checkout copy is overwritten IN PLACE, not shadowed by a blob', async () => {
    writeFileSync(join(designRoot, PHOTO), 'OLD-FROM-GIT-BUNDLE');
    journal().recordWrite({ designRoot, path: PHOTO, source: 'walk-import' });
    const r = await put(PHOTO, 'NEW', {
      headers: { 'x-maude-expect-hash': sha('OLD-FROM-GIT-BUNDLE') },
    });
    assert.equal(r.status, 200);
    assert.equal(readFileSync(join(designRoot, PHOTO), 'utf8'), 'NEW');
    assert.equal(materializer.isPinned(sha('NEW')), false);
  });

  it('the CAS still binds a cache-only row', async () => {
    await put(PHOTO, 'V1');
    const stale = await put(PHOTO, 'V2', { headers: { 'x-maude-expect-hash': 'none' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.current, sha('V1'));
    const ok = await put(PHOTO, 'V2', { headers: { 'x-maude-expect-hash': sha('V1') } });
    assert.equal(ok.status, 200);
    assert.equal(journal().latestFor(PHOTO).sha256, sha('V2'));
  });

  it('off a cell nothing changes: the file lands at its checkout path', async () => {
    const r = await put(PHOTO, 'DESKTOP', { cell: false });
    assert.equal(r.status, 200);
    assert.equal(readFileSync(join(designRoot, PHOTO), 'utf8'), 'DESKTOP');
  });
});

describe('the per-class ceiling for checkout-resident text on a cell', () => {
  it('a companion stylesheet past the ceiling is 413; media is not bound by it', async () => {
    const prev = process.env.MAUDE_TEXT_FILE_MAX_BYTES;
    process.env.MAUDE_TEXT_FILE_MAX_BYTES = '16';
    try {
      const big = await put('system/ds/brand.css', 'x'.repeat(17));
      assert.equal(big.status, 413);
      assert.equal(existsSync(join(designRoot, 'system/ds/brand.css')), false);
      assert.equal((await put('system/ds/brand.css', ':root{}')).status, 200);
      assert.equal((await put(PHOTO, 'y'.repeat(64))).status, 200);
      // Off a cell the ceiling does not apply.
      assert.equal((await put('system/ds/other.css', 'z'.repeat(64), { cell: false })).status, 200);
    } finally {
      if (prev === undefined) delete process.env.MAUDE_TEXT_FILE_MAX_BYTES;
      else process.env.MAUDE_TEXT_FILE_MAX_BYTES = prev;
    }
  });
});

describe('DELETE on a cell — recoverable before the tombstone', () => {
  it('a cache-only file is copied to trash/ in the bucket, then tombstoned', async () => {
    await put(PHOTO, 'KEEPME');
    bucket.set(`files/${PHOTO}`, Buffer.from('KEEPME'));
    const r = await del(PHOTO, sha('KEEPME'), ownerToken);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.keptRemote, /^trash\/.+\/system\/ds\/assets\/photo\.jpg$/);
    assert.equal(bucket.get(r.json.keptRemote).toString(), 'KEEPME');
    assert.equal(journal().latestFor(PHOTO).deleted, true);
  });

  it('when no verified copy can be kept, the delete is REFUSED', async () => {
    // Durable in the journal, but the bucket object is not the bytes the row
    // names (and not in the cache): a mismatch must not become a deletion.
    journal().recordVerifiedWrite({
      designRoot,
      path: PHOTO,
      sha256: sha('THE-REAL-BYTES'),
      size: 14,
      source: 'peer-put',
    });
    const row = journal().latestFor(PHOTO);
    journal().markMirrored(row.seq);
    bucket.set(`files/${PHOTO}`, Buffer.from('SOMETHING-ELSE'));
    const r = await del(PHOTO, sha('THE-REAL-BYTES'), ownerToken);
    assert.equal(r.status, 503);
    assert.equal(journal().latestFor(PHOTO).deleted, false, 'no tombstone without a copy');
  });

  it('content-addressed assets/ need no copy — they are never overwritten', async () => {
    const r1 = await put('assets/aaaaaaaa.png', 'PNG');
    assert.equal(r1.status, 200);
    const r = await del('assets/aaaaaaaa.png', sha('PNG'), ownerToken);
    assert.equal(r.status, 200);
    assert.equal(r.json.keptRemote, undefined);
  });
});

describe('recordVerifiedWrite — a sibling of recordWrite, not a bypass', () => {
  it('only inert media, only a real digest, never code or text', () => {
    const j = journal();
    assert.equal(
      j.recordVerifiedWrite({
        designRoot,
        path: 'system/ds/brand.css',
        sha256: 'a'.repeat(64),
        size: 1,
        source: 'peer-put',
      }),
      null
    );
    assert.equal(
      j.recordVerifiedWrite({
        designRoot,
        path: PHOTO,
        sha256: 'not-a-digest',
        size: 1,
        source: 'peer-put',
      }),
      null
    );
    assert.equal(
      j.recordVerifiedWrite({
        designRoot,
        path: PHOTO,
        sha256: 'a'.repeat(64),
        size: 1,
        source: 'made-up',
      }),
      null
    );
    const ok = j.recordVerifiedWrite({
      designRoot,
      path: PHOTO,
      sha256: 'a'.repeat(64),
      size: 1,
      source: 'peer-put',
    });
    assert.equal(ok.noop, false);
    const again = j.recordVerifiedWrite({
      designRoot,
      path: PHOTO,
      sha256: 'a'.repeat(64),
      size: 1,
      source: 'peer-put',
    });
    assert.equal(again.noop, true);
  });
});

describe('upload sessions on a cell', () => {
  it('a completed session of inert media is assembled into the cache, pinned', async () => {
    const PART = 1024;
    const bytes = Buffer.alloc(PART * 2 + 5, 9);
    const call = async ({ path = '', method, body = null, headers = {} }) => {
      const ex = exchange({
        body: body === null ? null : Buffer.isBuffer(body) ? body : JSON.stringify(body),
        headers,
      });
      await handleUploadSessions({
        request: ex.request,
        response: ex.response,
        pathname: `/api/file-uploads${path}`,
        method,
        dataDir,
        secret: '',
        designRoot,
        journal: journal(),
        partBytes: PART,
        materializer,
        ...hooks(),
      });
      return ex.result();
    };
    const created = await call({
      method: 'POST',
      body: { path: 'system/ds/assets/clip.mp4', size: bytes.length, sha256: sha(bytes) },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    for (let n = 0; n < created.json.parts; n += 1) {
      const part = bytes.subarray(n * PART, Math.min(bytes.length, (n + 1) * PART));
      const r = await call({
        path: `/${created.json.id}/${n}`,
        method: 'PUT',
        body: part,
        headers: { 'x-maude-part-sha256': sha(part) },
      });
      assert.equal(r.status, 200);
    }
    const done = await call({ path: `/${created.json.id}/complete`, method: 'POST' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(existsSync(join(designRoot, 'system/ds/assets/clip.mp4')), false);
    assert.equal(materializer.isPinned(sha(bytes)), true);
    assert.equal(journal().latestFor('system/ds/assets/clip.mp4').sha256, sha(bytes));
  });
});

// Phase 1 security review (attacker findings 1, 2b, 5) — each red-first.
describe('security review fixes — the write-behind and the doors', () => {
  const wbFor = () =>
    createWriteBehind({
      designRoot,
      s3: { bucket: 'b' },
      journal: journal(),
      prefix: '',
      log: quiet,
      materializer,
      deps: {
        putObject: async (_c, key, body) => {
          bucket.set(key, Buffer.from(body));
        },
      },
    });

  it('a STALE checkout copy is never mirrored under a newer row', async () => {
    await put(PHOTO, 'NEW-BYTES'); // pinned
    // A restart wiped the cache…
    materializer.evict(0);
    rmSync(join(dataDir, 'cache', 'blobs', sha('NEW-BYTES')), { force: true });
    // …and the git bundle put the OLD photo back at the checkout path.
    writeFileSync(join(designRoot, PHOTO), 'OLD-BYTES');
    const wb = wbFor();
    await wb.flush();
    wb.stop();
    assert.equal(bucket.has(`files/${PHOTO}`), false, 'old bytes never reached the bucket');
    assert.equal(
      journal().latestFor(PHOTO).mirroredAtMs,
      null,
      'still owed — reported lost, re-pushed'
    );
  });

  it('the pinned blob is the source even when a stale copy sits at the path', async () => {
    await put(PHOTO, 'NEW-BYTES');
    writeFileSync(join(designRoot, PHOTO), 'OLD-BYTES');
    const wb = wbFor();
    await wb.flush();
    wb.stop();
    assert.equal(bucket.get(`files/${PHOTO}`).toString(), 'NEW-BYTES');
  });

  it('re-uploading identical bytes does not leak a pin', async () => {
    await put(PHOTO, 'SAME');
    const wb = wbFor();
    await wb.flush();
    wb.stop();
    assert.equal(materializer.isPinned(sha('SAME')), false);
    const again = await put(PHOTO, 'SAME', { headers: { 'x-maude-expect-hash': sha('SAME') } });
    assert.equal(again.status, 200);
    assert.equal(materializer.isPinned(sha('SAME')), false, 'no unmirrored row needs this pin');
  });

  it('past the pinned-bytes cap the door HOLDS (503), it does not pin more', async () => {
    materializer.stop();
    materializer = createMaterializer({
      designRoot,
      cacheDir: join(dataDir, 'cache2'),
      indexPath: join(dataDir, 'm-cap.json'),
      journal: journal(),
      s3: { bucket: 'b' },
      prefix: '',
      budgetBytes: 100,
      minResidencyMs: 0,
      log: quiet,
    });
    assert.equal((await put('system/ds/assets/a.jpg', 'x'.repeat(60))).status, 200);
    const held = await put('system/ds/assets/b.jpg', 'y'.repeat(10));
    assert.equal(held.status, 503);
    assert.equal(held.json.error, 'cache-pinned');
  });
});
