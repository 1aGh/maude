// S2.15 — the Assets tab places pictures: a picture tile drags onto a frame (its payload is a path), ↵ on it puts it on the
// selected artboard (one image.place, one undo record), the panel says what to do when nothing is selected, and a viewer
// can do neither. The writer is test/edit-ops-image.test.ts; the contract is test/v2-place-asset.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ASSET_DRAG_MIME } from '../client/v2/assets/tile-drag.js';
import { parseAssetDrag } from '../editing/asset-drag.ts';

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body?: unknown }> = [];
const ASSETS = {
  ok: true,
  assets: [
    { path: 'assets/aa11bb22.jpg', name: 'IMG_2231.jpg', size: 4096, kind: 'image' },
    { path: 'assets/cc33dd44.mp4', name: 'drone.mp4', size: 99999, kind: 'video' },
  ],
};

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.startsWith('/_api/assets'))
      return new Response(JSON.stringify(ASSETS), { status: 200 });
    if (url === '/_api/edit-op')
      return new Response(
        JSON.stringify({ ok: true, writeId: 'w_0123456789abcdef', actionId: null, created: [] }),
        { status: 200 }
      );
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  calls = [];
});

async function mount(props: Record<string, unknown> = {}) {
  const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  return host;
}
const tiles = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>('[data-testid="assets-tile"]'),
];

describe('Assets tab — drag and ↵ (S2.15)', () => {
  test('a picture tile is draggable and carries its path; a video tile is not', async () => {
    const host = await mount();
    const [pic, vid] = tiles(host);
    expect(pic?.getAttribute('draggable')).toBe('true');
    expect(vid?.getAttribute('draggable')).not.toBe('true');
    const data = new Map<string, string>();
    const dt = { effectAllowed: '', setData: (k: string, v: string) => data.set(k, v) };
    const ev = new window.Event('dragstart', { bubbles: true }) as Event & {
      dataTransfer: unknown;
    };
    ev.dataTransfer = dt;
    await act(async () => {
      pic?.dispatchEvent(ev);
    });
    expect(parseAssetDrag(data.get(ASSET_DRAG_MIME))?.asset).toBe('assets/aa11bb22.jpg');
  });

  test('↵ on a picture tile places it on the selected artboard: one edit-op, one undo record', async () => {
    const recs: unknown[] = [];
    const host = await mount({
      placeTarget: { canvas: '.design/ui/Post.tsx', artboardId: 'post' },
      onRecord: (p: unknown) => recs.push(p),
    });
    await act(async () => {
      tiles(host)[0]?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    const placed = calls.filter((c) => c.url === '/_api/edit-op');
    expect(placed.length).toBe(1);
    expect(placed[0]?.body).toMatchObject({
      file: '.design/ui/Post.tsx',
      op: 'image.place',
      targets: [],
      params: { mode: 'loose', asset: 'assets/aa11bb22.jpg', artboard: 'post' },
    });
    expect(recs).toEqual([
      { op: 'edit-op', writeId: 'w_0123456789abcdef', label: 'Place picture' },
    ]);
  });

  test('with nothing selected it says what to do and writes nothing', async () => {
    const host = await mount({ placeTarget: null });
    await act(async () => {
      tiles(host)[0]?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Select an artboard first, then press ↵ on a picture.'
    );
    expect(calls.some((c) => c.url === '/_api/edit-op')).toBe(false);
  });

  test('a viewer can neither drag nor place', async () => {
    const host = await mount({ readOnly: true, placeTarget: { canvas: 'x', artboardId: 'a' } });
    expect(tiles(host)[0]?.getAttribute('draggable')).not.toBe('true');
    await act(async () => {
      tiles(host)[0]?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(calls.some((c) => c.url === '/_api/edit-op')).toBe(false);
  });
});

describe('placeTargetOf — where ↵ puts it', () => {
  test('the selected artboard, the selected frame, nothing / several / another canvas → null', async () => {
    const { placeTargetOf } = await import('../client/v2/assets/place-asset.js');
    const C = '.design/ui/Post.tsx';
    expect(placeTargetOf({ file: C, artboardId: 'post' }, C)).toEqual({
      canvas: C,
      artboardId: 'post',
    });
    expect(placeTargetOf([{ file: C, artboardId: 'post', id: 'hero', index: 2 }], C)).toEqual({
      canvas: C,
      artboardId: 'post',
      frameId: 'hero',
      occurrence: 2,
    });
    expect(placeTargetOf(null, C)).toBeNull();
    expect(placeTargetOf([], C)).toBeNull();
    expect(placeTargetOf([{ artboardId: 'a' }, { artboardId: 'b' }], C)).toBeNull();
    expect(placeTargetOf({ file: 'other.tsx', artboardId: 'post' }, C)).toBeNull();
    expect(placeTargetOf({ file: C, artboardId: 'post' }, '')).toBeNull();
  });
});
