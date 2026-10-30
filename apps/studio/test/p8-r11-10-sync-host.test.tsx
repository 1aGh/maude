// Round 11 (10 co-sync-back): the moment this Mac is reachable again the outbox is re-read AT ONCE — the rows say
// "sending" and the foot counts "· N sent" from the real queue, not eight seconds later. SyncStatesHost mounts the
// words (row-words.js) and polls GET /_api/outbox; a reconnect is a re-read cue, like the hub status moving.
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

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;
const onLine = (v: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
  onLine(true);
});

test('coming back online re-reads the outbox now, and the rows move from "not sent" to "sending"', async () => {
  const slots = await import('../client/v2/canvases/row-slots.js');
  slots.resetRowSlots();
  const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
  const { SyncStatesHost } = await import('../client/v2/sync-states/conflict-card.jsx');
  const outboxView = {
    content: {
      pending: 2,
      byDoc: { 'ui-print': { count: 2, oldestAt: 1, lanes: ['html'] } },
      comments: [],
    },
  };
  let outboxReads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('/_api/outbox')) {
      outboxReads++;
      return json(outboxView);
    }
    if (url.startsWith('/_api/index'))
      return json({
        canvases: [{ rel: 'ui/Print.tsx' }, { rel: 'ui/Smoke.tsx' }],
        writer: { seq: 1 },
      });
    if (url.startsWith('/_api/sync/conflicts')) return json({ conflicts: [] });
    return json({});
  }) as typeof fetch;
  onLine(false);
  const store = {
    shellCore: {
      activePath: 'ui/Print.tsx',
      cfg: { designRel: '.design' },
      cloudLinkedHub: null,
      gitUser: 'Michal',
      project: 'Alligators brand',
      syncStatus: { linked: true, state: 'online', flash: 'synced' },
      viewerMode: false,
    },
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const wait = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  await act(async () =>
    root?.render(
      <ShellStoreContext.Provider value={store as never}>
        <SyncStatesHost />
      </ShellStoreContext.Provider>
    )
  );
  await wait(400); // the index read waits 200 ms
  expect(slots.getRowSlots().slotFor('ui/Print.tsx')?.meta?.word).toBe('not sent');
  expect(slots.getRowSlots().slotFor('ui/Smoke.tsx')).toBeNull();
  const before = outboxReads;

  onLine(true);
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  await wait(100);
  expect(outboxReads).toBeGreaterThan(before); // re-read at once, not on the 8 s tick
  expect(slots.getRowSlots().slotFor('ui/Print.tsx')?.meta?.word).toBe('sending');
  slots.resetRowSlots();
});
