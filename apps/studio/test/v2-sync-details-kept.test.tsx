// 2.1.1 T14 — Sync details after a first link: the copy of this Mac's version a file conflict parked
// beside the file, and the layout / sticky notes / comments the server's version replaced, are rows with
// words — not a silent ledger state. The old word for the conflict ("the older copy is in the trash") was
// wrong: the copy is beside the file.
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
import SyncDetails from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import {
  DELIVERY_WORD,
  fileConflictWords,
  setAsideRows,
  setAsideWords,
  syncDetailsModel,
} from '../client/v2/diagnostics/sync-details/sync-details-model.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  (window as { __TAURI__?: unknown }).__TAURI__ = undefined;
});

const COPY = 'components/both.maude-conflict-2026-11-09T18-01-14-837-Alices-MacBooklocal.css';
const status = (over: Record<string, unknown> = {}, files: Record<string, unknown> = {}) => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  url: 'https://hub.test',
  files: {
    synced: 4,
    pulled: 1,
    conflicts: 1,
    delivery: { 'components/both.css': 'conflict', 'components/ok.css': 'on-hub' },
    conflictCopies: { 'components/both.css': COPY },
    ...files,
  },
  notices: [],
  ...over,
});
const SET_ASIDE = {
  id: 'set-aside-ui-same',
  severity: 'warn',
  text: 'same: the project’s layout replaced this Mac’s.',
  lanes: ['meta'],
  at: 1,
};

async function mount(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<SyncDetails project="StudyFi" {...(props as never)} />);
  });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

test('the conflict word no longer says the copy is in the trash', () => {
  expect(DELIVERY_WORD.conflict).not.toMatch(/trash|older/i);
});

test('model: a conflict with a parked copy is a file-conflict row, not an attention line', () => {
  const m = syncDetailsModel(status());
  expect(m.lists.fileConflicts).toEqual([
    { rel: 'components/both.css', copy: COPY, copyName: COPY.split('/').pop() },
  ]);
  expect(m.lists.attention).toEqual([]);
});

test('model: a conflict whose copy is not parked yet stays in the attention list', () => {
  const m = syncDetailsModel(status({}, { conflictCopies: undefined }));
  expect(m.lists.fileConflicts).toEqual([]);
  expect(m.lists.attention).toEqual([['components/both.css', 'conflict']]);
});

test('model: a copy path that climbs out of the folder is never offered', () => {
  const m = syncDetailsModel(
    status({}, { conflictCopies: { 'components/both.css': '../../etc/passwd' } })
  );
  expect(m.lists.fileConflicts).toEqual([]);
});

test('model: set-aside notices become rows with the lanes in words', () => {
  expect(setAsideRows({ notices: [SET_ASIDE, { id: 'set-aside-../x', lanes: ['meta'] }] })).toEqual(
    [{ slug: 'ui-same', lanes: ['layout'], where: '_history/ui-same/sync-recovery' }]
  );
  expect(setAsideWords('Same', ['layout'])).toBe(
    'Same: the server’s layout is used; yours is kept.'
  );
  expect(setAsideWords('Same', ['layout', 'comments'])).toBe(
    'Same: the server’s layout and comments are used; yours are kept.'
  );
  expect(fileConflictWords('both.maude-conflict-x-local.css')).toBe(
    'The server’s version is the file; yours is kept beside it as both.maude-conflict-x-local.css.'
  );
});

test('the panel shows the file-conflict row and names the copy; Show in Finder reveals it', async () => {
  const calls: { cmd: string; args: unknown }[] = [];
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string, args: unknown) => {
        calls.push({ cmd, args });
      },
    },
  };
  await mount({ status: status(), native: true, designRel: '.design' });
  const row = q('sync-file-conflict-0');
  expect(row?.textContent).toContain('components/both.css');
  expect(row?.textContent).toContain(COPY.split('/').pop() as string);
  expect(row?.textContent).not.toMatch(/trash/i);
  expect(q('sync-delivery-attention')).toBeNull();
  await act(async () => {
    q('sync-file-conflict-reveal-0')?.click();
  });
  expect(calls).toEqual([{ cmd: 'project_reveal_path', args: { rel: `.design/${COPY}` } }]);
});

test('the panel shows a set-aside row with the canvas name; a browser tab has no Finder button', async () => {
  await mount({
    status: status({ notices: [SET_ASIDE] }, { conflictCopies: undefined, delivery: {} }),
    native: false,
    names: new Map([['ui-same', 'Same']]),
  });
  const row = q('sync-set-aside-0');
  expect(row?.textContent).toContain('Same: the server’s layout is used; yours is kept.');
  expect(row?.textContent).toContain('_history/ui-same/sync-recovery');
  expect(q('sync-set-aside-reveal-0')).toBeNull();
  expect(q('sync-file-conflict-0')).toBeNull();
});

test('nothing kept → no section', async () => {
  await mount({ status: status({}, { conflictCopies: undefined, delivery: {} }) });
  expect(q('sync-kept')).toBeNull();
});
