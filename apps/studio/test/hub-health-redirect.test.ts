// gate-b-sec1 A5 — `hubHealth` (the capability probe every library link and sync start makes) never follows a
// redirect: a hub that bounces `/health` elsewhere (an internal http address, from a cell) reads as a hub with no
// capabilities, and the second address is never asked.
import { afterAll, describe, expect, test } from 'bun:test';

import { hubHealth } from '../sync/journal-client.ts';

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
    expect(h).toEqual({ capabilities: null, formatVersion: null });
    expect(inner).toEqual([]);
  });
});
