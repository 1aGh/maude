// S2.3 — the words → CSS writer (edit-ops/words-css.ts). The table of 14 Editing's "The words, and what they write"
// as goldens, both directions: toWords(applyPatch({}, toCss(x))) deep-equals x. Bind picks the nearest stop. And no
// alias name is ever emitted — the written CSS is run through the real `ds-check` S2 rule.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkCanvas } from '../ds/canvas-check.ts';
import { canvasContext } from '../ds/canvas-cli.ts';
import { loadProject } from '../ds/cli.ts';
import {
  applyPatch,
  axisToCss,
  type Ctx,
  type DsTokens,
  diffPatch,
  type LayoutWords,
  lengthFromCss,
  lengthToCss,
  nearestSpace,
  type PositionWords,
  paddingFromCss,
  rotationOf,
  type SizeWords,
  toCss,
  tokenLabel,
  toWords,
  withRotation,
} from '../edit-ops/words-css.ts';
import { conformantFiles } from './_ds-fixture.ts';

// the maude-v2 ladder: --space-0 … --space-8 = 0 4 8 12 16 24 32 48 64
const LADDER = [0, 4, 8, 12, 16, 24, 32, 48, 64];
const tokens: DsTokens = { space: LADDER.map((px, i) => ({ name: `--space-${i}`, px })) };
const sp = (px: number) => {
  const s = tokens.space?.find((t) => t.px === px);
  if (!s) throw new Error(`no stop ${px}`);
  return { token: s.name, px: s.px };
};
const flexRow = { display: 'flex', flexDirection: 'row' };
const flexCol = { display: 'flex', flexDirection: 'column' };
const block = { display: 'block' };

const css = (words: Parameters<typeof toCss>[0], ctx: Ctx = {}) =>
  applyPatch({}, toCss(words, ctx));
const zeroPad = { top: { px: 0 }, right: { px: 0 }, bottom: { px: 0 }, left: { px: 0 } };
const layout = (over: Partial<LayoutWords> = {}): LayoutWords => ({
  direction: 'row',
  gap: null,
  spacing: 'packed',
  padding: zeroPad,
  align: { h: 'start', v: 'stretch' },
  ...over,
});

describe('the words table (14 Editing › ed-inspector), word → CSS', () => {
  const size = (
    w: SizeWords['width'],
    h: SizeWords['height'] = { mode: 'fixed', px: null }
  ): SizeWords => ({
    width: w,
    height: h,
    clip: false,
  });
  test('Hug → width: fit-content', () => {
    expect(css({ size: size({ mode: 'hug' }) }, { parent: block }).width).toBe('fit-content');
  });
  test('Fill → flex: 1 on the parent’s main axis', () => {
    const out = css({ size: size({ mode: 'fill' }) }, { parent: flexRow });
    expect(out.flex).toBe('1');
    expect(out.width).toBeUndefined();
  });
  test('Fill across the parent → align-self: stretch; in a block → 100 %', () => {
    expect(
      css({ size: size({ mode: 'fixed', px: 10 }, { mode: 'fill' }) }, { parent: flexRow })[
        'align-self'
      ]
    ).toBe('stretch');
    expect(css({ size: size({ mode: 'fill' }) }, { parent: block }).width).toBe('100%');
  });
  test('Fixed 148 → width: 148px', () => {
    expect(css({ size: size({ mode: 'fixed', px: 148 }) }, { parent: block }).width).toBe('148px');
  });
  test('Clip content → overflow: hidden (off removes it)', () => {
    expect(css({ size: { ...size({ mode: 'hug' }), clip: true } }).overflow).toBe('hidden');
    expect(toCss({ size: size({ mode: 'hug' }) }).overflow).toBeNull();
  });
  test('Gap Space 8 → gap: var(--space-2); a plain number stays a number', () => {
    expect(css({ layout: layout({ gap: sp(8) }) }).gap).toBe('var(--space-2)');
    expect(css({ layout: layout({ gap: { px: 10 } }) }).gap).toBe('10px');
  });
  test('Spacing Space between → justify-content: space-between; Packed removes it', () => {
    expect(css({ layout: layout({ spacing: 'between' }) })['justify-content']).toBe(
      'space-between'
    );
    expect(toCss({ layout: layout() })['justify-content']).toBeNull();
  });
  test('Padding H 24 · V 10 → padding: 10px var(--space-5)', () => {
    const v = { px: 10 };
    const h = sp(24);
    expect(
      css({ layout: layout({ padding: { top: v, right: h, bottom: v, left: h } }) }).padding
    ).toBe('10px var(--space-5)');
  });
  test('Padding per side → the four-value shorthand, shortest form first', () => {
    const pad = (t: number, r: number, b: number, l: number) => ({
      top: { px: t },
      right: { px: r },
      bottom: { px: b },
      left: { px: l },
    });
    expect(css({ layout: layout({ padding: pad(8, 8, 8, 8) }) }).padding).toBe('8px');
    expect(css({ layout: layout({ padding: pad(1, 2, 3, 4) }) }).padding).toBe('1px 2px 3px 4px');
    expect(css({ layout: layout({ padding: pad(1, 2, 3, 2) }) }).padding).toBe('1px 2px 3px');
    // nothing is written for a zero box, and a stale longhand is removed
    const zero = toCss({ layout: layout() });
    expect(zero.padding).toBeNull();
    expect(zero['padding-left']).toBeNull();
  });
  test('Constraints Right · Top → right: 72px; top: 22px', () => {
    const g = { x: 1220, y: 22, w: 148, h: 44, parentW: 1440, parentH: 600 };
    const out = css(
      { position: { x: null, y: null, rotation: 0, constraints: { h: 'right', v: 'top' } } },
      { geometry: g }
    );
    expect(out.right).toBe('72px');
    expect(out.top).toBe('22px');
    expect(out.left).toBeUndefined();
    expect(out.bottom).toBeUndefined();
  });
  test('Direction: Row · Column · Grid · Free (inline kept)', () => {
    expect(css({ layout: layout({ direction: 'row' }) }).display).toBe('flex');
    expect(css({ layout: layout({ direction: 'column' }) })['flex-direction']).toBe('column');
    expect(css({ layout: layout({ direction: 'grid' }) }).display).toBe('grid');
    expect(css({ layout: layout({ direction: 'free' }) }).display).toBe('block');
    expect(css({ layout: layout({ direction: 'row' }) }, { inline: true }).display).toBe(
      'inline-flex'
    );
  });
  test('Align 3×3 → justify-content / align-items on the right axes for the direction', () => {
    const a = { h: 'end', v: 'center' } as const;
    const row = css({ layout: layout({ direction: 'row', align: a }) });
    expect(row['justify-content']).toBe('flex-end');
    expect(row['align-items']).toBe('center');
    const col = css({ layout: layout({ direction: 'column', align: a }) });
    expect(col['justify-content']).toBe('center');
    expect(col['align-items']).toBe('flex-end');
  });
  test('Rotation keeps the rest of the transform', () => {
    expect(withRotation('translateX(4px)', 15)).toBe('translateX(4px) rotate(15deg)');
    expect(withRotation('translateX(4px) rotate(15deg)', 0)).toBe('translateX(4px)');
    expect(withRotation('rotate(15deg)', 0)).toBeNull();
    expect(rotationOf('rotate(0.25turn)')).toBe(90);
  });
});

describe('and back: toWords(toCss(x)) == x', () => {
  const sizes: SizeWords[] = [
    { width: { mode: 'hug' }, height: { mode: 'hug' }, clip: false },
    { width: { mode: 'fixed', px: 148 }, height: { mode: 'fixed', px: 44 }, clip: true },
    { width: { mode: 'fill' }, height: { mode: 'fixed', px: 20 }, clip: false },
    { width: { mode: 'fixed', px: 148 }, height: { mode: 'fill' }, clip: false },
  ];
  for (const parent of [flexRow, flexCol, block]) {
    sizes.forEach((s, i) => {
      test(`size #${i} in a ${parent.display} ${parent.display === 'flex' ? parent.flexDirection : ''}`, () => {
        const out = toWords(css({ size: s }, { parent }), { parent, tokens }).size;
        expect(out).toEqual(s);
      });
    });
  }
  test('Fill → Fixed leaves no fill declaration behind', () => {
    const filled = css({ size: sizes[2] }, { parent: flexRow });
    const next = applyPatch(filled, toCss({ size: sizes[1] }, { parent: flexRow }));
    expect(next.flex).toBeUndefined();
    expect(next['align-self']).toBeUndefined();
    expect(toWords(next, { parent: flexRow }).size).toEqual(sizes[1]);
  });

  const layouts: LayoutWords[] = [
    layout(),
    layout({ gap: sp(8), spacing: 'between', align: { h: 'start', v: 'center' } }),
    layout({
      direction: 'column',
      gap: { px: 10 },
      align: { h: 'center', v: 'end' },
      padding: { top: { px: 10 }, right: sp(24), bottom: { px: 10 }, left: sp(24) },
    }),
    layout({ direction: 'column', spacing: 'between', align: { h: 'end', v: 'start' } }),
    layout({ direction: 'grid', gap: sp(16), align: null }),
    layout({
      direction: 'free',
      align: null,
      padding: { top: sp(4), right: sp(8), bottom: sp(12), left: sp(16) },
    }),
  ];
  layouts.forEach((l, i) => {
    test(`layout #${i} (${l.direction}, ${l.spacing})`, () => {
      expect(toWords(css({ layout: l }), { tokens }).layout).toEqual(l);
    });
  });
  test('an inline-flex frame stays inline-flex through a direction change', () => {
    const out = css({ layout: layout({ direction: 'column' }) }, { inline: true });
    expect(out.display).toBe('inline-flex');
    expect(toWords(out).layout.direction).toBe('column');
  });

  const g = { x: 1220, y: 22, w: 148, h: 44, parentW: 1440, parentH: 600 };
  const pins: PositionWords['constraints'][] = [
    { h: 'left', v: 'top' },
    { h: 'right', v: 'top' },
    { h: 'right', v: 'bottom' },
    { h: 'both', v: 'both' },
    { h: 'center', v: 'center' },
    { h: 'scale', v: 'scale' },
  ];
  pins.forEach((c) => {
    test(`constraints ${c?.h} · ${c?.v}`, () => {
      const p: PositionWords = { x: g.x, y: g.y, rotation: 30, constraints: c };
      const out = css({ position: p }, { geometry: g });
      expect(toWords(out, { geometry: g }).position).toEqual(p);
      expect(toWords(out).position.constraints).toEqual(c);
    });
  });
  test('without a measured geometry, X and Y read from left and top', () => {
    const out = css({ position: { x: 40, y: 12, rotation: 0, constraints: null } });
    expect(out.left).toBe('40px');
    expect(toWords(out).position).toEqual({
      x: 40,
      y: 12,
      rotation: 0,
      constraints: { h: 'left', v: 'top' },
    });
  });
  test('padding read-back honours 1–4 values and a longhand over the shorthand', () => {
    expect(paddingFromCss({ padding: '10px var(--space-5)' }, tokens)).toEqual({
      top: { px: 10 },
      right: sp(24),
      bottom: { px: 10 },
      left: sp(24),
    });
    expect(paddingFromCss({ padding: '8px', 'padding-left': '16px' }).left).toEqual({ px: 16 });
  });
  test('a length the words cannot say survives as CSS', () => {
    expect(lengthFromCss('calc(var(--space-2) * 2)')).toEqual({ css: 'calc(var(--space-2) * 2)' });
    expect(lengthToCss(lengthFromCss('50%'))).toBe('50%');
  });
});

describe('Bind', () => {
  test('picks the nearest stop of the ladder; a tie goes to the smaller', () => {
    expect(nearestSpace(10, tokens)?.name).toBe('--space-2'); // 8 (|2|) beats 12 (|2|) — tie, the smaller
    expect(nearestSpace(11, tokens)?.name).toBe('--space-3'); // 12
    expect(nearestSpace(26, tokens)?.name).toBe('--space-5'); // 24
    expect(nearestSpace(200, tokens)?.name).toBe('--space-8');
    expect(nearestSpace(0, tokens)?.name).toBe('--space-0');
    expect(nearestSpace(10, { space: [] })).toBeNull();
    expect(nearestSpace(10, undefined)).toBeNull();
  });
  test('the chip reads by size: Space 24', () => {
    expect(tokenLabel('--space-5', 24)).toBe('Space 24');
    expect(tokenLabel('--radius-pill')).toBe('Radius pill');
  });
});

describe('only what changes is written', () => {
  test('diffPatch drops a value already there and a removal of nothing', () => {
    const cur = { width: '148px', overflow: 'hidden' };
    expect(diffPatch(cur, { width: '148px', overflow: null, flex: null, height: '44px' })).toEqual({
      overflow: null,
      height: '44px',
    });
  });
  test('Hug on a flex child clears only the fill declarations of that axis', () => {
    const out = axisToCss('width', { mode: 'hug' }, flexRow);
    expect(Object.keys(out).sort()).toEqual(['flex', 'flex-basis', 'flex-grow', 'width']);
    expect(Object.keys(axisToCss('height', { mode: 'hug' }, flexRow)).sort()).toEqual([
      'align-self',
      'height',
    ]);
  });
});

describe('no alias, no canvas-only name', () => {
  const root = mkdtempSync(join(tmpdir(), 'words-css-'));
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
          themes: ['light', 'dark'],
          themeDefault: 'light',
        },
      ],
      activeFamilies: ['accent', 'status', 'presence'],
      colorSpace: 'oklch',
    })
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('every token the writer emits is one the system declares (ds-check S2 finds nothing)', () => {
    // the fixture system's own space ladder, read from its tokens CSS
    const cssText = readFileSync(join(D, 'system/fx/colors_and_type.css'), 'utf8');
    const stops = [...cssText.matchAll(/--space-(\d+):\s*([\d.]+)px/g)].map((m) => ({
      name: `--space-${m[1]}`,
      px: Number(m[2]),
    }));
    expect(stops.length).toBeGreaterThan(3);
    const t: DsTokens = { space: stops };
    const pick = (i: number) => ({ token: stops[i].name, px: stops[i].px });
    const patch = {
      ...toCss(
        {
          layout: layout({
            gap: pick(2),
            padding: { top: { px: 10 }, right: pick(3), bottom: { px: 10 }, left: pick(3) },
          }),
        },
        { tokens: t }
      ),
    };
    const style = Object.entries(patch)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `"${k}": "${v}"`)
      .join(', ');
    expect(style).toContain('var(--space-');
    put('ui/words.tsx', `export default () => <div className="ds" style={{ ${style} }} />;\n`);
    put('ui/words.meta.json', JSON.stringify({ designSystem: 'fx' }));
    const report = checkCanvas(canvasContext(loadProject(root, {})), 'ui/words.tsx', {
      strict: false,
    });
    expect(report.findings.filter((f) => f.rule === 'S2')).toEqual([]);
  });

  test('the writer would be caught: an alias in the output IS an S2 finding (the check is live)', () => {
    put(
      'ui/alias.tsx',
      'export default () => <div className="ds" style={{ gap: "var(--radius-full)" }} />;\n'
    );
    put('ui/alias.meta.json', JSON.stringify({ designSystem: 'fx' }));
    const report = checkCanvas(canvasContext(loadProject(root, {})), 'ui/alias.tsx', {
      strict: false,
    });
    expect(report.findings.some((f) => f.rule === 'S2')).toBe(true);
  });

  test('a words patch never carries a data-cd-* name', () => {
    const all = toCss(
      {
        size: { width: { mode: 'fill' }, height: { mode: 'hug' }, clip: true },
        layout: layout({ gap: sp(8) }),
        position: { x: 1, y: 2, rotation: 5, constraints: { h: 'left', v: 'top' } },
      },
      {
        parent: flexRow,
        tokens,
        geometry: { x: 1, y: 2, w: 10, h: 10, parentW: 100, parentH: 100 },
      }
    );
    expect(Object.keys(all).filter((k) => k.startsWith('data-cd-'))).toEqual([]);
  });
});
