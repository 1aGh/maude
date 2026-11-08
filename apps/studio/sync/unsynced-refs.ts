// Issue #158 — which files a linked canvas needs that never reach the workspace.
//
// A canvas builds fine on the Mac that has every file, so a canvas whose import sits in a `_helpers/`
// folder, or whose stylesheet names a font outside `assets/`, opens for its author and fails for the
// next person — silently. This is the read-only diagnostic that says so ahead of time: it walks each
// canvas's relative imports (the closure's own import grammar, access/closure.ts) and its stylesheet
// `url()` refs, judges every file it reaches against the sync set (the membership classifier,
// sync/file-membership.ts) and names the file and the reason.
//
// READ-ONLY IN BOTH DIRECTIONS. It never changes what syncs: `classifyProjectFile` and the push
// listing (`asset-push.ts` `listPushableAssets`) are only CALLED, with the same answer they give the
// plane — a test pins that the predicate's answers are untouched. And it reads the disk only (no
// network, no hub, no token), so `maude design status`, the smoke report and the Sync details panel
// can all ask it for the same answer.
//
// One thing the disk cannot tell it: whether the receiving side accepts shared code (the owner-hub
// gate). A `.ts` module outside a canvas is counted as travelling when file sync is on.

import { type Dirent, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { IMPORTABLE_EXT_RE, relativeImportSpecs, specCandidates } from '../access/closure.ts';
import { isCanvasSource } from '../skip-dirs.ts';
import {
  classifyProjectFile,
  isFilePlaneClass,
  isProjectFileShape,
  isRuntimeStateRel,
} from './file-membership.ts';
import { isIgnoredRel, normalizeIgnoreFolders } from './file-plane.ts';

export type UnsyncedReason =
  | 'runtime-state'
  | 'config'
  | 'ignored-folder'
  | 'symlink'
  | 'underscore-folder'
  | 'sync-files-off'
  | 'extension'
  | 'path-shape'
  | 'missing'
  | 'outside-root'
  | 'import-extension';

export interface UnsyncedRef {
  /** The canvas whose walk reached it (designRoot-relative). */
  canvas: string;
  /** The file that will not reach the workspace (designRoot-relative; the specifier for `outside-root`). */
  file: string;
  /** The specifier or url as written. */
  ref: string;
  via: 'import' | 'css-url';
  reason: UnsyncedReason;
  /** One sentence: why. */
  detail: string;
  /** One sentence: the way out. */
  fix: string;
}

export interface UnsyncedReport {
  /** The project names a workspace; an unlinked project is not checked. */
  linked: boolean;
  /** File sync is on (default on). */
  syncFiles: boolean;
  /** Canvases walked. */
  canvases: number;
  refs: UnsyncedRef[];
}

const WORDS: Record<UnsyncedReason, { why: (folder?: string) => string; fix: string }> = {
  'runtime-state': {
    why: () => "It is Maude's own working data, kept on each Mac",
    fix: 'Move what the canvas needs out of that folder.',
  },
  config: {
    why: () => "The project's config is never shared",
    fix: 'Move what the canvas needs into its own file.',
  },
  'ignored-folder': {
    why: () => 'Its folder is set not to sync',
    fix: 'Sync that folder again in Sync details, or move the file.',
  },
  symlink: {
    why: () => 'It is a link, and only real files are shared',
    fix: 'Copy the file into the project.',
  },
  'underscore-folder': {
    why: (f) => `It is in ${f ?? 'a folder'}, and folders starting with _ stay on this Mac`,
    fix: 'Rename the folder without the _.',
  },
  'sync-files-off': {
    why: () => 'This project shares only pictures, video and fonts inside assets/',
    fix: 'Move it into assets/, or turn on file sync in Settings › Advanced.',
  },
  extension: {
    why: () => 'This kind of file is not shared',
    fix: 'Keep it as code or a stylesheet, or put it in assets/.',
  },
  'path-shape': {
    why: () => "Its name or place can't be shared",
    fix: 'Rename or move it.',
  },
  missing: {
    why: () => 'It is not in this project',
    fix: 'Add it back, or fix the import.',
  },
  'outside-root': {
    why: () => 'It points outside the design folder',
    fix: 'Move the file into the design folder.',
  },
  'import-extension': {
    why: () => 'A canvas can only import code, stylesheets and JSON',
    fix: 'Put pictures and fonts in assets/ and refer to them by path.',
  },
};

const MODULE_RE = /\.(tsx|ts|jsx|js|mjs|cjs)$/i;
const CSS_RE = /\.css$/i;
const MAX_TEXT_BYTES = 1_500_000;
const MAX_WALK_DIRS = 4000;

type Probe = 'file' | 'link' | null;

export interface UnsyncedInput {
  /** What sits at a designRoot-relative path: a real file, a link, or nothing. */
  probe(rel: string): Probe;
  text(rel: string): string | null;
  /** Every canvas candidate (`.tsx` in a canvas group). */
  canvasCandidates: readonly string[];
  canvasGroups?: readonly { path?: string }[];
  syncFiles: boolean;
  ignoreFolders?: readonly string[];
  /** Absolute design root — `specCandidates` clamps against it. */
  designRoot: string;
}

/** `css url(...)` targets that are files of the project, in source order. */
function cssUrlRefs(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']+))\s*\)/gi;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('/') || raw.includes('${')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('var(')) continue; // data:, https:, …
    const clean = raw.replace(/[?#].*$/, '');
    if (clean) out.push(clean);
  }
  return out;
}

function decode(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** The pure walk. */
export function unsyncedRefs(input: UnsyncedInput): { canvases: number; refs: UnsyncedRef[] } {
  const { probe, designRoot } = input;
  const ignore = [...(input.ignoreFolders ?? [])];
  const classOpts = {
    canvasGroups: input.canvasGroups,
    hasFile: (r: string) => probe(r) === 'file',
  };
  const abs = (rel: string) => join(designRoot, ...rel.split('/'));
  const relOf = (a: string) =>
    posix.normalize(
      a
        .slice(resolve(designRoot).length + 1)
        .split('\\')
        .join('/')
    );

  /** Why a file that exists will not reach the workspace, or null when it does. */
  const judge = (
    rel: string,
    via: 'import' | 'css-url'
  ): { reason: UnsyncedReason; folder?: string } | null => {
    if (isRuntimeStateRel(rel)) return { reason: 'runtime-state' };
    if (rel === 'config.json') return { reason: 'config' };
    if (ignore.length > 0 && isIgnoredRel(rel, ignore)) return { reason: 'ignored-folder' };
    if (probe(rel) === 'link') return { reason: 'symlink' };
    const cls = classifyProjectFile(rel, classOpts);
    if (cls === 'never') {
      const folder = rel
        .split('/')
        .slice(0, -1)
        .find((p) => p.startsWith('_') || p.startsWith('.'));
      if (folder) return { reason: 'underscore-folder', folder };
      return { reason: isProjectFileShape(rel) ? 'extension' : 'path-shape' };
    }
    if (cls !== 'canvas-owned' && isFilePlaneClass(cls)) {
      const underAssets = rel.split('/').slice(0, -1).includes('assets');
      if (!input.syncFiles && !(cls === 'inert-media' && underAssets))
        return { reason: 'sync-files-off' };
    }
    if (via === 'import' && !IMPORTABLE_EXT_RE.test(rel)) return { reason: 'import-extension' };
    return null;
  };

  const canvases = input.canvasCandidates.filter(
    (c) =>
      probe(c) === 'file' &&
      classifyProjectFile(c, classOpts) === 'canvas-owned' &&
      isCanvasSource(input.text(c))
  );
  const refs: UnsyncedRef[] = [];
  const reported = new Set<string>();

  const report = (
    canvas: string,
    file: string,
    ref: string,
    via: 'import' | 'css-url',
    reason: UnsyncedReason,
    folder?: string
  ) => {
    const key = `${canvas}\0${file}\0${reason}`;
    if (reported.has(key)) return;
    reported.add(key);
    const w = WORDS[reason];
    refs.push({ canvas, file, ref, via, reason, detail: `${w.why(folder)}.`, fix: w.fix });
  };

  for (const canvas of canvases) {
    const seen = new Set<string>([canvas]);
    const queue: string[] = [canvas];
    const sibling = canvas.replace(/\.tsx$/i, '.css');
    if (probe(sibling) === 'file') {
      seen.add(sibling);
      queue.push(sibling);
    }
    while (queue.length > 0) {
      const from = queue.shift() as string;
      const body = input.text(from);
      if (body === null) continue;
      const css = CSS_RE.test(from);
      const reach = (file: string, ref: string, via: 'import' | 'css-url') => {
        const verdict = judge(file, via);
        if (verdict) return report(canvas, file, ref, via, verdict.reason, verdict.folder);
        if (!seen.has(file) && (MODULE_RE.test(file) || CSS_RE.test(file))) {
          seen.add(file);
          queue.push(file);
        }
      };
      for (const spec of relativeImportSpecs(body, css)) {
        const group = specCandidates(spec, abs(from), designRoot);
        if (group.length === 0) {
          report(
            canvas,
            posix.normalize(posix.join(posix.dirname(from), spec)),
            spec,
            'import',
            'outside-root'
          );
          continue;
        }
        const rels = group.map(relOf);
        const hit = rels.find((r) => probe(r) !== null);
        if (hit === undefined) report(canvas, rels[0] as string, spec, 'import', 'missing');
        else reach(hit, spec, 'import');
      }
      if (css) {
        for (const raw of cssUrlRefs(body)) {
          const joined = posix.normalize(posix.join(posix.dirname(from), decode(raw)));
          if (joined.startsWith('../') || joined === '..') {
            report(canvas, joined, raw, 'css-url', 'outside-root');
            continue;
          }
          if (probe(joined) === null) report(canvas, joined, raw, 'css-url', 'missing');
          else reach(joined, raw, 'css-url');
        }
      }
    }
  }
  refs.sort((a, b) =>
    a.canvas === b.canvas ? a.file.localeCompare(b.file) : a.canvas.localeCompare(b.canvas)
  );
  return { canvases: canvases.length, refs };
}

// ---------------------------------------------------------------------------------------- the disk

function readConfig(designRoot: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The canvas-group folders as the file plane reads them (`['system', 'ui']` when none declared). */
function groupPaths(groups: readonly { path?: string }[] | undefined): string[] {
  const out: string[] = [];
  for (const g of groups ?? []) {
    const p =
      typeof g?.path === 'string' ? g.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
    if (p && !p.split('/').some((s) => !s || s === '.' || s === '..') && !out.includes(p))
      out.push(p);
  }
  return out.length > 0 ? out : ['system', 'ui'];
}

/** The `.tsx` files in the canvas groups; `_`-prefixed and dot folders are never canvases. */
function walkCandidates(designRoot: string, groups: readonly string[]): string[] {
  const found: string[] = [];
  let dirs = 0;
  const walk = (rel: string) => {
    if (++dirs > MAX_WALK_DIRS) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(designRoot, ...rel.split('/')), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('_') || e.name === 'node_modules') continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() && /\.tsx$/i.test(e.name)) found.push(child);
    }
  };
  for (const g of groups) walk(g);
  return found;
}

/** Walk a project's design root. `env` is the process environment (the `MAUDE_SYNC_FILES` default). */
export function unsyncedRefsOnDisk(
  designRoot: string,
  env: Record<string, string | undefined> = process.env
): UnsyncedReport {
  const cfg = readConfig(designRoot);
  const hub = cfg?.linkedHub as Record<string, unknown> | undefined;
  if (!hub || typeof hub.url !== 'string' || !hub.url) {
    return { linked: false, syncFiles: true, canvases: 0, refs: [] };
  }
  // Mirrors `sync/index.ts` `fileSyncEnabled` / `asset-push.ts` `readProjectConfig`: on unless the
  // project opts out (or the machine does, and the project did not opt in).
  const syncFiles =
    hub.syncFiles !== false && (env.MAUDE_SYNC_FILES !== '0' || hub.syncFiles === true);
  const canvasGroups = Array.isArray(cfg?.canvasGroups)
    ? (cfg?.canvasGroups as { path?: string }[])
    : undefined;
  const probe = (rel: string): Probe => {
    try {
      const st = lstatSync(join(designRoot, ...rel.split('/')));
      return st.isSymbolicLink() ? 'link' : st.isFile() ? 'file' : null;
    } catch {
      return null;
    }
  };
  const text = (rel: string): string | null => {
    try {
      const p = join(designRoot, ...rel.split('/'));
      if (lstatSync(p).size > MAX_TEXT_BYTES) return null;
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };
  const walked = unsyncedRefs({
    probe,
    text,
    canvasCandidates: walkCandidates(designRoot, groupPaths(canvasGroups)),
    canvasGroups,
    syncFiles,
    ignoreFolders: normalizeIgnoreFolders(hub.ignoreFolders),
    designRoot: resolve(designRoot),
  });
  return { linked: true, syncFiles, ...walked };
}

// ----------------------------------------------------------------------------------------- the words

const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The report as terminal lines: a head that counts, then one line per file — canvas · file · why and
 * the way out. Empty for an unlinked project or a clean one (nothing to say is nothing printed).
 */
export function unsyncedLines(report: UnsyncedReport, limit = 12): string[] {
  if (!report.linked || report.refs.length === 0) return [];
  const files = new Set(report.refs.map((r) => r.file));
  const canvases = new Set(report.refs.map((r) => r.canvas));
  const head = `${noun(files.size, 'file', 'files')} used by ${noun(canvases.size, 'canvas', 'canvases')} won't reach the people you share with.`;
  const lines = report.refs
    .slice(0, limit)
    .map((r) => `${r.canvas} · ${r.file} · ${r.detail} ${r.fix}`);
  if (report.refs.length > limit) lines.push(`…and ${report.refs.length - limit} more.`);
  return [head, ...lines];
}
