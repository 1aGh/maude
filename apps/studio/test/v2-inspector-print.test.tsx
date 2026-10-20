// S7.23 — the Print artboard's inspector (08 ak-print-letak, ak-advanced): paper, millimetres, orientation, bleed,
// safe margin, the artboard's own Print guides switch (C25), the colour line — and, under Advanced, every exact number.
// Real markup, real registry; only fetch is faked, so what the rows SEND is what is asserted.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Sent = { url: string; method: string; body: Record<string, unknown> | null };
const sent: Sent[] = [];
let viewPrintGuides = false;
let answer: (url: string, method: string) => Response = () =>
  new Response(JSON.stringify({ ok: true, writeId: 'w1', actionId: null }), { status: 200 });
const realFetch = globalThis.fetch;
const seated: Array<() => void> = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (String(url).startsWith('/_api/canvas-meta') && method === 'GET')
      return new Response(JSON.stringify({ overlays: { print: viewPrintGuides } }), {
        status: 200,
      });
    sent.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return answer(String(url), method);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  for (const off of seated.splice(0)) off();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
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
const text = (host: HTMLElement, id: string) => must(q(host, id), id).textContent ?? '';
// an Advanced row is "label value": the value alone
const val = (host: HTMLElement, id: string) =>
  must(must(q(host, id), id).querySelector('.insp-av'), `${id} value`).textContent ?? '';

const FILE = '.design/ui/LetakA6.tsx';
const A6 = { paper: 'a6', orientation: 'portrait', bleedMm: 3 };
const SHEET = (print: Record<string, unknown> | null = A6, attrs: Record<string, string> = {}) => ({
  selector: '[data-dc-screen="a"]',
  tag: 'article',
  artboardId: 'a',
  file: FILE,
  attrs: {
    'data-dc-kind': 'print',
    ...(print ? { 'data-dc-print': JSON.stringify(print) } : {}),
    ...attrs,
  },
  bounds: { x: 0, y: 0, w: 419, h: 581 },
  worldW: 419,
  worldH: 581,
});

async function frame(el: ReturnType<typeof SHEET>, over: Record<string, unknown> = {}) {
  if (!seated.length) {
    const art = await import('../client/v2/inspector/kinds/artboard.jsx');
    const print = await import('../client/v2/inspector/kinds/artboard-print.jsx');
    const adv = await import('../client/v2/kinds/advanced-rows.js');
    // the registry is process-wide: seat exactly the artboard's sections, once
    art.offArtboardSections();
    print.offArtboardPrint();
    adv.offPrintAdvancedRows();
    seated.push(art.registerArtboardSlots());
    seated.push(print.registerArtboardPrintSlots());
    seated.push(adv.registerPrintAdvancedRows());
  }
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  sent.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected: el,
        layersTree: null,
        cfg: { designRel: '.design', designSystems: [], defaultDesignSystem: '' },
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
        onSetArtboardStyle: () => {},
        onSetArtboardTheme: () => {},
        ...over,
      } as never)}
    />
  );
}
const params = (i = 0) => (sent[i]?.body?.params ?? {}) as Record<string, unknown>;
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const commit = async (host: HTMLElement, testid: string, value: string) => {
  const input = must(q(host, testid)?.querySelector('input') ?? null, testid) as HTMLInputElement;
  await act(async () => {
    input.focus();
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    input.blur();
  });
  await settle();
};
const click = async (el: Element | null, what: string) => {
  await act(async () => must(el, what).click());
  await settle();
};
// the fold's open state is remembered per Mac: open it only when it is closed
const openAdvanced = async (host: HTMLElement) => {
  const t = must(q(host, 'fold-inspector-toggle'), 'Advanced');
  if (t.getAttribute('aria-expanded') !== 'true') await click(t, 'Advanced');
};

describe('the print rows speak paper', () => {
  test('Paper · Size in mm · Orientation · Bleed · Safe margin · Print guides · Colour, in that order', async () => {
    const host = await frame(SHEET());
    const rows = [...host.querySelectorAll('[data-testid^="insp-row-"]')].map((r) =>
      r.getAttribute('data-testid')
    );
    const want = [
      'insp-row-ab-preset',
      'insp-row-pr-size',
      'insp-row-ab-orientation',
      'insp-row-ab-bleed',
      'insp-row-pr-margin',
      'insp-row-pr-guides',
      'insp-row-pr-colour',
    ];
    expect(rows.filter((r) => want.includes(r as string))).toEqual(want);
  });

  test('an A6 flyer reads A6, 105 × 148, Portrait, 3 mm, 5 mm and the one colour line', async () => {
    const host = await frame(SHEET());
    const sel = must(q(host, 'insp-ab-preset'), 'paper') as HTMLSelectElement;
    expect(sel.options[sel.selectedIndex]?.textContent).toContain('A6');
    const w = must(
      q(host, 'insp-num-pr-w')?.querySelector('input') ?? null,
      'w'
    ) as HTMLInputElement;
    const h = must(
      q(host, 'insp-num-pr-h')?.querySelector('input') ?? null,
      'h'
    ) as HTMLInputElement;
    expect([w.value, h.value]).toEqual(['105', '148']);
    expect(text(host, 'insp-pr-colour')).toBe('RGB — the print shop converts to CMYK.');
    // the padlock of the old body is gone: no px size, no Height mode, no Add a width on a sheet of paper
    expect(q(host, 'insp-row-ab-size')).toBeNull();
    expect(q(host, 'insp-row-ab-height')).toBeNull();
    expect(q(host, 'insp-row-ab-add-width')).toBeNull();
  });

  test('a web page and a fixed size do not get these rows', async () => {
    const web = await frame(SHEET(null, { 'data-dc-kind': 'web' }));
    expect(q(web, 'insp-row-pr-size')).toBeNull();
    const fixed = await frame(SHEET(null, { 'data-dc-kind': 'digital' }));
    expect(q(fixed, 'insp-row-pr-guides')).toBeNull();
  });
});

describe('what an edit sends — ONE artboard.set-print each', () => {
  test('Paper: A4 is a paper, not a width', async () => {
    const host = await frame(SHEET());
    await pick(q(host, 'insp-ab-preset'), 'paper:a4');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/_api/edit-op');
    expect(sent[0]?.body).toMatchObject({ file: FILE, op: 'artboard.set-print' });
    expect(params()).toEqual({ artboard: 'a', paper: 'a4' });
  });
  test('Size in mm: typing a width keeps the height and asks for a custom size', async () => {
    const host = await frame(SHEET());
    await commit(host, 'insp-num-pr-w', '99');
    expect(params()).toEqual({ artboard: 'a', sizeMm: [99, 148] });
  });
  test('Orientation, Bleed and Safe margin send their own field', async () => {
    const host = await frame(SHEET());
    await click(
      q(host, 'insp-row-ab-orientation')?.querySelectorAll('button')[1] ?? null,
      'landscape'
    );
    expect(params(0)).toEqual({ artboard: 'a', orientation: 'landscape' });
    await commit(host, 'insp-row-ab-bleed', '5');
    expect(params(1)).toEqual({ artboard: 'a', bleedMm: 5 });
    await commit(host, 'insp-row-pr-margin', '8');
    expect(params(2)).toEqual({ artboard: 'a', marginMm: 8 });
  });
  test('a refusal is said in words under the rows', async () => {
    answer = () =>
      new Response(JSON.stringify({ ok: false, code: 'invalid', message: 'Bleed is 0–20 mm.' }), {
        status: 422,
      });
    const host = await frame(SHEET());
    await commit(host, 'insp-row-ab-bleed', '40');
    answer = () => new Response(JSON.stringify({ ok: true, writeId: 'w1' }), { status: 200 });
    expect(text(host, 'insp-pr-said')).toBe('Bleed is 0–20 mm.');
  });
});

describe('C25 — Print guides: the artboard’s switch wins, View is the default', () => {
  const guides = (host: HTMLElement) =>
    must(
      q(host, 'insp-ctl-pr-guides')?.querySelector('input') ?? null,
      'switch'
    ) as HTMLInputElement;

  test('with no override it shows View’s default and says so', async () => {
    viewPrintGuides = true;
    const on = await frame(SHEET());
    expect(guides(on).checked).toBe(true);
    expect(text(on, 'insp-pr-guides-note')).toBe('Follows View › Advanced › Print guides.');
    viewPrintGuides = false;
    const off = await frame(SHEET());
    expect(guides(off).checked).toBe(false);
  });
  test('this artboard’s own value wins over View, either way', async () => {
    viewPrintGuides = true;
    const hidden = await frame(SHEET({ ...A6, showGuides: false }));
    expect(guides(hidden).checked).toBe(false);
    expect(text(hidden, 'insp-pr-guides-note')).toContain('Set for this artboard.');
    viewPrintGuides = false;
    const shown = await frame(SHEET({ ...A6, showGuides: true }));
    expect(guides(shown).checked).toBe(true);
  });
  test('flipping the switch sends artboard.set-print-guides; Follow View sends null', async () => {
    viewPrintGuides = false;
    const host = await frame(SHEET());
    await click(guides(host), 'switch');
    expect(sent[0]?.body).toMatchObject({ op: 'artboard.set-print-guides' });
    expect(params(0)).toEqual({ artboard: 'a', visible: true });
    const owned = await frame(SHEET({ ...A6, showGuides: true }));
    await click(q(owned, 'insp-pr-guides-follow'), 'follow');
    expect(params(0)).toEqual({ artboard: 'a', visible: null });
  });
});

describe('Advanced — every number, and the code', () => {
  test('Exact size, Resolution, Colour, Guides, Look and layout and In code, with the 08 numbers', async () => {
    const host = await frame(SHEET());
    await openAdvanced(host);
    expect(val(host, 'insp-pr-exact-artboard')).toBe('419 × 581 px');
    expect(val(host, 'insp-pr-exact-trim')).toBe('397 × 559 px · 105 × 148 mm');
    expect(val(host, 'insp-pr-exact-bleed-margin')).toBe('11 px · 19 px');
    expect(val(host, 'insp-pr-res-canvas')).toBe('96 px per inch');
    expect(val(host, 'insp-pr-res-print-PDF')).toBe('300 dpi · vector text');
    expect(text(host, 'insp-pr-colour-adv')).toContain('Designed in sRGB.');
    expect(val(host, 'insp-pr-guide-columns')).toBe('off');
    expect(q(host, 'insp-pr-body-layout')).not.toBeNull();
    expect(text(host, 'insp-pr-code-text')).toContain('<DCArtboard kind="print"');
    expect(text(host, 'insp-pr-code-text')).toContain('print={{ paper: "a6"');
    expect(text(host, 'insp-pr-code-text')).toContain('width={419} height={581}');
  });
  test('Kind and Clip content keep their rows under Advanced (nothing deleted)', async () => {
    const host = await frame(SHEET());
    await openAdvanced(host);
    expect(q(host, 'insp-ab-kind')).not.toBeNull();
    expect(q(host, 'insp-ctl-ab-clip')).not.toBeNull();
  });
  test('Guides › Add writes artboard.set-guides with the whole object', async () => {
    const host = await frame(SHEET());
    await openAdvanced(host);
    await pick(q(host, 'insp-pr-guides-add'), 'columns');
    const w = sent.find((x) => x.body?.op === 'artboard.set-guides');
    expect(w).toBeDefined();
    expect((w?.body?.params ?? {}) as Record<string, unknown>).toEqual({
      artboard: 'a',
      guides: { columns: { count: 2, gutter: 16, margin: 30 } },
    });
  });
});
