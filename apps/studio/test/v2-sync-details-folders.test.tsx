// Issue #207 — Sync details: a long run of pictures going up gets a card with "Don't sync this
// folder"; the folders a project leaves out are listed with "Sync it again". Neither says the
// pictures are wrong to sync.
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

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const status = (files: Record<string, unknown>) => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  url: 'https://hub.test',
  files: { synced: 6082, pulled: 0, conflicts: 0, ...files },
});
const SEQ = 'ui/ideas/blender-life/renders/draft3/flythrough';

function fakeFetch() {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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

test('a render sequence going up gets a card that offers to leave its folder out', async () => {
  const { f, calls } = fakeFetch();
  await mount({
    status: status({
      largeSequences: [{ folder: SEQ, files: 1240, bytes: Math.round(3.1 * 1024 ** 3) }],
    }),
    fetchImpl: f,
  });
  const card = q('sync-large-seq-0');
  expect(card?.textContent).toContain('1,240 pictures');
  expect(card?.textContent).toContain('3.1 GB');
  // An option, never a verdict on the files.
  expect(card?.textContent).toContain('like every other file');
  expect(card?.textContent?.toLowerCase()).not.toMatch(/wrong|shouldn|too many|problem/);
  const btn = q('sync-large-seq-ignore-0');
  expect(btn?.textContent).toBe('Don’t sync this folder');
  expect(btn?.getAttribute('data-action')).toBe('sync.ignore-folder');
  await act(async () => btn?.click());
  expect(calls.filter((c) => c.url === '/_api/sync/settings')).toEqual([
    { url: '/_api/sync/settings', body: { addIgnoreFolder: SEQ } },
  ]);
  expect(q('sync-large-seq-left-0')?.textContent).toContain('stays there');
});

test('left-out folders are listed with Sync it again; nothing shows when there are none', async () => {
  const { f, calls } = fakeFetch();
  await mount({ status: status({ ignoreFolders: [SEQ] }), fetchImpl: f });
  expect(q('sync-ignored-folders')?.textContent).toContain('Not synced · 1');
  const again = q('sync-ignored-folder-resume-0');
  expect(again?.getAttribute('data-action')).toBe('sync.sync-folder-again');
  await act(async () => again?.click());
  expect(calls.filter((c) => c.url === '/_api/sync/settings')).toEqual([
    { url: '/_api/sync/settings', body: { removeIgnoreFolder: SEQ } },
  ]);
  expect(q('sync-ignored-folders')).toBeNull();

  act(() => root?.unmount());
  host?.remove();
  await mount({ status: status({}), fetchImpl: f });
  expect(q('sync-folders')).toBeNull();
});

test('both buttons are registry actions', () => {
  expect(ACTIONS_BY_ID.get('sync.ignore-folder' as never)).toBeTruthy();
  expect(ACTIONS_BY_ID.get('sync.sync-folder-again' as never)).toBeTruthy();
});
