// S2.22 G2 / G4 / G6 — the shell half of the canvas's selection, through the real useCanvasBridge hook and real
// `message` events (same harness as s9-22b-comment-bridge.test.tsx).
//
//   G4/G6  `select-set` with several objects: the shell holds ALL of them, so the inspector can say
//          "4 artboards · Mixed" / the multi-element inspector.
//   G2     `loaded` after a write (a resize reloads the canvas): a selected ARTBOARD (no element id) is put back
//          by its name — before this only an element with an id was.
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

import { RESTORE_LEAD_MS } from '../client/selection-scope.js';

const CANVAS_ORIGIN = 'http://canvas.test';
const FILE = '.design/ui/Site.tsx';
const posted: Array<Record<string, unknown>> = [];
const win = {
  name: 'active',
  postMessage: (m: Record<string, unknown>) => void posted.push(m),
};
const held: { current: unknown } = { current: null };

const board = (id: string) => ({
  file: FILE,
  selector: `[data-dc-screen="${id}"]`,
  artboardId: id,
  tag: 'article',
});
const element = (id: string) => ({
  file: FILE,
  id,
  selector: `[data-dc-screen="a1"] [data-cd-id="${id}"]`,
  artboardId: 'a1',
  tag: 'div',
});

const set: unknown[] = [];
const resync: unknown[][] = [];
const halo: unknown[] = [];
const NativeFetch = globalThis.fetch;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  set.length = 0;
  resync.length = 0;
  halo.length = 0;
  posted.length = 0;
  globalThis.fetch = NativeFetch;
});

function props(selected: unknown) {
  held.current = selected;
  const values: Record<string, unknown> = {
    selected,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN, designRel: '.design' },
    viewerMode: false,
    commentsByFile: {},
    theme: 'light',
    activePath: FILE,
    iframesRef: { current: new Map([[FILE, { contentWindow: win }]]) },
    selectedRef: held,
    setSelected: (s: unknown) => set.push(s),
    scheduleArtboardResync: (...a: unknown[]) => resync.push(a),
    scheduleHaloRestore: (s: unknown) => halo.push(s),
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

async function mount(selected: unknown = null) {
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(props(selected) as never);
    return null;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
}

function post(data: unknown) {
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    origin: { value: CANVAS_ORIGIN },
    source: { value: win },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
}

describe('select-set reaches the shell whole', () => {
  test('four artboards: the shell holds the four, not the first', async () => {
    await mount();
    const four = ['desktop', 'laptop', 'tablet', 'mobile'].map(board);
    post({ dgn: 'select-set', selection: four });
    const held = set.at(-1) as unknown[];
    expect(Array.isArray(held)).toBe(true);
    expect(held.length).toBe(4);
  });

  test('⇧-click on elements: all of them', async () => {
    await mount();
    post({ dgn: 'select-set', selection: [element('aaaaaaaa'), element('bbbbbbbb')] });
    expect((set.at(-1) as unknown[]).length).toBe(2);
  });

  test('one object stays one object; none clears', async () => {
    await mount();
    post({ dgn: 'select-set', selection: [element('aaaaaaaa')] });
    expect(Array.isArray(set.at(-1))).toBe(false);
    expect((set.at(-1) as { id: string }).id).toBe('aaaaaaaa');
    post({ dgn: 'select-set', selection: null });
    expect(set.at(-1)).toBeNull();
  });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const restores = () => posted.filter((m) => m.dgn === 'select-by-id');

describe('after the canvas reloads, the selection comes back', () => {
  test('a selected artboard is put back by its name (a resize reloads the canvas)', async () => {
    await mount(board('laptop'));
    post({ dgn: 'loaded', file: FILE });
    await act(async () => wait(RESTORE_LEAD_MS + 80));
    expect(restores()[0]).toEqual({ dgn: 'select-by-id', artboardId: 'laptop' });
  });

  test('a selected element goes back by its id, on the ladder', async () => {
    const sel = element('aaaaaaaa');
    await mount(sel);
    post({ dgn: 'loaded', file: FILE });
    await act(async () => wait(RESTORE_LEAD_MS + 80));
    expect(restores()[0]).toEqual({
      dgn: 'select-by-id',
      id: 'aaaaaaaa',
      artboardId: 'a1',
      index: 0,
    });
  });

  test('S2.24 G2: what the canvas selects AFTER `loaded` (a drawn rectangle) is what goes back, not the board', async () => {
    await mount(board('desktop'));
    post({ dgn: 'loaded', file: FILE });
    // the old tree flushes its select-set a beat after the new tree's `loaded`
    held.current = { ...element('rectangle'), artboardId: 'desktop' };
    await act(async () => wait(RESTORE_LEAD_MS + 80));
    const first = restores()[0];
    expect(first).toEqual({
      dgn: 'select-by-id',
      id: 'rectangle',
      artboardId: 'desktop',
      index: 0,
    });
    expect(restores().some((m) => m.artboardId === 'desktop' && m.id === undefined)).toBe(false);
  });
});

describe('S2.24 G1 — a write to the selected text puts the selection back so the canvas probes it again', () => {
  const OK = { ok: true, actionId: null, writeId: 'w1', rev: 'r1', refs: [] };
  const editOp = async (op: string) => {
    const sel = element('aaaaaaaa');
    await mount(sel);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(OK), { status: 200 })) as unknown as typeof fetch;
    post({
      dgn: 'edit-op',
      requestId: 'eo_1',
      op,
      targets: [{ artboard: 'a1', element: 'aaaaaaaa' }],
    });
    await act(async () => wait(RESTORE_LEAD_MS + 120));
  };

  test('Reset on the Type section: the inspector gets the selection measured again', async () => {
    await editOp('text.reset-style');
    expect(restores()[0]).toEqual({
      dgn: 'select-by-id',
      id: 'aaaaaaaa',
      artboardId: 'a1',
      index: 0,
    });
  });

  test('another kind of write does not touch the selection', async () => {
    await editOp('object.lock');
    expect(restores()).toEqual([]);
  });
});
