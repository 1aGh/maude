// V2-8.5 C2 (04 modes R7 · 14 R4) — a colour the file wrote as a literal is said in words: the design system's own
// token when one has that colour ("Page", "Ink"), else a plain word. Never `rgb(255, 255, 255)`.
import { describe, expect, test } from 'bun:test';
import {
  colourWords,
  plainColourWord,
  rgbOf,
} from '../client/v2/inspector/sections/colour-words.js';

const COLORS = ['--page', '--ink', '--accent'];
const VALS: Record<string, string> = {
  '--page': '#ffffff',
  '--ink': 'oklch(0.2 0.02 250)',
  '--accent': 'rgb(0, 116, 195)',
};

describe('colourWords', () => {
  test('a literal that a token has is that token, by any notation', () => {
    expect(colourWords('rgb(255, 255, 255)', COLORS, VALS)).toBe('Page');
    expect(colourWords('#fff', COLORS, VALS)).toBe('Page');
    expect(colourWords('rgb(0 116 195)', COLORS, VALS)).toBe('Accent');
  });

  test('an oklch token matches the rgb the browser resolved it to', () => {
    // oklch(0.2 0.02 250) is a near-black blue-grey: #0e1319-ish
    const rgb = rgbOf(VALS['--ink']) as number[];
    expect(rgb.every((v) => v >= 0 && v < 40)).toBe(true);
    expect(colourWords(`rgb(${rgb.join(', ')})`, COLORS, VALS)).toBe('Ink');
  });

  test('with no token it is a plain colour word', () => {
    expect(colourWords('#ffffff', [], {})).toBe('White');
    expect(colourWords('rgb(20, 24, 31)', [], {})).toBe('Black');
    expect(colourWords('#808080', [], {})).toBe('Grey');
    expect(colourWords('rgb(220, 40, 40)', [], {})).toBe('Red');
    expect(colourWords('rgb(20, 90, 40)', [], {})).toBe('Dark green');
  });

  test('transparent is None; what is not a colour this reads is left to the caller', () => {
    expect(colourWords('transparent', COLORS, VALS)).toBe('None');
    expect(colourWords('rgba(0, 0, 0, 0)', COLORS, VALS)).toBe('None');
    expect(colourWords('currentColor', COLORS, VALS)).toBeNull();
    expect(colourWords('linear-gradient(red, blue)', COLORS, VALS)).toBeNull();
  });

  test('plainColourWord never names a code word', () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 0, 255],
      [255, 200, 0],
    ] as [number, number, number][])
      expect(plainColourWord(rgb)).not.toMatch(/rgb|#|\(/);
  });
});
