// S10.7 (S10 Q10): the contrast pairs are a RULE over registry names, values resolve through var() and
// color-mix(), both themes are judged, and "Dark follows" keeps the old Light/Dark relation.
import { describe, expect, test } from 'bun:test';

import {
  allPairs,
  contrastMatrix,
  contrastOf,
  followDark,
  formatLike,
  judge,
  pairsOf,
  ratioWords,
  resolveColour,
} from '../ds/contrast.ts';

const none = () => undefined;
const hex = (v: string, look: (n: string) => string | undefined = none) => {
  const c = resolveColour(v, look);
  return c ? `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}` : null;
};

describe('resolveColour', () => {
  test('hex, rgb(), hsl(), oklch(), names', () => {
    expect(hex('#fff')).toBe('#ffffff');
    expect(hex('#1A2B3C')).toBe('#1a2b3c');
    expect(hex('rgb(10, 20, 30)')).toBe('#0a141e');
    expect(hex('rgb(10 20 30 / 50%)')).toBe('#0a141e');
    expect(hex('hsl(0 100% 50%)')).toBe('#ff0000');
    expect(hex('oklch(1 0 0)')).toBe('#ffffff');
    expect(hex('oklch(0 0 0)')).toBe('#000000');
    expect(hex('white')).toBe('#ffffff');
    expect(hex('transparent')).toBeNull();
    expect(hex('linear-gradient(red, blue)')).toBeNull();
    expect(hex('')).toBeNull();
  });

  test('var() follows aliases, takes the fallback, and ends on a cycle', () => {
    const vals: Record<string, string> = {
      '--a': 'var(--b)',
      '--b': '#102030',
      '--x': 'var(--y)',
      '--y': 'var(--x)',
    };
    const look = (n: string) => vals[n];
    expect(hex('var(--a)', look)).toBe('#102030');
    expect(hex('var(--missing, #ff0000)', look)).toBe('#ff0000');
    expect(hex('var(--missing)', look)).toBeNull();
    expect(hex('var(--x)', look)).toBeNull();
  });

  test('color-mix() in srgb, oklab and oklch', () => {
    expect(hex('color-mix(in srgb, #000 50%, #fff)')).toBe('#808080');
    expect(hex('color-mix(in srgb, #000, #fff)')).toBe('#808080');
    expect(hex('color-mix(in srgb, #000 25%, #fff)')).toBe('#bfbfbf');
    // one percentage: the other side is the rest
    expect(hex('color-mix(in srgb, #fff 75%, #000)')).toBe('#bfbfbf');
    const a = hex('color-mix(in oklch, #000 50%, #fff)');
    const b = hex('color-mix(in oklab, #000 50%, #fff)');
    expect(a).toBe(b); // greys have no hue to turn
    expect(hex('color-mix(in lab, #000, #fff)')).toBeNull();
    // a mix of tokens
    const look = (n: string) => ({ '--bg-0': '#ffffff', '--fg-0': '#000000' })[n];
    expect(hex('color-mix(in srgb, var(--fg-0) 50%, var(--bg-0))', look)).toBe('#808080');
  });
});

describe('the pairs rule (Q10)', () => {
  const known = new Set([
    '--bg-0',
    '--bg-1',
    '--bg-2',
    '--fg-0',
    '--fg-1',
    '--fg-2',
    '--fg-3',
    '--accent',
    '--accent-fg',
    '--accent-soft',
    '--accent-on-soft',
    '--accent-text',
    '--status-error',
    '--status-error-fg',
    '--status-error-soft',
    '--status-error-text',
  ]);
  const key = (p: { fg: string; bg: string }) => `${p.fg}>${p.bg}`;

  test('a surface is judged against every text colour on it, quiet text at 3:1', () => {
    const ps = pairsOf('--bg-2', known);
    expect(ps.map(key).sort()).toEqual(
      ['--fg-0>--bg-2', '--fg-1>--bg-2', '--fg-2>--bg-2', '--fg-3>--bg-2'].sort()
    );
    expect(ps.find((p) => p.fg === '--fg-3')?.need).toBe(3);
    expect(ps.find((p) => p.fg === '--fg-0')?.need).toBe(4.5);
  });

  test('accent and status pairs', () => {
    expect(pairsOf('--accent', known).map(key)).toEqual(['--accent-fg>--accent']);
    expect(pairsOf('--accent-fg', known).map(key)).toEqual(['--accent-fg>--accent']);
    expect(pairsOf('--accent-text', known).map(key).sort()).toEqual(
      ['--accent-text>--bg-0', '--accent-text>--bg-1'].sort()
    );
    expect(pairsOf('--status-error-text', known).map(key).sort()).toEqual(
      ['--status-error-text>--bg-0', '--status-error-text>--status-error-soft'].sort()
    );
    expect(pairsOf('--status-error', known).map(key)).toEqual(['--status-error-fg>--status-error']);
  });

  test('a name the system does not declare takes no part; an unrelated token has no pair', () => {
    expect(pairsOf('--bg-3', known)).toEqual([]);
    expect(pairsOf('--radius-md', known)).toEqual([]);
    expect(allPairs().length).toBeGreaterThan(allPairs(known).length);
  });
});

describe('judging a pair, both themes', () => {
  test('#767676 on white is the last grey that clears 4.5:1; #777 does not', () => {
    const p = { fg: '--fg-0', bg: '--bg-0', need: 4.5 };
    const ok = judge(p, { '--fg-0': '#767676', '--bg-0': '#ffffff' });
    expect(ok.pass).toBe(true);
    const no = judge(p, { '--fg-0': '#777777', '--bg-0': '#ffffff' });
    expect(no.pass).toBe(false);
    expect(ratioWords(no.ratio as number)).toBe('4.4:1');
    expect(ratioWords(21)).toBe('21:1');
  });

  test('a value that is not one colour is "unknown", never a failure', () => {
    const r = judge(
      { fg: '--fg-0', bg: '--bg-0', need: 4.5 },
      { '--fg-0': '#000', '--bg-0': 'linear-gradient(#fff, #eee)' }
    );
    expect(r.ratio).toBeNull();
    expect(r.pass).toBeNull();
  });

  test('the same token passes in Light and fails in Dark', () => {
    const light = { '--fg-1': '#222222', '--bg-0': '#ffffff', '--bg-1': '#f5f5f5' };
    const dark = { '--fg-1': '#222222', '--bg-0': '#111111', '--bg-1': '#1a1a1a' };
    expect(contrastOf('--fg-1', light).every((r) => r.pass === true)).toBe(true);
    expect(contrastOf('--fg-1', dark).every((r) => r.pass === false)).toBe(true);
    expect(contrastMatrix(light).length).toBe(2);
  });

  test('var() and color-mix() values are judged', () => {
    const v = {
      '--bg-0': 'var(--paper)',
      '--paper': '#ffffff',
      '--fg-3': 'color-mix(in srgb, #000 60%, var(--paper))',
    };
    const r = contrastOf('--fg-3', v);
    expect(r).toHaveLength(1);
    expect(r[0].need).toBe(3);
    expect(r[0].pass).toBe(true); // 60% black on white is ~7:1
  });
});

describe('Dark follows', () => {
  const parse = (s: string | null) => {
    const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(s ?? '');
    return m ? { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : null;
  };

  test('the new pair keeps the old pair’s lightness gap, chroma ratio and hue', () => {
    const d = parse(
      followDark(
        { light: 'oklch(0.50 0.190 255)', dark: 'oklch(0.60 0.175 255)' },
        'oklch(0.44 0.190 255)'
      )
    );
    expect(d).not.toBeNull();
    expect(Math.abs((d?.l ?? 0) - 0.54)).toBeLessThan(0.02);
    expect(Math.abs((d?.c ?? 0) - 0.175)).toBeLessThan(0.02);
    expect(Math.abs((d?.h ?? 0) - 255)).toBeLessThan(6);
  });

  test('a new hue carries over to Dark', () => {
    const d = parse(
      followDark(
        { light: 'oklch(0.50 0.190 255)', dark: 'oklch(0.60 0.175 255)' },
        'oklch(0.50 0.120 30)'
      )
    );
    expect(Math.abs((d?.h ?? 0) - 30)).toBeLessThan(6);
  });

  test('no Dark yet: a colour is lifted a step, a neutral is mirrored', () => {
    const lifted = parse(followDark({ light: 'oklch(0.50 0.190 255)' }, 'oklch(0.50 0.190 255)'));
    expect(Math.abs((lifted?.l ?? 0) - 0.6)).toBeLessThan(0.02);
    const mirrored = parse(followDark({ light: 'oklch(0.98 0 0)' }, 'oklch(0.98 0 0)'));
    expect(mirrored?.l ?? 1).toBeLessThan(0.1);
  });

  test('it is written the way the file writes colours', () => {
    expect(followDark({ light: '#336699', dark: '#6699cc' }, '#224466')).toMatch(/^#[0-9a-f]{6}$/);
    expect(
      followDark({ light: 'oklch(0.5 0.19 255)', dark: 'oklch(0.6 0.17 255)' }, '#224466')
    ).toMatch(/^oklch\(/);
    expect(formatLike({ r: 255, g: 0, b: 0 }, 'oklch(0.5 0.2 30)')).toMatch(/^oklch\(/);
    expect(formatLike({ r: 255, g: 0, b: 0 }, '#123456')).toBe('#ff0000');
  });

  test('a Light that is not a plain colour leaves Dark alone (null)', () => {
    expect(followDark({ light: '#fff', dark: '#000' }, 'linear-gradient(red, blue)')).toBeNull();
  });
});
