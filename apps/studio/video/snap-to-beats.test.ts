// S7.6 — `video.cut-to-beat` (V2-1.10 §5.6 "Cut to the beat", test #9): every storyline cut point
// rolls to the nearest beat within ±½ beat. A roll keeps TOTAL and every overlay where it was; a cut
// whose clips lack the source handle is reported and left in place, never stretched past its media.

import { describe, expect, test } from 'bun:test';

import { beatsEvery, halfBeat } from '../edit-ops/clip/cut-to-beat.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { compClips } from './derive.ts';

const FILE = 'ui/Reel.tsx';

const comp = (threeTrim = 30) =>
  [
    "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
    "import { Sequence } from 'remotion';",
    "import { TransitionSeries } from '@remotion/transitions';",
    "import { Video } from '@remotion/media';",
    'const TOTAL = 270;',
    'const Comp = () => (',
    '  <>',
    '    <TransitionSeries>',
    '      <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
    '      <TransitionSeries.Sequence name="two" durationInFrames={120}><Video src="b.mp4" trimBefore={30} /></TransitionSeries.Sequence>',
    `      <TransitionSeries.Sequence name="three" durationInFrames={60}><Video src="c.mp4"${threeTrim ? ` trimBefore={${threeTrim}}` : ''} /></TransitionSeries.Sequence>`,
    '    </TransitionSeries>',
    '    <Sequence name="title" from={240} durationInFrames={20}><div data-cd-id="t">Konec</div></Sequence>',
    '  </>',
    ');',
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="reel" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
    '',
  ].join('\n');

const op = EDIT_OPS.find((o) => o.id === 'video.cut-to-beat');
const run = (source: string, params: Record<string, unknown>) =>
  op?.apply(source, {
    file: FILE,
    op: 'video.cut-to-beat',
    targets: [],
    params: { artboard: 'reel', ...params },
  });
const story = (source: string) =>
  compClips(FILE, source, 'reel')
    .clips.filter((c) => c.track === 'video')
    .map((c) => [c.from, c.durationInFrames, c.trimBefore]);

describe('video.cut-to-beat', () => {
  test('a roll edit moves the cut to the beat and keeps TOTAL and the overlays', () => {
    const beats = [0, 32, 64, 96, 128, 160, 192, 224, 256]; // ½ beat = 16 frames
    const out = run(comp(), { beats, sources: { 'a.mp4': 4, 'b.mp4': 10 } });
    expect(out?.detail).toEqual({ moved: 2, kept: [] });
    const src = out?.source as string;
    expect(src).toContain('const TOTAL = 270;');
    expect(src).toContain('from={240}'); // the title after both cuts did not move
    // cut 90 → 96 (one's out-point and two's in-point together); cut 210 → 224
    expect(story(src)).toEqual([
      [0, 96, 0],
      [96, 128, 36],
      [224, 46, 44],
    ]);
  });

  test('a title that starts inside the rolled clip stays, whichever way the cut rolls (trim-in no longer ripples it)', () => {
    // trim-in ripples only what starts at or after the clip's OLD end (a239cd57f); the roll must undo
    // exactly that ripple — nothing more, nothing less.
    const fromOf = (src: string) => /name="title" from=\{(\d+)\}/.exec(src)?.[1];
    // later: cut 210 → 224 (d = +14); three spans 210..270, the title at 262 sits inside it and
    // inside the 14-frame window just before the old end that a naive threshold would shift
    const later = run(comp().replace('from={240}', 'from={262}'), {
      beats: [0, 32, 64, 96, 128, 160, 192, 224, 256],
      sources: { 'a.mp4': 4, 'b.mp4': 10 },
    });
    expect(later?.detail).toEqual({ moved: 2, kept: [] });
    expect(fromOf(later?.source as string)).toBe('262');
    // earlier: cut 90 → 80 (d = −10); two spans 90..210. A title inside it (150) stays, one after it (215) stays too
    for (const at of ['150', '215']) {
      const earlier = run(comp().replace('from={240}', `from={${at}}`), {
        beats: [0, 40, 80, 120, 160, 200, 240],
        sources: { 'a.mp4': 4, 'b.mp4': 10 },
      });
      expect(fromOf(earlier?.source as string), `title at ${at}`).toBe(at);
      expect(earlier?.source).toContain('const TOTAL = 270;');
    }
  });

  test('a cut without the source handle is reported and stays', () => {
    const beats = [0, 40, 80, 120, 160, 200, 240]; // ½ beat = 20
    // cut 90 → 80: two has 30 frames before its in-point — moves. cut 210 → 200: three starts at
    // its source's first frame — no handle, kept.
    const out = run(comp(0), { beats });
    expect(out?.detail).toEqual({ moved: 1, kept: [{ at: 210, reason: 'no-handle' }] });
    expect(story(out?.source as string)).toEqual([
      [0, 80, 0],
      [80, 130, 20],
      [210, 60, 0],
    ]);
    expect(out?.source).toContain('const TOTAL = 270;');
  });

  test('extending a clip needs its source length; unknown means no handle', () => {
    const beats = [0, 32, 64, 96, 128, 160, 192, 224, 256];
    const out = run(comp(), { beats }); // no `sources`: one cannot grow past frame 90
    expect(out?.detail).toEqual({
      moved: 0,
      kept: [
        { at: 90, reason: 'no-handle' },
        { at: 210, reason: 'no-handle' },
      ],
    });
    expect(out?.source).toBe(comp());
  });

  test('every 2 / 4 beats; a malformed request refuses', () => {
    expect(beatsEvery([0, 10, 20, 30, 40, 50, 60, 70], 4)).toEqual([0, 40]);
    expect(beatsEvery([20, 0, 10, 10], 2)).toEqual([0, 20]);
    expect(halfBeat([0, 30, 60, 100])).toBe(15);
    expect(() => run(comp(), { beats: 'soon' })).toThrow(/beats are not readable/);
    expect(() => run(comp(), { beats: [0, 30], every: 3 })).toThrow(/1, 2 or 4/);
  });
});
