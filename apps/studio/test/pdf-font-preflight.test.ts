// Font preflight classification — issue #116, Task 2.
//
// Fixtures are hand-built pdf-lib object graphs rather than real Chromium
// captures: the thing under test is how we READ a font dictionary, and a real
// capture would couple this to a browser and to whatever fonts the running
// machine happens to have installed. The shapes below are the exact ones the
// issue's `pdffonts` table shows (CID TrueType embedded, Type 3, and the same
// base name appearing as both).

import { describe, expect, test } from 'bun:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';

import {
  analyzePdfFonts,
  describeFontProblem,
  stripSubsetPrefix,
  unprintableFonts,
} from '../exporters/pdf-fonts.ts';

/** A minimal `/FontFile2` stream — the presence of the stream is the signal. */
function fontProgram(doc: PDFDocument) {
  return doc.context.register(
    PDFRawStream.of(doc.context.obj({ Length: 4 }), new Uint8Array([0, 1, 0, 0]))
  );
}

/** A simple (non-composite) TrueType font, embedded or not. */
function simpleFont(doc: PDFDocument, baseFont: string, embedded: boolean) {
  const descriptor = doc.context.obj({
    Type: 'FontDescriptor',
    FontName: baseFont,
    ...(embedded ? { FontFile2: fontProgram(doc) } : {}),
  });
  return doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: baseFont,
      FontDescriptor: doc.context.register(descriptor),
    })
  );
}

/**
 * A composite (`Type0`) font — the shape `pdffonts` prints as "CID TrueType".
 * The font program hangs off the DESCENDANT, which is the whole point of
 * having this fixture: a classifier that reads `/FontDescriptor` off the
 * parent finds nothing here.
 */
function compositeFont(doc: PDFDocument, baseFont: string, embedded: boolean) {
  const descriptor = doc.context.register(
    doc.context.obj({
      Type: 'FontDescriptor',
      FontName: baseFont,
      ...(embedded ? { FontFile2: fontProgram(doc) } : {}),
    })
  );
  const descendant = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: baseFont,
      FontDescriptor: descriptor,
    })
  );
  const descendants = PDFArray.withContext(doc.context);
  descendants.push(descendant);
  return doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: baseFont,
      Encoding: 'Identity-H',
      DescendantFonts: descendants,
    })
  );
}

/**
 * A Type 3 font — glyphs as content streams, no font program anywhere.
 *
 * `extra` adds the fields today's Chromium writes INSTEAD of a `/BaseFont`
 * (B4, 2026-11-10): a `/FontDescriptor` carrying `/FontName` + `/FontFamily`,
 * and optionally the PDF 1.0 `/Name`.
 */
function type3Font(
  doc: PDFDocument,
  baseFont: string | null,
  extra: { fontName?: string; fontFamily?: string; name?: string } = {}
) {
  const proc = doc.context.register(
    PDFRawStream.of(doc.context.obj({ Length: 3 }), new TextEncoder().encode('0 g'))
  );
  const descriptor =
    extra.fontName || extra.fontFamily
      ? doc.context.register(
          doc.context.obj({
            Type: 'FontDescriptor',
            ...(extra.fontName ? { FontName: extra.fontName } : {}),
            ...(extra.fontFamily ? { FontFamily: PDFString.of(extra.fontFamily) } : {}),
            FontWeight: 700,
          })
        )
      : null;
  return doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type3',
      ...(baseFont ? { BaseFont: baseFont } : {}),
      ...(extra.name ? { Name: extra.name } : {}),
      ...(descriptor ? { FontDescriptor: descriptor } : {}),
      FontBBox: [0, 0, 1000, 1000],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: doc.context.register(doc.context.obj({ a: proc })),
    })
  );
}

/** Attach a `{ name -> fontRef }` map as a page's `/Font` resources. */
function attachFonts(
  doc: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  fonts: Record<string, ReturnType<PDFDocument['context']['register']>>
): void {
  const fontDict = PDFDict.withContext(doc.context);
  for (const [key, ref] of Object.entries(fonts)) fontDict.set(PDFName.of(key), ref);
  const resources = PDFDict.withContext(doc.context);
  resources.set(PDFName.of('Font'), fontDict);
  page.node.set(PDFName.of('Resources'), resources);
}

describe('pdf-fonts — stripSubsetPrefix', () => {
  test('strips a six-capital subset prefix', () => {
    expect(stripSubsetPrefix('AAAAAA+AvenirNextCondensed-Heavy')).toBe('AvenirNextCondensed-Heavy');
  });

  test('leaves a name that merely contains a plus, or a shorter prefix, alone', () => {
    expect(stripSubsetPrefix('Noto+Sans')).toBe('Noto+Sans');
    expect(stripSubsetPrefix('ABC+Foo')).toBe('ABC+Foo');
    expect(stripSubsetPrefix('Helvetica')).toBe('Helvetica');
  });
});

describe('pdf-fonts — analyzePdfFonts classification', () => {
  test('a composite font with a descendant font program is embedded', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, { F1: compositeFont(doc, 'AAAAAA+Menlo-Bold', true) });

    const fonts = analyzePdfFonts(doc);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({
      name: 'Menlo-Bold',
      kind: 'embedded',
      subtype: 'Type0',
      syntheticItalicSuspect: false,
    });
    expect(unprintableFonts(fonts)).toHaveLength(0);
  });

  test('a composite font WITHOUT a descendant font program is not-embedded', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, { F1: compositeFont(doc, 'Menlo-Bold', false) });

    expect(analyzePdfFonts(doc)[0]).toMatchObject({ name: 'Menlo-Bold', kind: 'not-embedded' });
  });

  test('a simple font with no FontDescriptor at all is not-embedded', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const bare = doc.context.register(
      doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' })
    );
    attachFonts(doc, page, { F1: bare });

    expect(analyzePdfFonts(doc)[0]).toMatchObject({ name: 'Helvetica', kind: 'not-embedded' });
  });

  test('a simple embedded TrueType font is embedded', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, { F1: simpleFont(doc, 'BBBBBB+Inter', true) });

    expect(analyzePdfFonts(doc)[0]).toMatchObject({ name: 'Inter', kind: 'embedded' });
  });

  test('a Type 3 font is type3 regardless of anything else', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, { F1: type3Font(doc, 'DAAAAA+AlligatorsSigns-Fill') });

    const fonts = analyzePdfFonts(doc);
    expect(fonts[0]).toMatchObject({ name: 'AlligatorsSigns-Fill', kind: 'type3' });
    expect(unprintableFonts(fonts)).toHaveLength(1);
  });

  test('a Type 3 font with no BaseFont still appears in the report', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, { F1: type3Font(doc, null) });

    expect(analyzePdfFonts(doc)[0]).toMatchObject({
      name: '(unnamed Type3)',
      kind: 'type3',
    });
  });

  // B4 (fix-bulk 2026-11-10) — a Gators-Bold (Arvo Bold woff2) headline came out of Chromium as
  // Type 3 and the preflight said only "(unnamed Type3)": today's Skia writes no /BaseFont on a
  // Type 3 font, but it does write a /FontDescriptor with the face's /FontName and /FontFamily.
  test('a Chromium Type 3 font is named from its FontDescriptor, not "(unnamed Type3)"', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, {
      F1: type3Font(doc, null, { fontName: 'AAAAAA+Arvo-Bold', fontFamily: 'Arvo' }),
    });
    const fonts = analyzePdfFonts(doc);
    expect(fonts[0]).toMatchObject({ name: 'Arvo-Bold', kind: 'type3' });
    expect(describeFontProblem(unprintableFonts(fonts)).reason).toContain('Arvo-Bold');
  });

  test('a Type 3 descriptor with only a family is named by the family', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, { F1: type3Font(doc, null, { fontFamily: 'Arvo' }) });
    expect(analyzePdfFonts(doc)[0]).toMatchObject({ name: 'Arvo', kind: 'type3' });
  });

  test('a Type 3 font with only the PDF 1.0 /Name is named by it', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, { F1: type3Font(doc, null, { name: 'T3Gators' }) });
    expect(analyzePdfFonts(doc)[0]).toMatchObject({ name: 'T3Gators', kind: 'type3' });
  });

  test('a synthetic italic is still spotted when the Type 3 half is named only by its descriptor', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, {
      F1: compositeFont(doc, 'AAAAAA+Arvo-Bold', true),
      F2: type3Font(doc, null, { fontName: 'BAAAAA+Arvo-Bold', fontFamily: 'Arvo' }),
    });
    const t3 = analyzePdfFonts(doc).find((f) => f.kind === 'type3');
    expect(t3).toMatchObject({ name: 'Arvo-Bold', syntheticItalicSuspect: true });
  });
});

describe('pdf-fonts — dedupe and the synthetic-italic signal', () => {
  test('the same font on many pages is reported once', async () => {
    const doc = await PDFDocument.create();
    const shared = compositeFont(doc, 'AAAAAA+Menlo-Bold', true);
    for (let i = 0; i < 4; i += 1) {
      attachFonts(doc, doc.addPage([100, 100]), { F1: shared });
    }
    expect(analyzePdfFonts(doc)).toHaveLength(1);
  });

  test('the issue’s exact row: one base name as BOTH Type 3 and embedded', async () => {
    // `HAAAAA+AvenirNextCondensed-HeavyItalic` appears twice in the reported
    // pdffonts output, once Type 3 and once CID TrueType. Both must survive
    // dedupe (they are different problems) and the Type 3 one must be flagged.
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, {
      F1: type3Font(doc, 'HAAAAA+AvenirNextCondensed-HeavyItalic'),
      F2: compositeFont(doc, 'HAAAAA+AvenirNextCondensed-HeavyItalic', true),
      F3: compositeFont(doc, 'AAAAAA+AvenirNextCondensed-Heavy', true),
    });

    const fonts = analyzePdfFonts(doc);
    expect(fonts).toHaveLength(3);

    const italicType3 = fonts.find(
      (f) => f.name === 'AvenirNextCondensed-HeavyItalic' && f.kind === 'type3'
    );
    expect(italicType3?.syntheticItalicSuspect).toBe(true);

    const italicReal = fonts.find(
      (f) => f.name === 'AvenirNextCondensed-HeavyItalic' && f.kind === 'embedded'
    );
    expect(italicReal?.syntheticItalicSuspect).toBe(false);
  });

  test('a Type 3 colour font with no embedded twin is NOT flagged as synthetic italic', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    attachFonts(doc, page, {
      F1: type3Font(doc, 'EAAAAA+AlligatorsSigns-Color'),
      F2: compositeFont(doc, 'AAAAAA+AvenirNextCondensed-Heavy', true),
    });

    const colour = analyzePdfFonts(doc).find((f) => f.kind === 'type3');
    expect(colour?.syntheticItalicSuspect).toBe(false);
  });
});

describe('pdf-fonts — Form XObject recursion (the pageFit path)', () => {
  test('fonts inside an embedded page XObject are found', async () => {
    // Exactly what `applyPageFit` produces: the original page becomes a Form
    // XObject drawn on a fresh page, so its fonts are no longer in the page's
    // own /Font resources.
    //
    // The save/reload round trip is NOT incidental scaffolding — pdf-lib
    // DEFERS `embedPage` until flush, so before a save the page's
    // `/XObject` entry is a ref pointing at an object that does not exist yet
    // and the recursion has nothing to walk. This is why the adapter analyzes
    // the SAVED BYTES rather than the in-memory document; asserting against
    // the unflushed document here would have let that ship.
    const inner = await PDFDocument.create();
    const innerPage = inner.addPage([200, 200]);
    attachFonts(inner, innerPage, { F1: type3Font(inner, 'XAAAAA+Hidden-Type3') });
    innerPage.drawRectangle({ x: 10, y: 10, width: 50, height: 50 }); // needs /Contents to embed

    const outer = await PDFDocument.load(await inner.save());
    const embedded = await outer.embedPage(outer.getPage(0));
    const host = outer.insertPage(0, [400, 400]);
    host.drawPage(embedded, { x: 0, y: 0, width: 200, height: 200 });
    outer.removePage(1);

    const flushed = await PDFDocument.load(await outer.save());
    expect(analyzePdfFonts(flushed).map((f) => f.name)).toContain('Hidden-Type3');
  });

  test('the same document BEFORE a flush reports nothing — the reason we analyze saved bytes', async () => {
    const inner = await PDFDocument.create();
    const innerPage = inner.addPage([200, 200]);
    attachFonts(inner, innerPage, { F1: type3Font(inner, 'XAAAAA+Hidden-Type3') });
    innerPage.drawRectangle({ x: 10, y: 10, width: 50, height: 50 });

    const outer = await PDFDocument.load(await inner.save());
    const embedded = await outer.embedPage(outer.getPage(0));
    const host = outer.insertPage(0, [400, 400]);
    host.drawPage(embedded, { x: 0, y: 0, width: 200, height: 200 });
    outer.removePage(1);

    // Pinned deliberately: if a future pdf-lib makes embedding eager this
    // flips, and whoever sees it fail should read the comment above and
    // simplify the adapter rather than "fix" the test.
    expect(analyzePdfFonts(outer)).toHaveLength(0);
  });
});

describe('pdf-fonts — describeFontProblem', () => {
  test('names Type 3 and non-embedded fonts separately, with the outline remedy', () => {
    const { reason, remedy } = describeFontProblem([
      {
        name: 'AlligatorsSigns-Color',
        kind: 'type3',
        subtype: 'Type3',
        syntheticItalicSuspect: false,
      },
      { name: 'Helvetica', kind: 'not-embedded', subtype: 'Type1', syntheticItalicSuspect: false },
    ]);
    expect(reason).toContain('1 font exported as Type 3 (AlligatorsSigns-Color)');
    expect(reason).toContain('1 font not embedded (Helvetica)');
    expect(remedy).toContain('text=outline');
    expect(remedy).not.toContain('synthetic italic');
  });

  test('adds the source-level fix when a synthetic italic is suspected', () => {
    const { remedy } = describeFontProblem([
      {
        name: 'AvenirNextCondensed-HeavyItalic',
        kind: 'type3',
        subtype: 'Type3',
        syntheticItalicSuspect: true,
      },
    ]);
    expect(remedy).toContain('AvenirNextCondensed-HeavyItalic looks like a synthetic italic');
  });
});
