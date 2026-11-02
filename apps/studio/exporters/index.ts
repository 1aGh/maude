// Phase 6.5 T1 — adapter registry + dispatch.
//
// Each format adapter exports a single `run(targets, options, ctx) → Result`
// function. This module owns the (format → adapter) lookup and the shared
// `Result` envelope. Stub adapters live in `./{png,pdf,svg,html,pptx,canva,zip}.ts`
// and currently return zero-byte payloads with valid MIME types — T2…T7
// replace them with real renderers.

import path from 'node:path';
// DDR-148 — temporal formats (capture-spine encode). Named exports mp4/webm/gif.
import { audio } from './audio.ts';
import * as canva from './canva.ts';
import type { ExportDegradation } from './degraded.ts';
import * as html from './html.ts';
import * as jpg from './jpg.ts';
import * as pdf from './pdf.ts';
import * as png from './png.ts';
import * as pptx from './pptx.ts';
import {
  enforceAnnotationsPolicy,
  type ResolveScopeArgs,
  resolveScope,
  type Scope,
  type Target,
} from './scope.ts';
import * as svg from './svg.ts';
import { gif, mp4, webm } from './video.ts';
import * as zip from './zip.ts';

export type Format =
  | 'png'
  | 'jpg'
  | 'pdf'
  | 'svg'
  | 'html'
  | 'pptx'
  | 'canva'
  | 'zip'
  | 'mp4'
  | 'webm'
  | 'gif'
  | 'audio';

export const FORMATS: readonly Format[] = [
  'png',
  'jpg',
  'pdf',
  'svg',
  'html',
  'pptx',
  'canva',
  'zip',
  'mp4',
  'webm',
  'gif',
  'audio',
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
  jpg,
  pdf,
  svg,
  html,
  pptx,
  canva,
  zip,
  mp4,
  webm,
  gif,
  audio,
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
  /** Test seam: run this adapter instead of the format's own. */
  adapter?: Adapter;
}): Promise<ExportResult> {
  // Thread the options bag into the resolver so submit-time selection /
  // active-artboard hints (DDR — selection-passthrough) win over the persisted
  // `_active.json`. Additive — existing `resolve` callers stay valid.
  // S4.16 - a format that may not carry the annotation layer (print PDF, video, decks) never gets it,
  // whatever the request's `includeAnnotations` said (exporters/scope.ts `enforceAnnotationsPolicy`).
  const targets = enforceAnnotationsPolicy(
    await resolveScope({ ...args.resolve, scope: args.scope, options: args.options }),
    args.format,
    args.options,
    args.resolve.designRoot
  );
  const adapter = args.adapter ?? getAdapter(args.format);
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
/**
 * S8.1b — a past version travels as a commit sha only (`ExportSpecV2.at`, validated the same way
 * by spec-v2.ts). The capture origin's shell builds that version from the server's OWN history
 * store (`serveHistoricalCanvas`: git, else the cloud's history) — no source ever crosses here,
 * and nothing is checked out. Ref names (`HEAD~1`, a branch) are refused: an export of "that
 * version" must not move under the user.
 */
export const PAST_VERSION_SHA = /^[0-9a-f]{7,40}$/;

/** The validated past-version sha an engine option bag carries (`options.atSha`), or undefined. */
export function pastVersionOf(options: ExportOptions | undefined): string | undefined {
  const at = options?.atSha;
  if (at === undefined || at === null) return undefined;
  if (typeof at !== 'string' || !PAST_VERSION_SHA.test(at))
    throw new Error('a past version is named by its commit sha (7–40 hex characters)');
  return at;
}

export function canvasShellUrl(
  ctx: ExportContext,
  file: string,
  opts: { annotations?: boolean; at?: string } = {}
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
  // S8.1b — the version the shell renders (its TSX, its same-name CSS, its meta lane). The main
  // origin 307s this URL, query intact, to the read-only capture origin like every capture.
  if (opts.at !== undefined) {
    const at = pastVersionOf({ atSha: opts.at });
    if (at) params.set('sha', at);
  }
  return `${ctx.serverOrigin}/_canvas-shell.html?${params.toString()}`;
}
