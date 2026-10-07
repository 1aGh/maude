// Issue #126 — chunked upload for video/audio past the one-shot cap.
//
// Boots a real server per case (like video-asset.test.ts) with tiny chunk / cap
// / budget overrides so every limit is reachable with KB-sized fixtures. The
// properties pinned here are the security ones: fixed chunk sizes, the sniff on
// the REASSEMBLED stream, the budget reserved up front and always released, and
// no session scratch under the versioned `assets/` tree.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CHUNK = 1024;
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** A valid-headed MP4 of `len` bytes with distinct content per `seed`. */
function mp4(len: number, seed = 1): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * 31 + seed) & 0xff;
  out.set([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')], 0);
  return out;
}

const BASE_ENV = {
  MAUDE_ASSET_CHUNK_BYTES: String(CHUNK),
  MAUDE_ASSET_MAX_VIDEO_BYTES: String(2 * CHUNK), // one-shot stays small
  MAUDE_ASSET_MAX_CHUNKED_BYTES: String(16 * CHUNK),
};

async function withServer(
  fn: (base: string, designRoot: string) => Promise<void>,
  extraEnv: Record<string, string> = {}
) {
  const sandbox = makeSandbox();
  const port = nextPort();
  const proc = await bootServer(sandbox.root, port, { ...BASE_ENV, ...extraEnv });
  try {
    await fn(`http://localhost:${port}`, sandbox.designRoot);
  } finally {
    await killProc(proc);
  }
}

const start = (base: string, totalSize: unknown) =>
  fetch(`${base}/_api/asset/chunk-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalSize }),
  });

const put = (base: string, session: string, index: number | string, body: Uint8Array) =>
  fetch(`${base}/_api/asset/chunk?session=${session}&index=${index}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });

const finish = (base: string, session: string) =>
  fetch(`${base}/_api/asset/chunk-finish?session=${session}`, { method: 'POST' });

async function open(base: string, totalSize: number) {
  const res = await start(base, totalSize);
  expect(res.status).toBe(201);
  return (await res.json()) as { session: string; chunkBytes: number; chunkCount: number };
}

async function uploadChunked(base: string, bytes: Uint8Array) {
  const s = await open(base, bytes.length);
  for (let i = 0; i < s.chunkCount; i++) {
    const res = await put(
      base,
      s.session,
      i,
      bytes.slice(i * s.chunkBytes, (i + 1) * s.chunkBytes)
    );
    expect(res.status).toBe(204);
  }
  return finish(base, s.session);
}

const chunkDirs = (designRoot: string) => {
  const root = join(designRoot, '_state', 'asset-chunks');
  return existsSync(root) ? readdirSync(root) : [];
};

describe('chunked asset upload', () => {
  test('reassembles byte-for-byte past the one-shot cap, under the same content address', async () => {
    await withServer(async (base, designRoot) => {
      const bytes = mp4(CHUNK * 3 + 100);
      // The one-shot route refuses this size…
      const oneShot = await fetch(`${base}/_api/asset`, { method: 'POST', body: bytes });
      expect(oneShot.status).toBe(413);
      // …the chunked one lands it.
      const res = await uploadChunked(base, bytes);
      expect(res.status).toBe(201);
      const { path } = (await res.json()) as { path: string };
      const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
      expect(path).toBe(`assets/${sha8}.mp4`);
      expect(new Uint8Array(readFileSync(join(designRoot, path)))).toEqual(bytes);
      // Nothing but the final file under assets/, and no session left behind.
      expect(readdirSync(join(designRoot, 'assets'))).toEqual([`${sha8}.mp4`]);
      expect(chunkDirs(designRoot)).toEqual([]);
    });
  });

  test('a chunked upload dedupes with the same bytes sent in one shot', async () => {
    await withServer(async (base) => {
      const bytes = mp4(CHUNK + 10, 7);
      const one = (await (
        await fetch(`${base}/_api/asset`, { method: 'POST', body: bytes })
      ).json()) as {
        path: string;
      };
      const chunked = (await (await uploadChunked(base, bytes)).json()) as { path: string };
      expect(chunked.path).toBe(one.path);
    });
  });

  test('chunk sizes are fixed: a short non-final chunk and an oversize chunk are refused', async () => {
    await withServer(async (base) => {
      const s = await open(base, CHUNK * 2 + 5);
      expect((await put(base, s.session, 0, mp4(CHUNK - 1))).status).toBe(400);
      expect((await put(base, s.session, 0, mp4(CHUNK + 1))).status).toBe(413);
      // The last chunk must be exactly the remainder.
      expect((await put(base, s.session, 2, new Uint8Array(4))).status).toBe(400);
      expect((await put(base, s.session, 2, new Uint8Array(5))).status).toBe(204);
    });
  });

  test('index and session are validated before anything touches disk', async () => {
    await withServer(async (base) => {
      const s = await open(base, CHUNK * 2);
      expect((await put(base, s.session, 2, mp4(CHUNK))).status).toBe(400); // out of range
      expect((await put(base, s.session, '-1', mp4(CHUNK))).status).toBe(400);
      expect((await put(base, s.session, '1e3', mp4(CHUNK))).status).toBe(400);
      expect((await put(base, '../../etc', 0, mp4(CHUNK))).status).toBe(400);
      expect((await put(base, 'a'.repeat(32), 0, mp4(CHUNK))).status).toBe(404);
      expect((await finish(base, 'b'.repeat(32))).status).toBe(404);
    });
  });

  test('chunk-start validates totalSize and the chunked ceiling', async () => {
    await withServer(async (base) => {
      expect((await start(base, 0)).status).toBe(400);
      expect((await start(base, -5)).status).toBe(400);
      expect((await start(base, 1.5)).status).toBe(400);
      expect((await start(base, '100')).status).toBe(400);
      expect((await start(base, 16 * CHUNK + 1)).status).toBe(413);
    });
  });

  test('finish with a missing chunk fails, cleans up, and releases the reservation', async () => {
    await withServer(
      async (base, designRoot) => {
        const s = await open(base, CHUNK * 3);
        await put(base, s.session, 0, mp4(CHUNK));
        await put(base, s.session, 2, mp4(CHUNK));
        expect((await finish(base, s.session)).status).toBe(400);
        expect(chunkDirs(designRoot)).toEqual([]);
        // The session is gone…
        expect((await put(base, s.session, 1, mp4(CHUNK))).status).toBe(404);
        // …and its 3 KB came back: a full-budget session opens again.
        expect((await start(base, CHUNK * 4)).status).toBe(201);
      },
      { MAUDE_ASSET_SESSION_BUDGET: String(CHUNK * 4) }
    );
  });

  test('the sniff runs on the reassembled stream — SVG split across chunks is refused', async () => {
    await withServer(async (base, designRoot) => {
      const svg = new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg"><script>${'x'.repeat(CHUNK * 2)}</script></svg>`
      );
      expect((await uploadChunked(base, svg)).status).toBe(415);
      expect(
        existsSync(join(designRoot, 'assets'))
          ? readdirSync(join(designRoot, 'assets')).filter((f) => !f.startsWith('.tmp-'))
          : []
      ).toEqual([]);
      expect(chunkDirs(designRoot)).toEqual([]);
    });
  });

  test('a fake ftyp head in chunk 1 does not turn an unknown chunk 0 into video', async () => {
    await withServer(async (base) => {
      const bytes = new Uint8Array(CHUNK * 2);
      bytes.fill(0x41, 0, CHUNK); // "AAAA…" — not media
      bytes.set(mp4(CHUNK), CHUNK); // a valid MP4 head, but only from chunk 1
      expect((await uploadChunked(base, bytes)).status).toBe(415);
    });
  });

  test('images are not accepted through the chunk route', async () => {
    await withServer(async (base) => {
      const png = new Uint8Array(CHUNK + 10);
      png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      expect((await uploadChunked(base, png)).status).toBe(415);
    });
  });

  test('the budget is reserved at start and not counted twice at finish', async () => {
    await withServer(
      async (base) => {
        // 60% of the budget: would falsely 429 if finish re-charged the
        // reservation on top of itself.
        const bytes = mp4(CHUNK * 6, 3);
        expect((await uploadChunked(base, bytes)).status).toBe(201);
        // 6 KB written of 10 KB: another 6 KB cannot even open a session.
        expect((await start(base, CHUNK * 6)).status).toBe(429);
        expect((await start(base, CHUNK * 4)).status).toBe(201);
      },
      { MAUDE_ASSET_SESSION_BUDGET: String(CHUNK * 10) }
    );
  });

  test('open reservations count against one-shot writes too', async () => {
    await withServer(
      async (base) => {
        await open(base, CHUNK * 5);
        const oneShot = await fetch(`${base}/_api/asset`, { method: 'POST', body: mp4(CHUNK + 1) });
        expect(oneShot.status).toBe(429);
      },
      { MAUDE_ASSET_SESSION_BUDGET: String(CHUNK * 6) }
    );
  });

  test('open sessions are capped', async () => {
    await withServer(
      async (base) => {
        await open(base, CHUNK);
        await open(base, CHUNK);
        expect((await start(base, CHUNK)).status).toBe(429);
      },
      { MAUDE_ASSET_CHUNK_MAX_SESSIONS: '2' }
    );
  });

  test('concurrent chunk-starts cannot overrun the session cap or the budget', async () => {
    // Regression for the security review: the cap and budget checks used to sit
    // before an await, so N parallel starts all saw the same empty state.
    await withServer(
      async (base) => {
        const results = await Promise.all(Array.from({ length: 12 }, () => start(base, CHUNK * 4)));
        const opened = results.filter((r) => r.status === 201).length;
        expect(opened).toBe(2); // 8 KB budget / 4 KB each
        expect(results.filter((r) => r.status === 429).length).toBe(10);
      },
      { MAUDE_ASSET_SESSION_BUDGET: String(CHUNK * 8), MAUDE_ASSET_CHUNK_MAX_SESSIONS: '10' }
    );
    await withServer(
      async (base) => {
        const results = await Promise.all(Array.from({ length: 12 }, () => start(base, CHUNK)));
        expect(results.filter((r) => r.status === 201).length).toBe(3);
      },
      { MAUDE_ASSET_CHUNK_MAX_SESSIONS: '3' }
    );
  });

  test('a cross-site request is refused before it can open a session', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/_api/asset/chunk-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify({ totalSize: CHUNK }),
      });
      expect(res.status).toBe(403);
      // Same-origin / same-site and header-less callers still work.
      const same = await fetch(`${base}/_api/asset/chunk-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-site' },
        body: JSON.stringify({ totalSize: CHUNK }),
      });
      expect(same.status).toBe(201);
    });
  });

  test('a second write while one is streaming is refused, and so is finish', async () => {
    await withServer(async (base) => {
      const s = await open(base, CHUNK * 2);
      // Hold chunk 0 open: a stream that delivers half the bytes, then waits.
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const slow = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(mp4(CHUNK / 2));
          await gate;
          controller.enqueue(new Uint8Array(CHUNK / 2));
          controller.close();
        },
      });
      const first = fetch(`${base}/_api/asset/chunk?session=${s.session}&index=0`, {
        method: 'POST',
        body: slow,
        // @ts-expect-error — Bun/undici streaming request body
        duplex: 'half',
      });
      await Bun.sleep(150);
      expect((await put(base, s.session, 1, mp4(CHUNK))).status).toBe(409);
      expect((await finish(base, s.session)).status).toBe(409);
      release();
      expect((await first).status).toBe(204);
      expect((await put(base, s.session, 1, mp4(CHUNK))).status).toBe(204);
      expect((await finish(base, s.session)).status).toBe(201);
    });
  });

  test('a session that never receives a chunk is dropped after the short empty TTL', async () => {
    await withServer(
      async (base) => {
        const s = await open(base, CHUNK * 4);
        await Bun.sleep(1200);
        expect((await start(base, CHUNK * 4)).status).toBe(201);
        expect((await put(base, s.session, 0, mp4(CHUNK))).status).toBe(404);
      },
      {
        MAUDE_ASSET_SESSION_BUDGET: String(CHUNK * 4),
        MAUDE_ASSET_CHUNK_EMPTY_SESSION_TTL_MS: '1000',
      }
    );
  });

  test('DELETE aborts a session and releases its reservation', async () => {
    await withServer(
      async (base, designRoot) => {
        const s = await open(base, CHUNK * 4);
        await put(base, s.session, 0, mp4(CHUNK));
        const del = await fetch(`${base}/_api/asset/chunk?session=${s.session}`, {
          method: 'DELETE',
        });
        expect(del.status).toBe(204);
        expect(chunkDirs(designRoot)).toEqual([]);
        expect((await start(base, CHUNK * 4)).status).toBe(201);
      },
      { MAUDE_ASSET_SESSION_BUDGET: String(CHUNK * 4) }
    );
  });

  test('an idle session is swept and its reservation released', async () => {
    await withServer(
      async (base, designRoot) => {
        const s = await open(base, CHUNK * 4);
        await Bun.sleep(1200);
        // The next chunk-start sweeps the idle session before reserving.
        expect((await start(base, CHUNK * 4)).status).toBe(201);
        expect(chunkDirs(designRoot)).not.toContain(s.session);
        expect((await put(base, s.session, 0, mp4(CHUNK))).status).toBe(404);
      },
      { MAUDE_ASSET_SESSION_BUDGET: String(CHUNK * 4), MAUDE_ASSET_CHUNK_SESSION_TTL_MS: '1000' }
    );
  });

  test('an orphan dir from an earlier process is swept once idle past the TTL', async () => {
    const sandbox = makeSandbox();
    const orphan = join(sandbox.designRoot, '_state', 'asset-chunks', 'c'.repeat(32));
    mkdirSync(orphan, { recursive: true });
    const past = new Date(Date.now() - 60_000);
    utimesSync(orphan, past, past);
    const port = nextPort();
    const proc = await bootServer(sandbox.root, port, {
      ...BASE_ENV,
      MAUDE_ASSET_CHUNK_SESSION_TTL_MS: '1000',
    });
    try {
      // Boot sweeps it; a chunk-start would too — assert after one to be certain.
      await start(`http://localhost:${port}`, CHUNK);
      expect(existsSync(orphan)).toBe(false);
    } finally {
      await killProc(proc);
    }
  });
});
