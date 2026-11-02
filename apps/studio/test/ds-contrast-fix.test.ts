// S10.17 (13 · ds-edge-contrast, canvas 26): "Lighten to 4.5:1" is an OKLCH lightness search. The fix reaches the
// bar in ONE step, moves only L (chroma and hue stay), never breaks a pair that passed, and says nothing when the
// token already passes or cannot be fixed.
import { describe, expect, test } from 'bun:test';

import { rgbToOklch } from '../draw/palette.ts';
import { contrastOf, fixContrast, resolveColour } from '../ds/contrast.ts';

// a dark theme: light text (--fg-2) on three dark surfaces
const DARK = {
  '--bg-0': 'oklch(0.18 0.01 160)',
  '--bg-1': 'oklch(0.23 0.012 160)',
  '--bg-2': 'oklch(0.27 0.012 160)',
  '--fg-2': 'oklch(0.50 0.04 150)',
} as const;
const LIGHT = {
  '--bg-0': 'oklch(0.98 0.005 160)',
  '--bg-1': 'oklch(0.95 0.005 160)',
  '--fg-2': 'oklch(0.80 0.04 150)',
} as const;

const lch = (v: string) => {
  const rgb = resolveColour(v, () => undefined);
  if (!rgb) throw new Error(`not a colour: ${v}`);
  return rgbToOklch(rgb);
};

describe('fixContrast', () => {
  test('lightens a dark-theme text colour to 4.5:1 on every surface, in one step', () => {
    const before = contrastOf('--fg-2', DARK);
    expect(before.some((p) => p.pass === false)).toBe(true);

    const fix = fixContrast('--fg-2', DARK);
    expect(fix).not.toBeNull();
    expect(fix?.direction).toBe('lighten');
    // applying the value gives a pass on every pair of the token — one step, no loop
    const after = contrastOf('--fg-2', { ...DARK, '--fg-2': fix?.value as string });
    expect(after.length).toBe(before.length);
    for (const p of after) expect(p.pass).toBe(true);
    for (const p of after) expect(p.ratio as number).toBeGreaterThanOrEqual(p.need);
    expect(fix?.ratio as number).toBeGreaterThanOrEqual(4.5);
  });

  test('changes only L: chroma and hue keep their written values', () => {
    const fix = fixContrast('--fg-2', DARK);
    expect(fix?.value).toMatch(/^oklch\(/);
    const was = lch(DARK['--fg-2']);
    const now = lch(fix?.value as string);
    expect(now.l).toBeGreaterThan(was.l);
    expect(Math.abs(now.c - was.c)).toBeLessThan(0.002);
    expect(Math.abs(now.h - was.h)).toBeLessThan(1.5);
  });

  test('the smallest move that clears the bar (not a jump to white)', () => {
    const fix = fixContrast('--fg-2', DARK);
    const to = lch(fix?.value as string);
    expect(to.l).toBeLessThan(0.9);
    // one step less lightness would not have passed (the search is minimal)
    const lower = `oklch(${(to.l - 0.012).toFixed(3)} ${to.c.toFixed(3)} ${Math.round(to.h)})`;
    const worse = contrastOf('--fg-2', { ...DARK, '--fg-2': lower });
    expect(worse.some((p) => p.pass === false)).toBe(true);
  });

  test('a light-theme text colour is DARKENED', () => {
    const fix = fixContrast('--fg-2', LIGHT);
    expect(fix?.direction).toBe('darken');
    for (const p of contrastOf('--fg-2', { ...LIGHT, '--fg-2': fix?.value as string }))
      expect(p.pass).toBe(true);
  });

  test('a surface that is too close to its text moves away from it', () => {
    const vals = { '--fg-0': 'oklch(0.90 0 0)', '--bg-1': 'oklch(0.70 0.01 160)' };
    const fix = fixContrast('--bg-1', vals);
    expect(fix?.direction).toBe('darken');
    for (const p of contrastOf('--bg-1', { ...vals, '--bg-1': fix?.value as string }))
      expect(p.pass).toBe(true);
  });

  test('a hex token is written back as hex', () => {
    const vals = { '--bg-0': '#101a14', '--fg-2': '#4b6b57' };
    const fix = fixContrast('--fg-2', vals);
    expect(fix?.value).toMatch(/^#[0-9a-f]{6}$/);
    for (const p of contrastOf('--fg-2', { ...vals, '--fg-2': fix?.value as string }))
      expect(p.pass).toBe(true);
  });

  test('an alias is fixed as the colour it resolves to (a concrete value comes back)', () => {
    const vals = { ...DARK, '--fg-2': 'var(--tone)', '--tone': 'oklch(0.50 0.04 150)' };
    const fix = fixContrast('--fg-2', vals);
    expect(fix?.value).toMatch(/^oklch\(/);
  });

  test('nothing to do when the token passes, or when it is not one plain colour', () => {
    expect(fixContrast('--fg-2', { ...DARK, '--fg-2': 'oklch(0.9 0.02 150)' })).toBeNull();
    expect(fixContrast('--fg-2', { ...DARK, '--fg-2': 'linear-gradient(red, blue)' })).toBeNull();
    expect(fixContrast('--nope', DARK)).toBeNull();
  });

  test('a pair that cannot be met by lightness alone is refused (null), never half-fixed', () => {
    // dark and light surfaces on both sides: no single text lightness clears 4.5 on both
    const vals = {
      '--bg-0': 'oklch(0.10 0 0)',
      '--bg-4': 'oklch(0.92 0 0)',
      '--fg-0': 'oklch(0.5 0 0)',
    };
    expect(fixContrast('--fg-0', vals)).toBeNull();
  });

  test('whatever it returns passes every pair of the token, the ones that passed before included', () => {
    // --fg-3 needs 3:1 on both a dark and a mid surface; only one of them fails today
    const vals = {
      '--bg-0': 'oklch(0.15 0 0)',
      '--bg-3': 'oklch(0.50 0 0)',
      '--fg-3': 'oklch(0.62 0 0)',
    };
    const fix = fixContrast('--fg-3', vals);
    if (fix)
      for (const p of contrastOf('--fg-3', { ...vals, '--fg-3': fix.value }))
        expect(p.pass).toBe(true);
  });
});
