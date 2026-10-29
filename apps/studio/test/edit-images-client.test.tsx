// S2.15 — the canvas half of images: a tile dropped on a frame (where it lands, the ask, ONE write = one undo record),
// crop mode's entry rules and its op, the Figma clipboard payload and the bar under a paste. The writers' goldens are
// test/edit-ops-image.test.ts; the arithmetic is test/edit-crop-geometry.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import type { EditOpResult } from '../edit-ops/types.ts';
import {
  ASSET_DRAG_MIME,
  assetDragData,
  dragHasAsset,
  isAssetPath,
  parseAssetDrag,
} from '../editing/asset-drag.ts';
import {
  CROP_ACTION,
  elementOfRef,
  isCroppable,
  LOCKED_LINE,
  measureBox,
  runCrop,
  SELECT_PICTURE_LINE,
} from '../editing/crop-mode.tsx';
import type { EditOpAsk } from '../editing/edit-op.ts';
import {
  AS_PICTURE_VERB,
  COPY_AS_PNG_LINE,
  NO_PICTURE_LINE,
  parseFigmaPaste,
  pastedLine,
} from '../editing/figma-paste.ts';
import {
  askForDrop,
  type DropTarget,
  dropTargetAt,
  PLACE_ACTION,
  runDrop,
} from '../editing/image-drop.tsx';
import {
  askForPaste,
  imageFromClipboard,
  MAKE_EDITABLE_READY,
  pasteTarget,
  placedBarFollows,
  placedBarMemory,
} from '../editing/paste-bar.tsx';

const ok = (over: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
  ok: true,
  actionId: null,
  writeId: 'w_0123456789abcdef',
  rev: 'r',
  refs: [],
  ...over,
});

describe('an Assets tile’s drag payload', () => {
  test('a path and, when the tile knew it, the natural size — nothing else survives', () => {
    const raw = assetDragData({ asset: 'assets/ab12cd34.jpg', w: 4032.4, h: 3024 });
    expect(JSON.parse(raw)).toEqual({ asset: 'assets/ab12cd34.jpg', w: 4032, h: 3024 });
    expect(parseAssetDrag(raw)).toEqual({ asset: 'assets/ab12cd34.jpg', w: 4032, h: 3024 });
    expect(parseAssetDrag('{"asset":"assets/a.png","evil":"<script>"}')).toEqual({
      asset: 'assets/a.png',
    });
  });

  test('a forged payload is nothing: not a project asset, not JSON, a size that is not a size', () => {
    for (const asset of [
      '../x.png',
      '/etc/passwd',
      'https://evil.example/a.png',
      'assets/a/b.png',
      'a.png',
      7,
    ]) {
      expect(parseAssetDrag(JSON.stringify({ asset }))).toBeNull();
    }
    expect(parseAssetDrag('not json')).toBeNull();
    expect(parseAssetDrag('[]')).toBeNull();
    expect(parseAssetDrag(null)).toBeNull();
    expect(parseAssetDrag('{"asset":"assets/a.png","w":-1,"h":5}')).toEqual({
      asset: 'assets/a.png',
    });
    expect(isAssetPath('assets/ab12cd34.jpg')).toBe(true);
    expect(isAssetPath('assets/../a.jpg')).toBe(false);
  });

  test('dragover can tell a tile from a file by the type list alone', () => {
    expect(dragHasAsset([ASSET_DRAG_MIME, 'text/plain'])).toBe(true);
    expect(dragHasAsset(['Files'])).toBe(false);
    expect(dragHasAsset(null)).toBe(false);
  });
});

describe('where a drop lands, and the ask it makes', () => {
  const artboard = (ids: { frame?: boolean; img?: boolean } = {}) => {
    const art = document.createElement('article');
    art.setAttribute('data-dc-screen', 'post');
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    art.appendChild(body);
    let frame: HTMLElement | undefined;
    let img: HTMLElement | undefined;
    if (ids.frame) {
      frame = document.createElement('div');
      frame.setAttribute('data-cd-id', 'player');
      body.appendChild(frame);
    }
    if (ids.img) {
      img = document.createElement('img');
      img.setAttribute('data-cd-id', 'old-photo');
      (frame ?? body).appendChild(img);
    }
    document.body.appendChild(art);
    return { art, body, frame, img };
  };
  const docOver = (...stack: Element[]) =>
    ({ elementsFromPoint: () => stack }) as unknown as Document;

  test('a frame: the picture fills it', () => {
    const { art, body, frame } = artboard({ frame: true });
    const t = dropTargetAt(docOver(frame as Element, body, art), 5, 5);
    expect(t).toMatchObject({
      kind: 'frame',
      artboard: 'post',
      ref: { artboard: 'post', element: 'player' },
    });
    expect(askForDrop({ asset: 'assets/deadbeef.jpg' }, t as DropTarget)).toEqual({
      op: 'image.place',
      targets: [{ artboard: 'post', element: 'player' }],
      params: { asset: 'assets/deadbeef.jpg', mode: 'fill' },
    });
  });

  test('a picture under the pointer: its source is swapped (fill on the picture itself)', () => {
    const { art, body, frame, img } = artboard({ frame: true, img: true });
    const t = dropTargetAt(docOver(img as Element, frame as Element, body, art), 5, 5);
    expect(t).toMatchObject({ kind: 'picture', ref: { element: 'old-photo' } });
    expect(askForDrop({ asset: 'assets/cafe0001.png' }, t as DropTarget).params).toEqual({
      asset: 'assets/cafe0001.png',
      mode: 'fill',
    });
  });

  test('bare artboard: placed loose, at its natural size, in that artboard; off every artboard: nothing', () => {
    const { art, body } = artboard();
    const t = dropTargetAt(docOver(body, art), 5, 5);
    expect(t).toMatchObject({ kind: 'artboard', ref: null, artboard: 'post' });
    expect(askForDrop({ asset: 'assets/deadbeef.jpg', w: 4032, h: 3024 }, t as DropTarget)).toEqual(
      {
        op: 'image.place',
        targets: [],
        params: {
          asset: 'assets/deadbeef.jpg',
          mode: 'loose',
          artboard: 'post',
          natural: { w: 4032, h: 3024 },
        },
      }
    );
    expect(dropTargetAt(docOver(document.body), 5, 5)).toBeNull();
    art.remove();
  });
});

describe('runDrop — ONE drop is one ask (no canvas record: ⌘Z is the shell history), the new picture selected', () => {
  const ask: EditOpAsk = {
    op: PLACE_ACTION,
    targets: [],
    params: { asset: 'assets/a.png', mode: 'loose', artboard: 'post' },
  };

  test('applied: one ask, no canvas record, the created picture selected', async () => {
    const recs: unknown[] = [];
    let selected: unknown = null;
    const r = await runDrop(ask, {
      run: async () => ok({ created: [{ artboard: 'post', element: 'img' }] }),
      record: (rec) => recs.push(rec),
      select: (refs) => {
        selected = refs;
      },
    });
    expect(r.ok).toBe(true);
    // p8-v1-drop: no canvas undo record — the write is a kernel action and ⌘Z is the shell history
    expect(recs).toEqual([]);
    expect(selected).toEqual([{ artboard: 'post', element: 'img' }]);
  });

  test('on the op log the kernel action is the undo: no second record', async () => {
    const recs: unknown[] = [];
    await runDrop(ask, {
      run: async () => ok({ actionId: 'a_1' }),
      record: (rec) => recs.push(rec),
    });
    expect(recs).toEqual([]);
  });

  test('refused: one line, no record, nothing selected', async () => {
    const lines: string[] = [];
    const recs: unknown[] = [];
    const r = await runDrop(ask, {
      run: async () => ({ ok: false, code: 'locked', message: 'That frame is locked.' }),
      toast: (m) => lines.push(m),
      record: (rec) => recs.push(rec),
    });
    expect(r.ok).toBe(false);
    expect(lines).toEqual(['That frame is locked.']);
    expect(recs).toEqual([]);
  });
});

describe('crop mode', () => {
  test('only an <img> with an authored id can be cropped (a frame, a tile, a bare img cannot)', () => {
    const img = document.createElement('img');
    expect(isCroppable(img)).toBe(false);
    img.setAttribute('data-cd-id', 'photo');
    expect(isCroppable(img)).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('data-cd-id', 'photo');
    expect(isCroppable(div)).toBe(false);
    expect(isCroppable(null)).toBe(false);
  });

  test('its lines say what to do', () => {
    expect(SELECT_PICTURE_LINE).toBe('Select a picture to crop.');
    expect(LOCKED_LINE).toContain('locked');
  });

  test('a ref finds its node, the n-th of a repeated id', () => {
    const art = document.createElement('article');
    art.setAttribute('data-dc-screen', 'post');
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('img');
      el.setAttribute('data-cd-id', 'card');
      el.setAttribute('data-n', String(i));
      art.appendChild(el);
    }
    document.body.appendChild(art);
    expect(
      elementOfRef({ artboard: 'post', element: 'card', occurrence: 1 })?.getAttribute('data-n')
    ).toBe('1');
    expect(elementOfRef({ artboard: 'post', element: 'card' })?.getAttribute('data-n')).toBe('0');
    expect(elementOfRef({ artboard: 'post', element: 'nope' })).toBeNull();
    art.remove();
  });

  test('the box is measured with the picture’s own zoom taken off, and put back', () => {
    const el = document.createElement('img');
    el.style.transform = 'scale(2)';
    let seen = '';
    el.getBoundingClientRect = () => {
      seen = el.style.transform;
      return {
        left: 10,
        top: 20,
        width: 100,
        height: 50,
        right: 110,
        bottom: 70,
        x: 10,
        y: 20,
        toJSON() {},
      } as DOMRect;
    };
    expect(measureBox(el)).toEqual({ left: 10, top: 20, w: 100, h: 50 });
    expect(seen).toBe('none');
    expect(el.style.transform).toBe('scale(2)');
  });

  test('↵ is ONE image.crop with the crop (no canvas record); a refusal says why and records nothing', async () => {
    const asked: EditOpAsk[] = [];
    const recs: unknown[] = [];
    const lines: string[] = [];
    const ref = { artboard: 'post', element: 'photo' };
    const r = await runCrop(
      [ref],
      { fit: 'crop', zoom: 1.28, x: 40, y: 30 },
      {
        run: async (a) => {
          asked.push(a);
          return ok();
        },
        record: (rec) => recs.push(rec),
      }
    );
    expect(r.ok).toBe(true);
    expect(asked).toEqual([
      { op: CROP_ACTION, targets: [ref], params: { fit: 'crop', zoom: 1.28, x: 40, y: 30 } },
    ]);
    // p8-v1-drop: no canvas undo record — the write is a kernel action and ⌘Z is the shell history
    expect(recs).toEqual([]);
    const refused = await runCrop(
      [ref],
      { fit: 'fit' },
      {
        run: async () => ({
          ok: false,
          code: 'locked',
          message: 'That picture is locked; unlock it first.',
        }),
        toast: (m) => lines.push(m),
        record: (rec) => recs.push(rec),
      }
    );
    expect(refused.ok).toBe(false);
    expect(lines).toEqual(['That picture is locked; unlock it first.']);
    expect(recs.length).toBe(1);
  });
});

/** Figma's clipboard: the metadata comment is base64 JSON, followed by the scene span. */
const figmaHtml = (meta: Record<string, unknown>) =>
  `<meta charset='utf-8'><span data-metadata="<!--(figmeta)${btoa(JSON.stringify(meta))}(/figmeta)-->"></span><span data-buffer="<!--(figma)ZmlnLWthd2k=(/figma)-->"></span><span style="white-space:pre-wrap;"></span>`;

describe('the Figma clipboard', () => {
  test('a frame copy is recognised and its file and paste id read', () => {
    expect(
      parseFigmaPaste(figmaHtml({ fileKey: 'AbC123xyz', pasteID: 4242, dataType: 'scene' }))
    ).toEqual({
      fileKey: 'AbC123xyz',
      pasteID: 4242,
      dataType: 'scene',
      name: null,
    });
  });

  test('a name, when Figma says one, rides along (clamped); anything else says none', () => {
    expect(parseFigmaPaste(figmaHtml({ fileKey: 'k', name: 'Hero / v3' }))?.name).toBe('Hero / v3');
    expect(parseFigmaPaste(figmaHtml({ fileKey: 'k', name: 'x'.repeat(500) }))?.name).toBeNull();
    expect(parseFigmaPaste(figmaHtml({ fileKey: 'k', name: 5 }))?.name).toBeNull();
  });

  test('plain HTML, a lone marker, a broken payload, a huge payload and nothing are not Figma', () => {
    expect(parseFigmaPaste('<p>hello <b>world</b> and some more words here</p>')).toBeNull();
    expect(
      parseFigmaPaste('<!--(figmeta)e30=(/figmeta)--> but no scene span at all, only words')
    ).toBeNull();
    expect(parseFigmaPaste(`<!--(figmeta)!!!!(/figmeta)--><!--(figma)AA(/figma)-->`)).toBeNull();
    expect(
      parseFigmaPaste(`<!--(figmeta)${btoa('[1,2]')}(/figmeta)--><!--(figma)AA(/figma)-->`)
    ).toBeNull();
    expect(parseFigmaPaste(`${'x'.repeat(30_000)}${figmaHtml({ fileKey: 'k' })}`)).toBeNull();
    expect(parseFigmaPaste('')).toBeNull();
    expect(parseFigmaPaste(null)).toBeNull();
  });
});

describe('the paste bar', () => {
  test('its words: what happened, no claim about text or layers', () => {
    expect(pastedLine('Hero / v3')).toBe('Pasted from Figma as an image of “Hero / v3”.');
    expect(pastedLine(null)).toBe('Pasted from Figma as an image.');
    for (const line of [pastedLine('x'), NO_PICTURE_LINE, COPY_AS_PNG_LINE]) {
      expect(line).not.toMatch(/\b(we|I)\b|editable text|stays editable|oops|!/i);
    }
    expect(AS_PICTURE_VERB).toBe('Paste as picture');
  });

  test('G5: the line waits for the picture to be selected — the paste target is still selected when the bar opens', () => {
    const mine = JSON.stringify([{ artboard: 'desktop', element: 'image' }]);
    const target = JSON.stringify([{ artboard: 'desktop', element: 'hero' }]);
    // the bar opens before the canvas re-renders: the old selection must not close it
    let s = placedBarFollows(mine, target, false);
    expect(s).toEqual({ stays: true, seen: false });
    // the picture is selected (selectWhenRendered): now the bar is bound to it
    s = placedBarFollows(mine, mine, s.seen);
    expect(s).toEqual({ stays: true, seen: true });
    // something else selected afterwards closes it; clearing the selection does not
    expect(placedBarFollows(mine, target, true).stays).toBe(false);
    expect(placedBarFollows(mine, '[]', true).stays).toBe(true);
  });

  test('G5: the line survives the canvas reload the placing write causes (the bar is rebuilt from the document’s memory)', () => {
    const win = {} as unknown as Window;
    const line = { line: pastedLine('Hero / v3'), ref: { artboard: 'desktop', element: 'img' } };
    expect(placedBarMemory(win).recall()).toBeNull();
    placedBarMemory(win).remember(line);
    // a soft swap remounts the bar: a second reader of the same document sees what the first remembered
    expect(placedBarMemory(win).recall()).toEqual(line);
    placedBarMemory(win).remember(null);
    expect(placedBarMemory(win).recall()).toBeNull();
  });

  test('Make editable is not offered until Figma import (S8.17) lands', () => {
    expect(MAKE_EDITABLE_READY).toBe(false);
  });

  test('the ask: loose in the artboard (or the frame), from Figma, with the picture’s natural size', () => {
    expect(
      askForPaste(
        'assets/ab12cd34.png',
        { fileKey: 'k', pasteID: 1, dataType: 'scene', name: 'Hero / v3' },
        { targets: [], artboard: 'desktop' },
        { w: 1440, h: 800 }
      )
    ).toEqual({
      op: 'image.place',
      targets: [],
      params: {
        asset: 'assets/ab12cd34.png',
        mode: 'loose',
        from: { name: 'Hero / v3' },
        artboard: 'desktop',
        natural: { w: 1440, h: 800 },
      },
    });
    expect(
      askForPaste(
        'assets/ab12cd34.png',
        { fileKey: null, pasteID: null, dataType: null, name: null },
        { targets: [{ artboard: 'a', element: 'hero' }], artboard: 'a' },
        null
      ).params
    ).toEqual({ asset: 'assets/ab12cd34.png', mode: 'loose', from: {}, artboard: 'a' });
  });

  test('P8 c8 (14 ed-edge-paste): onto an artboard the ask carries the paste point; onto a frame it does not', () => {
    const paste = { fileKey: 'k', pasteID: 1, dataType: 'scene', name: 'Hero / v3' };
    expect(
      askForPaste(
        'assets/ab12cd34.png',
        paste,
        { targets: [], artboard: 'desktop' },
        { w: 720, h: 400 },
        { x: 40, y: 90 }
      ).params.at
    ).toEqual({ x: 40, y: 90 });
    expect(
      askForPaste(
        'assets/ab12cd34.png',
        paste,
        { targets: [{ artboard: 'a', element: 'hero' }], artboard: 'a' },
        null,
        { x: 40, y: 90 }
      ).params.at
    ).toBeUndefined();
  });

  test('a picture on the clipboard is found as a file or as an item; text alone is not one', () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });
    expect(imageFromClipboard({ files: [png], items: [] } as unknown as DataTransfer)).toBe(png);
    expect(
      imageFromClipboard({
        files: [],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => png }],
      } as unknown as DataTransfer)
    ).toBe(png);
    expect(
      imageFromClipboard({
        files: [],
        items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }],
      } as unknown as DataTransfer)
    ).toBeNull();
    expect(imageFromClipboard(null)).toBeNull();
  });

  test('where it goes: a selected frame, a selected artboard, a selected picture’s artboard', () => {
    const art = document.createElement('article');
    art.setAttribute('data-dc-screen', 'desktop');
    const img = document.createElement('img');
    img.setAttribute('data-cd-id', 'logo');
    const box = document.createElement('div');
    box.setAttribute('data-cd-id', 'hero');
    art.append(img, box);
    document.body.appendChild(art);
    const sel = (o: Record<string, unknown>) => ({ selector: 's', ...o }) as never;
    expect(pasteTarget([sel({ id: 'hero', artboardId: 'desktop' })])).toEqual({
      targets: [{ artboard: 'desktop', element: 'hero' }],
      artboard: 'desktop',
    });
    expect(pasteTarget([sel({ id: 'logo', artboardId: 'desktop' })])).toEqual({
      targets: [],
      artboard: 'desktop',
    });
    expect(pasteTarget([sel({ artboardId: 'desktop' })])).toEqual({
      targets: [],
      artboard: 'desktop',
    });
    art.remove();
  });
});
