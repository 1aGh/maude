// S1.23 G3 — the panel foot ("21 artboards · …") kept its count after an artboard was trashed: the
// project index was re-read only when the tree's paths changed, and an artboard going to the trash changes
// none. The server already broadcasts `index-changed { seq, rels }`; the shell relays it as the window event
// below, and the hook that feeds the Canvases panel re-reads the index on it.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

describe('useCanvasIndex', () => {
  test('re-reads the index when the shell relays index-changed, and shows the new artboard count', async () => {
    const { useCanvasIndex, INDEX_CHANGED_EVENT } = await import(
      '../client/v2/canvases/use-canvas-index.js'
    );
    const urls: string[] = [];
    let seq = 1;
    let boards = 2;
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const body =
        url.includes('since=') && Number(url.split('since=')[1]) === seq
          ? { unchanged: true, seq }
          : {
              canvases: [
                { rel: 'ui/a.tsx', artboards: Array.from({ length: boards }, () => ({})) },
              ],
              writer: { seq },
            };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    let seen = -1;
    function Probe() {
      const snap = useCanvasIndex({ stamp: 'same', fetchImpl });
      seen = snap?.canvases?.[0]?.artboards?.length ?? -1;
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Probe />));
    await wait(300);
    expect(urls).toEqual(['/_api/index']);
    expect(seen).toBe(2);

    // an artboard is trashed: no path changed, the server only says the index moved
    boards = 1;
    seq = 2;
    await act(async () => {
      window.dispatchEvent(new CustomEvent(INDEX_CHANGED_EVENT, { detail: { seq: 2, rels: [] } }));
    });
    await wait(300);
    expect(urls).toEqual(['/_api/index', '/_api/index?since=1']);
    expect(seen).toBe(1);
  });
});
