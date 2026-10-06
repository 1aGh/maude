// Phase 6.5 T3 — PDF adapter (Playwright page.pdf, vector-faithful).
//
// Uses Chromium's print-to-PDF pipeline so the output is a TRUE vector PDF —
// selectable text, web fonts embedded, SVG primitives kept as paths. The old
// pdf-lib-over-PNG approach (which the user correctly complained was raster)
// is gone; this adapter is now ~50 lines because Chromium does the work.
//
// Multi-target rendering: one PDF per target via the playwright shim, then
// pdf-lib concatenates pages into a single document.
//
// feature-2-print-artboards T5 — print-ready post-pass. When the caller asks
// for it (`options.pdfPrint` and/or `options.pageFit`), every page gets
// loaded into pdf-lib (single-page path now goes through pdf-lib too, not
// just multi) and, per page:
//   - a `kind="print"` artboard's rendered page gets its MediaBox enlarged
//     (negative origin — content coordinates never move), BleedBox set to
//     the full rendered page, TrimBox inset by the artboard's own bleed (read
//     off its `print` JSX prop — never re-passed via options, so the
//     exported boxes can never drift from what the artboard's OWN prop says),
//     and vector crop/registration marks drawn outside TrimBox.
//   - a non-print artboard honors `pageFit` (scale-to-paper via
//     embedPage/drawPage) — finally implementing the long-dead
//     `--option pageFit=a4` documented in export.md.
// RGB PDF + correct boxes + vector marks + metadata — CMYK/PDF-X is
// explicitly out of scope (Design Decision 4); this never claims PDF/X
// compliance.
//
// `options.dpi` (dogfood follow-up to T4/T5) — the page itself is always
// vector (text/shapes are never rasterized), but any raster content ON the
// artboard (a dropped photo, a large-format piece authored at a fraction of
// its real physical size — e.g. a billboard at 1:10 scale) embeds as a
// bitmap whose pixel density is set by the CAPTURING context's
// deviceScaleFactor. `resolveDeviceScale` (exporters/png.ts) is reused here
// unchanged so `dpi` means the same physical resolution in both exporters.

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PDFDocument, type PDFPage, rgb } from 'pdf-lib';
import { readArtboardPrintProp } from '../canvas-edit.ts';
import { computeMarksGeometry, MARK_STROKE_PT, requiredSlugPt } from '../print/marks.ts';
import { CSS_DPI, getPaperPreset, mmToPt, resolveBleedMm, trimSizeMm } from '../print/units.ts';
import { exportShimPath, runShim } from './_runtime.ts';
import type { ExportDegradation } from './degraded.ts';
import { outlinePdf } from './ghostscript.ts';
import {
  canvasShellUrl,
  type ExportContext,
  type ExportHooks,
  type ExportOptions,
  type ExportResult,
} from './index.ts';
import { analyzePdfFonts, describeFontProblem, unprintableFonts } from './pdf-fonts.ts';
import { clampDpi } from './png.ts';
import type { Target } from './scope.ts';

// DDR-045: resolve via DEV_SERVER_ROOT, never `import.meta.dir`. See _runtime.ts.
const PDF_PLAYWRIGHT = exportShimPath('_pdf-playwright.mjs');

/** `[data-dc-screen="<id>"]` → `<id>` — the exact cssPath shape scope.ts's
 *  'artboard' resolver produces when it knows the artboard id (the common
 *  case — see scope.ts hints.artboardId). Any other selector shape (a
 *  descendant-widen fallback, `:first-of-type`) yields null — the post-pass
 *  then simply skips print geometry for that page rather than guessing. */
export function artboardIdFromCssPath(cssPath: string): string | null {
  const m = /^\[data-dc-screen="([^"]+)"\]$/.exec(cssPath);
  return m ? (m[1] as string) : null;
}

/**
 * `options.printProps` — `{ [repoRelativeCanvasFile]: { [artboardId]: print } }`,
 * attached by the cell when the job dispatches to the render worker
 * (exporters/jobs.ts). Shape-checked here because it crosses a trust boundary
 * (the job body reaches the worker over HTTP); anything else is ignored.
 */
function shippedPrintProps(
  options: ExportOptions
): Record<string, Record<string, Record<string, unknown>>> | null {
  const raw = (options as { printProps?: unknown }).printProps;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, Record<string, Record<string, unknown>>>;
}

/** Resolve a client-supplied `sourceFile` (from `options.selection.file`, a
 *  main-origin but caller-controlled string — see scope.ts's `readHints`)
 *  against `repoRoot`, rejecting anything that escapes it — mirrors
 *  `resolveCanvasAbs`'s containment check (api.ts) so this new read-path
 *  doesn't skip the same-origin path-traversal guard the rest of the
 *  codebase applies to disk reads. Returns null (skip print geometry for
 *  that page) rather than throwing — a bad path here must not fail the export. */
function resolveSourceFileUnderRoot(repoRoot: string, sourceFile: string): string | null {
  const abs = path.resolve(repoRoot, sourceFile);
  const resolvedRoot = path.resolve(repoRoot);
  if (abs !== resolvedRoot && !abs.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return abs;
}

// RCA issue-desktop-print-pdf-save-as-hang-large-payload: a print-DPI
// "canvas as separate" export re-embeds full-size photos independently per
// page (Chromium's page.pdf() has no cross-page image-object dedup, unlike a
// single hand-authored PDF), so several photo-heavy artboards at print DPI
// can legitimately reach hundreds of MB. That's not inherently a bug — a
// real multi-page print-shop deliverable can genuinely be that big — so this
// guard exists to fail loud on a RUNAWAY size, not to cap ordinary print
// output. The desktop Save… path no longer chokes on a large payload either
// way (apps/desktop/src-tauri/src/lib.rs streams it disk-to-disk), so the
// remaining risk this guards is server-side: pdf-lib's `out.save()` below
// must hold the whole assembled document in memory, and the browser (non-
// desktop) download path still loads the full blob into the tab. Reuses
// png.ts's own MAX_OUTPUT_BYTES ceiling (_png-playwright.mjs) rather than a
// fresh number — same "generous RGBA-buffer-scale ceiling, well under
// typical CI/desktop RAM" rationale (DDR-182) applies to a large assembled
// PDF just as much as a large raster buffer. Measured on-disk after capture
// (a PDF's output size, unlike a raster export's, isn't predictable from
// width×height×scale alone). If a legitimate export outgrows this, raise it
// deliberately rather than treating the number as sacred.
export const MAX_TOTAL_OUTPUT_BYTES = 600 * 1024 * 1024;
export function assertTotalSizeOk(paths: string[]): void {
  let total = 0;
  for (const p of paths) total += statSync(p).size;
  if (total > MAX_TOTAL_OUTPUT_BYTES) {
    const mb = Math.round(total / 1024 / 1024);
    const maxMb = Math.round(MAX_TOTAL_OUTPUT_BYTES / 1024 / 1024);
    throw new Error(
      `Print PDF export is too large (~${mb}MB, limit ~${maxMb}MB) — try a lower ` +
        'DPI, exporting fewer artboards at once, or exporting artboards as separate files.'
    );
  }
}

async function capturePdf(
  target: Extract<Target, { kind: 'element' }>,
  ctx: ExportContext,
  outDir: string,
  timeoutSec: number,
  deviceScale: number,
  hooks?: ExportHooks
): Promise<string[]> {
  const args = [
    PDF_PLAYWRIGHT,
    '--url',
    canvasShellUrl(ctx, target.file, { annotations: target.annotations }),
    '--selector',
    target.cssPath,
    '--timeout',
    String(timeoutSec),
    '--scale',
    String(deviceScale),
  ];
  if (target.region) {
    // Issue #125 — one page covering a world-plane region (whole canvas / selection box).
    args.push(
      '--region',
      target.region === 'canvas' ? 'canvas' : JSON.stringify(target.region),
      '--out',
      path.join(outDir, `${target.canvasSlug}.pdf`)
    );
  } else if (target.multi) args.push('--multi', '1', '--out-dir', outDir);
  else {
    // Widen to the enclosing artboard only when scope.ts requested it
    // (artboard-via-descendant fallback). selection / artboard-by-id targets
    // already point at the exact element / screen.
    if (target.widen) args.push('--widen-to-artboard', '1');
    args.push('--out', path.join(outDir, `${target.canvasSlug}.pdf`));
  }

  return runShim(args, {
    cwd: path.dirname(PDF_PLAYWRIGHT),
    signal: hooks?.signal,
    onProgress: hooks?.onProgress,
  });
}

export interface MarksOptions {
  crop: boolean;
  registration: boolean;
  colorBars: boolean;
  pageInfo: boolean;
}

export interface PdfPrintOptions {
  /** Default true when the artboard's own bleedMm > 0 (Design Decision 5). */
  includeBleed?: boolean;
  marks: MarksOptions;
}

/**
 * Validate + clamp `options.pdfPrint` — per exporters/index.ts's own
 * contract, new print params enter through the free-form options bag and
 * MUST be clamped/validated in-adapter (no schema gate exists upstream).
 * Unknown/malformed shapes degrade to "print post-pass off" rather than
 * throwing — a bad options bag should never break a plain export.
 */
export function parsePdfPrintOptions(raw: unknown): PdfPrintOptions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const marksRaw =
    o.marks && typeof o.marks === 'object' && !Array.isArray(o.marks)
      ? (o.marks as Record<string, unknown>)
      : {};
  return {
    includeBleed: typeof o.includeBleed === 'boolean' ? o.includeBleed : undefined,
    marks: {
      crop: marksRaw.crop === true,
      registration: marksRaw.registration === true,
      colorBars: marksRaw.colorBars === true,
      pageInfo: marksRaw.pageInfo === true,
    },
  };
}

/** `options.pageFit` — a paper preset id for non-print artboards, or null. */
export function parsePageFit(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return getPaperPreset(raw) ? raw : null;
}

/**
 * How the export should treat text (issue #116).
 *
 *  - `keep`    — today's behaviour. Text stays selectable and searchable; the
 *                fonts are whatever Chromium emitted. A preflight NOTICE is
 *                attached when some of those are unprintable.
 *  - `embed`   — assert every font is a real embedded font program. Type 3 is
 *                a hard failure, named — never a silent pass.
 *  - `outline` — every glyph becomes a vector path (Ghostscript). Print-safe
 *                by construction; text is no longer selectable and the file
 *                can grow substantially.
 */
export type PdfTextMode = 'keep' | 'embed' | 'outline';

/**
 * `options.text` — TOP-LEVEL, not nested under `pdfPrint`, deliberately.
 * `pdfPrint`'s presence is what switches the boxes/marks post-pass on, and
 * text handling is orthogonal to that: a plain non-print PDF can carry Type 3
 * fonts just as easily as a leaflet can.
 *
 * Degrades to `keep` on anything unrecognised rather than throwing, per this
 * adapter's standing rule that a malformed options bag must never break an
 * export (`ExportOptions` is free-form with no schema gate upstream).
 */
export function parsePdfText(raw: unknown): PdfTextMode {
  return raw === 'embed' || raw === 'outline' ? raw : 'keep';
}

/**
 * Classify the fonts in the bytes we are about to hand back.
 *
 * On the SAVED BYTES, not the in-memory `PDFDocument`, and that is load-bearing:
 * pdf-lib DEFERS `embedPage` until flush, so before a save the `pageFit` path's
 * page XObject is a dangling ref and a font walk finds nothing at all. Analysing
 * the document would silently report "no fonts" for exactly the scale-to-paper
 * exports print shops receive. `test/pdf-font-preflight.test.ts` pins both
 * halves of that.
 *
 * Returns null when pdf-lib cannot read the bytes. A preflight is a warning
 * mechanism; it must never become a new way for a successful export to fail.
 */
async function analyzeFinalBytes(bytes: Uint8Array) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return analyzePdfFonts(doc);
  } catch {
    return null;
  }
}

/**
 * Apply `options.text` to the assembled bytes — the one place all three modes
 * are decided, so the fast path and the post-pass path can never disagree about
 * what `embed` means.
 */
export async function applyTextMode(
  bytes: Uint8Array,
  mode: PdfTextMode,
  hooks?: ExportHooks
): Promise<{ body: Uint8Array; degraded?: ExportDegradation }> {
  if (mode === 'outline') {
    const outlined = await outlinePdf(bytes, { signal: hooks?.signal });
    // Ghostscript exited 0 — but "it ran" is not "it worked". Re-run the same
    // preflight over its output: if a font survived, the file LOOKS converted
    // and is not, which is the failure this whole feature exists to make
    // impossible. Better to fail than to hand back a plausible lie.
    const after = await analyzeFinalBytes(outlined);
    if (after && after.length) {
      throw new Error(
        `Ghostscript reported success but ${after.length} font(s) survived outlining ` +
          `(${after.map((f) => f.name).join(', ')}). The PDF was not converted to curves; ` +
          'do not send it to print.'
      );
    }
    assertOutlinedSizeOk(outlined.byteLength);
    return { body: outlined };
  }

  const fonts = await analyzeFinalBytes(bytes);
  if (!fonts) return { body: bytes };
  const bad = unprintableFonts(fonts);
  if (!bad.length) return { body: bytes };

  const { reason, remedy } = describeFontProblem(bad);
  if (mode === 'embed') {
    throw new Error(`text=embed: ${reason} ${remedy}`);
  }
  return {
    body: bytes,
    degraded: { fontsNotEmbedded: bad.map((f) => f.name), reason, remedy },
  };
}

/**
 * Outlining trades file size for print safety — glyphs become path data, and a
 * photo-heavy piece can grow by an order of magnitude. That is a legitimate
 * print deliverable, not a bug, so this reuses the SAME generous ceiling
 * `assertTotalSizeOk` applies to captures rather than a tighter one; it exists
 * to catch a runaway, not to cap ordinary print output.
 *
 * Checked separately because `assertTotalSizeOk` runs on the CAPTURED files,
 * before assembly and long before outlining — the pass that actually creates
 * the growth was downstream of every existing guard.
 */
export function assertOutlinedSizeOk(byteLength: number): void {
  if (byteLength <= MAX_TOTAL_OUTPUT_BYTES) return;
  const mb = Math.round(byteLength / 1024 / 1024);
  const maxMb = Math.round(MAX_TOTAL_OUTPUT_BYTES / 1024 / 1024);
  throw new Error(
    `Outlined PDF is too large (~${mb}MB, limit ~${maxMb}MB) — converting text to curves ` +
      'grows the file. Try exporting fewer artboards per file, a lower DPI, or ' +
      'text=embed (which verifies the fonts without converting them).'
  );
}

/**
 * PDF's own device-scale resolver — deliberately NOT `png.ts`'s
 * `resolveDeviceScale`, which defaults an absent `dpi` to `clampScale(undefined)`
 * = 2× (PNG's own "a 1× export was uselessly small" UX default). A vector PDF's
 * text/shapes are already crisp at 1×; only embedded raster content benefits
 * from a higher capture density, and only when the caller actually asks for
 * it via `dpi` — defaulting every PDF export to 2× would silently double
 * embedded-image weight/render time for the common "just export a PDF" case.
 */
export function resolvePdfDeviceScale(options: ExportOptions): number {
  const dpi = clampDpi(options.dpi);
  return dpi !== undefined ? dpi / CSS_DPI : 1;
}

/**
 * Apply the print-ready post-pass to one page: enlarge MediaBox (negative
 * origin, content untouched), set BleedBox/TrimBox, draw marks. `bleedMm`
 * comes from the artboard's OWN `print` prop (read by the caller) — never a
 * value re-derived here, so on-canvas guides (T3) and this export can never
 * disagree about where the trim line is.
 */
export function applyPrintBoxesAndMarks(
  page: PDFPage,
  bleedMm: number,
  printOpts: PdfPrintOptions
): void {
  const { width: pageWidthPt, height: pageHeightPt } = page.getSize();
  const bleedPt = mmToPt(bleedMm);
  const includeBleed = printOpts.includeBleed ?? bleedMm > 0;

  // Bleed box IS the full rendered page (Design Decision 1 — the artboard
  // authored its own width/height as trim + 2×bleed). Trim box insets by
  // bleedPt on every side. When the caller opts OUT of bleed, both boxes
  // collapse onto the trim rect (still a valid MediaBox ⊇ BleedBox ⊇ TrimBox
  // nesting — degenerate but not violated) and the MediaBox itself starts
  // there too, effectively cropping the bleed strip out of the visible area
  // (PDF viewers/printers clip to MediaBox) without moving any content.
  const trimX = bleedPt;
  const trimY = bleedPt;
  const trimW = Math.max(0, pageWidthPt - 2 * bleedPt);
  const trimH = Math.max(0, pageHeightPt - 2 * bleedPt);
  const baseBox = includeBleed
    ? { x: 0, y: 0, w: pageWidthPt, h: pageHeightPt }
    : { x: trimX, y: trimY, w: trimW, h: trimH };

  const wantsMarks = printOpts.marks.crop || printOpts.marks.registration;
  const slugPt = wantsMarks
    ? requiredSlugPt({ crop: printOpts.marks.crop, registration: printOpts.marks.registration })
    : 0;

  page.setMediaBox(
    baseBox.x - slugPt,
    baseBox.y - slugPt,
    baseBox.w + 2 * slugPt,
    baseBox.h + 2 * slugPt
  );
  page.setBleedBox(
    includeBleed ? 0 : trimX,
    includeBleed ? 0 : trimY,
    includeBleed ? pageWidthPt : trimW,
    includeBleed ? pageHeightPt : trimH
  );
  page.setTrimBox(trimX, trimY, trimW, trimH);

  if (wantsMarks) {
    // Marks always reference the FULL render (bleed-box) coordinate frame —
    // they show where the trim line is regardless of whether bleed itself is
    // included in the visible MediaBox.
    const geo = computeMarksGeometry({
      pageWidthPt,
      pageHeightPt,
      bleedPt,
      crop: printOpts.marks.crop,
      registration: printOpts.marks.registration,
    });
    const black = rgb(0, 0, 0);
    for (const seg of geo.cropMarks) {
      page.drawLine({
        start: { x: seg.x1, y: seg.y1 },
        end: { x: seg.x2, y: seg.y2 },
        thickness: MARK_STROKE_PT,
        color: black,
      });
    }
    for (const mark of geo.registrationMarks) {
      page.drawCircle({
        x: mark.circle.cx,
        y: mark.circle.cy,
        size: mark.circle.r,
        borderColor: black,
        borderWidth: MARK_STROKE_PT,
      });
      for (const seg of mark.crosshair) {
        page.drawLine({
          start: { x: seg.x1, y: seg.y1 },
          end: { x: seg.x2, y: seg.y2 },
          thickness: MARK_STROKE_PT,
          color: black,
        });
      }
    }
  }
}

/**
 * `pageFit` — scale-to-paper for a NON-print artboard (Design Decision 6's
 * counterpart for the export.md `--option pageFit=a4` surface: PDF is
 * always vector, so "DPI" never applies here). Embeds the rendered page as
 * an XObject on a fresh page sized to the target paper, uniformly scaled +
 * centered, and swaps it in at the same index.
 */
export async function applyPageFit(
  doc: PDFDocument,
  pageIndex: number,
  paperId: string
): Promise<void> {
  const preset = getPaperPreset(paperId);
  if (!preset) return;
  const { widthMm, heightMm } = trimSizeMm(preset, 'portrait');
  const widthPt = mmToPt(widthMm);
  const heightPt = mmToPt(heightMm);
  const original = doc.getPage(pageIndex);
  const { width: origW, height: origH } = original.getSize();
  if (origW <= 0 || origH <= 0) return;
  const embedded = await doc.embedPage(original);
  const scale = Math.min(widthPt / origW, heightPt / origH);
  const drawW = origW * scale;
  const drawH = origH * scale;
  const newPage = doc.insertPage(pageIndex, [widthPt, heightPt]);
  newPage.drawPage(embedded, {
    x: (widthPt - drawW) / 2,
    y: (heightPt - drawH) / 2,
    width: drawW,
    height: drawH,
  });
  doc.removePage(pageIndex + 1); // the original, now shifted one slot later
}

export async function run(
  targets: Target[],
  options: ExportOptions,
  ctx: ExportContext,
  hooks?: ExportHooks
): Promise<ExportResult> {
  if (!targets.length) {
    return { filename: 'export.pdf', contentType: 'application/pdf', body: new Uint8Array(0) };
  }
  const elementTargets = targets.filter(
    (t): t is Extract<Target, { kind: 'element' }> => t.kind === 'element'
  );
  if (!elementTargets.length) {
    throw new Error('pdf adapter requires element targets (got file-tree)');
  }
  const timeoutSec = (options.timeoutSec as number | undefined) ?? 12;
  const printOpts = parsePdfPrintOptions(options.pdfPrint);
  const pageFit = parsePageFit(options.pageFit);
  const textMode = parsePdfText(options.text);
  // Dogfood follow-up — raster CONTENT on the artboard (a dropped photo, a
  // large-format piece authored at a fraction of its physical size) needs a
  // real deviceScaleFactor to embed at print density; the page itself stays
  // vector regardless (see the file header comment). Default 1× (today's
  // behavior) when `dpi` is absent.
  const deviceScale = resolvePdfDeviceScale(options);
  const tmp = mkdtempSync(path.join(tmpdir(), 'maude-pdf-'));
  try {
    // written[i] = { path, sourceFile (repo-relative canvas), artboardId }.
    // artboardId is per-PAGE — a `--multi` capture writes one file per
    // artboard, so this is populated per file, not per top-level Target.
    const written: Array<{ path: string; sourceFile: string; artboardId: string | null }> = [];
    for (let i = 0; i < elementTargets.length; i += 1) {
      const target = elementTargets[i] as Extract<Target, { kind: 'element' }>;
      const paths = await capturePdf(target, ctx, tmp, timeoutSec, deviceScale, hooks);
      if (target.multi) {
        // _pdf-playwright.mjs names multi output `${data-dc-screen}.pdf`.
        for (const p of paths) {
          written.push({
            path: p,
            sourceFile: target.file,
            artboardId: path.basename(p, '.pdf'),
          });
        }
      } else {
        for (const p of paths) {
          written.push({
            path: p,
            sourceFile: target.file,
            artboardId: artboardIdFromCssPath(target.cssPath),
          });
        }
      }
      hooks?.onProgress?.({ current: i + 1, total: elementTargets.length });
    }
    if (!written.length) {
      return { filename: 'export.pdf', contentType: 'application/pdf', body: new Uint8Array(0) };
    }
    assertTotalSizeOk(written.map((w) => w.path));

    const baseSlug = elementTargets[0]?.canvasSlug ?? 'export';
    const needsPostPass = !!printOpts || !!pageFit;

    // Fast path — no print/pageFit options given: pass Chromium's vector PDF
    // straight through, exactly as before this feature (zero pdf-lib
    // round-trip overhead for the common "just export a PDF" case).
    //
    // The font preflight (`applyTextMode`) DOES parse here, and that is a
    // deliberate cost. This path is what `/design:export pdf` with no options
    // takes — i.e. the most likely way someone exports a leaflet — and a PDF
    // that a print shop will reject while saying nothing is precisely the bug
    // being fixed. The parse is a tokenize + object-table build (raw streams
    // are copied by length, never decoded), and it degrades to silence rather
    // than an error on a PDF pdf-lib cannot read.
    if (!needsPostPass) {
      const [only] = written;
      if (written.length === 1 && only) {
        const bytes = new Uint8Array(readFileSync(only.path));
        const finished = await applyTextMode(bytes, textMode, hooks);
        return {
          filename: `${baseSlug}.pdf`,
          contentType: 'application/pdf',
          body: finished.body,
          ...(finished.degraded ? { degraded: finished.degraded } : {}),
        };
      }
      const out = await PDFDocument.create();
      for (const w of written) {
        const src = await PDFDocument.load(new Uint8Array(readFileSync(w.path)));
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const page of pages) out.addPage(page);
      }
      const bytes = await out.save();
      const finished = await applyTextMode(bytes, textMode, hooks);
      return {
        filename: `${baseSlug}.pdf`,
        contentType: 'application/pdf',
        body: finished.body,
        ...(finished.degraded ? { degraded: finished.degraded } : {}),
      };
    }

    // Post-pass path — every page goes through pdf-lib (single-page case now
    // included, per T5's "extend the existing pdf-lib load to single-page
    // too"), so boxes/marks/pageFit apply uniformly regardless of scope.
    const out = await PDFDocument.create();
    // Cache canvas source text per file — a canvas-as-separate export reads
    // the SAME source repeatedly (once per artboard) otherwise.
    const sourceCache = new Map<string, string>();
    for (const w of written) {
      const src = await PDFDocument.load(new Uint8Array(readFileSync(w.path)));
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const page of pages) {
        const pageIndex = out.getPageCount();
        out.addPage(page);
        let printProp: Record<string, unknown> | null = null;
        // The cell ships the print props inside a REMOTE job (it has the
        // checkout; this process may not — DDR-230). Prefer them; fall back to
        // reading the source on disk for the local lane.
        const shipped = shippedPrintProps(options);
        if (w.artboardId && shipped) {
          printProp = shipped[w.sourceFile]?.[w.artboardId] ?? null;
        } else if (w.artboardId) {
          const abs = resolveSourceFileUnderRoot(ctx.repoRoot, w.sourceFile);
          if (abs) {
            let text = sourceCache.get(abs);
            if (text === undefined) {
              try {
                text = readFileSync(abs, 'utf8');
              } catch {
                text = '';
              }
              sourceCache.set(abs, text);
            }
            if (text) printProp = readArtboardPrintProp(abs, text, w.artboardId);
          }
        }
        if (printProp && printOpts) {
          const paper = typeof printProp.paper === 'string' ? printProp.paper : 'a4';
          const bleedMmRaw = printProp.bleedMm;
          const bleedMm = resolveBleedMm({
            paper,
            bleedMm: typeof bleedMmRaw === 'number' ? bleedMmRaw : undefined,
          });
          applyPrintBoxesAndMarks(page, bleedMm, printOpts);
        } else if (!printProp && pageFit) {
          // Non-print artboard + pageFit requested — scale-to-paper.
          await applyPageFit(out, pageIndex, pageFit);
        }
      }
    }
    const bytes = await out.save();
    // Text handling runs LAST, on the fully assembled document: the boxes are
    // set and the vector crop/registration marks are drawn, so they are part of
    // what Ghostscript preserves rather than something applied to an already
    // outlined file (pdf-lib could not re-open and re-mark it as cleanly).
    const finished = await applyTextMode(bytes, textMode, hooks);
    return {
      filename: `${baseSlug}.pdf`,
      contentType: 'application/pdf',
      body: finished.body,
      ...(finished.degraded ? { degraded: finished.degraded } : {}),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
