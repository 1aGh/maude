// `describeChanges` — TSX lane (V2-1.9 §5.5, S1.9). Three layers:
//   1. frozen edge cases on a fixture canvas, exact words (V2-1.9 §7 H2);
//   2. the lane interface S1.10 builds on (models, extra lanes, class index);
//   3. the C3 corpus: one known edit at a time on the real v2 canvases, ground truth exact (H1) —
//      ≥ 96 % words right, wrong artboard 0, canvas-wide fallback ≤ 1 %.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  artboardLabel,
  type Change,
  describeChanges,
  type LaneDescriber,
  parseModel,
} from '../history/describe';
import { CASES } from './fixtures/describe-corpus/cases';
import { EDIT_KINDS, listCanvases, measure } from './fixtures/describe-corpus/measure';

const dir = join(import.meta.dir, 'fixtures', 'describe-corpus');
const base = readFileSync(join(dir, 'canvas.tsx'), 'utf8');

function edit(pairs: Array<[string, string]>, from = base): string {
  let out = from;
  for (const [a, b] of pairs) {
    if (!out.includes(a)) throw new Error(`fixture edit does not apply: ${a.slice(0, 50)}`);
    out = out.replace(a, b);
  }
  return out;
}

const lines = (cs: Change[]) => cs.map((c) => [c.kind, c.grade, c.artboards, c.words]);

describe('describe TSX lane — fixture cases', () => {
  for (const c of CASES) {
    test(c.name, () => {
      const r = describeChanges('fixture.tsx', { tsx: base }, { tsx: edit(c.edit) });
      expect(lines(r.changes)).toEqual(c.expect);
    });
  }

  test('identical source is no change, whatever the model', () => {
    expect(describeChanges('f.tsx', { tsx: base }, { tsx: base }).changes).toEqual([]);
    expect(
      describeChanges('f.tsx', { tsx: 'export default (' }, { tsx: 'export default (' }).changes
    ).toEqual([]);
  });

  test('an unparseable side is the one fallback, never a throw', () => {
    const broken = base.replace('</DesignCanvas>', '');
    const r = describeChanges('f.tsx', { tsx: base }, { tsx: broken });
    expect(lines(r.changes)).toEqual([['canvas', 'F', [], 'Changed this canvas']]);
    expect(lines(describeChanges('f.tsx', { tsx: broken }, { tsx: base }).changes)).toEqual([
      ['canvas', 'F', [], 'Changed this canvas'],
    ]);
  });

  test('a design-system import switch reads as one sentence', () => {
    const a =
      "import { Btn } from '../system/alligators/preview/btn';\nexport default function C() { return <DesignCanvas />; }";
    const b = a.replace('alligators', 'studyfi-v3');
    const r = describeChanges('f.tsx', { tsx: a }, { tsx: b });
    expect(lines(r.changes)).toEqual([
      ['imports', 'W1', [], 'Now uses the studyfi v3 design system'],
    ]);
  });

  test('a token resolves to its display name through the options', () => {
    const a =
      'export default function C() { return <DesignCanvas><DCArtboard id="x" label="X" width={1} height={1}><div style={{ background: "var(--bg-1)" }} /></DCArtboard></DesignCanvas>; }';
    const b = a.replace('--bg-1', '--bg-2');
    const plain = describeChanges('f.tsx', { tsx: a }, { tsx: b });
    expect(plain.changes[0]?.words).toBe('Frame: Fill bg 1 → bg 2');
    const named = describeChanges(
      'f.tsx',
      { tsx: a },
      { tsx: b },
      { tokenName: (n) => ({ '--bg-1': 'Surface', '--bg-2': 'Raised' })[n] }
    );
    expect(named.changes[0]?.words).toBe('Frame: Fill Surface → Raised');
  });

  test('deleting one of several identical siblings lines the survivors up by position', () => {
    // Without position anchors the leftover separators pair first-to-first and every distinct row
    // between them reads as "moved" (found on 07 Video Editing, 2026-10-18).
    const row = (n: string) => `<p className="r">${n}</p>`;
    const sep = '<hr className="sep" />';
    const board = (items: string[]) =>
      `export default function C() { return <DesignCanvas><DCArtboard id="a" label="A" width={1} height={1}><div>${items.join('')}</div></DCArtboard></DesignCanvas>; }`;
    const full = [row('A'), sep, row('B'), sep, row('C'), sep, row('D'), sep];
    const without = [row('A'), sep, row('B'), row('C'), sep, row('D'), sep];
    const r = describeChanges('f.tsx', { tsx: board(full) }, { tsx: board(without) });
    expect(lines(r.changes)).toEqual([['removed', 'W1', ['a'], 'Divider removed']]);
  });
});

describe('describe TSX lane — the lane interface S1.10 builds on', () => {
  test('extra lanes run after the TSX lane with both parsed models, once', () => {
    let seen: { before: boolean; after: boolean; canvas: string } | null = null;
    const lane: LaneDescriber = (ctx) => {
      seen = { before: !!ctx.modelBefore, after: !!ctx.modelAfter, canvas: ctx.canvas };
      return [
        { artboards: ['home'], grade: 'W1', kind: 'css', words: 'Changed the style of Homepage' },
      ];
    };
    const r = describeChanges(
      'fixture.tsx',
      { tsx: base },
      { tsx: edit([['padding: 24', 'padding: 32']]) },
      { lanes: [lane] }
    );
    expect(seen).toEqual({ before: true, after: true, canvas: 'fixture.tsx' });
    expect(r.changes.map((c) => c.kind)).toEqual(['style', 'css']);
  });

  test('the class index names elements, class tokens, prefixes and the artboards they render in', () => {
    const m = parseModel(base);
    expect(m).not.toBeNull();
    const els = (m as NonNullable<typeof m>).classElements();
    const prefix = els.find((e) => e.classes.some((c) => c.token === 'sb-role--' && c.prefix));
    expect(prefix?.artboards).toEqual(['pricing']);
    const jersey = els.find((e) => e.classes.some((c) => c.token === 'fx-jersey'));
    expect(jersey?.artboards.sort()).toEqual(['home', 'pricing']);
    expect(jersey?.name).toBe('Frame');
    const btn = els.find((e) => e.classes.some((c) => c.token === 'fx-btn--primary'));
    expect(btn?.artboards).toEqual(['home']);
    expect(artboardLabel(m as NonNullable<typeof m>, 'disc-*')).toBe('Disc');
    expect(artboardLabel(m as NonNullable<typeof m>, 'home')).toBe('Homepage');
  });
});

describe('describe TSX lane — corpus accuracy (C3, real v2 canvases)', () => {
  const root = join(import.meta.dir, '..', '..', '..', '.design');
  const files = listCanvases(root, true);

  test('words right ≥ 96 %, wrong artboard 0, canvas-wide fallback ≤ 1 %', () => {
    expect(files.length).toBeGreaterThan(10);
    const r = measure(files, 3);
    const pct = (r.all.right / r.all.n) * 100;
    if (pct < 96 || r.all.wrongArtboard > 0) console.log(r.misses.slice(0, 20));
    expect(r.all.n).toBeGreaterThan(300);
    expect(pct).toBeGreaterThanOrEqual(96);
    expect(r.all.wrongArtboard).toBe(0);
    expect(r.all.fallback / r.all.n).toBeLessThanOrEqual(0.01);
    // every kind is exercised and none is below the bar on its own
    for (const k of EDIT_KINDS) {
      const row = r.byKind[k];
      expect(row?.n ?? 0).toBeGreaterThan(20);
      expect((row?.right ?? 0) / (row?.n ?? 1)).toBeGreaterThanOrEqual(0.9);
    }
  }, 120_000);
});
