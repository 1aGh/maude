// S8.7 — the Print preflight (exporters/print-preflight.ts, pdf-fonts.ts `fontFileReport`,
// POST /_api/export-preflight): the font report for .otf / .ttf fixtures, the safe margin from the
// canvas-rects geometry, the back, and the route's ACL. Pure + handler level: no server, no browser.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Access, resolveAccess } from '../access/scope.ts';
import { fontFileReport } from '../exporters/pdf-fonts.ts';
import {
  paperOf,
  preflightPrint,
  type RectsManifest,
  safeMarginFindings,
} from '../exporters/print-preflight.ts';
import type { SpecCanvas } from '../exporters/scope.ts';
import { mmToPx } from '../print/units.ts';
import { createExportRoutes, type ExportRouteDeps } from '../routes/export.ts';

// ── font fixtures: a minimal sfnt with the tables the report reads ────────────────────────────────
function sfnt(magic: 'ttf' | 'otf', tables: Record<string, Uint8Array>): Uint8Array {
  const tags = Object.keys(tables);
  const dirLen = 12 + tags.length * 16;
  let off = dirLen;
  const total = dirLen + tags.reduce((n, t) => n + (tables[t] as Uint8Array).length, 0);
  const out = new Uint8Array(Math.max(total, 32));
  const dv = new DataView(out.buffer);
  if (magic === 'otf') out.set([0x4f, 0x54, 0x54, 0x4f], 0);
  else dv.setUint32(0, 0x00010000);
  dv.setUint16(4, tags.length);
  tags.forEach((t, i) => {
    const data = tables[t] as Uint8Array;
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.charCodeAt(k);
    dv.setUint32(rec + 8, off);
    dv.setUint32(rec + 12, data.length);
    out.set(data, off);
    off += data.length;
  });
  return out;
}
const os2 = (fsType: number) => {
  const t = new Uint8Array(78);
  new DataView(t.buffer).setUint16(8, fsType);
  return t;
};
const pad = new Uint8Array(8);

describe('fontFileReport — will this font file embed?', () => {
  test('a restricted-licence .otf does not embed; the .ttf with an open licence does', () => {
    const otf = fontFileReport(sfnt('otf', { 'OS/2': os2(0x0002), CFF: pad, head: pad }));
    expect(otf).toMatchObject({ container: 'otf', embeddable: false, reason: 'restricted' });
    const ttf = fontFileReport(sfnt('ttf', { 'OS/2': os2(0), glyf: pad, head: pad }));
    expect(ttf).toMatchObject({ container: 'ttf', embeddable: true, reason: null });
  });

  test('print-and-preview / editable licences embed; bitmap-only does not', () => {
    expect(fontFileReport(sfnt('ttf', { 'OS/2': os2(0x0004), head: pad })).embeddable).toBe(true);
    expect(fontFileReport(sfnt('ttf', { 'OS/2': os2(0x0008), head: pad })).embeddable).toBe(true);
    expect(fontFileReport(sfnt('ttf', { 'OS/2': os2(0x0200), head: pad })).embeddable).toBe(false);
  });

  test('a variable font and a colour font come out as shapes too', () => {
    expect(fontFileReport(sfnt('ttf', { 'OS/2': os2(0), fvar: pad })).reason).toBe('variable');
    expect(fontFileReport(sfnt('ttf', { 'OS/2': os2(0), COLR: pad })).reason).toBe('colour');
  });

  test('a file it cannot read never warns', () => {
    expect(fontFileReport(new Uint8Array([1, 2, 3]))).toMatchObject({ embeddable: true });
    expect(fontFileReport(new Uint8Array(64).fill(7))).toMatchObject({
      embeddable: true,
      reason: 'unreadable',
    });
  });
});

// ── the safe margin, from canvas-rects geometry ───────────────────────────────────────────────────
// A6 (105 × 148 mm) with 3 mm bleed: the artboard is trim + 2 × bleed = 111 × 154 mm at 96 dpi.
const MM = mmToPx(1);
const A6 = paperOf({ paper: 'a6', orientation: 'portrait', bleedMm: 3 });
const AB_W = 111 * MM;
const AB_H = 154 * MM;
const rect = (id: string, xMm: number, yMm: number, wMm: number, hMm: number, text = '') => ({
  cdId: id,
  artboard: 'a-flag',
  x: 500 + xMm * MM,
  y: 40 + yMm * MM,
  w: wMm * MM,
  h: hMm * MM,
  tag: 'div',
  text,
});
const manifest = (...elements: RectsManifest['elements']): RectsManifest => ({
  artboards: [{ id: 'a-flag', x: 500, y: 40, w: AB_W, h: AB_H }],
  elements,
});

describe('safeMarginFindings', () => {
  test('paper follows the artboard’s own print prop: A6 trim, 3 mm bleed, 5 mm default margin', () => {
    expect(A6?.trimMm[0]).toBeCloseTo(105, 1);
    expect(A6?.trimMm[1]).toBeCloseTo(148, 1);
    expect(A6?.bleedMm).toBe(3);
    expect(A6?.marginMm).toEqual([5, 5, 5, 5]);
    expect(paperOf({ paper: 'nonsense' })).toBeNull();
  });

  test('a QR code 2 mm inside the cut is past the 5 mm safe margin; one 8 mm in is fine', () => {
    // bleed 3 + 2 mm → its right edge ends 2 mm from the trim line on the right
    const qr = rect('qr', 3 + 105 - 2 - 22, 3 + 148 - 40, 22, 22, 'Kraví hora');
    const fine = rect('ok', 3 + 8, 3 + 8, 20, 10, 'Hello');
    const f = safeMarginFindings('a-flag', A6 as never, manifest(qr, fine));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      element: 'qr',
      label: 'Kraví hora',
      edge: 'right',
      mm: 2,
      marginMm: 5,
    });
  });

  test('bleed art and page-sized wrappers are not violations', () => {
    const bg = rect('bg', 0, 0, 111, 154); // runs into the bleed
    const band = rect('band', 0, 20, 111, 10); // a band to the edge
    const wrapper = rect('page', 3, 3, 105, 148); // exactly the trim box: a page, not content
    expect(safeMarginFindings('a-flag', A6 as never, manifest(bg, band, wrapper))).toEqual([]);
  });

  test('a margin the artboard sets itself is the one measured against', () => {
    const wide = paperOf({
      paper: 'a6',
      bleedMm: 3,
      marginsMm: { left: 12, right: 5, top: 5, bottom: 5 },
    });
    const el = rect('x', 3 + 8, 3 + 60, 20, 10, 'Left');
    expect(safeMarginFindings('a-flag', A6 as never, manifest(el))).toEqual([]);
    expect(safeMarginFindings('a-flag', wide as never, manifest(el))[0]).toMatchObject({
      edge: 'left',
      mm: 8,
      marginMm: 12,
    });
  });
});

// ── preflightPrint over a real design root ────────────────────────────────────────────────────────
let tmp = '';
let designRoot = '';
const LETAK = `import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";
export default function L() {
  return (
    <DesignCanvas>
      <DCArtboard id="a-flag" label="A · přední (FLAG)" kind="print" print={{ paper: "a6", bleedMm: 3 }} width={420} height={582}><h1 style={{ fontFamily: "Avenir Next Condensed" }}>VYZKOUŠEJ</h1></DCArtboard>
      <DCArtboard id="b-flag" label="B · zadní (FLAG)" kind="print" print={{ paper: "a6", bleedMm: 3 }} width={420} height={582}><p style={{ fontFamily: "Alligators" }}>Hraj</p></DCArtboard>
    </DesignCanvas>
  );
}
`;
const CSS = `
@font-face { font-family: "Avenir Next Condensed"; src: url("fonts/avenir.otf"); }
@font-face { font-family: "Alligators"; src: url("fonts/gator.ttf"); }
@font-face { font-family: "Unused"; src: url("fonts/gator.ttf"); }
@font-face { font-family: "Escape"; src: url("../../secret.otf"); }
@font-face { font-family: "Remote"; src: url("https://evil.example/x.otf"); }
`;
const BOARDS = [
  { id: 'a-flag', label: 'A · přední (FLAG)', kind: 'print', w: 420, h: 582 },
  { id: 'b-flag', label: 'B · zadní (FLAG)', kind: 'print', w: 420, h: 582 },
];

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'maude-preflight-'));
  designRoot = join(tmp, '.design');
  mkdirSync(join(designRoot, 'ui', 'fonts'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'letak.tsx'), LETAK);
  writeFileSync(
    join(designRoot, 'ui', 'letak.css'),
    `${CSS}\n.x { font-family: "Escape", "Remote"; }`
  );
  writeFileSync(
    join(designRoot, 'ui', 'fonts', 'avenir.otf'),
    sfnt('otf', { 'OS/2': os2(0x0002), CFF: pad, head: pad })
  );
  writeFileSync(
    join(designRoot, 'ui', 'fonts', 'gator.ttf'),
    sfnt('ttf', { 'OS/2': os2(0), glyf: pad, head: pad })
  );
  // a font OUTSIDE the design root, reachable by ../ and by a symlink
  writeFileSync(join(tmp, 'secret.otf'), sfnt('otf', { 'OS/2': os2(0x0002), head: pad }));
  symlinkSync(join(tmp, 'secret.otf'), join(designRoot, 'ui', 'fonts', 'link.otf'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('preflightPrint', () => {
  const target = (i: number) => ({
    canvas: 'ui/letak.tsx',
    board: BOARDS[i] as never,
    all: BOARDS,
  });

  test('paper, the back, the fonts that will not embed — and nothing that escapes the design root', async () => {
    const r = await preflightPrint({ designRoot, targets: [target(0)] });
    expect(r.print).toBe(true);
    expect(r.colour).toBe('rgb');
    expect(r.boards[0]).toMatchObject({
      id: 'a-flag',
      back: { id: 'b-flag', label: 'B · zadní (FLAG)' },
    });
    expect(r.boards[0]?.paper?.bleedMm).toBe(3);
    const byFamily = Object.fromEntries(r.fonts.map((f) => [f.family, f]));
    expect(byFamily['Avenir Next Condensed']).toMatchObject({
      embeddable: false,
      reason: 'restricted',
    });
    expect(byFamily.Alligators).toMatchObject({ embeddable: true, reason: null });
    // declared but never used, a ../ escape and a remote url are not read
    expect(byFamily.Unused).toBeUndefined();
    expect(byFamily.Escape).toBeUndefined();
    expect(byFamily.Remote).toBeUndefined();
    expect(r.fonts.every((f) => !f.file.includes('secret') && !f.file.includes('link'))).toBe(true);
    expect(r.measured).toBe(false); // no geometry source: no safe-margin line, nothing blocked
    expect(r.safeMargin).toEqual([]);
  });

  test('with geometry, the safe margin rides along; a render that fails is "unmeasured", not an error', async () => {
    const qr = rect('qr', 3 + 105 - 2 - 22, 3 + 148 - 40, 22, 22, 'QR');
    const ok = await preflightPrint({
      designRoot,
      targets: [target(0)],
      rects: async () => manifest(qr),
    });
    expect(ok.measured).toBe(true);
    expect(ok.safeMargin.map((f) => [f.element, f.mm])).toEqual([['qr', 2]]);
    const failed = await preflightPrint({
      designRoot,
      targets: [target(0)],
      rects: async () => {
        throw new Error('no browser');
      },
    });
    expect([failed.measured, failed.safeMargin]).toEqual([false, []]);
  });

  test('nothing print in the spec → print false', async () => {
    expect((await preflightPrint({ designRoot, targets: [] })).print).toBe(false);
  });
});

// ── the route ─────────────────────────────────────────────────────────────────────────────────────
const CANVASES: SpecCanvas[] = [
  { rel: 'ui/letak.tsx', artboards: BOARDS },
  {
    rel: 'ui/post.tsx',
    artboards: [{ id: 'p', label: 'Post', kind: 'digital', w: 1080, h: 1350 }],
  },
];
const OWNER = resolveAccess({ v: 1, role: 'owner' });
const VIEWER = resolveAccess({ v: 1, role: 'viewer' });
const OBSERVER = resolveAccess({ v: 1, role: 'observer' });
const deps = (access: Access, withPreflight = true): ExportRouteDeps => ({
  designRel: '.design',
  projectName: () => 'Alligators',
  canvases: () => CANVASES,
  activeCanvas: () => 'ui/letak.tsx',
  access: () => access,
  history: () => [],
  renderLane: () => 'local',
  retry: async () => ({ ok: false, reason: 'missing' }) as never,
  ...(withPreflight ? { preflight: { designRoot } } : {}),
});
async function preflight(access: Access, spec: unknown, withPreflight = true) {
  const route = createExportRoutes(deps(access, withPreflight)).find(
    (r) => r.path === '/_api/export-preflight'
  );
  if (!route) throw new Error('no route');
  const res = await route.handle(
    new Request('http://127.0.0.1/_api/export-preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec }),
    }),
    {}
  );
  return { status: res.status, route, body: (await res.json()) as Record<string, unknown> };
}
const SEL = { v: 2, scope: 'selection', format: 'pdf', selection: { artboards: ['a-flag'] } };

describe('POST /_api/export-preflight', () => {
  test('a main-origin EXPORT-class table spec that writes nothing', async () => {
    const { route } = await preflight(OWNER, SEL);
    expect([route.method, route.origin, route.readOnly]).toEqual(['POST', 'main', 'allowed']);
  });

  test('the print artboards the spec reaches, their back, their fonts', async () => {
    const { status, body } = await preflight(VIEWER, SEL);
    expect(status).toBe(200);
    expect(body.print).toBe(true);
    expect((body.boards as Array<{ back: { id: string } }>)[0]?.back.id).toBe('b-flag');
    expect((body.fonts as Array<{ family: string }>).map((f) => f.family).sort()).toEqual([
      'Alligators',
      'Avenir Next Condensed',
    ]);
  });

  test('a screen-only spec has nothing to preflight', async () => {
    const { body } = await preflight(OWNER, {
      v: 2,
      scope: 'canvas',
      canvas: 'ui/post.tsx',
      format: 'png',
    });
    expect([body.print, body.boards]).toEqual([false, []]);
  });

  test('Can view is refused like every export; a bad body is a 400 naming the field', async () => {
    expect((await preflight(OBSERVER, SEL)).status).toBe(403);
    const bad = await preflight(OWNER, { v: 2, scope: 'selection', format: 'pdf', nonsense: 1 });
    expect(bad.status).toBe(400);
  });

  // P8-C4 (09 ex-print) — the paper must not wait for the safe-margin render: a headless render of the canvas
  // takes seconds (25 s when no browser answers), and the preview sat on "Drawing the page…" the whole time.
  // `measure: false` answers paper, back and fonts now; the sheet asks again WITH the render for the margin.
  test('measure:false answers without the geometry render; the default still waits for it', async () => {
    let asked = 0;
    const slow: ExportRouteDeps = {
      ...deps(OWNER),
      preflight: {
        designRoot,
        rects: () => {
          asked += 1;
          return new Promise(() => {}); // never answers
        },
      },
    };
    const route = createExportRoutes(slow).find((r) => r.path === '/_api/export-preflight');
    if (!route) throw new Error('no route');
    const ask = (body: unknown) =>
      route.handle(
        new Request('http://127.0.0.1/_api/export-preflight', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        {}
      );
    const fast = (await ask({ spec: SEL, measure: false })) as Response;
    const body = (await fast.json()) as { boards: Array<{ paper: unknown }>; measured: boolean };
    expect(asked).toBe(0);
    expect(body.measured).toBe(false);
    expect(body.boards[0]?.paper).not.toBeNull();
    // without the flag the route is still waiting on the render
    const raced = await Promise.race([
      ask({ spec: SEL }).then(() => 'answered'),
      new Promise((r) => setTimeout(() => r('waiting'), 150)),
    ]);
    expect(raced).toBe('waiting');
    expect(asked).toBe(1);
    // anything else beside `spec` and `measure` is still a bad body
    const bad = (await ask({ spec: SEL, measure: 'no' })) as Response;
    expect(bad.status).toBe(400);
  });

  test('a stub table without the dep answers "nothing to check", not an error', async () => {
    const { status, body } = await preflight(OWNER, SEL, false);
    expect([status, body.print]).toEqual([200, false]);
  });
});
