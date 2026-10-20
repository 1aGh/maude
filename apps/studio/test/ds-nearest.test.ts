// S10.17 (13 · ds-edge-trash, ds-edge-suggest, canvases 27 and 28): the nearest colour still in the system, by OKLab
// distance. Moving a token to the trash picks the replacement canvases follow; an off-system colour is offered the
// closest system colour. A token that is trashed, waiting to be trashed, only proposed, or that points back at the
// colour being replaced is never a candidate.
import { describe, expect, test } from 'bun:test';

import { resolveColour } from '../ds/contrast.ts';
import { deltaE, type NearestToken, nearestForToken, nearestForValue } from '../ds/nearest.ts';

const tok = (
  css: string,
  light: string,
  dark?: string,
  extra: Partial<NearestToken> = {}
): NearestToken => ({
  css,
  kind: 'color',
  group: 'line',
  values: dark ? { light, dark } : { light },
  pending: null,
  ...extra,
});
const THEMES = { default: 'light', all: ['light', 'dark'] };

const SYSTEM: NearestToken[] = [
  tok('--line-1', '#dddddd', '#333333'),
  tok('--line-2', '#bbbbbb', '#555555'),
  tok('--accent', 'oklch(0.55 0.2 255)', 'oklch(0.65 0.2 255)', { group: 'accent' }),
  tok('--fg-0', '#111111', '#eeeeee', { group: 'fg' }),
];

describe('deltaE (OKLab)', () => {
  const rgb = (v: string) =>
    resolveColour(v, () => undefined) as { r: number; g: number; b: number };
  test('zero for the same colour, symmetric, larger for a bigger step', () => {
    expect(deltaE(rgb('#336699'), rgb('#336699'))).toBeCloseTo(0, 6);
    expect(deltaE(rgb('#336699'), rgb('#cc9933'))).toBeCloseTo(
      deltaE(rgb('#cc9933'), rgb('#336699')),
      9
    );
    expect(deltaE(rgb('#000000'), rgb('#ffffff'))).toBeGreaterThan(
      deltaE(rgb('#000000'), rgb('#808080'))
    );
  });
});

describe('nearestForToken (the trash replacement)', () => {
  test('the closest colour of the system, not the first in the list', () => {
    const r = nearestForToken('--line-1', SYSTEM, THEMES);
    expect(r?.css).toBe('--line-2');
    expect(r?.deltaE).toBeGreaterThan(0);
  });

  test('judged in BOTH modes: a colour near in Light but far in Dark loses', () => {
    const sys = [
      tok('--a', '#dddddd', '#222222'),
      tok('--near-light-far-dark', '#dcdcdc', '#dddddd'),
      tok('--near-both', '#d0d0d0', '#2a2a2a'),
    ];
    expect(nearestForToken('--a', sys, THEMES)?.css).toBe('--near-both');
  });

  test('never the token itself, a trashed one, one waiting for the trash, one only proposed, or one that points back', () => {
    const sys = [
      tok('--x', '#dddddd'),
      tok('--twin', '#dddddd', undefined, { trashed: true }),
      tok('--twin2', '#dddddd', undefined, { pending: { trashTo: '--y', added: false } }),
      tok('--twin3', '#dddddd', undefined, { pending: { trashTo: null, added: true } }),
      tok('--twin4', 'var(--x)'),
      tok('--far', '#222222'),
    ];
    expect(nearestForToken('--x', sys, THEMES)?.css).toBe('--far');
  });

  test('only colours stand in for a colour', () => {
    const sys = [tok('--x', '#dddddd'), tok('--len', '4px', undefined, { kind: 'length' })];
    expect(nearestForToken('--x', sys, THEMES)).toBeNull();
  });

  test('a token Tier-1 roles stand on is allowed as a replacement; ties go to the same group', () => {
    const sys = [
      tok('--x', '#888888', undefined, { group: 'line' }),
      tok('--other', '#8a8a8a', undefined, { group: 'fg' }),
      tok('--mate', '#8a8a8a', undefined, { group: 'line' }),
    ];
    expect(nearestForToken('--x', sys, THEMES)?.css).toBe('--mate');
  });

  test('an unknown token has no replacement', () => {
    expect(nearestForToken('--nope', SYSTEM, THEMES)).toBeNull();
  });
});

describe('nearestForValue (the off-system colour)', () => {
  test('a hand-picked blue is offered Accent', () => {
    const r = nearestForValue('#3b6fe0', SYSTEM, THEMES);
    expect(r?.css).toBe('--accent');
  });

  test('a value that is not one plain colour gets no suggestion', () => {
    expect(nearestForValue('linear-gradient(red, blue)', SYSTEM, THEMES)).toBeNull();
    expect(nearestForValue('transparent', SYSTEM, THEMES)).toBeNull();
  });

  test('a colour that IS a system colour is not off-system (distance 0)', () => {
    const r = nearestForValue('#111111', SYSTEM, THEMES);
    expect(r?.css).toBe('--fg-0');
    expect(r?.deltaE).toBeCloseTo(0, 3);
    expect(r?.exact).toBe(true);
  });
});
