// S2.8 — the artboard's inspector (14 Editing, ed-ab-select / ed-ab-resize): Preset · Size · Fits content/Fixed ·
// Clip · Background · Layout · Kind · Other widths · Export, and Theme under Advanced. It supersedes
// artboard-knobs.jsx in the v2 inspector — every knob of that panel keeps a home, and the testid
// `inspector-body-layout` stays. Real markup, real registry; only fetch is faked.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('.css'))
      return new Response(':root{--space-4:16px;--space-6:32px;--bg-1:#fff;--ink:#111}', {
        status: 200,
      });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(async () => {
  for (const off of seated.splice(0)) off();
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

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};
const click = async (el: Element | null, what = 'element') => {
  await act(async () => {
    must(el, what).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const reactProps = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[key];
};
const enter = async (input: Element | null, value: string) => {
  const e = must(input, 'input') as HTMLInputElement;
  e.value = value;
  await act(async () => reactProps(e).onBlur({ currentTarget: e }));
  await settle();
};

const FILE = '.design/ui/Homepage.tsx';
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};
/** Desktop, a web page, 1440 × 1573, hugging its content */
const DESKTOP = {
  selector: '[data-dc-screen="desktop"]',
  tag: 'article',
  artboardId: 'desktop',
  file: FILE,
  attrs: {
    'data-dc-kind': 'web',
    'data-dc-bg': 'var(--bg-1)',
    'data-dc-layout': 'flex-col',
  } as Record<string, string>,
  bounds: { x: 0, y: 0, w: 1440, h: 1573 },
  worldW: 1440,
  worldH: 1573,
};

type Call = [string, ...unknown[]];
const calls: Call[] = [];
const handlers = () => ({
  onResizeArtboard: (...a: unknown[]) => calls.push(['resize', ...a]),
  onSetArtboardHug: (...a: unknown[]) => calls.push(['hug', ...a]),
  onSetArtboardStyle: (...a: unknown[]) => calls.push(['style', ...a]),
  onSetArtboardKind: (...a: unknown[]) => calls.push(['kind', ...a]),
  onSetArtboardPrint: (...a: unknown[]) => calls.push(['print', ...a]),
  onSetArtboardTheme: (...a: unknown[]) => calls.push(['theme', ...a]),
  onDuplicateArtboard: (...a: unknown[]) => calls.push(['duplicate', ...a]),
});

/**
 * Seat exactly the sections an artboard shows in a clean registry: the registry is process-wide and other inspector
 * tests unregister theirs in afterAll, so this file never relies on what an import left behind.
 */
const seated: Array<() => void> = [];
async function seat() {
  if (seated.length) return;
  const art = await import('../client/v2/inspector/kinds/artboard.jsx');
  const exp = await import('../client/v2/inspector/sections/export-slot.jsx');
  const { registerSlot } = await import('../client/v2/inspector/slots.js');
  art.offArtboardSections();
  exp.offExportSlot();
  seated.push(art.registerArtboardSlots());
  seated.push(
    registerSlot('export', { id: 'export.presets', order: 100, Body: exp.ExportSlotBody })
  );
}

async function frame(el: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  await seat();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  calls.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected: { ...DESKTOP, ...el },
        layersTree: null,
        cfg: CFG,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
        ...handlers(),
        ...over,
      } as never)}
    />
  );
}
const field = (host: HTMLElement, id: string) =>
  must(q(host, id)?.querySelector('input') ?? null, `input in ${id}`);

describe('what an artboard shows', () => {
  test('the sections: Artboard · Fill · Layout · Export, with the rows of the canvas', async () => {
    const host = await frame();
    expect(q(host, 'inspector-kind')?.textContent).toBe('Web page');
    expect(q(host, 'insp-sec-size')?.getAttribute('aria-label')).toBe('Artboard');
    for (const row of [
      'insp-row-ab-preset',
      'insp-row-ab-size',
      'insp-row-ab-height',
      'insp-row-ab-clip',
      'insp-row-ab-kind',
      'insp-row-ab-add-width',
      'insp-row-ab-background',
      'insp-row-ab-content',
      'insp-row-ab-padding',
      'insp-row-ab-gap',
    ])
      expect(q(host, row), row).not.toBeNull();
    expect(q(host, 'insp-sec-fill')).not.toBeNull();
    expect(q(host, 'insp-sec-layout')).not.toBeNull();
    expect(q(host, 'insp-sec-export')).not.toBeNull();
    // an artboard is no object: no Position / Corners / Border / Effects / Type / Interaction
    for (const s of ['position', 'corners', 'border', 'effects', 'type', 'interaction'])
      expect(q(host, `insp-sec-${s}`), s).toBeNull();
  });

  test('Size reads "1440 × 1573" and the Preset row names Desktop', async () => {
    const host = await frame();
    expect((field(host, 'insp-num-ab-w') as HTMLInputElement).value).toBe('1440');
    expect((field(host, 'insp-num-ab-h') as HTMLInputElement).value).toBe('1573');
    const sel = q(host, 'insp-ab-preset') as HTMLSelectElement;
    expect(sel.options[sel.selectedIndex]?.textContent).toBe('Desktop · 1440');
  });

  test('a size that is no preset reads "Custom"', async () => {
    const host = await frame({ worldW: 1300, bounds: { x: 0, y: 0, w: 1300, h: 1573 } });
    const sel = q(host, 'insp-ab-preset') as HTMLSelectElement;
    expect(sel.options[sel.selectedIndex]?.textContent).toBe('Custom');
  });

  test('Height says "Fits content" for a hugging page and "Fixed" once pinned', async () => {
    const hug = await frame();
    expect(q(hug, 'insp-ab-height')?.querySelector('[aria-checked="true"]')?.textContent).toBe(
      'Fits content'
    );
    expect(q(hug, 'insp-ab-height-note')?.textContent).toBe(
      'Drag the bottom edge to fix the height at a number.'
    );
    const fixed = await frame({ attrs: { ...DESKTOP.attrs, 'data-dc-fixed': 'true' } });
    const last = [
      ...fixed.querySelectorAll('[data-testid="insp-ab-height"] [aria-checked="true"]'),
    ];
    expect(last.map((n) => n.textContent)).toContain('Fixed');
    expect(fixed.querySelector('[data-testid="insp-ab-height-note"]')).toBeNull();
  });

  test('Other widths offers every preset width this board is not', async () => {
    const host = await frame();
    const sel = q(host, 'insp-ab-add-width') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      'Add a width…',
      'Laptop · 1280',
      'Tablet · 834',
      'Mobile · 390',
    ]);
  });

  test('a print artboard swaps the screens for the paper ladder and adds orientation + bleed', async () => {
    const host = await frame({
      attrs: {
        'data-dc-kind': 'print',
        'data-dc-print': JSON.stringify({ paper: 'a4', orientation: 'landscape', bleedMm: 5 }),
      },
    });
    const sel = q(host, 'insp-ab-preset') as HTMLSelectElement;
    expect(sel.options[sel.selectedIndex]?.textContent).toBe('A4 · 210 × 297 mm');
    expect(q(host, 'insp-row-ab-orientation')).not.toBeNull();
    expect(q(host, 'insp-row-ab-bleed')).not.toBeNull();
    expect(q(host, 'insp-row-ab-add-width')).toBeNull(); // paper is picked from the ladder, not by a px width
  });

  test('Clip content is honest: on, because an artboard always clips (no prop to turn it off)', async () => {
    const host = await frame();
    expect((q(host, 'insp-ctl-ab-clip')?.querySelector('input') as HTMLInputElement).checked).toBe(
      true
    );
  });
});

describe('what an edit sends', () => {
  test('Preset: Laptop on a web page is a width (the height keeps fitting the content)', async () => {
    const host = await frame();
    await pick(q(host, 'insp-ab-preset'), 'screen:1280');
    expect(calls).toEqual([['resize', 'desktop', 1280, undefined]]);
  });

  test('Preset: a fixed-size artboard takes the whole screen', async () => {
    const host = await frame({ attrs: { 'data-dc-kind': 'digital' } });
    await pick(q(host, 'insp-ab-preset'), 'screen:834');
    expect(calls).toEqual([['resize', 'desktop', 834, 1194]]);
  });

  test('W commits the width only', async () => {
    const host = await frame();
    await enter(field(host, 'insp-num-ab-w'), '1300');
    expect(calls).toEqual([['resize', 'desktop', 1300, undefined]]);
  });

  test('H on a hugging page pins it: Fixed at that number (issue #79 stays fixed)', async () => {
    const host = await frame();
    await enter(field(host, 'insp-num-ab-h'), '1200');
    expect(calls).toEqual([['hug', 'desktop', true, 1200]]);
  });

  test('H on a fixed page is an ordinary resize', async () => {
    const host = await frame({ attrs: { ...DESKTOP.attrs, 'data-dc-fixed': 'true' } });
    await enter(field(host, 'insp-num-ab-h'), '1200');
    expect(calls).toEqual([['resize', 'desktop', undefined, 1200]]);
  });

  test('Fixed freezes the measured height; Fits content frees it', async () => {
    const host = await frame();
    const seg = q(host, 'insp-ab-height');
    await click(seg?.querySelectorAll('button')[1] ?? null, 'Fixed');
    expect(calls).toEqual([['hug', 'desktop', true, 1573]]);
    const fixed = await frame({ attrs: { ...DESKTOP.attrs, 'data-dc-fixed': 'true' } });
    await click(q(fixed, 'insp-ab-height')?.querySelectorAll('button')[0] ?? null, 'Fits content');
    expect(calls).toEqual([['hug', 'desktop', false, undefined]]);
  });

  test('Kind: Print seeds an A4 print prop through the same gesture', async () => {
    const host = await frame({ attrs: { 'data-dc-kind': 'digital' } });
    await pick(q(host, 'insp-ab-kind'), 'print');
    const [name, id, kind, seed] = calls[0] as [
      string,
      string,
      string,
      { defaults: { paper: string } },
    ];
    expect([name, id, kind, seed?.defaults]).toEqual(['kind', 'desktop', 'print', { paper: 'a4' }]);
  });

  test('Kind: Fixed size clears the explicit prop; Web page frees a Fixed height too', async () => {
    const host = await frame({ attrs: { 'data-dc-kind': 'print' } });
    await pick(q(host, 'insp-ab-kind'), 'digital');
    expect(calls[0]).toEqual(['kind', 'desktop', null, null]);
    const fixed = await frame({ attrs: { 'data-dc-kind': 'digital', 'data-dc-fixed': 'true' } });
    await pick(q(fixed, 'insp-ab-kind'), 'web');
    expect(calls).toEqual([
      ['kind', 'desktop', 'web', null],
      ['hug', 'desktop', false, undefined],
    ]);
  });

  test('Add a width duplicates this board at that width', async () => {
    const host = await frame();
    await pick(q(host, 'insp-ab-add-width'), '834');
    expect(calls).toEqual([['duplicate', 'desktop', 834]]);
  });

  test('the body layout select keeps its testid and writes the layout prop', async () => {
    const host = await frame();
    const sel = q(host, 'inspector-body-layout') as HTMLSelectElement;
    expect(sel.value).toBe('flex-col');
    await pick(sel, 'grid');
    await pick(sel, '');
    expect(calls).toEqual([
      ['style', 'desktop', { layout: 'grid' }],
      ['style', 'desktop', { layout: null }],
    ]);
  });

  test('print: orientation and bleed write the print prop together with the resolved size', async () => {
    const host = await frame({
      attrs: { 'data-dc-kind': 'print', 'data-dc-print': JSON.stringify({ paper: 'a4' }) },
    });
    await click(
      q(host, 'insp-row-ab-orientation')?.querySelectorAll('button')[1] ?? null,
      'landscape'
    );
    const names = calls.map((c) => c[0]);
    expect(names).toEqual(['resize', 'print']);
    expect((calls[1] as Call)[2]).toMatchObject({ paper: 'a4', orientation: 'landscape' });
  });
});

describe('Theme under Advanced (A-artboard-theme)', () => {
  test('is in Advanced, shows the pin the canvas reports, and posts the chosen one', async () => {
    const host = await frame({ attrs: { ...DESKTOP.attrs, 'data-dc-theme-pin': 'dark' } });
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    const sel = q(host, 'insp-ab-theme') as HTMLSelectElement;
    expect(sel.value).toBe('dark');
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      'Follow chrome',
      'DS default',
      'Light',
      'Dark',
    ]);
    await pick(sel, 'ds');
    expect(calls).toEqual([['theme', 'desktop', 'ds']]);
  });

  test('an unpinned artboard follows the chrome', async () => {
    const host = await frame();
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    expect((q(host, 'insp-ab-theme') as HTMLSelectElement).value).toBe('follow');
  });
});
