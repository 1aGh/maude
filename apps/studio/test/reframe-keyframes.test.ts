// S7.13 — Re-frame (07 · ve-reframe): dragging a format's window at the playhead writes a focus keyframe in SOURCE time,
// for This format or for All formats; Reset puts the centre back; B3 means no subject following. The model is pure; the
// writes go through the real `video.reframe` op and are read back by the real enumerator, so what the island sends is what
// the file keeps and what the island next shows.

import { describe, expect, test } from 'bun:test';

import { enumerateClips } from '../canvas-edit.ts';
import {
  defaultFormat,
  dragFocus,
  dropParams,
  focusRange,
  focusShown,
  formatOptions,
  isFramed,
  keyframeWords,
  keysFor,
  playheadSourceSec,
  resetParams,
  roundSec,
  upsertKey,
  windowFractions,
} from '../client/v2/timeline/reframe-model.js';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { reframeWindow } from '../video/framing.ts';
import { reframeOf } from '../video/reframe-read.ts';

const FILE = '/tmp/Recap.tsx';
const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const Recap = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="two" durationInFrames={120}><Video src="b.mp4" trimBefore={30} /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reels" label="Recap · Reels" kind="video" width={1080} height={1920}><VideoComp component={Recap} durationInFrames={210} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

function run(source: string, params: Record<string, unknown>): string {
  const o = EDIT_OPS.find((x) => x.id === 'video.reframe');
  if (!o) throw new Error('no op');
  return o.apply(source, {
    file: 'ui/Recap.tsx',
    op: 'video.reframe',
    targets: [],
    params: { artboard: 'reels', stableId: 'name:two', ...params },
  }).source;
}
const clipTwo = (source: string) =>
  enumerateClips(FILE, source, 'reels').clips.find((c) => c.stableId === 'name:two');

const SRC_16x9 = { w: 1920, h: 1080 };
const REELS = { w: 1080, h: 1920 };
const WIDE = { w: 1920, h: 1080 };

describe('source time: the playhead through the clip’s trim and speed', () => {
  const seq = { from: 90, duration: 120, mediaProps: { trimBefore: 30, playbackRate: 1 } };

  test('frame 120 is 30 frames into the clip, which starts 30 frames into the footage: second 2', () => {
    expect(playheadSourceSec(120, seq, 30)).toBe(2);
    expect(playheadSourceSec(90, seq, 30)).toBe(1);
  });

  test('a speed moves the footage faster than the comp', () => {
    expect(
      playheadSourceSec(120, { ...seq, mediaProps: { trimBefore: 30, playbackRate: 2 } }, 30)
    ).toBe(3);
  });

  test('outside the clip the playhead is held at its first or last frame, never negative', () => {
    expect(playheadSourceSec(0, seq, 30)).toBe(1);
    expect(playheadSourceSec(500, seq, 30)).toBe(5);
    expect(playheadSourceSec(-4, { ...seq, mediaProps: null }, 30)).toBe(0);
  });

  test('a trim of the clip leaves the keyframe on its moment of footage (the file keeps source seconds)', () => {
    // drop a window at frame 120 → source second 2
    const t = playheadSourceSec(120, seq, 30);
    const written = run(SRC, {
      format: '9:16',
      focus: dropParams(null, 'format', '9:16', t, [0.3, 0.5]).focus,
    });
    expect(clipTwo(written)?.reframe?.formats['9:16']).toEqual([[2, 0.3, 0.5]]);
    // the clip is trimmed 30 frames earlier into the footage: the keyframe still says second 2 …
    const trimmed = written.replace('trimBefore={30}', 'trimBefore={0}');
    expect(clipTwo(trimmed)?.reframe?.formats['9:16']).toEqual([[2, 0.3, 0.5]]);
    // … and it now shows 60 frames into the clip, because that is where second 2 plays
    const seqTrimmed = { ...seq, mediaProps: { trimBefore: 0, playbackRate: 1 } };
    expect(playheadSourceSec(90 + 60, seqTrimmed, 30)).toBe(2);
    expect(playheadSourceSec(120, seqTrimmed, 30)).toBe(1);
  });
});

describe('what a drop writes', () => {
  test('This format: the keys go into that format’s entry, sorted, and a second drop on the same frame replaces', () => {
    const a = dropParams(null, 'format', '9:16', 2, [0.3, 0.5]);
    expect(a).toEqual({ focus: [[2, 0.3, 0.5]], format: '9:16' });
    const reframe = { focus: [], zoom: 1, fit: null, formats: { '9:16': [[4, 0.6, 0.5]] } };
    const b = dropParams(reframe, 'format', '9:16', 2, [0.3, 0.5]);
    expect(b.focus).toEqual([
      [2, 0.3, 0.5],
      [4, 0.6, 0.5],
    ]);
    const c = dropParams(reframe, 'format', '9:16', 4.0004, [0.7, 0.4]);
    expect(c.focus).toEqual([[4, 0.7, 0.4]]);
  });

  test('All formats: the shared focus, no format key; the other formats keep theirs', () => {
    const reframe = { focus: [], zoom: 1, fit: null, formats: { '16:9': [[0, 0.5, 0.55]] } };
    const p = dropParams(reframe, 'all', '9:16', 2, [0.3, 0.5]);
    expect(p).toEqual({ focus: [[2, 0.3, 0.5]] });
    const w = run(run(SRC, { format: '16:9', focus: [[0, 0.5, 0.55]] }), p);
    const r = clipTwo(w)?.reframe;
    expect(r?.focus).toEqual([[2, 0.3, 0.5]]);
    expect(r?.formats['16:9']).toEqual([[0, 0.5, 0.55]]);
  });

  test('Reset clears this scope only; the last thing gone unwraps the Reframe', () => {
    expect(resetParams('format', '9:16')).toEqual({ focus: null, format: '9:16' });
    expect(resetParams('all', '9:16')).toEqual({ focus: null });
    const framed = run(SRC, { format: '9:16', focus: [[2, 0.3, 0.5]] });
    const reset = run(framed, resetParams('format', '9:16'));
    expect(reset).not.toContain('<Reframe');
    expect(clipTwo(reset)?.reframe).toBeNull();
  });

  test('B3: the file never gets a follow prop from the island, and the writer refuses one', () => {
    const p = dropParams(null, 'format', '9:16', 2, [0.3, 0.5]);
    expect(Object.keys(p).sort()).toEqual(['focus', 'format']);
    expect(run(SRC, p)).not.toContain('follow');
  });

  test('the clip reads back what was written: shared keys, per-format keys, zoom and fit', () => {
    let s = run(SRC, {
      focus: [
        [0, 0.5, 0.5],
        [3, 0.6, 0.5],
      ],
      zoom: 2,
      fit: 'blur',
    });
    s = run(s, { format: '16:9', focus: [[1, 0.4, 0.45]] });
    expect(clipTwo(s)?.reframe).toEqual({
      focus: [
        [0, 0.5, 0.5],
        [3, 0.6, 0.5],
      ],
      zoom: 2,
      fit: 'blur',
      formats: { '16:9': [[1, 0.4, 0.45]] },
    });
    expect(clipTwo(SRC)?.reframe).toBeNull();
    // a <Reframe> in another clip is not this clip’s
    expect(
      enumerateClips(FILE, s, 'reels').clips.find((c) => c.stableId === 'name:one')?.reframe
    ).toBeNull();
  });

  test('a tag that is not a clean literal reads as nothing (the island starts from the centre)', () => {
    expect(reframeOf('<Reframe focus={FOCUS}><Video /></Reframe>')).toEqual({
      focus: [],
      zoom: 1,
      fit: null,
      formats: {},
    });
    expect(reframeOf('<Video />')).toBeNull();
    expect(reframeOf('<Reframe focus={[[0,2,0.5]]}><Video /></Reframe>')?.focus).toEqual([]);
  });
});

describe('the window the island draws is the one the renderer cuts', () => {
  test('a 9:16 window in a 16:9 picture is 31.6 % wide and as tall as the picture', () => {
    const w = windowFractions([0.5, 0.5], SRC_16x9, REELS);
    expect(w.width).toBeCloseTo(0.3164, 3);
    expect(w.height).toBeCloseTo(1, 6);
    expect(w.left).toBeCloseTo(0.3418, 3);
    const px = reframeWindow([0.5, 0.5], SRC_16x9, REELS, 1);
    expect(w.left * SRC_16x9.w).toBeCloseTo(px.x, 6);
    expect(w.width * SRC_16x9.w).toBeCloseTo(px.w, 6);
  });

  test('a window as tall as the picture only moves sideways, and never leaves it', () => {
    const range = focusRange(SRC_16x9, REELS);
    expect(range.x[0]).toBeCloseTo(0.1582, 3);
    expect(range.x[1]).toBeCloseTo(0.8418, 3);
    expect(range.y[0]).toBeCloseTo(0.5, 6);
    expect(range.y[1]).toBeCloseTo(0.5, 6);
    const box = { w: 560, h: 315 };
    expect(dragFocus([0.5, 0.5], 1000, 80, box, SRC_16x9, REELS)).toEqual([0.8418, 0.5]);
    expect(dragFocus([0.5, 0.5], -1000, 0, box, SRC_16x9, REELS)[0]).toBeCloseTo(0.1582, 3);
    expect(dragFocus([0.5, 0.5], 56, 0, box, SRC_16x9, REELS)[0]).toBeCloseTo(0.6, 3);
  });

  test('zoom shrinks the window, so it can move both ways', () => {
    const range = focusRange(SRC_16x9, WIDE, 2);
    expect(range.x[0]).toBeCloseTo(0.25, 6);
    expect(range.y[0]).toBeCloseTo(0.25, 6);
  });

  test('a format’s own keys win, then the shared ones, then the centre (the renderer’s rule); All formats shows the shared', () => {
    const reframe = {
      focus: [[0, 0.7, 0.5]],
      zoom: 1,
      fit: null,
      formats: { '9:16': [[0, 0.2, 0.5]] },
    };
    expect(focusShown(reframe, 'format', '9:16', 1, REELS)).toEqual([0.2, 0.5]);
    expect(focusShown(reframe, 'format', '16:9', 1, WIDE)).toEqual([0.7, 0.5]);
    expect(focusShown(reframe, 'all', '9:16', 1, REELS)).toEqual([0.7, 0.5]);
    expect(focusShown(null, 'format', '9:16', 1, REELS)).toEqual([0.5, 0.5]);
  });
});

describe('the island’s small facts', () => {
  const formats = [
    { artboardId: 'reels', aspect: '9:16', name: 'Reels 9:16', w: 1080, h: 1920, current: true },
    { artboardId: 'wide', aspect: '16:9', name: '16:9', w: 1920, h: 1080, current: false },
    { artboardId: 'wide2', aspect: '16:9', name: '16:9', w: 1280, h: 720, current: false },
  ];

  test('the format seg: one option per aspect, the video’s own first and chosen', () => {
    const o = formatOptions(formats);
    expect(o.map((x: { label: string }) => x.label)).toEqual(['Reels 9:16', '16:9']);
    expect(defaultFormat(o, 'reels')).toBe('9:16');
    expect(defaultFormat(o, 'wide')).toBe('16:9');
    expect(defaultFormat([], 'x')).toBeNull();
  });

  test('keyframes: counted in words, Reset only where something is framed', () => {
    const reframe = { focus: [[0, 0.5, 0.5]], zoom: 1, fit: null, formats: {} };
    expect(keysFor(reframe, 'all', '9:16')).toHaveLength(1);
    expect(keysFor(reframe, 'format', '9:16')).toHaveLength(0);
    expect(isFramed(reframe, 'all', '9:16')).toBe(true);
    expect(isFramed(reframe, 'format', '9:16')).toBe(false);
    expect(keyframeWords(0)).toBe('Centred. Drag the window to frame it.');
    expect(keyframeWords(1)).toBe('1 keyframe');
    expect(keyframeWords(3)).toBe('3 keyframes');
  });

  test('times are held to a thousandth; upsert keeps the list sorted', () => {
    expect(roundSec(2.00049)).toBe(2);
    expect(upsertKey([[3, 0.1, 0.1]], 1, 0.2, 0.2)).toEqual([
      [1, 0.2, 0.2],
      [3, 0.1, 0.1],
    ]);
  });
});
