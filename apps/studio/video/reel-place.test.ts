// S7.14 — `reel-place --next` (contract V2-1.10 §5.7, §7 "AI cut"): an EDL becomes the comp ONE literal
// `<TransitionSeries.Sequence>` per call, matched by name, with TOTAL ending where the last shot ends; the
// progress the run shows is derived from the comp (`placeProgress`), never from what the model says.

import { describe, expect, test } from 'bun:test';
import { checkFile } from '../check/index.ts';
import type { Edl } from '../footage/schema.ts';
import { compBeats, compClips } from './derive.ts';
import { edlShots, placeNext, placeProgress, shotName, storylineByName } from './reel-place.ts';

const ABS = '/tmp/maude-reel-place/.design/ui/Recap.tsx';
const EMPTY = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { AbsoluteFill } from 'remotion';",
  '',
  'const Recap = () => (',
  "  <AbsoluteFill style={{ background: '#000' }}>",
  '  </AbsoluteFill>',
  ');',
  '',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="recap" kind="video" label="Recap · Reels" width={1080} height={1920}>',
  '        <VideoComp component={Recap} durationInFrames={900} fps={30} width={1080} height={1920} />',
  '      </DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const NAMES = [
  'Kickoff',
  'Crowd',
  'Run 1',
  'Tackle 1',
  'Pass',
  'Catch',
  'Tackle 2',
  'Touchdown 1',
  'Bench',
  'Run 2',
  'Touchdown 2',
  'Fans',
  'Coach',
  'Logo',
];
// 14 shots: every third one fades in (8 frames), the rest are hard cuts; lengths on a 15-frame grid
const EDL: Edl = {
  version: 1,
  fps: 30,
  width: 1080,
  height: 1920,
  beats: NAMES.map((name, i) => ({
    clip: `assets/${String(i % 9).padStart(8, 'a')}.mp4`,
    startSec: 1 + i * 0.5,
    durationFrames: 45 + (i % 3) * 15,
    name,
    transition: i > 0 && i % 3 === 0 ? { presentation: 'fade' as const, frames: 8 } : null,
  })),
};

const expectedTotal = (n: number) => {
  const shots = edlShots(EDL).slice(0, n);
  return (
    shots.reduce((a, s) => a + s.durationFrames, 0) -
    shots.slice(1).reduce((a, s) => a + (s.transition?.frames ?? 0), 0)
  );
};

function placeAll(n: number, src = EMPTY) {
  let source = src;
  for (let i = 0; i < n; i++) {
    const r = placeNext(ABS, source, EDL, 'recap');
    if (r.status !== 'placed') throw new Error(`stopped at ${i}`);
    source = r.source;
  }
  return source;
}

describe('placeNext — one literal Sequence per call', () => {
  test('the first shot lands as one named Sequence with its source in-point, TOTAL = its length', () => {
    const r = placeNext(ABS, EMPTY, EDL, 'recap');
    expect(r.status).toBe('placed');
    if (r.status !== 'placed') return;
    expect(r.shot.name).toBe('Kickoff');
    expect([r.placed, r.total]).toEqual([1, 14]);
    expect(r.source.match(/<TransitionSeries\.Sequence\b/g)?.length).toBe(1);
    expect(r.source).toContain('name="Kickoff"');
    expect(r.source).toContain('src="assets/aaaaaaa0.mp4" trimBefore={30}');
    const c = compClips(ABS, r.source, 'recap');
    expect(c.unresolved).toEqual([]);
    expect(c.total).toBe(45);
    expect(checkFile('ui/Recap.tsx', r.source, { tier: 'fast' }).ok).toBe(true);
  });

  test('× 14: every shot is its own literal block (no .map), transitions as the EDL says, TOTAL follows', () => {
    let source = EMPTY;
    for (let i = 0; i < 14; i++) {
      const r = placeNext(ABS, source, EDL, 'recap');
      expect(r.status).toBe('placed');
      if (r.status !== 'placed') return;
      // exactly one more Sequence per call
      expect(r.source.match(/<TransitionSeries\.Sequence\b/g)?.length).toBe(i + 1);
      expect(r.shot.name).toBe(NAMES[i] as string);
      source = r.source;
      const c = compClips(ABS, source, 'recap');
      expect(c.unresolved).toEqual([]);
      expect(c.total).toBe(expectedTotal(i + 1));
    }
    expect(source).not.toContain('.map(');
    expect(source.match(/<TransitionSeries\.Transition\b/g)?.length).toBe(4); // shots 4, 7, 10, 13
    const names = [...storylineByName(compClips(ABS, source, 'recap')).keys()];
    expect(names).toEqual(NAMES);
    expect(checkFile('ui/Recap.tsx', source, { tier: 'fast' }).ok).toBe(true);
    // the 15th call: nothing left
    expect(placeNext(ABS, source, EDL, 'recap')).toEqual({
      status: 'all-placed',
      placed: 14,
      total: 14,
    });
  });

  test('matched by name: a comp that already holds shots 1–7 continues at shot 8 (Keep going)', () => {
    const seven = placeAll(7);
    const r = placeNext(ABS, seven, EDL, 'recap');
    expect(r.status === 'placed' && r.shot.n).toBe(8);
    expect(r.status === 'placed' && r.placed).toBe(8);
  });

  test('an EDL with no shots is refused in words', () => {
    expect(() => placeNext(ABS, EMPTY, { ...EDL, beats: [] }, 'recap')).toThrow(
      'The cut has no shots to place.'
    );
  });
});

describe('shot names are comp-safe labels', () => {
  test('markup, braces and quotes never reach the attribute; empty → "Shot n"; repeats are numbered', () => {
    expect(shotName('Tackle"} /><script>{x}', 3)).toBe('Tackle script x');
    expect(shotName('   ', 4)).toBe('Shot 4');
    const shots = edlShots({
      beats: [0, 1].map(() => ({
        clip: 'assets/aaaaaaaa.mp4',
        startSec: 0,
        durationFrames: 30,
        name: 'Run',
      })),
    });
    expect(shots.map((s) => s.name)).toEqual(['Run', 'Run 2']);
  });
});

describe('placeProgress — from the comp, never from prose', () => {
  test('after 7 of 14: done/total, the AI edge is the end of shot 7, the last shot is named', () => {
    const seven = placeAll(7);
    const c = compClips(ABS, seven, 'recap');
    const p = placeProgress(c, EDL);
    expect(p).not.toBeNull();
    if (!p) return;
    expect([p.kind, p.done, p.total]).toEqual(['place', 7, 14]);
    expect(p.label).toBe('Placing shots — 7 of 14');
    const last = storylineByName(c).get('Tackle 2');
    expect(p.edge).toBe((last?.from ?? 0) + (last?.durationInFrames ?? 0));
    expect(p.edge).toBe(expectedTotal(7));
    expect(p.shot).toMatchObject({
      n: 7,
      name: 'Tackle 2',
      stableId: 'name:Tackle 2',
      at: last?.from,
    });
  });

  test('"on the beat" only when every placed shot starts on a beat', () => {
    const seven = placeAll(7);
    const c = compClips(ABS, seven, 'recap');
    const starts = [...storylineByName(c).values()].map((s) => s.from);
    expect(placeProgress(c, EDL, starts)?.label).toBe('Placing shots on the beat — 7 of 14');
    expect(placeProgress(c, EDL, starts.slice(1))?.label).toBe('Placing shots — 7 of 14');
    expect(compBeats(c, {})).toEqual([]);
  });

  test('a comp with none of the EDL shots is not this cut (null)', () => {
    expect(placeProgress(compClips(ABS, EMPTY, 'recap'), EDL)).toBeNull();
  });
});
