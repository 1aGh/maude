// PDF font preflight — issue #116.
//
// Chromium's `page.pdf()` is vector-faithful for geometry but NOT for every
// font: a COLRv1 colour font (`@font-palette-values`) and a SYNTHETIC italic
// (CSS asks for `italic`, no real italic face is loaded) both come out as
// **Type 3** fonts. A Type 3 font is not a font program at all — each glyph is
// its own little content stream — so a print shop's preflight reports it as
// "font not embedded", Acrobat/Illustrator render it broken, and DTP has to
// re-substitute by hand. The export looked clean from every angle Maude could
// see; the only way to find out was `pdffonts` on the delivered file, or the
// printer refusing it.
//
// This module is the "see it" half. It walks the assembled document's font
// dictionaries and classifies every font, with NO external tool and NO new
// dependency — pdf-lib is already here, it just has no font-inspection API, so
// we walk the object graph by hand. The classification drives both the
// always-on notice (`text: 'keep'`) and the hard refusal (`text: 'embed'`);
// `text: 'outline'` re-runs it after Ghostscript as a self-check.
//
// Deliberately pure (a `PDFDocument` in, an array out): no I/O, no spawn, no
// clock — so it is unit-testable against hand-built fixtures the same way
// `print/marks.ts` is.

import { inflateSync } from 'node:zlib';

import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  type PDFObject,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

/**
 * What a print shop's preflight will say about this font.
 *
 * `type3` is called out separately from `not-embedded` even though a printer
 * rejects both, because the CAUSE and the remedy differ: a Type 3 font is
 * Chromium telling us it had no other representation for these glyphs
 * (outline it), while a genuinely non-embedded font is a font the document
 * merely REFERENCES and expects the reader to have (embed or outline it).
 */
export type PdfFontKind = 'embedded' | 'type3' | 'not-embedded';

export interface PdfFontInfo {
  /** `/BaseFont` with the `AAAAAA+` subset prefix stripped, or a placeholder. */
  name: string;
  kind: PdfFontKind;
  /** Raw `/Subtype` as written in the font dict (`Type0`, `TrueType`, `Type3`, ...). */
  subtype: string;
  /**
   * This Type 3 font's base name ALSO appears in the document as a real
   * embedded font — the signature of a synthetic italic (Chromium slants the
   * upright face itself and emits the slanted glyphs as Type 3, while the
   * unslanted runs still use the real embedded face). Worth surfacing
   * separately because unlike a colour font this one is fixable at the source:
   * load the real italic face and the Type 3 font disappears.
   */
  syntheticItalicSuspect: boolean;
}

/** `AAAAAA+Foo-Bold` -> `Foo-Bold`. A subset prefix is exactly six capitals. */
export function stripSubsetPrefix(baseFont: string): string {
  return baseFont.replace(/^[A-Z]{6}\+/, '');
}

/** Read a `/Name`-valued key as a plain string (`Type0`), or null. */
function nameValue(dict: PDFDict, key: string): string | null {
  const v = dict.lookup(PDFName.of(key));
  return v instanceof PDFName ? v.decodeText() : null;
}

/**
 * Does this FontDescriptor carry an actual font program?
 *
 * `/FontFile` (Type 1), `/FontFile2` (TrueType) and `/FontFile3` (CFF /
 * OpenType) are the three spellings; any one present means the bytes are in
 * the file. A descriptor with none — or no descriptor at all, which is how the
 * standard 14 fonts appear — means the reader is expected to supply the font.
 */
function descriptorHasFontProgram(descriptor: PDFDict): boolean {
  for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
    const v = descriptor.lookup(PDFName.of(key));
    if (v instanceof PDFStream) return true;
  }
  return false;
}

/**
 * Classify ONE font dictionary.
 *
 * The `Type0` branch is the one that is easy to get wrong: a composite font's
 * descriptor lives on its DESCENDANT, not on the parent dict, so reading
 * `/FontDescriptor` off the parent finds nothing and would misreport every
 * embedded CID font in the document as not-embedded — i.e. it would fire the
 * warning on exactly the fonts that are fine.
 */
function classifyFontDict(font: PDFDict): PdfFontInfo | null {
  const subtype = nameValue(font, 'Subtype');
  if (!subtype) return null;

  const baseFontRaw = nameValue(font, 'BaseFont');
  // A Type 3 font is not required to have a /BaseFont at all. Chromium does set
  // one, but a hand-authored or third-party PDF may not — name it after the
  // subtype rather than dropping it from the report.
  const name = baseFontRaw ? stripSubsetPrefix(baseFontRaw) : `(unnamed ${subtype})`;

  if (subtype === 'Type3') {
    return { name, kind: 'type3', subtype, syntheticItalicSuspect: false };
  }

  // Composite font — the real font program hangs off DescendantFonts[0].
  let descriptorHost: PDFDict = font;
  if (subtype === 'Type0') {
    const descendants = font.lookup(PDFName.of('DescendantFonts'));
    const first = descendants instanceof PDFArray ? descendants.lookup(0) : undefined;
    if (first instanceof PDFDict) descriptorHost = first;
  }

  const descriptor = descriptorHost.lookup(PDFName.of('FontDescriptor'));
  const embedded = descriptor instanceof PDFDict && descriptorHasFontProgram(descriptor);
  return {
    name,
    kind: embedded ? 'embedded' : 'not-embedded',
    subtype,
    syntheticItalicSuspect: false,
  };
}

/**
 * Collect every font dict reachable from a resource dict, recursing through
 * Form XObjects.
 *
 * The recursion is not theoretical here: `pdf.ts`'s `pageFit` path embeds the
 * original page as a Form XObject and draws it on a fresh page, which moves
 * every one of its fonts OUT of the page's own `/Font` resources and into the
 * XObject's. A non-recursive walk would report "no fonts" for exactly the
 * scale-to-paper exports that print shops receive.
 *
 * `seen` is keyed on ref numbers, so a shared resource dict (the common case —
 * Chromium reuses one across pages) is walked once, and a cyclic
 * XObject -> Resources -> XObject graph terminates instead of blowing the
 * stack.
 */
function collectFontDicts(
  resources: PDFObject | undefined,
  out: PDFDict[],
  seen: Set<string>
): void {
  if (!(resources instanceof PDFDict)) return;

  const fonts = resources.lookup(PDFName.of('Font'));
  if (fonts instanceof PDFDict) {
    for (const key of fonts.keys()) {
      const ref = fonts.get(key);
      const id = ref instanceof PDFRef ? ref.toString() : null;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const font = fonts.lookup(key);
      if (font instanceof PDFDict) out.push(font);
    }
  }

  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (xobjects instanceof PDFDict) {
    for (const key of xobjects.keys()) {
      const ref = xobjects.get(key);
      const id = ref instanceof PDFRef ? `xo:${ref.toString()}` : null;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const xo = xobjects.lookup(key);
      if (xo instanceof PDFStream) {
        collectFontDicts(xo.dict.lookup(PDFName.of('Resources')), out, seen);
      }
    }
  }
}

/**
 * Every distinct font in the document, classified.
 *
 * Deduped on `(name, kind)` rather than on dict identity: one font that
 * Chromium split across pages is one line in a warning a human reads, not ten.
 * The `(name, kind)` pair — rather than name alone — is deliberate, because the
 * synthetic-italic case genuinely HAS the same base name twice with two
 * different representations, and collapsing those would hide the very signal
 * `syntheticItalicSuspect` exists to report.
 */
export function analyzePdfFonts(doc: PDFDocument): PdfFontInfo[] {
  const dicts: PDFDict[] = [];
  const seen = new Set<string>();
  for (const page of doc.getPages()) {
    // `Resources()`, NOT `lookup(PDFName.of('Resources'))`: `/Resources` is an
    // INHERITABLE page attribute, and a producer is free to hang one shared
    // dict off the Pages node instead of repeating it on every leaf. Reading
    // the leaf directly then finds nothing and reports a document with fonts
    // as having none — silently turning the whole preflight off for exactly
    // the multi-page print exports it exists for.
    collectFontDicts(page.node.Resources(), dicts, seen);
  }

  const byKey = new Map<string, PdfFontInfo>();
  for (const dict of dicts) {
    const info = classifyFontDict(dict);
    if (!info) continue;
    const key = `${info.name} ${info.kind}`;
    if (!byKey.has(key)) byKey.set(key, info);
  }

  const all = [...byKey.values()];
  const embeddedNames = new Set(all.filter((f) => f.kind === 'embedded').map((f) => f.name));
  for (const info of all) {
    if (info.kind === 'type3' && embeddedNames.has(info.name)) info.syntheticItalicSuspect = true;
  }
  return all;
}

/** The fonts a print shop's preflight will reject — Type 3 and non-embedded. */
export function unprintableFonts(fonts: PdfFontInfo[]): PdfFontInfo[] {
  return fonts.filter((f) => f.kind !== 'embedded');
}

/**
 * The one-line problem statement + remedy for a set of bad fonts, shared by the
 * `keep` notice and the `embed` refusal so the two can never drift into
 * describing the same document differently.
 */
export function describeFontProblem(bad: PdfFontInfo[]): { reason: string; remedy: string } {
  const type3 = bad.filter((f) => f.kind === 'type3');
  const missing = bad.filter((f) => f.kind === 'not-embedded');
  const parts: string[] = [];
  if (type3.length) {
    parts.push(
      `${type3.length} font${type3.length === 1 ? '' : 's'} exported as Type 3 ` +
        `(${type3.map((f) => f.name).join(', ')})`
    );
  }
  if (missing.length) {
    parts.push(
      `${missing.length} font${missing.length === 1 ? '' : 's'} not embedded ` +
        `(${missing.map((f) => f.name).join(', ')})`
    );
  }
  const reason = `${parts.join('; ')} — a print shop's preflight will reject ${
    bad.length === 1 ? 'it' : 'them'
  }.`;

  const suspects = bad.filter((f) => f.syntheticItalicSuspect);
  const italicNote = suspects.length
    ? ` ${suspects.map((f) => f.name).join(', ')} looks like a synthetic italic — ` +
      'loading the real italic face fixes that one at the source.'
    : '';
  return {
    reason,
    remedy: `Re-export with text=outline to convert all text to curves.${italicNote}`,
  };
}

// ── S8.7 — the font FILE report (Export sheet › Print preflight) ─────────────────────────────────────
//
// `analyzePdfFonts` above reads the PDF AFTER it exists. The sheet has to say BEFORE the export that a
// headline's font file will not embed ("Avenir Next Condensed Heavy can't be embedded — the headline
// prints as shapes"), so this reads the font file itself, the way Chromium's PDF backend (Skia) decides:
//   - an OS/2 `fsType` that forbids embedding (restricted licence 0x0002, bitmap-only 0x0200) → not embedded;
//   - a variable font (`fvar`) or a colour font (`COLR`/`SVG `/`CBDT`/`sbix`) → exported as Type 3 shapes.
// A plain CFF `.otf` is NOT flagged: Skia embeds it as a CID font, and the post-export check
// (`analyzePdfFonts`, surfaced as `degraded.fontsNotEmbedded`) is the ground truth if that ever differs.
// Pure bytes in, a small record out; a file it cannot read is `unreadable` and never warns.

export type FontFileReason = 'restricted' | 'variable' | 'colour' | 'unreadable';

export interface FontFileReport {
  /** the container, by its magic */
  container: 'ttf' | 'otf' | 'ttc' | 'woff' | 'woff2' | 'unknown';
  /** false only when the file is known not to embed; an unreadable file is "embeddable" (no false alarm) */
  embeddable: boolean;
  reason: FontFileReason | null;
}

const COLOUR_TABLES = new Set(['COLR', 'SVG ', 'CBDT', 'sbix']);
const FS_RESTRICTED = 0x0002;
const FS_BITMAP_ONLY = 0x0200;

/** The sfnt tables of the font starting at `base`: tag → the table's bytes (lazy). */
function sfntTables(
  dv: DataView,
  bytes: Uint8Array,
  base: number
): Map<string, () => Uint8Array | null> {
  const out = new Map<string, () => Uint8Array | null>();
  const n = dv.getUint16(base + 4);
  for (let i = 0; i < n && i < 128; i += 1) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > bytes.length) break;
    const tag = String.fromCharCode(...bytes.subarray(rec, rec + 4));
    const off = dv.getUint32(rec + 8);
    const len = dv.getUint32(rec + 12);
    out.set(tag, () => (off + len <= bytes.length ? bytes.subarray(off, off + len) : null));
  }
  return out;
}

export function fontFileReport(bytes: Uint8Array): FontFileReport {
  const unreadable = (container: FontFileReport['container']): FontFileReport => ({
    container,
    embeddable: true,
    reason: 'unreadable',
  });
  if (bytes.length < 16) return unreadable('unknown');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  try {
    if (magic === 'wOF2') return unreadable('woff2'); // Brotli-wrapped, transformed tables: not inspected
    let tables: Map<string, () => Uint8Array | null>;
    let container: FontFileReport['container'];
    if (magic === 'wOFF') {
      container = 'woff';
      tables = new Map();
      const n = dv.getUint16(12);
      for (let i = 0; i < n && i < 128; i += 1) {
        const rec = 44 + i * 20;
        if (rec + 20 > bytes.length) break;
        const tag = String.fromCharCode(...bytes.subarray(rec, rec + 4));
        const off = dv.getUint32(rec + 4);
        const comp = dv.getUint32(rec + 8);
        const orig = dv.getUint32(rec + 12);
        tables.set(tag, () => {
          if (off + comp > bytes.length || orig > 1 << 20) return null;
          const raw = bytes.subarray(off, off + comp);
          return comp === orig ? raw : new Uint8Array(inflateSync(raw));
        });
      }
    } else if (magic === 'ttcf') {
      container = 'ttc';
      tables = sfntTables(dv, bytes, dv.getUint32(12));
    } else if (magic === 'OTTO') {
      container = 'otf';
      tables = sfntTables(dv, bytes, 0);
    } else if (dv.getUint32(0) === 0x00010000 || magic === 'true') {
      container = 'ttf';
      tables = sfntTables(dv, bytes, 0);
    } else return unreadable('unknown');
    if (tables.size === 0) return unreadable(container);
    const os2 = tables.get('OS/2')?.();
    if (os2 && os2.length >= 10) {
      const fsType = new DataView(os2.buffer, os2.byteOffset, os2.byteLength).getUint16(8);
      if (fsType & (FS_RESTRICTED | FS_BITMAP_ONLY))
        return { container, embeddable: false, reason: 'restricted' };
    }
    if (tables.has('fvar')) return { container, embeddable: false, reason: 'variable' };
    for (const t of tables.keys())
      if (COLOUR_TABLES.has(t)) return { container, embeddable: false, reason: 'colour' };
    return { container, embeddable: true, reason: null };
  } catch {
    return unreadable('unknown');
  }
}
