// 2.1.1 T13 — Sync details: "the project deleted a batch this Mac still holds" is its own Needs you card
// with the count, the folders and two answers — Remove here too (they go to the trash) and Keep them
// here. It used to be a bare row among the held lists with no way to answer.
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
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
import { ACTIONS_BY_ID } from '../actions/index.ts';
import SyncDetails, {
  heldIncomingWords,
} from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import { syncDetailsModel } from '../client/v2/diagnostics/sync-details/sync-details-model.js';
import { filePlaneHeld } from '../sync/index.ts';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const FOLDER = 'ui/ideas/blender-life/renders';
const status = (files: Record<string, unknown>) => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  url: 'https://hub.test',
  files: { synced: 120, pulled: 0, conflicts: 0, ...files },
});
/** The held row the runtime builds from a pass that held 2 630 incoming deletes. */
const heldRow = () =>
  filePlaneHeld({
    deleteHeld: {
      direction: 'in',
      count: 2630,
      paths: [`${FOLDER}/0001.png`],
      folders: [{ folder: FOLDER, count: 2630 }],
    },
  } as never);

function fakeFetch(answer: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (url === '/_api/sync/held-deletes')
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(answer), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
async function mount(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<SyncDetails project="StudyFi" {...(props as never)} />);
  });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (id: string) => {
  await act(async () => {
    q(id)?.click();
  });
};

test('the incoming batch is a Needs you card with the count and folder, not a bare held row', async () => {
  await mount({ status: status({ held: heldRow() }) });
  const card = q('sync-deletes-incoming');
  expect(card?.textContent).toContain('Deleted by the project · 2,630 files');
  expect(card?.textContent).toContain('They are still on this Mac.');
  expect(card?.textContent).toContain('go to the trash');
  expect(q('sync-deletes-incoming-folders')?.textContent).toContain(FOLDER);
  expect(q('diag-sync-need-word')?.textContent).toBe('1 need you');
  // One place for it: not a second row among the held lists.
  expect(q('diag-sync-held-delete-in')).toBeNull();
  expect(q('sync-deletes-incoming-remove')?.textContent).toBe('Remove here too');
  expect(q('sync-deletes-incoming-keep')?.textContent).toBe('Keep them here');
  expect(q('sync-deletes-incoming-remove')?.dataset.action).toBe('sync.remove-held-here');
  expect(q('sync-deletes-incoming-keep')?.dataset.action).toBe('sync.keep-held-here');
  expect(ACTIONS_BY_ID.get('sync.remove-held-here')?.label).toBe('Remove here too');
  expect(ACTIONS_BY_ID.get('sync.keep-held-here')?.label).toBe('Keep them here');
});

test('the model keeps the outgoing and the incoming card apart', () => {
  const out = filePlaneHeld({
    deleteHeld: { direction: 'out', count: 30, paths: [], folders: [{ folder: 'a', count: 30 }] },
  } as never);
  const m = syncDetailsModel(status({ held: out }));
  expect(m.needs.map((n: { kind: string }) => n.kind)).toEqual(['deletes-held']);
  const i = syncDetailsModel(status({ held: heldRow() }));
  expect(i.needs.map((n: { kind: string }) => n.kind)).toEqual(['deletes-incoming']);
});

test('Remove here too sends remove-here and says the files are moving to the trash', async () => {
  const { f, calls } = fakeFetch({ ok: true, how: 'removed', count: 2630 });
  await mount({ status: status({ held: heldRow() }), fetchImpl: f });
  await click('sync-deletes-incoming-remove');
  expect(calls).toEqual([
    { url: '/_api/sync/held-deletes', body: { answer: 'remove-here', folder: null } },
  ]);
  expect(q('sync-deletes-incoming-said')?.textContent).toBe(
    'Removing 2,630 files. They’re moving to the trash.'
  );
  // Answered: the buttons are gone.
  expect(q('sync-deletes-incoming-remove')).toBeNull();
});

test('Keep them here sends keep-here and says nothing is sent back', async () => {
  const { f, calls } = fakeFetch({ ok: true, how: 'kept-here', count: 2630 });
  await mount({ status: status({ held: heldRow() }), fetchImpl: f });
  await click('sync-deletes-incoming-keep');
  expect(calls[0]?.body).toEqual({ answer: 'keep-here', folder: null });
  expect(q('sync-deletes-incoming-said')?.textContent).toBe(
    'Kept here. 2,630 files stay on this Mac and aren’t sent back.'
  );
});

test('a refused answer reads the honest reason and the answers stay offered', async () => {
  const { f } = fakeFetch(
    { ok: false, reason: 'nothing-held', detail: 'Nothing here is waiting to be removed.' },
    409
  );
  await mount({ status: status({ held: heldRow() }), fetchImpl: f });
  await click('sync-deletes-incoming-remove');
  expect(q('sync-deletes-incoming-said')?.textContent).toBe(
    'Nothing here is waiting to be removed.'
  );
  expect(q('sync-deletes-incoming-keep')).not.toBeNull();
  expect(heldIncomingWords(null)).toBe('That didn’t work. Nothing was removed.');
});
