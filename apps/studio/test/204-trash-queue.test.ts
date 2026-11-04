// #194 (2.0.4) — "Move canvas to trash takes too long, or nothing happens for a while … moving several canvases
// one after another doesn't do anything". The trash queue (client/v2/canvases/trash-queue.js): the row says
// "Moving to trash…" at once, the server's yes takes the row out before the list re-reads, three quick moves
// all land in order, and a refusal brings the row back with the reason.

import { afterEach, describe, expect, test } from 'bun:test';

import { getRowSlots, resetRowSlots } from '../client/v2/canvases/row-slots.js';
import {
  createTrashQueue,
  queueTrashCanvas,
  TRASH_QUEUE_WORDS,
  withoutGone,
} from '../client/v2/canvases/trash-queue.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(check: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 2));
  expect(check()).toBe(true);
}

/** A DELETE /_api/canvas the test answers by hand, one per call, in call order. */
function manualServer() {
  const calls: Array<{ path: string; answer: (ok: boolean, error?: string) => void }> = [];
  const fetchImpl = ((url: string) => {
    const path = decodeURIComponent(String(url).split('file=')[1] || '');
    const d = deferred<Response>();
    calls.push({
      path,
      answer: (ok, error) =>
        d.resolve(
          new Response(
            JSON.stringify(
              ok
                ? { ok: true, rel: path, trashDir: `.design/_trash/x__${path}` }
                : { ok: false, error }
            ),
            { status: ok ? 200 : 409 }
          )
        ),
    });
    return d.promise;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

afterEach(() => resetRowSlots());

describe('#194 trash queue', () => {
  test('the row says “Moving to trash…” and fades the moment it is asked', async () => {
    const queue = createTrashQueue({ settleMs: 0 });
    const server = manualServer();
    const toasts: string[] = [];
    const done = queueTrashCanvas({
      queue,
      path: '.design/ui/Pricing.tsx',
      rel: 'ui/Pricing.tsx',
      label: 'Pricing',
      fetchImpl: server.fetchImpl,
      toast: (m: string) => toasts.push(m),
      reload: async () => {},
    });
    // before the server answered anything
    const slot = getRowSlots().slotFor('ui/Pricing.tsx');
    expect(slot?.sub?.text).toBe(TRASH_QUEUE_WORDS.moving);
    expect(slot?.sub?.icon).toBe('trash');
    expect(slot?.dim).toBe(true);
    expect(queue.stateOf('.design/ui/Pricing.tsx')).toBe('moving');
    expect(toasts).toEqual([]);
    await until(() => server.calls.length === 1);
    server.calls[0].answer(true);
    expect((await done).ok).toBe(true);
    expect(toasts).toEqual(['“Pricing” moved to the trash.']);
    // the pending words leave with the move
    expect(getRowSlots().slotFor('ui/Pricing.tsx')).toBeNull();
  });

  test('the server’s yes takes the row out before the list re-reads', async () => {
    const queue = createTrashQueue({ settleMs: 0 });
    const server = manualServer();
    const reload = deferred<void>();
    const toasts: string[] = [];
    const done = queueTrashCanvas({
      queue,
      path: '.design/ui/Pricing.tsx',
      rel: 'ui/Pricing.tsx',
      label: 'Pricing',
      fetchImpl: server.fetchImpl,
      toast: (m: string) => toasts.push(m),
      reload: () => reload.promise,
    });
    await until(() => server.calls.length === 1);
    server.calls[0].answer(true);
    // the list has NOT re-read yet: the row is already out, and the toast is up
    await until(() => queue.gone().has('.design/ui/Pricing.tsx'));
    expect(toasts).toEqual(['“Pricing” moved to the trash.']);
    const groups = [
      {
        label: 'UI',
        paths: ['.design/ui/Pricing.tsx', '.design/ui/Pricing.meta.json', '.design/ui/Home.tsx'],
      },
    ];
    expect(withoutGone(groups, queue.gone())[0].paths).toEqual(['.design/ui/Home.tsx']);
    reload.resolve();
    expect((await done).ok).toBe(true);
    await until(() => !queue.gone().has('.design/ui/Pricing.tsx'));
  });

  test('three quick moves all land, one at a time, in the order asked', async () => {
    const queue = createTrashQueue({ settleMs: 0 });
    const server = manualServer();
    const toasts: string[] = [];
    let reloads = 0;
    const ask = (name: string) =>
      queueTrashCanvas({
        queue,
        path: `.design/ui/${name}.tsx`,
        rel: `ui/${name}.tsx`,
        label: name,
        fetchImpl: server.fetchImpl,
        toast: (m: string) => toasts.push(m),
        reload: async () => {
          reloads++;
        },
      });
    const all = [ask('A'), ask('B'), ask('C'), ask('B')]; // a second ask for B is the same move
    // all three rows say so at once
    for (const n of ['A', 'B', 'C'])
      expect(getRowSlots().slotFor(`ui/${n}.tsx`)?.sub?.text).toBe(TRASH_QUEUE_WORDS.moving);
    await until(() => server.calls.length === 1);
    await tick();
    expect(server.calls.length).toBe(1); // B waits for A's answer
    server.calls[0].answer(true);
    await until(() => server.calls.length === 2);
    server.calls[1].answer(true);
    await until(() => server.calls.length === 3);
    server.calls[2].answer(true);
    const results = await Promise.all(all);
    expect(server.calls.map((c) => c.path)).toEqual([
      '.design/ui/A.tsx',
      '.design/ui/B.tsx',
      '.design/ui/C.tsx',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(toasts).toEqual([
      '“A” moved to the trash.',
      '“B” moved to the trash.',
      '“C” moved to the trash.',
    ]);
    expect(reloads).toBe(3);
  });

  test('a refusal brings the row back and says why; the queue goes on', async () => {
    const queue = createTrashQueue({ settleMs: 0 });
    const server = manualServer();
    const toasts: Array<[string, boolean]> = [];
    const ask = (name: string) =>
      queueTrashCanvas({
        queue,
        path: `.design/ui/${name}.tsx`,
        rel: `ui/${name}.tsx`,
        label: name,
        fetchImpl: server.fetchImpl,
        toast: (m: string, ok = false) => toasts.push([m, ok]),
        reload: async () => {},
      });
    const a = ask('A');
    const b = ask('B');
    await until(() => server.calls.length === 1);
    server.calls[0].answer(false, 'canvas not found');
    const ra = await a;
    expect(ra.ok).toBe(false);
    // A is back as it was: no pending words, not hidden
    expect(getRowSlots().slotFor('ui/A.tsx')).toBeNull();
    expect(queue.gone().has('.design/ui/A.tsx')).toBe(false);
    expect(queue.stateOf('.design/ui/A.tsx')).toBeNull();
    expect(toasts[0]).toEqual(['Could not move “A” to the trash. canvas not found', false]);
    await until(() => server.calls.length === 2);
    server.calls[1].answer(true);
    expect((await b).ok).toBe(true);
  });

  test('no connection: the row comes back and the next move still goes', async () => {
    const queue = createTrashQueue({ settleMs: 0 });
    let n = 0;
    const fetchImpl = (async () => {
      if (++n === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ok: true, trashDir: '.design/_trash/x' }));
    }) as unknown as typeof fetch;
    const toasts: string[] = [];
    const base = { queue, fetchImpl, toast: (m: string) => toasts.push(m), reload: async () => {} };
    const a = queueTrashCanvas({ ...base, path: '.design/ui/A.tsx', rel: 'ui/A.tsx', label: 'A' });
    const b = queueTrashCanvas({ ...base, path: '.design/ui/B.tsx', rel: 'ui/B.tsx', label: 'B' });
    expect((await a).ok).toBe(false);
    expect((await b).ok).toBe(true);
    expect(queue.stateOf('.design/ui/A.tsx')).toBeNull();
    expect(toasts).toEqual(['Could not move “A” to the trash.', '“B” moved to the trash.']);
  });
});
