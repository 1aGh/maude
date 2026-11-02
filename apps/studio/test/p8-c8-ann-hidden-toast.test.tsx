// Phase 8 C8 (15 an-vs, an-layers) — "Annotations hidden. Press ⇧P to bring them back." is only true while the layer
// is hidden. Showing it again (⇧P, the Show button, the ⌘K row) must take the toast down; it used to sit out its
// 10 s clock and read as a lie over the next two scenes.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let NotificationHost: typeof import('../notifications.tsx').NotificationHost;
let syncAnnotationsHiddenToast: (visible: boolean, onShow: () => void) => void;
const realTimeout = globalThis.setTimeout;
let root: Root | null = null;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ NotificationHost } = await import('../notifications.tsx'));
  ({ syncAnnotationsHiddenToast } = await import('../client/hooks/annotations-hidden-toast.js'));
});
afterEach(async () => {
  await act(async () => syncAnnotationsHiddenToast(true, () => {}));
  await act(async () => {
    await new Promise((r) => realTimeout(r, 350));
  });
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});
afterAll(async () => {
  await new Promise((r) => realTimeout(r, 500));
  GlobalRegistrator.unregister();
});

const toast = () => document.querySelector('[data-testid="notice-annotations-hidden"]');
// sonner keeps a dismissed toast in the tree for its exit animation, marked data-removed
const gone = () => {
  const el = toast();
  return !el || el.closest('[data-sonner-toast]')?.getAttribute('data-removed') === 'true';
};
const settle = () =>
  act(async () => {
    await new Promise((r) => realTimeout(r, 450));
  });

describe('the ⇧P toast follows the layer', () => {
  test('hiding shows it once; showing again takes it down', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NotificationHost />));

    await act(async () => syncAnnotationsHiddenToast(false, () => {}));
    await act(async () => syncAnnotationsHiddenToast(false, () => {}));
    await settle();
    expect(document.querySelectorAll('[data-testid="notice-annotations-hidden"]').length).toBe(1);
    expect(gone()).toBe(false);
    expect(toast()?.textContent).toContain('Annotations hidden. Press ⇧P to bring them back.');

    await act(async () => syncAnnotationsHiddenToast(true, () => {}));
    await settle();
    expect(gone()).toBe(true);
  });
});
