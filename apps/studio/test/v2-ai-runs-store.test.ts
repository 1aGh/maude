// S5.11 — the tab's run store: reads GET /_api/ai/runs, re-reads when the registry moves, posts the run verbs.
import { describe, expect, test } from 'bun:test';
import { createRunsStore, RUNS_EVENT } from '../client/v2/ai/runs-store.js';

type Call = { url: string; init?: RequestInit };

function rig(replies: Array<Record<string, unknown> | 'fail'>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'POST')
      return new Response(JSON.stringify({ run: null }), { status: 200 });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r === 'fail') return new Response('nope', { status: 500 });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const reads = (calls: Call[]) => calls.filter((c) => c.init?.method !== 'POST').length;

describe('the run store', () => {
  test('start() reads once; the snapshot carries mine / others / counts', async () => {
    const { calls, fetchImpl } = rig([
      { seq: 3, mine: [{ runId: 'r_aaaaaa', state: 'running' }], others: [], needsYou: 0, live: 1 },
    ]);
    const target = new EventTarget() as unknown as Window;
    const store = createRunsStore({ fetchImpl, target });
    store.start();
    await settle();
    expect(calls[0].url).toBe('/_api/ai/runs');
    expect(store.getSnapshot().loaded).toBe(true);
    expect(store.getSnapshot().view.mine).toHaveLength(1);
    expect(store.getSnapshot().view.live).toBe(1);
  });

  test('the shell event re-reads only when the registry moved on', async () => {
    const { calls, fetchImpl } = rig([
      { seq: 3, mine: [], others: [] },
      { seq: 5, mine: [{ runId: 'r_bbbbbb', state: 'running' }], others: [] },
    ]);
    const target = new EventTarget() as unknown as Window;
    const store = createRunsStore({ fetchImpl, target });
    store.start();
    await settle();
    target.dispatchEvent(new CustomEvent(RUNS_EVENT, { detail: { seq: 3 } })); // nothing new
    await settle();
    expect(reads(calls)).toBe(1);
    target.dispatchEvent(new CustomEvent(RUNS_EVENT, { detail: { seq: 5 } }));
    await settle();
    expect(reads(calls)).toBe(2);
    expect(store.getSnapshot().view.mine).toHaveLength(1);
  });

  test('a late answer older than what it holds is dropped', async () => {
    const { fetchImpl } = rig([
      { seq: 9, mine: [{ runId: 'r_cccccc', state: 'running' }], others: [] },
      { seq: 4, mine: [], others: [] },
    ]);
    const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
    await store.refresh();
    await store.refresh();
    expect(store.getSnapshot().view.seq).toBe(9);
    expect(store.getSnapshot().view.mine).toHaveLength(1);
  });

  test('an old server (500) leaves the empty list, not an error', async () => {
    const { fetchImpl } = rig(['fail']);
    const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
    await store.refresh();
    expect(store.getSnapshot().view.mine).toEqual([]);
    expect(store.getSnapshot().loaded).toBe(false);
  });

  test('stop / cancel / keep-going / copy post to the run routes, then re-read', async () => {
    const { calls, fetchImpl } = rig([{ seq: 1, mine: [], others: [] }]);
    const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
    await store.stop('r_dddddd');
    await store.cancel('r_dddddd');
    await store.keepGoing('r_dddddd');
    await store.copy('r_dddddd');
    await settle();
    const posts = calls.filter((c) => c.init?.method === 'POST').map((c) => c.url);
    expect(posts).toEqual([
      '/_api/ai/runs/r_dddddd/stop',
      '/_api/ai/runs/r_dddddd/cancel',
      '/_api/ai/runs/r_dddddd/keep-going',
      '/_api/ai/runs/r_dddddd/copy',
    ]);
    expect(reads(calls)).toBeGreaterThanOrEqual(1);
  });

  test('a refused verb reports its code, and an unreachable server reports offline', async () => {
    const refused = (async () =>
      new Response(JSON.stringify({ code: 'state' }), { status: 409 })) as unknown as typeof fetch;
    const s1 = createRunsStore({
      fetchImpl: refused,
      target: new EventTarget() as unknown as Window,
    });
    expect(await s1.cancel('r_eeeeee')).toMatchObject({ ok: false, status: 409, code: 'state' });
    const down = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const s2 = createRunsStore({ fetchImpl: down, target: new EventTarget() as unknown as Window });
    expect(await s2.stop('r_eeeeee')).toMatchObject({ ok: false, code: 'offline' });
  });

  test('markDone settles a ring for a while, then lets go', async () => {
    const timers: Array<() => void> = [];
    const { fetchImpl } = rig([{ seq: 1, mine: [], others: [] }]);
    const store = createRunsStore({
      fetchImpl,
      target: new EventTarget() as unknown as Window,
      setTimer: (fn: () => void) => timers.push(fn),
    });
    store.markDone(['post']);
    expect(store.getSnapshot().done).toEqual({ post: true });
    timers[0]();
    expect(store.getSnapshot().done).toEqual({});
  });
});
