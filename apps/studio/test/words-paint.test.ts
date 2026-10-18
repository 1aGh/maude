// S2.4 — the words → CSS writer for Fill · Corners · Border · Effects · Type (edit-ops/words-paint.ts), as goldens both
// directions, the border position table (inside = inset box-shadow), the border/shadow composition, the elevation names
// coming from the system, the Mixed reducer, and the real `ds-check` S2 rule over everything the writer emits.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkCanvas } from '../ds/canvas-check.ts';
import { canvasContext } from '../ds/canvas-cli.ts';
import { loadProject } from '../ds/cli.ts';
import { applyPatch } from '../edit-ops/words-css.ts';
import {
  type BorderWords,
  borderFromCss,
  borderToCss,
  type CornerWords,
  colourFromCss,
  colourToCss,
  cornersFromCss,
  cornersLinked,
  cornersToCss,
  elevationFromCss,
  elevationOptions,
  elevationToCss,
  type FillWords,
  fillFromCss,
  fillToCss,
  imageUrlOk,
  isCssColor,
  isStrokeTag,
  opacityFromCss,
  opacityToCss,
  reduceMixed,
  strokeFromCss,
  strokeToCss,
  systemName,
  typeFromCss,
  typeToCss,
} from '../edit-ops/words-paint.ts';
import { conformantFiles } from './_ds-fixture.ts';

const apply = (patch: Record<string, string | null>, base: Record<string, string> = {}) =>
  applyPatch(base, patch);

describe('Fill — the words table (14 Editing: "Fill Ink → background: var(--ink)")', () => {
  test('a token fill is the plain background shorthand', () => {
    const f: FillWords = { color: { paint: { token: '--ink' }, opacity: 100 }, layers: [] };
    expect(fillToCss(f)).toEqual({
      background: 'var(--ink)',
      'background-color': null,
      'background-image': null,
    });
    expect(fillFromCss(apply(fillToCss(f)))).toEqual(f);
  });
  test('opacity below 100 is a colour-mix of the token, read back exactly', () => {
    const c = { paint: { token: '--ink' }, opacity: 40 };
    expect(colourToCss(c)).toBe('color-mix(in srgb, var(--ink) 40%, transparent)');
    expect(colourFromCss(colourToCss(c))).toEqual(c);
    expect(colourToCss({ paint: { token: '--ink' }, opacity: 100 })).toBe('var(--ink)');
  });
  test('a gradient and an image are layers over the colour, top first', () => {
    const f: FillWords = {
      color: { paint: { token: '--paper' }, opacity: 100 },
      layers: [
        { kind: 'gradient', css: 'linear-gradient(180deg, var(--a), var(--b))' },
        { kind: 'image', url: 'assets/hero.png' },
      ],
    };
    const patch = fillToCss(f);
    expect(patch['background-color']).toBe('var(--paper)');
    expect(patch['background-image']).toBe(
      'linear-gradient(180deg, var(--a), var(--b)), url("assets/hero.png")'
    );
    expect(patch.background).toBeNull();
    expect(patch['background-size']).toBe('cover');
    expect(fillFromCss(apply(patch))).toEqual(f);
  });
  test('removing the fill clears every spelling of it', () => {
    expect(fillToCss({ color: null, layers: [] })).toEqual({
      background: null,
      'background-color': null,
      'background-image': null,
    });
  });
  test('reads what a file authored by hand', () => {
    expect(fillFromCss({ background: 'var(--ink)' }).color?.paint).toEqual({ token: '--ink' });
    expect(fillFromCss({ background: '#fff' }).color?.paint).toEqual({ css: '#fff' });
    expect(fillFromCss({ background: 'red' }).color?.paint).toEqual({ css: 'red' });
    expect(fillFromCss({ background: 'none' })).toEqual({ color: null, layers: [] });
    const sh = fillFromCss({ background: 'url(a.png) center / cover no-repeat var(--paper)' });
    expect(sh.layers).toEqual([{ kind: 'image', url: 'a.png' }]);
    expect(sh.color?.paint).toEqual({ token: '--paper' });
    // a longhand replaces the shorthand's part
    expect(
      fillFromCss({ background: 'var(--ink)', 'background-color': 'var(--paper)' }).color?.paint
    ).toEqual({
      token: '--paper',
    });
  });
  test('an image source is a project path, https: or an inline image — never a script or a bare http:', () => {
    expect(imageUrlOk('assets/hero.png')).toBe(true);
    expect(imageUrlOk('https://cdn.example.com/a.png')).toBe(true);
    expect(imageUrlOk('data:image/png;base64,AAAA')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'http://example.com/a.png',
      '//example.com/a.png',
      'a.png") ; x: url("b',
      'a b.png',
      '',
    ])
      expect(imageUrlOk(bad)).toBe(false);
  });
  test('a typed custom colour must read as one CSS colour', () => {
    expect(isCssColor('#ff0')).toBe(true);
    expect(isCssColor('oklch(0.7 0.1 30)')).toBe(true);
    expect(isCssColor('red; background: url(x)')).toBe(false);
    expect(isCssColor('var(--ink)')).toBe(false);
  });
});

describe('Corners — one value, or each of ↖ ↗ ↘ ↙ (14 Editing: "Corners Round → border-radius: var(--radius-round)")', () => {
  const r = (n: string, px: number) => ({ token: `--radius-${n}`, px });
  const tokens = {
    space: [
      { name: '--radius-md', px: 10 },
      { name: '--radius-round', px: 16 },
    ],
  };
  test('linked: one value, and the four longhands are cleared', () => {
    const c: CornerWords = {
      tl: r('round', 16),
      tr: r('round', 16),
      br: r('round', 16),
      bl: r('round', 16),
    };
    const patch = cornersToCss(c);
    expect(patch['border-radius']).toBe('var(--radius-round)');
    expect(patch['border-top-left-radius']).toBeNull();
    expect(cornersFromCss(apply(patch), tokens)).toEqual(c);
    expect(cornersLinked(c)).toBe(true);
  });
  test('unlinked: four values in CSS order, round-trips (the ed-shape 40 40 8 40)', () => {
    const c: CornerWords = { tl: { px: 40 }, tr: { px: 40 }, br: { px: 8 }, bl: { px: 40 } };
    const patch = cornersToCss(c);
    expect(patch['border-radius']).toBe('40px 40px 8px 40px');
    expect(cornersFromCss(apply(patch))).toEqual(c);
    expect(cornersLinked(c)).toBe(false);
  });
  test('all zero removes the declaration', () => {
    const z = { px: 0 };
    expect(cornersToCss({ tl: z, tr: z, br: z, bl: z })['border-radius']).toBeNull();
  });
  test('reads shorthand of 1, 2, 3 and 4 values and a longhand over it', () => {
    expect(cornersFromCss({ 'border-radius': '4px 8px' })).toEqual({
      tl: { px: 4 },
      tr: { px: 8 },
      br: { px: 4 },
      bl: { px: 8 },
    });
    expect(cornersFromCss({ 'border-radius': '4px 8px 12px' }).bl).toEqual({ px: 8 });
    const c = cornersFromCss({ 'border-radius': '4px', 'border-bottom-left-radius': '8px' });
    expect(c.bl).toEqual({ px: 8 });
    expect(c.tl).toEqual({ px: 4 });
  });
  test('an elliptical radius is kept as written, not mangled', () => {
    expect(cornersFromCss({ 'border-radius': '10px / 20px' }).exotic).toBe('10px / 20px');
  });
});

describe('Border — position table (inside = inset box-shadow)', () => {
  const ink = { token: '--ink' };
  const b = (position: BorderWords['position'], extra: Partial<BorderWords> = {}): BorderWords => ({
    color: ink,
    width: 3,
    position,
    ...extra,
  });
  test('Inside is an inset ring, which never changes the object size', () => {
    const patch = borderToCss(b('inside'));
    expect(patch['box-shadow']).toBe('inset 0 0 0 3px var(--ink)');
    expect(patch.border).toBeNull();
    expect(patch.outline).toBeNull();
    expect(borderFromCss(apply(patch))).toEqual(b('inside'));
  });
  test('Centre is an outline pulled in by half the width', () => {
    const patch = borderToCss(b('centre'));
    expect(patch.outline).toBe('3px solid var(--ink)');
    expect(patch['outline-offset']).toBe('-1.5px');
    expect(patch['box-shadow']).toBeNull();
    expect(borderFromCss(apply(patch))).toEqual(b('centre'));
  });
  test('Outside is an outline on the edge', () => {
    const patch = borderToCss(b('outside'));
    expect(patch.outline).toBe('3px solid var(--ink)');
    expect(patch['outline-offset']).toBeNull();
    expect(borderFromCss(apply(patch))).toEqual(b('outside'));
  });
  test('a file that says `border` keeps saying it until the position changes (Border Ink 1.5)', () => {
    const read = borderFromCss({ border: '1.5px solid var(--ink)' });
    expect(read).toEqual({ color: ink, width: 1.5, position: 'inside', via: 'border' });
    expect(borderToCss(read)['border']).toBe('1.5px solid var(--ink)');
    // widen it: still a border
    expect(borderToCss({ ...(read as BorderWords), width: 2 })['border']).toBe(
      '2px solid var(--ink)'
    );
    // move it Outside: the border declaration goes, an outline arrives
    const moved = borderToCss({ ...(read as BorderWords), position: 'outside', via: undefined });
    expect(moved.border).toBeNull();
    expect(moved.outline).toBe('1.5px solid var(--ink)');
  });
  test('removing the border clears all three places and leaves the shadow alone', () => {
    const patch = borderToCss(null, 'inset 0 0 0 3px var(--ink), var(--shadow-sm)');
    expect(patch['box-shadow']).toBe('var(--shadow-sm)');
    expect(patch.border).toBeNull();
    expect(patch.outline).toBeNull();
    expect(borderToCss(null, 'inset 0 0 0 3px var(--ink)')['box-shadow']).toBeNull();
  });
  test('a border and an elevation share box-shadow without eating each other', () => {
    const ring = borderToCss(b('inside'), 'var(--shadow-md)');
    expect(ring['box-shadow']).toBe('inset 0 0 0 3px var(--ink), var(--shadow-md)');
    const lifted = elevationToCss({ token: '--shadow-lg' }, ring['box-shadow'] as string);
    expect(lifted['box-shadow']).toBe('inset 0 0 0 3px var(--ink), var(--shadow-lg)');
    const flat = elevationToCss('flat', lifted['box-shadow'] as string);
    expect(flat['box-shadow']).toBe('inset 0 0 0 3px var(--ink)');
    // the other way: Inside → Outside keeps the shadow
    const out = borderToCss(b('outside'), lifted['box-shadow'] as string);
    expect(out['box-shadow']).toBe('var(--shadow-lg)');
  });
  test('no border reads as null; dashed is kept', () => {
    expect(borderFromCss({})).toBeNull();
    expect(borderFromCss({ border: 'none' })).toBeNull();
    expect(borderFromCss({ border: '0' })).toBeNull();
    const dashed = borderFromCss({ border: '2px dashed var(--ink)' });
    expect(dashed?.style).toBe('dashed');
    expect(borderToCss(dashed)['border']).toBe('2px dashed var(--ink)');
  });
  test('Stroke on lines and paths: stroke + stroke-width', () => {
    expect(strokeToCss({ color: ink, width: 2 })).toEqual({
      stroke: 'var(--ink)',
      'stroke-width': '2px',
    });
    expect(strokeFromCss({ stroke: 'var(--ink)', 'stroke-width': '2px' })).toEqual({
      color: ink,
      width: 2,
    });
    expect(strokeFromCss({ stroke: 'none' })).toBeNull();
    expect(strokeToCss(null)).toEqual({ stroke: null, 'stroke-width': null });
    expect(isStrokeTag('PATH')).toBe(true);
    expect(isStrokeTag('div')).toBe(false);
  });
});

describe('Effects — elevation names come from the system', () => {
  test('Flat, then the system declares its own, in its own order (never a hardcoded list)', () => {
    expect(elevationOptions(['--shadow-resting', '--shadow-floating', '--shadow-sheet'])).toEqual([
      { value: 'flat', label: 'Flat' },
      { value: '--shadow-resting', label: 'Resting' },
      { value: '--shadow-floating', label: 'Floating' },
      { value: '--shadow-sheet', label: 'Sheet' },
    ]);
    // another system: sm / md / lg — not Resting/Floating/Sheet
    expect(
      elevationOptions(['--shadow-sm', '--shadow-md', '--shadow-lg']).map((o) => o.label)
    ).toEqual(['Flat', 'SM', 'MD', 'LG']);
    expect(elevationOptions([]).map((o) => o.label)).toEqual(['Flat']);
    expect(systemName('--radius-pill', 'radius')).toBe('Pill');
    expect(systemName('--radius-xl', 'radius')).toBe('XL');
  });
  test('Shadow Resting → box-shadow: var(--shadow-resting), and back', () => {
    const patch = elevationToCss({ token: '--shadow-resting' });
    expect(patch).toEqual({ 'box-shadow': 'var(--shadow-resting)' });
    expect(elevationFromCss(apply(patch))).toEqual({ token: '--shadow-resting' });
    expect(elevationFromCss({})).toBe('flat');
    expect(elevationFromCss({ 'box-shadow': 'none' })).toBe('flat');
    expect(elevationToCss('flat')).toEqual({ 'box-shadow': null });
  });
  test('a shadow the system does not name reads as the CSS it is', () => {
    expect(elevationFromCss({ 'box-shadow': '0 1px 2px rgba(0,0,0,.2)' })).toEqual({
      css: '0 1px 2px rgba(0,0,0,.2)',
    });
  });
  test('opacity is a percent in the panel and a 0–1 number in the file', () => {
    expect(opacityToCss(50)).toEqual({ opacity: '0.5' });
    expect(opacityToCss(100)).toEqual({ opacity: null });
    expect(opacityFromCss({ opacity: '0.5' })).toBe(50);
    expect(opacityFromCss({})).toBe(100);
    expect(opacityFromCss({ opacity: '0.333' })).toBe(33.3);
  });
});

describe('Type — the text inside', () => {
  test('size, weight and colour round-trip; weight words read as numbers', () => {
    const patch = typeToCss({
      size: { px: 14 },
      weight: 600,
      color: { paint: { token: '--paper' }, opacity: 100 },
    });
    expect(patch).toEqual({ 'font-size': '14px', 'font-weight': '600', color: 'var(--paper)' });
    const w = typeFromCss(apply(patch));
    expect(w.size).toEqual({ px: 14 });
    expect(w.weight).toBe(600);
    expect(w.color?.paint).toEqual({ token: '--paper' });
    expect(typeFromCss({ 'font-weight': 'bold' }).weight).toBe(700);
    expect(typeFromCss({}).weight).toBeNull();
  });
  test('only the groups given are touched', () => {
    expect(Object.keys(typeToCss({ weight: 500 }))).toEqual(['font-weight']);
    expect(typeToCss({ size: null })).toEqual({ 'font-size': null });
  });
});

describe('Mixed — what several objects share', () => {
  test('the same value is shown; a different one is Mixed, with the distinct values in first-seen order', () => {
    expect(reduceMixed([1, 1, 1])).toEqual({ mixed: false, value: 1 });
    expect(
      reduceMixed([
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ])
    ).toEqual({ mixed: false, value: { a: 1, b: 2 } });
    expect(reduceMixed(['white', 'yellow', 'white'])).toEqual({
      mixed: true,
      values: ['white', 'yellow'],
    });
    expect(reduceMixed([null, { token: '--ink' }])).toEqual({
      mixed: true,
      values: [null, { token: '--ink' }],
    });
  });
  test('fills reduce by their words, not their spelling', () => {
    const a = fillFromCss({ background: 'var(--ink)' });
    const b = fillFromCss({ 'background-color': 'var(--ink)' });
    expect(reduceMixed([a, b]).mixed).toBe(false);
    expect(reduceMixed([a, fillFromCss({ background: 'var(--paper)' })]).mixed).toBe(true);
  });
});

describe('no alias, no canvas-only name — the written CSS goes through the real ds-check S2 rule', () => {
  const root = mkdtempSync(join(tmpdir(), 'words-paint-'));
  const D = join(root, '.design');
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(D, rel)), { recursive: true });
    writeFileSync(join(D, rel), text);
  };
  for (const [rel, text] of Object.entries(conformantFiles())) put(rel, text);
  put(
    'config.json',
    JSON.stringify({
      designSystems: [
        {
          name: 'fx',
          path: 'system/fx',
          rootClass: 'fx',
          tokensCssRel: 'system/fx/colors_and_type.css',
          themes: ['light', 'dark'],
          themeDefault: 'light',
        },
      ],
      activeFamilies: ['accent', 'status', 'presence'],
      colorSpace: 'oklch',
    })
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const declared = (re: RegExp) => {
    const css = readFileSync(join(D, 'system/fx/colors_and_type.css'), 'utf8');
    return [...new Set([...css.matchAll(re)].map((m) => m[1]))];
  };
  const styleOf = (patch: Record<string, string | null>) =>
    Object.entries(patch)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `"${k}": "${v}"`)
      .join(', ');
  const s2 = (name: string, style: string) => {
    put(`ui/${name}.tsx`, `export default () => <div className="ds" style={{ ${style} }} />;\n`);
    put(`ui/${name}.meta.json`, JSON.stringify({ designSystem: 'fx' }));
    return checkCanvas(canvasContext(loadProject(root, {})), `ui/${name}.tsx`, {
      strict: false,
    }).findings.filter((f) => f.rule === 'S2');
  };

  test('fill, corners, border, elevation and type written with the system’s own names find nothing', () => {
    const colours = declared(/(--(?:bg|fg|accent)-[a-z0-9-]+)\s*:/g);
    const shadows = declared(/(--shadow-[a-z0-9-]+)\s*:/g);
    const radii = declared(/(--radius-[a-z0-9-]+)\s*:/g);
    expect(colours.length).toBeGreaterThan(1);
    expect(shadows.length).toBeGreaterThan(0);
    expect(radii.length).toBeGreaterThan(0);
    const patch = {
      ...fillToCss({ color: { paint: { token: colours[0] }, opacity: 100 }, layers: [] }),
      ...cornersToCss({
        tl: { token: radii[0], px: 4 },
        tr: { token: radii[0], px: 4 },
        br: { token: radii[0], px: 4 },
        bl: { token: radii[0], px: 4 },
      }),
      ...borderToCss({ color: { token: colours[1] }, width: 2, position: 'centre' }),
      ...elevationToCss({ token: shadows[0] }),
      ...typeToCss({ color: { paint: { token: colours[1] }, opacity: 100 } }),
    };
    const style = styleOf(patch);
    expect(style).toContain(`var(${colours[0]})`);
    expect(style).toContain(`var(${shadows[0]})`);
    expect(style).toContain(`var(${radii[0]})`);
    expect(s2('paint', style)).toEqual([]);
  });

  test('the check is live: an alias written into a fill IS an S2 finding', () => {
    const alias = '--accent-muted-not-declared';
    expect(
      s2(
        'alias',
        styleOf(fillToCss({ color: { paint: { token: alias }, opacity: 100 }, layers: [] }))
      ).length
    ).toBeGreaterThan(0);
  });

  test('a paint patch never carries a data-cd-* name', () => {
    const all = {
      ...fillToCss({ color: null, layers: [{ kind: 'image', url: 'a.png' }] }),
      ...borderToCss({ color: { token: '--x' }, width: 1, position: 'outside' }),
      ...elevationToCss({ token: '--shadow-sm' }),
    };
    expect(Object.keys(all).filter((k) => k.startsWith('data-cd-'))).toEqual([]);
  });
});
