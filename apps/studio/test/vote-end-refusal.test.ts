// The vote bar's End vote (vote-store `end()` → POST /_api/votes/end): a refused end says why, a retry
// posts again, and an allowed end closes the bar at once — before the next poll, even when that read
// still lists the vote as open (an-vote lane, T2.6c: "the bar stayed after End vote" with no word why).

import { describe, expect, test } from 'bun:test';
import { createVoteStore, VOTE_WORDS } from '../client/v2/annotations/vote-store.js';

const FILE = '.design/ui/jerseys.tsx';
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const OPEN = {
  id: 'v_abc12345',
  targets: ['ab:a', 'ab:b', 'ab:c'],
  title: 'Helmy',
  perVoter: 3,
  state: 'open',
  startedAt: T0,
  endsAt: T0 + 120_000,
  done: ['Alice', 'Bob'],
};
const ENDED = { ...OPEN, state: 'ended', tallies: { 'ab:a': 3 } };

type Answer = { status: number; json: unknown };

function server(endAnswer: () => Answer, listAnswer: () => Answer) {
  const ends: unknown[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith('/end')) {
      ends.push(JSON.parse(String(init.body)));
      const a = endAnswer();
      return { status: a.status, json: async () => a.json };
    }
    const a = listAnswer();
    return { status: a.status, json: async () => a.json };
  }) as unknown as typeof fetch;
  return { ends, fetchImpl };
}

async function openStore(srv: ReturnType<typeof server>) {
  const lines: string[] = [];
  const store = createVoteStore({
    fetchImpl: srv.fetchImpl,
    now: () => T0 + 1000,
    notify: (l) => lines.push(l),
    setTimer: (() => 0) as never,
    clearTimer: () => {},
  });
  store.setRole({ canEdit: true, canVote: true });
  store.setFile(FILE);
  await store.load();
  expect(store.get().vote?.state).toBe('open');
  return { store, lines };
}

const list = (vote: unknown) => () => ({
  status: 200,
  json: { ok: true, mode: 'hub', votes: [vote], mine: {}, me: 'Bob' },
});

describe('End vote', () => {
  test('a refused end says why (the server’s line) and the next press posts again', async () => {
    let refuse = true;
    const srv = server(
      () =>
        refuse
          ? {
              status: 503,
              json: { ok: false, code: 'unreachable', line: 'The team server is away.' },
            }
          : { status: 200, json: { ok: true, vote: ENDED } },
      () => list(refuse ? OPEN : ENDED)()
    );
    const { store, lines } = await openStore(srv);
    await store.end();
    expect(srv.ends).toHaveLength(1);
    expect(lines).toContain('The team server is away.');
    expect(store.get().vote?.state).toBe('open'); // nothing ended: the bar stays, and says so
    refuse = false;
    await store.end();
    expect(srv.ends).toHaveLength(2); // the second press is not swallowed
    expect(store.get().vote?.state).toBe('ended');
  });

  test('a refusal without a line still says something', async () => {
    const srv = server(() => ({ status: 500, json: null }), list(OPEN));
    const { store, lines } = await openStore(srv);
    await store.end();
    expect(lines).toContain(VOTE_WORDS.endFailed);
  });

  test('an allowed end closes the bar even when the next read still lists the vote open', async () => {
    const srv = server(() => ({ status: 200, json: { ok: true, vote: ENDED } }), list(OPEN));
    const { store, lines } = await openStore(srv);
    await store.end();
    expect(srv.ends).toHaveLength(1);
    expect(store.get().vote?.state).toBe('ended');
    expect(lines).toContain(VOTE_WORDS.ended);
  });
});
