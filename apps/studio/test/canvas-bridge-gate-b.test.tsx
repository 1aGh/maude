// Gate B fix pack, the bridge half.
//
// G6 — a canvas that does not parse must raise the load-failure card, not leave an empty stage.
//
// The shell page posts `canvas-failed` when the canvas module would not build (a missing closing tag). The
// bridge used to answer with ONLY `setLoadingPath(null)`, which also cancelled the 15 s cap that raises the
// card, so the stage stayed empty with no card — while a canvas that threw while drawing had one
// (`render-error`). Now the active frame's `canvas-failed` sets `canvasError` for the OPEN canvas.
//
// Same harness as s9-22b-comment-bridge.test.tsx: the real useCanvasBridge hook, real `message` events.

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
import { layersTreeOf } from '../client/shell/util.js';

const CANVAS_ORIGIN = 'http://canvas.test';
const ACTIVE = '.design/ui/Active.tsx';
const BACKGROUND = '.design/ui/Background.tsx';

const frameWin = (name: string) => ({ name, postMessage: () => {} });
const activeWin = frameWin('active-frame');
const backgroundWin = frameWin('background-frame');

const errors: unknown[] = [];
const trees: unknown[] = [];
const loading: Array<(p: string | null) => string | null> = [];

function bridgeProps(overrides: Record<string, unknown>) {
  const values: Record<string, unknown> = {
    selected: null,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN, designRel: '.design' },
    viewerMode: false,
    commentsByFile: {},
    focusedCommentId: null,
    theme: 'light',
    canvasActiveArtboard: null,
    minimapVisible: false,
    zoomCtlVisible: false,
    presentMode: false,
    gitUser: 'Tereza',
    setCanvasError: (v: unknown) => errors.push(v),
    setLayersTree: (v: unknown) => trees.push(v),
    setLoadingPath: (v: (p: string | null) => string | null) => loading.push(v),
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
  errors.length = 0;
  trees.length = 0;
  loading.length = 0;
});

async function mount(activePath: string | null) {
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(bridgeProps({ activePath }) as never);
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

describe('canvas-failed (G6)', () => {
  test('the open canvas’s own failure raises the load-failure card, and drops the loading card', async () => {
    await mount(ACTIVE);
    post(activeWin, { dgn: 'canvas-failed', file: ACTIVE });
    expect(errors).toEqual([{ path: ACTIVE, kind: 'compile' }]);
    expect(loading.length).toBe(1);
    expect(loading[0]?.(ACTIVE)).toBe(null);
  });

  test('a canvas-rendered clears the loading card and raises no card', async () => {
    await mount(ACTIVE);
    post(activeWin, { dgn: 'canvas-rendered', file: ACTIVE });
    expect(errors).toEqual([]);
    expect(loading.length).toBe(1);
  });

  test('a background frame, a foreign origin and a discarded source raise nothing', async () => {
    await mount(ACTIVE);
    post(backgroundWin, { dgn: 'canvas-failed', file: BACKGROUND });
    post(activeWin, { dgn: 'canvas-failed', file: ACTIVE }, 'https://evil.test');
    post(null, { dgn: 'canvas-failed', file: ACTIVE });
    expect(errors).toEqual([]);
  });

  test('the card is for the OPEN canvas, whatever file the frame names', async () => {
    await mount(ACTIVE);
    post(activeWin, { dgn: 'canvas-failed', file: BACKGROUND });
    expect(errors).toEqual([{ path: ACTIVE, kind: 'compile' }]);
  });

  test('no canvas open: nothing to raise a card for', async () => {
    await mount(null);
    post(null, { dgn: 'canvas-failed', file: ACTIVE });
    expect(errors).toEqual([]);
  });
});

// Observation (gate B): after opening a blank canvas the Layers panel kept listing the previous canvas's `div`.
// A blank canvas posts no tree, so the state held the last canvas's. The tree now carries its canvas.
describe('the Layers tree follows the open canvas', () => {
  const TREE = { dgn: 'layers-tree', artboardId: 'home', tree: [{ id: 'a1b2c3d4', tag: 'div' }] };

  test('the tree the open canvas posts is tagged with that canvas', async () => {
    await mount(ACTIVE);
    post(activeWin, TREE);
    expect(trees).toEqual([
      { artboardId: 'home', nodes: [{ id: 'a1b2c3d4', tag: 'div' }], canvas: ACTIVE },
    ]);
  });

  test('a background frame posts no tree into the panel', async () => {
    await mount(ACTIVE);
    post(backgroundWin, TREE);
    expect(trees).toEqual([]);
  });

  test('layersTreeOf: the previous canvas’s tree is no tree for this one; the same canvas keeps its own', () => {
    const t = { artboardId: 'home', nodes: [{ id: 'x', tag: 'div' }], canvas: ACTIVE };
    expect(layersTreeOf(t, ACTIVE)).toBe(t);
    expect(layersTreeOf(t, BACKGROUND)).toBeNull(); // a blank canvas opened after it
    expect(layersTreeOf(t, null)).toBeNull();
    expect(layersTreeOf(null, ACTIVE)).toBeNull();
    // an untagged tree (nothing posts one) is never shown as anybody's
    expect(layersTreeOf({ artboardId: 'home', nodes: [] }, ACTIVE)).toBeNull();
  });
});
