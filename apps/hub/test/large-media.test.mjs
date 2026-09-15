// Large media — plan T18: bounded-memory hashing, byte ranges, and a bucket
// mirror that uploads a large file in parts (and never leaves orphans).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { parseRange, sha256File } from '../src/file-limits.mjs';
import { putObjectFromFile } from '../src/s3.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'large-media-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sha256File', () => {
  it('matches a whole-buffer hash, chunk by chunk', () => {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));
    writeFileSync(join(dir, 'f'), bytes);
    assert.equal(sha256File(join(dir, 'f'), { chunk: 1024 }), createHash('sha256').update(bytes).digest('hex'));
  });
});

describe('parseRange', () => {
  it('answers the ranges a resuming download asks for', () => {
    assert.equal(parseRange(undefined, 100), null);
    assert.deepEqual(parseRange('bytes=10-', 100), { start: 10, end: 99 });
    assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
    assert.deepEqual(parseRange('bytes=-5', 100), { start: 95, end: 99 });
    assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange('bytes=100-', 100), { invalid: true });
    assert.deepEqual(parseRange('bytes=abc', 100), { invalid: true });
    assert.equal(parseRange('bytes=0-1,5-6', 100), null);
  });
});

describe('putObjectFromFile', () => {
  const cfg = { endpoint: 'https://s3.test', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };
  const ok = (text = '', etag = null) => ({
    ok: true,
    status: 200,
    text: async () => text,
    headers: { get: (h) => (h === 'etag' ? etag : null) },
  });

  it('uploads a large file part by part and completes with every ETag', async () => {
    const bytes = Buffer.alloc(2500, 7);
    writeFileSync(join(dir, 'v.mp4'), bytes);
    const calls = [];
    const send = async (o) => {
      calls.push({ method: o.method, query: o.query, size: o.body?.length ?? null });
      if (o.method === 'POST' && 'uploads' in o.query) return ok('<UploadId>U1</UploadId>');
      if (o.method === 'PUT') return ok('', `"e${o.query.partNumber}"`);
      if (o.method === 'POST') {
        calls.at(-1).xml = o.body.toString();
        return ok('<CompleteMultipartUploadResult/>');
      }
      return ok();
    };
    const r = await putObjectFromFile(cfg, 'files/v.mp4', join(dir, 'v.mp4'), {
      threshold: 1000,
      partBytes: 1000,
      deps: { send },
    });
    assert.equal(r.parts, 3);
    assert.deepEqual(
      calls.filter((c) => c.method === 'PUT').map((c) => [c.query.partNumber, c.size]),
      [['1', 1000], ['2', 1000], ['3', 500]]
    );
    const xml = calls.at(-1).xml;
    assert.match(xml, /<PartNumber>3<\/PartNumber><ETag>"e3"<\/ETag>/);
  });

  it('a part that keeps failing aborts the upload — no orphaned parts', async () => {
    writeFileSync(join(dir, 'v.mp4'), Buffer.alloc(2500, 1));
    const calls = [];
    const send = async (o) => {
      calls.push(o.method);
      if (o.method === 'POST') return ok('<UploadId>U2</UploadId>');
      if (o.method === 'PUT') return { ok: false, status: 503, text: async () => '', headers: { get: () => null } };
      return ok();
    };
    await assert.rejects(
      putObjectFromFile(cfg, 'files/v.mp4', join(dir, 'v.mp4'), { threshold: 1000, partBytes: 1000, deps: { send } }),
      /part 1/
    );
    assert.equal(calls.at(-1), 'DELETE');
  });
});
