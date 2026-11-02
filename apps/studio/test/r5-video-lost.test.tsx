// r5-1 (Michal: "video se zobrazi pres celou obrazovku" + "Picture not found .design/assets/820e2d45.mov") — a clip that
// cannot be loaded is a CLIP: it says "Video not found" with its path (never "Picture not found"), is asked for again like a
// picture, and its frame never grows past the clip itself. Zooming out shrank the clip under FRAME_MIN, and the frame then
// took "an ancestor big enough for the card" — the whole world — and hatched the screen.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AssetPlaceholderLayer, frameBox } from '../asset-placeholder.tsx';

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

async function mountLayer() {
  document.body.innerHTML = '<div id="art"></div><div id="root"></div>';
  const root = createRoot(document.getElementById('root') as HTMLElement);
  roots.push(root);
  await act(async () =>
    root.render(createElement(AssetPlaceholderLayer, { inShell: true, retryDelays: [10, 10] }))
  );
}
const wait = (ms: number) => act(async () => void (await Bun.sleep(ms)));
const frames = () => [...document.querySelectorAll('[data-testid="asset-frame"][data-lost="1"]')];

describe('a clip that cannot be loaded (r5-1)', () => {
  test('says "Video not found" with its path, is asked for again, never "Picture not found"', async () => {
    await mountLayer();
    const v = document.createElement('video');
    v.setAttribute('src', '/.design/assets/820e2d45.mov');
    Object.defineProperty(v, 'error', { value: { code: 4 } }); // MEDIA_ERR_SRC_NOT_SUPPORTED, as a browser reports it
    await act(async () => void document.getElementById('art')?.appendChild(v));
    await act(async () => void v.dispatchEvent(new Event('error')));
    expect(frames()).toHaveLength(0); // still asking again
    // a browser answers each asked-for-again clip with its own error; happy-dom does not, so deliver them by hand
    await wait(40);
    expect(v.getAttribute('src')).toBe('/.design/assets/820e2d45.mov?r=1');
    await act(async () => void v.dispatchEvent(new Event('error')));
    await wait(40);
    await act(async () => void v.dispatchEvent(new Event('error')));
    expect(v.getAttribute('src')).toBe('/.design/assets/820e2d45.mov?r=2');
    expect(frames()).toHaveLength(1);
    const f = frames()[0] as HTMLElement;
    expect(f.textContent).toContain('Video not found');
    expect(f.textContent).toContain('.design/assets/820e2d45.mov');
    expect(f.textContent).not.toContain('Picture not found');
    expect(f.getAttribute('aria-label')).toBe('Video not found · .design/assets/820e2d45.mov');
  });
});

describe('the frame of a failed clip stays on the clip (r5-1 zoom-out blow-up)', () => {
  const box = (w: number, h: number) => ({ left: 10, top: 20, width: w, height: h });
  const el = (b: ReturnType<typeof box>, parent: unknown = null, tagName = 'DIV') => ({
    getBoundingClientRect: () => b,
    parentElement: parent,
    tagName,
  });

  test('a clip zoomed out below the card size keeps its own rectangle, not the world around it', () => {
    const world = el(box(9000, 6000));
    const small = el(box(140, 83), world, 'VIDEO');
    expect(frameBox(small)).toEqual(box(140, 83));
  });

  test('an ancestor that fills the window is never taken as a picture frame', () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const world = el(box(vw + 500, vh + 500));
    const img = el(box(40, 14), world, 'IMG');
    const got = frameBox(img);
    expect(got?.width ?? 0).toBeLessThan(vw);
  });
});
