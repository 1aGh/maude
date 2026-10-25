// S2.15 — `image.place` / `image.replace` / `image.crop` through the real dispatcher (ed-img): a dropped tile
// fills its frame cropped to fit, ↵ places onto an artboard, Replace… keeps the box, Fill · Fit · Crop · Tile
// write object-fit / object-position (goldens), every write is one request = one undo record.

import { describe, expect, test } from 'bun:test';
import { cropStateOf } from '../edit-ops/crop.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { checkIds, walkIdElements } from '../element-ids.ts';

const FILE = 'ui/Post.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post 1:1" width={1080} height={1080}>
        <div data-cd-id="player" style={{ width: 300, height: 400 }} />
        <div data-cd-id="mvp" style={{ width: 300, height: 400 }}>
          <img data-cd-id="old-photo" src="assets/aaaaaaaa.jpg" alt="" data-photo-edit="1234abcd" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div data-cd-id="locked-frame" data-cd-locked style={{ width: 10, height: 10 }} />
        <div data-cd-id="row" style={{ display: 'flex' }}>
          <img data-cd-id="a" src="assets/11111111.png" alt="" />
          <img data-cd-id="b" src="assets/22222222.png" alt="" />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial = SRC) {
  const files = new Map<string, string>([[FILE, initial]]);
  const log = createWriteLog();
  let writes = 0;
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes += 1;
      files.set(rel, after);
    },
    heldByAi: () => null,
    log,
  };
  const run = (op: string, params: Record<string, unknown>, targets: string[] = []) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard: 'post', element })),
        params,
      },
      deps
    );
  return { files, run, src: () => files.get(FILE) as string, writes: () => writes };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
/** `prop: "value"` or `prop: 'value'` in an element's inline style */
const styled = (el: string, prop: string, value: string): boolean =>
  new RegExp(`${prop}"?: ["'](${value.replace(/[()%.]/g, '\\$&')})["']`).test(el);
/** the `<img …>` / `<div …>` text of one element, by id */
const tagOf = (src: string, id: string): string => {
  const w = walkIdElements(src, FILE);
  if (!w.ok) throw new Error(w.error);
  const e = w.elements.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return src.slice(e.start, e.end);
};

describe('the op table', () => {
  test('the three image ops are registered under their registry ids', () => {
    for (const id of ['image.place', 'image.replace', 'image.crop'])
      expect(EDIT_OPS.some((o) => o.id === id)).toBe(true);
  });
});

describe('image.place — fill', () => {
  test('a tile dropped on an empty frame fills it, cropped to fit (object-fit: cover)', async () => {
    const h = harness();
    const r = good(
      await h.run('image.place', { asset: 'assets/deadbeef.jpg', mode: 'fill' }, ['player'])
    );
    expect(r.created?.length).toBe(1);
    const id = r.created?.[0]?.element as string;
    const img = tagOf(h.src(), id);
    expect(img).toContain('src="assets/deadbeef.jpg"');
    expect(img).toContain('alt=""');
    expect(img).toContain('display: "block"');
    expect(img).toContain('width: "100%"');
    expect(img).toContain('height: "100%"');
    expect(img).toContain('objectFit: "cover"');
    // inside the frame it was dropped on
    const w = walkIdElements(h.src(), FILE);
    if (!w.ok) throw new Error('parse');
    const frame = w.elements.find((e) => e.id === 'player');
    const kid = w.elements.find((e) => e.id === id);
    expect(kid && frame && kid.start > frame.start && kid.end < frame.end).toBe(true);
    expect(checkIds(h.src()).findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(h.writes()).toBe(1);
  });

  test('a frame that holds one picture gets that picture replaced, its box and fit kept; a per-use edit goes (it was of the old photo)', async () => {
    const h = harness();
    good(await h.run('image.place', { asset: 'assets/cafe0001.png', mode: 'fill' }, ['mvp']));
    const img = tagOf(h.src(), 'old-photo');
    expect(img).toContain('src="assets/cafe0001.png"');
    expect(img).toContain("objectFit: 'cover'");
    expect(img).not.toContain('data-photo-edit');
    expect(h.src().match(/<img/g)?.length).toBe(3); // nothing new was added
  });

  test('dropping on a picture replaces its source', async () => {
    const h = harness();
    good(await h.run('image.place', { asset: 'assets/cafe0002.png', mode: 'fill' }, ['a']));
    expect(tagOf(h.src(), 'a')).toContain('src="assets/cafe0002.png"');
    expect(tagOf(h.src(), 'b')).toContain('src="assets/22222222.png"');
  });

  test('the artboard as the target fills it from behind: absolute, inset 0, first child', async () => {
    const h = harness();
    const r = good(
      await h.run('image.place', { asset: 'assets/deadbeef.jpg', mode: 'fill', artboard: 'post' })
    );
    const id = r.created?.[0]?.element as string;
    const img = tagOf(h.src(), id);
    expect(img).toContain('position: "absolute"');
    expect(img).toContain('objectFit: "cover"');
    const at = h.src().indexOf(img);
    expect(at).toBeLessThan(h.src().indexOf('data-cd-id="player"'));
  });
});

describe('image.place — loose, in order, grid', () => {
  test('loose: natural width capped at the container, in the flow, last child', async () => {
    const h = harness();
    const r = good(
      await h.run('image.place', {
        asset: 'assets/deadbeef.jpg',
        mode: 'loose',
        artboard: 'post',
        natural: { w: 4032, h: 3024 },
      })
    );
    const img = tagOf(h.src(), r.created?.[0]?.element as string);
    expect(img).toContain('maxWidth: "100%"');
    expect(img).toContain('height: "auto"');
    expect(img).toContain('width: "4032px"');
    expect(h.src().indexOf(img)).toBeGreaterThan(h.src().indexOf('data-cd-id="row"'));
  });

  test('P8 c8 loose + at: a picture pasted onto an artboard sits ON its page at the point, absolute (14 ed-edge-paste)', async () => {
    const SRC1 = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post 1:1" width={1080} height={1080}>
        <div data-cd-id="page" style={{ position: 'relative', width: 1080, height: 1080 }}>
          <div data-cd-id="hero" style={{ height: 300 }} />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
    const h = harness(SRC1);
    const r = good(
      await h.run('image.place', {
        asset: 'assets/deadbeef.jpg',
        mode: 'loose',
        artboard: 'post',
        natural: { w: 720, h: 400 },
        at: { x: 120.4, y: 90 },
      })
    );
    const img = tagOf(h.src(), r.created?.[0]?.element as string);
    expect(img).toContain('position: "absolute"');
    expect(img).toContain('left: "120px"');
    expect(img).toContain('top: "90px"');
    expect(img).toContain('width: "720px"');
    // inside the page (the artboard's one child), after the hero — not a new section below it
    const src = h.src();
    expect(src.indexOf(img)).toBeGreaterThan(src.indexOf('data-cd-id="hero"'));
    expect(src.indexOf(img)).toBeLessThan(src.indexOf('</div>\n      </DCArtboard>'));
  });

  test('an `at` that is not a point is refused; without `at` nothing changes', async () => {
    const h = harness();
    const r = await h.run('image.place', {
      asset: 'assets/deadbeef.jpg',
      mode: 'loose',
      artboard: 'post',
      at: { x: 'left', y: 4 },
    });
    expect(r.ok).toBe(false);
    expect(h.writes()).toBe(0);
  });

  test('fill-in-order: the n-th picture of the frame takes the n-th asset; extras are placed after', async () => {
    const h = harness();
    const r = good(
      await h.run(
        'image.place',
        {
          assets: ['assets/c0000001.png', 'assets/c0000002.png', 'assets/c0000003.png'],
          mode: 'fill-in-order',
        },
        ['row']
      )
    );
    expect(tagOf(h.src(), 'a')).toContain('src="assets/c0000001.png"');
    expect(tagOf(h.src(), 'b')).toContain('src="assets/c0000002.png"');
    expect(r.created?.length).toBe(1);
    expect(tagOf(h.src(), r.created?.[0]?.element as string)).toContain(
      'src="assets/c0000003.png"'
    );
  });

  test('grid: one wrapper with a column count, one square cropped picture each', async () => {
    const h = harness();
    const r = good(
      await h.run(
        'image.place',
        {
          assets: [
            'assets/c0000001.png',
            'assets/c0000002.png',
            'assets/c0000003.png',
            'assets/c0000004.png',
            'assets/c0000005.png',
          ],
          mode: 'grid',
        },
        ['player']
      )
    );
    expect(r.created?.length).toBe(6); // wrapper + 5
    const wrapper = tagOf(h.src(), r.created?.[0]?.element as string);
    expect(wrapper).toContain('display: "grid"');
    expect(wrapper).toContain('gridTemplateColumns: "repeat(3, 1fr)"');
    expect(wrapper.match(/<img/g)?.length).toBe(5);
    expect(wrapper).toContain('aspectRatio: "1 / 1"');
  });
});

describe('image.place — refusals', () => {
  test('a path that is not a project asset', async () => {
    for (const asset of [
      '../secret.png',
      'https://evil.example/x.png',
      '/etc/passwd',
      'assets/../x.png',
      'assets/a/b.png',
      '',
      'x.png',
    ]) {
      const h = harness();
      bad(await h.run('image.place', { asset, mode: 'fill' }, ['player']));
      expect(h.writes()).toBe(0);
    }
  });
  test('an unknown mode, no asset, too many assets, a bad natural size', async () => {
    const h = harness();
    bad(await h.run('image.place', { asset: 'assets/deadbeef.jpg', mode: 'stretch' }, ['player']));
    bad(await h.run('image.place', { mode: 'fill' }, ['player']));
    bad(
      await h.run(
        'image.place',
        {
          assets: Array.from({ length: 51 }, (_, i) => `assets/c${String(i).padStart(7, '0')}.png`),
          mode: 'grid',
        },
        ['player']
      )
    );
    bad(
      await h.run('image.place', {
        asset: 'assets/deadbeef.jpg',
        mode: 'loose',
        natural: { w: -4, h: 2 },
        artboard: 'post',
      })
    );
    expect(h.writes()).toBe(0);
  });
  test('a locked frame is refused by the dispatcher, nothing written', async () => {
    const h = harness();
    expect(
      bad(
        await h.run('image.place', { asset: 'assets/deadbeef.jpg', mode: 'fill' }, ['locked-frame'])
      ).code
    ).toBe('locked');
    expect(h.writes()).toBe(0);
  });
  test('a picture inside a locked frame is not replaced through its frame', async () => {
    const src = SRC.replace(
      '<img data-cd-id="old-photo"',
      '<img data-cd-id="old-photo" data-cd-locked'
    );
    const h = harness(src);
    bad(await h.run('image.place', { asset: 'assets/cafe0001.png', mode: 'fill' }, ['mvp']));
    expect(h.writes()).toBe(0);
  });
});

describe('image.replace', () => {
  test('Replace… swaps the source and keeps the box, the fit and the alt; drops a per-use edit of the old photo', async () => {
    const h = harness();
    good(await h.run('image.replace', { asset: 'assets/cafe0003.webp' }, ['old-photo']));
    const img = tagOf(h.src(), 'old-photo');
    expect(img).toContain('src="assets/cafe0003.webp"');
    expect(img).not.toContain('data-photo-edit');
    expect(img).toContain("width: '100%'");
  });
  test('the same source is not a write', async () => {
    const h = harness();
    const r = good(await h.run('image.replace', { asset: 'assets/11111111.png' }, ['a']));
    expect(r.actionId).toBeNull();
    expect(h.writes()).toBe(0);
  });
  test('only a picture can be replaced; the path is checked', async () => {
    const h = harness();
    bad(await h.run('image.replace', { asset: 'assets/cafe0003.webp' }, ['player']));
    bad(await h.run('image.replace', { asset: '../x.png' }, ['a']));
    expect(h.writes()).toBe(0);
  });
});

describe('image.crop — Fill · Fit · Crop · Tile', () => {
  test('Fit is object-fit: contain, and takes any crop away', async () => {
    const h = harness();
    good(await h.run('image.crop', { fit: 'fit' }, ['old-photo']));
    const img = tagOf(h.src(), 'old-photo');
    expect(styled(img, 'objectFit', 'contain')).toBe(true);
    expect(img).not.toContain('objectPosition');
    expect(cropStateOf(h.src(), FILE, 'old-photo')).toEqual({ fit: 'fit', zoom: 1, x: 50, y: 50 });
  });

  test('Crop writes object-position, and a zoom as scale() about the same point; the frame clips', async () => {
    const h = harness();
    good(await h.run('image.crop', { fit: 'crop', zoom: 1.28, x: 40, y: 30 }, ['old-photo']));
    const img = tagOf(h.src(), 'old-photo');
    expect(styled(img, 'objectFit', 'cover')).toBe(true);
    expect(styled(img, 'objectPosition', '40% 30%')).toBe(true);
    expect(styled(img, 'transform', 'scale(1.28)')).toBe(true);
    expect(styled(img, 'transformOrigin', '40% 30%')).toBe(true);
    expect(img).toContain('data-image-fit="crop"');
    expect(tagOf(h.src(), 'mvp')).toContain('overflow: "hidden"');
    expect(cropStateOf(h.src(), FILE, 'old-photo')).toEqual({
      fit: 'crop',
      zoom: 1.28,
      x: 40,
      y: 30,
    });
  });

  test('a pan without a zoom writes no transform; Fill takes everything back', async () => {
    const h = harness();
    good(await h.run('image.crop', { fit: 'crop', x: 10, y: 90 }, ['old-photo']));
    expect(tagOf(h.src(), 'old-photo')).not.toContain('transform');
    good(await h.run('image.crop', { fit: 'crop', zoom: 2, x: 10, y: 90 }, ['old-photo']));
    good(await h.run('image.crop', { fit: 'fill' }, ['old-photo']));
    const img = tagOf(h.src(), 'old-photo');
    expect(styled(img, 'objectFit', 'cover')).toBe(true);
    expect(img).not.toContain('objectPosition');
    expect(img).not.toContain('transform');
    expect(img).not.toContain('data-image-fit');
  });

  test('zoom and pan alone keep working on a picture that is already cropped', async () => {
    const h = harness();
    good(await h.run('image.crop', { fit: 'crop', zoom: 1.5, x: 20, y: 20 }, ['old-photo']));
    good(await h.run('image.crop', { zoom: 2 }, ['old-photo']));
    expect(cropStateOf(h.src(), FILE, 'old-photo')).toEqual({ fit: 'crop', zoom: 2, x: 20, y: 20 });
  });

  test('Tile turns the picture into a repeating background of the same box, and Fill turns it back', async () => {
    const h = harness();
    good(await h.run('image.crop', { fit: 'tile' }, ['a']));
    const tile = tagOf(h.src(), 'a');
    expect(tile.startsWith('<div')).toBe(true);
    expect(tile).toContain('role="img"');
    expect(tile).toContain('data-image-tile="assets/11111111.png"');
    expect(tile).toContain('data-image-fit="tile"');
    expect(tile).toContain('backgroundImage: "url(\\"assets/11111111.png\\")"');
    expect(styled(tile, 'backgroundRepeat', 'repeat')).toBe(true);
    expect(tile).not.toContain('src=');
    expect(cropStateOf(h.src(), FILE, 'a').fit).toBe('tile');
    expect(checkIds(h.src()).findings.filter((f) => f.severity === 'error')).toEqual([]);
    good(await h.run('image.crop', { fit: 'fill' }, ['a']));
    const back = tagOf(h.src(), 'a');
    expect(back.startsWith('<img')).toBe(true);
    expect(back).toContain('src="assets/11111111.png"');
    expect(styled(back, 'objectFit', 'cover')).toBe(true);
    expect(back).not.toContain('backgroundImage');
    expect(back).not.toContain('data-image-tile');
  });

  test('Replace on a tile re-points the tile', async () => {
    const h = harness();
    good(await h.run('image.crop', { fit: 'tile' }, ['a']));
    good(await h.run('image.replace', { asset: 'assets/cafe0009.png' }, ['a']));
    const tile = tagOf(h.src(), 'a');
    expect(tile).toContain('data-image-tile="assets/cafe0009.png"');
    expect(tile).toContain('cafe0009.png');
    expect(tile).not.toContain('11111111');
  });

  test('Tile refuses a source that could end its CSS url(); nothing is written', async () => {
    const h = harness(SRC.replace('src="assets/11111111.png"', 'src="assets/a&quot;).png"'));
    bad(await h.run('image.crop', { fit: 'tile' }, ['a']));
    expect(h.writes()).toBe(0);
  });

  test('refusals: a non-picture, an unknown fit, a zoom or a point out of range, a computed style', async () => {
    const h = harness();
    bad(await h.run('image.crop', { fit: 'fit' }, ['player']));
    bad(await h.run('image.crop', { fit: 'stretch' }, ['old-photo']));
    bad(await h.run('image.crop', { fit: 'crop', zoom: 0.5 }, ['old-photo']));
    bad(await h.run('image.crop', { fit: 'crop', zoom: 9 }, ['old-photo']));
    bad(await h.run('image.crop', { fit: 'crop', x: 120 }, ['old-photo']));
    bad(await h.run('image.crop', { fit: 'crop', x: Number.NaN }, ['old-photo']));
    expect(h.writes()).toBe(0);
    const computed = harness(
      SRC.replace("style={{ width: '100%', height: '100%', objectFit: 'cover' }}", 'style={fit}')
    );
    bad(await computed.run('image.crop', { fit: 'fit' }, ['old-photo']));
    expect(computed.writes()).toBe(0);
  });

  test('one request is one write', async () => {
    const h = harness();
    good(await h.run('image.crop', { fit: 'crop', zoom: 1.5, x: 20, y: 70 }, ['old-photo']));
    expect(h.writes()).toBe(1);
  });
});
