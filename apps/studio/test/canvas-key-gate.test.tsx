// V2-2.8 S3 — `toggle-palette` is honoured only from the ACTIVE canvas frame.
//
// The shell's inbound postMessage handler (client/hooks/use-canvas-bridge.jsx)
// first checks the message ORIGIN, but every open canvas iframe shares the one
// `canvasOrigin`, so that check proves only "a canvas said this". The other
// shell-bound chords a canvas forwards (`shell-shortcut`, `open-export`, …)
// therefore also require `e.source === activeWin`. `toggle-palette` (⌘K pressed
// inside the canvas) did not: a background or synced (untrusted, DDR-054)
// canvas could pop the command palette over whatever the user was doing, on
// demand and with no gesture — a modal-timing primitive.
//
// Behavioural, not a source grep: the real hook is mounted (happy-dom + React)
// with stub dependencies, and real `message` events are dispatched at it from
// the active frame, a background frame, and a discarded (null) source.
//
// The V2-1.3 contract names this file for the v2 canvas key gate (`key` /
// `request-action` from a background frame do nothing); this is its first case.

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

const CANVAS_ORIGIN = 'http://canvas.test';
const ACTIVE = '.design/ui/Active.tsx';
const BACKGROUND = '.design/ui/Background.tsx';

// Stand-ins for the two iframes' windows: the hook only compares identities.
const activeWin = { name: 'active-frame' };
const backgroundWin = { name: 'background-frame' };

type Props = Record<string, unknown>;

/** Every prop the hook destructures, with inert defaults: refs are refs, the
 *  value props carry neutral values, everything else is a no-op function. */
function bridgeProps(overrides: Props): Props {
  const values: Props = {
    selected: null,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN },
    viewerMode: false,
    commentsByFile: {},
    focusedCommentId: null,
    theme: 'light',
    canvasActiveArtboard: null,
    minimapVisible: false,
    zoomCtlVisible: false,
    presentMode: false,
    iframesRef: {
      current: new Map([
        [ACTIVE, { contentWindow: activeWin }],
        [BACKGROUND, { contentWindow: backgroundWin }],
      ]),
    },
    ...overrides,
  };
  const cache = new Map<string, unknown>();
  return new Proxy(values, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      if (!cache.has(key)) cache.set(key, key.endsWith('Ref') ? { current: null } : () => {});
      return cache.get(key);
    },
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount(activePath: string | null, setPaletteOpen: (v: unknown) => void) {
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps({ activePath, setPaletteOpen }) as never);
    return null;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
}

/** A `message` event as the browser delivers it: data, origin, source. */
function post(source: unknown, data: unknown, origin = CANVAS_ORIGIN) {
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    origin: { value: origin },
    source: { value: source },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
}

describe('toggle-palette from a canvas frame (V2-2.8 S3)', () => {
  test('the ACTIVE canvas frame toggles the palette', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, (v) => calls.push(v));
    post(activeWin, { dgn: 'toggle-palette' });
    expect(calls.length).toBe(1);
  });

  test('a BACKGROUND canvas frame cannot toggle it', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, (v) => calls.push(v));
    post(backgroundWin, { dgn: 'toggle-palette' });
    expect(calls.length).toBe(0);
  });

  test('a discarded source (null) cannot toggle it, even with no canvas open', async () => {
    // With no active canvas `activeWin` is null, and a message whose source
    // context was discarded before dispatch also carries `source: null` — the
    // `null === null` hole the comment relays already document.
    const calls: unknown[] = [];
    await mount(null, (v) => calls.push(v));
    post(null, { dgn: 'toggle-palette' });
    expect(calls.length).toBe(0);
  });

  test('the origin check still runs first (a foreign origin is ignored)', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, (v) => calls.push(v));
    post(activeWin, { dgn: 'toggle-palette' }, 'http://evil.example');
    expect(calls.length).toBe(0);
  });
});
