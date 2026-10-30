// Phase 8 (G5 fidelity, canvas 15 an-stk-drop / an-stamps / an-ai-stickers) — a placed sticker drew a
// broken-image icon. The frame reads an asset only once it is in the canvas's closure, and the closure
// learns the asset from the BOARD on disk (C4: closure.ts staticAssetRefs over the canvas's sidecars).
// A placed picture renders at once — before its board write lands and the file watcher bumps the
// closure generation — so its first request is `403 not-in-scope`, and an SVG <image> never asks
// again. ImageView now re-asks a few times, each under a new URL, until the picture loads.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { AnnotationElement } from '../annotations/types.ts';
import { ElementNode, IMAGE_RETRY_DELAYS_MS } from '../annotations/ui/element-node.tsx';

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

const sticker = (href: string) =>
  ({
    id: 'k1',
    index: 'a0',
    type: 'image',
    x: 10,
    y: 10,
    w: 160,
    h: 160,
    href,
    sticker: { pack: 'project-status', id: 'group-100' },
  }) as unknown as AnnotationElement;

async function mount(el: AnnotationElement) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root') as HTMLElement);
  roots.push(root);
  const node = (e: AnnotationElement) =>
    createElement(
      'svg',
      null,
      createElement(ElementNode, {
        el: e,
        interactive: true,
        edit: null,
        resolveAsset: (h: string) => `/.design/${h}`,
      } as never)
    );
  await act(async () => root.render(node(el)));
  return { rerender: (e: AnnotationElement) => act(async () => root.render(node(e))) };
}
const img = () => document.querySelector('image') as SVGImageElement;
const fail = () => act(async () => void img().dispatchEvent(new Event('error')));
const wait = (ms: number) => act(async () => void (await Bun.sleep(ms)));

describe('a placed picture whose first load is refused', () => {
  test('is asked for again under a new URL until it loads, then left alone', async () => {
    await mount(sticker('assets/e4af3f9a.png'));
    expect(img().getAttribute('href')).toBe('/.design/assets/e4af3f9a.png');
    await fail();
    await wait((IMAGE_RETRY_DELAYS_MS[0] as number) + 30);
    const second = img().getAttribute('href');
    expect(second).not.toBe('/.design/assets/e4af3f9a.png');
    expect(second?.startsWith('/.design/assets/e4af3f9a.png?')).toBe(true);
    await act(async () => void img().dispatchEvent(new Event('load')));
    await wait((IMAGE_RETRY_DELAYS_MS[1] as number) + 30);
    expect(img().getAttribute('href')).toBe(second);
  });

  test('stops after the last retry (a picture that is really gone)', async () => {
    await mount(sticker('assets/gone.png'));
    const seen = new Set<string>();
    for (const d of IMAGE_RETRY_DELAYS_MS) {
      seen.add(img().getAttribute('href') as string);
      await fail();
      await wait(d + 30);
    }
    seen.add(img().getAttribute('href') as string);
    expect(seen.size).toBe(IMAGE_RETRY_DELAYS_MS.length + 1);
    const last = img().getAttribute('href');
    await fail();
    await wait(50 + Math.max(...IMAGE_RETRY_DELAYS_MS));
    expect(img().getAttribute('href')).toBe(last);
  }, 20000);

  test('a new picture (Replace…) starts with its own plain URL', async () => {
    const m = await mount(sticker('assets/a.png'));
    await fail();
    await wait((IMAGE_RETRY_DELAYS_MS[0] as number) + 30);
    await m.rerender(sticker('assets/b.png'));
    expect(img().getAttribute('href')).toBe('/.design/assets/b.png');
  });
});
