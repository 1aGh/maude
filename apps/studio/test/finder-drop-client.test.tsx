// S8.14 — the canvas half of "drop from Finder onto an artboard" (12 · ia-drop-photos, ia-placed): which files are photos,
// the hint over the artboard (it names what will happen), ONE import-then-place per drop, the photos selected at once, and a
// bare-canvas drop left alone (it stays loose, the media hook's). The server write is test/finder-drop-plan.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { EditOpResult } from '../edit-ops/types.ts';
import { ASSET_DRAG_MIME } from '../editing/asset-drag.ts';
import type { EditOpAsk } from '../editing/edit-op.ts';
import {
  artboardLabelOf,
  FinderDrop,
  finderTargetAt,
  importAll,
  landingOf,
  runFinderDrop,
} from '../editing/finder-drop.tsx';
import {
  askForFinderDrop,
  dragPhotoCount,
  emptyFramesIn,
  isFinderDrag,
  isPhoto,
  MAX_PHOTOS,
  photosOf,
  placedLine,
  selectionRefs,
} from '../editing/finder-drop-model.ts';
import type { DropTarget } from '../editing/image-drop.tsx';
import { SelectionSetProvider } from '../use-selection-set.tsx';

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

const file = (name: string, type: string) => new File(['x'], name, { type });
const ok = (over: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
  ok: true,
  actionId: null,
  writeId: 'w_0123456789abcdef',
  rev: 'r',
  refs: [],
  ...over,
});

/** "Fotky ze zápasu": an artboard holding `empty` empty picture frames and `full` pictures that already show something. */
function board(empty: number, full = 0) {
  const art = document.createElement('article');
  art.setAttribute('data-dc-screen', 'match');
  art.innerHTML = '<header class="dc-artboard-label">Fotky ze zápasu</header>';
  const body = document.createElement('div');
  body.className = 'dc-artboard-body';
  const grid = document.createElement('div');
  grid.setAttribute('data-cd-id', 'grid');
  body.appendChild(grid);
  for (let i = 0; i < empty; i++) {
    const img = document.createElement('img');
    img.setAttribute('data-cd-id', `cell-${i + 1}`);
    grid.appendChild(img);
  }
  for (let i = 0; i < full; i++) {
    const img = document.createElement('img');
    img.setAttribute('data-cd-id', `done-${i + 1}`);
    img.setAttribute('src', 'assets/aaaaaaaa.jpg');
    grid.appendChild(img);
  }
  art.appendChild(body);
  document.body.appendChild(art);
  return { art, body, grid };
}
const docOver = (...stack: Element[]) =>
  ({ elementsFromPoint: () => stack }) as unknown as Document;

describe('which files are photos, and how many a drag carries', () => {
  test('the type says so; an untyped file is judged by its extension; a video is not a photo', () => {
    expect(isPhoto(file('IMG_2231.jpg', 'image/jpeg'))).toBe(true);
    expect(isPhoto(file('IMG_2231.HEIC', ''))).toBe(true);
    expect(isPhoto(file('clip.mov', 'video/quicktime'))).toBe(false);
    expect(isPhoto(file('notes.txt', ''))).toBe(false);
  });

  test('a drop places at most 50, in the order Finder handed them over', () => {
    const files = Array.from({ length: 53 }, (_, i) => file(`p${i}.jpg`, 'image/jpeg'));
    const { photos, over } = photosOf([file('a.mov', 'video/mp4'), ...files]);
    expect(photos.length).toBe(MAX_PHOTOS);
    expect(over).toBe(3);
    expect(photos[0]?.name).toBe('p0.jpg');
  });

  test('dragover reads the type list only: files yes, an Assets tile no; the count comes from the items', () => {
    expect(isFinderDrag(['Files'])).toBe(true);
    expect(isFinderDrag(['Files', 'text/uri-list'])).toBe(true);
    expect(isFinderDrag([ASSET_DRAG_MIME, 'text/plain'])).toBe(false);
    expect(isFinderDrag(['Files', ASSET_DRAG_MIME])).toBe(false);
    expect(isFinderDrag(['text/plain'])).toBe(false);
    expect(isFinderDrag(null)).toBe(false);
    const six = Array.from({ length: 6 }, () => ({ kind: 'file', type: 'image/jpeg' }));
    expect(dragPhotoCount([...six, { kind: 'file', type: 'video/mp4' }])).toBe(6);
    expect(dragPhotoCount([{ kind: 'file', type: '' }])).toBe(1);
    expect(dragPhotoCount([{ kind: 'string', type: 'text/uri-list' }])).toBe(0);
    expect(dragPhotoCount(null)).toBe(0);
  });
});

describe('the frame under the pointer', () => {
  test('empty pictures are counted; a picture that shows something, or is locked, is not', () => {
    const { body } = board(3, 2);
    body.querySelector('[data-cd-id="cell-1"]')?.setAttribute('data-cd-locked', '');
    expect(emptyFramesIn(body)).toBe(2);
  });

  test('landing on a bare artboard with six empty frames: fill in order; with none: the plan falls to a grid', () => {
    const { art, body } = board(6);
    const t = finderTargetAt(docOver(body, art), 5, 5, 6) as DropTarget;
    expect(t).toMatchObject({ kind: 'artboard', ref: null, artboard: 'match' });
    expect(landingOf(t)).toEqual({ kind: 'artboard', empty: 6 });
    expect(artboardLabelOf(t.el)).toBe('Fotky ze zápasu');
  });

  test('several photos over a picture go to what holds it; one photo replaces the picture', () => {
    const { art, body, grid } = board(0, 1);
    const pic = body.querySelector('img') as Element;
    const one = finderTargetAt(docOver(pic, grid, body, art), 5, 5, 1) as DropTarget;
    expect(one).toMatchObject({ kind: 'picture', ref: { element: 'done-1' } });
    expect(landingOf(one)).toEqual({ kind: 'picture', empty: 0 });
    const many = finderTargetAt(docOver(pic, grid, body, art), 5, 5, 4) as DropTarget;
    expect(many).toMatchObject({ kind: 'frame', ref: { element: 'grid' } });
  });

  test('an empty picture under the pointer is an empty frame to fill', () => {
    const { art, body, grid } = board(2);
    const pic = body.querySelector('img') as Element;
    const t = finderTargetAt(docOver(pic, grid, body, art), 5, 5, 1) as DropTarget;
    expect(landingOf(t)).toEqual({ kind: 'frame', empty: 1 });
  });

  test('off every artboard there is no target: a bare-canvas drop stays loose', () => {
    expect(finderTargetAt(docOver(document.body), 5, 5, 3)).toBeNull();
  });
});

describe('the ask', () => {
  test('auto mode: the studio picks; a bare artboard is named by `artboard`, a frame by its ref', () => {
    expect(
      askForFinderDrop(['assets/a.jpg', 'assets/b.jpg'], { ref: null, artboard: 'match' }, null)
    ).toEqual({
      op: 'image.place',
      targets: [],
      params: { assets: ['assets/a.jpg', 'assets/b.jpg'], mode: 'auto', artboard: 'match' },
    });
    expect(
      askForFinderDrop(
        ['assets/a.jpg'],
        { ref: { artboard: 'match', element: 'grid' }, artboard: 'match' },
        { w: 4032, h: 3024 }
      )
    ).toEqual({
      op: 'image.place',
      targets: [{ artboard: 'match', element: 'grid' }],
      params: { assets: ['assets/a.jpg'], mode: 'auto', natural: { w: 4032, h: 3024 } },
    });
  });

  test('a grid is selected as its wrapper; anything else as the pictures made', () => {
    const made = [
      { artboard: 'match', element: 'grid-2' },
      { artboard: 'match', element: 'img-1' },
    ];
    expect(selectionRefs({ kind: 'artboard', empty: 0 }, 4, made)).toEqual([made[0]]);
    expect(selectionRefs({ kind: 'artboard', empty: 4 }, 4, made)).toEqual(made);
    expect(selectionRefs({ kind: 'artboard', empty: 0 }, 1, made)).toEqual(made);
  });

  test('the line after the write', () => {
    expect(placedLine(6, 'Fotky ze zápasu')).toBe(
      "Placed 6 photos in Fotky ze zápasu. They're in Assets too."
    );
    expect(placedLine(1, '')).toBe("Placed the photo. It's in Assets too.");
  });
});

describe('importAll', () => {
  test('answers come back in the order the files came, even when the imports finish out of order', async () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => file(`${n}.jpg`, 'image/jpeg'));
    const delay = [40, 5, 25, 1, 10];
    const out = await importAll(files, async (f) => {
      const i = files.indexOf(f);
      await new Promise((r) => setTimeout(r, delay[i]));
      return { path: `assets/${f.name}` };
    });
    expect(out).toEqual(files.map((f) => ({ path: `assets/${f.name}` })));
  });

  test('a throw is that one file’s error, not the drop’s', async () => {
    const files = [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')];
    const out = await importAll(files, async (f) => {
      if (f.name === 'a.jpg') throw new Error('network down');
      return { path: 'assets/b.jpg' };
    });
    expect(out).toEqual([{ error: 'network down' }, { path: 'assets/b.jpg' }]);
  });
});

describe('runFinderDrop — six photos are six imports, ONE place, ONE undo record, all selected', () => {
  const target = {
    kind: 'artboard',
    el: undefined as unknown as HTMLElement,
    ref: null,
    artboard: 'match',
  } as DropTarget;
  const six = () => Array.from({ length: 6 }, (_, i) => file(`IMG_${i}.jpg`, 'image/jpeg'));
  const landing = { kind: 'artboard' as const, empty: 6 };

  test('applied', async () => {
    const asks: EditOpAsk[] = [];
    const records: unknown[] = [];
    const selected: unknown[] = [];
    const toasts: string[] = [];
    const created = Array.from({ length: 6 }, (_, i) => ({
      artboard: 'match',
      element: `cell-${i + 1}`,
    }));
    const r = await runFinderDrop(six(), target, landing, 'Fotky ze zápasu', {
      upload: async (f) => ({ path: `assets/${f.name.replace('IMG_', 'e000000')}` }),
      natural: async () => null,
      run: async (a) => {
        asks.push(a);
        return ok({ created });
      },
      toast: (m) => toasts.push(m),
      record: (rec) => records.push(rec),
      select: (refs) => selected.push(refs),
    });
    expect(r?.ok).toBe(true);
    expect(asks.length).toBe(1);
    expect(asks[0]?.params).toMatchObject({ mode: 'auto', artboard: 'match' });
    const placed = (asks[0]?.params?.assets ?? []) as string[];
    expect(placed.length).toBe(6);
    expect(placed[0]).toBe('assets/e0000000.jpg');
    expect(records.length).toBe(1);
    expect(selected).toEqual([created]);
    expect(toasts).toEqual(["Placed 6 photos in Fotky ze zápasu. They're in Assets too."]);
  });

  test('two of six fail to import: the four are still placed, and one line names the miss', async () => {
    const asks: EditOpAsk[] = [];
    const toasts: Array<[string, string | undefined]> = [];
    await runFinderDrop(six(), target, landing, '', {
      upload: async (f) =>
        f.name === 'IMG_1.jpg' || f.name === 'IMG_4.jpg'
          ? { error: 'That file is too big.' }
          : { path: `assets/${f.name}` },
      natural: async () => null,
      run: async (a) => {
        asks.push(a);
        return ok({ created: [{ artboard: 'match', element: 'x' }] });
      },
      toast: (m, k) => toasts.push([m, k]),
    });
    expect(((asks[0]?.params?.assets ?? []) as string[]).length).toBe(4);
    expect(toasts[0]).toEqual(['Couldn’t add 2 of 6 photos. That file is too big.', 'error']);
  });

  test('none imported: nothing is placed', async () => {
    let ran = false;
    const toasts: string[] = [];
    const r = await runFinderDrop([file('a.jpg', 'image/jpeg')], target, landing, '', {
      upload: async () => ({ error: 'Not a picture.' }),
      run: async () => {
        ran = true;
        return ok();
      },
      toast: (m) => toasts.push(m),
    });
    expect(r).toBeNull();
    expect(ran).toBe(false);
    expect(toasts).toEqual(['Couldn’t add the photo. Not a picture.']);
  });

  test('refused by the studio: the line is said, no undo record, nothing selected', async () => {
    const records: unknown[] = [];
    const selected: unknown[] = [];
    const toasts: string[] = [];
    await runFinderDrop([file('a.jpg', 'image/jpeg')], target, landing, '', {
      upload: async () => ({ path: 'assets/a.jpg' }),
      natural: async () => null,
      run: async () => ({
        ok: false,
        code: 'locked',
        message: 'Not placed. That is locked; unlock it first.',
      }),
      toast: (m) => toasts.push(m),
      record: (rec) => records.push(rec),
      select: (refs) => selected.push(refs),
    });
    expect(toasts).toEqual(['Not placed. That is locked; unlock it first.']);
    expect(records).toEqual([]);
    expect(selected).toEqual([]);
  });
});

describe('the hint, live', () => {
  const mount = async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <SelectionSetProvider postTarget={null}>
          <FinderDrop />
        </SelectionSetProvider>
      );
    });
  };
  const drag = (type: string, types: string[], items: Array<{ kind: string; type: string }>) => {
    const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
      dataTransfer?: unknown;
      clientX?: number;
      clientY?: number;
    };
    e.dataTransfer = { types, items, files: [], dropEffect: 'none' };
    e.clientX = 5;
    e.clientY = 5;
    return e;
  };
  const photos = (n: number) =>
    Array.from({ length: n }, () => ({ kind: 'file', type: 'image/jpeg' }));
  const over = (stack: Element[]) => {
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => stack;
  };

  test('six photos over an artboard with six empty frames: it lights up and says so', async () => {
    const { art, body } = board(6);
    over([body, art]);
    await mount();
    const e = drag('dragover', ['Files'], photos(6));
    await act(async () => {
      document.body.dispatchEvent(e);
    });
    const hint = document.querySelector('[data-testid="edit-drop-hint"]');
    expect(hint?.textContent).toBe('Drop to fill 6 empty frames in order');
    expect(hint?.getAttribute('data-kind')).toBe('artboard');
    expect(e.defaultPrevented).toBe(true);
    await act(async () => {
      document.body.dispatchEvent(drag('dragleave', ['Files'], []));
    });
    expect(document.querySelector('[data-testid="edit-drop-hint"]')).toBeNull();
  });

  test('with no empty frame several photos say a tidy grid', async () => {
    const { art, body } = board(0, 2);
    over([body, art]);
    await mount();
    await act(async () => {
      document.body.dispatchEvent(drag('dragover', ['Files'], photos(6)));
    });
    expect(document.querySelector('[data-testid="edit-drop-hint"]')?.textContent).toBe(
      'Drop to place 6 photos in a tidy grid'
    );
  });

  test('bare canvas, a video, or an Assets tile: no hint, and the event is left for the others', async () => {
    const { art, body } = board(6);
    await mount();
    over([document.body]);
    const bare = drag('dragover', ['Files'], photos(3));
    await act(async () => {
      document.body.dispatchEvent(bare);
    });
    expect(bare.defaultPrevented).toBe(false);
    over([body, art]);
    const video = drag('dragover', ['Files'], [{ kind: 'file', type: 'video/mp4' }]);
    await act(async () => {
      document.body.dispatchEvent(video);
    });
    const tile = drag('dragover', [ASSET_DRAG_MIME], []);
    await act(async () => {
      document.body.dispatchEvent(tile);
    });
    expect(document.querySelector('[data-testid="edit-drop-hint"]')).toBeNull();
    expect(video.defaultPrevented).toBe(false);
    expect(tile.defaultPrevented).toBe(false);
  });

  test('a locked artboard gets no hint', async () => {
    const { art, body } = board(2);
    body.setAttribute('data-cd-locked', '');
    over([body, art]);
    await mount();
    await act(async () => {
      document.body.dispatchEvent(drag('dragover', ['Files'], photos(2)));
    });
    expect(document.querySelector('[data-testid="edit-drop-hint"]')).toBeNull();
  });
});
