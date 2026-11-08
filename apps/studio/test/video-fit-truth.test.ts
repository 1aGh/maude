// video-fit-truth.test.ts — #128 §5 (T3.6, slice A): the clip inspector tells the truth about how a `<Video>` sits.
//
// A `<Video>` with no `<Reframe>` renders `contain` unless it carries the `objectFit` PROP (or a style objectFit the
// build maps to it, T1.2). The Framing select used to say "All formats" (Fill) for every clip without a `fit`, so a
// letterboxed clip read as filled. Now: the enumerator reads the fit, the model derives the select from it, Fill writes
// the prop, and Zoom / Focus are plain numbers over `video.reframe`.

import { describe, expect, test } from 'bun:test';

import { enumerateClips } from '../canvas-edit.ts';
import {
  focusOf,
  focusParams,
  framingOf,
  zoomOf,
  zoomParams,
} from '../client/v2/inspector/kinds/clip-model.js';
import { shouldAsk } from '../client/v2/timeline/fit-model.js';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';

const FILE = '/tmp/Fit.tsx';
const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const Cut = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="cover" durationInFrames={90}><Video src="a.mp4" objectFit="cover" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="style" durationInFrames={90}><Video src="b.mp4" style={{ objectFit: "contain" }} /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="bare" durationInFrames={90}><Video src="c.mp4" /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="wide" label="Wide" kind="video" width={1920} height={1080}><VideoComp component={Cut} durationInFrames={270} fps={30} width={1920} height={1080} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const clips = (source = SRC) => enumerateClips(FILE, source, 'wide').clips;
const clip = (name: string, source = SRC) =>
  clips(source).find((c) => c.stableId === `name:${name}`);

function run(op: string, source: string, name: string, params: Record<string, unknown>): string {
  const o = EDIT_OPS.find((x) => x.id === op);
  if (!o) throw new Error(`no op ${op}`);
  return o.apply(source, {
    file: 'ui/Fit.tsx',
    op,
    targets: [],
    params: { artboard: 'wide', stableId: `name:${name}`, ...params },
  }).source;
}

describe('the enumerator reads the fit a <Video> declares', () => {
  test('the prop, a style literal (T1.2 maps it), or nothing', () => {
    expect(clip('cover')?.mediaProps?.objectFit).toBe('cover');
    expect(clip('style')?.mediaProps?.objectFit).toBe('contain');
    expect(clip('bare')?.mediaProps?.objectFit).toBeNull();
  });
});

describe('framingOf: what the Framing select shows', () => {
  test('a Reframe fit wins; a Reframe without one is Fill', () => {
    expect(framingOf({ fit: 'blur', mediaTag: 'Video', mediaProps: { objectFit: null } })).toBe(
      'blur'
    );
    expect(framingOf({ fit: 'fit', mediaTag: 'Video', mediaProps: { objectFit: 'cover' } })).toBe(
      'fit'
    );
    expect(
      framingOf({
        fit: null,
        reframe: { zoom: 2 },
        mediaTag: 'Video',
        mediaProps: { objectFit: null },
      })
    ).toBe('fill');
  });

  test('a bare <Video> is what its objectFit says: cover is Fill, anything else (the default contain) is Fit', () => {
    const bare = (objectFit: string | null) => ({
      fit: null,
      reframe: null,
      mediaTag: 'Video',
      mediaProps: { objectFit },
    });
    expect(framingOf(bare('cover'))).toBe('fill');
    expect(framingOf(bare('contain'))).toBe('fit');
    expect(framingOf(bare(null))).toBe('fit');
  });

  test('pictures and clips whose media is not read stay Fill (their default)', () => {
    expect(framingOf({ fit: null, mediaTag: 'Img', mediaProps: { objectFit: null } })).toBe('fill');
    expect(framingOf({ fit: null, mediaTag: 'Video', mediaProps: null })).toBe('fill');
  });
});

describe('choosing Fill on a letterboxed <Video> makes it fill', () => {
  test('video.fit fill writes objectFit="cover" on a bare <Video>, so the select does not snap back to Fit', () => {
    const out = run('video.fit', SRC, 'bare', { fit: 'fill' });
    expect(clip('bare', out)?.mediaProps?.objectFit).toBe('cover');
    expect(framingOf(clip('bare', out) as never)).toBe('fill');
    expect(out).toContain('<Video src="c.mp4" objectFit="cover" />');
  });

  test('blur then fill returns a bare clip to a filled <Video>, not to a letterboxed one', () => {
    const blur = run('video.fit', SRC, 'bare', { fit: 'blur' });
    expect(blur).toContain('<Reframe fit="blur"><Video src="c.mp4" /></Reframe>');
    const back = run('video.fit', blur, 'bare', { fit: 'fill' });
    expect(back).not.toContain('<Reframe');
    expect(clip('bare', back)?.mediaProps?.objectFit).toBe('cover');
  });

  test('a clip that already covers is left as it was', () => {
    expect(run('video.fit', SRC, 'cover', { fit: 'fill' })).toBe(SRC);
  });
});

describe('the "vertical footage asks once" flow is unchanged', () => {
  const comp = { width: 1920, height: 1080 };
  const vertical = { w: 1080, h: 1920 };
  const seqOf = (name: string) => ({ ...(clip(name) as object), fit: null });

  test('a vertical clip in a wide video asks whatever objectFit the <Video> carries (an inserted clip declares cover)', () => {
    for (const name of ['cover', 'style', 'bare']) {
      expect(shouldAsk({ seq: seqOf(name), comp, size: vertical, asked: false })).toBe(true);
    }
  });

  test('picking a fit settles it: a Reframe fit stops the question', () => {
    expect(
      shouldAsk({ seq: { ...seqOf('bare'), fit: 'fit' }, comp, size: vertical, asked: false })
    ).toBe(false);
  });
});

describe('Zoom and Focus: numbers over video.reframe', () => {
  const seq = (reframe: unknown) => ({ reframe });

  test('zoom reads the Reframe (1 when none); a value of 1 clears it', () => {
    expect(zoomOf(seq(null))).toBe(1);
    expect(zoomOf(seq({ zoom: 2.5 }))).toBe(2.5);
    expect(zoomParams(2)).toEqual({ zoom: 2 });
    expect(zoomParams(1)).toEqual({ zoom: null });
    expect(zoomParams(99)).toEqual({ zoom: 8 });
  });

  test('focus reads the shared point as percents (centre when none); more than one key is animated', () => {
    expect(focusOf(seq(null))).toEqual({ x: 50, y: 50, animated: false });
    expect(focusOf(seq({ focus: [[0, 0.25, 0.8]] }))).toEqual({ x: 25, y: 80, animated: false });
    expect(
      focusOf(
        seq({
          focus: [
            [0, 0.25, 0.8],
            [2, 0.5, 0.5],
          ],
        })
      ).animated
    ).toBe(true);
  });

  test('one axis changes, the other stays; the centre clears the framing', () => {
    expect(focusParams(seq(null), 'x', 30)).toEqual({ focus: [[0, 0.3, 0.5]] });
    expect(focusParams(seq({ focus: [[1.5, 0.3, 0.5]] }), 'y', 70)).toEqual({
      focus: [[1.5, 0.3, 0.7]],
    });
    expect(focusParams(seq({ focus: [[0, 0.3, 0.5]] }), 'x', 50)).toEqual({ focus: null });
    expect(focusParams(seq(null), 'x', 140)).toEqual({ focus: [[0, 1, 0.5]] });
  });

  test('the params go through the real video.reframe op and read back', () => {
    let out = run('video.reframe', SRC, 'cover', zoomParams(2));
    out = run('video.reframe', out, 'cover', focusParams(clip('cover', out) as never, 'x', 25));
    const r = clip('cover', out)?.reframe;
    expect(r?.zoom).toBe(2);
    expect(r?.focus).toEqual([[0, 0.25, 0.5]]);
    expect(focusOf(clip('cover', out) as never)).toEqual({ x: 25, y: 50, animated: false });
  });
});
