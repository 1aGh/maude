// #204 (task L) — against a workspace cell the shell polled /_api/outbox (twice per cycle),
// /_api/sync/conflicts, /_api/diagnostics/disk and /_api/ai/runs forever, every answer a 404
// (DDR-193: withheld in a cell). The shell now learns from `/_config` that it is in a cell and
// does not ask them; anywhere, a polled route that answers 404 is not asked again.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// @ts-expect-error — plain .mjs, no types
import { decide } from '../../hub/src/studio-manifest.mjs';
import { startNeedsYouFeed } from '../client/v2/ai/needs-you-store.js';
import { createRunsStore } from '../client/v2/ai/runs-store.js';
import { createVoteStore } from '../client/v2/annotations/vote-store.js';
import { askForCovers, resetCoversAsked } from '../client/v2/canvases/covers.js';
import { restoreTrashedCanvas } from '../client/v2/canvases/trash-canvas.js';
import { fetchTrash } from '../client/v2/left-panel/use-trash.js';
import { loadOrderNotesArtboards } from '../client/v2/present/order-notes-artboards.js';
import { fetchRecents } from '../client/v2/search/search-recent.js';
import { searchIndex } from '../client/v2/search/search-remote.js';
import { refreshDisk } from '../client/v2/shell/recovery-store.js';
import {
  CELL_UNSERVED,
  expectServedFrom,
  fetchIfServed,
  noteServed,
  resetServed,
  served,
  servedFetch,
  setServedFrom,
} from '../client/v2/shell/served-routes.js';
import { readConflicts } from '../client/v2/sync-states/conflict-card.jsx';
import { isForbiddenRoute } from '../workspace-mode.ts';

afterEach(() => resetServed());

function countingFetch(status = 200, body: unknown = {}) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, impl };
}

describe('served routes (#204)', () => {
  test('every route a cell is not asked is one the cell really withholds', () => {
    for (const prefix of CELL_UNSERVED) {
      const path = prefix.endsWith('/') ? `${prefix}disk` : prefix;
      const door = decide('GET', path, 'owner');
      const prunedByStudio = isForbiddenRoute(path);
      expect({ path, withheld: !door.allow || prunedByStudio }).toEqual({ path, withheld: true });
    }
  });

  test('the routes a cell keeps answering are still asked', () => {
    setServedFrom({ cloud: { projectName: 'p' } });
    for (const path of ['/_index-data', '/_sync-status', '/_api/sync/availability', '/_health']) {
      expect(decide('GET', path, 'owner').allow).toBe(true);
      expect(served(path)).toBe(true);
    }
  });

  test('a cell does not poll the desktop-only routes at all', async () => {
    setServedFrom({ cloud: {} });
    const f = countingFetch();
    for (const path of [
      '/_api/outbox',
      '/_api/sync/conflicts',
      '/_api/diagnostics/disk',
      '/_api/ai/runs',
    ]) {
      const r = await servedFetch(path, undefined, f.impl);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(404);
    }
    expect(f.calls).toEqual([]);
  });

  test('a desktop asks them', async () => {
    setServedFrom({ name: 'desktop project' });
    const f = countingFetch();
    await servedFetch('/_api/outbox', undefined, f.impl);
    await servedFetch('/_api/ai/runs', undefined, f.impl);
    expect(f.calls).toEqual(['/_api/outbox', '/_api/ai/runs']);
  });

  test('a 404 is not asked again; other failures are', async () => {
    const gone = countingFetch(404);
    await servedFetch('/_api/outbox', undefined, gone.impl);
    await servedFetch('/_api/outbox', undefined, gone.impl);
    expect(gone.calls).toEqual(['/_api/outbox']);
    const flaky = countingFetch(503);
    await servedFetch('/_api/sync/conflicts', undefined, flaky.impl);
    await servedFetch('/_api/sync/conflicts', undefined, flaky.impl);
    expect(flaky.calls).toHaveLength(2);
    noteServed('/_api/x?since=1', 404);
    expect(served('/_api/x')).toBe(false);
  });

  test('the pollers go through it: a cell sends none of their requests', async () => {
    setServedFrom({ cloud: {} });
    const f = countingFetch();
    const runs = createRunsStore({ fetchImpl: f.impl as typeof fetch, target: undefined });
    await runs.refresh();
    const stop = startNeedsYouFeed({ fetchImpl: f.impl, pollMs: 0, win: undefined });
    await Bun.sleep(5);
    stop?.();
    await readConflicts(f.impl as typeof fetch);
    await refreshDisk(f.impl as typeof fetch);
    expect(f.calls).toEqual([]);
  });

  test('the outbox pollers and the /_config reader use it', () => {
    const read = (p: string) => readFileSync(new URL(`../client/${p}`, import.meta.url), 'utf8');
    for (const p of ['v2/shell/share-cluster-host.jsx', 'v2/sync-states/conflict-card.jsx'])
      expect(read(p)).toContain("servedFetch('/_api/outbox')");
    expect(read('v2/ai/StoppedDivider.jsx')).toContain("servedFetch('/_api/ai/runs'");
    expect(read('v2/ai/run-api.js')).toContain("servedFetch('/_api/ai/runs'");
    expect(read('hooks/use-shell-core.jsx')).toContain('setServedFrom(data);');
  });
});

// #204 (task R) — the start-up 404s: one-shot callers (a panel's mount, a tab's open) asked the routes a
// cell withholds once per load (`/_api/index` seven times), and the pollers asked before `/_config` said
// "cell" at all.
describe('one-shot routes and the start-up race (#204 R)', () => {
  test('a cell asks none of the one-shot routes', async () => {
    setServedFrom({ cloud: {} });
    const f = countingFetch();
    const impl = f.impl as typeof fetch;
    await fetchTrash(impl);
    await restoreTrashedCanvas({ trashDir: '.design/_trash/x', fetchImpl: impl });
    await searchIndex('pricing', { fetchImpl: impl });
    await fetchRecents({ fetchImpl: impl });
    await loadOrderNotesArtboards('.design/ui/a.tsx', impl);
    resetCoversAsked();
    askForCovers(impl);
    const votes = createVoteStore({ fetchImpl: impl, setTimer: () => 0, clearTimer: () => {} });
    votes.setFile('ui/a.tsx');
    await fetchIfServed('/_api/project/undo-stack?canvas=x', undefined, impl);
    await fetchIfServed('/_api/asset-state?canvas=x', undefined, impl);
    await Bun.sleep(5);
    votes.stop();
    // what they still ask is served by a cell (order notes read /_api/canvas-meta)
    expect(f.calls.filter((c) => decide('GET', c.split('?')[0], 'owner').allow !== true)).toEqual(
      []
    );
    expect(f.calls).toEqual(['/_api/canvas-meta?file=.design%2Fui%2Fa.tsx']);
  });

  test('a desktop asks them, and a one-shot 404 is not remembered (it can be about its canvas)', async () => {
    setServedFrom({ name: 'desktop project' });
    const f = countingFetch(404);
    await fetchIfServed('/_api/asset-state?canvas=a', undefined, f.impl);
    await fetchIfServed('/_api/asset-state?canvas=b', undefined, f.impl);
    expect(f.calls).toHaveLength(2);
  });

  test('the one-shot callers go through it', () => {
    const read = (p: string) => readFileSync(new URL(`../client/${p}`, import.meta.url), 'utf8');
    for (const [p, route] of [
      ['v2/canvases/use-canvas-index.js', 'fetchIfServed(url'],
      ['v2/canvases/use-pins.js', "fetchIfServed('/_api/pins'"],
      ['hooks/use-tabs.jsx', "fetchIfServed('/_api/index'"],
      ['hooks/use-tabs.jsx', "fetchIfServed('/_api/pins'"],
      ['v2/export/last-finished.js', "fetchIfServed('/_api/index'"],
      ['v2/assets/use-assets.js', "fetchIfServed('/_api/index?part=assets'"],
      ['v2/undo/use-undo-projection.jsx', 'fetchIfServed(url'],
      ['v2/ai/run-api.js', '`/_api/project/undo-stack?canvas='],
      ['v2/assets/asset-state-lane.js', '`/_api/asset-state?canvas='],
    ])
      expect({ p, has: read(p).includes(route) && read(p).includes('fetchIfServed') }).toEqual({
        p,
        has: true,
      });
    expect(read('app.jsx')).toContain('expectServedFrom();');
  });

  test('before /_config answers, a poll waits for it — and a cell then sends nothing', async () => {
    expectServedFrom();
    const f = countingFetch();
    const asked = servedFetch('/_api/ai/runs', undefined, f.impl);
    const once = fetchIfServed('/_api/index', undefined, f.impl);
    await Bun.sleep(5);
    expect(f.calls).toEqual([]);
    setServedFrom({ cloud: {} });
    await asked;
    await once;
    expect(f.calls).toEqual([]);
  });

  test('a desktop asks once /_config is in; with no /_config the wait is bounded', async () => {
    expectServedFrom();
    const f = countingFetch();
    const asked = servedFetch('/_api/ai/runs', undefined, f.impl);
    setServedFrom({});
    await asked;
    expect(f.calls).toEqual(['/_api/ai/runs']);
    resetServed();
    expectServedFrom(20);
    const g = countingFetch();
    await fetchIfServed('/_api/index', undefined, g.impl);
    expect(g.calls).toEqual(['/_api/index']);
  });
});
