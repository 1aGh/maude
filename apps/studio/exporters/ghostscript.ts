// Ghostscript — the `text: 'outline'` post-pass for PDF export (issue #116).
//
// Chromium emits Type 3 fonts for colour fonts and synthetic italics and has
// no switch to stop it; `page.pdf()` has no outline mode; and pdf-lib cannot
// convert a glyph to a path. Ghostscript's `-dNoOutputFonts` does exactly one
// thing — replace every glyph with its vector outline — and it is the only
// off-the-shelf tool that does. So this module shells out to it.
//
// WHY AN EXTERNAL BINARY, AND WHY IT IS NOT BUNDLED
// ------------------------------------------------
// Ghostscript is AGPL-3.0 and Maude is MIT. Exec'ing an unmodified `gs` the
// user (or the image) installed is clean and ordinary; shipping it INSIDE the
// signed `.app` would drag AGPL distribution obligations and third-party
// notarization into the packaged product, on every platform, for one opt-in
// export mode. So: `apps/render/Dockerfile` installs it, which makes the cloud
// lane work with no user setup; the desktop app and the npm CLI resolve it off
// PATH and fail LOUD when it is absent. Writing our own outliner was weighed
// and rejected — see the DDR; the short version is that a DOM-side pass cannot
// handle COLRv1 layering (the exact font that motivated the issue) and a
// content-stream pass means emulating the whole PDF text-state machine.
//
// FAILURE POSTURE — DELIBERATELY THE OPPOSITE OF pptx.ts
// -----------------------------------------------------
// `pptx.ts` resolves an optional `svg2pptx` the same way and, when it is
// missing, quietly falls back to a PNG deck. That is right there: the user
// asked for slides and gets slides. It would be WRONG here. A user who asked
// for outlines and silently receives a PDF with live Type 3 fonts has been
// handed the precise artifact this feature exists to prevent, and will find
// out from their printer. Missing `gs` is an error, never a fallback.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PDFArray, PDFDocument, PDFName, PDFNumber, type PDFPage } from 'pdf-lib';

/**
 * argv prefix for Ghostscript. `MAUDE_GHOSTSCRIPT` overrides (space-separated,
 * so a wrapper or an absolute path both work); otherwise the usual binary
 * names — `gs` everywhere, `gswin64c` on Windows (the console build; plain
 * `gswin64` opens a GUI window and never returns).
 *
 * Resolved against the LIVE `process.env.PATH` rather than Bun's startup
 * snapshot, matching `_runtime.ts`'s resolver: the desktop sidecar corrects
 * PATH at spawn time (DDR-128), and a lookup against the stale snapshot would
 * miss a `gs` that is genuinely reachable.
 */
export function ghostscriptArgv(): string[] | null {
  const override = process.env.MAUDE_GHOSTSCRIPT?.trim();
  if (override) return override.split(/\s+/);
  const pathEnv = process.env.PATH;
  const found = Bun.which('gs', { PATH: pathEnv }) ?? Bun.which('gswin64c', { PATH: pathEnv });
  return found ? [found] : null;
}

export const GHOSTSCRIPT_MISSING_MESSAGE =
  'Outlining text needs Ghostscript, which was not found on PATH. ' +
  'Install it (macOS: `brew install ghostscript`, Debian/Ubuntu: `apt-get install ghostscript`, ' +
  'Windows: `choco install ghostscript`), or set MAUDE_GHOSTSCRIPT to its path. ' +
  'Exports run in a Maude workspace (cloud) already have it. ' +
  'Without it, use text=embed to at least verify the fonts, or text=keep for today’s behaviour.';

let _available: boolean | null = null;

/** Is a usable Ghostscript reachable? Memoized — probed at most once per process. */
export async function ghostscriptAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  const argv = ghostscriptArgv();
  if (!argv) {
    _available = false;
    return false;
  }
  try {
    const [bin, ...rest] = argv as [string, ...string[]];
    const proc = Bun.spawn([bin, ...rest, '--version'], { stdout: 'pipe', stderr: 'pipe' });
    _available = (await proc.exited) === 0;
  } catch {
    _available = false;
  }
  return _available;
}

/** Test seam — forget the memoized probe so a test can vary the environment. */
export function resetGhostscriptProbe(): void {
  _available = null;
}

/**
 * The flag set, measured rather than assumed (plan Task 9).
 *
 * `-dNoOutputFonts` is the feature; everything else exists to stop Ghostscript
 * from helpfully ruining the raster content on the way through. Measured on a
 * three-page photo PDF (1600x1200 JPEG per page, `pdfimages -list` before and
 * after):
 *
 *   | flags                                    | size    | image enc | px / ppi |
 *   | pass-through ON  + forced Flate (this)   | 144 483 | jpeg      | identical |
 *   | pass-through ON  only                    | 144 417 | jpeg      | identical |
 *   | pass-through OFF + forced Flate          | 417 369 | flate     | identical |
 *
 * Two things that measurement settles:
 *
 *  1. **`-dPassThroughJPEGImages` is the flag that matters, and it is stated
 *     explicitly on purpose.** It defaults to true, which is why the issue's
 *     hand-run recipe did not corrupt anything — but the third row is what
 *     happens the moment it does not win: every photo is decoded and re-encoded
 *     as Flate, ~3x here and far worse on real photography (this is the
 *     reported 16 MB -> 254 MB). Relying on a default for that is not a plan.
 *  2. **The forced Flate filters stay anyway.** `AutoFilter*` defaults to true,
 *     and for an image Ghostscript genuinely must re-encode (a Flate-encoded
 *     source, which is what Chromium often produces) "auto" is free to choose
 *     DCT — a LOSSY re-encode of lossless print artwork, silently. Pinning the
 *     filter to Flate makes the only re-encode we can be handed a lossless one.
 *
 * `-dDownsample*=false` is the other half of the fidelity guarantee: without
 * it Ghostscript resamples to its default target and quietly destroys print
 * DPI. `-dSAFER` is default-on in gs >= 9.50 but passed explicitly — the input
 * is user content.
 */
export const OUTLINE_FLAGS: readonly string[] = [
  '-sDEVICE=pdfwrite',
  '-dNoOutputFonts',
  '-dCompatibilityLevel=1.7',
  '-dPreserveMarkedContent=false',
  '-dPassThroughJPEGImages=true',
  '-dPassThroughJPXImages=true',
  '-dAutoFilterColorImages=false',
  '-dColorImageFilter=/FlateEncode',
  '-dAutoFilterGrayImages=false',
  '-dGrayImageFilter=/FlateEncode',
  '-dDownsampleColorImages=false',
  '-dDownsampleGrayImages=false',
  '-dDownsampleMonoImages=false',
  '-dBATCH',
  '-dNOPAUSE',
  '-dQUIET',
  '-dSAFER',
];

/** Boxes the outline pass carries over. Neither is inheritable, so each lives on its page leaf. */
const PRINT_BOXES = ['TrimBox', 'BleedBox'] as const;
/** Points. Ghostscript writes boxes at 4 decimals; anything closer than this is the same box. */
const BOX_TOLERANCE_PT = 0.05;

function boxNumbers(page: PDFPage, key: string): [number, number, number, number] | null {
  const raw = page.node.lookup(PDFName.of(key));
  if (!(raw instanceof PDFArray) || raw.size() !== 4) return null;
  const nums = raw.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : Number.NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [x1, y1, x2, y2] = nums as [number, number, number, number];
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/**
 * Put the input's TrimBox / BleedBox back on Ghostscript's output, shifted by however far
 * Ghostscript moved the MediaBox origin (B4, fix-bulk 2026-11-10).
 *
 * A print page with crop marks has a MediaBox with a negative origin (the slug). `pdfwrite`
 * re-bases every page to a 0,0 MediaBox, and a reported run also dropped both boxes — the
 * outlined file then no longer says where to cut, which is the one thing a print PDF must say.
 * Current Ghostscript keeps and shifts them itself; this makes the result independent of the
 * build the user (or the image) has. Only a box the INPUT page set is restored, and only on a
 * page whose MediaBox kept its size (a page Ghostscript rotated or resized is left alone rather
 * than given a box that no longer fits it). Returns whether anything changed.
 */
export function restorePageBoxes(input: PDFDocument, output: PDFDocument): boolean {
  if (input.getPageCount() !== output.getPageCount()) return false;
  let changed = false;
  for (let i = 0; i < input.getPageCount(); i += 1) {
    const src = input.getPage(i);
    const dst = output.getPage(i);
    const a = src.getMediaBox();
    const b = dst.getMediaBox();
    if (
      Math.abs(a.width - b.width) > BOX_TOLERANCE_PT ||
      Math.abs(a.height - b.height) > BOX_TOLERANCE_PT
    )
      continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const key of PRINT_BOXES) {
      const want = boxNumbers(src, key);
      if (!want) continue;
      const [x1, y1, x2, y2] = [want[0] + dx, want[1] + dy, want[2] + dx, want[3] + dy];
      const have = boxNumbers(dst, key);
      if (
        have &&
        [x1, y1, x2, y2].every((v, n) => Math.abs(v - (have[n] as number)) <= BOX_TOLERANCE_PT)
      )
        continue;
      dst.node.set(PDFName.of(key), output.context.obj([x1, y1, x2, y2]));
      changed = true;
    }
  }
  return changed;
}

/**
 * `outlined` with the input's print boxes restored, re-saved only when a box was missing or
 * moved. A document pdf-lib cannot read is returned as Ghostscript wrote it: the box repair is a
 * best effort on top of an outline that already succeeded, never a reason to fail the export.
 */
async function withPrintBoxes(input: Uint8Array, outlined: Uint8Array): Promise<Uint8Array> {
  try {
    const before = await PDFDocument.load(input, { updateMetadata: false });
    const after = await PDFDocument.load(outlined, { updateMetadata: false });
    if (!restorePageBoxes(before, after)) return outlined;
    return await after.save();
  } catch {
    return outlined;
  }
}

export interface OutlineOptions {
  /** Aborts the pass and kills Ghostscript. */
  signal?: AbortSignal;
  /** Wall-clock ceiling. Outlining a photo-heavy print job is genuinely slow. */
  timeoutSec?: number;
}

/**
 * Convert every glyph in `bytes` to vector outlines.
 *
 * Via temp files rather than stdin/stdout: `pdfwrite` seeks in its output, so
 * it cannot write to a pipe, and feeding a large PDF through stdin buys
 * nothing when the output has to land on disk regardless.
 *
 * Throws `GHOSTSCRIPT_MISSING_MESSAGE` when no `gs` resolves, and a message
 * carrying Ghostscript's own stderr when it exits non-zero. It never returns
 * the input unchanged — a caller that gets bytes back gets outlined bytes.
 */
export async function outlinePdf(
  bytes: Uint8Array,
  opts: OutlineOptions = {}
): Promise<Uint8Array> {
  const argv = ghostscriptArgv();
  if (!argv || !(await ghostscriptAvailable())) throw new Error(GHOSTSCRIPT_MISSING_MESSAGE);

  const dir = mkdtempSync(path.join(tmpdir(), 'maude-outline-'));
  const inPath = path.join(dir, 'in.pdf');
  const outPath = path.join(dir, 'out.pdf');
  try {
    await Bun.write(inPath, bytes);
    const [bin, ...rest] = argv as [string, ...string[]];

    // The caller's abort and our own timeout are one signal to the child, so a
    // cancelled export and a hung Ghostscript are killed by the same path.
    const timeoutSec = opts.timeoutSec ?? 600;
    const signals = [AbortSignal.timeout(timeoutSec * 1000)];
    if (opts.signal) signals.push(opts.signal);
    const signal = AbortSignal.any(signals);

    const proc = Bun.spawn([bin, ...rest, '-o', outPath, ...OUTLINE_FLAGS, inPath], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) {
      if (opts.signal?.aborted) throw new Error('export cancelled');
      const detail = stderr.trim().split('\n').slice(0, 4).join(' ').slice(0, 500);
      throw new Error(
        `Ghostscript failed to outline the PDF (exit ${code})${detail ? `: ${detail}` : ''}`
      );
    }
    const outlined = new Uint8Array(readFileSync(outPath));
    return await withPrintBoxes(bytes, outlined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
