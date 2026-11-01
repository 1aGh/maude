// r4 img 44 (Michal's "Ahoj2" canvas showed the browser's bare blue "?" where a picture should be) — a picture that
// cannot be loaded and that no shell state explains (the shell said "here", or said nothing) was left to the
// browser's broken-image icon. Inside the shell the asset layer now asks an `<img>` again on a short ladder (a
// first answer refused before the canvas write landed), and then draws the app's own "Picture not found" frame
// with the path the picture asked for. Outside a shell (an export capture) nothing is drawn.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AssetPlaceholderLayer, lostPathOf, retryHref } from '../asset-placeholder.tsx';

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

// happy-dom answers a CHANGED src with an `error` of its own (the file is never there), as a browser would for a
// picture that stays gone; the very first failure is the one a test has to deliver by hand.
let DELAYS = [10, 10];
async function mountLayer(inShell: boolean) {
  document.body.innerHTML = '<div id="art"></div><div id="root"></div>';
  const root = createRoot(document.getElementById('root') as HTMLElement);
  roots.push(root);
  await act(async () =>
    root.render(createElement(AssetPlaceholderLayer, { inShell, retryDelays: DELAYS }))
  );
}
const addImg = async (src: string) => {
  const img = document.createElement('img');
  img.setAttribute('src', src);
  await act(async () => void document.getElementById('art')?.appendChild(img));
  return img;
};
const fails = (img: HTMLElement) => act(async () => void img.dispatchEvent(new Event('error')));
const wait = (ms: number) => act(async () => void (await Bun.sleep(ms)));
const frames = () => [...document.querySelectorAll('[data-testid="asset-frame"][data-lost="1"]')];

describe('a picture that cannot be loaded (r4 img 44)', () => {
  test('asks again on the ladder, then says "Picture not found" and the path', async () => {
    DELAYS = [10, 10];
    await mountLayer(true);
    const img = await addImg('assets/gone1234.png');
    await fails(img);
    expect(frames()).toHaveLength(0); // still asking again: no frame yet, no flash
    await wait(150); // both retries ran and the picture stayed gone
    expect(img.getAttribute('src')).toBe('assets/gone1234.png?r=2');
    expect(frames()).toHaveLength(1);
    const f = frames()[0] as HTMLElement;
    expect(f.dataset.rel).toBe('assets/gone1234.png');
    expect(f.textContent).toContain('Picture not found');
    expect(f.textContent).toContain('assets/gone1234.png');
  });

  test('a picture that loads on a retry never gets a frame', async () => {
    DELAYS = [10, 400];
    await mountLayer(true);
    const img = await addImg('assets/late5678.png');
    await fails(img);
    await wait(60); // the first retry ran (r=1) and failed again; the second is waiting
    expect(img.getAttribute('src')).toBe('assets/late5678.png?r=1');
    await act(async () => void img.dispatchEvent(new Event('load')));
    await wait(450);
    expect(img.getAttribute('src')).toBe('assets/late5678.png?r=1');
    expect(frames()).toHaveLength(0);
  });

  test('outside a shell (an export capture) nothing is asked again and nothing is drawn', async () => {
    await mountLayer(false);
    const img = await addImg('assets/gone1234.png');
    await fails(img);
    await wait(40);
    expect(img.getAttribute('src')).toBe('assets/gone1234.png');
    expect(frames()).toHaveLength(0);
  });

  test('the path it names is the project path, never a blob or data source', () => {
    expect(lostPathOf('assets/a.png', 'http://localhost:52252/assets/a.png')).toBe('assets/a.png');
    expect(lostPathOf('../ui/assets/a b.png', 'http://h/ui/assets/a%20b.png?r=1')).toBe(
      'ui/assets/a b.png'
    );
    expect(lostPathOf('blob:http://h/abc', 'blob:http://h/abc')).toBeNull();
    expect(lostPathOf('data:image/png;base64,AAAA', '')).toBeNull();
    expect(lostPathOf('', '')).toBeNull();
    expect(retryHref('assets/a.png', 1)).toBe('assets/a.png?r=1');
    expect(retryHref('assets/a.png?v=2&r=1', 2)).toBe('assets/a.png?v=2&r=2');
  });
});
