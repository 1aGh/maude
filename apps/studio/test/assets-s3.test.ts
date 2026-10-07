// Cloud Phase 3 Task 2 — the S3/R2 asset lane.
//
// Exercised against a live in-process S3-shaped server rather than MinIO: the
// properties worth proving are content-addressing, verification of bytes
// received from a semi-trusted hub, and never failing a local save because a
// bucket was unreachable. None of those need a storage vendor.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The HUB's independent SigV4 implementation — imported to pin the two against
// each other, exactly as the doc-namespace grammars are pinned.
import { signRequest as hubSignRequest } from '../../hub/src/s3.mjs';
import {
  createAssetMirror,
  type S3Config,
  s3ConfigFromEnv,
  sha8,
  sha8FromAssetPath,
  signRequest,
  verifyAssetBytes,
} from '../assets-s3.ts';

let server: Server;
let store: Map<string, Uint8Array>;
let seenAuth: string[];
let cfg: S3Config;

beforeAll(async () => {
  store = new Map();
  seenAuth = [];
  server = createServer((req, res) => {
    seenAuth.push(req.headers.authorization ?? '');
    const key = decodeURIComponent(
      new URL(req.url ?? '/', 'http://x').pathname.replace('/maude-assets/', '')
    );
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        store.set(key, new Uint8Array(Buffer.concat(chunks)));
        res.writeHead(200).end();
      });
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(store.has(key) ? 200 : 404).end();
      return;
    }
    if (req.method === 'GET') {
      const body = store.get(key);
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200).end(Buffer.from(body));
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  cfg = {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bucket: 'maude-assets',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
    region: 'auto',
  };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const bytesFor = (s: string) => new TextEncoder().encode(s);
const assetPath = (b: Uint8Array, ext = 'png') => `assets/${sha8(b)}.${ext}`;

describe('content addressing', () => {
  test('sha8 is stable and differs for different bytes', () => {
    const a = bytesFor('hello');
    expect(sha8(a)).toBe(sha8(new Uint8Array(a)));
    expect(sha8(a)).not.toBe(sha8(bytesFor('hellp')));
    expect(sha8(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  test('sha8FromAssetPath accepts content-addressed paths and refuses others', () => {
    expect(sha8FromAssetPath('assets/deadbeef.png')).toBe('deadbeef');
    expect(sha8FromAssetPath('assets/deadbeef')).toBe('deadbeef');
    expect(sha8FromAssetPath('assets/deadbeef.mp4')).toBe('deadbeef');
    // The shapes the REAL corpus contains beyond saveAsset's own output — a
    // dotted sidecar and hash+label ingested footage. A stricter pattern
    // classified these as "not content addressed", which made the mirror
    // refuse legitimate assets as unverifiable.
    expect(sha8FromAssetPath('assets/deadbeef.photo.json')).toBe('deadbeef');
    expect(sha8FromAssetPath('assets/deadbeef.footage.json')).toBe('deadbeef');
    expect(sha8FromAssetPath('assets/deadbeef-cloud.mp4')).toBe('deadbeef');
    expect(sha8FromAssetPath('assets/deadbeef-cloud.srt')).toBe('deadbeef');
    // Legacy / hand-placed / traversal shapes are not content-addressed. The
    // 8 hex chars must be a COMPLETE token — `deadbeef1` is a different name.
    expect(sha8FromAssetPath('assets/my-photo.png')).toBe(null);
    expect(sha8FromAssetPath('assets/DEADBEEF.png')).toBe(null);
    expect(sha8FromAssetPath('assets/deadbeef1.png')).toBe(null);
    expect(sha8FromAssetPath('assets/deadbeefcafe.png')).toBe(null);
    expect(sha8FromAssetPath('assets/sub/deadbeef.png')).toBe(null);
    expect(sha8FromAssetPath('../assets/deadbeef.png')).toBe(null);
    expect(sha8FromAssetPath('')).toBe(null);
  });

  test('verifyAssetBytes is the check that makes a semi-trusted hub usable', () => {
    const bytes = bytesFor('the real image');
    const path = assetPath(bytes);
    expect(verifyAssetBytes(path, bytes)).toBe(true);
    // ...including the labelled and sidecar shapes.
    expect(verifyAssetBytes(`assets/${sha8(bytes)}-cloud.mp4`, bytes)).toBe(true);
    expect(verifyAssetBytes(`assets/${sha8(bytes)}.photo.json`, bytes)).toBe(true);
    // Substituted content under the same name — the attack DDR-054 describes.
    expect(verifyAssetBytes(path, bytesFor('malicious replacement'))).toBe(false);
    // A path with no content address cannot be verified, so it is not trusted.
    expect(verifyAssetBytes('assets/logo.png', bytes)).toBe(false);
  });
});

describe('config', () => {
  test('an unconfigured lane is the default, not an error', () => {
    expect(s3ConfigFromEnv({})).toBe(null);
    // Partial config must not half-enable the lane.
    expect(s3ConfigFromEnv({ MAUDE_S3_BUCKET: 'b', MAUDE_S3_ENDPOINT: 'e' })).toBe(null);
    const mirror = createAssetMirror(null);
    expect(mirror.configured).toBe(false);
  });

  test('a full env set configures it, trailing slash trimmed, region defaulted', () => {
    const resolved = s3ConfigFromEnv({
      MAUDE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
      MAUDE_S3_BUCKET: 'maude-assets',
      MAUDE_S3_ACCESS_KEY_ID: 'AKIA',
      MAUDE_S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(resolved?.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
    expect(resolved?.region).toBe('auto');
  });
});

describe('SigV4 — pinned against the hub implementation', () => {
  test('studio and hub sign the same request identically', () => {
    // Two independent implementations in two independently-built packages. If
    // they drift, one of them is wrong against real R2 and nobody would notice
    // until a deploy.
    const shared = {
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      bucket: 'maude-assets',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI',
      region: 'auto',
    };
    const now = new Date('2026-07-28T20:30:00Z');
    for (const key of ['assets/deadbeef.png', 'assets/a b+c!.png', 'assets/ünïcode.png']) {
      for (const body of [null, bytesFor('payload')]) {
        const mine = signRequest(shared, { method: 'PUT', key, body, now });
        const theirs = hubSignRequest(shared, { method: 'PUT', key, body, now });
        expect(mine.headers.authorization).toBe(theirs.headers.authorization);
        expect(mine.url).toBe(theirs.url);
      }
    }
  });

  test('the payload is signed, so different bytes give a different signature', () => {
    const now = new Date('2026-07-28T20:30:00Z');
    const a = signRequest(cfg, { method: 'PUT', key: 'assets/x.png', body: bytesFor('a'), now });
    const b = signRequest(cfg, { method: 'PUT', key: 'assets/x.png', body: bytesFor('b'), now });
    expect(a.headers.authorization).not.toBe(b.headers.authorization);
  });
});

describe('the mirror, against a live S3-shaped server', () => {
  test('push then pull round-trips, and every request is signed', async () => {
    const mirror = createAssetMirror(cfg);
    const bytes = bytesFor('a small png, pretend');
    const rel = assetPath(bytes);

    expect(await mirror.push(rel, bytes)).toBe(true);
    expect(await mirror.has(rel)).toBe(true);
    const pulled = await mirror.pull(rel);
    expect(pulled).not.toBe(null);
    expect([...(pulled ?? [])]).toEqual([...bytes]);

    expect(seenAuth.length).toBeGreaterThan(0);
    expect(seenAuth.every((a) => a.startsWith('AWS4-HMAC-SHA256 Credential='))).toBe(true);
  });

  test('pushFile streams from disk and signs the same as an in-memory body', async () => {
    const bytes = bytesFor('a big clip, pretend — streamed, never read whole');
    const rel = assetPath(bytes, 'mp4');
    const dir = mkdtempSync(join(tmpdir(), 'mirror-'));
    const abs = join(dir, 'clip.mp4');
    writeFileSync(abs, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');

    const now = new Date('2026-10-07T00:00:00Z');
    expect(
      signRequest(cfg, { method: 'PUT', key: rel, bodySha256: digest, now }).headers.authorization
    ).toBe(signRequest(cfg, { method: 'PUT', key: rel, body: bytes, now }).headers.authorization);

    const mirror = createAssetMirror(cfg);
    expect(await mirror.pushFile(rel, abs, digest)).toBe(true);
    expect([...(store.get(rel) ?? [])]).toEqual([...bytes]);
  });

  test('push is idempotent — content addressing means a re-push is a no-op', async () => {
    const mirror = createAssetMirror(cfg);
    const bytes = bytesFor('idempotent content');
    const rel = assetPath(bytes);
    expect(await mirror.push(rel, bytes)).toBe(true);
    const sizeAfterFirst = store.size;
    expect(await mirror.push(rel, bytes)).toBe(true);
    expect(store.size).toBe(sizeAfterFirst);
  });

  test('a missing object pulls as null, not an error', async () => {
    const mirror = createAssetMirror(cfg);
    expect(await mirror.pull('assets/00000000.png')).toBe(null);
    expect(await mirror.has('assets/00000000.png')).toBe(false);
  });

  test('SUBSTITUTED bytes are REFUSED — the hub cannot swap an asset', async () => {
    // Plant content under a name it does not hash to, exactly as a compromised
    // or malicious hub would. The pull must refuse rather than write it to disk,
    // where it would poison every peer that later mirrors from us.
    const honest = bytesFor('the real asset');
    const rel = assetPath(honest);
    store.set(rel, bytesFor('malicious replacement of the same length!!'));

    const warnings: string[] = [];
    const mirror = createAssetMirror(cfg, { log: { warn: (m: string) => warnings.push(m) } });
    expect(await mirror.pull(rel)).toBe(null);
    expect(warnings.join(' ')).toMatch(/does not hash to its own name/);
  });

  test('an unreachable bucket NEVER fails the caller — it returns false', async () => {
    // The local file is already on disk and in git; the bucket is the redundant
    // copy. Throwing here would turn a network blip into a failed save.
    const dead = createAssetMirror(
      { ...cfg, endpoint: 'http://127.0.0.1:1' },
      { log: { warn: () => {} } }
    );
    expect(await dead.push('assets/deadbeef.png', bytesFor('x'))).toBe(false);
    expect(await dead.pull('assets/deadbeef.png')).toBe(null);
    expect(await dead.has('assets/deadbeef.png')).toBe(false);
  });

  test('a non-2xx response is handled like a miss, not a crash', async () => {
    const mirror = createAssetMirror(
      { ...cfg, bucket: 'wrong-bucket' },
      { log: { warn: () => {} } }
    );
    expect(await mirror.pull('assets/deadbeef.png')).toBe(null);
  });

  test('the unconfigured mirror answers safely for every verb', async () => {
    const mirror = createAssetMirror(null);
    expect(await mirror.push('assets/deadbeef.png', bytesFor('x'))).toBe(false);
    expect(await mirror.pull('assets/deadbeef.png')).toBe(null);
    expect(await mirror.has('assets/deadbeef.png')).toBe(false);
    expect(mirror.describe).toBe('none');
  });
});
