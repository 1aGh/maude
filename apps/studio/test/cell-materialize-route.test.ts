// The studio child's half of the cell materializer (Task 10).
//
// The hub answers with a LOCAL PATH; the child serves it only if it resolves
// to `<designRoot>/_cache/blobs/<sha>` (DDR-054 — the hub is semi-trusted). The
// token never leaves loopback, and nothing but inert media takes the hop.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCacheBlob, materializeMissing } from '../materialize-client.ts';

const SHA = 'a'.repeat(64);
let root: string;
let outside: string;
let cache: string;
let ENV: NodeJS.ProcessEnv;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'mat-client-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'mat-outside-')));
  // The cache is HUB-OWNED, outside the design root (security review H1).
  cache = realpathSync(mkdtempSync(join(tmpdir(), 'mat-cache-')));
  mkdirSync(join(cache, 'blobs'), { recursive: true });
  writeFileSync(join(cache, 'blobs', SHA), 'JPEG');
  ENV = {
    MAUDE_CELL_MATERIALIZE: '1',
    MAUDE_MATERIALIZE_URL: 'http://127.0.0.1:1234',
    MAUDE_MATERIALIZE_TOKEN: 'tok',
    MAUDE_MATERIALIZE_CACHE_DIR: cache,
  } as NodeJS.ProcessEnv;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

/** A hub answering `answer` and recording what it was asked. */
function hub(answer: () => Response) {
  const asked: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    asked.push({
      url: String(url),
      auth: new Headers(init?.headers as HeadersInit).get('authorization'),
    });
    return answer();
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('materializeMissing', () => {
  test('off unless the hub turned it on', async () => {
    const h = hub(() => json(200, { path: join(cache, 'blobs', SHA) }));
    const r = await materializeMissing(root, join(root, 'system/ds/assets/p.jpg'), {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: h.fetchImpl,
    });
    expect(r).toBeNull();
    expect(h.asked).toHaveLength(0);
  });

  test('asks with the token and the rel, and serves a verified cache blob', async () => {
    const h = hub(() => json(200, { path: join(cache, 'blobs', SHA), sha: SHA }));
    const r = await materializeMissing(root, join(root, 'system/ds/assets/a photo.jpg'), {
      env: ENV,
      fetchImpl: h.fetchImpl,
    });
    expect(r).toEqual({ path: join(cache, 'blobs', SHA) });
    expect(h.asked[0]?.auth).toBe('Bearer tok');
    expect(new URL(h.asked[0]?.url ?? '').searchParams.get('rel')).toBe(
      'system/ds/assets/a photo.jpg'
    );
  });

  test('a hostile hub cannot point the static route at any other file', async () => {
    writeFileSync(join(outside, SHA), 'SECRET');
    symlinkSync(join(outside, SHA), join(cache, 'blobs', 'b'.repeat(64)));
    // A tenant-planted `.design/_cache/blobs/<sha>` is no longer the cache.
    mkdirSync(join(root, '_cache', 'blobs'), { recursive: true });
    writeFileSync(join(root, '_cache', 'blobs', SHA), 'PLANTED');
    for (const path of [
      join(outside, SHA), // outside the cache
      join(root, 'config.json'), // inside the root, not a blob
      join(cache, 'blobs', 'b'.repeat(64)), // a blob name that LINKS out
      join(cache, 'blobs', '..', 'blobs', 'not-a-sha'),
      join(root, '_cache', 'blobs', SHA), // the checkout's planted copy
    ]) {
      const h = hub(() => json(200, { path }));
      const r = await materializeMissing(root, join(root, 'assets/aaaaaaaa.png'), {
        env: ENV,
        fetchImpl: h.fetchImpl,
      });
      expect(r).toBeNull();
    }
    expect(isCacheBlob(cache, join(cache, 'blobs', SHA))).toBe(true);
  });

  test('the token never leaves loopback', async () => {
    const h = hub(() => json(200, {}));
    for (const url of ['http://hub.example.com:1234', 'https://127.0.0.1:1234', 'not a url']) {
      const r = await materializeMissing(root, join(root, 'assets/aaaaaaaa.png'), {
        env: { ...ENV, MAUDE_MATERIALIZE_URL: url },
        fetchImpl: h.fetchImpl,
      });
      expect(r).toBeNull();
    }
    expect(h.asked).toHaveLength(0);
  });

  test('only inert media takes the hop — code and stylesheets are checkout files', async () => {
    const h = hub(() => json(200, { path: join(cache, 'blobs', SHA) }));
    for (const rel of ['system/ds/tokens.css', 'system/ds/_brand.ts', '../escape.png']) {
      const r = await materializeMissing(root, join(root, rel), {
        env: ENV,
        fetchImpl: h.fetchImpl,
      });
      expect(r).toBeNull();
    }
    expect(h.asked).toHaveLength(0);
  });

  test('a hub still filling answers 503 — passed on as retry-shortly, not a 404', async () => {
    const h = hub(() => json(503, { miss: 'timeout' }, { 'retry-after': '7' }));
    const r = await materializeMissing(root, join(root, 'assets/aaaaaaaa.png'), {
      env: ENV,
      fetchImpl: h.fetchImpl,
    });
    expect(r).toEqual({ unavailable: true, retryAfterS: 7 });
  });

  test('a 404 from the hub stays a plain miss', async () => {
    const h = hub(() => json(404, { miss: 'absent' }));
    const r = await materializeMissing(root, join(root, 'assets/aaaaaaaa.png'), {
      env: ENV,
      fetchImpl: h.fetchImpl,
    });
    expect(r).toBeNull();
  });
});
