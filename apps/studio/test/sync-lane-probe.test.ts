// 2.0.5 hotfix — the file lane is decided from an ANSWER, never from a timeout.
//
// Field report (2026-11-05): the boot's single 4 s `/health` probe timed out
// against a busy ledger hub, the runtime read the silence as "no journal", and
// the whole boot ran the legacy v1 pull lane — the loop that pinned a core.

import { describe, expect, test } from 'bun:test';

import { hubHealth, probeFileLane } from '../sync/journal-client.ts';

const noSleep = async () => {};

/** A hub whose first `n` health answers never come (an abort-honouring hang). */
function slowThenAnswers(n: number, body: unknown, status = 200) {
  let calls = 0;
  const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls <= n) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('The operation timed out.'))
        );
      });
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

describe('probeFileLane', () => {
  test('health times out once, then answers with ledger → the file plane', async () => {
    const hub = slowThenAnswers(1, {
      capabilities: ['ledger', 'annotations-v2'],
      formatVersion: 2,
    });
    const r = await probeFileLane({
      hubUrl: 'http://hub.test',
      fetchImpl: hub.fetchImpl,
      timeoutMs: 20,
      sleep: noSleep,
    });
    expect(r.lane).toBe('plane');
    expect(r.capabilities).toContain('ledger');
    expect(r.formatVersion).toBe(2);
    expect(hub.calls()).toBe(2);
  });

  test('a hub that never answers is unknown — never legacy', async () => {
    const hub = slowThenAnswers(99, {});
    const r = await probeFileLane({
      hubUrl: 'http://hub.test',
      fetchImpl: hub.fetchImpl,
      timeoutMs: 10,
      sleep: noSleep,
    });
    expect(r.lane).toBe('unknown');
    expect(hub.calls()).toBe(3);
  });

  test('a 503 is not an answer; a hub answering without ledger is legacy', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return n === 1
        ? new Response('busy', { status: 503 })
        : new Response(JSON.stringify({ capabilities: ['annotations-v2'] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await probeFileLane({ hubUrl: 'http://hub.test', fetchImpl, sleep: noSleep });
    expect(r.lane).toBe('legacy');
    expect(n).toBe(2);
  });

  test('a hub with no /health route (404) has answered: legacy', async () => {
    const fetchImpl = (async () => new Response('nf', { status: 404 })) as unknown as typeof fetch;
    const r = await probeFileLane({ hubUrl: 'http://hub.test', fetchImpl, sleep: noSleep });
    expect(r.lane).toBe('legacy');
  });
});

describe('hubHealth says whether the hub answered', () => {
  test('a timeout is not an answer', async () => {
    const hub = slowThenAnswers(1, {});
    const h = await hubHealth({
      hubUrl: 'http://hub.test',
      fetchImpl: hub.fetchImpl,
      timeoutMs: 10,
    });
    expect(h.answered).toBe(false);
    expect(h.capabilities).toBeNull();
  });
});
