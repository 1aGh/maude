// V2-1.2 §5.2 arrows (`any → active`) / V2-2.8 S1, shell side — a canvas→shell message that acts on
// the ACTIVE canvas is honoured only from the active canvas's own window.
//
// The origin check proves only "a canvas said this": every canvas iframe shares one canvasOrigin,
// so a background (synced, untrusted — DDR-054) canvas passes it too. These handlers checked origin
// only: a background canvas could set the shell's selection (comment-compose), plant the Layers
// tree the user is about to click (layers-tree), open the Inspector, focus a comment, repaint the
// whole app's cursor (tool-cursor), override the artboard count, or read the main-origin export
// history (export-history-request). Each now also requires `activeWin && e.source === activeWin`.
//
// Same harness as canvas-key-gate.test.tsx: the real useCanvasBridge hook, real `message` events.

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

const replies: Array<{ to: string; msg: unknown }> = [];
const frameWin = (name: string) => ({
  name,
  postMessage: (msg: unknown) => replies.push({ to: name, msg }),
});
const activeWin = frameWin('active-frame');
const backgroundWin = frameWin('background-frame');

type Props = Record<string, unknown>;

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
  replies.length = 0;
  document.body.style.cursor = '';
  document.getElementById('dc-app-cursor')?.remove();
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

const sel = { id: 'heading', artboardId: 'main', file: ACTIVE };

/** [message, spy prop, payload] — each handler's observable effect is one spy call. */
const CASES: Array<[string, string, Record<string, unknown>]> = [
  ['comment-compose', 'setSelected', { selection: sel }],
  ['layers-tree', 'setLayersTree', { artboardId: 'main', tree: [] }],
  ['open-inspector', 'openRightPanel', {}],
  ['comment-click', 'setFocusedCommentId', { id: 'c1' }],
  ['artboards', 'setActiveArtboards', { count: 3 }],
];

describe('canvas→shell messages that act on the active canvas (V2-2.8 S1, shell side)', () => {
  for (const [dgn, spy, payload] of CASES) {
    test(`${dgn}: a background frame and a discarded source do nothing; the active frame does`, async () => {
      const calls: unknown[] = [];
      await mount(ACTIVE, { [spy]: (v: unknown) => calls.push(v) });
      post(backgroundWin, { dgn, ...payload });
      post(null, { dgn, ...payload });
      expect(calls.length).toBe(0);
      post(activeWin, { dgn, ...payload });
      expect(calls.length).toBe(1);
    });
  }

  test('a discarded source cannot pass as the active frame when no canvas is open', async () => {
    const calls: unknown[] = [];
    await mount(null, { setSelected: (v: unknown) => calls.push(v) });
    post(null, { dgn: 'comment-compose', selection: sel });
    expect(calls.length).toBe(0);
  });

  test('tool-cursor: only the active frame repaints the app cursor', async () => {
    await mount(ACTIVE, {});
    post(backgroundWin, { dgn: 'tool-cursor', tool: 'hand' });
    post(null, { dgn: 'tool-cursor', tool: 'hand' });
    expect(document.getElementById('dc-app-cursor')).toBeNull();
    post(activeWin, { dgn: 'tool-cursor', tool: 'hand' });
    expect(document.getElementById('dc-app-cursor')?.textContent ?? '').toContain('cursor');
  });

  test('export-history-request: a background frame reads no history; the active frame does', async () => {
    const NativeFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ history: [{ file: 'x.png' }] }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    try {
      await mount(ACTIVE, {});
      post(backgroundWin, { dgn: 'export-history-request', id: 'h1' });
      await new Promise((r) => setTimeout(r, 30));
      expect(replies.length).toBe(0);
      post(activeWin, { dgn: 'export-history-request', id: 'h2' });
      await new Promise((r) => setTimeout(r, 30));
      expect(replies.map((r) => r.to)).toEqual(['active-frame']);
    } finally {
      globalThis.fetch = NativeFetch;
    }
  });

  test('the origin check still runs first (a foreign origin is ignored)', async () => {
    const calls: unknown[] = [];
    await mount(ACTIVE, { openRightPanel: (v: unknown) => calls.push(v) });
    post(activeWin, { dgn: 'open-inspector' }, 'http://evil.example');
    expect(calls.length).toBe(0);
  });
});
