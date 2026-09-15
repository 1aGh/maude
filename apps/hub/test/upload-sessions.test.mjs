// Resumable upload sessions — plan T18.
//
// A file past one PUT goes up in verified parts and lands only whole. The
// properties that matter are the failure ones: an interrupted part, a lost
// completion answer, a restart between parts, a hash mismatch, a quota that
// two sessions cannot overspend together, and an abort that gives the quota
// back — and that none of it ever puts a half file where a peer can see it.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { quotaFor, resetQuotas } from '../src/file-door.mjs';
import { closeJournal, openJournal } from '../src/journal.mjs';
import { addToken } from '../src/tokens.mjs';
import { handleUploadSessions, sweepUploadSessions } from '../src/upload-sessions.mjs';

let dataDir;
let designRoot;
let token;
let other;
const PART = 1024; // tiny parts, so a "large" file is a few KiB in a test
const sha = (b) => createHash('sha256').update(b).digest('hex');

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'uploads-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'uploads-root-'));
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
  token = addToken(dataDir, { label: 'designer', scope: '*' }).value;
  other = addToken(dataDir, { label: 'someone-else', scope: '*' }).value;
  resetQuotas();
});

afterEach(() => {
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

async function call({
  path = '',
  method = 'GET',
  body = null,
  headers = {},
  bearer = token,
  over = {},
}) {
  const chunks =
    body === null
      ? []
      : [
          Buffer.isBuffer(body)
            ? body
            : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
        ];
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
  const journal = openJournal(dataDir);
  const handled = await handleUploadSessions({
    request,
    response,
    pathname: `/api/file-uploads${path}`,
    method,
    dataDir,
    secret: '',
    designRoot,
    journal,
    partBytes: PART,
    onWritten: ({ path: p }) => journal.recordWrite({ designRoot, path: p, source: 'peer-put' }),
    ...over,
  });
  await new Promise((r) => setImmediate(r));
  return { handled, status, json: payload ? JSON.parse(payload) : null };
}

const video = (n) => Buffer.from(Array.from({ length: n }, (_, i) => i % 251));

async function uploadAll(bytes, rel = 'assets/clip.mp4', { skip = [] } = {}) {
  const created = await call({
    method: 'POST',
    body: { path: rel, size: bytes.length, sha256: sha(bytes) },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const { id, parts } = created.json;
  for (let n = 0; n < parts; n += 1) {
    if (skip.includes(n)) continue;
    const part = bytes.subarray(n * PART, Math.min(bytes.length, (n + 1) * PART));
    const r = await call({
      path: `/${id}/${n}`,
      method: 'PUT',
      body: part,
      headers: { 'x-maude-part-sha256': sha(part) },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  return created.json;
}

describe('upload sessions', () => {
  it('parts land only whole: nothing in the checkout or the journal until complete', async () => {
    const bytes = video(PART * 3 + 100);
    const s = await uploadAll(bytes, 'assets/clip.mp4', { skip: [2] });
    assert.equal(s.parts, 4);
    assert.equal(existsSync(join(designRoot, 'assets/clip.mp4')), false);
    const early = await call({ path: `/${s.id}/complete`, method: 'POST' });
    assert.equal(early.status, 409);
    assert.deepEqual(early.json.received, [0, 1, 3]); // what a resuming peer asks for
    assert.equal(openJournal(dataDir).latestFor('assets/clip.mp4') ?? null, null);

    // The missing part, then completion.
    const part = bytes.subarray(2 * PART, 3 * PART);
    assert.equal((await call({ path: `/${s.id}/2`, method: 'PUT', body: part })).status, 200);
    const done = await call({ path: `/${s.id}/complete`, method: 'POST' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.sha256, sha(bytes));
    assert.ok(done.json.seq > 0);
    assert.deepEqual(readFileSync(join(designRoot, 'assets/clip.mp4')), bytes);
    // A lost completion answer: completing again replays the receipt.
    const again = await call({ path: `/${s.id}/complete`, method: 'POST' });
    assert.deepEqual(again.json, done.json);
  });

  it('resuming the same bytes to the same place returns the same session', async () => {
    const bytes = video(PART * 2);
    const a = await call({
      method: 'POST',
      body: { path: 'assets/a.mp4', size: bytes.length, sha256: sha(bytes) },
    });
    const b = await call({
      method: 'POST',
      body: { path: 'assets/a.mp4', size: bytes.length, sha256: sha(bytes) },
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.json.id, b.json.id);
    // …but not to somebody else.
    const theirs = await call({ path: `/${a.json.id}`, bearer: other });
    assert.equal(theirs.status, 404);
  });

  it('a part with the wrong bytes is refused and not kept; a resent part is idempotent', async () => {
    const bytes = video(PART * 2);
    const created = await call({
      method: 'POST',
      body: { path: 'assets/b.mp4', size: bytes.length, sha256: sha(bytes) },
    });
    const { id } = created.json;
    const good = bytes.subarray(0, PART);
    const bad = await call({
      path: `/${id}/0`,
      method: 'PUT',
      body: good,
      headers: { 'x-maude-part-sha256': sha('nope') },
    });
    assert.equal(bad.status, 400);
    assert.deepEqual((await call({ path: `/${id}` })).json.received, []);
    const short = await call({ path: `/${id}/0`, method: 'PUT', body: good.subarray(0, 10) });
    assert.equal(short.status, 400);
    assert.equal((await call({ path: `/${id}/0`, method: 'PUT', body: good })).status, 200);
    assert.equal((await call({ path: `/${id}/0`, method: 'PUT', body: good })).status, 200);
    assert.deepEqual((await call({ path: `/${id}` })).json.received, [0]);
  });

  it('an assembled file that is not the declared one never lands', async () => {
    const bytes = video(PART * 2);
    const created = await call({
      method: 'POST',
      body: { path: 'assets/c.mp4', size: bytes.length, sha256: sha('something else entirely') },
    });
    const { id } = created.json;
    for (let n = 0; n < 2; n += 1) {
      await call({
        path: `/${id}/${n}`,
        method: 'PUT',
        body: bytes.subarray(n * PART, (n + 1) * PART),
      });
    }
    const done = await call({ path: `/${id}/complete`, method: 'POST' });
    assert.equal(done.status, 422);
    assert.equal(existsSync(join(designRoot, 'assets/c.mp4')), false);
    assert.equal(quotaFor('designer').used, 0, 'the reservation came back');
  });

  it('the quota is reserved up front: two sessions cannot overspend it together', async () => {
    const row = quotaFor('designer');
    row.cap = PART * 3;
    const one = await call({
      method: 'POST',
      body: { path: 'assets/d.mp4', size: PART * 2, sha256: sha('d') },
    });
    assert.equal(one.status, 201);
    const two = await call({
      method: 'POST',
      body: { path: 'assets/e.mp4', size: PART * 2, sha256: sha('e') },
    });
    assert.equal(two.status, 507);
    // An abort gives it back.
    assert.equal((await call({ path: `/${one.json.id}`, method: 'DELETE' })).status, 200);
    assert.equal(
      (
        await call({
          method: 'POST',
          body: { path: 'assets/e.mp4', size: PART * 2, sha256: sha('e') },
        })
      ).status,
      201
    );
  });

  it('the file door’s admission applies: bad paths, scope and the project-file ceiling', async () => {
    assert.equal(
      (await call({ method: 'POST', body: { path: '../x.mp4', size: 10, sha256: sha('x') } }))
        .status,
      400
    );
    const big = await call({
      method: 'POST',
      body: { path: 'assets/huge.mp4', size: 10 * PART, sha256: sha('h') },
      over: { maxSessionBytes: 5 * PART },
    });
    assert.equal(big.status, 413);
    const scoped = addToken(dataDir, { label: 'scoped', scope: 'ui/' }).value;
    const out = await call({
      method: 'POST',
      body: { path: 'assets/f.mp4', size: 10, sha256: sha('f') },
      bearer: scoped,
    });
    assert.equal(out.status, 403);
  });

  it('a stale session expires and returns its reservation', async () => {
    const created = await call({
      method: 'POST',
      body: { path: 'assets/g.mp4', size: PART, sha256: sha('g') },
    });
    assert.equal(quotaFor('designer').used, PART);
    assert.equal(sweepUploadSessions(dataDir, Date.now() + 25 * 3600_000), 1);
    assert.equal(quotaFor('designer').used, 0);
    assert.equal((await call({ path: `/${created.json.id}` })).status, 404);
  });

  it('a compare-and-swap against what the peer decided from binds at completion', async () => {
    writeFileSync(join(designRoot, 'assets/h.mp4'), 'older');
    openJournal(dataDir).recordWrite({ designRoot, path: 'assets/h.mp4', source: 'peer-put' });
    const bytes = video(PART);
    const created = await call({
      method: 'POST',
      body: { path: 'assets/h.mp4', size: bytes.length, sha256: sha(bytes), expectHash: 'none' },
    });
    await call({ path: `/${created.json.id}/0`, method: 'PUT', body: bytes });
    const done = await call({ path: `/${created.json.id}/complete`, method: 'POST' });
    assert.equal(done.status, 409);
    assert.equal(readFileSync(join(designRoot, 'assets/h.mp4'), 'utf8'), 'older');
  });
});
