// Round 11 (10 co-sync-offline / co-sync-back): the per-row "not sent" / "sending" words and the unsent
// comment ids, derived from the ONE outbox view (`GET /_api/outbox` content.byDoc / content.comments) —
// no second queue, no new route.
import { describe, expect, test } from 'bun:test';

const model = () => import('../client/v2/sync-states/sync-states-model.js');

const view = (byDoc: Record<string, { count: number; oldestAt: number; lanes: string[] }>) => ({
  content: { pending: 3, byDoc, comments: [] },
});
const canvases = [
  { rel: 'ui/2026/dresy/Uniformy-2027.tsx' },
  { rel: 'ui/2026/combine/Combine-cisla.tsx' },
  { rel: 'ui/2026/combine/Combine-kampan.tsx' },
];
const waiting = view({
  'ui-2026-dresy-uniformy-2027': { count: 2, oldestAt: 1, lanes: ['html'] },
  'ui-2026-combine-combine-cisla': { count: 1, oldestAt: 1, lanes: ['annotations'] },
});

describe('rowSyncSlots (pure) — "not sent" / "sending" on the canvases that wait', () => {
  test('offline: "not sent" on exactly the canvases with a waiting change, keyed by the panel path', async () => {
    const { rowSyncSlots } = await model();
    const m = rowSyncSlots({ kind: 'offline', view: waiting, canvases });
    expect([...m.keys()].sort()).toEqual([
      'ui/2026/combine/Combine-cisla.tsx',
      'ui/2026/dresy/Uniformy-2027.tsx',
    ]);
    expect(m.get('ui/2026/dresy/Uniformy-2027.tsx')).toEqual({
      meta: { word: 'not sent', tone: 'quiet', title: 'Kept on this Mac until it is online' },
    });
  });

  test('back online (syncing): the same canvases say "sending"; saved / local / not-saved say nothing', async () => {
    const { rowSyncSlots } = await model();
    const m = rowSyncSlots({ kind: 'syncing', view: waiting, canvases });
    expect(m.get('ui/2026/dresy/Uniformy-2027.tsx')?.meta?.word).toBe('sending');
    for (const kind of ['saved', 'local', 'not-saved'])
      expect(rowSyncSlots({ kind, view: waiting, canvases }).size).toBe(0);
  });

  test('a hub-namespaced doc name (ws/<workspace>/<branch>/<slug>) finds the same row', async () => {
    const { rowSyncSlots } = await model();
    const v = view({
      'ws/alligators/main/ui-2026-dresy-uniformy-2027': { count: 1, oldestAt: 1, lanes: [] },
    });
    expect([...rowSyncSlots({ kind: 'offline', view: v, canvases }).keys()]).toEqual([
      'ui/2026/dresy/Uniformy-2027.tsx',
    ]);
  });

  test('the row key and the wire doc key are the SERVER’s (canvasSlugFromRel + sanitizeComponent)', async () => {
    const { slugOfRel, wireKeyOfSlug } = await model();
    const { canvasSlugFromRel } = await import('../canvas-slug.ts');
    const { sanitizeComponent } = await import('../sync/doc-name.ts');
    for (const rel of [
      'ui/A.tsx',
      'ui/My Canvas — v2.tsx',
      'ui/2026/Combine cisla (final).tsx',
      '.hidden/x.tsx',
      'ui/Příliš žluťoučký.tsx',
      `ui/${'long-'.repeat(20)}.tsx`,
    ]) {
      const slug = canvasSlugFromRel(rel, '');
      expect(slugOfRel(rel)).toBe(slug);
      expect(wireKeyOfSlug(slug)).toBe(sanitizeComponent(slug));
    }
  });

  test('nothing waiting, no view, a view without byDoc: an empty map (never a made-up word)', async () => {
    const { rowSyncSlots } = await model();
    for (const v of [null, undefined, {}, { content: {} }, view({})])
      expect(rowSyncSlots({ kind: 'offline', view: v, canvases }).size).toBe(0);
  });
});

describe('queuedCommentIds / markQueued (pure) — the unsent comments that say "Queued"', () => {
  test('only while offline: online, an unsent comment is simply on its way (no flash of "Queued")', async () => {
    const { queuedCommentIds } = await model();
    const v = { content: { comments: ['c2', 'c1'] } };
    expect([...queuedCommentIds({ kind: 'offline', view: v })].sort()).toEqual(['c1', 'c2']);
    for (const kind of ['syncing', 'saved', 'local', 'not-saved'])
      expect(queuedCommentIds({ kind, view: v }).size).toBe(0);
    expect(queuedCommentIds({ kind: 'offline', view: null }).size).toBe(0);
  });

  test('markQueued stamps `queued` on the comment AND its replies, leaving the rest untouched', async () => {
    const { markQueued } = await model();
    const list = [
      {
        id: 'c1',
        text: 'a',
        thread: [
          { id: 'r1', text: 'x' },
          { id: 'r2', text: 'y' },
        ],
      },
      { id: 'c3', text: 'b' },
    ];
    const out = markQueued(list, new Set(['c1', 'r2']));
    expect(out[0].queued).toBe(true);
    expect(out[0].thread[0].queued).toBeUndefined();
    expect(out[0].thread[1].queued).toBe(true);
    expect(out[1]).toBe(list[1]); // same object: no needless re-render
    expect(markQueued(list, new Set())).toBe(list);
  });
});
