// Phase 6.5 T1 — adapter registry + dispatch.
//
// Each format adapter exports a single `run(targets, options, ctx) → Result`
// function. This module owns the (format → adapter) lookup and the shared
// `Result` envelope. Stub adapters live in `./{png,pdf,svg,html,pptx,canva,zip}.ts`
// and currently return zero-byte payloads with valid MIME types — T2…T7
// replace them with real renderers.

import path from 'node:path';

import * as canva from './canva.ts';
import type { ExportDegradation } from './degraded.ts';
import * as html from './html.ts';
import * as pdf from './pdf.ts';
import * as png from './png.ts';
import * as pptx from './pptx.ts';
import { type ResolveScopeArgs, resolveScope, type Scope, type Target } from './scope.ts';
import * as svg from './svg.ts';
// DDR-148 — temporal formats (capture-spine encode). Named exports mp4/webm/gif.
import { gif, mp4, webm } from './video.ts';
import * as zip from './zip.ts';

export type Format =
  | 'png'
  | 'pdf'
  | 'svg'
  | 'html'
  | 'pptx'
  | 'canva'
  | 'zip'
  | 'mp4'
  | 'webm'
  | 'gif';

export const FORMATS: readonly Format[] = [
  'png',
  'pdf',
  'svg',
  'html',
  'pptx',
  'canva',
  'zip',
  'mp4',
  'webm',
  'gif',
];

/** Options bag forwarded to the adapter. Format-specific keys are validated by each adapter. */
export type ExportOptions = Record<string, unknown>;

export interface ExportContext {
  /** Absolute design root (e.g. /abs/.design). */
  designRoot: string;
  /** Absolute repo root. */
  repoRoot: string;
  /** Dev-server origin including port (`http://localhost:NNNN`) — adapters that render via Playwright resolve canvas URLs against this. */
  serverOrigin: string;
  /**
   * designRoot-relative path to the tokens CSS file (e.g. `system/colors_and_type.css`).
   * Threaded into the `?tokens=` query param on the canvas-shell URL so the
   * standalone shell actually loads the project's design tokens — without it
   * `var(--bg-0)` resolves to nothing and renders blank.
   */
  tokensCssRel?: string;
  /** designRoot-relative path to a shared components CSS file (optional). */
  componentsCssRel?: string;
}

export interface ExportResult {
  /** Final filename (no path). E.g. `mockup.pdf` or `mockup.zip`. */
  filename: string;
  /** MIME type for the Content-Disposition / Content-Type header. */
  contentType: string;
  /** Payload bytes. T1 stubs return zero-byte placeholders. */
  body: Uint8Array;
  /** Set when the export succeeded but produced less than was asked for. */
  degraded?: ExportDegradation;
}

export type { ExportDegradation } from './degraded.ts';

/** Progress + cancellation hooks threaded through to the shim-spawning layer. */
export interface ExportHooks {
  onProgress?: (update: { current: number; total: number }) => void;
  signal?: AbortSignal;
}

export interface Adapter {
  run(
    targets: Target[],
    options: ExportOptions,
    ctx: ExportContext,
    hooks?: ExportHooks
  ): Promise<ExportResult>;
}

const REGISTRY: Record<Format, Adapter> = {
  png,
  pdf,
  svg,
  html,
  pptx,
  canva,
  zip,
  mp4,
  webm,
  gif,
};

export function getAdapter(format: Format): Adapter | null {
  return REGISTRY[format] ?? null;
}

export function isFormat(s: unknown): s is Format {
  return typeof s === 'string' && (FORMATS as readonly string[]).includes(s);
}

export function isScope(s: unknown): s is Scope {
  return (
    s === 'selection' ||
    s === 'artboard' ||
    s === 'canvas-as-separate' ||
    s === 'canvas-whole' ||
    s === 'selection-bounds' ||
    s === 'project-raw'
  );
}

/**
 * One-shot dispatch — resolve scope, look up adapter, run it. The HTTP layer
 * is a thin shell over this so CLI/slash can call the same path without
 * re-implementing the orchestration.
 */
export async function runExport(args: {
  format: Format;
  scope: Scope;
  options: ExportOptions;
  resolve: Omit<ResolveScopeArgs, 'scope'>;
  ctx: ExportContext;
  hooks?: ExportHooks;
}): Promise<ExportResult> {
  // Thread the options bag into the resolver so submit-time selection /
  // active-artboard hints (DDR — selection-passthrough) win over the persisted
  // `_active.json`. Additive — existing `resolve` callers stay valid.
  const targets = await resolveScope({ ...args.resolve, scope: args.scope, options: args.options });
  const adapter = getAdapter(args.format);
  if (!adapter) {
    throw new Error(`unknown format: ${args.format}`);
  }
  return adapter.run(targets, args.options, args.ctx, args.hooks);
}

export type { Scope, Target };
export { resolveScope };

/**
 * Build the `_canvas-shell.html?canvas=…&tokens=…&components=…` URL the
 * playwright shims navigate to. Three normalisations the shell expects:
 *
 *   1. `canvas=` is a **designRoot-relative** path (`ui/Foo.tsx`), NOT a
 *      repo-relative one (`.design/ui/Foo.tsx`). Without the strip the shell
 *      builds `/.design/.design/ui/Foo.tsx` and 404s.
 *   2. `tokens=` is the designRoot-relative path to the project's tokens CSS.
 *      The shell only loads `<link id="canvas-tokens">` when this is set —
 *      missing it means every `var(--bg-0)` etc. resolves to undefined and
 *      the rendered DOM looks blank in screenshots.
 *   3. `components=` (optional) — designRoot-relative path to a shared
 *      components CSS file. Same shell behaviour as tokens.
 *
 * `_active.json.active` leaks the prefixed form straight through; this helper
 * is the single normalization point. `ctx.tokensCssRel` is supplied by the
 * HTTP handler from `cfg.tokensCssRel`.
 */
export function canvasShellUrl(
  ctx: ExportContext,
  file: string,
  opts: { annotations?: boolean } = {}
): string {
  const designRel = path.basename(ctx.designRoot);
  const stripPrefix = `${designRel}/`;
  const rel = file.startsWith(stripPrefix) ? file.slice(stripPrefix.length) : file;
  const params = new URLSearchParams();
  params.set('canvas', rel);
  if (ctx.tokensCssRel) params.set('tokens', ctx.tokensCssRel);
  if (ctx.componentsCssRel) params.set('components', ctx.componentsCssRel);
  // Suppress dev-server overlays (tool palette, mini-map, halos, pins, snap
  // guides, annotation chrome) so the export captures only the artboard
  // content. The shell's tiny <style id="canvas-hide-chrome"> rule flips
  // active when this is set.
  params.set('hide-chrome', '1');
  // Issue #125 — opt-in: paint the annotation elements back in. Only the
  // `[data-mdcc-annotations]` scene; comment pins and selection chrome stay
  // hidden, and `hide-chrome` (which also selects the capture CSP) stays on.
  if (opts.annotations) params.set('annotations', '1');
  return `${ctx.serverOrigin}/_canvas-shell.html?${params.toString()}`;
}
