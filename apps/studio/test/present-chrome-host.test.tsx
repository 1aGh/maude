// S3.2b — the host: what the shell shows while it presents, read from the ONE mode store (D1).
//   Present · Artboards → the controls, with the canvas's own `present-position` as the counter
//   Present the canvas  → the pill, which leaves through the shell's exitPresent
//   not presenting      → nothing
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { ShellPresentChrome } from '../client/v2/present/present-chrome-host.jsx';
import { presentZoomStore } from '../client/v2/present/present-zoom-store.js';
import { shellMode } from '../client/v2/shell/use-canvas-mode-lane.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
let left = 0;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const store = {
    shellCore: { activePath: 'campaign.tsx', cfg: { designRel: '.design' } },
    photoAndTimeline: {
      exitPresent: () => {
        left += 1;
      },
    },
  };
  act(() => {
    root?.render(
      <ShellStoreContext.Provider value={store as never}>
        <ShellPresentChrome />
      </ShellStoreContext.Provider>
    );
  });
}
// The mode store is one per window, shared by every test file of this process: start from not presenting.
beforeEach(() => {
  shellMode.back();
  presentZoomStore.set(null);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  left = 0;
  act(() => {
    shellMode.back();
  });
  presentZoomStore.set(null);
});
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('<ShellPresentChrome>', () => {
  test('not presenting: nothing', () => {
    mount();
    expect(q('present-controls')).toBeNull();
    expect(q('present-pill')).toBeNull();
  });

  test('Present · Artboards shows the controls with the canvas’s own position', () => {
    mount();
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'start' });
    });
    expect(q('present-controls')).not.toBeNull();
    expect(q('present-pill')).toBeNull();
    expect(q('present-counter')?.textContent).toBe('');
    act(() => {
      shellMode.position({ index: 2, total: 14, artboardId: 'post' });
    });
    expect(q('present-counter')?.textContent).toBe('3 / 14');
  });

  test('leaving through the controls goes through exitPresent', () => {
    mount();
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'start' });
    });
    act(() => q('present-leave')?.click());
    expect(left).toBe(1);
  });

  test('Present the canvas shows the pill with the zoom the canvas reported, and no controls', () => {
    mount();
    act(() => {
      shellMode.present({ kind: 'canvas' });
    });
    expect(q('present-controls')).toBeNull();
    expect(q('present-pill')).not.toBeNull();
    expect(q('present-pill')?.textContent).not.toContain('%');
    act(() => presentZoomStore.set(0.21));
    expect(q('present-pill')?.textContent).toContain('21%');
    act(() => q('present-pill')?.click());
    expect(left).toBe(1);
  });
});
