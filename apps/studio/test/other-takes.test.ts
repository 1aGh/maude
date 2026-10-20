// S7.15 — Other takes (07 · ve-ai-adjust): "Touchdown 2 offers its other takes from its source; AI's pick is
// marked. Swapping keeps the length and the beat." The model decides what is offered (same length or longer,
// usable, the clip's own take marked); the swap is the existing `video.take.swap` edit op, so the swap is a
// person's ordinary edit. Both halves are pinned here against the real op.

import { describe, expect, test } from 'bun:test';

import { swapParams, TAKES_WORDS, takesOf } from '../client/v2/timeline/other-takes-model.js';
import { assetOfSrc, footageUrl } from '../client/v2/timeline/other-takes-store.js';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { compClips } from '../video/derive.ts';

const FPS = 30;
// the clip is 2.5 s long (75 frames) and starts at 3 s of its source
const SHOTS = [
  { start: 1, end: 3.5, quality: 0.5, usable: true },
  { start: 3, end: 5.5, quality: 0.9, usable: true }, // AI's pick, and where the clip is now
  { start: 4.5, end: 7, quality: 0.6, usable: true },
  { start: 7.5, end: 8.5, quality: 0.99, usable: true }, // 1 s: shorter than the clip
  { start: 0, end: 3, quality: 1, usable: false, note: 'shaky' }, // not usable
];
const CLIP = { lengthFrames: 75, fps: FPS, trimBeforeFrames: 90, sourceSeconds: 10 };

describe('what is offered', () => {
  test('only usable shots at least as long as the clip; every take is exactly the clip’s length', () => {
    const m = takesOf({ shots: SHOTS, ...CLIP });
    expect(m.lenSec).toBe(2.5);
    expect(m.takes.map((t) => t.label)).toEqual(['0:01–0:03.5', '0:03–0:05.5', '0:04.5–0:07']);
    for (const t of m.takes) expect(t.srcEnd - t.srcStart).toBeCloseTo(2.5, 6);
    expect(m.takes.every((t) => t.len === '2.5 s')).toBe(true);
  });

  test('the take the clip is on is marked, and AI’s pick is the strongest usable shot', () => {
    const m = takesOf({ shots: SHOTS, ...CLIP });
    expect(m.takes.map((t) => [t.label, t.current, t.pick])).toEqual([
      ['0:01–0:03.5', false, false],
      ['0:03–0:05.5', true, true],
      ['0:04.5–0:07', false, false],
    ]);
    // after a swap to the third take the pick stays where AI put it; "in the cut" moves
    const swapped = takesOf({ shots: SHOTS, ...CLIP, trimBeforeFrames: 4.5 * FPS });
    expect(swapped.takes.map((t) => [t.current, t.pick])).toEqual([
      [false, false],
      [false, true],
      [true, false],
    ]);
  });

  test('a clip trimmed to the middle of a shot keeps its own window as the current take', () => {
    const wide = [
      { start: 1, end: 3.5, usable: true },
      { start: 3, end: 8, usable: true },
    ];
    const m = takesOf({ shots: wide, ...CLIP, trimBeforeFrames: 3.4 * FPS });
    const cur = m.takes.find((t) => t.current);
    expect(cur?.srcStart).toBeCloseTo(3.4, 6);
    expect(cur?.label).toBe('0:03.4–0:05.9');
  });

  test('speed counts: a 1.5× clip of 75 frames uses 3.75 s of source', () => {
    const m = takesOf({ shots: SHOTS, ...CLIP, rate: 1.5 });
    expect(m.lenSec).toBe(3.75);
    expect(m.takes).toHaveLength(0); // no shot is that long
    expect(m.canSwap).toBe(false);
  });

  test('a take that would run past the source’s end is not offered', () => {
    const m = takesOf({ shots: SHOTS, ...CLIP, sourceSeconds: 6 });
    expect(m.takes.map((t) => t.srcStart)).toEqual([1, 3]);
  });

  test('nothing to swap to: one take (its own), or no analysis at all', () => {
    expect(takesOf({ shots: [SHOTS[1]], ...CLIP }).canSwap).toBe(false);
    expect(takesOf({ shots: undefined, ...CLIP }).canSwap).toBe(false);
    expect(takesOf({ shots: [], ...CLIP }).takes).toEqual([]);
    expect(takesOf({ shots: SHOTS, lengthFrames: 0, fps: FPS }).canSwap).toBe(false);
  });

  test('the swap params carry the source’s length when it is known', () => {
    const m = takesOf({ shots: SHOTS, ...CLIP });
    expect(swapParams(m.takes[0], 10)).toEqual({ srcStart: 1, sourceSeconds: 10 });
    expect(swapParams(m.takes[0])).toEqual({ srcStart: 1 });
  });

  test('the words are the contract’s', () => {
    expect(TAKES_WORDS.title('Touchdown 2')).toBe('Other takes · Touchdown 2');
    expect(TAKES_WORDS.foot).toBe('Click a take to swap it in. Same length, same beat.');
    expect(TAKES_WORDS.pick).toBe('AI’s pick');
  });

  test('an asset is found in whatever spelling the clip’s src has', () => {
    for (const src of [
      'assets/9f3a1c2b.mp4',
      './assets/9f3a1c2b.mp4',
      '/.design/assets/9f3a1c2b.mp4?v=2',
    ])
      expect(assetOfSrc(src)).toBe('assets/9f3a1c2b.mp4');
    expect(assetOfSrc('https://example.com/x.mp4')).toBeNull();
    expect(assetOfSrc('assets/../etc/passwd')).toBeNull();
    expect(assetOfSrc(undefined)).toBeNull();
    expect(footageUrl('assets/9f3a1c2b.mp4')).toBe('/_api/footage?asset=assets%2F9f3a1c2b.mp4');
  });
});

// ── the swap is an ordinary edit: same length, same place, same beat ────────────────────────────

const FILE = 'ui/Reel.tsx';
const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { Audio } from 'remotion';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const TOTAL = 225;',
  'const Comp = () => (',
  '  <>',
  '    <TransitionSeries>',
  '      <TransitionSeries.Sequence name="one" durationInFrames={75}><Video src="assets/a1111111.mp4" /></TransitionSeries.Sequence>',
  '      <TransitionSeries.Sequence name="Touchdown 2" durationInFrames={75}><Video src="assets/a2222222.mp4" trimBefore={90} /></TransitionSeries.Sequence>',
  '      <TransitionSeries.Sequence name="three" durationInFrames={75}><Video src="assets/a3333333.mp4" /></TransitionSeries.Sequence>',
  '    </TransitionSeries>',
  '    <Audio src="assets/bed.mp3" />',
  '  </>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" label="Recap · Reels · 0:30" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

function swap(source: string, params: Record<string, unknown>) {
  const op = EDIT_OPS.find((o) => o.id === 'video.take.swap');
  if (!op) throw new Error('no video.take.swap');
  return op.apply(source, {
    file: FILE,
    op: 'video.take.swap',
    targets: [],
    params: { artboard: 'reel', stableId: 'name:Touchdown 2', ...params },
  }).source;
}

describe('swapping a take keeps the length and the beat', () => {
  test('every take the model offers swaps in with nothing else moving', () => {
    const before = compClips(FILE, SRC, 'reel');
    const m = takesOf({ shots: SHOTS, ...CLIP });
    const others = m.takes.filter((t) => !t.current);
    expect(others.length).toBeGreaterThan(0);
    for (const take of others) {
      const after = compClips(FILE, swap(SRC, swapParams(take, 10)), 'reel');
      // the same clips start at the same frames and last the same time: the beat does not move
      expect(after.clips.map((c) => [c.stableId, c.from, c.durationInFrames])).toEqual(
        before.clips.map((c) => [c.stableId, c.from, c.durationInFrames])
      );
      expect(after.total).toBe(before.total);
      expect(after.clips.find((c) => c.stableId === 'name:Touchdown 2')?.trimBefore).toBe(
        Math.round(take.srcStart * FPS)
      );
    }
  });

  test('a take the model would never offer is refused by the op (the server is the gate)', () => {
    expect(() => swap(SRC, { srcStart: 9, sourceSeconds: 10 })).toThrow(/shorter than the clip/);
  });
});
