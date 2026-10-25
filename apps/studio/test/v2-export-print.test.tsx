// S8.7 — Print: the paper preview, the preflight lines, the colour line (09 Export › ex-print, ex-print-warn).
// Two halves: the pure model (paper geometry, the words, the spec a print page builds) and the real sheet
// mounted under happy-dom + React with a recording `fetch` stub (never the render service).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { applyAdvanced } from '../client/v2/export/advanced/model.js';
import { fontLine } from '../client/v2/export/preflight/fonts.js';
import {
  cropStrokes,
  paperGeometry,
  registrationSpots,
} from '../client/v2/export/preflight/paper.jsx';
import { elementName, safeMarginLine } from '../client/v2/export/preflight/safe-margin.js';
import { pageCaption } from '../client/v2/export/sections/print-copy.js';
import { buildSpec, initialState, sectionKind } from '../client/v2/export/use-export-spec.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const A6 = {
  name: 'A6',
  trimMm: [105, 148] as [number, number],
  bleedMm: 3,
  marginMm: [5, 5, 5, 5] as [number, number, number, number],
};

describe('the paper follows the artboard’s own numbers', () => {
  test('with bleed the art runs past the cut; without it the paper is the trim', () => {
    const on = paperGeometry(A6, { bleed: true, marks: true });
    const off = paperGeometry(A6, { bleed: false, marks: true });
    expect(on.art.w / on.s).toBeCloseTo(111, 1);
    expect(on.art.h / on.s).toBeCloseTo(154, 1);
    expect(off.art.w / off.s).toBeCloseTo(105, 1);
    expect(off.art.h / off.s).toBeCloseTo(148, 1);
    // the trim box is the same piece of paper either way
    expect(on.trim.w / on.s).toBeCloseTo(off.trim.w / off.s, 3);
  });

  test('crop marks are eight strokes outside the bleed; registration marks four, on the side centres', () => {
    const g = paperGeometry(A6, { bleed: true, marks: true, registration: true });
    const strokes = cropStrokes(g);
    expect(strokes).toHaveLength(8);
    for (const s of strokes) {
      const inside =
        s.x >= g.art.x &&
        s.x + s.w <= g.art.x + g.art.w &&
        s.y >= g.art.y &&
        s.y + s.h <= g.art.y + g.art.h;
      expect(inside).toBe(false);
    }
    const spots = registrationSpots(g);
    expect(spots).toHaveLength(4);
    expect(spots[0]?.x).toBeCloseTo(g.trim.x + g.trim.w / 2, 3);
  });

  test('a big paper is scaled to fit, a small one is not blown up', () => {
    const a3 = paperGeometry({ ...A6, trimMm: [297, 420] }, { maxW: 240, maxH: 260 });
    expect(a3.height).toBeLessThanOrEqual(260 + 0.01);
    expect(a3.width).toBeLessThanOrEqual(240 + 0.01);
    expect(paperGeometry(A6).s).toBeLessThanOrEqual(1.7);
  });

  test('the caption reads page, paper and millimetres', () => {
    expect(pageCaption({ page: 0, pages: 2, paper: A6 })).toBe('Page 1 of 2 · A6 · 105 × 148 mm');
    expect(
      pageCaption({ page: 0, pages: 1, paper: { ...A6, name: null, trimMm: [99, 210] } })
    ).toBe('Page 1 of 1 · 99 × 210 mm');
  });
});

describe('the warnings, in words — they inform, never block', () => {
  test('the safe-margin line names the element and the two numbers', () => {
    const qr = {
      artboard: 'a',
      element: 'qr code',
      label: 'qr code',
      edge: 'right',
      mm: 2,
      marginMm: 5,
    };
    expect(elementName(qr)).toBe('The QR code');
    expect(safeMarginLine([qr])).toBe(
      'The QR code is 2 mm from the cut — past the 5 mm safe margin. The trim may clip it.'
    );
    const text = { ...qr, element: 'x', label: 'Kraví hora' };
    expect(safeMarginLine([text, qr])).toContain('“Kraví hora” is 2 mm from the cut');
    expect(safeMarginLine([text, qr])).toContain('1 more is close to it too.');
    expect(safeMarginLine([])).toBe('');
  });

  test('the font line says what happens and which font embeds; outlines silence it', () => {
    const fonts = [
      { family: 'Avenir Next Condensed', embeddable: false, reason: 'restricted' },
      { family: 'Alligators', embeddable: true, reason: null },
    ];
    expect(fontLine(fonts)).toBe(
      'Avenir Next Condensed can’t be embedded — the text prints as shapes (same look). Alligators embeds.'
    );
    expect(fontLine(fonts, true)).toBe('');
    expect(fontLine([fonts[1] as never])).toBe('');
  });
});

describe('the spec a print page builds', () => {
  const ctx = {
    designRel: '.design',
    activePath: '.design/ui/letak.tsx',
    kind: 'print',
    artboards: ['a-flag'],
  };
  const base = () => ({
    ...initialState({}, { hasSelection: true }),
    format: 'pdf',
    printPdf: true,
  });

  test('only print artboards → the print section', () => {
    expect(sectionKind({ byKind: { print: {} } })).toBe('print');
    expect(sectionKind({ byKind: { print: {}, digital: {} } })).toBe('image');
    expect(sectionKind({ byKind: { web: {} } })).toBe('web');
  });

  test('Print PDF: bleed and crop marks on, the kind’s first offer', () => {
    expect(buildSpec(base(), ctx).options?.print).toEqual({ bleed: true, marks: 'crop' });
  });

  test('Bleed, Crop marks, Add the back, registration marks and outlines ride in Advanced’s fields', () => {
    const spec = buildSpec(
      {
        ...base(),
        adv: { bleed: false, crop: false, back: true, registration: true, text: 'outline' },
      },
      ctx
    );
    expect(spec.options?.print).toEqual({
      bleed: false,
      marks: 'none',
      back: true,
      registration: true,
      text: 'outline',
    });
    // keep is today’s behaviour and is not written
    expect(buildSpec({ ...base(), adv: { text: 'keep' } }, ctx).options?.print).toEqual({
      bleed: true,
      marks: 'crop',
    });
  });

  test('a plain PDF carries no print geometry, whatever the fold remembers; a picture is 300 dpi', () => {
    const plain = buildSpec(
      { ...base(), printPdf: false, adv: { bleed: false, registration: true } },
      ctx
    );
    expect(plain.options?.print).toBeUndefined();
    const png = buildSpec({ ...base(), format: 'png' }, ctx);
    expect(png.options?.size).toEqual({ dpi: 300 });
    // a scale the person picked still wins
    expect(buildSpec({ ...base(), format: 'png', scale: 2 }, ctx).options?.size).toEqual({
      scale: 2,
    });
  });

  test('a screen page is untouched: no print options, scale as before', () => {
    const post = buildSpec(
      { ...initialState({}, { hasSelection: true }), format: 'png' },
      { ...ctx, kind: 'digital' }
    );
    expect(post.options).toEqual({ size: { scale: 1 } });
  });

  test('Advanced adds nothing to a spec that is not a PDF', () => {
    const spec = applyAdvanced(
      { v: 2, scope: 'canvas', format: 'png' },
      { registration: true, back: true }
    );
    expect(spec.options?.print).toBeUndefined();
  });
});

// ── the sheet ────────────────────────────────────────────────────────────────────────────────────
interface Call {
  method: string;
  url: string;
  body?: {
    v?: number;
    spec?: { options?: { print?: Record<string, unknown>; size?: unknown }; format?: string };
  };
}
let calls: Call[] = [];
const realFetch = globalThis.fetch;

const EST_PRINT = {
  counts: { selection: 1, canvas: 4, folder: 4, project: 4 },
  files: 1,
  bytes: 3_000_000,
  seconds: 5,
  lane: 'this-mac',
  byKind: { print: { artboards: 1, files: 1, format: 'pdf' } },
  skipped: [],
};
const PREFLIGHT = {
  print: true,
  colour: 'rgb',
  measured: true,
  boards: [
    {
      canvas: 'ui/letak.tsx',
      id: 'a-flag',
      label: 'A · přední (FLAG)',
      paper: A6,
      back: { id: 'b-flag', label: 'B · zadní (FLAG)' },
    },
  ],
  safeMargin: [
    {
      artboard: 'a-flag',
      element: 'qr-code',
      label: 'qr-code',
      edge: 'right',
      mm: 2,
      marginMm: 5,
      box: { x: 80, y: 100, w: 22, h: 22 },
    },
  ],
  fonts: [
    {
      family: 'Avenir Next Condensed',
      file: 'ui/fonts/avenir.otf',
      embeddable: false,
      reason: 'restricted',
    },
    { family: 'Alligators', file: 'ui/fonts/gator.ttf', embeddable: true, reason: null },
  ],
};

function stubFetch(preflight: unknown = PREFLIGHT) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/_api/export-history')) return json({ history: [] });
    if (url.endsWith('/_api/export-estimate')) return json(EST_PRINT);
    if (url.endsWith('/_api/export-preflight')) {
      if (preflight === 'hang') return new Promise<Response>(() => {});
      // the headless safe-margin render never answers; the quick ask (`measure: false`) does
      if (preflight === 'measure-hangs')
        return calls.at(-1)?.body?.measure === false
          ? json(PREFLIGHT)
          : new Promise<Response>(() => {});
      return json(preflight);
    }
    if (url.endsWith('/_api/export-jobs')) return json({ jobId: 'job-1' }, 202);
    return json({}, 404);
  }) as typeof fetch;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const click = async (sel: string) => {
  const el = $(sel);
  expect(el !== null).toBe(true);
  await act(async () => {
    el?.click();
    await tick(10);
  });
};
const jobs = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/_api/export-jobs'));
const preflights = () => calls.filter((c) => c.url.endsWith('/_api/export-preflight'));

async function mountSheet(props: Record<string, unknown> = {}, preflight: unknown = PREFLIGHT) {
  stubFetch(preflight);
  const { ExportDialog } = await import('../client/dialogs/export-dialog.jsx');
  let closed = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportDialog
        mode="export"
        activePath=".design/ui/letak.tsx"
        designRel=".design"
        exportLane="local"
        hasSelection={true}
        selectedArtboards={['a-flag']}
        selectionLabel="A · přední (FLAG)"
        onClose={() => {
          closed++;
        }}
        {...props}
      />
    );
    await tick();
  });
  // the section appears once the estimate names the kind, the format follows, then the estimate for it and
  // the preflight: wait for the chain (the paper), or for as long as it can take when no paper is coming
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await tick(250);
    });
    if (
      $('[data-testid="export-paper"]') &&
      ($('[data-testid="export-print-page-2"]') ||
        !preflight ||
        !(preflight as { boards?: unknown[] }).boards)
    )
      break;
    if (
      $('[data-testid="export-paper"]') &&
      (preflight as { boards: Array<{ back: unknown }> }).boards[0]?.back === null
    )
      break;
  }
  return { closed: () => closed };
}

describe('P8-C4 (09 ex-print): the paper does not wait for the safe-margin render', () => {
  test('a measurement that never comes still leaves the page drawn — paper, caption, the back', async () => {
    await mountSheet({}, 'measure-hangs');
    for (let i = 0; i < 8 && !$('[data-testid="export-paper"]'); i++)
      await act(async () => tick(250));
    expect($('[data-testid="export-paper"]') !== null).toBe(true);
    expect($('[data-testid="export-print-pending"]')).toBeNull();
    expect($('[data-testid="export-print-back"]') !== null).toBe(true);
    expect(preflights().some((c) => c.body?.measure === false)).toBe(true);
  });
});

describe('gate-b-polish3: the preview column is never an empty box', () => {
  test('while the page is measured, a blank page and the words say so', async () => {
    await mountSheet({}, 'hang');
    expect($('[data-testid="export-print"]') !== null).toBe(true);
    expect($('[data-testid="export-print-pending"]')?.getAttribute('data-state')).toBe('measuring');
    expect(text('[data-testid="export-print-caption"]')).toBe('Drawing the page…');
  });
  test('an artboard with no paper size says so instead of a grey bar', async () => {
    await mountSheet(
      {},
      {
        print: true,
        boards: [{ canvas: 'ui/letak.tsx', id: 'a-flag', label: 'A', paper: null, back: null }],
        safeMargin: [],
        measured: false,
        fonts: [],
        colour: 'rgb',
      }
    );
    expect($('[data-testid="export-print-pending"]')?.getAttribute('data-state')).toBe('none');
    expect(text('[data-testid="export-print-caption"]')).toContain('No paper size');
  });
});

describe('the sheet: a print artboard', () => {
  test('opens on Print PDF with Bleed and Crop marks on, and the paper beside it', async () => {
    await mountSheet();
    expect($('[data-testid="export-print"]') !== null).toBe(true);
    expect($('[data-testid="export-print-format"]')?.getAttribute('data-value')).toBe('print-pdf');
    expect(($('[data-testid="export-print-bleed"]') as HTMLInputElement).checked).toBe(true);
    expect(($('[data-testid="export-print-crop"]') as HTMLInputElement).checked).toBe(true);
    expect($('[data-testid="export-paper"]')?.getAttribute('data-bleed')).toBe('true');
    expect(all('[data-testid="export-paper-crop"]')).toHaveLength(8);
    expect(all('[data-testid="export-paper-tint"]')).toHaveLength(1);
    expect(text('[data-testid="export-print-caption"]')).toBe('Page 1 of 2 · A6 · 105 × 148 mm');
    // the export it would make
    await click('[data-testid="export-submit"]');
    const spec = jobs()[0]?.body?.spec;
    expect(spec?.format).toBe('pdf');
    expect(spec?.options?.print).toMatchObject({ bleed: true, marks: 'crop', back: true });
  });

  test('untick Bleed and the paper changes with it; untick Crop marks and the marks go', async () => {
    await mountSheet();
    await click('[data-testid="export-print-bleed"]');
    expect($('[data-testid="export-paper"]')?.getAttribute('data-bleed')).toBe('false');
    expect(all('[data-testid="export-paper-tint"]')).toHaveLength(0);
    await click('[data-testid="export-print-crop"]');
    expect(all('[data-testid="export-paper-crop"]')).toHaveLength(0);
    await click('[data-testid="export-submit"]');
    expect(jobs()[0]?.body?.spec?.options?.print).toMatchObject({ bleed: false, marks: 'none' });
  });

  test('the back sits under the front as page 2, and unticking it takes the page away', async () => {
    await mountSheet();
    expect($('[data-testid="export-row-print"]')?.textContent).toContain('Add “B · zadní (FLAG)”');
    expect($('[data-testid="export-print-page-2"]') !== null).toBe(true);
    // V2-8.5 C4 (09 ex-print): the title says the back is in the file, the summary counts pages, and the strip is
    // 34 × 47 page thumbnails between ‹ and › (no numbered chips)
    expect(text('[data-testid="export-title"]')).toContain('+ its back');
    expect(text('[data-testid="export-summary"]')).toMatch(/^1 PDF · 2 pages · about /);
    expect($('[data-testid="export-print-page-1"]')?.textContent).toBe('');
    expect(($('[data-testid="export-print-page-prev"]') as HTMLButtonElement).disabled).toBe(true);
    await click('[data-testid="export-print-page-next"]');
    expect(text('[data-testid="export-print-caption"]')).toBe('Page 2 of 2 · A6 · 105 × 148 mm');
    await click('[data-testid="export-print-page-prev"]');
    await click('[data-testid="export-print-page-2"]');
    expect(text('[data-testid="export-print-caption"]')).toBe('Page 2 of 2 · A6 · 105 × 148 mm');
    await click('[data-testid="export-print-back"]');
    expect($('[data-testid="export-print-page-2"]')).toBeNull();
    expect(text('[data-testid="export-print-caption"]')).toBe('Page 1 of 1 · A6 · 105 × 148 mm');
    expect(text('[data-testid="export-title"]')).not.toContain('+ its back');
    expect(text('[data-testid="export-summary"]')).toMatch(/^1 PDF · 1 page · /);
    await click('[data-testid="export-submit"]');
    expect(jobs()[0]?.body?.spec?.options?.print).toMatchObject({ back: false });
  });

  test('a page with no back found offers no Add-the-back box and makes one page', async () => {
    const noBack = { ...PREFLIGHT, boards: [{ ...PREFLIGHT.boards[0], back: null }] };
    await mountSheet({}, noBack);
    expect($('[data-testid="export-print-back"]')).toBeNull();
    expect($('[data-testid="export-print-page-2"]')).toBeNull();
    expect(text('[data-testid="export-print-caption"]')).toContain('Page 1 of 1');
  });

  test('past the safe margin: the line, the ring on the paper, Show on canvas — Export still exports', async () => {
    const jumps: unknown[] = [];
    const on = (e: Event) => jumps.push((e as CustomEvent).detail);
    window.addEventListener('maude:canvas-op', on);
    const sheet = await mountSheet({ printGuidesVisible: true });
    expect(text('[data-testid="export-print-safe-warn"]')).toContain(
      'The QR code is 2 mm from the cut — past the 5 mm safe margin. The trim may clip it.'
    );
    expect(all('[data-testid="export-paper-flag"]')).toHaveLength(1);
    // the ring is tagged with its distance to the cut (09 ex-print-warn)
    expect(text('[data-testid="export-paper-flag-tag"]')).toBe('2 mm to the cut');
    expect(($('[data-testid="export-submit"]') as HTMLButtonElement).disabled).toBe(false);
    const show = $('[data-testid="export-print-safe-warn"] button') as HTMLElement;
    expect(show.textContent).toBe('Show on canvas');
    await act(async () => {
      show.click();
      await tick(10);
    });
    window.removeEventListener('maude:canvas-op', on);
    expect(jumps).toEqual([{ op: 'jump', path: '.design/ui/letak.tsx', artboardId: 'a-flag' }]);
    expect(sheet.closed()).toBe(1);
  });

  test('a font that will not embed warns and never blocks; Text as outlines is the way out', async () => {
    await mountSheet();
    expect(text('[data-testid="export-print-font-warn"]')).toBe(
      'Avenir Next Condensed can’t be embedded — the text prints as shapes (same look). Alligators embeds.'
    );
    expect(($('[data-testid="export-submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  test('the one colour line, and print never carries annotations', async () => {
    await mountSheet();
    expect(text('[data-testid="export-print-colour"]')).toBe(
      'RGB — the print shop converts to CMYK.'
    );
    expect(($('[data-testid="export-include-annotations"]') as HTMLInputElement).disabled).toBe(
      true
    );
  });

  test('PDF (plain) drops the Print row and the print options', async () => {
    await mountSheet();
    await click('[data-testid="export-print-format-pdf"]');
    expect($('[data-testid="export-row-print"]')).toBeNull();
    expect(all('[data-testid="export-paper-crop"]')).toHaveLength(0);
    await click('[data-testid="export-submit"]');
    expect(jobs()[0]?.body?.spec?.options?.print).toBeUndefined();
  });

  test('PNG of a print page is a 300 dpi picture', async () => {
    await mountSheet();
    await click('[data-testid="export-print-format-png"]');
    expect(all('[data-testid="export-paper-crop"]')).toHaveLength(0);
    await click('[data-testid="export-submit"]');
    expect(jobs()[0]?.body?.spec?.format).toBe('png');
    expect(jobs()[0]?.body?.spec?.options?.size).toEqual({ dpi: 300 });
  });

  test('what is exported is asked once; ticking a box does not ask the server again', async () => {
    await mountSheet();
    const before = preflights().length;
    expect(before).toBeGreaterThanOrEqual(1);
    await click('[data-testid="export-print-bleed"]');
    await click('[data-testid="export-print-crop"]');
    await act(async () => {
      await tick(400);
    });
    expect(preflights().length).toBe(before);
    expect(preflights()[0]?.body?.spec?.options).toBeUndefined();
  });

  test('a server that cannot answer leaves the rows and no warnings', async () => {
    await mountSheet({}, { error: 'nope' });
    expect($('[data-testid="export-print"]') !== null).toBe(true);
    expect($('[data-testid="export-print-safe-warn"]')).toBeNull();
    expect($('[data-testid="export-print-font-warn"]')).toBeNull();
    expect($('[data-testid="export-print-colour"]') !== null).toBe(true);
  });
});
