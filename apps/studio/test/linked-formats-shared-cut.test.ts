// S7.13 — "Trim or retitle once and all three follow": linked formats mount ONE comp, so an edit to the cut is an edit to
// every format, and an unlinked copy stops following. Real ops on a real source, read back by the real enumerator.

import { describe, expect, test } from 'bun:test';

import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { compClips } from '../video/derive.ts';

const FILE = 'ui/Recap.tsx';
const BASE = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const Recap = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="two" durationInFrames={60}><Video src="b.mp4" /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reels" label="Recap · Reels" kind="video" width={1080} height={1920}><VideoComp component={Recap} durationInFrames={150} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

function run(source: string, op: string, params: Record<string, unknown>): string {
  const o = EDIT_OPS.find((x) => x.id === op);
  if (!o) throw new Error(`no op ${op}`);
  return o.apply(source, { file: FILE, op, targets: [], params }).source;
}
const cut = (source: string, artboard: string) =>
  compClips(FILE, source, artboard).clips.map((c) => [
    c.src,
    c.from,
    c.durationInFrames,
    c.trimBefore,
  ]);

describe('one cut, three formats', () => {
  const three = run(
    run(BASE, 'video.format.add', { artboard: 'reels', width: 1920, height: 1080 }),
    'video.format.add',
    { artboard: 'reels', width: 1080, height: 1080 }
  );

  test('the three artboards play the same clips', () => {
    const reels = cut(three, 'reels');
    expect(reels).toHaveLength(2);
    expect(cut(three, 'reels-16x9')).toEqual(reels);
    expect(cut(three, 'reels-1x1')).toEqual(reels);
  });

  test('a trim of the cut shows in all three, with no write to the other two', () => {
    const trimmed = run(three, 'video.take.swap', {
      artboard: 'reels',
      stableId: 'name:one',
      srcStart: 2,
    });
    const reels = cut(trimmed, 'reels');
    expect(reels[0]?.[3]).toBe(60); // two seconds into the footage
    expect(cut(trimmed, 'reels-16x9')).toEqual(reels);
    expect(cut(trimmed, 'reels-1x1')).toEqual(reels);
    // the other two artboards’ own lines were not touched: the edit is to the shared comp
    const lines = (s: string) => s.split('\n').filter((l) => l.includes('<DCArtboard'));
    expect(lines(trimmed)).toEqual(lines(three));
  });

  test('an unlinked copy stops following: a trim of the original no longer reaches it', () => {
    const forked = run(three, 'video.format.unlink', { artboard: 'reels-16x9' });
    const trimmed = run(forked, 'video.take.swap', {
      artboard: 'reels',
      stableId: 'name:one',
      srcStart: 2,
    });
    expect(cut(trimmed, 'reels')[0]?.[3]).toBe(60);
    expect(cut(trimmed, 'reels-1x1')).toEqual(cut(trimmed, 'reels'));
    expect(cut(trimmed, 'reels-16x9')[0]?.[3]).toBe(0); // its own cut, as it was when it was forked
  });
});
