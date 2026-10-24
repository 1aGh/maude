// Phase 8 C4 — ONE toast rule (decision v2-p8-c4-toast-dock-or-top). The kit's `Toast at="dock"` is the default:
// the one-line pill above the canvas toolbar. It goes to the TOP (`at="top"`) when the notice is a state of the
// app (tabs reopened, opened from a link, back online — the caller says `placement: 'top'`) or when the video
// timeline sits in the dock (07: Split / Captions added), so it never covers the timeline.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let NotificationHost: typeof import('../notifications.tsx').NotificationHost;
let notify: typeof import('../notifications.tsx').notify;
let dismissNotice: typeof import('../notifications.tsx').dismissNotice;
const realTimeout = globalThis.setTimeout;
let root: Root | null = null;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ NotificationHost, notify, dismissNotice } = await import('../notifications.tsx'));
});
afterEach(async () => {
  await act(async () => {
    dismissNotice('r-dock');
  });
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

const settle = () =>
  act(async () => {
    await new Promise((r) => realTimeout(r, 80));
  });
async function mountHost() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<NotificationHost />));
}
const yOf = (id: string) =>
  document
    .querySelector(`[data-testid="notice-${id}"]`)
    ?.closest('[data-sonner-toast]')
    ?.getAttribute('data-y-position');

describe('the toast rule: dock by default, top for app states and over the timeline', () => {
  test('an edit outcome sits in the dock (bottom)', async () => {
    await mountHost();
    await act(async () => {
      notify({ id: 'r-dock', title: 'Duplicated at Laptop — 1280 wide.', kind: 'undo' });
    });
    await settle();
    expect(yOf('r-dock')).toBe('bottom');
  });

  test('the same notice moves to the top while the video timeline is up', async () => {
    const tl = document.createElement('div');
    tl.className = 'tl-track';
    document.body.append(tl);
    await mountHost();
    await act(async () => {
      notify({ id: 'r-dock', title: 'Split Oslava at 0:10.', kind: 'undo' });
    });
    await settle();
    expect(yOf('r-dock')).toBe('top');
  });

  test('an explicit bottom is not moved by the timeline', async () => {
    const tl = document.createElement('div');
    tl.className = 'tl-track';
    document.body.append(tl);
    await mountHost();
    await act(async () => {
      notify({ id: 'r-dock', title: 'Copied as a PNG', kind: 'success', placement: 'bottom' });
    });
    await settle();
    expect(yOf('r-dock')).toBe('bottom');
  });
});

describe('shell events keep their placement through the tabs hook', () => {
  test('use-tabs forwards the pill options (placement top) to notify', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'client/hooks/use-tabs.jsx'), 'utf8');
    const i = src.indexOf('startShellEvents({');
    expect(src.slice(i, i + 400)).toMatch(
      /toast:\s*\([^)]*opts[^)]*\)\s*=>\s*notify\(\{[^}]*\.\.\.opts/
    );
  });
});
