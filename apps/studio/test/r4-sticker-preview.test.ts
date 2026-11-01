// r4 #16 - a picked sticker shows its real picture at once (ghost + placed sticker), not an empty box.

import { describe, expect, test } from 'bun:test';
import { placementOf } from '../annotations/ui/sticker-drop.ts';
import {
  isImageDataUrl,
  rememberStickerPreview,
  resolveStickerHref,
} from '../annotations/ui/sticker-preview.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { preloadStickers } from '../client/v2/annotations/sticker-preload.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('r4 #16 a sticker shows its picture at once', () => {
  test('the pick carries a preview picture the ghost and the placed sticker draw from', () => {
    const p = placementOf({
      dgn: 'insert-sticker',
      path: 'assets/a.png',
      follow: true,
      preview: PNG,
      sticker: { pack: 'life-style', id: 'a' },
    });
    expect(p).toMatchObject({ kind: 'sticker', path: 'assets/a.png', preview: PNG });
  });
  test('only a small image data URL counts as a preview', () => {
    expect(isImageDataUrl(PNG)).toBe(true);
    expect(isImageDataUrl('data:text/html;base64,PGI+')).toBe(false);
    expect(isImageDataUrl('javascript:alert(1)')).toBe(false);
    expect(isImageDataUrl('https://x.test/a.png')).toBe(false);
    expect(
      placementOf({ dgn: 'insert-sticker', path: 'assets/a.png', preview: 'data:text/html,x' })
    ).not.toHaveProperty('preview');
  });
  test('the remembered preview stands in for the asset until it is loaded', () => {
    expect(resolveStickerHref('assets/b.png')).toBeNull();
    rememberStickerPreview('assets/b.png', PNG);
    expect(resolveStickerHref('assets/b.png')).toBe(PNG);
  });
  test('the protocol lets the preview through, and nothing but an image', () => {
    const spec = (DGN_TABLE.s2c as any)['insert-sticker'];
    const ok = spec.parse({ dgn: 'insert-sticker', path: 'assets/a.png', preview: PNG });
    expect(ok).not.toBeNull();
    expect(ok.preview).toBe(PNG);
    expect(
      spec.parse({ dgn: 'insert-sticker', path: 'assets/a.png', preview: 'data:text/html,x' })
    ).toBeNull();
  });
  test('the gallery decodes every sticker picture when it opens', async () => {
    const made: Array<{ src: string; decoded: boolean }> = [];
    class FakeImage {
      src = '';
      decoding = '';
      constructor() {
        made.push(this as never);
      }
      decode() {
        (this as never as { decoded: boolean }).decoded = true;
        return Promise.resolve();
      }
    }
    const stickers = [{ url: '/_stickers/a/1.png' }, { url: '/_stickers/a/2.png' }];
    await preloadStickers(stickers, { ImageCtor: FakeImage as never });
    expect(made.map((m) => m.src)).toEqual(['/_stickers/a/1.png', '/_stickers/a/2.png']);
    expect(made.every((m) => m.decoded)).toBe(true);
  });
});
