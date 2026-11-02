// P8 round 7 third pass (13 · ds-edit-colour, ds-edge-contrast): the contrast line says it the way the board does —
//   pass  "5.6:1 on white · 4.8:1 on the dark page"     one ratio per mode, with the surface it was judged on
//   fail  "3.1:1 on Pole and Hover"                      the TWO surfaces that fell short, in the mode being edited
// and a role words for the token ("Text on surfaces — hints") the inspector draws in the warning state.
import { describe, expect, test } from 'bun:test';
import { contrastLine, roleWords } from '../client/v2/ds/contrast.js';

const tok = (css: string, label: string, light: string, dark: string) => ({
  css,
  label,
  values: { light, dark },
});

const model = (over: Record<string, [string, string]> = {}) => {
  const base: Record<string, [string, string, string]> = {
    '--bg-0': ['Page', '#ffffff', 'oklch(0.2 0.01 250)'],
    '--bg-1': ['Pole', '#f4f4f4', 'oklch(0.26 0.01 250)'],
    '--bg-2': ['Hover', '#ececec', 'oklch(0.3 0.01 250)'],
    '--fg-1': ['Secondary', '#202020', '#e8e8e8'],
    '--accent': ['Accent', 'oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'],
    '--accent-fg': ['Text on accent', '#ffffff', 'oklch(0.18 0.01 250)'],
  };
  return {
    themes: { light: 'light', dark: 'dark', default: 'light' },
    tokens: Object.entries(base).map(([css, [label, l, d]]) => {
      const o = over[css];
      return tok(css, label, o ? o[0] : l, o ? o[1] : d);
    }),
  };
};

describe('the pass line names the surface in each mode', () => {
  test('"N:1 on white · N:1 on the dark page" — a near-white surface reads white, the dark page reads so', () => {
    const line = contrastLine(model(), '--fg-1', {});
    expect(line?.ok).toBe(true);
    // fg-1 is judged on Bg 0..4: the worst surface is named, not an invented one
    expect(line?.line).toMatch(/^\d+(\.\d)?:1 on [A-Za-z0-9 ]+ · \d+(\.\d)?:1 on [A-Za-z0-9 ]+$/);
    expect(line?.line).not.toMatch(/Light|Dark/);
  });

  test('the accent is judged on the page: white in Light, "the dark page" in Dark (P8 C8)', () => {
    const line = contrastLine(model(), '--accent', {});
    expect(line?.ok).toBe(true);
    expect(line?.line).toMatch(/^\d+(\.\d)?:1 on white · \d+(\.\d)?:1 on the dark page$/);
  });

  test('a fill without a page of its own to sit on (a soft fill) keeps the pair it is judged in', () => {
    const line = contrastLine(model(), '--accent-fg', {});
    expect(line?.ok).toBe(true);
    expect(line?.line).not.toContain('the dark page');
  });

  test('the page itself is "the dark page" in Dark and "white" in Light when it is white', () => {
    // every surface is the page's own colour: the page (first in the rule) is the one named
    const page: [string, string] = ['#ffffff', 'oklch(0.2 0.01 250)'];
    const m = model({ '--bg-1': page, '--bg-2': page });
    const line = contrastLine(m, '--fg-1', {});
    expect(line?.ok).toBe(true);
    expect(line?.line).toContain(' on white');
    expect(line?.line).toContain('the dark page');
  });
});

describe('the fail line names two surfaces, in the mode being edited', () => {
  // a Text 2 that is far too light on every surface: it fails on all of Bg 0..2 in both modes
  const bad = model({ '--fg-1': ['#dddddd', '#444444'] });

  test('at most two surfaces, no "in Light and Dark"', () => {
    const line = contrastLine(bad, '--fg-1', {}, 'light');
    expect(line?.ok).toBe(false);
    expect(line?.line).toMatch(/^\d+(\.\d)?:1 on [^,]+ and [^,]+$/);
    expect(line?.line).not.toContain(' in ');
    expect(line?.line).not.toContain(',');
  });

  test('both modes fall short: the mode being edited leads, whichever is worse', () => {
    // Light is the worse mode (pale on white), Dark is bad too — the person is editing Dark
    const m = model({ '--fg-1': ['#eeeeee', '#555555'] });
    const dark = contrastLine(m, '--fg-1', {}, 'dark');
    expect(dark?.ok).toBe(false);
    expect(dark?.line).not.toContain(' in ');
    const light = contrastLine(m, '--fg-1', {}, 'light');
    expect(light?.line).not.toContain(' in ');
    // the two read differently: each names its own mode's surfaces and ratio
    expect(dark?.line).not.toBe(light?.line);
  });

  test('a fail in the OTHER mode says which', () => {
    // Light is fine, only Dark falls short; the person is editing Light
    const m = model({ '--fg-1': ['#202020', '#3a3a3a'] });
    const line = contrastLine(m, '--fg-1', {}, 'light');
    expect(line?.ok).toBe(false);
    expect(line?.line).toMatch(/ in Dark$/);
    // and editing Dark names nothing more
    expect(contrastLine(m, '--fg-1', {}, 'dark')?.line).not.toMatch(/ in (Dark|Light)$/);
  });

  test('without an editing mode the mode is always named (the old reading)', () => {
    const m = model({ '--fg-1': ['#202020', '#3a3a3a'] });
    expect(contrastLine(m, '--fg-1', {})?.line).toMatch(/ in Dark$/);
  });
});

describe('the role words', () => {
  test('text tokens say what they are text on; a quiet one says hints', () => {
    expect(roleWords('--fg-3')).toBe('Text on surfaces — hints');
    expect(roleWords('--fg-1')).toBe('Text on surfaces');
    expect(roleWords('--accent-fg')).toBe('Text on accent');
    expect(roleWords('--status-error-fg')).toBe('Text on error');
    expect(roleWords('--bg-2')).toBe('Surface');
    expect(roleWords('--accent')).toBe('Fill behind accent text');
    expect(roleWords('--status-error')).toBe('Fill behind error text');
    expect(roleWords('--palette-1')).toBeNull();
  });
});
