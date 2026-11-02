// index/extractors/asset-usage.ts — which canvases use which asset (S8.11, contract V2-1.17 §5.4/§5.5).
//
// An asset is `<designRoot>/assets/<name>`. A canvas USES it when the canvas source, one of its
// sidecars (`.meta.json`, `.css`, `.registry.json`, `.annotations.*`) or a module in its relative-
// import closure names `assets/<name>`. Everything else that names it (the design system, config,
// a module no canvas imports) is "used elsewhere": use, with no canvas to point at. Both are enough
// to keep the asset out of "Not used" — a false "not used" is the one wrong answer (§5.5).
//
// The scan reads the same vocabulary as the access closure (`access/closure.ts` `staticAssetRefs`,
// V2-1.7 G3: literal `assets/…` paths only, `${…}` and `"assets/" + x` are NOT resolved). Its copy
// lives here so the index stays a leaf module (a helper imports it; the closure pulls in the ACL);
// `test/asset-usage.test.ts` holds the two scanners equal on a corpus.
//
// Lazy and incremental: nothing is read until the first question; after that `touch(rel)` rescans
// one file (≤ 2 ms) and the canvas→assets map is recomputed on the next question.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { SKIP_DIRS } from '../../skip-dirs.ts';
import type { AssetKind } from '../types.ts';

export const ASSET_USAGE_VERSION = 1;

// ── kinds ───────────────────────────────────────────────────────────────────────────────────

const KIND_BY_EXT: Record<string, AssetKind> = {};
for (const [kind, exts] of Object.entries({
  image: 'png jpg jpeg gif webp avif svg heic heif bmp tif tiff ico',
  video: 'mp4 webm mov m4v ogv',
  audio: 'mp3 wav m4a aac flac oga ogg opus',
  font: 'woff woff2 ttf otf',
  document: 'pdf',
}))
  for (const e of exts.split(' ')) KIND_BY_EXT[e] = kind as AssetKind;

/** The kind of an `assets/` file, or null for a sidecar / unknown file (`.photo.json`, `.gen.json`, …). */
export function assetKindOf(name: string): AssetKind | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return KIND_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Kinds the thumbnail renderer can draw (raster + video; SVG is scriptable, DDR-145). */
const TILE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'mp4',
  'webm',
  'mov',
  'm4v',
]);
export const hasTile = (name: string) =>
  TILE_EXTS.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase());

// ── references ──────────────────────────────────────────────────────────────────────────────

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
 * Static `assets/…` references in a text, as designRoot-relative paths, de-duplicated. Same rule as
 * `access/closure.ts staticAssetRefs`: `assets/` starts a token, or follows `./`, `../`, `.design/`
 * or a root `/` — so `system/<ds>/assets/x` is not mistaken for a project asset.
 */
export function assetRefsOf(text: string): string[] {
  if (!text.includes('assets/')) return [];
  const out = new Set<string>();
  let i = text.indexOf('assets/');
  while (i !== -1) {
    const prev = i === 0 ? '' : (text[i - 1] as string);
    let ok = prev === '' || !/[A-Za-z0-9_\-/.]/.test(prev);
    if (prev === '/') {
      let k = i - 2;
      while (k >= 0 && /[A-Za-z0-9_\-.]/.test(text[k] as string)) k--;
      const seg = text.slice(k + 1, i - 1);
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
      if (ref.length > 'assets/'.length && !ref.includes('${')) out.add(ref);
    }
    i = text.indexOf('assets/', i + 1);
  }
  return [...out];
}

/** A computed asset path — not resolved, so the file that has one cannot prove an asset unused. */
const DYNAMIC_RES = [/assets\/\$\{/, /["'`]assets\/["'`]\s*\+/];
export const hasComputedAssetRef = (text: string) =>
  text.includes('assets/') && DYNAMIC_RES.some((re) => re.test(text));

const SPEC_RES = [
  /\bimport\s+["']([^"']+)["']/g,
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /@import\s+(?:url\()?["']([^"']+)["']/g,
];
const CODE_EXT_RE = /\.(css|tsx|ts|jsx|js)$/i;

/** Every resolution candidate of every RELATIVE import in `text`, designRoot-relative posix. */
export function importCandidatesOf(text: string, fromRel: string): string[] {
  const out = new Set<string>();
  const dir = path.posix.dirname(fromRel);
  const push = (p: string) => {
    if (p === '..' || p.startsWith('../')) return; // clamp to the design root (DDR-054)
    out.add(p);
  };
  for (const re of SPEC_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const spec = m[1];
      if (!spec?.startsWith('.')) continue;
      const base = path.posix.normalize(path.posix.join(dir, spec));
      if (CODE_EXT_RE.test(spec)) push(base);
      else
        for (const c of [
          `${base}.tsx`,
          `${base}.ts`,
          `${base}.jsx`,
          `${base}.js`,
          `${base}/index.tsx`,
          `${base}/index.ts`,
        ])
          push(c);
    }
  }
  return [...out];
}

// ── the tracker ─────────────────────────────────────────────────────────────────────────────

const TEXT_RE = /\.(tsx|ts|jsx|js|css|json|svg)$/i;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Files that ride with a canvas `<stem>.tsx` and render with it. */
const SIDECAR_SUFFIXES = [
  '.meta.json',
  '.css',
  '.registry.json',
  '.annotations.json',
  '.annotations.svg',
];

interface Entry {
  refs: string[];
  imports: string[];
  dynamic: boolean;
}
const sameEntry = (a: Entry | undefined, b: Entry | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.dynamic === b.dynamic &&
    a.refs.join('\0') === b.refs.join('\0') &&
    a.imports.join('\0') === b.imports.join('\0'));

export interface AssetUse {
  /** canvases that use the asset (sorted) */
  canvases: string[];
  /** named by a file that no canvas renders from */
  elsewhere: boolean;
}

export interface AssetUsage {
  /** Read the project's text files (idempotent). */
  init(): void;
  initialized(): boolean;
  /** Forget everything; the next question rescans. */
  reset(): void;
  /** Re-read one designRoot-relative file; true when what it references changed. */
  touch(rel: string): boolean;
  /** asset rel → its use; assets nobody names are absent */
  all(): ReadonlyMap<string, AssetUse>;
  of(assetRel: string): AssetUse;
  /** canvases / files that build an asset path at runtime (cannot be resolved) */
  dynamicReferences(): string[];
}

export interface AssetUsageOptions {
  designRoot: string;
  /** the canvases the index lists (rows), designRoot-relative */
  canvases(): Iterable<string>;
}

export function createAssetUsage(o: AssetUsageOptions): AssetUsage {
  const files = new Map<string, Entry>();
  let ready = false;
  let dirty = true;
  let computed: {
    sig: string;
    byAsset: Map<string, AssetUse>;
    dynamic: string[];
  } | null = null;

  const skippedRel = (rel: string) => {
    const parts = rel.split('/');
    const first = parts[0] as string;
    if (first === 'assets' || first.startsWith('_') || first.startsWith('.')) return true;
    return parts.slice(0, -1).some((s) => SKIP_DIRS.has(s) || s.startsWith('.'));
  };

  function scan(rel: string): Entry | undefined {
    if (!TEXT_RE.test(rel) || skippedRel(rel)) return undefined;
    let text: string;
    try {
      const abs = path.join(o.designRoot, rel);
      const st = statSync(abs, { throwIfNoEntry: false });
      if (!st?.isFile() || st.size > MAX_TEXT_BYTES) return undefined;
      text = readFileSync(abs, 'utf8');
    } catch {
      return undefined;
    }
    const refs = assetRefsOf(text);
    const imports = /\.(css|tsx|ts|jsx|js)$/i.test(rel) ? importCandidatesOf(text, rel) : [];
    const dynamic = hasComputedAssetRef(text);
    if (!refs.length && !imports.length && !dynamic) return undefined;
    return { refs, imports, dynamic };
  }

  function walk(abs: string, rel: string) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      const childRel = rel ? `${rel}/${name}` : name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
        if (!rel && (name.startsWith('_') || name === 'assets')) continue;
        walk(path.join(abs, name), childRel);
      } else if (e.isFile()) {
        const entry = scan(childRel);
        if (entry) files.set(childRel, entry);
      }
    }
  }

  function compute() {
    const canvases = [...o.canvases()].sort();
    const sig = `${files.size}\0${canvases.join('\0')}`;
    if (computed?.sig === sig && !dirty) return computed;
    dirty = false;
    const byAsset = new Map<string, { canvases: Set<string>; elsewhere: boolean }>();
    const owned = new Set<string>();
    const dynamicOwners = new Set<string>();
    const use = (asset: string) => {
      let u = byAsset.get(asset);
      if (!u) {
        u = { canvases: new Set(), elsewhere: false };
        byAsset.set(asset, u);
      }
      return u;
    };
    for (const canvas of canvases) {
      const stem = canvas.replace(/\.tsx$/i, '');
      const queue = [canvas, ...SIDECAR_SUFFIXES.map((s) => `${stem}${s}`)];
      const seen = new Set<string>();
      while (queue.length) {
        const rel = queue.pop() as string;
        if (seen.has(rel)) continue;
        seen.add(rel);
        const entry = files.get(rel);
        if (!entry) continue;
        owned.add(rel);
        for (const a of entry.refs) use(a).canvases.add(canvas);
        if (entry.dynamic) dynamicOwners.add(canvas);
        for (const dep of entry.imports) if (!seen.has(dep)) queue.push(dep);
      }
    }
    const loose: string[] = [];
    for (const [rel, entry] of files) {
      if (owned.has(rel)) continue;
      for (const a of entry.refs) use(a).elsewhere = true;
      if (entry.dynamic) loose.push(rel);
    }
    const out = new Map<string, AssetUse>();
    for (const [a, u] of byAsset)
      out.set(a, { canvases: [...u.canvases].sort(), elsewhere: u.elsewhere });
    computed = { sig, byAsset: out, dynamic: [...dynamicOwners, ...loose].sort() };
    return computed;
  }

  const none: AssetUse = Object.freeze({ canvases: [], elsewhere: false }) as AssetUse;
  const tracker: AssetUsage = {
    init() {
      if (ready) return;
      files.clear();
      walk(o.designRoot, '');
      ready = true;
      dirty = true;
    },
    initialized: () => ready,
    reset() {
      files.clear();
      ready = false;
      dirty = true;
    },
    touch(rel) {
      if (!ready) return false;
      const before = files.get(rel);
      const after = scan(rel);
      if (sameEntry(before, after)) return false;
      if (after) files.set(rel, after);
      else files.delete(rel);
      dirty = true;
      return true;
    },
    all() {
      tracker.init();
      return compute().byAsset;
    },
    of(assetRel) {
      return tracker.all().get(assetRel) ?? none;
    },
    dynamicReferences() {
      tracker.init();
      return compute().dynamic;
    },
  };
  return tracker;
}
