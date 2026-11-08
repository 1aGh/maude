// #158 — Sync details: an issue row per canvas that uses files which will not reach the workspace,
// each naming the file and the reason. Read-only (no button), calm (never a verdict on the canvas),
// and absent when the project is not linked or nothing is out.
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

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const status = () => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  url: 'https://hub.test',
  files: { synced: 12, pulled: 0, conflicts: 0 },
});

const REF = (canvas: string, file: string, reason: string, detail: string, fix: string) => ({
  canvas,
  file,
  ref: file,
  via: 'import',
  reason,
  detail,
  fix,
});

function fetchWith(answer: unknown) {
  return (async (url: string) => {
    if (url === '/_api/sync/unsynced-refs')
      return new Response(JSON.stringify(answer), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
}
async function mount(fetchImpl: typeof fetch) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <SyncDetails project="StudyFi" status={status() as never} fetchImpl={fetchImpl} />
    );
  });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

test('one row per canvas names each file and why', async () => {
  await mount(
    fetchWith({
      linked: true,
      syncFiles: true,
      canvases: 3,
      refs: [
        REF(
          'ui/x/foo.tsx',
          'ui/x/_foo/screens.tsx',
          'underscore-folder',
          'It is in _foo, and folders starting with _ stay on this Mac.',
          'Rename the folder without the _.'
        ),
        REF(
          'ui/x/foo.tsx',
          'ui/x/gone.tsx',
          'missing',
          'It is not in this project.',
          'Add it back, or fix the import.'
        ),
        REF(
          'ui/y/bar.tsx',
          'ui/y/fonts/a.woff2',
          'sync-files-off',
          'Only assets/ is shared.',
          'Move it into assets/.'
        ),
      ],
    })
  );
  const section = q('sync-unsynced');
  expect(section).not.toBeNull();
  expect(section?.textContent).toContain('2 canvases');
  const first = q('sync-unsynced-0');
  expect(first?.textContent).toContain('foo');
  expect(first?.textContent).toContain('ui/x/_foo/screens.tsx');
  expect(first?.textContent).toContain('folders starting with _ stay on this Mac');
  expect(first?.textContent).toContain('ui/x/gone.tsx');
  expect(q('sync-unsynced-1')?.textContent).toContain('ui/y/fonts/a.woff2');
  // Read-only: no button, no verdict on the canvas.
  expect(section?.querySelector('button')).toBeNull();
  expect(section?.textContent?.toLowerCase()).not.toMatch(/broken|wrong|error|oops|!/);
});

test('nothing out, or not linked: no section', async () => {
  await mount(fetchWith({ linked: true, syncFiles: true, canvases: 4, refs: [] }));
  expect(q('sync-unsynced')).toBeNull();
  act(() => root?.unmount());
  host?.remove();
  await mount(fetchWith({ linked: false, syncFiles: true, canvases: 0, refs: [] }));
  expect(q('sync-unsynced')).toBeNull();
});

test('an unreadable answer is silence, not an error', async () => {
  await mount(fetchWith({ ok: true }));
  expect(q('sync-unsynced')).toBeNull();
  expect(q('sync-panel')).not.toBeNull();
});
