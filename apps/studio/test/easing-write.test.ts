// S7.18 — the easing curve of a keyframe (07 ve-advanced "Easing", 06 ad-timeline): `video.easing.set` writes
// `{ easing: Easing.bezier(a, b, c, d) }` on the k-th `interpolate(frame, …)` of a named component, the Timeline
// reads the same windows back (`keyframeInfo`), and the designer's name for it is `cubic-bezier(a, b, c, d)`.

import { describe, expect, test } from 'bun:test';

import { parseCompTimeline } from '../client/panels/timeline-parse.js';
import { CanvasEditError } from '../canvas-edit.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import {
  bezierAt,
  describeKeyframes,
  EASE_OUT,
  formatBezier,
  interpolateCalls,
  isBezier,
  parseBezier,
  readEasing,
  writeEasing,
} from '../video/keyframes.ts';

const COMP = `import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
const Intro = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 14], [0, 1]);
  const y = interpolate(frame, [10, 30], [48, 0], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o, top: y }} />;
};
const Payoff = () => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [4, 20], [0.8, 1], OPTS);
  return <AbsoluteFill style={{ transform: 's' }} />;
};
const Movie = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={45}><Intro /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
    <TransitionSeries.Sequence durationInFrames={60}><Payoff /></TransitionSeries.Sequence>
  </TransitionSeries>
);
export default function Canvas() {
  return (
    <DesignCanvas>
      <DCArtboard id="reel" label="Recap" kind="video" width={1080} height={1920}><VideoComp component={Movie} durationInFrames={90} fps={30} width={1080} height={1920} /></DCArtboard>
    </DesignCanvas>
  );
}
`;

const FILE = 'ui/Reel.tsx';
function run(source: string, params: Record<string, unknown>) {
  const o = EDIT_OPS.find((x) => x.id === 'video.easing.set');
  if (!o) throw new Error('no op video.easing.set');
  return o.apply(source, { file: FILE, op: o.id, targets: [], params: { artboard: 'reel', ...params } });
}
const write = (source: string, component: string, index: number, b: Parameters<typeof writeEasing>[3]) => {
  const w = writeEasing(source, component, index, b);
  if (!w.ok) throw new Error(`refused: ${w.reason}`);
  return w.source;
};

describe('the windows (video/keyframes.ts)', () => {
  test('every interpolate(frame, [a, b…) of a component, in source order, with its arguments', () => {
    const calls = interpolateCalls(COMP, 'Intro');
    expect(calls.map((c) => [c.index, c.from, c.to])).toEqual([
      [0, '0', '14'],
      [1, '10', '30'],
    ]);
    expect(calls[1].args.map((a) => a.text)).toEqual([
      'frame',
      '[10, 30]',
      '[48, 0]',
      "{ extrapolateRight: 'clamp' }",
    ]);
    expect(interpolateCalls(COMP, 'Nope')).toEqual([]);
    expect(interpolateCalls(COMP, 'a b')).toEqual([]);
  });

  test('describeKeyframes: the value it moves, what it goes between, and the curve it has', () => {
    expect(describeKeyframes(COMP, 'Intro')).toEqual([
      { index: 0, component: 'Intro', prop: 'o', values: ['0', '1'], easing: { kind: 'none' } },
      { index: 1, component: 'Intro', prop: 'y', values: ['48', '0'], easing: { kind: 'none' } },
    ]);
  });

  test('the Timeline reads the same windows: keyframeInfo is parallel to keyframes', () => {
    const r = parseCompTimeline(COMP, 90);
    const intro = r.sequences[0];
    expect(intro.keyframes).toHaveLength(2);
    expect(intro.keyframeInfo.map((k: { index: number; prop: string }) => [k.index, k.prop])).toEqual([
      [0, 'o'],
      [1, 'y'],
    ]);
    expect(r.sequences[1].keyframeInfo[0]).toMatchObject({ component: 'Payoff', prop: 's' });
  });

  test('the designer’s spelling and the comp’s are the same four numbers', () => {
    expect(formatBezier(EASE_OUT)).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(parseBezier('Easing.bezier(0.22, 1, 0.36, 1)')).toEqual([0.22, 1, 0.36, 1]);
    expect(parseBezier('Easing.bezier(0.22, 1, 0.36)')).toBeNull();
    expect(parseBezier('Easing.out(Easing.cubic)')).toBeNull();
    expect(parseBezier('Easing.bezier(a, 1, 0.36, 1)')).toBeNull();
    expect(isBezier([1.2, 0, 0, 1])).toBe(false); // x past 1: not a function of time
    expect(isBezier([0.2, 5, 0.3, 1])).toBe(false);
  });

  test('bezierAt: starts at 0, ends at 1, ease-out is ahead of linear at the middle', () => {
    expect(bezierAt(EASE_OUT, 0)).toBeCloseTo(0, 5);
    expect(bezierAt(EASE_OUT, 1)).toBeCloseTo(1, 5);
    expect(bezierAt(EASE_OUT, 0.5)).toBeGreaterThan(0.8);
    expect(bezierAt([0, 0, 1, 1], 0.4)).toBeCloseTo(0.4, 3);
  });
});

describe('writeEasing', () => {
  test('a call with an options object gets easing first; its other options stay', () => {
    const out = write(COMP, 'Intro', 1, EASE_OUT);
    expect(out).toContain(
      "interpolate(frame, [10, 30], [48, 0], { easing: Easing.bezier(0.22, 1, 0.36, 1), extrapolateRight: 'clamp' })"
    );
    // nothing else moved
    expect(out.replace(/easing: Easing\.bezier\(0\.22, 1, 0\.36, 1\), /, '')).toBe(COMP);
    const read = readEasing(out, interpolateCalls(out, 'Intro')[1]);
    expect(read).toEqual({ kind: 'bezier', bezier: [0.22, 1, 0.36, 1], css: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  });

  test('a call with three arguments gains { easing }', () => {
    const out = write(COMP, 'Intro', 0, [0.4, 0, 0.2, 1]);
    expect(out).toContain('interpolate(frame, [0, 14], [0, 1], { easing: Easing.bezier(0.4, 0, 0.2, 1) })');
  });

  test('a curve already there is swapped, not stacked', () => {
    const once = write(COMP, 'Intro', 1, EASE_OUT);
    const twice = write(once, 'Intro', 1, [0.5, 0, 0.5, 1]);
    expect(twice).toContain("{ easing: Easing.bezier(0.5, 0, 0.5, 1), extrapolateRight: 'clamp' }");
    expect(twice.match(/easing:/g)).toHaveLength(1);
  });

  test('null takes it off: the property goes, the other options stay; an options object left empty goes too', () => {
    const withCurve = write(COMP, 'Intro', 1, EASE_OUT);
    expect(write(withCurve, 'Intro', 1, null)).toBe(COMP);
    const alone = write(COMP, 'Intro', 0, EASE_OUT);
    expect(write(alone, 'Intro', 0, null)).toBe(COMP);
    // easing last in the list
    const last = COMP.replace("{ extrapolateRight: 'clamp' }", "{ extrapolateRight: 'clamp', easing: Easing.bezier(0.1, 0.2, 0.3, 0.4) }");
    expect(write(last, 'Intro', 1, null)).toBe(COMP);
    // nothing to take off
    expect(write(COMP, 'Intro', 1, null)).toBe(COMP);
  });

  test('options that are not a plain object are left alone, with a reason', () => {
    expect(writeEasing(COMP, 'Payoff', 0, EASE_OUT)).toEqual({ ok: false, reason: 'not-literal' });
    expect(writeEasing(COMP, 'Intro', 7, EASE_OUT)).toEqual({ ok: false, reason: 'no-call' });
    expect(writeEasing(COMP, 'Intro', 0, [3, 0, 0, 1] as never)).toEqual({ ok: false, reason: 'bad-curve' });
  });

  test('a curve spelled another way reads as other, and writing over it replaces it', () => {
    const odd = COMP.replace("{ extrapolateRight: 'clamp' }", '{ easing: Easing.out(Easing.cubic) }');
    expect(readEasing(odd, interpolateCalls(odd, 'Intro')[1])).toEqual({
      kind: 'other',
      text: 'Easing.out(Easing.cubic)',
    });
    expect(write(odd, 'Intro', 1, EASE_OUT)).toContain('{ easing: Easing.bezier(0.22, 1, 0.36, 1) }');
  });
});

describe('the edit op video.easing.set', () => {
  test('is a registered edit op that holds the artboard it names', () => {
    const o = EDIT_OPS.find((x) => x.id === 'video.easing.set');
    expect(o?.scope).toBe('artboard');
  });

  test('writes the curve, and adds Easing to the remotion import it already has', () => {
    const out = run(COMP, { component: 'Intro', index: 1, bezier: [0.22, 1, 0.36, 1] }).source;
    expect(out).toContain("import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';");
    expect(out).toContain('{ easing: Easing.bezier(0.22, 1, 0.36, 1), extrapolateRight');
  });

  test('a comp with no remotion import gets one', () => {
    const bare = COMP.replace("import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';\n", '');
    const out = run(bare, { component: 'Intro', index: 0, bezier: [0.4, 0, 0.2, 1] }).source;
    expect(out).toContain("import { Easing } from 'remotion';");
  });

  test('Easing already imported is not imported twice', () => {
    const had = COMP.replace('useCurrentFrame }', 'useCurrentFrame, Easing }');
    const out = run(had, { component: 'Intro', index: 0, bezier: [0.4, 0, 0.2, 1] }).source;
    expect(out.match(/\bEasing\b/g)?.length).toBe(2); // the import + the one use
  });

  test('null takes the curve off and leaves the import', () => {
    const on = run(COMP, { component: 'Intro', index: 1, bezier: [0.22, 1, 0.36, 1] }).source;
    const off = run(on, { component: 'Intro', index: 1, bezier: null }).source;
    expect(off).not.toContain('easing:');
  });

  test('the same curve again changes nothing', () => {
    const on = run(COMP, { component: 'Intro', index: 1, bezier: [0.22, 1, 0.36, 1] });
    const again = run(on.source, { component: 'Intro', index: 1, bezier: [0.22, 1, 0.36, 1] });
    expect(again.source).toBe(on.source);
    expect(again.detail).toEqual({ changed: false });
  });

  test('refuses in the designer’s words, never in code', () => {
    const msg = (params: Record<string, unknown>) => {
      try {
        run(COMP, params);
      } catch (e) {
        expect(e).toBeInstanceOf(CanvasEditError);
        return (e as Error).message;
      }
      return null;
    };
    expect(msg({ component: 'Intro', index: 9, bezier: [0.22, 1, 0.36, 1] })).toBe(
      'That animation is not in the video any more.'
    );
    expect(msg({ component: 'Payoff', index: 0, bezier: [0.22, 1, 0.36, 1] })).toBe(
      'This animation’s options are not a plain object, so the curve is left as it is.'
    );
    expect(msg({ component: 'Intro', index: 0, bezier: [5, 0, 0, 1] })).toBe(
      'A curve is four numbers; the first and third sit between 0 and 1.'
    );
    expect(msg({ index: 0, bezier: null })).toBe('The animation names no clip.');
    expect(msg({ component: 'Intro', index: -1, bezier: null })).toBe(
      'The animation is not one this video has.'
    );
  });
});
