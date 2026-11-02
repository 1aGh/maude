// ripple.test.ts — feature-enhanced-video-editing Phase 0 (Task 2). Golden-file
// fixtures for the pure ripple engine: literal shifts, const-arithmetic
// trailing-term merges, the TOTAL-follows-const double-shift guard, series
// TOTAL-only behavior, and the loud structured refusals.

import { describe, expect, test } from 'bun:test';

import {
  applyRippleAfterClip,
  collectConsts,
  RippleError,
  resolveNum,
  shiftExpression,
} from '../ripple.ts';

const CANVAS = '/abs/Canvas.tsx';

describe('shiftExpression', () => {
  test('literal rewrites in place', () => {
    expect(shiftExpression('90', 12)).toBe('102');
    expect(shiftExpression('90', -30)).toBe('60');
  });
  test('trailing integer term merges', () => {
    expect(shiftExpression('A + B - 20', 12)).toBe('A + B - 8');
    expect(shiftExpression('A + B - 20', 20)).toBe('A + B');
    expect(shiftExpression('A + 10', -22)).toBe('A - 12');
  });
  test('no trailing term → appends', () => {
    expect(shiftExpression('A', 12)).toBe('A + 12');
    expect(shiftExpression('A + B', -12)).toBe('A + B - 12');
  });
  test('trailing int that is an operand of * stays untouched (appends instead)', () => {
    expect(shiftExpression('A * 2', 12)).toBe('A * 2 + 12');
  });
  test('unsafe charset → null (a call slips the charset but fails resolveNum — the engine refuses there)', () => {
    expect(shiftExpression('a ? 1 : 2', 12)).toBe(null);
    expect(resolveNum('fn(A)', { A: 1 })).toBe(null);
  });
});

describe('collectConsts + resolveNum', () => {
  const SRC = 'const A = 40;\nconst B = 50;\nconst TOTAL = A + B - 20;\n';
  test('derived consts resolve', () => {
    const c = collectConsts(SRC);
    expect(c.TOTAL).toBe(70);
    expect(resolveNum('TOTAL - 10', c)).toBe(60);
    expect(resolveNum('mystery + 1', c)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Standalone-Sequence comp (overlay/audio band shape) — literal + expression.

const STANDALONE = [
  'const A = 90;',
  'const TOTAL = 300;',
  'const Comp = () => (',
  '  <>',
  '    <Sequence name="one" from={0} durationInFrames={A}><Video src="a.mp4" /></Sequence>',
  '    <Sequence name="two" from={90} durationInFrames={100}><Video src="b.mp4" /></Sequence>',
  '    <Sequence name="three" from={A + 100} durationInFrames={110}><Video src="c.mp4" /></Sequence>',
  '  </>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '  );',
  '}',
].join('\n');

describe('applyRippleAfterClip — standalone sequences', () => {
  test('shifts literal and expression froms, bumps the TOTAL const', () => {
    const r = applyRippleAfterClip(CANVAS, STANDALONE, 'a', 'name:one', 12);
    expect(r.totalEdited).toBe(true);
    expect(r.shifted).toEqual(['name:two', 'name:three']);
    expect(r.source).toContain('const TOTAL = 312;');
    expect(r.source).toContain('from={102}');
    expect(r.source).toContain('from={A + 112}');
    // upstream untouched
    expect(r.source).toContain('from={0}');
  });

  test('negative delta merges the trailing term back down', () => {
    const r = applyRippleAfterClip(CANVAS, STANDALONE, 'a', 'name:one', -30);
    expect(r.source).toContain('const TOTAL = 270;');
    expect(r.source).toContain('from={60}');
    expect(r.source).toContain('from={A + 70}');
  });

  test('fromFrame: a piece starting inside the edited span stays, one at the old end moves', () => {
    // "one" spans 0-90; "two" starts at 90 (the old end), "three" at 190. Shrink "one" by 30 with
    // the editor threshold at its old end: both later pieces move, an earlier-starting one would not.
    const r = applyRippleAfterClip(CANVAS, STANDALONE, 'a', 'name:two', -30, { fromFrame: 190 });
    expect(r.shifted).toEqual(['name:three']);
    expect(r.source).toContain('from={90}'); // "two" starts before 190: untouched, no refusal
    expect(r.source).toContain('from={A + 70}');
  });

  test('delta 0 is a no-op', () => {
    const r = applyRippleAfterClip(CANVAS, STANDALONE, 'a', 'name:one', 0);
    expect(r.source).toBe(STANDALONE);
    expect(r.shifted).toEqual([]);
  });

  test('only clips AFTER the target shift', () => {
    const r = applyRippleAfterClip(CANVAS, STANDALONE, 'a', 'name:two', 12);
    expect(r.shifted).toEqual(['name:three']);
    expect(r.source).toContain('from={90}'); // "two" itself untouched
    expect(r.source).toContain('from={A + 112}');
  });
});

// ---------------------------------------------------------------------------
// The double-shift guard — an end card at `from={TOTAL - 60}` already follows
// the bumped const and must be SKIPPED, not shifted twice.

const COUPLED = [
  'const TOTAL = 300;',
  'const Comp = () => (',
  '  <>',
  '    <Sequence name="body" from={0} durationInFrames={240}><Video src="a.mp4" /></Sequence>',
  '    <Sequence name="end" from={TOTAL - 60} durationInFrames={60}><Video src="b.mp4" /></Sequence>',
  '  </>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '  );',
  '}',
].join('\n');

describe('applyRippleAfterClip — const-coupled froms', () => {
  test('a from that follows the bumped TOTAL is skipped (no double shift)', () => {
    const r = applyRippleAfterClip(CANVAS, COUPLED, 'a', 'name:body', 30);
    expect(r.source).toContain('const TOTAL = 330;');
    expect(r.source).toContain('from={TOTAL - 60}'); // untouched — follows the const
    expect(r.shifted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TransitionSeries storyline — series clips get NO from; TOTAL still moves.

const SERIES = [
  "import { TransitionSeries } from '@remotion/transitions';",
  'const S1 = 90;',
  'const S2 = 120;',
  'const XF = 15;',
  'const TOTAL = S1 + S2 - XF;',
  'const Comp = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="s1" durationInFrames={S1}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />',
  '    <TransitionSeries.Sequence name="s2" durationInFrames={S2}><Video src="b.mp4" /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DCArtboard id="a"><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '  );',
  '}',
].join('\n');

describe('applyRippleAfterClip — series storyline', () => {
  test('series clips get no from shift; TOTAL const merges the delta', () => {
    const r = applyRippleAfterClip(CANVAS, SERIES, 'a', 'name:s1', 12);
    expect(r.totalEdited).toBe(true);
    expect(r.shifted).toEqual([]);
    expect(r.source).toContain('const TOTAL = S1 + S2 - XF + 12;');
    // clip tags untouched
    expect(r.source).toContain('durationInFrames={S1}');
    expect(r.source).toContain('durationInFrames={S2}');
  });
});

// ---------------------------------------------------------------------------
// Refusals — loud, structured, never a silent mis-shift.

describe('applyRippleAfterClip — refusals', () => {
  test('unresolvable downstream from refuses with the clip named', () => {
    const SRC = STANDALONE.replace('from={A + 100}', 'from={computeStart()}');
    let err: unknown;
    try {
      applyRippleAfterClip(CANVAS, SRC, 'a', 'name:one', 12);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RippleError);
    expect(String((err as Error).message)).toContain('name:three');
  });

  test('unresolvable TOTAL const refuses', () => {
    const SRC = STANDALONE.replace('const TOTAL = 300;', 'const TOTAL = computeTotal();');
    expect(() => applyRippleAfterClip(CANVAS, SRC, 'a', 'name:one', 12)).toThrow(RippleError);
  });

  test('a shift below frame 0 refuses', () => {
    expect(() => applyRippleAfterClip(CANVAS, STANDALONE, 'a', 'name:one', -120)).toThrow(
      RippleError
    );
  });

  test('unknown clip refuses', () => {
    expect(() => applyRippleAfterClip(CANVAS, STANDALONE, 'a', 'name:nope', 12)).toThrow();
  });
});
