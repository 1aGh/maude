// Surface rows L18.history.preview-restore (2026-11-08): a teammate's restore reached every disk, the canvas
// soft-reloaded and said `loaded`, yet the receivers' Inspector kept the pre-restore weight. The shell's
// restore ladder had put the selection back by the WRONG id: S2.25 G1 remembers "a write gave this text an
// authored name" (content-hash id → name) so a reload after `Use a style` / a retitle follows the text to its
// new id — but it remembered it per artboard id + element id only. Content-hash ids are structural, so two
// canvases built alike share them: a retitle on one canvas (L21.independent-edits stamped
// `data-cd-id="independent-hub"`) redirected every later restore on ANOTHER canvas to a name that exists only
// on the first. The canvas resolved nothing, never re-sent its selection, and the Inspector showed old values.
//
// The rename belongs to the canvas it was written on. Real useCanvasBridge hook, real `message` events
// (same harness as s2-22-bridge-select.test.tsx).
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
const RETITLED = '.design/ui/SurfaceIndependent-hub.tsx';
const RESTORED = '.design/ui/SurfaceHistoryPreview-hub.tsx';
const posted: Array<Record<string, unknown>> = [];
const win = {
  name: 'active',
  postMessage: (m: Record<string, unknown>) => void posted.push(m),
};
const held: { current: unknown } = { current: null };
const heading = (file: string) => ({
  file,
  id: '42612cfe',
  selector: '[data-dc-screen="el"] [data-cd-id="42612cfe"]',
  artboardId: 'el',
  tag: 'h1',
});

const NativeFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  posted.length = 0;
  globalThis.fetch = NativeFetch;
});

function props() {
  const values: Record<string, unknown> = {
    selected: held.current,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN, designRel: '.design' },
    viewerMode: false,
    commentsByFile: {},
    theme: 'light',
    activePath: RETITLED,
    iframesRef: {
      current: new Map([
        [RETITLED, { contentWindow: win }],
        [RESTORED, { contentWindow: win }],
      ]),
    },
    selectedRef: held,
    setSelected: () => {},
    scheduleArtboardResync: () => {},
    scheduleHaloRestore: () => {},
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

async function mount() {
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(props() as never);
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const restores = () => posted.filter((m) => m.dgn === 'select-by-id');

describe('a name a write gave a text belongs to the canvas it was written on', () => {
  test('a retitle on one canvas does not redirect the restore on another canvas built alike', async () => {
    held.current = heading(RETITLED);
    await mount();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          actionId: null,
          writeId: 'w1',
          rev: 'r1',
          refs: [{ artboard: 'el', element: 'independent-hub' }],
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    // the leaf editor's retitle on the first canvas authors a name for its heading
    post({
      dgn: 'edit-op',
      requestId: 'eo_1',
      op: 'text.set',
      params: { text: 'Retitled by hub' },
      targets: [{ artboard: 'el', element: '42612cfe' }],
    });
    await act(async () => wait(RESTORE_LEAD_MS + 120));
    // on the canvas it was written on, the restore follows the text to its new name (S2.25 G1, unchanged)
    expect(restores().at(-1)).toMatchObject({ id: 'independent-hub' });

    // later: the person selects the heading of ANOTHER canvas with the same structure (same content-hash id),
    // and a teammate's restore soft-reloads it
    posted.length = 0;
    held.current = heading(RESTORED);
    post({ dgn: 'loaded', file: RESTORED });
    await act(async () => wait(RESTORE_LEAD_MS + 80));
    expect(restores().length).toBeGreaterThan(0);
    for (const m of restores())
      expect(m).toEqual({ dgn: 'select-by-id', id: '42612cfe', artboardId: 'el', index: 0 });
  });
});
