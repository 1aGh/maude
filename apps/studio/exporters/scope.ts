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

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

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
export type CaptureRegion = 'canvas' | { selectors: string[] };

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
  return { selection, artboardId, canvasFile, selectionAll };
}

/** Caps on `options.selectionAll` (security review, issue #125). */
export const MAX_SELECTION_ALL = 256;
const MAX_SELECTOR_LEN = 1024;

const RAW_EXCLUDES = new Set([
  '_server.json',
  '_active.json',
  '_export-history.json',
  '_export-jobs',
  '_history',
  '_comments',
  '_canvas-state',
  'node_modules',
  'dist',
  '.DS_Store',
]);

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
    const paths = await walkProjectRaw(designRoot);
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
