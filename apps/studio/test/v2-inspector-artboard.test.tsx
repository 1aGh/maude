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
  // S7.21: a web page, a fixed size and a video have their own rows (artboard-{web,fixed,video}.jsx)
  const web = await import('../client/v2/inspector/kinds/artboard-web.jsx');
  const fixed = await import('../client/v2/inspector/kinds/artboard-fixed.jsx');
  const video = await import('../client/v2/inspector/kinds/artboard-video.jsx');
  // S7.23: paper has its own rows (artboard-print.jsx)
  const print = await import('../client/v2/inspector/kinds/artboard-print.jsx');
  art.offArtboardSections();
  print.offArtboardPrint();
  web.offArtboardWeb();
  fixed.offArtboardFixed();
  video.offArtboardVideo();
  exp.offExportSlot();
  seated.push(art.registerArtboardSlots());
  seated.push(web.registerArtboardWebSlots());
  seated.push(fixed.registerArtboardFixedSlots());
  seated.push(video.registerArtboardVideoSlots());
  seated.push(print.registerArtboardPrintSlots());
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
// the fold's open state is remembered per Mac (and per test process): open it only when it is closed
const openAdvanced = async (host: HTMLElement) => {
  const t = must(q(host, 'fold-inspector-toggle'), 'Advanced');
  if (t.getAttribute('aria-expanded') !== 'true') await click(t, 'Advanced');
};
const field = (host: HTMLElement, id: string) =>
  must(q(host, id)?.querySelector('input') ?? null, `input in ${id}`);

describe('what an artboard shows', () => {
  test('the sections: Artboard · Fill · Layout · Export, with the rows of the canvas', async () => {
    const host = await frame();
    expect(q(host, 'inspector-kind')?.textContent).toBe('Web page');
    expect(q(host, 'insp-sec-size')?.getAttribute('aria-label')).toBe('Artboard');
    for (const row of [
      'insp-row-ab-preset',
      'insp-row-ab-height',
      'insp-row-ab-add-width',
      'insp-row-ab-background',
      'insp-row-ab-content',
    ])
      expect(q(host, row), row).not.toBeNull();
    // V2-8.5 C4 (08 ak-web-hug): the card draws ONE Layout row; Padding and Gap are exact numbers under Advanced
    for (const row of ['insp-row-ab-padding', 'insp-row-ab-gap'])
      expect(q(host, row), row).toBeNull();
    expect(q(host, 'insp-row-ab-background')?.querySelector('.insp-row-k')?.textContent).toBe(
      'Fill'
    );
    expect(q(host, 'insp-row-ab-content')?.querySelector('.insp-row-k')?.textContent).toBe(
      'Layout'
    );
    // Fill and Layout are rows of the Artboard card — no section heads of their own
    for (const s of ['fill', 'layout'])
      expect(
        q(host, `insp-sec-${s}`)?.querySelector('.insp-sec-t')?.hasAttribute('hidden'),
        s
      ).toBe(true);
    expect(q(host, 'insp-sec-fill')).not.toBeNull();
    expect(q(host, 'insp-sec-layout')).not.toBeNull();
    expect(q(host, 'insp-sec-export')).not.toBeNull();
    // S7.21 — the exact W × H, Clip content and Kind are under Advanced ("Every number, under Advanced.")
    for (const row of ['insp-row-ab-size', 'insp-row-ab-clip', 'insp-row-ab-kind'])
      expect(q(host, row), row).toBeNull();
    // an artboard is no object: no Position / Corners / Border / Effects / Type / Interaction
    for (const s of ['position', 'corners', 'border', 'effects', 'type', 'interaction'])
      expect(q(host, `insp-sec-${s}`), s).toBeNull();
  });

  test('Size reads "1440 × 1573" (under Advanced) and the Width row names Desktop', async () => {
    const host = await frame();
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    expect(q(host, 'insp-row-ab-padding')).not.toBeNull();
    expect(q(host, 'insp-row-ab-gap')).not.toBeNull();
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
    expect(q(hug, 'insp-ab-height-note')?.textContent).toBe('1573 now — grows as you add.');
    const fixed = await frame({ attrs: { ...DESKTOP.attrs, 'data-dc-fixed': 'true' } });
    const last = [
      ...fixed.querySelectorAll('[data-testid="insp-ab-height"] [aria-checked="true"]'),
    ];
    expect(last.map((n) => n.textContent)).toContain('Fixed');
    expect(fixed.querySelector('[data-testid="insp-ab-height-note"]')).toBeNull();
  });

  test('Other widths offers every preset width this board is not', async () => {
    const host = await frame();
    await click(q(host, 'insp-ab-add-width'), 'Add a width');
    expect(
      [...host.querySelectorAll('[data-testid="insp-ab-add-width-menu"] [role="menuitem"]')].map(
        (o) => o.textContent
      )
    ).toEqual(['Tablet and Mobile', 'Laptop · 1280', 'Tablet · 834', 'Mobile · 390']);
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

  // V2-8.5 C2 (08 ak-*, 07 ve-select) — rows by kind: the page's Layout is a web page's, a background is a web page's
  // or a fixed size's, never a print board's or a video's
  test('a web page has Fill and Layout; a fixed size has Fill and no Layout', async () => {
    const web = await frame();
    expect(q(web, 'insp-sec-fill')).not.toBeNull();
    expect(q(web, 'insp-sec-layout')).not.toBeNull();
    const fixed = await frame({ attrs: { 'data-dc-kind': 'digital' } });
    expect(q(fixed, 'insp-sec-fill')).not.toBeNull();
    expect(q(fixed, 'insp-sec-layout')).toBeNull();
    expect(q(fixed, 'inspector-body-layout')).toBeNull();
  });

  test('a print board and a video have neither Fill nor Layout', async () => {
    for (const kind of ['print', 'video']) {
      const host = await frame({ attrs: { 'data-dc-kind': kind } });
      expect(q(host, 'insp-sec-fill')).toBeNull();
      expect(q(host, 'insp-sec-layout')).toBeNull();
      expect(q(host, 'inspector-body-layout')).toBeNull();
    }
  });

  test('Clip content is honest: on, because an artboard always clips (no prop to turn it off)', async () => {
    const host = await frame();
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    const input = must(q(host, 'insp-ctl-ab-clip')?.querySelector('input') ?? null, 'clip switch');
    expect((input as HTMLInputElement).checked).toBe(true);
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
    await pick(q(host, 'insp-ab-preset'), 'app-tablet');
    expect(calls).toEqual([['resize', 'desktop', 834, 1194]]);
  });

  test('W commits the width only', async () => {
    const host = await frame();
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    await enter(field(host, 'insp-num-ab-w'), '1300');
    expect(calls).toEqual([['resize', 'desktop', 1300, undefined]]);
  });

  test('H on a hugging page pins it: Fixed at that number (issue #79 stays fixed)', async () => {
    const host = await frame();
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    await enter(field(host, 'insp-num-ab-h'), '1200');
    expect(calls).toEqual([['hug', 'desktop', true, 1200]]);
  });

  test('H on a fixed page is an ordinary resize', async () => {
    const host = await frame({ attrs: { ...DESKTOP.attrs, 'data-dc-fixed': 'true' } });
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
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
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
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
    // S7.23: paper keeps its Kind row under Advanced, like the other three kinds
    const host = await frame({ attrs: { 'data-dc-kind': 'print' } });
    await openAdvanced(host);
    await pick(q(host, 'insp-ab-kind'), 'digital');
    expect(calls[0]).toEqual(['kind', 'desktop', null, null]);
    const fixed = await frame({ attrs: { 'data-dc-kind': 'digital', 'data-dc-fixed': 'true' } });
    await openAdvanced(fixed);
    await pick(q(fixed, 'insp-ab-kind'), 'web');
    expect(calls).toEqual([
      ['kind', 'desktop', 'web', null],
      ['hug', 'desktop', false, undefined],
    ]);
  });

  test('Add a width duplicates this board at that width', async () => {
    const host = await frame();
    await click(q(host, 'insp-ab-add-width'), 'Add a width');
    await click(q(host, 'insp-ab-add-width-834'), 'Tablet');
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

  // S7.23: paper's orientation, bleed and size are ONE `artboard.set-print` edit-op now (print prop + px size in a
  // single write) — what each row sends is pinned in v2-inspector-print.test.tsx.
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

// S2.22 G1 — what the verifier found against 14 Editing, ed-ab-select.
describe('S2.22 G1 — the artboard inspector says what the canvas says', () => {
  test('the title is the artboard name ("Desktop"), not its id', async () => {
    const host = await frame({ attrs: { ...DESKTOP.attrs, 'data-dc-label': 'Desktop' } });
    expect(q(host, 'inspector-title')?.textContent).toBe('Desktop');
  });

  test('the title falls back to the id when the payload carries no name', async () => {
    const host = await frame();
    expect(q(host, 'inspector-title')?.textContent).toBe('desktop');
  });

  test('Fill comes before Layout (Artboard, Fill, Layout, Export)', async () => {
    const host = await frame();
    const order = ['insp-sec-size', 'insp-sec-fill', 'insp-sec-layout', 'insp-sec-export'].map(
      (id) => must(q(host, id), id)
    );
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & 4,
        `${i - 1} precedes ${i}`
      ).toBeTruthy();
  });

  test('the Advanced fold counts its properties', async () => {
    const host = await frame();
    const hint = host.querySelector('.v2-fold-hint');
    expect(hint?.textContent).toMatch(/^\d+ propert(y|ies)$/);
  });
});
