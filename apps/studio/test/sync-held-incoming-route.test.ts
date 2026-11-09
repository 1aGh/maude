// 2.1.1 T13 — the answer to "the project deleted these, held here": Remove here too / Keep them here.
//
// The held-deletes route already carried the answer for local deletes. These pin that the same route
// carries the incoming one — window-only, Can edit, never from a canvas — and that the control hands
// the answer to the plane and starts a pass so the removal does not wait for the next tick.

import { describe, expect, test } from 'bun:test';

import { legacyClaim, resolveAccess } from '../access/scope.ts';
import { guardTableRoute } from '../http.ts';
import { createSyncRoutes } from '../routes/sync.ts';
import { createHeldDeletes, heldIncomingDetail } from '../sync/held-deletes.ts';

const ROUTE = '/_api/sync/held-deletes';
const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

function harness(o: { role?: string; held?: string[] } = {}) {
  const asked: { how: string; folder: string | null }[] = [];
  let passes = 0;
  const held = o.held ?? ['a.css', 'b.css', 'c.css'];
  const plane = {
    heldDeletes: () => ({ count: 0, paths: [], folders: [] }),
    answerHeldDeletes: () => [],
    endPurge: () => {},
    answerIncomingDeletes: (how: 'remove' | 'keep', folder: string | null) => {
      asked.push({ how, folder });
      return held;
    },
  };
  const control = createHeldDeletes({
    plane: () => plane,
    sentInWindow: () => 0,
    isOwner: () => false,
    hubUrl: 'http://hub.invalid',
    token: () => 't',
    runPass: async () => {
      passes += 1;
    },
    log: { log() {}, warn() {} },
  });
  const specs = createSyncRoutes({
    control: () => ({
      restart: async () => ({ syncing: false }),
      current: () => ({ heldDeletes: () => control }) as never,
    }),
    trace: { begin() {}, view: () => null } as never,
    warn: () => {},
    access: () => resolveAccess(legacyClaim(o.role ?? 'member')),
  }).map(guardTableRoute);
  const spec = specs.find((s) => s.method === 'POST' && s.path === ROUTE);
  if (!spec) throw new Error('no held-deletes route');
  const post = (body: unknown, headers: Record<string, string> = FROM_WINDOW) =>
    spec.handle(
      new Request(`http://127.0.0.1:4399${ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
  return { post, asked, passes: () => passes };
}

describe('the incoming held-delete answer', () => {
  test('Remove here too reaches the plane and starts a pass now', async () => {
    const h = harness();
    const res = await h.post({ answer: 'remove-here', folder: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, how: 'removed', count: 3 });
    expect(h.asked).toEqual([{ how: 'remove', folder: null }]);
    expect(h.passes()).toBe(1);
  });

  test('Keep them here reaches the plane and starts a pass now', async () => {
    const h = harness();
    const res = await h.post({ answer: 'keep-here' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, how: 'kept-here', count: 3 });
    expect(h.asked).toEqual([{ how: 'keep', folder: null }]);
  });

  test('nothing held is an honest 409, not a success', async () => {
    const h = harness({ held: [] });
    const res = await h.post({ answer: 'remove-here' });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('nothing-held');
    expect(h.passes()).toBe(0);
  });

  test('only from the Maude window, only with Can edit', async () => {
    const h = harness();
    const cross = await h.post({ answer: 'remove-here' }, { 'sec-fetch-site': 'cross-site' });
    expect(cross.status).toBe(403);
    const viewer = harness({ role: 'viewer' });
    const refused = await viewer.post({ answer: 'remove-here' });
    expect(refused.status).toBe(403);
    expect(h.asked).toEqual([]);
    expect(viewer.asked).toEqual([]);
  });

  test('an answer it does not know is a 400', async () => {
    const h = harness();
    const res = await h.post({ answer: 'remove-everything' });
    expect(res.status).toBe(400);
    expect(h.asked).toEqual([]);
  });
});

describe('the incoming held-delete words', () => {
  test('say how many, where, that they are still here, and that they go to the trash', () => {
    expect(heldIncomingDetail(2630, [{ folder: 'ui/ideas', count: 2630 }])).toBe(
      '2,630 files deleted by the project in ui/ideas — more than sync removes here without asking. They are still on this Mac. Remove them here too and they go to the trash, or keep them here.'
    );
    expect(heldIncomingDetail(1, [])).toContain('1 file deleted by the project —');
  });
});
