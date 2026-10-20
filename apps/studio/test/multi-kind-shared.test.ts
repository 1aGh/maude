// S7.21 — several boards of DIFFERENT kinds selected together (08 ak-mixed-select): "2 artboards", "2 kinds", only what
// both understand (Fill, alignment, Export) and the line that says why there is no size. Boards of ONE kind keep S2.9's
// rows (v2-inspector-multi-artboard.test.tsx).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
});
let restoreSlots: (() => void) | null = null;
afterAll(() => {
  for (const off of seated.splice(0)) off();
  restoreSlots?.();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};

const FILE = '.design/ui/Combine-kampan.tsx';
const board = (id: string, kind: string, w: number, h2: number, bg = 'var(--ink)') => ({
  selector: `[data-dc-screen="${id}"]`,
  tag: 'article',
  artboardId: id,
  file: FILE,
  attrs: { 'data-dc-kind': kind, 'data-dc-bg': bg } as Record<string, string>,
  bounds: { x: 0, y: 0, w, h: h2 },
  worldW: w,
  worldH: h2,
  geometry: { x: 0, y: 0 },
});
const IG = board('ig', 'digital', 1080, 1350);
const KARTA = board('karta1', 'print', 1145, 816, 'var(--paper)');
const STORY = board('story', 'digital', 1080, 1920);

const calls: unknown[] = [];
const seated: Array<() => void> = [];
async function seat() {
  if (seated.length) return;
  const multi = await import('../client/v2/inspector/kinds/multi-artboard.jsx');
  const kinds = await import('../client/v2/inspector/kinds/artboard-multi.jsx');
  const exp = await import('../client/v2/inspector/sections/export-slot.jsx');
  const { registerSlot, stashSlots } = await import('../client/v2/inspector/slots.js');
  restoreSlots = stashSlots();
  seated.push(multi.registerMultiArtboardSlots());
  seated.push(kinds.registerMultiKindSlots());
  seated.push(
    registerSlot('export', { id: 'export.presets', order: 100, Body: exp.ExportSlotBody })
  );
}
async function frame(selected: unknown[]) {
  await seat();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  calls.length = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      h(InspectorFrame, {
        selected,
        layersTree: null,
        cfg: { designRel: '.design' },
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
        onRunAction: (m: unknown) => calls.push(m),
      } as never)
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}

describe('two kinds', () => {
  test('"2 artboards", "2 kinds", Kinds named with their words, and the line that explains the missing size', async () => {
    const host = await frame([IG, KARTA]);
    expect(q(host, 'inspector-title')?.textContent).toBe('2 artboards');
    expect(q(host, 'inspector-kind')?.textContent).toBe('2 kinds');
    expect(q(host, 'insp-mk-kinds')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Fixed size Print'
    );
    expect(q(host, 'insp-mk-note')?.textContent).toBe(
      'Size and paper differ. Select one to change it.'
    );
    // Fill is what both understand: the boards differ, so it says Mixed (S2.9's row)
    expect(q(host, 'insp-mab-bg')?.textContent).toBe('Mixed');
  });

  test('no size, no paper, no position of their own: those are the one-kind rows', async () => {
    const host = await frame([IG, KARTA]);
    for (const gone of ['insp-mab-preset', 'insp-mab-w', 'insp-mab-h', 'insp-mab-note'])
      expect(q(host, gone), gone).toBeNull();
  });

  test('Export reads "2 files…" (not a PNG scale that suits only one of them)', async () => {
    const host = await frame([IG, KARTA]);
    expect(q(host, 'insp-export-preset')?.textContent).toBe('2 files…');
  });

  test("Horizontal and Vertical are the align bar's verbs, asked of the canvas", async () => {
    const host = await frame([IG, KARTA]);
    const hBtns = q(host, 'insp-mk-horizontal')?.querySelectorAll('button') ?? [];
    expect([...hBtns].map((b) => b.textContent)).toEqual(['Left', 'Centre', 'Right']);
    const vBtns = q(host, 'insp-mk-vertical')?.querySelectorAll('button') ?? [];
    expect([...vBtns].map((b) => b.textContent)).toEqual(['Top', 'Middle', 'Bottom']);
    await act(async () => {
      must(hBtns[1] ?? null, 'Centre').dispatchEvent(
        new window.MouseEvent('click', { bubbles: true })
      );
      must(vBtns[2] ?? null, 'Bottom').dispatchEvent(
        new window.MouseEvent('click', { bubbles: true })
      );
    });
    expect(calls).toEqual([
      { dgn: 'run-action', v: 1, id: 'align.hcentre' },
      { dgn: 'run-action', v: 1, id: 'align.bottom' },
    ]);
  });
});

describe('one kind', () => {
  test("two fixed sizes keep S2.9's rows, not the two-kind ones", async () => {
    const host = await frame([IG, STORY]);
    expect(q(host, 'inspector-kind')?.textContent).toBe('Fixed size');
    expect(q(host, 'insp-mab-w')?.textContent).toBe('1080');
    expect(q(host, 'insp-mk-kinds')).toBeNull();
    expect(q(host, 'insp-mk-note')).toBeNull();
  });
});

describe('the chip', () => {
  test('three kinds read "3 kinds"; one board of each of two kinds, "2 kinds"', async () => {
    const { kindChipOf } = await import('../client/v2/inspector/kinds/index.js');
    const video = board('v', 'video', 1080, 1920);
    expect(kindChipOf([IG, KARTA])).toBe('2 kinds');
    expect(kindChipOf([IG, KARTA, video])).toBe('3 kinds');
    expect(kindChipOf([IG, STORY])).toBe('Fixed size');
  });
});
