// sec-a M2 (wave-A defender) — the canvas can no longer cast the viewer's ballot (lead decision
// `v2-lead-ballots-commit-in-shell`): a `vote-cast` moves a PENDING pick in the shell's vote store;
// only the vote bar's Cast button posts /_api/votes/ballot. Plus C1(e): a canvas `vote-board
// {open:true}` opens the Start-a-vote sheet only when the shell asked for it (⌘K / a menu).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import VoteHost from '../client/v2/annotations/vote-bar.jsx';
import { createVoteStore } from '../client/v2/annotations/vote-store.js';

const FILE = '.design/ui/jerseys.tsx';
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const VOTE = {
  id: 'v_abc12345',
  targets: ['ab:a', 'ab:b', 'ab:c'],
  title: '',
  perVoter: 3,
  state: 'open',
  startedAt: T0,
  endsAt: T0 + 120_000,
  done: [],
};

function fakeServer() {
  const posts: Array<{ url: string; body: any }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === 'POST') posts.push({ url, body });
    const json =
      init?.method === 'POST'
        ? { ok: true, vote: VOTE, mine: body?.picks ?? {} }
        : { ok: true, mode: 'local', votes: [VOTE], mine: {}, me: 'You' };
    return { status: 200, json: async () => json };
  }) as unknown as typeof fetch;
  return { posts, fetchImpl };
}

async function openStore() {
  const srv = fakeServer();
  let clock = T0 + 1000;
  const store = createVoteStore({
    fetchImpl: srv.fetchImpl,
    now: () => clock,
    setTimer: (() => 0) as never,
    clearTimer: () => {},
  });
  store.setRole({ canEdit: true, canVote: true });
  store.setFile(FILE);
  await store.load();
  return { store, srv, tick: (ms: number) => (clock += ms) };
}

describe('sec-a M2 — canvas dots are pending until Cast', () => {
  test('a burst of picks posts nothing; Cast posts the pending picks once', async () => {
    const { store, srv } = await openStore();
    for (let i = 0; i < 20; i++) store.pick(i % 2 ? 'a' : 'b', 1);
    expect(srv.posts.filter((p) => p.url.endsWith('/ballot'))).toHaveLength(0);
    // the budget held: 3 dots, never more
    const pending = store.get().pending as Record<string, number>;
    expect(Object.values(pending).reduce((s, n) => s + n, 0)).toBe(3);
    expect(store.get().mine).toEqual({});
    const r = await store.cast();
    expect(r.ok).toBe(true);
    const ballots = srv.posts.filter((p) => p.url.endsWith('/ballot'));
    expect(ballots).toHaveLength(1);
    expect(ballots[0]?.body.picks).toEqual(pending);
    expect(store.get().pending).toBeNull();
  });

  test('Clear drops the pending picks; nothing is posted', async () => {
    const { store, srv } = await openStore();
    store.pick('a', 1);
    store.clearPending();
    expect(store.get().pending).toBeNull();
    expect((await store.cast()).ok).toBe(false);
    expect(srv.posts).toHaveLength(0);
  });

  test('the lane: vote-cast messages from the active canvas never POST; the bar Cast button does', async () => {
    const { store, srv } = await openStore();
    const win = { postMessage: () => {} };
    const frame = { contentWindow: win, src: 'http://canvas.test/_canvas-shell.html' };
    const iframesRef = { current: new Map([[FILE, frame]]) };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <VoteHost
          iframesRef={iframesRef}
          activePath={FILE}
          canEdit
          {...{ role: 'owner' }}
          notify={() => {}}
          store={store}
        />
      )
    );
    for (let i = 0; i < 10; i++) {
      const ev = new Event('message');
      Object.defineProperties(ev, {
        data: { value: { dgn: 'vote-cast', artboard: 'c' } },
        origin: { value: 'http://canvas.test' },
        source: { value: win },
      });
      await act(async () => {
        window.dispatchEvent(ev);
      });
    }
    expect(srv.posts).toHaveLength(0);
    expect(host.querySelector('[data-testid="vote-bar-left"]')?.textContent).toContain('0 left');
    const cast = host.querySelector('[data-testid="vote-bar-cast"]') as HTMLButtonElement | null;
    expect(cast).not.toBeNull();
    await act(async () => {
      cast?.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(srv.posts.filter((p) => p.url.endsWith('/ballot'))).toHaveLength(1);
    expect(host.querySelector('[data-testid="vote-bar-cast"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});

describe('sec-a C1(e) — the Start-a-vote sheet opens on a shell gesture only', () => {
  test('a canvas vote-board {open} asks first; after the shell ran Start a vote it opens', async () => {
    const { store, tick } = await openStore();
    const offers: unknown[] = [];
    store.setOffer((f: unknown) => offers.push(f));
    store.noteBoard({ artboards: [{ id: 'a', label: 'A', x: 0, y: 0, w: 1, h: 1 }], open: true });
    expect(store.get().sheet).toBeNull();
    expect(offers).toHaveLength(1);
    store.expectSheet();
    store.noteBoard({ artboards: [], open: true, focus: 'a' });
    expect(store.get().sheet).toEqual({ focus: 'a' });
    store.closeSheet();
    // the ask is spent once, and it expires
    store.noteBoard({ artboards: [], open: true });
    expect(store.get().sheet).toBeNull();
    store.expectSheet();
    tick(5000);
    store.noteBoard({ artboards: [], open: true });
    expect(store.get().sheet).toBeNull();
  });
});
