// Phase 6.5 T2 — PNG adapter (playwright-native).
//
// Drives `bin/_png-playwright.mjs` — Chromium-via-Playwright with explicit
// viewport sizing per target. The previous `screenshot.sh` path used
// agent-browser which applied its own viewport defaults and produced clipped
// captures of the world-plane background instead of the artboard. With our
// own shim we control the viewport, scroll the artboard to (0,0), then
// `page.screenshot({ clip })`.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import JSZip from 'jszip';
import { CSS_DPI } from '../print/units.ts';
import { colorProfileShimArgs, exportShimPath, runShim } from './_runtime.ts';
import {
  canvasShellUrl,
  type ExportContext,
  type ExportHooks,
  type ExportOptions,
  type ExportResult,
  pastVersionOf,
} from './index.ts';
import type { Target } from './scope.ts';

// DDR-045: resolve via DEV_SERVER_ROOT, never `import.meta.dir` (→ /$bunfs/root
// in a compiled binary). See exporters/_runtime.ts.
const PNG_PLAYWRIGHT = exportShimPath('_png-playwright.mjs');

interface CaptureOptions {
  /** S8.1 — `jpeg` for the JPG adapter (same shim, same capture) */
  type?: RasterType;
  quality?: number;
  /** Fully-resolved Playwright deviceScaleFactor — see resolveDeviceScale. */
  scale?: number;
  timeoutSec?: number;
  /** S8.1b — the past version (commit sha) the shell renders; absent = now */
  at?: string;
  /** S8.1b — the shim's colour-profile arguments (`colorProfileShimArgs`) */
  colorArgs?: string[];
}

/**
 * Coerce an arbitrary `options.scale` into the 1–3 preset range (default 2×).
 * Exported for unit coverage of the item-1 default/clamp behaviour.
 */
export function clampScale(raw: unknown): 1 | 2 | 3 {
  const n = Math.round(Number(raw));
  if (n === 1) return 1;
  if (n === 3) return 3;
  return 2;
}

/** feature-2-print-artboards T4 — supported DPI presets (Adobe-conventional
 *  print ladder). Exported for unit coverage. */
export const DPI_PRESETS = [96, 150, 300, 600] as const;
export type DpiPreset = (typeof DPI_PRESETS)[number];

/** Coerce an arbitrary `options.dpi` to the nearest supported preset, or
 *  `undefined` when absent/invalid (caller then falls back to `scale`). */
export function clampDpi(raw: unknown): DpiPreset | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  let best: DpiPreset = DPI_PRESETS[0];
  let bestDelta = Math.abs(n - best);
  for (const preset of DPI_PRESETS) {
    const delta = Math.abs(n - preset);
    if (delta < bestDelta) {
      best = preset;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * The Playwright `deviceScaleFactor` for a capture — `dpi` (physical print
 * resolution) wins when present, else the legacy 1×/2×/3× UI preset.
 * `dpi/96` because authoring is at CSS px @96dpi (print/units.ts CSS_DPI) —
 * this is the ONE place outside that module allowed to divide by 96 (a
 * device-scale-factor derivation, not an mm→px conversion, so it's exempt
 * from the T1 single-source `25.4` lint guard, but stays in lockstep with
 * CSS_DPI by importing it rather than hardcoding 96 again).
 */
export function resolveDeviceScale(options: ExportOptions): number {
  const dpi = clampDpi(options.dpi);
  if (dpi !== undefined) return dpi / CSS_DPI;
  // S8.1 — an ExportSpec v2 size is exact (0.25–4, validated by spec-v2.ts); the v1 1/2/3
  // preset below stays for every v1 body.
  const exact = Number(options.scaleExact);
  if (Number.isFinite(exact) && exact > 0) return Math.min(4, Math.max(0.25, exact));
  return clampScale(options.scale);
}

/** S8.1 — the raster encodings this capture path writes. */
export type RasterType = 'png' | 'jpeg';
const EXT: Record<RasterType, string> = { png: 'png', jpeg: 'jpg' };
const MIME: Record<RasterType, string> = { png: 'image/png', jpeg: 'image/jpeg' };

async function captureElement(
  target: Extract<Target, { kind: 'element' }>,
  ctx: ExportContext,
  outDir: string,
  options: CaptureOptions,
  hooks?: ExportHooks
): Promise<string[]> {
  const args = [
    PNG_PLAYWRIGHT,
    '--url',
    canvasShellUrl(ctx, target.file, {
      annotations: target.annotations,
      ...(options.at ? { at: options.at } : {}),
    }),
    '--selector',
    target.cssPath,
    '--scale',
    String(options.scale ?? 1),
    '--timeout',
    String(options.timeoutSec ?? 12),
  ];
  if (target.region) {
    // Issue #125 — one image of a world-plane region (whole canvas / selection box).
    args.push(
      '--region',
      target.region === 'canvas' ? 'canvas' : JSON.stringify(target.region),
      '--out',
      path.join(outDir, `${target.canvasSlug}.${EXT[options.type ?? 'png']}`)
    );
  } else if (target.multi) {
    args.push('--multi', '1', '--out-dir', outDir);
  } else {
    // Only widen to the enclosing artboard when scope.ts asked for it
    // (artboard-via-descendant fallback). `selection` scope sets widen=false so
    // the capture is the element exactly; artboard-by-id targets the screen
    // element directly and needs no widening.
    if (target.widen) args.push('--widen-to-artboard', '1');
    args.push('--out', path.join(outDir, `${target.canvasSlug}.${EXT[options.type ?? 'png']}`));
  }
  if (options.type === 'jpeg') {
    args.push('--type', 'jpeg', '--quality', String(options.quality ?? 85));
  }
  if (options.colorArgs?.length) args.push(...options.colorArgs);
  return runShim(args, {
    cwd: path.dirname(PNG_PLAYWRIGHT),
    signal: hooks?.signal,
    onProgress: hooks?.onProgress,
  });
}

function readBytes(paths: string[]): Array<{ name: string; bytes: Uint8Array }> {
  return paths.map((p) => ({
    name: path.basename(p),
    bytes: new Uint8Array(readFileSync(p)),
  }));
}

async function bundleZip(entries: Array<{ name: string; bytes: Uint8Array }>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const e of entries) {
    zip.file(e.name, e.bytes);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export function run(
  targets: Target[],
  options: ExportOptions,
  ctx: ExportContext,
  hooks?: ExportHooks
): Promise<ExportResult> {
  return runRaster('png', targets, options, ctx, hooks);
}

/** The PNG / JPG capture (S8.1: `jpg.ts` is this with `jpeg`). */
export async function runRaster(
  type: RasterType,
  targets: Target[],
  options: ExportOptions,
  ctx: ExportContext,
  hooks?: ExportHooks
): Promise<ExportResult> {
  const ext = EXT[type];
  const mime = MIME[type];
  if (!targets.length) {
    return { filename: `export.${ext}`, contentType: mime, body: new Uint8Array(0) };
  }
  const elementTargets = targets.filter(
    (t): t is Extract<Target, { kind: 'element' }> => t.kind === 'element'
  );
  if (!elementTargets.length) {
    throw new Error(`${ext} adapter requires element targets (got file-tree)`);
  }

  const tmp = mkdtempSync(path.join(tmpdir(), 'maude-png-'));
  const captureOpts: CaptureOptions = {
    // Default 2× — a single-scale PNG was uselessly small (item 1). The dialog
    // sends an explicit scale; this default covers direct API / curl callers.
    // feature-2-print-artboards T4 — `options.dpi` (96/150/300/600) wins over
    // the legacy 1–3 preset when present; the shim re-clamps deviceScaleFactor
    // ≤ 8 and guards oversized output (see _png-playwright.mjs).
    scale: resolveDeviceScale(options),
    timeoutSec: (options.timeoutSec as number | undefined) ?? 8,
    type,
    quality: Math.min(100, Math.max(1, Math.round(Number(options.quality) || 85))),
    at: pastVersionOf(options),
    colorArgs: colorProfileShimArgs(options),
  };
  const p3 = options.colorProfile === 'display-p3';

  try {
    const written: string[] = [];
    for (let i = 0; i < elementTargets.length; i += 1) {
      const paths = await captureElement(elementTargets[i], ctx, tmp, captureOpts, hooks);
      written.push(...paths);
      hooks?.onProgress?.({ current: i + 1, total: elementTargets.length });
    }
    const entries = readBytes(written);
    // S8.1b — a P3 export is handed over only as a P3 file: re-tagging sRGB pixels would change the
    // colours, and an untagged file would silently be sRGB. Either way the export fails, loud.
    if (p3) for (const e of entries) assertDisplayP3(e.bytes, type, e.name);

    if (entries.length === 0) {
      return { filename: `export.${ext}`, contentType: mime, body: new Uint8Array(0) };
    }
    if (entries.length === 1) {
      return {
        filename: entries[0].name,
        contentType: mime,
        body: entries[0].bytes,
      };
    }
    const zipBytes = await bundleZip(entries);
    const baseSlug = elementTargets[0]?.canvasSlug ?? 'export';
    return {
      filename: `${baseSlug}.zip`,
      contentType: 'application/zip',
      body: zipBytes,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── S8.1b: the Display P3 ICC check ─────────────────────────────────────────────────────────────

/** The embedded ICC profile of a PNG (`iCCP`) or a JPEG (APP2 `ICC_PROFILE`, chunks joined), or null. */
export function iccProfileOf(bytes: Uint8Array, type: RasterType): Uint8Array | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === 'png') {
      for (let o = 8; o + 12 <= b.length; ) {
        const len = b.readUInt32BE(o);
        const kind = b.toString('latin1', o + 4, o + 8);
        if (kind === 'iCCP') {
          const data = b.subarray(o + 8, o + 8 + len);
          const nul = data.indexOf(0);
          if (nul < 0 || data[nul + 1] !== 0) return null; // compression method 0 = zlib, the only one
          return new Uint8Array(inflateSync(data.subarray(nul + 2)));
        }
        if (kind === 'IDAT' || kind === 'IEND') return null; // iCCP must come before the image data
        o += 12 + len;
      }
      return null;
    }
    const parts: Buffer[] = [];
    for (let o = 2; o + 4 <= b.length && b[o] === 0xff; ) {
      const marker = b[o + 1];
      if (marker === 0xda || marker === 0xd9) break; // start of scan: no more headers
      const len = b.readUInt16BE(o + 2);
      const seg = b.subarray(o + 4, o + 2 + len);
      if (marker === 0xe2 && seg.toString('latin1', 0, 12) === 'ICC_PROFILE\0')
        parts.push(seg.subarray(14));
      o += 2 + len;
    }
    return parts.length ? new Uint8Array(Buffer.concat(parts)) : null;
  } catch {
    return null;
  }
}

/**
 * Display P3's colorants, D50-adapted (Bradford) as an ICC v4 matrix profile stores them —
 * Apple's "Display P3" and Chromium's own `display-p3-d65` profile agree to 1e-4. An sRGB profile's
 * red is (0.436, 0.222, 0.014), far outside the tolerance.
 */
const DISPLAY_P3_COLORANTS: Record<string, readonly [number, number, number]> = {
  rXYZ: [0.5151, 0.2412, -0.0011],
  gXYZ: [0.292, 0.6922, 0.0419],
  bXYZ: [0.1571, 0.0666, 0.7844],
};

/** Is this ICC profile a Display P3 RGB profile? (reads the matrix colorant tags only) */
export function isDisplayP3Icc(icc: Uint8Array): boolean {
  const b = Buffer.from(icc.buffer, icc.byteOffset, icc.byteLength);
  if (b.length < 132 || b.toString('latin1', 36, 40) !== 'acsp') return false;
  if (b.toString('latin1', 16, 20) !== 'RGB ') return false;
  const count = b.readUInt32BE(128);
  if (count > 100 || 132 + count * 12 > b.length) return false;
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    const sig = b.toString('latin1', at, at + 4);
    const want = DISPLAY_P3_COLORANTS[sig];
    if (!want) continue;
    const off = b.readUInt32BE(at + 4);
    if (off + 20 > b.length || b.toString('latin1', off, off + 4) !== 'XYZ ') return false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(b.readInt32BE(off + 8 + 4 * k) / 65536 - want[k]) > 0.002) return false;
    }
    seen.add(sig);
  }
  return seen.size === 3;
}

/** Refuse a file that is not tagged Display P3 (the P3 export's last gate before hand-over). */
export function assertDisplayP3(bytes: Uint8Array, type: RasterType, name: string): void {
  const icc = iccProfileOf(bytes, type);
  if (!icc || !isDisplayP3Icc(icc))
    throw new Error(
      `${name}: the capture did not come out in Display P3, so it was not saved. Export it as sRGB, ` +
        'or try again — Display P3 needs the browser on this Mac.'
    );
}
