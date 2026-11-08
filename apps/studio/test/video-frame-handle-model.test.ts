// #128 §5 (T3.6b) — the shell half of the on-canvas pan / zoom handle for the selected video clip.
//
// The Timeline owns the selection and the one write pipe; the canvas only draws the handle and reports where the person
// left the picture. This file pins the shell's words: what it tells the canvas (`video-frame-handle`), and how a report
// becomes ONE `video.reframe` write — the op the inspector's Zoom / Focus rows use — read back by the real enumerator.

import { describe, expect, test } from 'bun:test';

import { enumerateClips } from '../canvas-edit.ts';
import {
  frameCommitParams,
  frameHandleMessage,
  frameHandleRefusal,
  frameHandleState,
  frameHandleUi,
  handleScope,
} from '../client/v2/timeline/frame-handle-model.js';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';

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

const REELS = { w: 1080, h: 1920 };
const seqOf = (source: string) => {
  const c = clipTwo(source);
  return {
    stableId: c?.stableId,
    from: 90,
    duration: 120,
    mediaTag: 'Video',
    mediaSrc: 'b.mp4',
    mediaProps: c?.mediaProps ?? null,
    fit: c?.fit ?? null,
    reframe: c?.reframe ?? null,
  };
};

describe('what the shell tells the canvas', () => {
  test('open on a picture clip: the artboard, the clip, its source size, zoom and the focus at the playhead', () => {
    const seq = seqOf(SRC);
    const m = frameHandleMessage({
      open: true,
      seq,
      out: REELS,
      frame: 120,
      fps: 30,
      src: { w: 1920, h: 1080 },
      artboardId: 'reels',
      label: 'two',
    });
    expect(m).toEqual({
      dgn: 'video-frame-handle',
      v: 1,
      artboardId: 'reels',
      stableId: 'name:two',
      label: 'two',
      src: { w: 1920, h: 1080 },
      zoom: 1,
      focus: [0.5, 0.5],
    });
  });

  test('closed, or nothing that can be framed: the clear', () => {
    const clear = { dgn: 'video-frame-handle', v: 1, artboardId: null };
    const base = { seq: seqOf(SRC), out: REELS, frame: 0, fps: 30, src: null, artboardId: 'reels' };
    expect(frameHandleMessage({ ...base, open: false })).toEqual(clear);
    expect(frameHandleMessage({ ...base, open: true, seq: null })).toEqual(clear);
    expect(frameHandleMessage({ ...base, open: true, artboardId: null })).toEqual(clear);
    expect(frameHandleMessage({ ...base, open: true, seq: { ...base.seq, fit: 'blur' } })).toEqual(
      clear
    );
  });

  test('a long label is cut, an unknown source size goes as null', () => {
    const m = frameHandleMessage({
      open: true,
      seq: seqOf(SRC),
      out: REELS,
      frame: 0,
      fps: 30,
      src: null,
      artboardId: 'reels',
      label: 'x'.repeat(300),
    });
    expect((m as { label: string }).label.length).toBe(120);
    expect((m as { src: unknown }).src).toBeNull();
  });

  test('why it will not open, in the person’s words', () => {
    expect(frameHandleRefusal(null)).toBe('Select a clip with a picture to move it on the canvas.');
    expect(frameHandleRefusal({ mediaTag: 'Audio' })).toBe(
      'Select a clip with a picture to move it on the canvas.'
    );
    expect(frameHandleRefusal({ mediaTag: 'Video', fit: 'fit' })).toBe(
      'Set Framing to Fill to move the picture on the canvas.'
    );
    expect(frameHandleRefusal({ mediaTag: 'Video', fit: null })).toBeNull();
    expect(frameHandleRefusal({ mediaTag: 'Img', fit: 'fill' })).toBeNull();
  });

  test('the toggle: on, off, and a different clip turns it off', () => {
    frameHandleUi.close();
    expect(frameHandleUi.get()).toBeNull();
    frameHandleUi.toggle();
    expect(frameHandleUi.get()).toEqual({ stableId: null });
    frameHandleUi.pin('name:two');
    expect(frameHandleUi.get()).toEqual({ stableId: 'name:two' });
    frameHandleUi.pin('name:one');
    expect(frameHandleUi.get()).toBeNull();
    frameHandleUi.toggle();
    frameHandleUi.toggle();
    expect(frameHandleUi.get()).toBeNull();
  });
});

describe('a report from the canvas becomes ONE video.reframe write', () => {
  test('a pan of an unframed clip writes the shared focus; the file keeps it and the handle shows it back', () => {
    const seq = seqOf(SRC);
    const p = frameCommitParams(seq, REELS, 120, 30, { zoom: 1, focus: [0.3, 0.5] });
    expect(p).toEqual({ focus: [[0, 0.3, 0.5]] });
    const w = run(SRC, p as Record<string, unknown>);
    expect(clipTwo(w)?.reframe?.focus).toEqual([[0, 0.3, 0.5]]);
    expect(frameHandleState(seqOf(w), REELS, 120, 30)).toEqual({ zoom: 1, focus: [0.3, 0.5] });
  });

  test('a wheel or corner zoom and a pan land together: one write, one undo step', () => {
    const p = frameCommitParams(seqOf(SRC), REELS, 120, 30, { zoom: 1.5, focus: [0.42, 0.61] });
    expect(p).toEqual({ zoom: 1.5, focus: [[0, 0.42, 0.61]] });
    const r = clipTwo(run(SRC, p as Record<string, unknown>))?.reframe;
    expect(r?.zoom).toBe(1.5);
    expect(r?.focus).toEqual([[0, 0.42, 0.61]]);
  });

  test('nothing moved: no write; back to 1× and the centre clears the framing', () => {
    const framed = run(SRC, { zoom: 2, focus: [[0, 0.3, 0.5]] });
    const seq = seqOf(framed);
    expect(frameCommitParams(seq, REELS, 120, 30, { zoom: 2, focus: [0.3, 0.5] })).toBeNull();
    const back = frameCommitParams(seq, REELS, 120, 30, { zoom: 1, focus: [0.5, 0.5] });
    expect(back).toEqual({ zoom: null, focus: null });
    expect(clipTwo(run(framed, back as Record<string, unknown>))?.reframe).toBeNull();
  });

  test('a focus that moves over time gets a keyframe at the playhead, in source time', () => {
    const moving = run(SRC, {
      focus: [
        [1, 0.3, 0.5],
        [3, 0.7, 0.5],
      ],
    });
    // frame 120 is second 2 of the footage (30 frames in, trimBefore 30)
    const p = frameCommitParams(seqOf(moving), REELS, 120, 30, { zoom: 1, focus: [0.4, 0.5] });
    expect(p).toEqual({
      focus: [
        [1, 0.3, 0.5],
        [2, 0.4, 0.5],
        [3, 0.7, 0.5],
      ],
    });
  });

  test('this artboard has its own framing: the write goes to its format, never the shared one', () => {
    const own = run(SRC, { format: '9:16', focus: [[0, 0.2, 0.5]] });
    const seq = seqOf(own);
    expect(handleScope(seq.reframe, REELS)).toEqual({ scope: 'format', aspect: '9:16' });
    expect(frameHandleState(seq, REELS, 120, 30).focus).toEqual([0.2, 0.5]);
    const p = frameCommitParams(seq, REELS, 120, 30, { zoom: 1, focus: [0.25, 0.5] });
    expect(p).toEqual({ focus: [[0, 0.25, 0.5]], format: '9:16' });
    const r = clipTwo(run(own, p as Record<string, unknown>))?.reframe;
    expect(r?.formats['9:16']).toEqual([[0, 0.25, 0.5]]);
    expect(r?.focus).toEqual([]);
  });

  test('a report out of range is held to 1–8× and the picture', () => {
    expect(frameCommitParams(seqOf(SRC), REELS, 0, 30, { zoom: 40, focus: [1.7, -0.2] })).toEqual({
      zoom: 8,
      focus: [[0, 1, 0]],
    });
  });
});
