// Directories that never hold user-facing canvases. One source for the tree
// (`api.ts`), the external-canvas watcher (`canvas-list-watch.ts`) and the
// project index (`index/extract.ts`). (activity.ts still carries its own
// historical mirror.) A leaf module on purpose: the `maude design index`
// helper imports the index, and everything a helper imports is staged into the
// packaged app (apps/desktop/scripts/helper-deps.mjs) — reaching this list
// through api.ts pulled the whole studio API into the helper.
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.expo',
  'coverage',
  'dev-server',
  '_history',
]);

/** Dot-directories a canvas group may still hold canvases under. */
export const HIDDEN_OK = new Set(['.ai', '.claude', '.design']);

/** The `newComponentDir` a config that names none gets (context.ts DEFAULT_CONFIG). */
export const DEFAULT_COMPONENT_DIR = 'ui/components';

/**
 * gate-b-c4j (M1) — THE component predicate on a path alone (designRoot-relative): a `.tsx` under
 * the config's `newComponentDir`, under any directory named `components`, or under `system/**`
 * outside `preview/` and `ui_kits/` — except the design-system board `design-system.tsx`, a canvas.
 * gate-b-c4k — a LISTING rule only: the index does not list a `.tsx` at such a path unless the file
 * is a canvas by itself (a meta, or `isCanvasSource`). Access never asks it (it was per-machine —
 * `newComponentDir` lives in the unsynced config — and made a DesignCanvas file under any
 * `components/` importable, M1/M2); the closure asks the file. Pure.
 */
export function isComponentRel(rel: string, componentDir?: string | null): boolean {
  if (!/\.tsx$/i.test(rel)) return false;
  const segs = rel.split('/');
  const dirs = segs.slice(0, -1);
  if (dirs.includes('components')) return true;
  const dir = String(componentDir || DEFAULT_COMPONENT_DIR).replace(/^\.?\/+|\/+$/g, '');
  if (dir !== '' && rel.startsWith(`${dir}/`)) return true;
  return (
    segs[0] === 'system' &&
    !dirs.includes('preview') &&
    !dirs.includes('ui_kits') &&
    segs[segs.length - 1] !== 'design-system.tsx'
  );
}

/**
 * gate-b-c4g — a `.tsx` under the first canvas group (a designRoot-relative path) it falls in,
 * with no `_`-prefixed, skipped or hidden segment below that group. Whether the file exists is the
 * caller's to ask. Pure.
 *
 * gate-b-c4k — a LISTING rule only (the index, `index/extract.ts`): groups come from the per-machine
 * config, so they never decide canvas-ness for access — the closure asks the file (`isCanvasSource`
 * + meta/board, access/closure.ts).
 */
export function isInCanvasGroup(groups: readonly string[], rel: string): boolean {
  if (!rel.endsWith('.tsx')) return false;
  const base = groups
    .map((g) => g.replace(/\/+$/, ''))
    .find((g) => g !== '' && rel.startsWith(`${g}/`));
  if (base === undefined) return false;
  for (const seg of rel.slice(base.length + 1).split('/')) {
    if (seg.startsWith('.') && !HIDDEN_OK.has(seg)) return false;
    if (seg.startsWith('_') || SKIP_DIRS.has(seg)) return false;
  }
  return true;
}

/** `isInCanvasGroup` minus component paths (`isComponentRel`) — the path half of the index rule. */
export function isCanvasRelInGroups(
  groups: readonly string[],
  rel: string,
  componentDir?: string | null
): boolean {
  return isInCanvasGroup(groups, rel) && !isComponentRel(rel, componentDir);
}

/** What a module specifier string follows: `from`, `import`, `import(` (and CSS `@import`). */
const SPECIFIER_LEAD_RE = /(?:\bfrom|\bimport|\bimport\s*\()\s*$/;

/**
 * gate-b-c4e — `source` as the import scanner may read it: comments removed and every string
 * literal blanked EXCEPT a module specifier (a string right after `from`, `import` or `import(`).
 * A text scan over the raw source took `// import './b.tsx'` — or a string that merely spells an
 * import — for a real import, and the closure then opened B to A's frame. Not a parser (the hub
 * imports this under Node's strip-only TypeScript; there is none to share): a string never spans
 * a line, so a misread regex literal costs at most the rest of its line — an import missed there
 * fails CLOSED (the serve path refuses a module whose inputs the closure lacks). CSS: only
 * `/* … *\/` comments (`//` is a URL there).
 */
export function importScanText(source: string, css = false): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (!css && c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '"' || c === "'" || (!css && c === '`')) {
      let j = i + 1;
      while (j < n) {
        const d = source[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === c) break;
        if (d === '\n' && c !== '`') break; // an unterminated string ends with its line
        j++;
      }
      const body = source.slice(i + 1, Math.min(j, n));
      const keep = c !== '`' && SPECIFIER_LEAD_RE.test(out.slice(-32));
      out += c + (keep ? body : body.replace(/[^\n]/g, ' ')) + (source[j] === c ? c : '');
      i = source[j] === c ? j + 1 : j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The canvas root component and the module that exports it (canvas-lib.tsx, DDR-025). */
const CANVAS_LIB_SPEC = '@maude/canvas-lib';
const CANVAS_ROOT = 'DesignCanvas';
/** A static import declaration's clause, never crossing into another statement's `from`/`import`. */
const STATIC_IMPORT_RE =
  /\bimport\s+((?:(?!\bfrom\b|\bimport\b|;)[\s\S])*?)\s*\bfrom\s*["']([^"']+)["']/g;
const DYNAMIC_LIB_RE = /\bimport\(\s*["']@maude\/canvas-lib["']\s*\)/;
const DESIGN_CANVAS_WORD_RE = /\bDesignCanvas\b/;

/**
 * gate-b-c4k — THE canvas marker on a file's own text, the same answer on every machine and the
 * hub (no config, no path): the source imports the `DesignCanvas` value from `@maude/canvas-lib`
 * — a named import (aliased or not, not `type`), a namespace import used as `NS.DesignCanvas`, or a
 * dynamic `import('@maude/canvas-lib')` in a file naming `DesignCanvas`. Comments and plain strings
 * never count (`importScanText`). Every canvas template, `/design:new` envelope and video comp
 * renders `<DesignCanvas>`; a component never does — a helper that wraps DesignCanvas counts as a
 * canvas, which only refuses an import (fail closed). Pure; the hub loads it under Node.
 */
export function isCanvasSource(source: string | null): boolean {
  if (!source?.includes(CANVAS_ROOT)) return false;
  const text = importScanText(source);
  STATIC_IMPORT_RE.lastIndex = 0;
  for (let m = STATIC_IMPORT_RE.exec(text); m !== null; m = STATIC_IMPORT_RE.exec(text)) {
    if (m[2] !== CANVAS_LIB_SPEC) continue;
    const clause = (m[1] as string).trim();
    if (/^type\b/.test(clause)) continue;
    const named = /\{([^}]*)\}/.exec(clause);
    for (const item of named ? (named[1] as string).split(',') : []) {
      if (item.trim().split(/\s+/)[0] === CANVAS_ROOT) return true;
    }
    const ns = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (ns) {
      const nsRe = new RegExp(
        `(?:^|[^\\w$.])${ns.replace(/\$/g, '\\$')}\\s*\\.\\s*DesignCanvas\\b`
      );
      if (nsRe.test(text)) return true;
    }
  }
  return DYNAMIC_LIB_RE.test(text) && DESIGN_CANVAS_WORD_RE.test(text);
}
