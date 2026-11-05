// gate-b-sec1 A5 — `hubHealth` (the capability probe every library link and sync start makes) never follows a
// redirect: a hub that bounces `/health` elsewhere (an internal http address, from a cell) reads as a hub with no
// capabilities, and the second address is never asked.
import { afterAll, describe, expect, test } from 'bun:test';

import { hubHealth, probeFileLane } from '../sync/journal-client.ts';

const inner: string[] = [];
const target = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    inner.push(new URL(req.url).pathname);
    return Response.json({ capabilities: ['ledger', 'ds-library'], formatVersion: 2 });
  },
});
const bouncer = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () =>
    new Response(null, { status: 302, headers: { location: `${target.url.origin}/health` } }),
});

afterAll(() => {
  target.stop(true);
  bouncer.stop(true);
});

describe('hubHealth', () => {
  test('reads a hub’s own /health', async () => {
    const h = await hubHealth({ hubUrl: target.url.origin });
    expect(h.capabilities).toEqual(['ledger', 'ds-library']);
  });

  test('a redirect is never followed: no capabilities, the second address is never asked', async () => {
    inner.length = 0;
    const h = await hubHealth({ hubUrl: bouncer.url.origin });
    // a bounce is not the hub's own answer (2.0.5 `answered`): the lane probe asks again later, never elsewhere
    expect(h).toEqual({ capabilities: null, formatVersion: null, answered: false });
    expect(inner).toEqual([]);
  });

  test('the lane probe retries (2.0.5) but never follows the bounce either: no lane, the second address never asked', async () => {
    inner.length = 0;
    let bounced = 0;
    const counting = (async (u: string | URL | Request, init?: RequestInit) => {
      bounced++;
      return fetch(u, init);
    }) as unknown as typeof fetch;
    const r = await probeFileLane({
      hubUrl: bouncer.url.origin,
      fetchImpl: counting,
      attempts: 3,
      sleep: async () => {},
    });
    expect(r).toEqual({ lane: 'unknown', capabilities: null, formatVersion: null });
    expect(bounced).toBe(3); // every attempt asks the hub's own address …
    expect(inner).toEqual([]); // … and none reaches the one it bounces to
  });
});
