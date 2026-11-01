// r3 · Michal: "nemůžu vkládat videa do canvas". A video picked with Image (I), dropped from Finder or placed from Assets
// goes onto the canvas through the SAME `image.place` write a picture does — as the `<video src="assets/…">` element the
// studio already names as the way a canvas shows a video (asset-details `referenceOf`), sized by its natural aspect.
// Client half: the picker accepts a video, the refusal names what IS accepted. Server half: the op writes the element, the
// asset route (unchanged) takes a real mp4.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sniffAssetType } from '../api.ts';
import {
  createImagePick,
  NOT_A_PICTURE_LINE,
  NOT_ADDED_LINE,
} from '../client/v2/shell/image-pick.js';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { runFinderDrop } from '../editing/finder-drop.tsx';
import { dragVideoCount, placedLine, videosOf } from '../editing/finder-drop-model.ts';
import { walkIdElements } from '../element-ids.ts';
import { fitVideoSize, isVideoFile } from '../video-natural.ts';

const FILE = 'ui/Post.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post 1:1" width={1080} height={1080}>
        <div data-cd-id="frame" style={{ width: 300, height: 400 }} />
        <img data-cd-id="photo" src="assets/aaaaaaaa.jpg" alt="" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness() {
  const files = new Map<string, string>([[FILE, SRC]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => void files.set(rel, after),
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (params: Record<string, unknown>, targets: string[] = []) =>
    dispatchEditOp(
      {
        file: FILE,
        op: 'image.place',
        targets: targets.map((element) => ({ artboard: 'post', element })),
        params,
      },
      deps
    );
  return { run, src: () => files.get(FILE) as string };
}
const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const tagOf = (src: string, id: string): string => {
  const w = walkIdElements(src, FILE);
  if (!w.ok) throw new Error(w.error);
  const e = w.elements.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return src.slice(e.start, e.end);
};

describe('image.place with a video asset writes a <video>, not an <img>', () => {
  test('loose + at: absolute, natural width, its own aspect, playable', async () => {
    const h = harness();
    const r = good(
      await h.run({
        asset: 'assets/deadbeef.mp4',
        mode: 'loose',
        artboard: 'post',
        natural: { w: 640, h: 360 },
        at: { x: 100, y: 50 },
      })
    );
    const el = tagOf(h.src(), r.created?.[0]?.element as string);
    expect(el.startsWith('<video ')).toBe(true);
    expect(el).toContain('src="assets/deadbeef.mp4"');
    expect(el).toContain('controls');
    expect(el).toContain('aspectRatio: "640 / 360"');
    expect(el).toContain('width: "640px"');
    expect(el).toContain('left: "100px"');
    expect(el).not.toContain('<img');
  });

  test('fill on a frame: a video that fills it, cropped to fit', async () => {
    const h = harness();
    const r = good(await h.run({ asset: 'assets/deadbeef.webm', mode: 'fill' }, ['frame']));
    const el = tagOf(h.src(), r.created?.[0]?.element as string);
    expect(el.startsWith('<video ')).toBe(true);
    expect(el).toContain('objectFit: "cover"');
    expect(el).toContain('height: "100%"');
  });

  test('auto (a Finder drop) on an artboard goes in loose; on a frame it fills', async () => {
    const h = harness();
    const a = good(await h.run({ asset: 'assets/deadbeef.mov', mode: 'auto', artboard: 'post' }));
    expect(tagOf(h.src(), a.created?.[0]?.element as string)).toContain(
      'src="assets/deadbeef.mov"'
    );
    const f = good(await h.run({ asset: 'assets/cafebabe.m4v', mode: 'auto' }, ['frame']));
    expect(tagOf(h.src(), f.created?.[0]?.element as string)).toContain('objectFit: "cover"');
  });

  test('refused in words: two videos, a video mixed with pictures, a video onto a picture', async () => {
    const h = harness();
    const two = bad(
      await h.run({
        assets: ['assets/aaaaaaaa.mp4', 'assets/bbbbbbbb.mp4'],
        mode: 'grid',
        artboard: 'post',
      })
    );
    expect(two.message).toMatch(/one video at a time/i);
    bad(
      await h.run({
        assets: ['assets/aaaaaaaa.mp4', 'assets/bbbbbbbb.png'],
        mode: 'loose',
        artboard: 'post',
      })
    );
    const onPic = bad(await h.run({ asset: 'assets/aaaaaaaa.mp4', mode: 'fill' }, ['photo']));
    expect(onPic.message).toMatch(/video/i);
    expect(h.src()).toBe(SRC);
  });

  test('a picture is still an <img> (nothing changed for pictures)', async () => {
    const h = harness();
    const r = good(await h.run({ asset: 'assets/deadbeef.png', mode: 'loose', artboard: 'post' }));
    expect(tagOf(h.src(), r.created?.[0]?.element as string).startsWith('<img ')).toBe(true);
  });
});

describe('the picker: a video is placed, anything else is told what IS accepted', () => {
  const file = (name: string, type: string) => ({ name, type }) as unknown as File;
  const make = (over: Record<string, unknown> = {}) => {
    const posted: Array<{ canvas: string; msg: Record<string, unknown> }> = [];
    const lines: string[] = [];
    const pick = createImagePick({
      upload: async (f: File) => ({ path: `assets/${f.name}` }),
      natural: async () => ({ w: 999, h: 111 }),
      videoNatural: async () => ({ w: 1280, h: 720 }),
      post: (canvas: string, msg: Record<string, unknown>) => posted.push({ canvas, msg }),
      toast: (l: string) => lines.push(l),
      ...over,
    } as never);
    return { pick, posted, lines };
  };

  test('an mp4 is uploaded and posted as place-image with its video size', async () => {
    const { pick, posted, lines } = make();
    await pick.placeFiles('a.tsx', [file('goal.mp4', 'video/mp4')]);
    expect(lines).toEqual([]);
    expect(posted).toEqual([
      {
        canvas: 'a.tsx',
        msg: {
          dgn: 'place-image',
          asset: 'assets/goal.mp4',
          natural: { w: 1280, h: 720 },
          label: 'goal.mp4',
        },
      },
    ]);
  });

  test('mov, m4v, webm are videos too — by type or by name when the system left the type empty', async () => {
    for (const [name, type] of [
      ['a.mov', 'video/quicktime'],
      ['b.m4v', ''],
      ['c.webm', 'video/webm'],
      ['d.MP4', ''],
    ] as const) {
      const { pick, posted } = make();
      await pick.placeFiles('a.tsx', [file(name, type)]);
      expect(posted.length).toBe(1);
    }
  });

  test('the first picture OR video of the pick wins (a text file before it is skipped)', async () => {
    const { pick, posted } = make();
    await pick.placeFiles('a.tsx', [file('n.txt', 'text/plain'), file('x.mp4', 'video/mp4')]);
    expect(posted.length).toBe(1);
  });

  test('an unsupported file: nothing uploaded, the line names pictures AND videos', async () => {
    let uploads = 0;
    const { pick, lines } = make({
      upload: async () => {
        uploads++;
        return { path: 'assets/x' };
      },
    });
    await pick.placeFiles('a.tsx', [file('song.mp3', 'audio/mpeg')]);
    expect(uploads).toBe(0);
    expect(lines).toEqual([NOT_A_PICTURE_LINE]);
    expect(NOT_A_PICTURE_LINE).toBe(
      'That is not a picture or a video. Pick a PNG, JPEG, GIF, WebP, SVG or HEIC picture, or an MP4, MOV, M4V or WebM video.'
    );
    expect(NOT_ADDED_LINE).toMatch(/picture or video/);
  });

  test('a video the studio refuses: one line, nothing posted', async () => {
    const { pick, posted, lines } = make({
      upload: async () => ({ error: 'media exceeds the cap' }),
    });
    await pick.placeFiles('a.tsx', [file('big.mp4', 'video/mp4')]);
    expect(posted).toEqual([]);
    expect(lines).toEqual([NOT_ADDED_LINE]);
  });
});

describe('the Finder drop: a lone video is ours, placed like a photo', () => {
  const f = (name: string, type: string) => ({ name, type }) as { name: string; type: string };
  test('isVideoFile: by type, or by name when typeless; never a picture or a sound', () => {
    expect(isVideoFile(f('a.mp4', 'video/mp4'))).toBe(true);
    expect(isVideoFile(f('a.mov', 'video/quicktime'))).toBe(true);
    expect(isVideoFile(f('a.M4V', ''))).toBe(true);
    expect(isVideoFile(f('a.webm', 'video/webm'))).toBe(true);
    expect(isVideoFile(f('a.png', 'image/png'))).toBe(false);
    expect(isVideoFile(f('a.mp3', 'audio/mpeg'))).toBe(false);
    expect(isVideoFile(f('a.mkv', 'video/x-matroska'))).toBe(false);
  });
  test('dragVideoCount counts the video items of a drag in flight', () => {
    expect(
      dragVideoCount([
        { kind: 'file', type: 'video/mp4' },
        { kind: 'file', type: 'image/png' },
        { kind: 'file', type: 'audio/mpeg' },
      ])
    ).toBe(1);
  });
  test('videosOf takes the first video and counts the rest', () => {
    const r = videosOf([
      f('a.mp4', 'video/mp4'),
      f('b.mov', 'video/quicktime'),
      f('c.png', 'image/png'),
    ]);
    expect(r.video?.name).toBe('a.mp4');
    expect(r.over).toBe(1);
  });
  test('placedLine says video', () => {
    expect(placedLine(1, 'Intro', 'video')).toBe("Placed the video in Intro. It's in Assets too.");
    expect(placedLine(1, 'Intro')).toBe("Placed the photo in Intro. It's in Assets too.");
  });
  test('fitVideoSize keeps the aspect and never grows a clip', () => {
    expect(fitVideoSize({ w: 3840, h: 2160 })).toEqual({ w: 1280, h: 720 });
    expect(fitVideoSize({ w: 640, h: 360 })).toEqual({ w: 640, h: 360 });
    expect(fitVideoSize({ w: 1080, h: 1920 })).toEqual({ w: 720, h: 1280 });
  });
  test('runFinderDrop with a video: one image.place with its size, "Placed the video"', async () => {
    const asks: Array<{ params: Record<string, unknown> }> = [];
    const toasts: string[] = [];
    const target = { kind: 'artboard', el: {}, ref: null, artboard: 'post' } as never;
    const res = await runFinderDrop(
      [new File(['x'], 'goal.mp4', { type: 'video/mp4' })],
      target,
      { kind: 'artboard', empty: 0 },
      'Post',
      {
        upload: async () => ({ path: 'assets/deadbeef.mp4' }),
        videoNatural: async () => ({ w: 1280, h: 720 }),
        natural: async () => {
          throw new Error('a video is not measured as a picture');
        },
        run: async (ask: { params: Record<string, unknown> }) => {
          asks.push(ask);
          return {
            ok: true,
            actionId: null,
            writeId: 'w_0123456789abcdef',
            rev: 'r',
            refs: [],
          } as never;
        },
        toast: (m: string) => toasts.push(m),
      }
    );
    expect(res?.ok).toBe(true);
    expect(asks[0]?.params).toEqual({
      assets: ['assets/deadbeef.mp4'],
      mode: 'auto',
      artboard: 'post',
      natural: { w: 1280, h: 720 },
    });
    expect(toasts).toEqual(["Placed the video in Post. It's in Assets too."]);
  });
});

describe('the asset route keeps its strict sniff: a real mp4 is a video, a renamed text file is not', () => {
  const fixture = join(import.meta.dir, 'fixtures', 'tiny.mp4');
  test('tiny.mp4 sniffs as mp4/video', () => {
    expect(existsSync(fixture)).toBe(true);
    const bytes = new Uint8Array(readFileSync(fixture));
    expect(sniffAssetType(bytes)).toEqual({ ext: 'mp4', category: 'video' });
  });
  test('text bytes named .mp4 are refused', () => {
    expect(sniffAssetType(new TextEncoder().encode('hello this is not a movie at all'))).toBeNull();
  });
});
