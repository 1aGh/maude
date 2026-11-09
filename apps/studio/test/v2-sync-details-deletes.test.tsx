// Issue #207 (7b) — Sync details: "Deleted on this Mac, held" is its own card naming the folders and
// the count, with Move to the hub’s trash too… (asked once more) and Keep on the hub; files kept on the hub
// are listed as "on the hub only"; files deleted on both sides are not "only on this Mac".
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
import SyncDetails from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import {
  DELIVERY_WORD,
  syncDetailsModel,
} from '../client/v2/diagnostics/sync-details/sync-details-model.js';
import { filePlaneHeld } from '../sync/index.ts';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const FOLDER = 'ui/ideas/blender-life/renders/draft3/flythrough';
const status = (files: Record<string, unknown>) => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  url: 'https://hub.test',
  files: { synced: 120, pulled: 0, conflicts: 0, ...files },
});
/** The held row the runtime builds from a pass that held 6 555 local deletes. */
// 2.1.1 N4 — the digest of the held batch on screen; every answer carries it back
const SHOWN = 'd'.repeat(32);
const heldRow = (digest = SHOWN) =>
  filePlaneHeld({
    deleteHeld: {
      direction: 'out',
      count: 6555,
      paths: [`${FOLDER}/0001.png`],
      folders: [{ folder: FOLDER, count: 6555 }],
      digest,
    },
  } as never);

function fakeFetch(answer: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    // Only the answers: the panel also reads the shared-code consent on mount.
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

test('held local deletes are a Needs you card with the folder and the count — not "stuck"', async () => {
  await mount({ status: status({ held: heldRow() }) });
  const card = q('sync-deletes-held');
  expect(card?.textContent).toContain('Deleted on this Mac · 6,555 files');
  expect(card?.textContent).toContain(
    '6,555 files deleted on this Mac in ui/ideas/blender-life/renders/draft3/flythrough — more than sync deletes on the hub without asking. They are still on the hub.'
  );
  expect(q('sync-deletes-held-folders')?.textContent).toContain(FOLDER);
  expect(q('diag-sync-need-word')?.textContent).toBe('1 need you');
  // One place for it: not a second row among the held lists.
  expect(q('diag-sync-held-delete-out')).toBeNull();
  expect(q('sync-deletes-held-delete')?.dataset.action).toBe('sync.delete-held-on-hub');
  expect(q('sync-deletes-held-keep')?.dataset.action).toBe('sync.keep-held-on-hub');
});

test('Move to the hub’s trash too… asks once more, then sends one confirmed batch', async () => {
  const { f, calls } = fakeFetch({ ok: true, how: 'purge', count: 6555 });
  await mount({ status: status({ held: heldRow() }), fetchImpl: f });
  await click('sync-deletes-held-delete');
  expect(calls).toEqual([]);
  expect(q('sync-deletes-held-confirming')?.textContent).toContain(
    'Move 6,555 files to the hub’s trash?'
  );
  await click('sync-deletes-held-cancel');
  expect(calls).toEqual([]);
  expect(q('sync-deletes-held-confirming')).toBeNull();
  await click('sync-deletes-held-delete');
  await click('sync-deletes-held-confirm');
  expect(calls).toEqual([
    { url: '/_api/sync/held-deletes', body: { answer: 'delete', folder: null, digest: SHOWN } },
  ]);
  expect(q('sync-deletes-held-said')?.textContent).toBe(
    'Deleting 6,555 files on the hub. A batch this big takes a few minutes.'
  );
});

test('a member past the budget reads the honest no, and the answers stay offered', async () => {
  const detail =
    'Only the project owner can delete this many at once — ask them, or keep them on the hub.';
  const { f } = fakeFetch({ ok: false, reason: 'not-owner', detail }, 403);
  await mount({ status: status({ held: heldRow() }), fetchImpl: f });
  await click('sync-deletes-held-delete');
  await click('sync-deletes-held-confirm');
  expect(q('sync-deletes-held-said')?.textContent).toBe(detail);
  expect(q('sync-deletes-held-keep')).not.toBeNull();
});

test('Keep on the hub sends keep; kept files are listed as on the hub only, never waiting', async () => {
  const { f, calls } = fakeFetch({ ok: true, how: 'keep', count: 6555 });
  await mount({ status: status({ held: heldRow() }), fetchImpl: f });
  await click('sync-deletes-held-keep');
  expect(calls[0]?.body).toEqual({ answer: 'keep', folder: null, digest: SHOWN });
  expect(q('sync-deletes-held-said')?.textContent).toBe(
    'Kept on the hub. 6,555 files stay there and aren’t downloaded again.'
  );
  act(() => root?.unmount());
  host?.remove();
  await mount({
    status: status({
      delivery: { [`${FOLDER}/0001.png`]: 'hub-only', [`${FOLDER}/0002.png`]: 'hub-only' },
    }),
  });
  expect(q('sync-hub-only')?.textContent).toContain('On the hub only · 2 files');
  expect(q('sync-delivery-attention')).toBeNull();
});

test('N4: a held set that grew since answers `changed`; the next status draws a fresh card', async () => {
  const detail = 'The list changed. Nothing was deleted — look at it again.';
  const { f } = fakeFetch({ ok: false, reason: 'changed', detail }, 409);
  await mount({ status: status({ held: heldRow() }), fetchImpl: f });
  await click('sync-deletes-held-delete');
  await click('sync-deletes-held-confirm');
  expect(q('sync-deletes-held-said')?.textContent).toBe(detail);
  await click('sync-deletes-held-delete');
  expect(q('sync-deletes-held-confirming')).not.toBeNull();
  // the runtime reports the new set: a new card — its confirm and words start over
  await act(async () => {
    root?.render(
      <SyncDetails
        project="StudyFi"
        {...({ status: status({ held: heldRow('e'.repeat(32)) }), fetchImpl: f } as never)}
      />
    );
  });
  expect(q('sync-deletes-held-said')).toBeNull();
  expect(q('sync-deletes-held-confirming')).toBeNull();
});

test('the owner purge in progress is news, not a question; a stop is', () => {
  const running = syncDetailsModel(
    status({ deletePurge: { total: 6555, done: 1200, running: true } })
  );
  expect(running.needs.map((n: { kind: string }) => n.kind)).toEqual(['deletes-purging']);
  expect(running.needWord).toBeNull();
  const stopped = syncDetailsModel(
    status({ deletePurge: { total: 6555, done: 1200, running: false, error: 'x' } })
  );
  expect(stopped.needWord).toBe('1 need you');
});

test('the words for each state, and the registry rows are the person’s', () => {
  expect(DELIVERY_WORD['delete-held']).toBe('deleted on this Mac — waiting for your answer');
  expect(DELIVERY_WORD['hub-only']).toBe('on the hub only');
  for (const id of ['sync.delete-held-on-hub', 'sync.keep-held-on-hub'])
    expect(ACTIONS_BY_ID.get(id as never)).toBeTruthy();
});
