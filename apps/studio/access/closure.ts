// The canvas closure — V2-1.7 §5.3 rules G2–G4 (S9.1).
//
// What a canvas-only session may READ is not "the canvas file". A canvas
// renders from its own sidecars, its relative import graph, its design system
// and the assets it references; refuse any of those and the granted canvas does
// not render. Grant more and a share of one canvas leaks the project. So the
// closure is computed ON THE SERVER from the project's own files, over a
// `ProjectReader` (the hub's checkout/journal or the studio child's disk), and
// cached per (sorted grants, head) — recomputed lazily after the head moves.
//
// G3 — STATIC only. A reference computed at runtime (`assets/${name}.png`, a
// non-literal `import()`) is not resolved; the canvas is reported in `dynamic`
// so the Share sheet can warn, and the person gets a 404 for what it fetches.
//
// ONE IMPORT GRAPH: `localDepsFromSource` (the canvas build's freshness deps)
// lives here and `http.ts` imports it back, so the build and the ACL agree on
// what a canvas imports.

import path, { dirname, resolve, sep } from 'node:path';

import { canvasArtifacts } from '../canvas-artifacts.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import type { Paths } from '../context.ts';
import { dsDepsFor, importsDs, importsDsBoard, specimenRels } from '../ds/ds-resolver.ts';
import {
  CANVAS_LIB_SPEC,
  CARRIES_ALL,
  decodeJsString,
  importReaches,
  importScanText,
  isCanvasFile,
  isCanvasSource,
  isDsSurfaceRel,
  isUnderscoreModuleRel,
  LIB_CARRIED,
  type ModuleLinks,
  moduleLinks,
  ODD_NAME,
} from '../skip-dirs.ts';
import { type Access, PER_USE_PHOTO_RE } from './scope.ts';

/** Relative import specifiers (side-effect, `from`, literal dynamic `import()`), in source order. */
const SPEC_RES = [
  /\bimport\s*["']([^"'\n]+)["']/g, // side-effect: import './x.css' (also CSS `@import './x.css'`)
  /\bfrom\s*["']([^"'\n]+)["']/g, // import … from / export … from
  // dynamic import('./x') and require('./x') (gate-b-c4l: whitespace or a comment may sit inside)
  /\b(?:import|require)\s*\(\s*["']([^"'\n]+)["']\s*[,)]/g,
  // gate-b-c4m (defender L-B) — the forms Bun also resolves at build time: a template with no
  // substitution (`import(\`./x\`)`) and CSS `@import url(./x.css)` / `url("./x.css")`. Unseen, a
  // missing target was a 500 "Could not resolve" beside the refusal's 403 — an existence oracle.
  /\b(?:import|require)\s*\(\s*`([^`$\n]+)`\s*[,)]/g,
];
/** CSS only (in a JS file the same text is JSX copy, not an import). */
const CSS_URL_IMPORT_RE = /@import\s+url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;

const CODE_EXT_RE = /\.(css|tsx|ts|jsx|js)$/i;
/** A JS/TS module the walk reads for imports and the lib-proxy rule reads for re-exports. */
const MODULE_EXT_RE = /\.(tsx|ts|jsx|js|mjs|cjs)$/i;
/**
 * gate-b-c4m — what an import may pull into a closure: a module, a stylesheet, JSON data. Nothing
 * else a canvas imports today (images, fonts and SVG are `assets/…` path strings — `staticAssetRefs`
 * — and Bun's file loader would leave an unserved hashed path anyway). ANY other extension — `.html`
 * (a canvas), `.md`, `.txt`, unknown — taken with `with { type: 'text' }` is just bytes into the
 * frame, so it blocks the grant like an imported canvas.
 */
const IMPORTABLE_EXT_RE = /\.(tsx|ts|jsx|js|mjs|cjs|css|json)$/i;
/** A design system's own folder — exactly one segment under `system/` (V2-8.9 defender L3). */
const DS_SYSTEM_PATH_RE = /^system\/[^/]+$/;
/** A specifier with an extension of its own (`./data.json`, `./logo.svg`): the exact file. */
const ANY_EXT_RE = /\/[^/]*[^/.]\.[A-Za-z0-9]+$/;

// gate-b-c4k — `importScanText` moved to skip-dirs.ts (the canvas content marker reads it too).
export { importScanText };

/**
 * Every resolution candidate of every RELATIVE import in `source`, as absolute paths clamped to
 * `designRoot` (a canvas source is attacker-influenced under linked mode, DDR-054). Extensionless
 * specifiers contribute every candidate (`.tsx`, `.ts`, `.jsx`, `.js`, `index.tsx`, `index.ts`);
 * one with another extension (`./data.json`) contributes the exact file too (gate-b-c4e: the
 * build inlines it). Comments and plain strings are not imports (`importScanText`). Bare /
 * virtual specifiers are skipped. No `@maude/ds` handling — see `localDepsFromSource`.
 */
export function relativeImportCandidates(
  rawSource: string,
  canvasAbsPath: string,
  designRoot: string
): string[] {
  const deps: string[] = [];
  const seen = new Set<string>();
  for (const group of relativeImportGroups(rawSource, canvasAbsPath, designRoot))
    for (const abs of group) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      deps.push(abs);
    }
  return deps;
}

/**
 * The resolution candidates of ONE relative specifier written in a file at `fromAbs` (absolute,
 * clamped to `designRoot`; empty when it points outside). `relativeImportCandidates`' unit.
 */
export function specCandidates(spec: string, fromAbs: string, designRoot: string): string[] {
  const root = resolve(designRoot);
  const base = resolve(dirname(fromAbs), spec);
  const cands = CODE_EXT_RE.test(spec)
    ? [base]
    : [
        ...(ANY_EXT_RE.test(spec) ? [base] : []),
        `${base}.tsx`,
        `${base}.ts`,
        `${base}.jsx`,
        `${base}.js`,
        resolve(base, 'index.tsx'),
        resolve(base, 'index.ts'),
      ];
  return cands.filter((abs) => abs === root || abs.startsWith(root + sep)); // clamp (DDR-054)
}

/**
 * gate-b-c4l — `relativeImportCandidates` per specifier (source order, one group per distinct
 * specifier, escapes decoded): the closure walk must see an import that resolves to NONE of its
 * candidates (it blocks the grant — the same refusal as an imported canvas, so a planted import is
 * no existence probe, defender L-b).
 */
export function relativeImportGroups(
  rawSource: string,
  canvasAbsPath: string,
  designRoot: string
): string[][] {
  const css = /\.css$/i.test(canvasAbsPath);
  const source = importScanText(rawSource, css);
  const groups: string[][] = [];
  const specs = new Set<string>();
  for (const re of css ? [...SPEC_RES, CSS_URL_IMPORT_RE] : SPEC_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m !== null; m = re.exec(source)) {
      const spec = decodeJsString(m[1] ?? '');
      if (!spec.startsWith('.') || specs.has(spec)) continue;
      specs.add(spec);
      groups.push(specCandidates(spec, canvasAbsPath, designRoot));
    }
  }
  return groups;
}

/**
 * S7.5 — the transcript deps come from `video/inject.ts`, which parses the canvas (oxc + the clip
 * JSX helpers → canvas-edit.ts). The hub imports this module under Node's strip-only TypeScript and
 * must not load that graph, so inject.ts REGISTERS itself when the studio loads it (canvas-build.ts
 * imports it at boot). Without a registration — the hub — no transcript is a dep: the closure fails
 * closed (a canvas-scoped cell visitor does not read transcripts).
 */
type VideoDeps = (source: string, canvasAbs: string, designRoot: string) => string[];
let videoDeps: VideoDeps | null = null;
export function registerVideoDeps(fn: VideoDeps | null): void {
  videoDeps = fn;
}

/** Relative import specifiers in a canvas source → absolute paths (the files
 *  Bun.build inlines): sibling `.css`, and — RC6 of
 *  rca/issue-canvas-hmr-optimistic-update-consistency — imported local
 *  `.tsx/.ts/.jsx/.js` modules, which are inlined exactly like CSS (only
 *  RUNTIME_PACKAGES stay external, canvas-build.ts), so an edit to an imported
 *  sibling must bust the mtime-keyed cache the same way. Extensionless
 *  specifiers contribute EVERY resolution candidate (`.tsx`, `.ts`, …,
 *  `index.tsx`); missing candidates stat as 0, so a dep file APPEARING later
 *  also changes the signature. One level only — no transitive graph (the
 *  import-graph HMR re-emit is a tracked follow-up). Bare / virtual specifiers
 *  (`@maude/…`, npm) are skipped. Resolved paths are clamped to `designRoot`:
 *  a canvas source is attacker-influenced under linked mode (DDR-054), and
 *  these paths are `stat`-ed for mtime, so a `../../../etc/…` specifier must
 *  not let the freshness probe reach outside the design tree. Legit DS imports
 *  (`../../system/<ds>/…`) stay inside designRoot.
 *
 *  Moved here from `http.ts` (V2-1.7 G3, S9.1): the closure scanner walks the
 *  same graph, transitively. */
export function localDepsFromSource(
  source: string,
  canvasAbsPath: string,
  designRoot: string
): string[] {
  const deps = relativeImportCandidates(source, canvasAbsPath, designRoot);
  const seen = new Set(deps);
  // P-11 (V2-1.13 §5.11): `@maude/ds` is generated from the canvas's system, so its meta,
  // config.json and the system's preview/_ds.tsx override are deps too — a system change rebuilds.
  for (const p of dsDepsFor(source, canvasAbsPath, designRoot)) {
    if (seen.has(p)) continue;
    const root = resolve(designRoot);
    if (p !== root && !p.startsWith(root + sep)) continue;
    seen.add(p);
    deps.push(p);
  }
  // S7.5 (V2-1.10 §5.3): the transcripts a canvas-lib <Captions>/<Duck> reads at build are inputs —
  // a new or changed `assets/<sha8>.transcript.json` rebuilds the canvases whose comps play it.
  for (const p of videoDeps ? videoDeps(source, canvasAbsPath, designRoot) : []) {
    if (seen.has(p)) continue;
    seen.add(p);
    deps.push(p);
  }
  return deps;
}

// ---------------------------------------------------------------------------
// The closure.

/** The project's files, wherever they live. Paths are designRoot-relative POSIX. */
export interface ProjectReader {
  list(): Iterable<string>;
  text(rel: string): string | null;
  /** Journal head / tree hash — the cache key. */
  head(): string;
}

export interface Closure {
  /** The head the closure was computed at. */
  readonly head: string;
  /** Per granted canvas: the canvas and its own sidecars (existing or not). */
  readonly owned: ReadonlySet<string>;
  /** owned rel → the granted canvas it belongs to (what `writes` checks edit on). */
  readonly ownedBy: ReadonlyMap<string, string>;
  /** owned ∪ import closure ∪ design system (no specimens / ui kits) ∪ static assets + sidecars. */
  readonly read: ReadonlySet<string>;
  /** Every asset in `read` → every referrer in the WHOLE project (a granted canvas, or the
   *  other file that references it). The photo-sidecar rule (G2) needs all of them. */
  readonly assetUsers: ReadonlyMap<string, ReadonlySet<string>>;
  /** Stems (`assets/<name>` before the first dot) of every file under `assets/` in the project. */
  readonly assetStems: ReadonlySet<string>;
  /** Granted canvases with a computed (runtime) asset or module reference (G3). */
  readonly dynamic: ReadonlySet<string>;
  /** gate-b-c4l — granted canvases whose import walk refused something (another canvas, a file
   *  that is never a module, an import that resolves to nothing): each contributes only its owned
   *  files to `read`, and a frame on it is refused before any build (one answer, no probe). */
  readonly blocked: ReadonlySet<string>;
}

/** Sidecars that ride with an asset (`assets/<base>.<ext>` → `assets/<base><suffix>`). */
const ASSET_SIDECAR_SUFFIXES = [
  '.photo.json',
  '.audio.json',
  '.footage.json',
  '.transcript.json',
  '.beats.json',
  '.gen.json', // the generation provenance of a take (S8 §5.2) — rides with its image
  '.srt',
  '.vtt',
  '.json', // the bare whisper dump beside old captions (V2-1.10)
];

/**
 * The per-use photo edit `assets/<img8>.<edit8>.photo.json` (S8 §5.1). Never admitted as an
 * asset or by the suffix list: only a granted canvas's `data-photo-edit="<edit8>"` on the
 * element whose `src` is `assets/<img8>.<ext>` admits it (S8 §5.6), so another canvas's
 * per-use edit stays invisible (U1).
 */
const PHOTO_EDIT_ATTR_RE = /\bdata-photo-edit\s*=\s*(?:\{\s*)?["'`]([0-9a-f]{8,16})["'`]/g;

/**
 * Per-use edits a text names: `data-photo-edit="<edit8>"` bound to the asset references of ITS
 * element (the tag around the attribute, up to the next `<`), as `<asset base>.<edit8>.photo.json`
 * candidates. Static only (G3), like `staticAssetRefs`; the caller keeps what exists.
 */
export function perUsePhotoRefs(text: string): string[] {
  const out: string[] = [];
  if (!text.includes('data-photo-edit')) return out;
  PHOTO_EDIT_ATTR_RE.lastIndex = 0;
  for (let m = PHOTO_EDIT_ATTR_RE.exec(text); m !== null; m = PHOTO_EDIT_ATTR_RE.exec(text)) {
    const start = text.lastIndexOf('<', m.index);
    const next = text.indexOf('<', m.index);
    const tag = text.slice(start === -1 ? 0 : start, next === -1 ? text.length : next);
    for (const ref of staticAssetRefs(tag)) {
      const slash = ref.lastIndexOf('/');
      const dot = ref.indexOf('.', slash + 1);
      if (slash !== 'assets/'.length - 1 || dot <= slash + 1) continue;
      out.push(`${ref.slice(0, dot)}.${m[1]}.photo.json`);
    }
  }
  return out;
}

/** A computed asset path or a non-literal dynamic import (G3). */
const DYNAMIC_RES = [
  /assets\/\$\{/,
  /["'`]assets\/["'`]\s*\+/,
  /\bimport\(\s*(?!["']\s*[^"']*["']\s*\))[^)\s]/,
];

const TEXT_SCAN_RE = /\.(tsx|ts|jsx|js|mjs|cjs|css|json|svg)$/i;
const ASSET_TERMINATORS = new Set([
  '"',
  "'",
  '`',
  ')',
  '(',
  '?',
  '#',
  ',',
  ';',
  '<',
  '>',
  '\\',
  '{',
  '}',
]);

/**
 * Static `assets/…` references in a text, as designRoot-relative paths. `assets/` must start a
 * token, or follow `./`, `../` or `.design/` — so `system/<ds>/assets/x` is not mistaken for a
 * project asset. The caller keeps only paths that exist.
 */
export function staticAssetRefs(text: string): string[] {
  const out: string[] = [];
  let i = text.indexOf('assets/');
  while (i !== -1) {
    const prev = i === 0 ? '' : (text[i - 1] as string);
    let ok = prev === '' || !/[A-Za-z0-9_\-/.]/.test(prev);
    if (prev === '/') {
      // The path segment right before `assets/` — only `.`, `..`, `.design` or a root `/`.
      let k = i - 2;
      while (k >= 0 && /[A-Za-z0-9_\-.]/.test(text[k] as string)) k--;
      const seg = text.slice(k + 1, i - 1);
      // `./assets`, `../assets`, `.design/assets`, or a root-absolute `/assets` after a quote.
      ok = seg === '..' || seg === '.' || seg === '.design' || seg === '';
    }
    if (ok) {
      let j = i + 'assets/'.length;
      while (
        j < text.length &&
        !ASSET_TERMINATORS.has(text[j] as string) &&
        !/\s/.test(text[j] as string)
      )
        j++;
      const ref = text.slice(i, j).replace(/[.]+$/, '');
      if (ref.length > 'assets/'.length && !ref.includes('${')) out.push(ref);
    }
    i = text.indexOf('assets/', i + 1);
  }
  return out;
}

interface DsSystem {
  name: string;
  path: string;
}

/**
 * gate-b-c4j — the config the closure judges by, normalized. The studio passes its EFFECTIVE config
 * (`ctx.cfg` — loadConfig reads `<repo>/.design/config.json`, which is not `<designRoot>/config.json`
 * under a custom designRoot); the hub and test readers pass none and the project's own
 * `config.json` is read. Both go through `closureConfigOf`, so they agree.
 *
 * gate-b-c4k — only the design systems: `canvasGroups` / `newComponentDir` no longer decide what is
 * a canvas (the file does — `walkEnv` `isCanvas`), so they are not read here.
 */
export interface ClosureConfig {
  readonly designSystems: readonly DsSystem[];
  readonly defaultDesignSystem: string | null;
  /**
   * p8-c4b — canvases the project's AUTHORITY knows of (a stored grant names each), sorted. An old
   * meta-less canvas that does not render DesignCanvas is still a canvas when it is listed here, so
   * a frame never inlines it (c4j). It only ever adds canvases (errs to "canvas"): the hub reads its
   * own grant stores, a cell child the file its hub hands it, a desktop its stored claim's grants.
   */
  readonly knownCanvases?: readonly string[];
}

const relDir = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const p = v.replace(/^\.?\/+/, '').replace(/\/+$/, '');
  return p && !p.split('/').includes('..') ? p : null;
};

/** p8-c4b — the canvases a known-canvas list names: designRoot-relative `.tsx` / `.html`, sorted. */
function knownCanvasList(known: Iterable<unknown>): string[] {
  const out = new Set<string>();
  for (const v of known) {
    const p = relDir(v);
    if (p && /\.(tsx|html)$/i.test(p) && !p.split('/').some((s) => s === '' || s === '.'))
      out.add(p);
  }
  return [...out].sort();
}

export function closureConfigOf(
  raw: unknown,
  knownCanvases: Iterable<unknown> = []
): ClosureConfig {
  const cfg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const designSystems: DsSystem[] = [];
  if (Array.isArray(cfg.designSystems)) {
    for (const e of cfg.designSystems as Array<Record<string, unknown> | null>) {
      const p = relDir(e?.path);
      if (p && typeof e?.name === 'string') designSystems.push({ name: e.name, path: p });
    }
  }
  return Object.freeze({
    designSystems,
    defaultDesignSystem:
      typeof cfg.defaultDesignSystem === 'string' ? cfg.defaultDesignSystem : null,
    knownCanvases: Object.freeze(knownCanvasList(knownCanvases)),
  });
}

/** p8-c4b — the project's own `config.json` (the hub's reader) plus the authority's known canvases. */
export function projectClosureConfig(
  project: ProjectReader,
  knownCanvases: Iterable<unknown> = []
): ClosureConfig {
  return closureConfigOf(readJsonObject(project, 'config.json'), knownCanvases);
}

function readJsonObject(project: ProjectReader, rel: string): Record<string, unknown> | null {
  const t = project.text(rel);
  if (t === null) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The system a canvas renders under — the same chain as `ds-resolver.ts` `canvasSystemFor`
 *  (owner by path → meta `designSystem` → `defaultDesignSystem` → first), read through the
 *  ProjectReader instead of the disk. */
function canvasSystem(project: ProjectReader, canvas: string, cfg: ClosureConfig): DsSystem | null {
  const systems = cfg.designSystems;
  if (!systems.length) return null;
  const owner = systems.find((s) => canvas.startsWith(`${s.path}/`));
  if (owner) return owner;
  const declared = readJsonObject(
    project,
    canvas.replace(/\.(tsx|html)$/i, '.meta.json')
  )?.designSystem;
  const byMeta = typeof declared === 'string' ? systems.find((s) => s.name === declared) : null;
  if (byMeta) return byMeta;
  return systems.find((s) => s.name === cfg.defaultDesignSystem) ?? systems[0] ?? null;
}

/** A design-system file a canvas-only session reads: not a specimen, not a UI kit. */
function isSystemFileInClosure(sysPath: string, rel: string): boolean {
  if (!rel.startsWith(`${sysPath}/`)) return false;
  const sub = rel.slice(sysPath.length + 1);
  if (sub.startsWith('ui_kits/')) return false;
  if (sub.startsWith('preview/') && /\.(tsx|jsx|html)$/i.test(sub)) {
    // `preview/_ds.tsx` (the `@maude/ds` override) and other `_`-prefixed helpers are modules,
    // not specimens; the import walk adds any specimen a canvas actually imports.
    return path.posix.basename(sub).startsWith('_');
  }
  return true;
}

/** Slugs already warned about (one line per slug per process, not per closure). */
const warnedSlugTwins = new Set<string>();

/**
 * gate-b-c4g — every canvas-shaped file (`.tsx` / `.html` outside the runtime dirs) by its slug.
 * `canvasSlugFromRel` is not injective (`ui/a-b.tsx`, `ui/a/b.tsx`, `UI/A-B.tsx`, `ui/a b.tsx` vs
 * `ui/a_b.tsx` all fold to one), and every slug-keyed sidecar — comments, board, EDL — is shared by
 * all of them on disk.
 */
function slugTwins(files: Iterable<string>, extra: readonly string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (rel: string) => {
    if (!/\.(tsx|html)$/i.test(rel) || rel.startsWith('_')) return;
    const slug = canvasSlugFromRel(rel, '');
    const set = out.get(slug) ?? new Set<string>();
    set.add(rel);
    out.set(slug, set);
  };
  for (const f of files) add(f);
  for (const f of extra) add(f);
  return out;
}

/**
 * The versioned sidecars + comments of a canvas, from the one artifact inventory.
 *
 * gate-b-c4g — a SLUG-keyed sidecar belongs to `canvas` only when no other canvas folds to the
 * same slug. With a twin there is no deterministic owner (the studio's slug → file resolver
 * answers whichever it walks first), so neither canvas's closure gets them — fail closed: a frame
 * on A never reads or writes B's threads or board. Path-keyed siblings (meta, css) are A's alone.
 */
function ownedOf(canvas: string, twins?: Map<string, Set<string>>): string[] {
  const slug = canvasSlugFromRel(canvas, '');
  const shared = (twins?.get(slug)?.size ?? 0) > 1;
  if (shared && !warnedSlugTwins.has(slug)) {
    warnedSlugTwins.add(slug);
    console.warn(
      `[access] ${[...(twins?.get(slug) ?? [])].sort().join(', ')} share the slug "${slug}"; their comments, board and EDL are not reachable from a canvas-only session until one is renamed`
    );
  }
  const ROOT = '/__maude_closure__/.design';
  const paths = {
    designRoot: ROOT,
    designRel: '.design',
    historyDir: `${ROOT}/_history`,
    canvasStateDir: `${ROOT}/_canvas-state`,
    commentsDir: `${ROOT}/_comments`,
  } as unknown as Paths;
  const out: string[] = [];
  for (const a of canvasArtifacts({ rel: canvas, paths })) {
    if (shared && a.kind === 'slug-keyed') continue;
    const rel = path.posix.relative(ROOT, a.abs.split(sep).join('/'));
    if (a.versioned || rel.startsWith('_comments/')) out.push(rel);
  }
  return out;
}

/** A bounded LRU of computed closures, keyed by (sorted grants, head). One per project. */
export interface ClosureCache {
  get(key: string): Closure | undefined;
  set(key: string, value: Closure): void;
}

export function createClosureCache(max = 64): ClosureCache {
  const m = new Map<string, Closure>();
  return {
    get(key) {
      const v = m.get(key);
      if (v !== undefined) {
        m.delete(key);
        m.set(key, v);
      }
      return v;
    },
    set(key, value) {
      m.delete(key);
      m.set(key, value);
      while (m.size > max) m.delete(m.keys().next().value as string);
    },
  };
}

const VROOT = '/__maude_closure__';

/**
 * The closure of `access`'s grants over `project`. Computed for any session with grants (a
 * canvas-only session, or a project role raised on one canvas, G1); empty without grants.
 */
export function closureFor(
  access: Access,
  project: ProjectReader,
  cache?: ClosureCache,
  config?: ClosureConfig
): Closure {
  const head = project.head();
  const cfg = config ?? closureConfigOf(readJsonObject(project, 'config.json'));
  const grantsKey = access.grants.map((g) => `${g.c}\u0000${g.r}`).join('\u0001');
  const key = `${head}\u0002${grantsKey}\u0003${JSON.stringify(cfg)}`;
  const hit = cache?.get(key);
  if (hit) return hit;
  const computed = compute(
    access.grants.map((g) => g.c),
    project,
    head,
    cfg
  );
  cache?.set(key, computed);
  return computed;
}

/** A canvas's slug-keyed and same-name sidecars that are never a module of another canvas. */
const CANVAS_SIDECAR_RE =
  /\.(meta\.json|registry\.json|annotations\.json|annotations\.svg|edl\.json)$/i;

/**
 * What one canvas's import walk reaches: the files read (in walk order, each with its text) and
 * (gate-b-c4j) the OTHER canvases it refused. One walk, shared by the closure (`compute`) and the
 * shell's per-canvas report (`canvasImportsReport`), so the refusal and the card agree.
 */
interface WalkEnv {
  files: ReadonlySet<string>;
  textOf: (rel: string) => string | null;
  isCanvas: (rel: string) => boolean;
  cfg: ClosureConfig;
  project: ProjectReader;
}

function walkEnv(project: ProjectReader, files: ReadonlySet<string>, cfg: ClosureConfig): WalkEnv {
  const textCache = new Map<string, string | null>();
  const textOf = (rel: string) => {
    if (!textCache.has(rel)) textCache.set(rel, files.has(rel) ? project.text(rel) : null);
    return textCache.get(rel) ?? null;
  };
  // gate-b-c4k — "a canvas" is decided by the FILE, the same on every machine and the hub: its
  // source renders DesignCanvas (skip-dirs.ts `isCanvasSource`), or it has a meta or a board. No
  // path rule and no config: c4g/c4j's groups + `components/` + `newComponentDir` were per-machine
  // (`.design/config.json` never syncs), so a meta-less canvas was "a component" on one machine and
  // inlined there (M1), and any DesignCanvas file under a `components/` folder was importable (M2).
  // gate-b-c4l — and it errs to "canvas": a DS specimen / UI-kit file by path (`isDsSurfaceRel`),
  // and a `.tsx` that imports a name a lib PROXY carries (`carriedBy` — a barrel re-exporting
  // DesignCanvas, a `.ts`/`.jsx` wrapper around it, any chain of them).
  const linksCache = new Map<string, ModuleLinks | null>();
  const linksOf = (rel: string): ModuleLinks | null => {
    if (!linksCache.has(rel)) {
      const text = MODULE_EXT_RE.test(rel) ? textOf(rel) : null;
      linksCache.set(rel, text === null ? null : moduleLinks(text));
    }
    return linksCache.get(rel) ?? null;
  };
  const NONE: ReadonlySet<string> = new Set();
  // gate-b-c4m (defender M-A) — `carriedBy` is a least fixed point over the re-export graph. It used
  // to cache NONE for a module still being computed and then keep whatever its cycle partners had
  // derived from that NONE: walking `a.ts` (`export { DesignCanvas as Foo } …` + `export * from
  // './b.ts'`) first left `b.ts` (`export { Foo } from './a.ts'`) carrying nothing for the rest of the
  // closure, so a `<Foo>` user reached through b.ts was "no canvas" for every later grant. Now a
  // top-level call iterates passes over its reachable modules until no value grows (the rule is
  // monotone — more carried names in a dep never means fewer out), and only then caches them.
  const carriedFinal = new Map<string, ReadonlySet<string>>();
  let approx: Map<string, ReadonlySet<string>> | null = null;
  let passSeen = new Set<string>();
  let grew = false;
  /** The names `spec` (written in `from`) exports that may be DesignCanvas. */
  const carriedBySpec = (from: string, spec: string): ReadonlySet<string> => {
    if (spec === CANVAS_LIB_SPEC) return LIB_CARRIED;
    if (!spec.startsWith('.')) return NONE;
    const out = new Set<string>();
    for (const abs of specCandidates(spec, `${VROOT}/${from}`, VROOT)) {
      const dep = abs
        .slice(VROOT.length + 1)
        .split(sep)
        .join('/');
      if (files.has(dep)) for (const n of carriedBy(dep)) out.add(n);
    }
    return out;
  };
  /** One pass's value for `rel`: its approximation when the pass already reached it (a cycle). */
  const carriedPass = (rel: string): ReadonlySet<string> => {
    const fin = carriedFinal.get(rel);
    if (fin) return fin;
    const map = approx as Map<string, ReadonlySet<string>>;
    if (passSeen.has(rel)) return map.get(rel) ?? NONE;
    passSeen.add(rel);
    const links = linksOf(rel);
    const out = new Set<string>();
    if (links) {
      // It uses DesignCanvas itself, or imports a carried name: any export may be it.
      // p8-c4 (defender round 8, M) — EVERY import is evaluated, every pass: a short-circuit
      // (`.some`) stopped at the first import that reached, so a module behind a later import that
      // this pass did not revisit kept an earlier pass's approximation, and the fixed point then
      // cached it as final ("carries nothing") for every later grant in this closure.
      let reaches = links.namesRoot || links.computedImport;
      for (const i of links.imports)
        if (importReaches(i, carriedBySpec(rel, i.spec))) reaches = true;
      if (reaches) out.add(CARRIES_ALL);
      for (const re of links.reexports) {
        const via = carriedBySpec(rel, re.spec);
        // A re-export of the literal name is a proxy whatever its source carries (monotone).
        for (const [from, to] of re.items) if (from === 'DesignCanvas') out.add(to);
        if (via.size === 0) continue;
        if (re.star) for (const n of via) if (n !== 'default') out.add(n);
        if (re.nsName !== null) out.add(re.nsName);
        for (const [from, to] of re.items)
          if (via.has(CARRIES_ALL) || via.has(from) || from === ODD_NAME) out.add(to);
      }
      if (out.has(ODD_NAME)) out.add(CARRIES_ALL);
    }
    if (out.size !== (map.get(rel)?.size ?? 0)) grew = true;
    map.set(rel, out);
    return out;
  };
  /** The names module `rel` exports that may be DesignCanvas (`CARRIES_ALL`: any of them). */
  const carriedBy = (rel: string): ReadonlySet<string> => {
    const fin = carriedFinal.get(rel);
    if (fin) return fin;
    if (approx) return carriedPass(rel); // inside a pass
    approx = new Map();
    try {
      do {
        grew = false;
        passSeen = new Set();
        carriedPass(rel);
      } while (grew);
      for (const [k, v] of approx) carriedFinal.set(k, v);
    } finally {
      approx = null;
    }
    return carriedFinal.get(rel) ?? NONE;
  };
  // p8-c4b — a canvas the authority knows of (a stored grant) is one, whatever its file says.
  const known: ReadonlySet<string> = new Set(cfg.knownCanvases ?? []);
  const isCanvas = (rel: string): boolean => {
    // gate-b-c4m — an `.html` canvas carries no marker: the index's own path predicate decides, and
    // every DS surface errs to canvas (an `.html` specimen is one). Only a file that exists.
    if (/\.html$/i.test(rel))
      return files.has(rel) && (known.has(rel) || isCanvasFile(rel) || isDsSurfaceRel(rel));
    if (!/\.tsx$/i.test(rel)) return false;
    if (known.has(rel)) return true;
    // p8 lead (maude/v2-p8-lead-underscore-file-is-a-module) — a `_` file is a module whatever it
    // renders; only its own meta / board (below) or a stored grant (above) makes it a canvas.
    if (files.has(rel) && !isUnderscoreModuleRel(rel)) {
      if (isDsSurfaceRel(rel) || isCanvasSource(textOf(rel))) return true;
      const links = linksOf(rel);
      if (links?.imports.some((i) => importReaches(i, carriedBySpec(rel, i.spec)))) return true;
    }
    return (
      files.has(rel.replace(/\.tsx$/i, '.meta.json')) ||
      files.has(`${canvasSlugFromRel(rel, '')}.annotations.json`) ||
      files.has(`${canvasSlugFromRel(rel, '')}.annotations.svg`)
    );
  };
  return { files, textOf, isCanvas, cfg, project };
}

const SAME_NAME_RE =
  /\.(css|meta\.json|registry\.json|annotations\.json|annotations\.svg|edl\.json)$/i;

/**
 * The canvases a source, same-name stylesheet or path-keyed sidecar may belong to (`x.tsx` and,
 * gate-b-c4m, `x.html`); a source is its own.
 */
const canvasesOfFile = (rel: string): string[] => {
  if (!SAME_NAME_RE.test(rel)) return [rel];
  const stem = rel.replace(SAME_NAME_RE, '');
  return [`${stem}.tsx`, `${stem}.html`];
};

/**
 * gate-b-c4m (defender M-B) — a DS surface's stylesheet (`system/<ds>/preview/x.css`,
 * `system/<ds>/ui_kits/…/x.css`) is the system's styling: real canvases lift it, so IMPORTING it is
 * never importing the specimen beside it (which stays a canvas, `.tsx` / `.html`). The DS folder
 * itself still hands it only to the specimen (c4l) — a DS user reads it when it imports it.
 */
const isDsSurfaceStyle = (rel: string): boolean =>
  /\.css$/i.test(rel) && isDsSurfaceRel(rel.replace(/\.css$/i, '.tsx')) && !isUiKitRel(rel);

/**
 * p8-c4 (attacker round 8, L) — a UI kit / platform showcase (`system/<ds>/ui_kits/**`,
 * `system/<ds>/preview/ui_kits-<platform>-<name>.*`) is a canvas of the project's own layout, not
 * the system's styling: its stylesheet is that canvas's, so the specimen-stylesheet exemption
 * stops here and importing it is importing that canvas (refused unless granted, c4j). Pure.
 */
function isUiKitRel(rel: string): boolean {
  const segs = rel.split('/');
  if (segs.length < 4 || segs[0] !== 'system') return false;
  return segs[2] === 'ui_kits' || (segs[2] === 'preview' && /^ui_kits-/i.test(segs[3] ?? ''));
}

/** The Design system canvas's file name inside `system/<ds>/` (ds/engine.ts `DS_CANVAS`). */
const DS_BOARD_FILE = 'design-system.tsx';

function walkImports(
  env: WalkEnv,
  canvas: string,
  granted: ReadonlySet<string>
): { visited: Array<{ rel: string; text: string }>; refused: Set<string>; blocked: boolean } {
  // gate-b-c4e — what an import may pull into the closure. A file of the design root's runtime
  // state never (the build refuses it too); a canvas's board / meta / EDL never (they are that
  // canvas's, not a module). Helpers, components and the design system stay reachable.
  // gate-b-c4j — another CANVAS (or its same-name stylesheet) NEVER, unless the closure itself holds
  // it: a frame never inlines a canvas outside its own grant, whoever opens it (the desktop owner
  // too — A's author chose the import, and the opener's access is not A's author's). The frame's
  // module is then refused at serve time (the inputs gate, 403) and the shell says why.
  const refused = new Set<string>();
  // gate-b-c4l — anything the walk does not follow, or cannot resolve, blocks the canvas.
  let blocked = false;
  const importable = (dep: string): boolean => {
    if (dep.startsWith('_') || CANVAS_SIDECAR_RE.test(dep)) return false;
    // p8-c4 (attacker round 8, L) — a per-use photo edit is read ONLY through a granted canvas's
    // own `data-photo-edit` on the element whose `src` is the picture (S8 §5.6, U1), never as an
    // imported JSON module (its hash would be the only key).
    if (PER_USE_PHOTO_RE.test(dep)) return false;
    const owners = isDsSurfaceStyle(dep) ? [] : /\.css$/i.test(dep) ? canvasesOfFile(dep) : [dep];
    for (const owner of owners)
      if (!granted.has(owner) && env.isCanvas(owner)) {
        refused.add(owner);
        return false;
      }
    // gate-b-c4m — a module, a stylesheet or JSON; anything else blocks (`IMPORTABLE_EXT_RE`).
    return IMPORTABLE_EXT_RE.test(dep);
  };
  // The transitive relative import graph, from the canvas (and the DS override it pulls in).
  const queue: string[] = [canvas];
  const sys = canvasSystem(env.project, canvas, env.cfg);
  const canvasText = env.textOf(canvas);
  if (sys && canvasText !== null && importsDs(canvasText))
    queue.push(`${sys.path}/preview/_ds.tsx`);
  // p8-ds-board-specimens — the specimens a canvas draws with `<Specimen src>` are imports too: the
  // generated `@maude/ds/board` module inlines each one (ds-resolver `specimenFiles`, the same
  // `specimenRels` rule). The Design system canvas (`system/<ds>/design-system.tsx`) and its OWN
  // system's specimens / UI kits are one unit — the board is how a system is drawn — so its walk
  // admits them although each is a canvas by path (c4l). Every other `<Specimen>` user goes through
  // `importable` like any import, so a specimen is refused to it (c4j), and a specimen the board
  // admits is walked under the same rules (its own canvas imports still block the board).
  const specimens =
    sys && canvasText !== null && importsDsBoard(canvasText)
      ? specimenRels(sys.path, canvasText)
          .map((s) => s.rel)
          .filter((r) => env.files.has(r))
      : [];
  // V2-8.9 defender L3: sys.path is read from the peer-writable config.json, so the board rule
  // holds only for a real system folder (`system/<one segment>`) and only its own files — a path of
  // bare `system` would otherwise admit every other system's specimens to that one grant.
  const ownBoard =
    sys !== null && DS_SYSTEM_PATH_RE.test(sys.path) && canvas === `${sys.path}/${DS_BOARD_FILE}`;
  const ownSurface = (dep: string): boolean =>
    ownBoard && dep.startsWith(`${sys?.path}/`) && isDsSurfaceRel(dep);
  // p8-c4 — and the stylesheet of one of them (a showcase's own `.css` is no longer DS styling for
  // everyone, `isUiKitRel`, but the board draws the showcase, so it reads its stylesheet).
  const ownSurfaceStyle = (dep: string): boolean =>
    /\.css$/i.test(dep) && ownSurface(dep.replace(/\.css$/i, '.tsx'));
  const seen = new Set<string>();
  const visited: Array<{ rel: string; text: string }> = [];
  while (queue.length) {
    const rel = queue.shift() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const text = env.textOf(rel);
    if (text === null) continue;
    visited.push({ rel, text });
    if (rel === canvas)
      for (const dep of specimens) {
        if (seen.has(dep)) continue;
        if (ownSurface(dep) || importable(dep)) queue.push(dep);
        else blocked = true;
      }
    if (!MODULE_EXT_RE.test(rel) && !/\.css$/i.test(rel)) continue;
    for (const group of relativeImportGroups(text, `${VROOT}/${rel}`, VROOT)) {
      let resolved = false;
      for (const abs of group) {
        const dep = abs
          .slice(VROOT.length + 1)
          .split(sep)
          .join('/');
        if (!env.files.has(dep)) continue;
        resolved = true;
        if (seen.has(dep)) continue;
        if (ownSurfaceStyle(dep) || importable(dep)) queue.push(dep);
        else blocked = true;
      }
      if (!resolved) blocked = true;
    }
  }
  return { visited, refused, blocked: blocked || refused.size > 0 };
}

/**
 * gate-b-c4j — per canvas, the other canvases its import walk refuses (sorted; a canvas importing
 * none is absent): a frame on it renders none of them, so its module is refused. What the shell
 * reads to say why on that canvas (`/_index-data` `canvasImportsCanvases`). Reader-free — the
 * refusal is the same for everyone; the caller holds the names to what its reader sees.
 */
export function canvasImportsReport(
  project: ProjectReader,
  canvases: readonly string[],
  config?: ClosureConfig
): Map<string, string[]> {
  const files = new Set<string>(project.list());
  const cfg = config ?? closureConfigOf(readJsonObject(project, 'config.json'));
  const env = walkEnv(project, files, cfg);
  const out = new Map<string, string[]>();
  for (const canvas of canvases) {
    if (!files.has(canvas)) continue;
    const { refused } = walkImports(env, canvas, new Set([canvas]));
    if (refused.size) out.set(canvas, [...refused].sort());
  }
  return out;
}

function compute(
  canvases: string[],
  project: ProjectReader,
  head: string,
  cfg: ClosureConfig
): Closure {
  const owned = new Set<string>();
  const ownedBy = new Map<string, string>();
  const read = new Set<string>();
  const dynamic = new Set<string>();
  const blocked = new Set<string>();
  const assetUsers = new Map<string, Set<string>>();
  const assetStems = new Set<string>();
  const frozen = () =>
    Object.freeze({ head, owned, ownedBy, read, assetUsers, assetStems, dynamic, blocked });
  if (!canvases.length) return frozen();

  const files = new Set<string>();
  for (const f of project.list()) files.add(f);
  for (const f of files) {
    if (!f.startsWith('assets/')) continue;
    const name = f.slice('assets/'.length);
    const dot = name.indexOf('.');
    assetStems.add(dot > 0 ? `assets/${name.slice(0, dot)}` : f);
  }
  const env = walkEnv(project, files, cfg);
  const { textOf } = env;
  const twins = slugTwins(files, canvases);
  const existingAssetRefs = (text: string) =>
    staticAssetRefs(text).filter((r) => files.has(r) && !isAssetSidecar(r, files));
  const granted = new Set(canvases);

  const closureAssets = new Set<string>();
  const perUse = new Set<string>();
  for (const canvas of canvases) {
    for (const rel of ownedOf(canvas, twins)) {
      owned.add(rel);
      if (!ownedBy.has(rel)) ownedBy.set(rel, canvas);
      read.add(rel);
      // S8 §5.6: a per-use edit is read only through the attribute in a granted canvas's own file.
      const text = TEXT_SCAN_RE.test(rel) ? textOf(rel) : null;
      if (text !== null) for (const p of perUsePhotoRefs(text)) if (files.has(p)) perUse.add(p);
    }
    const walk = walkImports(env, canvas, granted);
    // gate-b-c4l (STRUCTURAL) — a walk that refused anything grants nothing past the canvas's own
    // files: not the helpers it walked (one of them may BE a canvas the marker missed — a wrapper's
    // user, a barrel's user), not the design system, not an asset. Its frame is refused anyway.
    if (walk.blocked) {
      blocked.add(canvas);
      const own = walk.visited.find((v) => v.rel === canvas);
      if (own && DYNAMIC_RES.some((re) => re.test(own.text))) dynamic.add(canvas);
      continue;
    }
    for (const { rel, text } of walk.visited) {
      read.add(rel);
      if (DYNAMIC_RES.some((re) => re.test(text))) dynamic.add(canvas);
      for (const a of existingAssetRefs(text)) closureAssets.add(a);
    }
    const sys = canvasSystem(project, canvas, cfg);
    // Static asset references in the canvas's own sidecars (meta, board).
    for (const rel of ownedOf(canvas, twins)) {
      if (rel === canvas || !TEXT_SCAN_RE.test(rel)) continue;
      const text = textOf(rel);
      if (text === null) continue;
      if (DYNAMIC_RES.slice(0, 2).some((re) => re.test(text))) dynamic.add(canvas);
      for (const a of existingAssetRefs(text)) closureAssets.add(a);
    }
    // The design system it renders under, minus specimens, UI kits and (gate-b-c4j) any other canvas
    // there — the DS board `design-system.tsx` and its sidecars are a canvas, not the system.
    if (sys)
      for (const f of files) {
        if (!isSystemFileInClosure(sys.path, f)) continue;
        if (canvasesOfFile(f).some((o) => !granted.has(o) && env.isCanvas(o))) continue;
        read.add(f);
      }
  }

  for (const asset of closureAssets) {
    read.add(asset);
    const base = asset.slice(0, asset.lastIndexOf('.'));
    for (const suffix of ASSET_SIDECAR_SUFFIXES) {
      const side = `${base}${suffix}`;
      if (side !== asset && files.has(side) && !PER_USE_PHOTO_RE.test(side)) read.add(side);
    }
    assetUsers.set(asset, new Set());
  }
  // Only for an asset the closure already holds (the element's own `src` put it there).
  for (const p of perUse) {
    const base = (PER_USE_PHOTO_RE.exec(p) as RegExpExecArray)[1] as string;
    for (const asset of closureAssets)
      if (asset.slice(0, asset.lastIndexOf('.')) === base) {
        read.add(p);
        break;
      }
  }

  // Every referrer of every closure asset, project-wide (the photo-sidecar rule, G2). A file
  // owned by a granted canvas counts as that canvas; any other file counts as itself.
  if (assetUsers.size) {
    const ownerOf = new Map<string, string>();
    for (const [rel, c] of ownedBy) ownerOf.set(rel, c);
    const canvasOfSidecar = (rel: string): string | null => {
      if (ownerOf.has(rel)) return ownerOf.get(rel) as string;
      const meta = /^(.*)\.meta\.json$/i.exec(rel);
      if (meta && files.has(`${meta[1]}.tsx`)) return `${meta[1]}.tsx`;
      return null;
    };
    for (const f of files) {
      if (!TEXT_SCAN_RE.test(f) || f.startsWith('assets/') || f.startsWith('_')) continue;
      const text = textOf(f);
      if (text === null || !text.includes('assets/')) continue;
      for (const ref of staticAssetRefs(text)) {
        const users = assetUsers.get(ref);
        if (users) users.add(canvasOfSidecar(f) ?? f);
      }
    }
  }

  return frozen();
}

/**
 * gate-b-c4b — every file that references `asset` (`assets/<name>`), project-wide, the way the
 * photo-sidecar rule counts referrers (`assetUsers` above): a `.meta.json` as its canvas, any other
 * text as itself; runtime state (a first-segment `_` dir) and `assets/` never count. The bg-remove
 * harness frame is minted over these, so it may read the photo and write its every-use edit.
 */
export function assetReferrers(project: ProjectReader, asset: string): string[] {
  const files = new Set(project.list());
  const out = new Set<string>();
  for (const f of files) {
    if (!TEXT_SCAN_RE.test(f) || f.startsWith('assets/') || f.startsWith('_')) continue;
    const text = project.text(f);
    if (text === null || !text.includes('assets/')) continue;
    if (!staticAssetRefs(text).includes(asset)) continue;
    const meta = /^(.*)\.meta\.json$/i.exec(f);
    out.add(meta && files.has(`${meta[1]}.tsx`) ? `${meta[1]}.tsx` : f);
  }
  return [...out].sort();
}

function isAssetSidecar(rel: string, files: Set<string>): boolean {
  // A per-use edit is never an asset of its own, even when a text names its path literally.
  if (PER_USE_PHOTO_RE.test(rel)) return true;
  for (const suffix of ASSET_SIDECAR_SUFFIXES) {
    if (!rel.endsWith(suffix)) continue;
    const base = rel.slice(0, -suffix.length);
    for (const f of files) if (f !== rel && f.startsWith(`${base}.`)) return true;
  }
  return false;
}
