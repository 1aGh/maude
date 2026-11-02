// S2.15 — `placeAsset`, the contract S8's Assets tab and Generate call (S8-slices § cross-lane contracts): the request it
// makes (frame vs artboard, modes), the words it answers with, the undo record on a legacy link and none on the op log;
// and the Assets tile's drag payload.
import { describe, expect, test } from 'bun:test';
import { placeAsset } from '../client/v2/assets/place-asset.js';
import { ASSET_DRAG_MIME, startAssetDrag, tileDragProps } from '../client/v2/assets/tile-drag.js';
import { parseAssetDrag } from '../editing/asset-drag.ts';

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { status, json: async () => body };
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const TARGET = { canvas: '.design/ui/Post.tsx', artboardId: 'post' };

describe('placeAsset', () => {
  test('onto a frame: one image.place, mode fill by default, the frame as the target', async () => {
    const { fetch, calls } = fakeFetch(200, {
      ok: true,
      writeId: 'w_0123456789abcdef',
      actionId: null,
      created: [{ artboard: 'post', element: 'img' }],
    });
    const recs: unknown[] = [];
    const r = await placeAsset(
      { asset: 'assets/ab12cd34.jpg', target: { ...TARGET, frameId: 'player' } },
      { fetch, record: (p) => recs.push(p) }
    );
    expect(r).toEqual({
      ok: true,
      writeId: 'w_0123456789abcdef',
      created: [{ artboard: 'post', element: 'img' }],
    });
    expect(calls).toEqual([
      {
        url: '/_api/edit-op',
        body: {
          file: '.design/ui/Post.tsx',
          op: 'image.place',
          targets: [{ artboard: 'post', element: 'player' }],
          params: { mode: 'fill', asset: 'assets/ab12cd34.jpg' },
        },
      },
    ]);
    expect(recs).toEqual([
      { op: 'edit-op', writeId: 'w_0123456789abcdef', label: 'Place picture' },
    ]);
  });

  test('onto an artboard (↵ on a selected artboard): loose, named by `artboard`, no target', async () => {
    const { fetch, calls } = fakeFetch(200, {
      ok: true,
      writeId: 'w_0123456789abcdef',
      actionId: null,
    });
    await placeAsset(
      { asset: 'assets/ab12cd34.jpg', target: TARGET, natural: { w: 4032, h: 3024 } },
      { fetch }
    );
    expect((calls[0] as { body: { targets: unknown } }).body.targets).toEqual([]);
    expect((calls[0] as { body: { params: unknown } }).body.params).toEqual({
      mode: 'loose',
      asset: 'assets/ab12cd34.jpg',
      artboard: 'post',
      natural: { w: 4032, h: 3024 },
    });
  });

  test('several at once, in order or as a grid', async () => {
    const { fetch, calls } = fakeFetch(200, {
      ok: true,
      writeId: 'w_0123456789abcdef',
      actionId: 'a_1',
    });
    const recs: unknown[] = [];
    await placeAsset(
      {
        assets: ['assets/a1.png', 'assets/a2.png'],
        target: { ...TARGET, frameId: 'row' },
        mode: 'fill-in-order',
      },
      { fetch, record: (p) => recs.push(p) }
    );
    expect((calls[0] as { body: { params: unknown } }).body.params).toEqual({
      mode: 'fill-in-order',
      assets: ['assets/a1.png', 'assets/a2.png'],
    });
    expect(recs).toEqual([]); // the op log undoes through the kernel, not a second record
  });

  test('refusals are said in words; a viewer, a lock, an AI hold', async () => {
    for (const [code, text] of [
      ['locked', 'Not placed. That is locked; unlock it first.'],
      ['forbidden', 'Not placed. You can look here; ask to edit.'],
      ['held-by-ai', 'Not placed. This belongs to AI until it’s done; Stop is in the AI chat.'],
    ] as const) {
      const { fetch } = fakeFetch(code === 'locked' ? 409 : 403, { ok: false, code, message: 'x' });
      const recs: unknown[] = [];
      const r = await placeAsset(
        { asset: 'assets/a.png', target: TARGET },
        { fetch, record: (p) => recs.push(p) }
      );
      expect(r).toEqual({ ok: false, message: text });
      expect(recs).toEqual([]);
    }
  });

  test('an older studio, an unreachable one, and an empty ask never throw', async () => {
    expect(
      (await placeAsset({ asset: 'assets/a.png', target: TARGET }, fakeFetch(404, {}))).ok
    ).toBe(false);
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;
    expect(await placeAsset({ asset: 'assets/a.png', target: TARGET }, { fetch: down })).toEqual({
      ok: false,
      message: 'Not placed. The studio could not be reached; try again.',
    });
    expect((await placeAsset({ target: TARGET })).ok).toBe(false);
    expect((await placeAsset({ asset: 'assets/a.png', target: { canvas: 'x' } } as never)).ok).toBe(
      false
    );
  });
});

describe('an Assets tile’s drag', () => {
  const dt = () => {
    const data = new Map<string, string>();
    return {
      data,
      effectAllowed: '',
      setData: (k: string, v: string) => data.set(k, v),
      setDragImage: () => {},
    };
  };

  test('starts a copy that carries the path and the natural size under its own type', () => {
    const d = dt();
    const ok = startAssetDrag({ dataTransfer: d }, 'assets/ab12cd34.jpg', {
      naturalWidth: 4032,
      naturalHeight: 3024,
    });
    expect(ok).toBe(true);
    expect(d.effectAllowed).toBe('copy');
    expect(parseAssetDrag(d.data.get(ASSET_DRAG_MIME))).toEqual({
      asset: 'assets/ab12cd34.jpg',
      w: 4032,
      h: 3024,
    });
  });

  test('a path that is not a project asset does not start a drag', () => {
    const d = dt();
    let prevented = false;
    const ok = startAssetDrag(
      { dataTransfer: d, preventDefault: () => (prevented = true) },
      '../x.png',
      null
    );
    expect(ok).toBe(false);
    expect(prevented).toBe(true);
    expect(d.data.size).toBe(0);
  });

  test('tileDragProps makes the tile draggable', () => {
    const p = tileDragProps('assets/ab12cd34.jpg');
    expect(p.draggable).toBe(true);
    const d = dt();
    p.onDragStart({
      dataTransfer: d,
      currentTarget: { querySelector: () => ({ naturalWidth: 10, naturalHeight: 20 }) },
    });
    expect(parseAssetDrag(d.data.get(ASSET_DRAG_MIME))).toEqual({
      asset: 'assets/ab12cd34.jpg',
      w: 10,
      h: 20,
    });
  });
});
