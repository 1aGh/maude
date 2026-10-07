// Issue #126 — the shared upload client. Pure decisions + the request sequence,
// against a scripted fetch; the server side is pinned in video-asset-chunked.

import { describe, expect, test } from 'bun:test';

import { CHUNK_THRESHOLD, chunkRanges, shouldChunk, uploadAsset } from '../asset-upload.ts';

type Call = { url: string; method: string; size: number };

/** A fetch that records every call and answers from `reply`. */
function scripted(reply: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    let size = 0;
    if (body instanceof Blob) size = body.size;
    else if (body instanceof Uint8Array) size = body.byteLength;
    else if (typeof body === 'string') size = body.length;
    const call = { url: String(input), method: init?.method ?? 'GET', size };
    calls.push(call);
    return reply(call, calls.length);
  }) as typeof fetch;
  return { calls, impl };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A source that claims a big size without allocating it. */
function bigSource(size: number, type = 'video/mp4') {
  const reads: Array<[number, number]> = [];
  return {
    reads,
    source: {
      size,
      type,
      async read(start: number, end: number) {
        reads.push([start, end]);
        return new Uint8Array(end - start);
      },
    },
  };
}

describe('asset-upload / decisions', () => {
  test('only large non-image media takes the chunked path', () => {
    expect(shouldChunk(CHUNK_THRESHOLD, 'video/mp4')).toBe(false);
    expect(shouldChunk(CHUNK_THRESHOLD + 1, 'video/mp4')).toBe(true);
    expect(shouldChunk(CHUNK_THRESHOLD + 1, 'audio/wav')).toBe(true);
    // Untyped (a native pick with an unknown ext) — the server sniffs anyway.
    expect(shouldChunk(CHUNK_THRESHOLD + 1, '')).toBe(true);
    expect(shouldChunk(CHUNK_THRESHOLD * 4, 'image/png')).toBe(false);
  });

  test('chunk ranges tile the file exactly', () => {
    expect(chunkRanges(10, 4)).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ]);
    expect(chunkRanges(8, 4)).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(chunkRanges(3, 4)).toEqual([[0, 3]]);
  });
});

describe('asset-upload / request sequence', () => {
  test('a small file is one POST to /_api/asset', async () => {
    const { calls, impl } = scripted(() => json(201, { path: 'assets/deadbeef.mp4' }));
    const res = await uploadAsset(new Blob([new Uint8Array(10)], { type: 'video/mp4' }), {
      fetchImpl: impl,
    });
    expect(res).toEqual({ path: 'assets/deadbeef.mp4' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /_api/asset']);
  });

  test('a large clip: start → every chunk in order → finish, with progress', async () => {
    const size = CHUNK_THRESHOLD + 5;
    const chunkBytes = 16 * 1024 * 1024;
    const { calls, impl } = scripted((c) => {
      if (c.url === '/_api/asset/chunk-start') return json(201, { session: 's1', chunkBytes });
      if (c.url.startsWith('/_api/asset/chunk-finish'))
        return json(201, { path: 'assets/cafebabe.mp4' });
      return new Response(null, { status: 204 });
    });
    const { source, reads } = bigSource(size);
    const progress: number[] = [];
    const res = await uploadAsset(source, { fetchImpl: impl, onProgress: (f) => progress.push(f) });
    expect(res).toEqual({ path: 'assets/cafebabe.mp4' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /_api/asset/chunk-start',
      'POST /_api/asset/chunk?session=s1&index=0',
      'POST /_api/asset/chunk?session=s1&index=1',
      'POST /_api/asset/chunk?session=s1&index=2',
      'POST /_api/asset/chunk-finish?session=s1',
    ]);
    expect(reads).toEqual([
      [0, chunkBytes],
      [chunkBytes, 2 * chunkBytes],
      [2 * chunkBytes, size],
    ]);
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });

  test('a transient chunk failure is retried; a hard one aborts the session', async () => {
    const chunkBytes = 16 * 1024 * 1024;
    const retried = scripted((c, n) => {
      if (c.url === '/_api/asset/chunk-start') return json(201, { session: 's2', chunkBytes });
      if (c.url.includes('index=0') && n === 2) return json(500, { error: 'disk hiccup' });
      if (c.url.startsWith('/_api/asset/chunk-finish')) return json(201, { path: 'assets/x.mp4' });
      return new Response(null, { status: 204 });
    });
    expect(
      await uploadAsset(bigSource(CHUNK_THRESHOLD + 1).source, { fetchImpl: retried.impl })
    ).toEqual({ path: 'assets/x.mp4' });
    expect(retried.calls.filter((c) => c.url.includes('index=0')).length).toBe(2);

    const hard = scripted((c) => {
      if (c.url === '/_api/asset/chunk-start') return json(201, { session: 's3', chunkBytes });
      if (c.url.includes('index=1')) return json(413, { error: 'chunk exceeds its size' });
      return new Response(null, { status: 204 });
    });
    expect(
      await uploadAsset(bigSource(CHUNK_THRESHOLD + 1).source, { fetchImpl: hard.impl })
    ).toEqual({ error: 'chunk exceeds its size' });
    // No retry of a 4xx, then the session is released.
    expect(hard.calls.filter((c) => c.url.includes('index=1')).length).toBe(1);
    expect(hard.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      url: '/_api/asset/chunk?session=s3',
    });
  });

  test('a refused chunk-start surfaces the server message', async () => {
    const { impl } = scripted(() => json(413, { error: 'media exceeds the 512 MB cap' }));
    expect(await uploadAsset(bigSource(CHUNK_THRESHOLD + 1).source, { fetchImpl: impl })).toEqual({
      error: 'media exceeds the 512 MB cap',
    });
  });

  test('chunked uploads run one at a time', async () => {
    const chunkBytes = 64 * 1024 * 1024;
    let open = 0;
    let maxOpen = 0;
    const { impl } = scripted(async (c) => {
      if (c.url === '/_api/asset/chunk-start') {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        return json(201, { session: `s${Math.random()}`, chunkBytes });
      }
      if (c.url.startsWith('/_api/asset/chunk-finish')) {
        await Bun.sleep(5);
        open -= 1;
        return json(201, { path: 'assets/y.mp4' });
      }
      return new Response(null, { status: 204 });
    });
    await Promise.all(
      [1, 2, 3].map(() => uploadAsset(bigSource(CHUNK_THRESHOLD + 1).source, { fetchImpl: impl }))
    );
    expect(maxOpen).toBe(1);
  });
});
