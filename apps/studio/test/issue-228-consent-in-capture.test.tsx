// #228 — the sync consent sheet ("This project syncs with …") is drawn for a person, never in a capture
// helper's own browser (bin/_capture-init.js sets window.__MAUDE_CAPTURE__), where it covered every
// "Maude window" screenshot a bug report attaches. Rendered for real: same props, with and without the mark.
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
import SyncConsentDialog from '../client/panels/SyncConsentDialog.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  delete (window as unknown as { __MAUDE_CAPTURE__?: boolean }).__MAUDE_CAPTURE__;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});
async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      (<SyncConsentDialog status={{ url: 'https://design.example.com' }} cloud={null} />) as never
    );
  });
}

test('a person on a synced project, not asked yet, sees the sheet', async () => {
  await mount();
  expect(document.body.textContent).toContain('This project syncs with');
  expect(document.body.textContent).toContain('Keep syncing everything');
});

test('the same project in a capture’s browser draws no sheet, and nothing is answered', async () => {
  (window as unknown as { __MAUDE_CAPTURE__?: boolean }).__MAUDE_CAPTURE__ = true;
  await mount();
  expect(document.body.textContent).not.toContain('This project syncs with');
  expect(localStorage.length).toBe(0); // no consent was recorded on the person's behalf
});
