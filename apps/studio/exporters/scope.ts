// Phase 6.5 T1 — scope resolver.
//
// Pure function: takes the current `_active.json` state + a user-chosen
// scope, returns a flat `Target[]`. The downstream adapter (PNG / PDF / …)
// owns rendering each Target; the resolver is render-agnostic.
//
// Why a single function instead of one-per-scope: the four scopes share an
// `activeJson` precondition and a designRoot walk for `project-raw`. Keeping
// them inline makes the fallback chain (`selection` → `artboard` when no
// selection captured) explicit.

import { type Dirent, readFileSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { isRuntimeStateRel } from '../sync/file-membership.ts';
import { isScopeValidForFormat } from './format-scopes.ts';
import type { ExportFormatV2, ExportOptionsV2, ExportSpecV2 } from './spec-v2.ts';

/** The user-facing scope choices from the export dialog. */
export type Scope =
  | 'selection'
  | 'artboard'
  | 'canvas-as-separate'
  | 'canvas-whole'
  | 'selection-bounds'
  | 'project-raw';

/**
 * A world-plane region captured as ONE image / page (issue #125): the whole
 * canvas (every artboard + annotation element) or the union bounding box of a
 * list of selected elements. Layout between artboards is kept as-is.
 */
export type CaptureRegion =
  | 'canvas'
  | { selectors: string[] }
  /** S8.1 — a WORLD-coordinate rectangle (S2.13 Export area), captured exactly. */
  | { rect: { x: number; y: number; w: number; h: number } };

/**
 * What an adapter receives for each render unit. `element` targets carry a
 * CSS selector + canvas reference (resolved at render time via Playwright);
 * `file-tree` targets carry a flat list of repo-relative paths (consumed by
 * the zip adapter only — other adapters reject).
 */
export type Target =
  | {
      kind: 'element';
      /** CSS selector. Multi-match selectors (e.g. `[data-dc-screen]`) are valid; see `multi`. */
      cssPath: string;
      /** Slug derived from the canvas file path — POSIX, ext-less, relative to designRoot. */
      canvasSlug: string;
      /** Repo-relative canvas file path. */
      file: string;
      /** True when `cssPath` is expected to match many elements; the adapter iterates. */
      multi?: boolean;
      /**
       * True when the adapter should widen `cssPath` to its closest
       * `[data-dc-screen]` ancestor before capture — i.e. "export the artboard
       * containing this element". `selection` scope sets this `false` so the
       * raster/vector captures the element EXACTLY (the item-3 bug was every
       * single-target export hard-widening). `artboard` scope sets it `true`
       * only in the fallback where we have a descendant selector but no
       * artboard id; when the id IS known we target `[data-dc-screen="<id>"]`
       * directly and leave this `false`.
       */
      widen?: boolean;
      /**
       * Capture this region of the world plane as one unit instead of the
       * element at `cssPath` (which then only gates "the canvas has mounted").
       */
      region?: CaptureRegion;
      /**
       * Render the annotation layer (the FigJam-style draw elements) into the
       * capture. Comment pins stay hidden either way. Off unless the export
       * options opt in with `includeAnnotations: true`.
       */
      annotations?: boolean;
    }
  | {
      kind: 'file-tree';
      /** Repo-relative file paths to bundle. Always non-empty. */
      paths: string[];
    };

/** Subset of `_active.json` the resolver consumes. */
export interface ActiveJsonShape {
  active: string | null;
  selected:
    | { file?: string; selector?: string; cssPath?: string }
    | Array<{ file?: string; selector?: string; cssPath?: string }>
    | null;
}

/**
 * Submit-time hints captured from the LIVE iframe (the export dialog snapshots
 * the canvas selection + the artboard under the viewport centre and rides them
 * on the export `options` bag). The resolver prefers these over `activeJson`
 * because opening the dialog / clicking Export can drop the persisted
 * `_active.json.selected`, and they survive the cross-origin bridge unchanged.
 * See the export-pipeline-fixes plan Task 1 + the selection-passthrough DDR.
 */
export interface ExportScopeHints {
  /** Live selection at submit time. `selector` wins over `activeJson.selected`. */
  selection?: { selector?: string; file?: string } | null;
  /** `data-dc-screen` id of the artboard to export for `scope=artboard`. */
  artboardId?: string | null;
  /**
   * The canvas FILE the dialog was exporting, captured at submit time. Wins
   * over `activeJson.active`: the persisted `_active.json` is written
   * asynchronously after a tab switch, so a job submitted right after opening
   * another canvas rendered the PREVIOUS one — with the live `artboardId` of
   * the new one, i.e. a selector that never appears (a 60 s waitFor timeout on
   * the worker). The live dialog knows which file it is looking at; trust it.
   */
  canvasFile?: string | null;
  /** Every selector of a multi-selection, for `selection-bounds`. */
  selectionAll?: string[];
  /** S8.1 — a world rectangle for `canvas-whole` / `selection-bounds` (ExportSpec v2 `region`). */
  regionRect?: { x: number; y: number; w: number; h: number };
  /** S8.1 — `project-raw` limited to this designRoot-relative folder (the Folder scope's zip). */
  folder?: string;
}

export interface ResolveScopeArgs {
  scope: Scope;
  activeJson: ActiveJsonShape;
  /** Absolute path to the design root (e.g. `/abs/.design`). */
  designRoot: string;
  /** Absolute path to repo root. Required for `project-raw` to bound the walk. */
  repoRoot?: string;
  /**
   * The export `options` bag, threaded from `runExport`. Read additively so
   * existing callers (and the pure unit tests) that omit it stay green.
   */
  options?: Record<string, unknown>;
}

/** Narrow the free-form options bag to the selection/artboard hints we read. */
function readHints(options: Record<string, unknown> | undefined): ExportScopeHints {
  if (!options || typeof options !== 'object') return {};
  const sel = options.selection;
  const selection =
    sel && typeof sel === 'object'
      ? {
          selector:
            typeof (sel as Record<string, unknown>).selector === 'string'
              ? ((sel as Record<string, unknown>).selector as string)
              : undefined,
          file:
            typeof (sel as Record<string, unknown>).file === 'string'
              ? ((sel as Record<string, unknown>).file as string)
              : undefined,
        }
      : null;
  const artboardId =
    typeof options.artboardId === 'string' && options.artboardId ? options.artboardId : null;
  const canvasFile =
    typeof options.canvasFile === 'string' && options.canvasFile ? options.canvasFile : null;
  // Bounded: every selector is evaluated in the capture page, and a job body
  // is member-supplied — thousands of `:has()` selectors would pin a slot.
  const selectionAll = Array.isArray(options.selectionAll)
    ? (options.selectionAll as unknown[])
        .filter(
          (x): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_SELECTOR_LEN
        )
        .slice(0, MAX_SELECTION_ALL)
    : undefined;
  const rr = options.regionRect as Record<string, unknown> | undefined;
  const regionRect =
    rr &&
    typeof rr === 'object' &&
    [rr.x, rr.y, rr.w, rr.h].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (rr.w as number) > 0 &&
    (rr.h as number) > 0 &&
    (rr.w as number) <= 32768 &&
    (rr.h as number) <= 32768
      ? { x: rr.x as number, y: rr.y as number, w: rr.w as number, h: rr.h as number }
      : undefined;
  const folder =
    typeof options.folder === 'string' &&
    options.folder &&
    !options.folder.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') &&
    !options.folder.includes('\\') &&
    !isRuntimeStateRel(options.folder)
      ? options.folder
      : undefined;
  return { selection, artboardId, canvasFile, selectionAll, regionRect, folder };
}

/** Caps on `options.selectionAll` (security review, issue #125). */
export const MAX_SELECTION_ALL = 256;
const MAX_SELECTOR_LEN = 1024;

/**
 * Names a `project-raw` ZIP skips that are NOT Maude runtime state — build and
 * OS litter. Runtime state is decided by the one DDR-115 classifier below
 * (`isRuntimeStateRel`), never by a list here: this set used to carry its own
 * copy of the runtime names, drifted, and shipped `_chat/` (every AI
 * conversation), `_state/`, `_untrusted/`, `_trash/`, `_draw/`, `_reports/` and
 * each member's `_active.<session>.json` to anyone who downloaded the project
 * (V2-2.8 S8, V2-1.16 L7).
 */
const RAW_EXCLUDES = new Set(['node_modules', 'dist', '.DS_Store']);

/**
 * Derive a canvas slug from a repo-relative or designRoot-relative file path.
 * Mirrors `api.ts:fileSlug` semantics but stays inline to avoid a circular
 * import (api.ts will eventually call into exporters from `commentsAdd`-style
 * factories).
 */
function slugify(file: string, designRel: string): string {
  let p = String(file).replace(/^\/+|\/+$/g, '');
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  return p
    .replace(/\//g, '-')
    .replace(/\s+/g, '_')
    .replace(/\.(tsx|html)$/i, '')
    .replace(/^\.+/, '')
    .toLowerCase();
}

/**
 * Escape a value for use inside a double-quoted CSS attribute selector
 * (`[data-dc-screen="<here>"]`). Artboard ids are normally plain slugs, but a
 * stray `"` or `\` would break out of the selector — escape defensively so the
 * id is matched literally.
 */
function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface SelectionShape {
  file?: string;
  selector?: string;
  cssPath?: string;
}

function firstSelection(selected: ActiveJsonShape['selected']): SelectionShape | null {
  if (!selected) return null;
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

async function walkProjectRaw(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (RAW_EXCLUDES.has(e.name)) continue;
      if (e.name.endsWith('.log')) continue;
      const abs = path.join(absDir, e.name);
      const rel = relDir ? path.posix.join(relDir, e.name) : e.name;
      // DDR-115 runtime state, files and whole directories alike (the
      // classifier matches a runtime dir's own path, so the walk never enters).
      if (isRuntimeStateRel(rel)) continue;
      if (e.isDirectory()) {
        await walk(abs, rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(root, '');
  return out;
}

/**
 * Resolve a scope choice into a Target[]. Pure beyond filesystem walks for
 * `project-raw`. Never throws — invalid input collapses to `[]` and the
 * adapter's "no targets" path emits an empty payload.
 */
export async function resolveScope(args: ResolveScopeArgs): Promise<Target[]> {
  const { scope, activeJson, designRoot } = args;
  const designRel = path.basename(designRoot);

  // `project-raw` is independent of `_active.json` — the user always exports
  // the whole tree regardless of what's selected.
  if (scope === 'project-raw') {
    // S8.1 — the Folder scope's zip: only that subtree (paths stay designRoot-relative).
    const folder = readHints(args.options).folder;
    let paths: string[];
    if (folder) {
      // a folder that is (or sits under) a symlink out of the design root packs nothing
      const abs = path.join(designRoot, folder);
      let inside = false;
      try {
        const root = realpathSync(designRoot);
        const real = realpathSync(abs);
        inside = real.startsWith(root + path.sep);
      } catch {
        inside = false;
      }
      paths = inside ? (await walkProjectRaw(abs)).map((p) => `${folder}/${p}`) : [];
    } else paths = await walkProjectRaw(designRoot);
    if (!paths.length) return [];
    return [{ kind: 'file-tree', paths }];
  }

  const hints = readHints(args.options);
  const activeFile = hints.canvasFile ?? activeJson.active;
  if (!activeFile) return [];
  const slug = slugify(activeFile, designRel);
  const sel = firstSelection(activeJson.selected);

  if (scope === 'canvas-whole' || scope === 'selection-bounds') {
    const annotations = args.options?.includeAnnotations === true;
    const selectors = hints.selectionAll?.length
      ? hints.selectionAll
      : [hints.selection?.selector ?? sel?.selector ?? sel?.cssPath].filter(
          (x): x is string => !!x
        );
    // S8.1 — a world rectangle wins: exactly that area, layout + annotations intact.
    if (hints.regionRect) {
      return [
        {
          kind: 'element',
          cssPath: '[data-dc-screen]',
          canvasSlug: slug,
          file: activeFile,
          region: { rect: hints.regionRect },
          annotations,
        },
      ];
    }
    // No selection → the bounding box of "everything" is the whole canvas.
    if (scope === 'canvas-whole' || !selectors.length) {
      return [
        {
          kind: 'element',
          cssPath: '[data-dc-screen]',
          canvasSlug: slug,
          file: activeFile,
          region: 'canvas',
          annotations,
        },
      ];
    }
    return [
      {
        kind: 'element',
        cssPath: selectors[0],
        canvasSlug: slug,
        file: activeFile,
        region: { selectors },
        annotations,
      },
    ];
  }

  if (scope === 'selection') {
    // Prefer the live submit-time snapshot over the persisted `_active.json`
    // selection — the dialog can clear the canvas selection before the bridged
    // export runs, leaving `activeJson.selected` null (item 3 root cause #1).
    const selector = hints.selection?.selector ?? sel?.selector ?? sel?.cssPath;
    if (!selector) {
      // No selection anywhere → fall back to artboard scope so the export
      // still produces something useful. Single fallback site.
      return resolveScope({ ...args, scope: 'artboard' });
    }
    const file = hints.selection?.file ?? sel?.file ?? activeFile;
    return [
      {
        kind: 'element',
        cssPath: selector,
        canvasSlug: slugify(file, designRel),
        file,
        // Capture the element EXACTLY — do NOT widen to the enclosing artboard
        // (item 3 root cause #2: every single-target export hard-widened).
        widen: false,
      },
    ];
  }

  if (scope === 'artboard') {
    // Preferred path: the dialog captured which artboard is active (the
    // selection's host, or the artboard under the viewport centre). Target it
    // by id so EVERY format (PDF included — its shim doesn't widen) renders
    // the right artboard, not `:first-of-type` (item 5 root cause).
    if (hints.artboardId) {
      return [
        {
          kind: 'element',
          cssPath: `[data-dc-screen="${cssAttrEscape(hints.artboardId)}"]`,
          canvasSlug: slug,
          file: activeFile,
          widen: false,
        },
      ];
    }
    // Fallback: we only have a descendant selector → pass it through and let
    // the adapter widen to the closest `[data-dc-screen]` ancestor.
    const descendant = hints.selection?.selector ?? sel?.selector ?? sel?.cssPath;
    if (descendant) {
      return [
        {
          kind: 'element',
          cssPath: descendant,
          canvasSlug: slug,
          file: activeFile,
          widen: true,
        },
      ];
    }
    // Last resort — first artboard on the active canvas.
    return [
      {
        kind: 'element',
        cssPath: '[data-dc-screen]:first-of-type',
        canvasSlug: slug,
        file: activeFile,
        widen: false,
      },
    ];
  }

  // canvas-as-separate — every [data-dc-screen] on the active canvas.
  // Adapter expands `multi: true` into N renders in document order.
  return [
    {
      kind: 'element',
      cssPath: '[data-dc-screen]',
      canvasSlug: slug,
      file: activeFile,
      multi: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// S8.1 — ExportSpec v2 → engine units (contract S8-export-spec.md §5.2, §5.8).
//
// The v2 sheet speaks in four scopes (Selection · This canvas · Folder · Whole project); the
// engine above speaks in six capture scopes. `resolveSpecV2` is the ONE place that maps the
// first onto the second. It never reads the tree: the caller hands it the canvases the
// session SEES (index rows filtered by `sees`), so Folder / Whole project expand over the
// visible set only, and a canvas outside it answers exactly like a missing one.
//
// Engine scope per unit: a selected artboard is `artboard` (by id) rather than `selection` —
// the same capture, and the only one html and the temporal formats take.

export interface SpecArtboard {
  id: string;
  label: string | null;
  kind: string | null;
  w: number | null;
  h: number | null;
}

export interface SpecCanvas {
  /** designRoot-relative (`ui/a.tsx`) */
  rel: string;
  artboards: readonly SpecArtboard[];
}

export interface SpecContext {
  /** the design root relative to the repo root (`.design`) — engine hints are repo-relative */
  designRel: string;
  /** the canvases this session sees (already filtered); order = output order */
  canvases: readonly SpecCanvas[];
  /** designRoot-relative active canvas (selection / canvas default) */
  activeCanvas: string | null;
}

export type SkipReason = 'shared-part' | 'format-unit' | 'not-in-scope';

/** One engine render: what `runExport` takes, plus what the file names need. */
export interface SpecUnit {
  id: string;
  format: ExportFormatV2;
  scope: Scope;
  options: Record<string, unknown>;
  /** designRoot-relative canvas, null for a project-wide zip */
  canvas: string | null;
  /** the artboards this unit's files are, in order ([] = one file not tied to an artboard) */
  artboards: readonly SpecArtboard[];
  kind: string | null;
  /** v2 options after the per-kind merge (sizes, names) */
  v2: ExportOptionsV2;
  /** degradation lines the export still succeeds with (`annotations-print`) */
  degraded: string[];
}

export type SpecResolution =
  | {
      ok: true;
      units: SpecUnit[];
      skipped: Array<{ name: string; reason: SkipReason }>;
      /** the canvases the spec reaches (designRoot-relative) */
      canvases: string[];
    }
  | { ok: false; reason: 'not-in-scope' }
  | { ok: false; reason: 'bad-spec'; field: string; message: string };

const TEMPORAL = new Set<string>(['mp4', 'webm', 'gif', 'audio']);
const DECK = new Set<string>(['pptx', 'canva']);

/**
 * S4.16 contract signature (§5.8): may this format carry annotations? `'never'` for a PDF of a
 * print artboard (or with print options), every temporal format, zip, pptx, canva.
 */
export function annotationsExportPolicy(
  format: ExportFormatV2,
  ctx: { kind?: string | null; print?: boolean } = {}
): 'optional' | 'never' {
  if (TEMPORAL.has(format) || format === 'zip' || DECK.has(format)) return 'never';
  if (format === 'pdf' && (ctx.kind === 'print' || ctx.print === true)) return 'never';
  return 'optional';
}

/** A canvas source that declares at least one `kind="print"` artboard (light scan: a false hit only costs a review copy). */
const PRINT_ARTBOARD_RE =
  /<DCArtboard\b[^>]*\bkind\s*=\s*(?:"print"|'print'|\{\s*["']print["']\s*\})/;

function canvasHasPrintArtboard(designRoot: string, file: string): boolean {
  try {
    const abs = path.join(path.dirname(designRoot), file);
    return PRINT_ARTBOARD_RE.test(readFileSync(abs, 'utf8'));
  } catch {
    return false; // unreadable: it is treated as plain screens, the capture reports the real fault
  }
}

/**
 * S4.16 (an-print) - the SERVER's half of "print files never carry annotations". The export sheet greys
 * Include annotations for a print format (S8 reads `annotationsExportPolicy`), but a request that sets
 * `includeAnnotations` anyway - a stale tab, a script, the options bag - still gets a file without the
 * layer: every element target loses `annotations` when the format may not carry it. A PDF is print when
 * the request asks for print geometry (`pdfPrint`) or the canvas has a print artboard; a PNG of the same
 * canvas, or a PDF of screens, is a review copy and keeps what was asked. Pure beyond one source read.
 */
export function enforceAnnotationsPolicy(
  targets: Target[],
  format: string,
  options: Record<string, unknown> | undefined,
  designRoot: string
): Target[] {
  if (!targets.some((t) => t.kind === 'element' && t.annotations)) return targets;
  const askedPrint = format === 'pdf' && options?.pdfPrint != null;
  return targets.map((t) => {
    if (t.kind !== 'element' || !t.annotations) return t;
    const print = askedPrint || (format === 'pdf' && canvasHasPrintArtboard(designRoot, t.file));
    return annotationsExportPolicy(format as ExportFormatV2, { print }) === 'never'
      ? { ...t, annotations: false }
      : t;
  });
}

const attrSel = (id: string) => `[data-dc-screen="${cssAttrEscape(id)}"]`;
const elementCss = (id: string) => `[data-cd-id="${cssAttrEscape(id)}"]`;

function mergeOptions(
  base: ExportOptionsV2 | undefined,
  over: Partial<ExportOptionsV2> | undefined
): ExportOptionsV2 {
  return { ...(base ?? {}), ...(over ?? {}) } as ExportOptionsV2;
}

/** v2 options → the engine's option bag (the keys the adapters already read). */
export function engineOptionsFor(
  format: ExportFormatV2,
  o: ExportOptionsV2
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (o.size && 'scale' in o.size) {
    out.scaleExact = o.size.scale;
    out.scale = o.size.scale;
  } else if (o.size && 'dpi' in o.size) out.dpi = o.size.dpi;
  if (format === 'jpg') out.quality = o.jpgQuality ?? 85;
  if (o.background) out.background = o.background;
  if (o.video?.fps) out.fps = o.video.fps;
  if (o.colorProfile) out.colorProfile = o.colorProfile;
  return out;
}

/** The unit's effective v2 format + options for an artboard kind. */
function forKind(spec: ExportSpecV2, kind: string | null) {
  const by = kind ? spec.byKind?.[kind] : undefined;
  return { format: by?.format ?? spec.format, v2: mergeOptions(spec.options, by?.options) };
}

/** The name a left-out shared-parts canvas goes by: its first `_`-named folder, else its own name. */
function sharedPartName(rel: string): string {
  const parts = rel.split('/');
  const dir = parts.slice(0, -1).find((p) => p.startsWith('_'));
  return dir ?? (parts[parts.length - 1] ?? rel).replace(/\.tsx$/i, '');
}

export function resolveSpecV2(spec: ExportSpecV2, ctx: SpecContext): SpecResolution {
  const visible = new Map(ctx.canvases.map((c) => [c.rel, c]));
  const units: SpecUnit[] = [];
  const skipped: Array<{ name: string; reason: SkipReason }> = [];
  const reached: string[] = [];
  let seq = 0;
  const repoRel = (rel: string) => `${ctx.designRel.replace(/^\/+|\/+$/g, '')}/${rel}`;

  const push = (
    u: Omit<SpecUnit, 'id' | 'options' | 'degraded'> & { hints: Record<string, unknown> }
  ): void => {
    const name = u.artboards[0]?.label ?? u.artboards[0]?.id ?? u.canvas ?? 'project';
    if (!isScopeValidForFormat(u.format, u.scope)) {
      skipped.push({ name, reason: 'format-unit' });
      return;
    }
    const degraded: string[] = [];
    let annotations = u.v2.annotations === true;
    if (
      annotations &&
      annotationsExportPolicy(u.format, { kind: u.kind, print: !!u.v2.print }) === 'never'
    ) {
      annotations = false;
      degraded.push('annotations-print');
    }
    seq += 1;
    units.push({
      id: `u${seq}`,
      format: u.format,
      scope: u.scope,
      canvas: u.canvas,
      artboards: u.artboards,
      kind: u.kind,
      v2: u.v2,
      degraded,
      options: {
        ...engineOptionsFor(u.format, u.v2),
        ...(annotations ? { includeAnnotations: true } : {}),
        ...u.hints,
      },
    });
  };

  /** One canvas as `canvas` (the Folder / Whole project expansion reuses it). */
  const asCanvas = (c: SpecCanvas, region: ExportSpecV2['region'], unit: 'each' | 'one') => {
    reached.push(c.rel);
    const canvasFile = repoRel(c.rel);
    if (region || unit === 'one') {
      const { format, v2 } = forKind(spec, null);
      push({
        format,
        scope: 'canvas-whole',
        canvas: c.rel,
        artboards: [],
        kind: null,
        v2,
        hints: { canvasFile, ...(region ? { regionRect: region.rect } : {}) },
      });
      return;
    }
    const boards = c.artboards;
    const plan = boards.map((b) => ({ b, ...forKind(spec, b.kind) }));
    const formats = new Set(plan.map((p) => p.format));
    const first = plan[0];
    // one format for every artboard, and not a temporal one → the engine's own per-artboard pass
    if (!first || (formats.size === 1 && !TEMPORAL.has(first.format))) {
      const { format, v2 } = first ?? forKind(spec, null);
      if (TEMPORAL.has(format)) {
        skipped.push({ name: c.rel, reason: 'format-unit' });
        return;
      }
      push({
        format,
        scope: 'canvas-as-separate',
        canvas: c.rel,
        artboards: boards,
        kind: first?.b.kind ?? null,
        v2,
        hints: { canvasFile },
      });
      return;
    }
    for (const p of plan) {
      const temporalMiss = TEMPORAL.has(p.format) && p.b.kind !== 'video';
      if (DECK.has(p.format) || temporalMiss) {
        skipped.push({ name: p.b.label ?? p.b.id, reason: 'format-unit' });
        continue;
      }
      push({
        format: p.format,
        scope: 'artboard',
        canvas: c.rel,
        artboards: [p.b],
        kind: p.b.kind,
        v2: p.v2,
        hints: { canvasFile, artboardId: p.b.id },
      });
    }
  };

  if (spec.scope === 'selection' || spec.scope === 'canvas') {
    const rel = spec.canvas ?? ctx.activeCanvas;
    if (!rel)
      return { ok: false, reason: 'bad-spec', field: 'canvas', message: 'no canvas is open' };
    const c = visible.get(rel);
    if (!c) return { ok: false, reason: 'not-in-scope' };
    if (spec.scope === 'canvas') {
      asCanvas(c, spec.region, spec.unit ?? 'each');
      return { ok: true, units, skipped, canvases: reached };
    }
    reached.push(c.rel);
    const canvasFile = repoRel(c.rel);
    const byId = new Map(c.artboards.map((b) => [b.id, b]));
    const boardIds = spec.selection?.artboards ?? [];
    const elementIds = spec.selection?.elements ?? [];
    for (const id of boardIds)
      if (!byId.has(id))
        return {
          ok: false,
          reason: 'bad-spec',
          field: 'selection.artboards',
          message: `no artboard "${id}" on this canvas`,
        };
    const selectors = [...boardIds.map(attrSel), ...elementIds.map(elementCss)];
    if (!selectors.length && !spec.region)
      return { ok: false, reason: 'bad-spec', field: 'selection', message: 'nothing is selected' };
    if (spec.region || spec.unit === 'one') {
      const { format, v2 } = forKind(spec, null);
      push({
        format,
        scope: 'selection-bounds',
        canvas: c.rel,
        artboards: [],
        kind: null,
        v2,
        hints: spec.region
          ? { canvasFile, regionRect: spec.region.rect }
          : { canvasFile, selectionAll: selectors.slice(0, MAX_SELECTION_ALL) },
      });
      return { ok: true, units, skipped, canvases: reached };
    }
    for (const id of boardIds) {
      const b = byId.get(id) as SpecArtboard;
      const { format, v2 } = forKind(spec, b.kind);
      if (TEMPORAL.has(format) && b.kind !== 'video') {
        skipped.push({ name: b.label ?? b.id, reason: 'format-unit' });
        continue;
      }
      push({
        format,
        scope: 'artboard',
        canvas: c.rel,
        artboards: [b],
        kind: b.kind,
        v2,
        hints: { canvasFile, artboardId: b.id },
      });
    }
    for (const id of elementIds) {
      const { format, v2 } = forKind(spec, null);
      push({
        format,
        scope: 'selection',
        canvas: c.rel,
        artboards: [{ id, label: null, kind: null, w: null, h: null }],
        kind: null,
        v2,
        hints: { canvasFile, selection: { selector: elementCss(id), file: canvasFile } },
      });
    }
    return { ok: true, units, skipped, canvases: reached };
  }

  // folder | project — project-class; expansion over the VISIBLE canvases only (O1: subtree)
  const prefix = spec.scope === 'folder' ? `${spec.folder}/` : '';
  const inScope = ctx.canvases.filter((c) => c.rel.startsWith(prefix));
  if (spec.format === 'zip') {
    for (const c of inScope) reached.push(c.rel);
    push({
      format: 'zip',
      scope: 'project-raw',
      canvas: null,
      artboards: [],
      kind: null,
      v2: mergeOptions(spec.options, undefined),
      hints: spec.scope === 'folder' ? { folder: spec.folder } : {},
    });
    return { ok: true, units, skipped, canvases: reached };
  }
  // S8.3: a canvas with no artboard holds shared parts, not something to export — left out, by name
  // (the first `_`-named folder it sits in, else its own name), once per name.
  const sharedNamed = new Set<string>();
  for (const c of inScope) {
    if (c.artboards.length === 0) {
      const name = sharedPartName(c.rel);
      if (!sharedNamed.has(name)) {
        sharedNamed.add(name);
        skipped.push({ name, reason: 'shared-part' });
      }
      continue;
    }
    asCanvas(c, undefined, spec.unit ?? 'each');
  }
  return { ok: true, units, skipped, canvases: reached };
}
