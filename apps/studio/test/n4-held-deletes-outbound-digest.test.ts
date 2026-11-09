// 2.1.1 N4 — "Delete on the hub too" (and Keep on the hub) answer exactly the held batch that was on
// screen. Local deletes can grow the held set between showing the card and the click; an answer about
// another set (a stale or missing digest) answers `changed` and nothing is sent — the incoming twin's
// T8 rule. The pass status carries the digest of the set the answer would cover.
import { describe, expect, test } from 'bun:test';

import { legacyClaim, resolveAccess } from '../access/scope.ts';
import { syncDetailsModel } from '../client/v2/diagnostics/sync-details/sync-details-model.js';
import { guardTableRoute } from '../http.ts';
import { createSyncRoutes } from '../routes/sync.ts';
import { heldSetDigest } from '../sync/file-plane.ts';
import { createHeldDeletes, LIST_CHANGED_OUT_DETAIL } from '../sync/held-deletes.ts';
import { filePlaneHeld } from '../sync/index.ts';

const ROUTE = '/_api/sync/held-deletes';
const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

function harness(held: string[] = ['a/1.png', 'a/2.png', 'a/3.png']) {
  const asked: { how: string; folder: string | null }[] = [];
  let paths = [...held];
  const plane = {
    heldDeletes: () => ({ count: paths.length, paths: [...paths], folders: [] }),
    answerHeldDeletes: (how: 'send' | 'purging' | 'keep', folder: string | null) => {
      asked.push({ how, folder });
      return [...paths];
    },
    endPurge: () => {},
    answerIncomingDeletes: () => null,
  };
  const control = createHeldDeletes({
    plane: () => plane,
    sentInWindow: () => 0,
    isOwner: () => false,
    hubUrl: 'http://hub.invalid',
    token: () => 't',
    runPass: async () => {},
    log: { log() {}, warn() {} },
  });
  const spec = createSyncRoutes({
    control: () => ({
      restart: async () => ({ syncing: false }),
      current: () => ({ heldDeletes: () => control }) as never,
    }),
    trace: { begin() {}, view: () => null } as never,
    warn: () => {},
    access: () => resolveAccess(legacyClaim('member')),
  })
    .map(guardTableRoute)
    .find((s) => s.method === 'POST' && s.path === ROUTE);
  if (!spec) throw new Error('no held-deletes route');
  const post = (body: unknown) =>
    spec.handle(
      new Request(`http://127.0.0.1:4399${ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...FROM_WINDOW },
        body: JSON.stringify(body),
      }),
      {}
    );
  return {
    control,
    post,
    asked,
    shown: () => heldSetDigest(paths),
    grow: (rel: string) => {
      paths = [...paths, rel].sort();
    },
  };
}

describe('the outbound held-delete answer names the batch on screen', () => {
  test('the shown digest: Delete on the hub too goes through', async () => {
    const h = harness();
    expect(await h.control.answer('delete', null, h.shown())).toEqual({
      ok: true,
      how: 'door',
      count: 3,
    });
    expect(h.asked).toEqual([{ how: 'send', folder: null }]);
  });

  test('the set grew after it was shown: `changed`, nothing sent', async () => {
    const h = harness();
    const shown = h.shown();
    h.grow('a/4.png');
    expect(await h.control.answer('delete', null, shown)).toEqual({
      ok: false,
      reason: 'changed',
      detail: LIST_CHANGED_OUT_DETAIL,
    });
    expect(await h.control.answer('keep', null, shown)).toMatchObject({ reason: 'changed' });
    expect(h.asked).toEqual([]);
  });

  test('the route carries the digest; a missing or wrong one is `changed` (409)', async () => {
    const h = harness();
    for (const body of [
      { answer: 'delete' },
      { answer: 'delete', digest: 'f'.repeat(32) },
      { answer: 'keep', digest: 7 },
    ]) {
      const res = await h.post(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await res.json()).reason).toBe('changed');
    }
    expect(h.asked).toEqual([]);
    const ok = await h.post({ answer: 'delete', folder: null, digest: h.shown() });
    expect(ok.status).toBe(200);
    expect(h.asked).toEqual([{ how: 'send', folder: null }]);
  });

  test('the status row and the Sync details card carry the digest', () => {
    const digest = 'c'.repeat(32);
    const held = filePlaneHeld({
      deleteHeld: { direction: 'out', count: 30, paths: ['a/1.png'], folders: [], digest },
    } as never);
    expect(held[0]).toMatchObject({ kind: 'delete-out', digest });
    const model = syncDetailsModel({
      state: 'online',
      queuedOps: 0,
      docs: { synced: 1, pending: 0, rejected: 0 },
      url: 'https://hub.test',
      files: { synced: 1, pulled: 0, conflicts: 0, held },
    });
    const need = model.needs.find((n: { kind: string }) => n.kind === 'deletes-held');
    expect(need?.digest).toBe(digest);
  });
});
