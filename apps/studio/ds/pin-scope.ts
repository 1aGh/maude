// S10.4 (V2-1.6 §5.8 "Element pins") — scope one design-system revision's CSS to the elements that
// carry `data-ds-rev="<v>"`, so an instance Updated (or placed) later keeps a look the rest of the canvas
// does not have. Pure: CSS text in, CSS text out; no DOM, no imports (the canvas shell mirrors this file
// in `_shell.html` between `ds-pins:begin` / `ds-pins:end`, and test/ds-element-pin.test.ts holds the two
// equal on a corpus — the shell template imports nothing).
//
// The rewrite walks the sheet's rules at the text level (comments, strings, parens and nested blocks are
// respected) and touches only SELECTORS; declaration bodies stay byte for byte. A CSSStyleSheet round trip
// would re-serialise them and drop what this browser does not know yet.
//
// Two kinds of rule:
//   TOKEN rules — one compound made only of `:root`, `html`, `.ds`, `.<rootClass>`, `*` and an optional
//   `[data-theme=t]`. They are declared ON the scope element:
//     themed:   :where([data-theme="t"]) [data-ds-rev="v"], [data-theme="t"][data-ds-rev="v"]
//     unthemed: [data-ds-rev="v"]
//   CLASS rules — everything else. `:is([data-ds-rev="v"], [data-ds-rev="v"] *)` is appended to the LAST
//   compound, before any pseudo-element. That adds exactly one attribute of specificity, so the pinned
//   rule beats its unpinned twin (`.btn.btn--primary:hover` stays below its pinned copy).
//
// Dropped (they are global, not scoped, and the canvas already has them): @import, @charset,
// @namespace, @font-face, @keyframes, @property, @page, @counter-style, bare `@layer a, b;`.
// Grouping rules (@media, @supports, @container, @layer { }, @scope) are walked into.

/** The CSS a pin may carry: ≤ the revision size cap (V2-1.6 §5.6). */
export const PIN_CSS_MAX = 2 * 1024 * 1024;
const PIN_ID = /^[0-9a-f]{64}$/;
const ROOT_CLASS = /^[A-Za-z_][\w-]{0,63}$/;

export interface PinScopeOptions {
  /** The system's `rootClass` (the class its theme rules hang on), when it has one. */
  rootClass?: string | null;
}

/** `head` (follows the head) or a revision id. Anything else is not a pin value. */
export function isPinValue(v: unknown): v is string {
  return v === 'head' || (typeof v === 'string' && PIN_ID.test(v));
}

/** Split `s` at top-level `sep` characters (not inside (), [], strings or comments). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 1;
    } else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function stripComments(s: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
    } else out += c;
  }
  return out;
}

interface Node {
  prelude: string;
  /** null = a statement (`@import …;`) */
  body: string | null;
}

/** The top-level rules of a sheet: `prelude { body }` and `prelude ;`. */
function topLevel(css: string): Node[] {
  const text = stripComments(css);
  const out: Node[] = [];
  let i = 0;
  while (i < text.length) {
    let depth = 0;
    let quote = '';
    let j = i;
    let hit = '';
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (c === '{' || c === ';' || c === '}')) {
        hit = c;
        break;
      }
    }
    const prelude = text.slice(i, j).trim();
    if (hit === ';') {
      if (prelude) out.push({ prelude, body: null });
      i = j + 1;
    } else if (hit === '{') {
      let d = 1;
      let q = '';
      let k = j + 1;
      for (; k < text.length && d > 0; k++) {
        const c = text[k];
        if (q) {
          if (c === '\\') k++;
          else if (c === q) q = '';
        } else if (c === '"' || c === "'") q = c;
        else if (c === '{') d++;
        else if (c === '}') d--;
      }
      out.push({ prelude, body: text.slice(j + 1, d === 0 ? k - 1 : k) });
      i = k;
    } else {
      // a stray `}` or the end of the text
      i = hit === '}' ? j + 1 : text.length;
    }
  }
  return out;
}

const GROUPING = new Set(['media', 'supports', 'container', 'layer', 'scope', 'document']);

/** Is `compound` a TOKEN scope (see the file header)? Returns the theme it names ('' = none), or null. */
function tokenTheme(compound: string, rootClass: string | null): string | null {
  let theme = '';
  const rest = compound.replace(
    /\[\s*data-theme\s*(?:[~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]"']+))\s*\]/g,
    (_m, a, b, c) => {
      theme = a ?? b ?? c ?? '';
      return '';
    }
  );
  if (rest.includes('[')) return null;
  const parts = rest.match(/:root|html|\*|\.[A-Za-z_][\w-]*/g) ?? [];
  if (parts.join('') !== rest) return null;
  let rooted = false;
  for (const part of parts) {
    if (part === '*') continue;
    if (
      part === ':root' ||
      part === 'html' ||
      part === '.ds' ||
      (rootClass && part === `.${rootClass}`)
    )
      rooted = true;
    else return null;
  }
  // `*` alone is a reset (a class rule); `[data-theme=t]` alone names a theme root.
  return rooted || theme ? theme : null;
}

/** Index in `sel` where the last compound starts (after the last top-level combinator). */
function lastCompoundStart(sel: string): number {
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      (c === ' ' || c === '>' || c === '+' || c === '~' || c === '\t' || c === '\n')
    )
      start = i + 1;
  }
  return start;
}

/** Index where a pseudo-element begins in the last compound (`::x`, or legacy `:before`…), else the end. */
function pseudoElementAt(sel: string, from: number): number {
  let depth = 0;
  let quote = '';
  for (let i = from; i < sel.length; i++) {
    const c = sel[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === ':') {
      if (sel[i + 1] === ':') return i;
      if (/^:(?:before|after|first-line|first-letter)(?![\w-])/i.test(sel.slice(i))) return i;
    }
  }
  return sel.length;
}

/**
 * One selector → its pinned form, or null when there is nothing to scope. `value` is `head` or a revision
 * id (the attribute value as written in the canvas).
 */
export function scopeSelector(
  selector: string,
  value: string,
  opts: PinScopeOptions = {}
): string[] | null {
  if (!isPinValue(value)) throw new Error('not a pin value');
  const rootClass = opts.rootClass && ROOT_CLASS.test(opts.rootClass) ? opts.rootClass : null;
  const sel = selector.trim();
  if (!sel) return null;
  const pin = `[data-ds-rev="${value}"]`;
  if (!/[\s>+~]/.test(sel.replace(/\([^)]*\)|\[[^\]]*\]/g, ''))) {
    const theme = tokenTheme(sel, rootClass);
    if (theme !== null) {
      if (!theme) return [pin];
      const t = theme.replace(/["\\]/g, '');
      return [`:where([data-theme="${t}"]) ${pin}`, `[data-theme="${t}"]${pin}`];
    }
  }
  const at = pseudoElementAt(sel, lastCompoundStart(sel));
  return [`${sel.slice(0, at)}:is(${pin}, ${pin} *)${sel.slice(at)}`];
}

function scopeRules(css: string, value: string, opts: PinScopeOptions): string {
  const out: string[] = [];
  for (const node of topLevel(css)) {
    if (node.body === null) continue;
    const prelude = node.prelude;
    if (prelude.startsWith('@')) {
      const name = /^@([A-Za-z-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
      if (!GROUPING.has(name)) continue;
      const inner = scopeRules(node.body, value, opts);
      if (inner) out.push(`${prelude} {\n${inner}\n}`);
      continue;
    }
    const selectors: string[] = [];
    for (const s of splitTop(prelude, ',')) {
      const scoped = scopeSelector(s, value, opts);
      if (scoped) for (const x of scoped) if (!selectors.includes(x)) selectors.push(x);
    }
    if (selectors.length) out.push(`${selectors.join(',\n')} {${node.body}}`);
  }
  return out.join('\n');
}

/** A revision's CSS, scoped to `[data-ds-rev="<value>"]`. Over the size cap → empty. */
export function scopeCss(css: string, value: string, opts: PinScopeOptions = {}): string {
  if (!isPinValue(value)) throw new Error('not a pin value');
  if (typeof css !== 'string' || css.length > PIN_CSS_MAX) return '';
  return scopeRules(css, value, opts);
}
