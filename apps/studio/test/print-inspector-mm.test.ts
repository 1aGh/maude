// S7.23 — the print inspector speaks paper: sizes in millimetres, one write for the prop AND the px size, the size on
// paper as one exported function (S9 reads it). Pure functions + the dispatcher; the real inspector is in
// v2-inspector-print.test.tsx.

import { describe, expect, test } from 'bun:test';

import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { artboardPhysicalSize, physicalSizeWords } from '../kinds/physical.ts';
import { nextPrint, uniformMarginMm } from '../kinds/print-edit.ts';
import { resolveMmPx } from '../print/units.ts';

describe('artboardPhysicalSize (kinds/physical.ts — what S9 reads)', () => {
  test('an A6 print artboard is 105 × 148 mm — the trim, not the bleed box', () => {
    expect(artboardPhysicalSize({ kind: 'print', print: { paper: 'a6', bleedMm: 3 } })).toEqual({
      wMm: 105,
      hMm: 148,
    });
  });
  test('landscape swaps the two numbers', () => {
    expect(
      artboardPhysicalSize({ kind: 'print', print: { paper: 'a4', orientation: 'landscape' } })
    ).toEqual({ wMm: 297, hMm: 210 });
  });
  test('a custom size wins over the paper it sits in', () => {
    expect(
      artboardPhysicalSize({
        kind: 'print',
        print: { paper: 'a5', orientation: 'portrait', sizeMm: [99, 210], bleedMm: 3 },
      })
    ).toEqual({ wMm: 99, hMm: 210 });
  });
  test('the selection read-back works too (data-dc-kind + data-dc-print)', () => {
    expect(
      artboardPhysicalSize({
        attrs: { 'data-dc-kind': 'print', 'data-dc-print': JSON.stringify({ paper: 'a6' }) },
      })
    ).toEqual({ wMm: 105, hMm: 148 });
  });
  test('a web page, a fixed size and a video have no paper size', () => {
    for (const kind of ['web', 'digital', 'video', undefined])
      expect(artboardPhysicalSize({ kind, print: { paper: 'a6' } })).toBeNull();
  });
  test('an unknown paper or a malformed prop is no size, never a throw', () => {
    expect(artboardPhysicalSize({ kind: 'print', print: { paper: 'a99' } })).toBeNull();
    expect(artboardPhysicalSize({ kind: 'print', print: 'not json' })).toBeNull();
    expect(artboardPhysicalSize({ kind: 'print' })).toBeNull();
    expect(artboardPhysicalSize(null)).toBeNull();
  });
  test('the words: millimetres for ISO and custom, inches for a US paper', () => {
    expect(physicalSizeWords({ kind: 'print', print: { paper: 'a6' } })).toBe('105 × 148 mm');
    expect(physicalSizeWords({ kind: 'print', print: { paper: 'letter' } })).toBe('8.5 × 11 in');
    expect(physicalSizeWords({ kind: 'print', print: { paper: 'a5', sizeMm: [99, 210] } })).toBe(
      '99 × 210 mm'
    );
    expect(physicalSizeWords({ kind: 'web' })).toBe('');
  });
});

describe('nextPrint — the prop and the px size agree (px = trim + 2 × bleed)', () => {
  const A6 = { paper: 'a6', orientation: 'portrait', bleedMm: 3 };
  test('A6 with 3 mm bleed is 419 × 581 px (08 ak-advanced)', () => {
    const r = nextPrint(A6, {});
    expect([r.widthPx, r.heightPx]).toEqual([419, 581]);
  });
  test('bleed moves the artboard: 0 mm is the bare trim, 5 mm is bigger', () => {
    expect(nextPrint(A6, { bleedMm: 0 })).toMatchObject({ widthPx: 397, heightPx: 559 });
    const five = nextPrint(A6, { bleedMm: 5 });
    expect(five.widthPx).toBeGreaterThan(419);
    expect(five.print.bleedMm).toBe(5);
  });
  test('a paper change keeps the bleed and clears a custom size', () => {
    const r = nextPrint({ ...A6, paper: 'a5', sizeMm: [99, 210] }, { paper: 'a4' });
    expect(r.print).toEqual({ paper: 'a4', orientation: 'portrait', bleedMm: 3 });
  });
  test('typing a size makes a custom one: the nearest larger paper stays as the v1 fallback', () => {
    const r = nextPrint(A6, { sizeMm: [99, 210] });
    expect(r.print.sizeMm).toEqual([99, 210]);
    expect(typeof r.print.paper).toBe('string');
    expect(r.print.bleedMm).toBe(3);
    expect([r.widthPx, r.heightPx]).toEqual([
      resolveMmPx(99) + 2 * resolveMmPx(3),
      resolveMmPx(210) + 2 * resolveMmPx(3),
    ]);
  });
  test('orientation on a custom size swaps its two numbers', () => {
    const r = nextPrint({ ...A6, sizeMm: [99, 210], paper: 'a5' }, { orientation: 'landscape' });
    expect(r.print.sizeMm).toEqual([210, 99]);
  });
  test('the safe margin is one value for all four sides; the 5 mm default writes nothing', () => {
    expect(nextPrint(A6, { marginMm: 8 }).print.marginsMm).toEqual({
      top: 8,
      right: 8,
      bottom: 8,
      left: 8,
    });
    expect(
      nextPrint({ ...A6, marginsMm: { top: 8 } }, { marginMm: 5 }).print.marginsMm
    ).toBeUndefined();
    expect(uniformMarginMm({ marginsMm: { top: 8, right: 8, bottom: 8, left: 8 } })).toBe(8);
    expect(uniformMarginMm({ marginsMm: { top: 8 } })).toBeNull();
    expect(uniformMarginMm(A6)).toBe(5);
  });
  test('every other key of the prop is kept — a hand-written print loses nothing', () => {
    const r = nextPrint({ ...A6, showGuides: true, note: 'keep' }, { bleedMm: 2 });
    expect(r.print).toMatchObject({ showGuides: true, note: 'keep', bleedMm: 2 });
  });
  test('out of range or unknown is refused in words', () => {
    expect(() => nextPrint(A6, { bleedMm: 40 })).toThrow('Bleed is 0–20 mm.');
    expect(() => nextPrint(A6, { marginMm: -1 })).toThrow('The safe margin is 0–50 mm.');
    expect(() => nextPrint(A6, { paper: 'a99' })).toThrow('That paper is not one Maude knows.');
    expect(() => nextPrint(A6, { sizeMm: [5, 500] })).toThrow(/10–5000 mm a side/);
  });
});

const FILE = 'ui/Letak.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Letak() {
  return (
    <DesignCanvas>
      <DCArtboard id="a" label="A · přední" width={419} height={581} kind="print" print={{"paper":"a6","orientation":"portrait","bleedMm":3}}>
        <p>Leták</p>
      </DCArtboard>
      <DCArtboard id="web" label="Nábor" width={834} height={581} kind="web">
        <p>Web</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(opts: { held?: string } = {}) {
  const files = new Map<string, string>([[FILE, SRC]]);
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after, label) => {
      files.set(rel, after);
      writes.push(label);
    },
    heldByAi: () => null,
    heldArtboard: (_rel, artboard) => (artboard === opts.held ? { mine: true } : null),
    log: createWriteLog(),
  };
  return {
    files,
    writes,
    run: (params: Record<string, unknown>, op = 'artboard.set-print') =>
      dispatchEditOp({ file: FILE, op, targets: [], params }, deps),
  };
}

describe('artboard.set-print — one write for the prop and the size', () => {
  test('bleed 5 mm rewrites print AND width/height together, in a single write', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'a', bleedMm: 5 });
    expect(r.ok).toBe(true);
    expect(h.writes).toHaveLength(1);
    const out = h.files.get(FILE) ?? '';
    const want = nextPrint({ paper: 'a6', orientation: 'portrait', bleedMm: 3 }, { bleedMm: 5 });
    expect(out).toContain(`width={${want.widthPx}} height={${want.heightPx}}`);
    expect(out).toContain('"bleedMm":5');
    // the other artboard is untouched, byte for byte
    expect(out).toContain(
      '<DCArtboard id="web" label="Nábor" width={834} height={581} kind="web">'
    );
  });
  test('a paper change: A5 is 148 × 210 mm of trim plus bleed', async () => {
    const h = harness();
    expect((await h.run({ artboard: 'a', paper: 'a5' })).ok).toBe(true);
    const out = h.files.get(FILE) ?? '';
    expect(out).toContain('"paper":"a5"');
    const want = nextPrint({ paper: 'a6', orientation: 'portrait', bleedMm: 3 }, { paper: 'a5' });
    expect(out).toContain(`width={${want.widthPx}}`);
  });
  test('a web page is refused in words; the file is untouched', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'web', bleedMm: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('not a print artboard');
    expect(h.files.get(FILE)).toBe(SRC);
  });
  test('a number out of range is refused in words; the file is untouched', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'a', bleedMm: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('Bleed is 0–20 mm.');
    expect(h.files.get(FILE)).toBe(SRC);
  });
  test('an AI run holding the artboard refuses the change', async () => {
    const h = harness({ held: 'a' });
    const r = await h.run({ artboard: 'a', bleedMm: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('held-by-ai');
    expect(h.files.get(FILE)).toBe(SRC);
  });
  test('an empty request says there is nothing to change', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'a' });
    expect(r.ok).toBe(false);
  });
});

describe('artboard.set-guides — the layout guides prop', () => {
  test('writes the whole object, refuses a bad one, null removes it', async () => {
    const h = harness();
    const g = { columns: { count: 2, gutter: 16, margin: 30 } };
    expect((await h.run({ artboard: 'a', guides: g }, 'artboard.set-guides')).ok).toBe(true);
    expect(h.files.get(FILE)).toContain('guides={{"columns":{"count":2,"gutter":16,"margin":30}}}');
    const before = h.files.get(FILE);
    const bad = await h.run(
      { artboard: 'a', guides: { columns: { count: 999 } } },
      'artboard.set-guides'
    );
    expect(bad.ok).toBe(false);
    expect(h.files.get(FILE)).toBe(before);
    expect((await h.run({ artboard: 'a', guides: null }, 'artboard.set-guides')).ok).toBe(true);
    expect(h.files.get(FILE)).not.toContain('guides=');
  });
});
