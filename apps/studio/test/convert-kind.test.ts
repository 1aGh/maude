// S7.25 — Change kind makes a copy (08 ak-convert, ak-convert-after): a post becomes an A6 print BESIDE itself and its
// bytes do not move; with the switch off the artboard itself changes. The plan (kinds/convert.ts) says it in words.

import { describe, expect, test } from 'bun:test';

import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { LayoutPatch } from '../edit-ops/types.ts';
import { checkAfter, fillName, planConvert } from '../kinds/convert.ts';

const POST = `<DCArtboard id="ig" label="Oznámení události" width={1080} height={1350} fixed kind="digital" background="var(--ink)" safeZones="instagram-story">
        <h1 data-cd-id="hl">COMBINE 1. 10.</h1>
        <img data-cd-id="foto" src="tym.png" />
      </DCArtboard>`;
const FILE = 'ui/Kampan.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Kampan() {
  return (
    <DesignCanvas>
      ${POST}
      <DCArtboard id="web" label="Nábor" width={834} height={581} kind="web">
        <p>Web</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(held?: string, layout: unknown = undefined) {
  const files = new Map<string, string>([[FILE, SRC]]);
  const layouts: LayoutPatch[] = [];
  const deps: DispatchDeps = {
    ctx: () => ({ dsRev: null, ...(layout !== undefined ? { layout } : {}) }),
    writeLayout: async (_rel, patch) => {
      layouts.push(patch);
    },
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      files.set(rel, after);
    },
    heldByAi: () => null,
    heldArtboard: (_rel, artboard) => (artboard === held ? { mine: true } : null),
    log: createWriteLog(),
  };
  return {
    files,
    layouts,
    run: (params: Record<string, unknown>) =>
      dispatchEditOp({ file: FILE, op: 'artboard.convert-kind', targets: [], params }, deps),
  };
}

describe('planConvert — the words before the write', () => {
  const post = {
    id: 'ig',
    label: 'Oznámení události',
    widthPx: 1080,
    heightPx: 1350,
    background: 'var(--ink)',
    safeZones: 'instagram-story',
  };
  test('4:5 → A6: 105 × 148 mm, 3 mm bleed, 419 × 581 px, the design scales to the width and the rest is Ink', () => {
    const p = planConvert(post, { paper: 'a6' });
    expect(p?.title).toBe('Make “Oznámení události” an A6 print?');
    expect(p?.primary).toBe('Make A6 print');
    expect([p?.widthPx, p?.heightPx]).toEqual([419, 581]);
    expect(p?.fit).toBe('width');
    expect(p?.fill).toBe('Ink');
    expect(p?.lead).toBe(
      `Size becomes 105 × 148 mm with 3 mm bleed. The design scales to the A6 width; the extra ${p?.extraPct} % of height is filled with its background colour, Ink. Text stays text.`
    );
    expect(p?.extraPct).toBeGreaterThan(5);
    expect(p?.note).toBe('Instagram safe zones turn off — print has its own safe margin.');
    expect(p?.copyLabel).toBe('Oznámení události · A6');
  });
  test('a landscape post makes a landscape paper; an unknown paper makes no plan', () => {
    expect(
      planConvert({ ...post, widthPx: 1920, heightPx: 1080 }, { paper: 'a6' })?.print.orientation
    ).toBe('landscape');
    expect(planConvert(post, { paper: 'a99' })).toBeNull();
  });
  test('a design too tall for the paper scales to its height, centred, instead of being cropped', () => {
    const p = planConvert({ ...post, widthPx: 400, heightPx: 2400 }, { paper: 'a6' });
    expect(p?.fit).toBe('height');
    expect(p?.offsetX).toBeGreaterThan(0);
  });
  test('fillName only names a token', () => {
    expect(fillName('var(--ink)')).toBe('Ink');
    expect(fillName('#112233')).toBeNull();
  });
  test('Check after: the picture that lands soft and the layers on the cut, from the source geometry', () => {
    const p = planConvert(post, { paper: 'a6' });
    if (!p) throw new Error('no plan');
    const after = checkAfter(p, {
      artboard: { x: 0, y: 0, w: 1080, h: 1350 },
      elements: [
        // 640 px picture placed 900 px wide on the post → 349 px on the A6 → ~176 ppi: soft
        { cdId: 'foto', x: 90, y: 300, w: 900, h: 600, tag: 'img', naturalW: 640 },
        // a text block that runs over the right-hand cut after scaling
        { cdId: 'hl', x: 900, y: 40, w: 160, h: 60, tag: 'h1', text: 'COMBINE' },
      ],
    });
    expect(after.map((w) => w.code)).toEqual(['soft-image', 'crosses-cut']);
    expect(checkAfter(p, null)).toEqual([]);
  });
});

describe('artboard.convert-kind — a copy beside, the original untouched', () => {
  test('the A6 lands after the post as kind="print" with print + px size, and the post keeps every byte', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'ig', paper: 'a6' });
    expect(r.ok).toBe(true);
    const out = h.files.get(FILE) ?? '';
    // the original, byte for byte (its slice of the file is identical)
    expect(out).toContain(POST);
    const copy = out.slice(out.lastIndexOf('<DCArtboard', out.indexOf('id="ig-a6"')));
    expect(copy).toContain('label="Oznámení události · A6"');
    expect(copy).toContain('kind="print"');
    expect(copy).toMatch(/print=\{\{[^}]*"paper":"a6"/);
    expect(copy).toContain('width={419}');
    expect(copy).toContain('height={581}');
    expect(copy).toContain('zoom: 0.');
    expect(copy).not.toContain('safeZones');
    // the post's text is inside the wrapper, still text
    expect(copy).toContain('COMBINE 1. 10.');
    // the other artboard is untouched
    expect(out).toContain(
      '<DCArtboard id="web" label="Nábor" width={834} height={581} kind="web">'
    );
    if (!r.ok) return;
    expect(r.created).toEqual([{ artboard: 'ig-a6', element: 'ig-a6' }]);
    expect(r.detail?.madeFrom).toEqual({ artboard: 'ig', label: 'Oznámení události' });
  });

  test('with the switch off the artboard itself changes — and a second ask makes a second, distinct copy', async () => {
    const h = harness();
    expect((await h.run({ artboard: 'ig', paper: 'a6' })).ok).toBe(true);
    expect((await h.run({ artboard: 'ig', paper: 'a6' })).ok).toBe(true);
    const out = h.files.get(FILE) ?? '';
    expect(out).toContain('id="ig-a6"');
    expect(out).toContain('id="ig-a6-2"');
    expect(out).toContain('label="Oznámení události · A6 2"');
    const h2 = harness();
    const r = await h2.run({ artboard: 'ig', paper: 'a6', keepOriginal: false });
    expect(r.ok).toBe(true);
    const o2 = h2.files.get(FILE) ?? '';
    expect(o2).not.toContain('id="ig-a6"');
    expect(o2).toMatch(/id="ig"[^>]*kind="print"/);
    if (r.ok) expect(r.created ?? []).toEqual([]);
  });

  test('refusals are in words and write nothing: a page, an unknown paper, a missing artboard, a held one', async () => {
    const h = harness('ig');
    const bad = [
      await h.run({ artboard: 'web', paper: 'a6' }),
      await h.run({ artboard: 'nope', paper: 'a6' }),
      await h.run({ artboard: 'ig', paper: 'a99' }),
      await h.run({ artboard: 'ig', paper: 'a6' }), // held by AI
    ];
    for (const r of bad) expect(r.ok).toBe(false);
    expect(bad[3]?.ok === false && bad[3].code).toBe('held-by-ai');
    expect(h.files.get(FILE)).toBe(SRC);
  });
});

describe('artboard.convert-kind — the copy lands beside the post, never on a neighbour (p8-bugs3 #6)', () => {
  // the post (1080 wide) and the web page sit at the default grid: web at x = 1080 + 80 = 1160, right where the
  // copy's slot beside the post is. The copy used to take the default-grid slot after the splice: on the page.
  type Box = { id: string; x: number; y: number; w: number; h: number };
  const apply = (boxes: Box[], p: LayoutPatch): Box[] => {
    const at = new Map(boxes.map((b) => [b.id, b]));
    for (const e of p.pin ?? []) if (!at.has(e.id)) at.set(e.id, { ...e, w: 0, h: 0 });
    for (const e of p.set ?? []) {
      const b = at.get(e.id);
      at.set(e.id, { id: e.id, w: b?.w ?? 0, h: b?.h ?? 0, x: e.x, y: e.y });
    }
    return [...at.values()];
  };
  const overlap = (a: Box, b: Box) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  test('the copy gets its own place beside the post; the page it would have covered moves over, and every other board is pinned where it was drawn', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'ig', paper: 'a6' });
    expect(r.ok).toBe(true);
    expect(h.layouts).toHaveLength(1);
    const patch = h.layouts[0] as LayoutPatch;
    const set = new Map((patch.set ?? []).map((e) => [e.id, e]));
    const pin = new Map((patch.pin ?? []).map((e) => [e.id, e]));
    // beside: the post's right edge + the 80 px gutter, on the post's row
    expect(set.get('ig-a6')).toEqual({ id: 'ig-a6', x: 1160, y: 0 });
    // the web page was drawn at 1160 — it is pinned there (so the splice cannot shift it) and then moved over
    expect(pin.get('ig')).toEqual({ id: 'ig', x: 0, y: 0 });
    expect(pin.get('web')).toEqual({ id: 'web', x: 1160, y: 0 });
    expect(set.get('web')).toEqual({ id: 'web', x: 1160 + 419 + 80, y: 0 });
    // and nothing overlaps once the layout lane has merged it
    const boxes = apply(
      [
        { id: 'ig', x: 0, y: 0, w: 1080, h: 1350 },
        { id: 'web', x: 1160, y: 0, w: 834, h: 581 },
        { id: 'ig-a6', x: 0, y: 0, w: 419, h: 581 },
      ],
      patch
    );
    for (const a of boxes)
      for (const b of boxes) if (a.id < b.id) expect(overlap(a, b)).toBe(false);
  });

  test('a free slot beside the post moves nobody; boards the layout lane already places keep their entries', async () => {
    const h = harness(undefined, [
      { id: 'ig', x: 0, y: 0 },
      { id: 'web', x: 3000, y: 0 },
    ]);
    const r = await h.run({ artboard: 'ig', paper: 'a6' });
    expect(r.ok).toBe(true);
    const patch = h.layouts[0] as LayoutPatch;
    expect(patch.set).toEqual([{ id: 'ig-a6', x: 1160, y: 0 }]);
  });

  test('with the switch off no copy is made, so no layout is written', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'ig', paper: 'a6', keepOriginal: false });
    expect(r.ok).toBe(true);
    expect(h.layouts).toEqual([]);
  });
});
