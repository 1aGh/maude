// `options.text` — keep / embed / outline (issue #116).
//
// The Ghostscript round trip is gated on gs actually being present rather than
// mocked: the properties worth asserting (fonts really gone, boxes really
// preserved, images really untouched) are properties OF GHOSTSCRIPT, and a
// mock would assert only that we can spell our own flags. On a machine without
// gs those cases skip and the rest — parsing, the embed refusal, the missing-
// binary error — still run.

import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, rgb } from 'pdf-lib';

import {
  GHOSTSCRIPT_MISSING_MESSAGE,
  ghostscriptAvailable,
  OUTLINE_FLAGS,
  outlinePdf,
  resetGhostscriptProbe,
  restorePageBoxes,
} from '../exporters/ghostscript.ts';
import {
  applyPrintBoxesAndMarks,
  applyTextMode,
  assertOutlinedSizeOk,
  MAX_TOTAL_OUTPUT_BYTES,
  parsePdfText,
} from '../exporters/pdf.ts';
import { analyzePdfFonts } from '../exporters/pdf-fonts.ts';

const hasGs = await ghostscriptAvailable();

afterEach(() => {
  delete process.env.MAUDE_GHOSTSCRIPT;
  resetGhostscriptProbe();
});

describe('parsePdfText', () => {
  test('the two explicit modes pass through', () => {
    expect(parsePdfText('embed')).toBe('embed');
    expect(parsePdfText('outline')).toBe('outline');
  });

  test('absent, malformed or unknown degrades to keep — never throws', () => {
    for (const raw of [undefined, null, '', 'KEEP', 'curves', 'Outline', 42, {}, ['outline']]) {
      expect(parsePdfText(raw)).toBe('keep');
    }
  });
});

describe('assertOutlinedSizeOk', () => {
  test('passes at the ceiling and refuses above it, naming a remedy', () => {
    expect(() => assertOutlinedSizeOk(MAX_TOTAL_OUTPUT_BYTES)).not.toThrow();
    expect(() => assertOutlinedSizeOk(MAX_TOTAL_OUTPUT_BYTES + 1)).toThrow(/text=embed/);
  });
});

describe('ghostscript resolution', () => {
  test('an unresolvable MAUDE_GHOSTSCRIPT yields the actionable missing message', async () => {
    process.env.MAUDE_GHOSTSCRIPT = '/nonexistent/definitely-not-ghostscript';
    resetGhostscriptProbe();
    expect(await ghostscriptAvailable()).toBe(false);
    await expect(outlinePdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      GHOSTSCRIPT_MISSING_MESSAGE
    );
  });

  test('the missing message names an install route and the override', () => {
    expect(GHOSTSCRIPT_MISSING_MESSAGE).toContain('brew install ghostscript');
    expect(GHOSTSCRIPT_MISSING_MESSAGE).toContain('MAUDE_GHOSTSCRIPT');
  });

  test('the flag set pins the fidelity guarantees, not just the outline switch', () => {
    // Each of these was measured (see OUTLINE_FLAGS' comment); a future edit
    // that drops one silently changes what a print deliverable looks like.
    expect(OUTLINE_FLAGS).toContain('-dNoOutputFonts');
    expect(OUTLINE_FLAGS).toContain('-dPassThroughJPEGImages=true');
    expect(OUTLINE_FLAGS).toContain('-dDownsampleColorImages=false');
    expect(OUTLINE_FLAGS).toContain('-dAutoFilterColorImages=false');
    expect(OUTLINE_FLAGS).toContain('-dSAFER');
  });
});

/** A page carrying an embedded-font Type 3 dict — the unprintable shape. */
async function docWithType3(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const proc = doc.context.register(
    PDFRawStream.of(doc.context.obj({ Length: 3 }), new TextEncoder().encode('0 g'))
  );
  const font = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type3',
      BaseFont: 'DAAAAA+AlligatorsSigns-Fill',
      FontBBox: [0, 0, 1000, 1000],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: doc.context.register(doc.context.obj({ a: proc })),
    })
  );
  const fontDict = PDFDict.withContext(doc.context);
  fontDict.set(PDFName.of('F1'), font);
  const resources = PDFDict.withContext(doc.context);
  resources.set(PDFName.of('Font'), fontDict);
  page.node.set(PDFName.of('Resources'), resources);
  page.drawRectangle({ x: 10, y: 10, width: 40, height: 40 });
  return doc;
}

/** A document whose every font is a real embedded program — the clean case. */
async function docWithEmbeddedFontOnly(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const descriptor = doc.context.register(
    doc.context.obj({
      Type: 'FontDescriptor',
      FontName: 'Inter',
      FontFile2: doc.context.register(
        PDFRawStream.of(doc.context.obj({ Length: 4 }), new Uint8Array([0, 1, 0, 0]))
      ),
    })
  );
  const font = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: 'BBBBBB+Inter',
      FontDescriptor: descriptor,
    })
  );
  const fontDict = PDFDict.withContext(doc.context);
  fontDict.set(PDFName.of('F1'), font);
  const resources = PDFDict.withContext(doc.context);
  resources.set(PDFName.of('Font'), fontDict);
  page.node.set(PDFName.of('Resources'), resources);
  page.drawRectangle({ x: 10, y: 10, width: 40, height: 40 });
  return doc.save();
}

describe('applyTextMode — the keep / embed decision', () => {
  test('keep attaches a degradation naming the unprintable fonts, and still returns the file', async () => {
    const bytes = await (await docWithType3()).save();
    const result = await applyTextMode(bytes, 'keep');

    expect(result.body).toBe(bytes); // the export itself is untouched
    expect(result.degraded?.fontsNotEmbedded).toEqual(['AlligatorsSigns-Fill']);
    expect(result.degraded?.reason).toContain('Type 3');
    expect(result.degraded?.remedy).toContain('text=outline');
  });

  test('keep on an all-embedded document attaches nothing at all', async () => {
    const result = await applyTextMode(await docWithEmbeddedFontOnly(), 'keep');
    expect(result.degraded).toBeUndefined();
  });

  test('embed REFUSES a Type 3 document, naming the font', async () => {
    const bytes = await (await docWithType3()).save();
    await expect(applyTextMode(bytes, 'embed')).rejects.toThrow(/AlligatorsSigns-Fill/);
    await expect(applyTextMode(bytes, 'embed')).rejects.toThrow(/text=embed/);
  });

  test('embed passes an all-embedded document through unchanged', async () => {
    const bytes = await docWithEmbeddedFontOnly();
    const result = await applyTextMode(bytes, 'embed');
    expect(result.body).toBe(bytes);
    expect(result.degraded).toBeUndefined();
  });

  test('bytes pdf-lib cannot parse degrade to silence, never to a failed export', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await applyTextMode(garbage, 'keep');
    expect(result.body).toBe(garbage);
    expect(result.degraded).toBeUndefined();
    // …and `embed` cannot invent a refusal it has no evidence for either.
    await expect(applyTextMode(garbage, 'embed')).resolves.toBeDefined();
  });
});

describe.skipIf(!hasGs)('outlinePdf — real Ghostscript round trip', () => {
  test('a print page comes back with no fonts, boxes intact, marks intact', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    const page = doc.addPage([595, 842]);
    page.drawText('Brno Alligators', { x: 40, y: 400, size: 24, font, color: rgb(0, 0, 0) });
    // The print post-pass's own output shape: boxes plus a vector crop mark.
    page.setBleedBox(0, 0, 595, 842);
    page.setTrimBox(8.5, 8.5, 578, 825);
    page.drawLine({
      start: { x: 0, y: 8.5 },
      end: { x: 5, y: 8.5 },
      thickness: 0.25,
      color: rgb(0, 0, 0),
    });
    const before = await doc.save();

    // Fail-first anchor: the input genuinely HAS an unprintable font, so a
    // no-op "outline" could not pass this test by accident.
    expect(analyzePdfFonts(await PDFDocument.load(before)).length).toBeGreaterThan(0);

    const after = await outlinePdf(before, { timeoutSec: 120 });
    const outlined = await PDFDocument.load(after);

    expect(analyzePdfFonts(outlined)).toHaveLength(0);

    // Boxes survive. Asserted on VALUES — Ghostscript rewrites the whole
    // document, so object numbers and byte layout are all different by design.
    const outPage = outlined.getPage(0);
    const trim = outPage.getTrimBox();
    expect(trim.x).toBeCloseTo(8.5, 1);
    expect(trim.y).toBeCloseTo(8.5, 1);
    expect(trim.width).toBeCloseTo(578, 1);
    expect(trim.height).toBeCloseTo(825, 1);
    const bleed = outPage.getBleedBox();
    expect(bleed.width).toBeCloseTo(595, 1);
    expect(bleed.height).toBeCloseTo(842, 1);
    expect(outlined.getPageCount()).toBe(1);

    // The glyphs became geometry: the content stream gained fill/path ops and
    // no longer shows text with a font resource.
    const stream = outPage.node.Contents();
    expect(stream).toBeDefined();
  });

  test('a Type 3 font is exactly what outlining removes', async () => {
    const doc = await docWithType3();
    const before = await doc.save();
    expect(analyzePdfFonts(await PDFDocument.load(before)).some((f) => f.kind === 'type3')).toBe(
      true
    );

    const after = await outlinePdf(before, { timeoutSec: 120 });
    expect(analyzePdfFonts(await PDFDocument.load(after))).toHaveLength(0);
  });

  test('an aborted signal surfaces as a cancellation, not a Ghostscript crash', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
    const bytes = await doc.save();
    const controller = new AbortController();
    controller.abort();
    await expect(outlinePdf(bytes, { signal: controller.signal })).rejects.toThrow(
      /cancelled|abort/i
    );
  });
});

// B4 (fix-bulk 2026-11-10) — a print page with crop marks has a MediaBox with a NEGATIVE origin
// (the slug, -9.92 pt), and a reported Ghostscript run re-based it to 0,0 and dropped TrimBox +
// BleedBox: the outlined file no longer said where to cut. The outline pass now restores both
// boxes, shifted by the same origin offset, whatever the Ghostscript build does.
async function bleedDocWithMarks(): Promise<{ bytes: Uint8Array; slug: number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont('Helvetica');
  for (const registration of [false, true]) {
    const page = doc.addPage([300, 150]);
    page.drawText('Gators', { x: 20, y: 60, size: 24, font, color: rgb(0, 0, 0) });
    applyPrintBoxesAndMarks(page, 3, {
      includeBleed: true,
      marks: { crop: true, registration, colorBars: false, pageInfo: false },
    });
  }
  const slug = -doc.getPage(0).getMediaBox().x;
  return { bytes: await doc.save(), slug };
}

function expectBoxesShifted(before: PDFDocument, after: PDFDocument): void {
  expect(after.getPageCount()).toBe(before.getPageCount());
  for (let i = 0; i < before.getPageCount(); i += 1) {
    const a = before.getPage(i);
    const b = after.getPage(i);
    const dx = b.getMediaBox().x - a.getMediaBox().x;
    const dy = b.getMediaBox().y - a.getMediaBox().y;
    for (const key of ['TrimBox', 'BleedBox'] as const) {
      expect(b.node.get(PDFName.of(key))).toBeDefined();
      const want = key === 'TrimBox' ? a.getTrimBox() : a.getBleedBox();
      const got = key === 'TrimBox' ? b.getTrimBox() : b.getBleedBox();
      expect(got.x).toBeCloseTo(want.x + dx, 1);
      expect(got.y).toBeCloseTo(want.y + dy, 1);
      expect(got.width).toBeCloseTo(want.width, 1);
      expect(got.height).toBeCloseTo(want.height, 1);
    }
  }
}

describe('outlinePdf — TrimBox / BleedBox survive a re-based MediaBox', () => {
  const FAKE_GS = `bun ${path.join(import.meta.dir, 'fixtures', 'fake-gs-drops-boxes.ts')}`;

  test('a Ghostscript that re-bases MediaBox and drops the boxes gets them back, offset applied', async () => {
    const { bytes, slug } = await bleedDocWithMarks();
    expect(slug).toBeGreaterThan(9); // the marks really did push the origin negative
    process.env.MAUDE_GHOSTSCRIPT = FAKE_GS;
    resetGhostscriptProbe();

    const before = await PDFDocument.load(bytes);
    const after = await PDFDocument.load(await outlinePdf(bytes, { timeoutSec: 60 }));
    // Fail-first anchor: the stand-in really re-based the origin.
    expect(after.getPage(0).getMediaBox().x).toBe(0);
    expectBoxesShifted(before, after);
    // Concretely, for page 1: trim 8.5 pt in from the bleed edge, both moved by the slug.
    expect(after.getPage(0).getTrimBox().x).toBeCloseTo(slug + 8.5, 1);
    expect(after.getPage(0).getBleedBox().x).toBeCloseTo(slug, 1);
  });

  test('restorePageBoxes leaves a document whose boxes already match untouched', async () => {
    const { bytes } = await bleedDocWithMarks();
    const doc = await PDFDocument.load(bytes);
    expect(restorePageBoxes(await PDFDocument.load(bytes), doc)).toBe(false);
  });

  test('restorePageBoxes never invents a box the input did not set', async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 100]);
    const out = await PDFDocument.create();
    out.addPage([200, 100]);
    expect(restorePageBoxes(src, out)).toBe(false);
    expect(out.getPage(0).node.get(PDFName.of('TrimBox'))).toBeUndefined();
  });

  test.skipIf(!hasGs)('the real Ghostscript keeps both boxes, offset applied', async () => {
    const { bytes } = await bleedDocWithMarks();
    const before = await PDFDocument.load(bytes);
    const after = await PDFDocument.load(await outlinePdf(bytes, { timeoutSec: 120 }));
    expect(analyzePdfFonts(after)).toHaveLength(0);
    expectBoxesShifted(before, after);
  });
});

describe.skipIf(!hasGs)('applyTextMode — outline end to end', () => {
  test('outline returns different bytes with no fonts and no degradation', async () => {
    const bytes = await (await docWithType3()).save();
    const result = await applyTextMode(bytes, 'outline');

    expect(result.body).not.toBe(bytes);
    expect(analyzePdfFonts(await PDFDocument.load(result.body))).toHaveLength(0);
    // A converted file is not a degraded one — it is exactly what was asked for.
    expect(result.degraded).toBeUndefined();
  });
});

describe.skipIf(!hasGs)('outlinePdf — raster fidelity (the print-DPI guarantee)', () => {
  test('an embedded JPEG survives with identical pixels and encoding', async () => {
    // Synthesised rather than a checked-in binary: a deterministic gradient
    // compresses as a real photo does, and there is no fixture to keep in sync.
    const jpegBytes = await makeJpeg();
    const doc = await PDFDocument.create();
    const jpg = await doc.embedJpg(jpegBytes);
    const page = doc.addPage([595, 842]);
    page.drawImage(jpg, { x: 0, y: 300, width: 595, height: 446 });
    const before = await doc.save();

    const after = await outlinePdf(before, { timeoutSec: 120 });
    const outlined = await PDFDocument.load(after);

    // The image object is still a DCT stream of the same dimensions — i.e.
    // Ghostscript passed it through rather than decoding and re-encoding it.
    // (Recipe measurement: pass-through off turns this into a Flate raster
    // ~3x larger, and downsampling off is what keeps the px count.)
    const raw = findImageStream(outlined);
    expect(raw).not.toBeNull();
    expect(raw?.width).toBe(64);
    expect(raw?.height).toBe(64);
    expect(raw?.filter).toContain('DCTDecode');
  });
});

/** A tiny baseline JPEG, built by hand so the test carries no binary fixture. */
async function makeJpeg(): Promise<Uint8Array> {
  const proc = Bun.spawn(
    [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x64:rate=1',
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await proc.exited;
  return bytes;
}

/** First image XObject in the document, with the facts a printer cares about. */
function findImageStream(
  doc: PDFDocument
): { width: number; height: number; filter: string } | null {
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of('XObject'));
    if (!(xobjects instanceof PDFDict)) continue;
    for (const key of xobjects.keys()) {
      const xo = xobjects.lookup(key);
      if (!(xo instanceof PDFRawStream)) continue;
      const dict = xo.dict;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Image') continue;
      const filter = dict.lookup(PDFName.of('Filter'));
      const filterText =
        filter instanceof PDFName
          ? filter.decodeText()
          : filter instanceof PDFArray
            ? filter.asArray().map(String).join(',')
            : String(filter);
      return {
        width: Number(dict.lookup(PDFName.of('Width'))?.toString()),
        height: Number(dict.lookup(PDFName.of('Height'))?.toString()),
        filter: filterText,
      };
    }
  }
  return null;
}
