// S11.15 — the sync callout and its fold (06 · ad-edge-sync): "3 changes are waiting to reach the cloud."
//
// The hub said "slow down" (a 429 with Retry-After): nothing is wrong, nothing is lost, and the only right
// thing to do is wait. The words come first (what happened · what is safe · one verb — Try now); the
// details a developer asks for sit one fold down: Hub · Reply · Next try · Last good sync · Waiting.
//   · model: the status the sync lane really emits (`files.rateLimited { until, waiting }`, the
//     doručenka) becomes one 'sync-stuck' item; the cluster beside the faces keeps its CONTRACT §6 word,
//     Syncing…, because the presentation no longer calls a paused lane "synced";
//   · host (happy-dom + React over a shell store): the callout draws with ONE verb, the fold opens on
//     Advanced and shows the rows, Try now asks the project server to restart sync (POST /_api/sync/resync).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { ShellCallouts } from '../client/v2/shell/callouts-host.jsx';
import { calloutStack, clockOf, syncCallout } from '../client/v2/shell/callouts-model.js';
import { saveStatus } from '../client/v2/shell/save-status.js';
import { syncPresentation } from '../sync/presentation.ts';

const NOW = Date.parse('2026-10-20T14:06:00');
const stuck = (over: Record<string, unknown> = {}, files: Record<string, unknown> = {}) => ({
  linked: true,
  state: 'online',
  queuedOps: 0,
  url: 'https://alligators.cloud.maude.sh/',
  lastSyncAt: Date.parse('2026-10-20T14:02:51'),
  docs: { synced: 3, pending: 0, rejected: 0 },
  files: {
    rateLimited: { until: NOW + 40_000, waiting: 3 },
    delivery: {
      '2026/combine/Combine-kampan.tsx': 'local-only',
      '2026/combine/Combine-kampan.meta.json': 'pushing',
      'assets/7c40e2b1.mov': 'stuck',
      '2026/combine/Done.tsx': 'everywhere',
    },
    ...files,
  },
  ...over,
});

describe('the model: a paused lane becomes one calm callout', () => {
  test('what happened · what is safe · one verb — in the canvas words', () => {
    const c = syncCallout(stuck(), NOW);
    expect(c?.kind).toBe('sync-stuck');
    expect(c?.tone).toBe('info');
    expect(c?.title).toBe('3 changes are waiting to reach the cloud.');
    expect(c?.detail).toBe(
      "They're safe on this Mac. The cloud is busy and asked to wait — the next try is in 40 s, by itself."
    );
    expect(c?.action).toEqual({ id: 'try-now', label: 'Try now', busyLabel: 'Trying…' });
  });

  test('one change reads for one; a long wait says minutes; a lifted pause says a moment', () => {
    expect(
      syncCallout(stuck({}, { rateLimited: { until: NOW + 5_000, waiting: 1 } }), NOW)?.title
    ).toBe('1 change is waiting to reach the cloud.');
    expect(
      syncCallout(stuck({}, { rateLimited: { until: NOW + 150_000, waiting: 2 } }), NOW)?.detail
    ).toContain('in 3 min,');
    expect(
      syncCallout(stuck({}, { rateLimited: { until: NOW - 1_000, waiting: 2 } }), NOW)?.detail
    ).toContain('in a moment,');
  });

  test('the fold: Hub · Reply · Next try · Last good sync · Waiting · N, and the files', () => {
    const fold = syncCallout(stuck(), NOW)?.fold;
    expect(fold?.rows).toEqual([
      { id: 'hub', k: 'Hub', v: 'alligators.cloud.maude.sh' },
      { id: 'reply', k: 'Reply', v: '429 · rate limited' },
      { id: 'next', k: 'Next try', v: clockOf(NOW + 40_000) },
      { id: 'last', k: 'Last good sync', v: clockOf(Date.parse('2026-10-20T14:02:51')) },
    ]);
    expect(clockOf(Date.parse('2026-10-20T14:06:40'))).toBe('14:06:40');
    // only what has not arrived: the doručenka's local-only · pushing · stuck, never `everywhere`
    expect(fold?.waiting.count).toBe(3);
    expect(fold?.waiting.files).toEqual([
      '2026/combine/Combine-kampan.tsx',
      '2026/combine/Combine-kampan.meta.json',
      'assets/7c40e2b1.mov',
    ]);
    expect(fold?.waiting.more).toBe(0);
    expect(fold?.hint).toBe('A full compare is Resync now, in Menu › Diagnostics › Advanced.');
  });

  test('a long list is cut and says how many more; an unknown last sync leaves its row out', () => {
    const delivery: Record<string, string> = {};
    for (let i = 0; i < 9; i++) delivery[`f${i}.tsx`] = 'local-only';
    const fold = syncCallout(
      stuck({ lastSyncAt: null }, { delivery, rateLimited: { until: NOW + 9_000, waiting: 9 } }),
      NOW
    )?.fold;
    expect(fold?.waiting.files.length).toBe(5);
    expect(fold?.waiting.more).toBe(4);
    expect(fold?.rows.map((r: { id: string }) => r.id)).toEqual(['hub', 'reply', 'next']);
  });

  test('nothing waiting is the lane resting, not a problem: no callout', () => {
    expect(
      syncCallout(stuck({}, { rateLimited: { until: NOW + 9_000, waiting: 0 } }), NOW)
    ).toBeNull();
    expect(syncCallout(stuck({}, { rateLimited: undefined }), NOW)).toBeNull();
  });

  test('a divergence or a refused canvas outranks it; offline is the status word, not this', () => {
    const diverged = { kind: 'cold-start-diverged', slug: 'pricing', winner: 'local', at: 1 };
    expect(syncCallout(stuck({ conflicts: [diverged] }), NOW)?.kind).toBe('sync-diverged');
    expect(syncCallout(stuck({ docs: { rejected: 1 } }), NOW)?.kind).toBe('sync-rejected');
    expect(syncCallout(stuck({ state: 'offline' }), NOW)).toBeNull();
  });

  test('it rides the stack, and its key changes when the count does (a close hides one event)', () => {
    const a = calloutStack({ syncStatus: stuck(), now: NOW });
    expect(a.map((i: { kind: string }) => i.kind)).toEqual(['sync-stuck']);
    const b = syncCallout(stuck({}, { rateLimited: { until: NOW + 9_000, waiting: 4 } }), NOW);
    expect(b?.key).not.toBe(a[0].key);
    expect(calloutStack({ syncStatus: stuck(), now: NOW, dismissed: new Set([a[0].key]) })).toEqual(
      []
    );
  });

  test('the cluster beside the faces says Syncing… — a paused lane is not "synced"', () => {
    const p = syncPresentation(stuck() as never, { now: NOW });
    expect(p?.phase).toBe('syncing');
    expect(saveStatus({ linked: true, online: true, phase: p?.phase ?? null }).word).toBe(
      'Syncing…'
    );
  });
});

// ── the real host over a shell store ───────────────────────────────────────────────────────────
let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

async function mount(shellCore: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const core = {
    cfg: {},
    gitLifecycle: null,
    setGitLifecycle: () => {},
    setUpdateReady: () => {},
    syncStatus: null,
    updateReady: null,
    ...shellCore,
  };
  await act(async () => {
    root?.render(
      <ShellStoreContext.Provider value={{ shellCore: core } as never}>
        <ShellCallouts />
      </ShellStoreContext.Provider>
    );
  });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('the host: the words, the fold, the verb', () => {
  test('the callout draws with one verb; the details are folded until Advanced is opened', async () => {
    await mount({
      syncStatus: stuck({}, { rateLimited: { until: Date.now() + 40_000, waiting: 3 } }),
    });
    const callout = q('callout-sync-stuck');
    expect(callout?.textContent).toContain('3 changes are waiting to reach the cloud.');
    expect(callout?.querySelectorAll('button.btn').length).toBe(1);
    expect(q('callout-sync-stuck-action')?.textContent).toBe('Try now');
    // closed: the rows are not even rendered
    expect(q('fold-callout.sync-body')).toBeNull();
    expect(callout?.textContent).not.toContain('429');
    await click(q('callout-sync-stuck-fold-toggle'));
    const body = q('fold-callout.sync-body');
    expect(body?.textContent).toContain('alligators.cloud.maude.sh');
    expect(body?.textContent).toContain('429 · rate limited');
    expect(body?.textContent).toContain('Waiting · 3');
    expect(q('callout-sync-stuck-file-0')?.textContent).toBe('2026/combine/Combine-kampan.tsx');
    expect(body?.textContent).toContain('A full compare is Resync now');
  });

  test('Try now asks the project server to restart sync, and says it is trying', async () => {
    const calls: string[] = [];
    let release: (() => void) | null = null;
    globalThis.fetch = ((url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Promise((resolve) => {
        release = () => resolve(Response.json({ ok: true, sync: { syncing: true } }));
      });
    }) as never;
    await mount({
      syncStatus: stuck({}, { rateLimited: { until: Date.now() + 40_000, waiting: 3 } }),
    });
    await click(q('callout-sync-stuck-action'));
    // S11.17's recovery store polls GET /_api/diagnostics/disk from the same host — only the writes matter here.
    expect(calls.filter((c) => !c.startsWith('GET '))).toEqual(['POST /_api/sync/resync']);
    expect(q('callout-sync-stuck-action')?.textContent).toBe('Trying…');
    expect((q('callout-sync-stuck-action') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      release?.();
    });
    expect(q('callout-sync-stuck-action')?.textContent).toBe('Try now');
  });

  test('Dismiss closes this event only', async () => {
    await mount({
      syncStatus: stuck({}, { rateLimited: { until: Date.now() + 40_000, waiting: 3 } }),
    });
    await click(q('callout-sync-stuck-dismiss'));
    expect(q('callout-sync-stuck')).toBeNull();
  });
});
