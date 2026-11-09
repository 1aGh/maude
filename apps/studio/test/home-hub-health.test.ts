// 2.1.1 B4 — Home's per-server sign-in health: is the saved sign-in still accepted, or does the
// server not answer at all? One cached, authenticated GET /api/documents per server (the route the
// sync client itself uses); the token goes only to the address it was saved against and never comes
// back out. A fake fetch stands in for the server — nothing here touches the network.

import { describe, expect, test } from 'bun:test';

import { createHubHealth } from '../home/hub-health.ts';

type Call = { url: string; auth: string | null; redirect: string | undefined };

function fake(answer: (url: string) => Response | Error) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    calls.push({ url: String(input), auth: h.get('authorization'), redirect: init.redirect });
    const a = answer(String(input));
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('hub health', () => {
  test('200 → ok, 401 → rejected, no answer / 5xx → unreachable, an old hub (404) → unknown', async () => {
    const a = fake((u) =>
      u.startsWith('https://ok.')
        ? Response.json({ documents: [] })
        : u.startsWith('https://bad.')
          ? new Response('no', { status: 401 })
          : u.startsWith('https://old.')
            ? new Response('nope', { status: 404 })
            : u.startsWith('https://sick.')
              ? new Response('boom', { status: 503 })
              : new Error('ECONNREFUSED')
    );
    const h = createHubHealth({ fetchImpl: a.fetchImpl });
    expect(await h.state('https://ok.example', 't1')).toBe('ok');
    expect(await h.state('https://bad.example', 't2')).toBe('rejected');
    expect(await h.state('https://old.example', 't3')).toBe('unknown');
    expect(await h.state('https://sick.example', 't4')).toBe('unreachable');
    expect(await h.state('https://down.example', 't5')).toBe('unreachable');
  });

  test('asks once per server inside the cache window, again after it, and again for a new token', async () => {
    let now = 1_000;
    const a = fake(() => Response.json({ documents: [] }));
    const h = createHubHealth({ fetchImpl: a.fetchImpl, now: () => now, ttlMs: 60_000 });
    await Promise.all([h.state('https://a.example', 'tok'), h.state('https://a.example', 'tok')]);
    await h.state('https://a.example', 'tok');
    expect(a.calls.length).toBe(1);
    await h.state('https://a.example', 'other-token');
    expect(a.calls.length).toBe(2);
    now += 61_000;
    await h.state('https://a.example', 'other-token');
    expect(a.calls.length).toBe(3);
  });

  test('sends the token only to the saved address, follows no redirect, and never returns it', async () => {
    const a = fake(() => Response.json({ documents: [] }));
    const h = createHubHealth({ fetchImpl: a.fetchImpl });
    const r = await h.state('https://hub.example', 'SECRET-TOKEN');
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(a.calls[0]).toEqual({
      url: 'https://hub.example/api/documents',
      auth: 'Bearer SECRET-TOKEN',
      redirect: 'error',
    });
  });

  test('an address that is not https (or loopback) is never sent a token', async () => {
    const a = fake(() => Response.json({ documents: [] }));
    const h = createHubHealth({ fetchImpl: a.fetchImpl });
    expect(await h.state('http://hub.example', 'tok')).toBe('unknown');
    expect(await h.state('https://u:p@hub.example', 'tok')).toBe('unknown');
    expect(a.calls.length).toBe(0);
    expect(await h.state('http://127.0.0.1:4401', 'tok')).toBe('ok');
    expect(a.calls.length).toBe(1);
  });
});
