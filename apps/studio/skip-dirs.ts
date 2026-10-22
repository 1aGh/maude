// Directories that never hold user-facing canvases. One source for the tree
// (`api.ts`), the external-canvas watcher (`canvas-list-watch.ts`) and the
// project index (`index/extract.ts`); activity.ts re-exports `isCanvasFile` from here.
// A leaf module on purpose: the `maude design index`
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

const isWs = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);
const isIdent = (ch: string | undefined): boolean => ch !== undefined && /[\w$]/.test(ch);

/** `s[..k)` ends in the whole word `w`. */
function wordEndsAt(s: string, k: number, w: string): boolean {
  if (k < w.length || s.slice(k - w.length, k) !== w) return false;
  return !isIdent(s[k - w.length - 1]);
}

/**
 * gate-b-c4l — does the text written so far end in a module-specifier lead: `from`, `import`,
 * `import(` or `require(`, with ANY whitespace between (a comment is already blanked to spaces
 * there, whatever its length)? c4e looked back a fixed 32 characters, and a longer comment between
 * `from` and the string hid the import.
 */
function endsInSpecifierLead(out: string): boolean {
  let k = out.length;
  while (k > 0 && isWs(out[k - 1])) k--;
  if (out[k - 1] === '(') {
    k--;
    while (k > 0 && isWs(out[k - 1])) k--;
    return wordEndsAt(out, k, 'import') || wordEndsAt(out, k, 'require');
  }
  return wordEndsAt(out, k, 'from') || wordEndsAt(out, k, 'import');
}

/** Does `out` end in `import(` / `require(` (whitespace allowed)? */
function endsInCallLead(out: string): boolean {
  let k = out.length;
  while (k > 0 && isWs(out[k - 1])) k--;
  if (out[k - 1] !== '(') return false;
  k--;
  while (k > 0 && isWs(out[k - 1])) k--;
  return wordEndsAt(out, k, 'import') || wordEndsAt(out, k, 'require');
}

/** CSS: the text right before the string of `@import url("./x.css")`. */
const CSS_IMPORT_URL_LEAD_RE = /@import\s+url\(\s*$/i;

/**
 * gate-b-c4e — `source` as the import scanner may read it: comments blanked and every string
 * literal blanked EXCEPT a module specifier (a string right after `from`, `import`, `import(` or
 * `require(`). A text scan over the raw source took `// import './b.tsx'` — or a string that merely
 * spells an import — for a real import, and the closure then opened B to A's frame. Not a parser
 * (the hub imports this under Node's strip-only TypeScript; there is none to share): a string never
 * spans a line, so a misread regex literal costs at most the rest of its line — an import missed
 * there fails CLOSED (the serve path refuses a module whose inputs the closure lacks). CSS: only
 * `/* … *\/` comments (`//` is a URL there). gate-b-c4l — length-preserving (a comment becomes
 * spaces, newlines kept), so an offset in the result is an offset in `source`.
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
      const stop = end === -1 ? n : end;
      out += ' '.repeat(stop - i);
      i = stop;
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
      const stop = Math.min(j, n);
      const body = source.slice(i + 1, stop);
      // gate-b-c4m (defender L-B) — a template with no substitution after `import(` / `require(`
      // is a module specifier Bun resolves at build time; in CSS, the string of `@import url("…")`.
      const keep =
        c === '`'
          ? !body.includes('${') && endsInCallLead(out)
          : endsInSpecifierLead(out) || (css && CSS_IMPORT_URL_LEAD_RE.test(out));
      out += c + (keep ? body : body.replace(/[^\n]/g, ' ')) + (source[j] === c ? c : '');
      i = source[j] === c ? j + 1 : stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * gate-b-c4l — a string literal's body as the bundler reads it (`-`, `\u{2d}`, `\x2d`, `\-`):
 * an escaped specifier names the same module, so `'@maude/canvas-lib'` is the lib.
 */
export function decodeJsString(body: string): string {
  if (!body.includes('\\')) return body;
  return body.replace(
    /\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
    (_m, _all, cp, u4, x2, ch: string | undefined) => {
      const hex = cp ?? u4 ?? x2;
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
      if (ch === 'n') return '\n';
      if (ch === 't') return '\t';
      if (ch === '\n') return '';
      return ch ?? '';
    }
  );
}

/** The canvas root component and the module that exports it (canvas-lib.tsx, DDR-025). */
export const CANVAS_LIB_SPEC = '@maude/canvas-lib';
const CANVAS_ROOT = 'DesignCanvas';
/** The raw word, anywhere — a comment or a string included (gate-b-c4l: err to "canvas"). */
const DESIGN_CANVAS_WORD_RE = /(?<![\w$\\])DesignCanvas(?![\w$])/;
/** A static import declaration's clause, never crossing into another statement's `from`/`import`. */
const STATIC_IMPORT_RE =
  /\bimport(?![\w$.(])(?!\s*\()\s*((?:(?!\bfrom\b|\bimport\b|;)[\s\S])*?)\s*\bfrom\s*["']([^"'\n]*)["']/g;
/** A re-export (`export … from '…'`), never crossing into another statement. */
const EXPORT_FROM_RE =
  /\bexport(?![\w$.])\s*((?:(?!\bfrom\b|\bimport\b|\bexport\b|;)[\s\S])*?)\s*\bfrom\s*["']([^"'\n]*)["']/g;
/** A literal dynamic import or a require. */
const DYNAMIC_LITERAL_RE = /\b(?:import|require)\s*\(\s*["']([^"'\n]*)["']\s*[,)]/g;
/** Any dynamic import / require — a literal one is subtracted by the caller. */
const DYNAMIC_ANY_RE = /\b(?:import|require)\s*\(/g;

/** An imported or exported name the scanner cannot read (a string name, an escaped identifier). */
export const ODD_NAME = '\u0000';

const nameOf = (tok: string): string => (tok === '' || /^["'\\]|\\/.test(tok) ? ODD_NAME : tok);

/** `{ a, b as c, type d }` items as [imported, local] pairs (type-only items dropped). */
function braceItems(inner: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const raw of inner.split(',')) {
    const item = raw.trim();
    if (item === '') continue;
    const parts = item.split(/\s+/);
    if (parts[0] === 'type' && parts.length > 1 && parts[1] !== 'as') continue;
    const from = nameOf(parts[0] as string);
    const asAt = parts.indexOf('as', 1);
    const to = asAt > 0 ? nameOf(parts[asAt + 1] ?? '') : from;
    out.push([from, to]);
  }
  return out;
}

export interface ModuleImport {
  /** The specifier, escapes decoded. */
  spec: string;
  /** Imported names (`default` for a default binding). */
  names: string[];
  /** A namespace import (`* as NS`), a dynamic import or a require: every name. */
  all: boolean;
  /** A name the scanner cannot read, or a binding called DesignCanvas. */
  odd: boolean;
  /** A namespace binding used other than as `NS.<name>` (a computed or bare use). */
  nsLoose: boolean;
  /** A namespace binding used as `NS.DesignCanvas`. */
  nsRoot: boolean;
}

export interface ModuleReexport {
  spec: string;
  /** `export * from` */
  star: boolean;
  /** `export * as N from` — the name (ODD_NAME when unreadable), else null. */
  nsName: string | null;
  /** `export { a as b } from` — [imported, exported]. */
  items: Array<[string, string]>;
}

export interface ModuleLinks {
  imports: ModuleImport[];
  reexports: ModuleReexport[];
  /** The text outside re-export statements names DesignCanvas (a local use or a local export). */
  namesRoot: boolean;
  /** A dynamic import / require whose argument is not one literal (G3 — no knowing what it loads). */
  computedImport: boolean;
}

/**
 * gate-b-c4l — what a module imports and re-exports, read from its text (`importScanText`): the
 * input of the canvas marker (`isCanvasSource`) and of the closure's lib-proxy rule (access/closure.ts
 * `walkEnv`). Not a parser — every reading it cannot make errs to "carries DesignCanvas". Pure.
 */
export function moduleLinks(source: string): ModuleLinks {
  const text = importScanText(source);
  const imports: ModuleImport[] = [];
  const reexports: ModuleReexport[] = [];
  STATIC_IMPORT_RE.lastIndex = 0;
  for (let m = STATIC_IMPORT_RE.exec(text); m !== null; m = STATIC_IMPORT_RE.exec(text)) {
    const clause = (m[1] as string).trim();
    if (/^type\s+[{*A-Za-z_$\\]/.test(clause)) continue;
    const imp: ModuleImport = {
      spec: decodeJsString(m[2] as string),
      names: [],
      all: false,
      odd: false,
      nsLoose: false,
      nsRoot: false,
    };
    const def = /^([^\s,{*]+)\s*(?:,|$)/.exec(clause)?.[1];
    if (def !== undefined) {
      imp.names.push('default');
      if (nameOf(def) === ODD_NAME || def === CANVAS_ROOT) imp.odd = true;
    }
    const brace = /\{([^}]*)\}/.exec(clause);
    for (const [from, to] of brace ? braceItems(brace[1] as string) : []) {
      imp.names.push(from);
      if (from === ODD_NAME || to === ODD_NAME || from === CANVAS_ROOT || to === CANVAS_ROOT)
        imp.odd = true;
    }
    const ns = /\*\s*as\s+([^\s,{}]+)/.exec(clause)?.[1];
    if (ns !== undefined) {
      imp.all = true;
      // gate-b-c4m (defender L-A) — a name that is no plain identifier (`* as X(`) is unreadable:
      // it errs to "canvas" and never reaches `new RegExp` (it threw for every closure reaching it).
      if (nameOf(ns) === ODD_NAME || !/^[A-Za-z_$][\w$]*$/.test(ns)) imp.odd = true;
      else {
        const esc = ns.replace(/\$/g, '\\$');
        const useRe = new RegExp(`(?<![\\w$.\\\\])${esc}(?![\\w$\\\\])`, 'g');
        for (let u = useRe.exec(text); u !== null; u = useRe.exec(text)) {
          if (u.index >= m.index && u.index < m.index + m[0].length) continue; // the declaration
          const member = /^\s*\??\.\s*([\w$\\]+)/.exec(text.slice(u.index + ns.length));
          if (!member) imp.nsLoose = true;
          else if (member[1] === CANVAS_ROOT || (member[1] as string).includes('\\'))
            imp.nsRoot = true;
        }
      }
    }
    imports.push(imp);
  }
  DYNAMIC_LITERAL_RE.lastIndex = 0;
  let literalDynamics = 0;
  for (let m = DYNAMIC_LITERAL_RE.exec(text); m !== null; m = DYNAMIC_LITERAL_RE.exec(text)) {
    literalDynamics++;
    imports.push({
      spec: decodeJsString(m[1] as string),
      names: [],
      all: true,
      odd: false,
      nsLoose: true,
      nsRoot: false,
    });
  }
  const anyDynamics = text.match(DYNAMIC_ANY_RE)?.length ?? 0;
  // Re-exports — and the text without them, for `namesRoot`.
  let rest = text;
  EXPORT_FROM_RE.lastIndex = 0;
  for (let m = EXPORT_FROM_RE.exec(text); m !== null; m = EXPORT_FROM_RE.exec(text)) {
    const clause = (m[1] as string).trim();
    rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
    if (/^type\s*[{*]/.test(clause)) continue;
    const re: ModuleReexport = {
      spec: decodeJsString(m[2] as string),
      star: false,
      nsName: null,
      items: [],
    };
    const ns = /^\*\s*as\s+(\S+)$/.exec(clause)?.[1];
    if (ns !== undefined) re.nsName = nameOf(ns);
    else if (/^\*$/.test(clause)) re.star = true;
    else {
      const brace = /\{([^}]*)\}/.exec(clause);
      re.items = brace ? braceItems(brace[1] as string) : [[ODD_NAME, ODD_NAME]];
    }
    reexports.push(re);
  }
  return {
    imports,
    reexports,
    namesRoot: DESIGN_CANVAS_WORD_RE.test(rest),
    computedImport: anyDynamics > literalDynamics,
  };
}

/** In a carried-name set: every export of the module may be DesignCanvas. */
export const CARRIES_ALL = '*';
/** What `@maude/canvas-lib` exports that renders a canvas. */
export const LIB_CARRIED: ReadonlySet<string> = new Set([CANVAS_ROOT]);

/** Does an import of `imp` reach a name in `carried` (a module's DesignCanvas-carrying exports)? */
export function importReaches(imp: ModuleImport, carried: ReadonlySet<string>): boolean {
  if (carried.size === 0) return false;
  if (imp.all || imp.odd || carried.has(CARRIES_ALL)) return true;
  return imp.names.some((n) => carried.has(n));
}

/**
 * gate-b-c4k — THE canvas marker on a file's own text, the same answer on every machine and the
 * hub (no config, no path). gate-b-c4l — it errs to "canvas" (a false positive only refuses an
 * import): the raw word `DesignCanvas` anywhere (a comment and a string included); an import of
 * the lib the scanner cannot read by name — a namespace binding used other than as `NS.<name>`,
 * a dynamic import or require, an escaped or string name; or a computed import (G3). The
 * lib-proxy half (an import from a module that carries DesignCanvas) needs the other files:
 * access/closure.ts `walkEnv`. Pure; the hub loads it under Node.
 */
export function isCanvasSource(source: string | null): boolean {
  if (typeof source !== 'string' || source === '') return false;
  if (DESIGN_CANVAS_WORD_RE.test(source)) return true;
  const links = moduleLinks(source);
  if (links.computedImport) return true;
  return links.imports.some(
    (i) =>
      i.spec === CANVAS_LIB_SPEC &&
      (i.odd || i.nsLoose || i.nsRoot || i.names.includes(CANVAS_ROOT))
  );
}

/**
 * gate-b-c4l (defender M1) — a design system's specimens and UI kits are canvases by PATH, config
 * free: every `.tsx` / `.html` under `system/<ds>/preview/` or `system/<ds>/ui_kits/` with no `_`-prefixed
 * segment below `system/<ds>/` (`preview/_ds.tsx`, `preview/_kit.tsx` stay modules). The index
 * lists and grants them; a specimen has no DesignCanvas and no meta, so only this keeps one out of
 * another canvas's frame. Pure.
 */
export function isDsSurfaceRel(rel: string): boolean {
  // gate-b-c4m — `.html` specimens too (the inspiration template ships `preview/*.html`).
  if (!/\.(tsx|html)$/i.test(rel)) return false;
  const segs = rel.split('/');
  if (segs.length < 4 || segs[0] !== 'system') return false;
  if (segs[2] !== 'preview' && segs[2] !== 'ui_kits') return false;
  return segs.slice(2).every((s) => !s.startsWith('_'));
}

/**
 * An openable canvas file by PATH: a `.tsx` or `.html`, no `_`-prefixed or SKIP_DIRS segment, not a
 * DS preview specimen (`system/<ds>/preview/**`). THE index-side shape predicate — activity.ts
 * re-exports it (the AI-activity overlay), and (gate-b-c4m) the access closure asks it for `.html`
 * canvases, which carry no DesignCanvas marker. The closure errs further to "canvas" on DS
 * surfaces (`isDsSurfaceRel`) itself. Pure — accepts back-slash or forward-slash input.
 */
export function isCanvasFile(rel: string): boolean {
  if (typeof rel !== 'string') return false;
  const p = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p) return false;
  const segs = p.split('/');
  const base = segs[segs.length - 1] ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : '';
  if (ext !== '.tsx' && ext !== '.html') return false;
  for (const s of segs) {
    if (SKIP_DIRS.has(s)) return false;
    if (s.startsWith('_')) return false;
  }
  if (/(^|\/)system\/[^/]+\/preview\//.test(p)) return false;
  return true;
}
