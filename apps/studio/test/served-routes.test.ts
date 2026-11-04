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
import { refreshDisk } from '../client/v2/shell/recovery-store.js';
import {
  CELL_UNSERVED,
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
