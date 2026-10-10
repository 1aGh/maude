// V2-1.3 §5.7 / V2-2.4 step 6 — the canvas → shell `key` lane is honoured only from the ACTIVE
// canvas frame, and only for `fromCanvas` actions. Carries over V2-2.8 S3's `toggle-palette` cases
// (48e53253): that lane is retired for `{dgn:'key', v:1, chord}` (rule 13 — the old lane dies with
// the new one).
//
// The shell's inbound postMessage handler (client/hooks/use-canvas-bridge.jsx) first checks the
// message ORIGIN, but every open canvas iframe shares the one `canvasOrigin`, so that check proves
// only "a canvas said this". A forwarded chord is something the user pressed inside the canvas in
// view; a background or synced (untrusted, DDR-054) canvas must not pop the palette, reload the
// active canvas or open the Export dialog on demand — a modal-timing primitive.
//
// Behavioural, not a source grep: the real hook is mounted (happy-dom + React) with stub
// dependencies, and real `message` events are dispatched at it from the active frame, a background
// frame, and a discarded (null) source.

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

/** Every prop the hook destructures, with inert defaults: refs are refs, the value props carry
 *  neutral values, everything else is a no-op function. */
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

async function mount(activePath: string | null, spies: Props) {
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps({ activePath, ...spies }) as never);
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

const key = (chord: string) => ({ dgn: 'key', v: 1, chord });

describe('⌘K forwarded from a canvas frame (V2-2.8 S3, now on the `key` lane)', () => {
  test('the ACTIVE canvas frame toggles the palette', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, { setPaletteOpen: (v: unknown) => calls.push(v) });
    post(activeWin, key('⌘K'));
    expect(calls.length).toBe(1);
  });

  test('a BACKGROUND canvas frame cannot toggle it', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, { setPaletteOpen: (v: unknown) => calls.push(v) });
    post(backgroundWin, key('⌘K'));
    expect(calls.length).toBe(0);
  });

  test('a discarded source (null) cannot toggle it, even with no canvas open', async () => {
    // With no active canvas `activeWin` is null, and a message whose source context was
    // discarded before dispatch also carries `source: null` — the `null === null` hole.
    const calls: unknown[] = [];
    await mount(null, { setPaletteOpen: (v: unknown) => calls.push(v) });
    post(null, key('⌘K'));
    expect(calls.length).toBe(0);
  });

  test('the origin check still runs first (a foreign origin is ignored)', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, { setPaletteOpen: (v: unknown) => calls.push(v) });
    post(activeWin, key('⌘K'), 'http://evil.example');
    expect(calls.length).toBe(0);
  });

  test('the retired `toggle-palette` lane does nothing any more (rule 13)', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, { setPaletteOpen: (v: unknown) => calls.push(v) });
    post(activeWin, { dgn: 'toggle-palette' });
    expect(calls.length).toBe(0);
  });
});

describe('the `key` lane runs only fromCanvas actions (V2-1.3 §5.7)', () => {
  test('⇧⌘E from the active frame opens Export; ⌘R reloads', async () => {
    const dialogs: unknown[] = [];
    const reloads: unknown[] = [];
    await mount(ACTIVE, {
      setExportDialog: (v: unknown) => dialogs.push(v),
      reloadActive: () => reloads.push(1),
    });
    post(activeWin, key('⇧⌘E'));
    post(activeWin, key('⌘R'));
    expect(dialogs).toEqual([{ mode: 'export' }]);
    expect(reloads.length).toBe(1);
  });

  test('a chord whose action is not fromCanvas does nothing (⌘, Settings, ⇧⌘R refresh)', async () => {
    const opened: unknown[] = [];
    await mount(ACTIVE, {
      setSettingsOpen: (v: unknown) => opened.push(v),
      refreshTree: () => opened.push('refresh'),
    });
    post(activeWin, key('⌘,'));
    post(activeWin, key('⇧⌘R'));
    expect(opened).toEqual([]);
  });

  test('a malformed message is ignored (no v, a non-string chord)', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, { setPaletteOpen: (v: unknown) => calls.push(v) });
    post(activeWin, { dgn: 'key', chord: '⌘K' });
    post(activeWin, { dgn: 'key', v: 1, chord: 42 });
    expect(calls.length).toBe(0);
  });
});
