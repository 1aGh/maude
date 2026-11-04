// #166 (2.0.4, R3) — the ⌘Z collision check has one deadline, but the hub reads under it could
// not be aborted (each ran to its own 20 s transport timeout after the check had already answered)
// and their size was not capped while they streamed in. Now:
//   · the check hands every blob / head read an AbortSignal, aborted at the deadline and as soon as
//     the check returns — a read still in flight ends then;
//   · the transaction client's read takes that signal and a byte cap, enforced on the stream: past
//     the cap the body is cancelled and the read refuses (unreadable = "no conflict", fail open).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hubTextUndoConflict } from '../sync/hub-text-undo.ts';
import { createTransactionClient } from '../sync/transaction-client.ts';

const H = (c: string) => c.repeat(64);

describe('the collision check aborts its hub reads (R3)', () => {
  test('a blob read still in flight at the deadline is aborted', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const started = Date.now();
    const verdict = await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: async () => ({
          effects: [{ doc: 'd1', lane: 'annotations', beforeHash: H('a'), afterHash: H('b') }],
        }),
        // a hub that never answers on its own — only an abort ends the read
        blob: (_hash, signal) =>
          new Promise<string | null>((resolve) => {
            signals.push(signal);
            signal?.addEventListener('abort', () => resolve(null));
          }),
        head: async () => '',
      },
      { deadlineMs: 40 }
    );
    expect(verdict).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(signals.length).toBe(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  test('a check that answers before the deadline aborts nothing it still needed, and frees the rest', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    await hubTextUndoConflict(
      { actionId: 'a1' },
      {
        action: async () => ({
          effects: [{ doc: 'd1', lane: 'annotations', beforeHash: H('a'), afterHash: H('b') }],
        }),
        blob: async (hash, signal) => {
          signals.push(signal);
          expect(signal?.aborted).toBe(false); // live while the check runs
          return hash === H('a') ? 'one' : 'two';
        },
        head: async (_doc, signal) => {
          signals.push(signal);
          return 'two';
        },
      },
      { deadlineMs: 5000 }
    );
    expect(signals.length).toBe(3);
    expect(signals.every((s) => s?.aborted === true)).toBe(true); // released once the check returned
  });
});

describe('the transaction client read: abort signal + streamed byte cap (R3)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  let served = 0;
  const hub = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.endsWith('/v1/bootstrap'))
        return Response.json({ projectId: 'p1', mode: 'transactions', epoch: 1, docs: [] });
      if (pathname.includes('/v1/blobs/huge')) {
        // a body that streams far past any cap, with no content-length to refuse it up front
        served = 0;
        const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
        let n = 0;
        return new Response(
          new ReadableStream({
            async pull(c) {
              if (n++ === 0) c.enqueue(new TextEncoder().encode('{"body":"'));
              if (n > 400) return c.close(); // ~25 MB if read to the end
              served += chunk.length;
              c.enqueue(chunk);
              await Bun.sleep(1);
            },
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      }
      if (pathname.includes('/v1/blobs/slow'))
        return Bun.sleep(5000).then(() => Response.json({ body: 'late' }));
      if (pathname.includes('/v1/blobs/small')) return Response.json({ body: 'ok' });
      return new Response('no', { status: 404 });
    },
  });
  afterAll(() => hub.stop(true));

  const client = () => {
    const designRoot = mkdtempSync(join(tmpdir(), 'tx-read-cap-'));
    dirs.push(designRoot);
    return createTransactionClient({
      hubUrl: `http://127.0.0.1:${hub.port}`,
      token: () => 't',
      designRoot,
    });
  };

  test('a body past the cap is cancelled while it streams, and the read refuses', async () => {
    const c = client();
    await expect(c.read('blobs/huge', {}, { maxBytes: 256 * 1024 })).rejects.toThrow();
    await Bun.sleep(50);
    expect(served).toBeLessThan(4 * 1024 * 1024);
  });

  test('a small body under the cap reads as before', async () => {
    const c = client();
    expect(await c.read('blobs/small', {}, { maxBytes: 256 * 1024 })).toEqual({ body: 'ok' });
  });

  test('an aborted signal ends a read the hub is still holding', async () => {
    const c = client();
    await c.bootstrap();
    const ctl = new AbortController();
    const t0 = Date.now();
    const p = c.read('blobs/slow', {}, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 30);
    await expect(p).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
