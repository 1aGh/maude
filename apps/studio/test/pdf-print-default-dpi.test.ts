// V2-2.8 / B5 — a PDF of a PRINT artboard defaults to 300 dpi; every other PDF stays at 1× (96 dpi).
//
// Why scoped: the PDF page itself is always vector — the device scale only sets the density of
// RASTER content on the artboard (a dropped photo). A print shop wants that at 300 dpi; a web
// artboard exported "just as a PDF" must not silently triple its embedded-image weight, which is why
// a blanket default was rejected (resolvePdfDeviceScale's header comment, DDR-182 follow-up).
//
// Chromium is not needed: `runWithCapture` takes the capture step, so these tests assert what
// density `run()` ASKS the shim for, and what ends up in which page.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import {
  type PdfCapture,
  PRINT_PDF_DEFAULT_DPI,
  resolvePdfDeviceScale,
  runWithCapture,
} from '../exporters/pdf.ts';
import type { Target } from '../exporters/scope.ts';

const PRINT_SCALE = 300 / 96;

// One web artboard + two print artboards (one inline spec, one shared const) in document order.
const CANVAS = [
  'const POSTER_PRINT = { paper: "a3", orientation: "portrait", bleedMm: 3 } as const;',
  'export default function Mixed() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="home" label="Home" kind="web" width={1200} height={800}><div>home</div></DCArtboard>',
  '      <DCArtboard id="flyer" label="Flyer" kind="print" width={816} height={1146} print={{ paper: "a4", bleedMm: 3 }}><div>flyer</div></DCArtboard>',
  '      <DCArtboard id="poster" label="Poster" kind="print" width={1200} height={1700} print={POSTER_PRINT}><div>poster</div></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
].join('\n');

const WEB_ONLY = [
  'export default function Web() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="home" label="Home" kind="web" width={1200} height={800}><div>a</div></DCArtboard>',
  '      <DCArtboard id="about" label="About" kind="web" width={1200} height={800}><div>b</div></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
].join('\n');

let repoRoot: string;
let ctx: { designRoot: string; repoRoot: string; serverOrigin: string };

beforeAll(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'maude-pdf-dpi-'));
  mkdirSync(path.join(repoRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'ui', 'Mixed.tsx'), CANVAS);
  writeFileSync(path.join(repoRoot, 'ui', 'Web.tsx'), WEB_ONLY);
  ctx = {
    designRoot: path.join(repoRoot, '.design'),
    repoRoot,
    serverOrigin: 'http://localhost:0',
  };
});
afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

function target(extra: Partial<Extract<Target, { kind: 'element' }>> = {}): Target {
  return {
    kind: 'element',
    cssPath: '[data-dc-screen="home"]',
    canvasSlug: 'mixed',
    file: 'ui/Mixed.tsx',
    ...extra,
  };
}

interface Call {
  cssPath: string;
  multi: boolean;
  deviceScale: number;
}

const GUARD_MESSAGE =
  '_pdf-playwright.mjs exited 1: _pdf-playwright: requested output 20000×28000px at 3.125× exceeds the ' +
  'render guard (max side 16000px / max ~600MB). For this artboard size (6400×8960px), the max supported DPI is ~240.';

/**
 * A capture that writes real one-page PDFs whose page WIDTH encodes the device scale they were
 * "rendered" at (100 pt × scale), so the result document shows which capture each page came from.
 * `throwWhen` makes a call fail the way the shim's render guard does.
 */
function fakeCapture(
  calls: Call[],
  opts: {
    multiIds?: string[];
    throwWhen?: (c: Call) => Error | null;
  } = {}
): PdfCapture {
  return async (t, _ctx, outDir, _timeout, deviceScale) => {
    const call = { cssPath: t.cssPath, multi: !!t.multi, deviceScale };
    calls.push(call);
    const err = opts.throwWhen?.(call);
    if (err) throw err;
    mkdirSync(outDir, { recursive: true });
    const names = t.multi ? (opts.multiIds ?? []) : [t.canvasSlug];
    const out: string[] = [];
    for (const name of names) {
      const file = path.join(outDir, `${name}.pdf`);
      const doc = await PDFDocument.create();
      doc.addPage([100 * deviceScale, 100]);
      writeFileSync(file, await doc.save());
      out.push(file);
    }
    return out;
  };
}

async function pageWidths(body: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(body);
  return doc.getPages().map((p) => p.getWidth());
}

describe('resolvePdfDeviceScale — the density a page is captured at', () => {
  test('the print default is 300 dpi', () => {
    expect(PRINT_PDF_DEFAULT_DPI).toBe(300);
  });

  test('a print page with no dpi → 300/96', () => {
    expect(resolvePdfDeviceScale({}, { print: true })).toBeCloseTo(PRINT_SCALE, 10);
  });

  test('a non-print page with no dpi → 1× (unchanged)', () => {
    expect(resolvePdfDeviceScale({}, { print: false })).toBe(1);
    expect(resolvePdfDeviceScale({})).toBe(1);
  });

  test('an explicit dpi wins on a print page — up or down', () => {
    expect(resolvePdfDeviceScale({ dpi: 600 }, { print: true })).toBeCloseTo(600 / 96, 10);
    expect(resolvePdfDeviceScale({ dpi: 150 }, { print: true })).toBeCloseTo(150 / 96, 10);
    expect(resolvePdfDeviceScale({ dpi: 96 }, { print: true })).toBe(1);
  });

  test('an explicit dpi on a non-print page is unchanged', () => {
    expect(resolvePdfDeviceScale({ dpi: 300 }, { print: false })).toBeCloseTo(PRINT_SCALE, 10);
  });

  test('a dpi that does not parse is "no dpi" — the print default applies', () => {
    expect(resolvePdfDeviceScale({ dpi: 'abc' }, { print: true })).toBeCloseTo(PRINT_SCALE, 10);
  });
});

describe('run() — which density each target is captured at', () => {
  test('a print artboard with no dpi is captured at 300/96', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ cssPath: '[data-dc-screen="flyer"]' })],
      {},
      ctx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls).toEqual([
      { cssPath: '[data-dc-screen="flyer"]', multi: false, deviceScale: PRINT_SCALE },
    ]);
  });

  test('a print artboard whose print spec is a shared const is recognised too', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ cssPath: '[data-dc-screen="poster"]' })],
      {},
      ctx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls[0]?.deviceScale).toBeCloseTo(PRINT_SCALE, 10);
  });

  test('a web artboard with no dpi is captured at 1×', async () => {
    const calls: Call[] = [];
    await runWithCapture([target()], {}, ctx, undefined, fakeCapture(calls));
    expect(calls).toEqual([{ cssPath: '[data-dc-screen="home"]', multi: false, deviceScale: 1 }]);
  });

  test('an explicit dpi=96 on a print artboard still wins (1×)', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ cssPath: '[data-dc-screen="flyer"]' })],
      { dpi: 96 },
      ctx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls.map((c) => c.deviceScale)).toEqual([1]);
  });

  test('an explicit dpi=600 on a print artboard wins (6.25×)', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ cssPath: '[data-dc-screen="flyer"]' })],
      { dpi: 600 },
      ctx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls.map((c) => c.deviceScale)).toEqual([600 / 96]);
  });

  test('a target whose artboard id is unknown (descendant selector) stays at 1×', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ cssPath: '.hero .title', widen: true })],
      {},
      ctx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls.map((c) => c.deviceScale)).toEqual([1]);
  });

  test('a whole-canvas region page stays at 1×', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ cssPath: '[data-dc-screen]', region: 'canvas' })],
      {},
      ctx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls.map((c) => c.deviceScale)).toEqual([1]);
  });

  test('an unreadable canvas source is "not print" — 1×, no throw', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ file: 'ui/Missing.tsx', cssPath: '[data-dc-screen="flyer"]' })],
      {},
      ctx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls.map((c) => c.deviceScale)).toEqual([1]);
  });

  test('a render worker (no checkout) learns print-ness from the shipped printProps', async () => {
    const calls: Call[] = [];
    const workerCtx = { ...ctx, repoRoot: path.join(repoRoot, 'does-not-exist') };
    await runWithCapture(
      [target({ cssPath: '[data-dc-screen="flyer"]' })],
      { printProps: { 'ui/Mixed.tsx': { flyer: { paper: 'a4', bleedMm: 3 } } } },
      workerCtx,
      undefined,
      fakeCapture(calls)
    );
    expect(calls.map((c) => c.deviceScale)).toEqual([PRINT_SCALE]);
  });
});

describe('run() — a canvas exported as separate pages (multi capture)', () => {
  const MIXED_IDS = ['home', 'flyer', 'poster'];

  test('print pages are re-captured at 300 dpi and replace the 1× page in place; web pages stay 1×', async () => {
    const calls: Call[] = [];
    const r = await runWithCapture(
      [target({ cssPath: '[data-dc-screen]', multi: true })],
      {},
      ctx,
      undefined,
      fakeCapture(calls, { multiIds: MIXED_IDS })
    );
    expect(calls).toEqual([
      { cssPath: '[data-dc-screen]', multi: true, deviceScale: 1 },
      { cssPath: '[data-dc-screen="flyer"]', multi: false, deviceScale: PRINT_SCALE },
      { cssPath: '[data-dc-screen="poster"]', multi: false, deviceScale: PRINT_SCALE },
    ]);
    // Page order is the canvas order; widths encode the scale each page was captured at.
    const widths = await pageWidths(r.body);
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeCloseTo(100, 6); // home — web
    expect(widths[1]).toBeCloseTo(100 * PRINT_SCALE, 6); // flyer — print
    expect(widths[2]).toBeCloseTo(100 * PRINT_SCALE, 6); // poster — print
  });

  test('a canvas with no print artboard is one capture at 1× — exactly as before', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ file: 'ui/Web.tsx', canvasSlug: 'web', cssPath: '[data-dc-screen]', multi: true })],
      {},
      ctx,
      undefined,
      fakeCapture(calls, { multiIds: ['home', 'about'] })
    );
    expect(calls).toEqual([{ cssPath: '[data-dc-screen]', multi: true, deviceScale: 1 }]);
  });

  test('an explicit dpi is one capture for the whole canvas — no per-page split', async () => {
    const calls: Call[] = [];
    await runWithCapture(
      [target({ cssPath: '[data-dc-screen]', multi: true })],
      { dpi: 300 },
      ctx,
      undefined,
      fakeCapture(calls, { multiIds: MIXED_IDS })
    );
    expect(calls).toEqual([{ cssPath: '[data-dc-screen]', multi: true, deviceScale: PRINT_SCALE }]);
  });
});

describe('run() — the 300 dpi DEFAULT never turns a working export into a failure', () => {
  const guard = (c: Call) => (c.deviceScale > 1 ? new Error(GUARD_MESSAGE) : null);

  test('a single print artboard too big for the render guard at 300 dpi falls back to 1×', async () => {
    const calls: Call[] = [];
    const r = await runWithCapture(
      [target({ cssPath: '[data-dc-screen="flyer"]' })],
      {},
      ctx,
      undefined,
      fakeCapture(calls, { throwWhen: guard })
    );
    expect(calls.map((c) => c.deviceScale)).toEqual([PRINT_SCALE, 1]);
    expect(await pageWidths(r.body)).toEqual([100]);
  });

  test('in a multi capture a print page the guard refuses keeps its 1× page', async () => {
    const calls: Call[] = [];
    const r = await runWithCapture(
      [target({ cssPath: '[data-dc-screen]', multi: true })],
      {},
      ctx,
      undefined,
      fakeCapture(calls, { multiIds: ['home', 'flyer', 'poster'], throwWhen: guard })
    );
    expect(await pageWidths(r.body)).toEqual([100, 100, 100]);
  });

  test('an EXPLICIT dpi the guard refuses still fails loud (the user asked for it)', async () => {
    await expect(
      runWithCapture(
        [target({ cssPath: '[data-dc-screen="flyer"]' })],
        { dpi: 600 },
        ctx,
        undefined,
        fakeCapture([], { throwWhen: guard })
      )
    ).rejects.toThrow(/render guard/);
  });

  test('any other capture failure is not swallowed by the fallback', async () => {
    await expect(
      runWithCapture(
        [target({ cssPath: '[data-dc-screen="flyer"]' })],
        {},
        ctx,
        undefined,
        fakeCapture([], { throwWhen: () => new Error('_pdf-playwright.mjs exited 1: timeout') })
      )
    ).rejects.toThrow(/timeout/);
  });
});
