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
import type { Paths } from '../context.ts';
import { dsDepsFor, importsDs } from '../ds/ds-resolver.ts';
import { type Access, PER_USE_PHOTO_RE } from './scope.ts';

/** Relative import specifiers (side-effect, `from`, literal dynamic `import()`), in source order. */
const SPEC_RES = [
  /\bimport\s+["']([^"']+)["']/g, // side-effect: import './x.css' (also CSS `@import './x.css'`)
  /\bfrom\s+["']([^"']+)["']/g, // import … from / export … from
  /\bimport\(\s*["']([^"']+)["']\s*\)/g, // dynamic import('./x')
];

const CODE_EXT_RE = /\.(css|tsx|ts|jsx|js)$/i;

/**
 * Every resolution candidate of every RELATIVE import in `source`, as absolute paths clamped to
 * `designRoot` (a canvas source is attacker-influenced under linked mode, DDR-054). Extensionless
 * specifiers contribute every candidate (`.tsx`, `.ts`, `.jsx`, `.js`, `index.tsx`, `index.ts`).
 * Bare / virtual specifiers are skipped. No `@maude/ds` handling — see `localDepsFromSource`.
 */
export function relativeImportCandidates(
  source: string,
  canvasAbsPath: string,
  designRoot: string
): string[] {
  const dir = dirname(canvasAbsPath);
  const root = resolve(designRoot);
  const deps: string[] = [];
  const seen = new Set<string>();
  const push = (abs: string) => {
    if (abs !== root && !abs.startsWith(root + sep)) return; // clamp (DDR-054)
    if (seen.has(abs)) return;
    seen.add(abs);
    deps.push(abs);
  };
  for (const re of SPEC_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m !== null; m = re.exec(source)) {
      const spec = m[1];
      if (!spec?.startsWith('.')) continue;
      const base = resolve(dir, spec);
      if (CODE_EXT_RE.test(spec)) {
        push(base);
      } else {
        for (const cand of [
          `${base}.tsx`,
          `${base}.ts`,
          `${base}.jsx`,
          `${base}.js`,
          resolve(base, 'index.tsx'),
          resolve(base, 'index.ts'),
        ])
          push(cand);
      }
    }
  }
  return deps;
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

const TEXT_SCAN_RE = /\.(tsx|ts|jsx|js|css|json|svg)$/i;
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
function canvasSystem(
  project: ProjectReader,
  canvas: string,
  systems: DsSystem[]
): DsSystem | null {
  if (!systems.length) return null;
  const owner = systems.find((s) => canvas.startsWith(`${s.path}/`));
  if (owner) return owner;
  const declared = readJsonObject(
    project,
    canvas.replace(/\.(tsx|html)$/i, '.meta.json')
  )?.designSystem;
  const byMeta = typeof declared === 'string' ? systems.find((s) => s.name === declared) : null;
  if (byMeta) return byMeta;
  const def = readJsonObject(project, 'config.json')?.defaultDesignSystem;
  return systems.find((s) => s.name === def) ?? systems[0] ?? null;
}

function systemsOf(project: ProjectReader): DsSystem[] {
  const list = readJsonObject(project, 'config.json')?.designSystems;
  if (!Array.isArray(list)) return [];
  const out: DsSystem[] = [];
  for (const e of list as Array<Record<string, unknown>>) {
    if (!e || typeof e.name !== 'string' || typeof e.path !== 'string') continue;
    const p = e.path.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    if (!p || p.split('/').includes('..')) continue;
    out.push({ name: e.name, path: p });
  }
  return out;
}

/** A design-system file a canvas-only session reads: not a specimen, not a UI kit. */
function isSystemFileInClosure(sysPath: string, rel: string): boolean {
  if (!rel.startsWith(`${sysPath}/`)) return false;
  const sub = rel.slice(sysPath.length + 1);
  if (sub.startsWith('ui_kits/')) return false;
  if (sub.startsWith('preview/') && /\.(tsx|jsx)$/i.test(sub)) {
    // `preview/_ds.tsx` (the `@maude/ds` override) and other `_`-prefixed helpers are modules,
    // not specimens; the import walk adds any specimen a canvas actually imports.
    return path.posix.basename(sub).startsWith('_');
  }
  return true;
}

/** The versioned sidecars + comments of a canvas, from the one artifact inventory. */
function ownedOf(canvas: string): string[] {
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
export function closureFor(access: Access, project: ProjectReader, cache?: ClosureCache): Closure {
  const head = project.head();
  const grantsKey = access.grants.map((g) => `${g.c}\u0000${g.r}`).join('\u0001');
  const key = `${head}\u0002${grantsKey}`;
  const hit = cache?.get(key);
  if (hit) return hit;
  const computed = compute(
    access.grants.map((g) => g.c),
    project,
    head
  );
  cache?.set(key, computed);
  return computed;
}

function compute(canvases: string[], project: ProjectReader, head: string): Closure {
  const owned = new Set<string>();
  const ownedBy = new Map<string, string>();
  const read = new Set<string>();
  const dynamic = new Set<string>();
  const assetUsers = new Map<string, Set<string>>();
  const assetStems = new Set<string>();
  if (!canvases.length) {
    return Object.freeze({ head, owned, ownedBy, read, assetUsers, assetStems, dynamic });
  }

  const files = new Set<string>();
  for (const f of project.list()) files.add(f);
  for (const f of files) {
    if (!f.startsWith('assets/')) continue;
    const name = f.slice('assets/'.length);
    const dot = name.indexOf('.');
    assetStems.add(dot > 0 ? `assets/${name.slice(0, dot)}` : f);
  }
  const systems = systemsOf(project);
  const textCache = new Map<string, string | null>();
  const textOf = (rel: string) => {
    if (!textCache.has(rel)) textCache.set(rel, files.has(rel) ? project.text(rel) : null);
    return textCache.get(rel) ?? null;
  };
  const existingAssetRefs = (text: string) =>
    staticAssetRefs(text).filter((r) => files.has(r) && !isAssetSidecar(r, files));

  const closureAssets = new Set<string>();
  const perUse = new Set<string>();
  for (const canvas of canvases) {
    for (const rel of ownedOf(canvas)) {
      owned.add(rel);
      if (!ownedBy.has(rel)) ownedBy.set(rel, canvas);
      read.add(rel);
      // S8 §5.6: a per-use edit is read only through the attribute in a granted canvas's own file.
      const text = TEXT_SCAN_RE.test(rel) ? textOf(rel) : null;
      if (text !== null) for (const p of perUsePhotoRefs(text)) if (files.has(p)) perUse.add(p);
    }
    // The transitive relative import graph, from the canvas (and the DS override it pulls in).
    const queue: string[] = [canvas];
    const sys = canvasSystem(project, canvas, systems);
    const canvasText = textOf(canvas);
    if (sys && canvasText !== null && importsDs(canvasText))
      queue.push(`${sys.path}/preview/_ds.tsx`);
    const visited = new Set<string>();
    while (queue.length) {
      const rel = queue.shift() as string;
      if (visited.has(rel)) continue;
      visited.add(rel);
      const text = textOf(rel);
      if (text === null) continue;
      read.add(rel);
      if (DYNAMIC_RES.some((re) => re.test(text))) dynamic.add(canvas);
      for (const a of existingAssetRefs(text)) closureAssets.add(a);
      if (!/\.(tsx|ts|jsx|js|css)$/i.test(rel)) continue;
      for (const abs of relativeImportCandidates(text, `${VROOT}/${rel}`, VROOT)) {
        const dep = abs
          .slice(VROOT.length + 1)
          .split(sep)
          .join('/');
        if (files.has(dep) && !visited.has(dep)) queue.push(dep);
      }
    }
    // Static asset references in the canvas's own sidecars (meta, board).
    for (const rel of ownedOf(canvas)) {
      if (rel === canvas || !TEXT_SCAN_RE.test(rel)) continue;
      const text = textOf(rel);
      if (text === null) continue;
      if (DYNAMIC_RES.slice(0, 2).some((re) => re.test(text))) dynamic.add(canvas);
      for (const a of existingAssetRefs(text)) closureAssets.add(a);
    }
    // The design system it renders under, minus specimens and UI kits.
    if (sys) for (const f of files) if (isSystemFileInClosure(sys.path, f)) read.add(f);
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

  return Object.freeze({ head, owned, ownedBy, read, assetUsers, assetStems, dynamic });
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
