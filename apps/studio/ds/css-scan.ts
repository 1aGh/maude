// Comment- and string-aware CSS structure scanner, shared by `_import-tokens.mjs` (DDR-172
// Decisions 1 + 7) and the design-system checker (V2-1.13 §5.1). No regex over the whole
// (possibly adversarial) text: one linear walk that understands comments, strings and braces.
//
// Moved out of `bin/_import-tokens.mjs` for V2-2.15. One behaviour fix rides along: the
// selector prelude now also restarts after a `;`, so a nested rule's `selector` no longer
// begins with the previous declaration, and a top-level rule after `@import …;` is no longer
// mistaken for an at-rule.

export interface CssRule {
  /** the prelude text exactly as written (selector list, or `@media …`) */
  selector: string;
  /** offset of the first prelude character (after the previous `;`, `{` or `}`) */
  preludeStart: number;
  /** offset just after `{` */
  bodyStart: number;
  /** offset of the matching `}` */
  bodyEnd: number;
  /** true when this rule is, or sits inside, any at-rule */
  nestedInAtRule: boolean;
  /** index (into the returned array) of the enclosing rule, or -1 at top level */
  parent: number;
  /** the at-rule keyword when this rule IS an at-rule (`media`, `layer`, `supports`, …) */
  atRule: string | null;
  /** at-rule keywords of every enclosing at-rule, outermost first */
  atRuleChain: string[];
}

export interface CssCustomPropertyDecl {
  name: string;
  rawValue: string;
  declStart: number;
  declEnd: number;
  valueStart: number;
  valueEnd: number;
}

export interface CssDecl {
  /** property name as written (`color`, `--x-foo`, `paddingTop` never appears in CSS) */
  prop: string;
  rawValue: string;
  declStart: number;
  valueStart: number;
  valueEnd: number;
}

function skipComment(text: string, i: number): number {
  const end = text.indexOf('*/', i + 2);
  return end === -1 ? text.length : end + 2;
}

function skipString(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\') {
      j += 2;
      continue;
    }
    if (text[j] === quote) return j + 1;
    j += 1;
  }
  return j;
}

/**
 * Every `{…}` block in `text`, in OPEN order (a parent precedes its children). Unbalanced
 * input never throws: an unclosed block is dropped, a stray `}` is ignored.
 */
export function scanCssRules(text: string): CssRule[] {
  const rules: (CssRule | null)[] = [];
  const stack: number[] = [];
  const n = text.length;
  let i = 0;
  let preludeStart = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      i = skipComment(text, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === '{') {
      const selector = text.slice(preludeStart, i);
      const parent = stack.length ? stack[stack.length - 1] : -1;
      const parentRule = parent >= 0 ? rules[parent] : null;
      const m = /^(?:\s|\/\*[\s\S]*?\*\/)*@([A-Za-z-]+)/.exec(selector);
      const atRule = m ? m[1].toLowerCase() : null;
      const chain = parentRule
        ? parentRule.atRule
          ? [...parentRule.atRuleChain, parentRule.atRule]
          : parentRule.atRuleChain
        : [];
      rules.push({
        selector,
        preludeStart,
        bodyStart: i + 1,
        bodyEnd: -1,
        nestedInAtRule: Boolean(atRule) || Boolean(parentRule?.nestedInAtRule),
        parent,
        atRule,
        atRuleChain: chain,
      });
      stack.push(rules.length - 1);
      i += 1;
      preludeStart = i;
      continue;
    }
    if (ch === '}') {
      const top = stack.pop();
      if (top !== undefined) (rules[top] as CssRule).bodyEnd = i;
      i += 1;
      preludeStart = i;
      continue;
    }
    if (ch === ';') {
      i += 1;
      preludeStart = i;
      continue;
    }
    i += 1;
  }
  // Drop unclosed blocks; remap parents.
  const keep = new Map<number, number>();
  const out: CssRule[] = [];
  rules.forEach((r, idx) => {
    if (r && r.bodyEnd >= 0) {
      keep.set(idx, out.length);
      out.push(r);
    }
  });
  for (const r of out) r.parent = r.parent >= 0 ? (keep.get(r.parent) ?? -1) : -1;
  return out;
}

/**
 * `--name: value;` declarations of a rule body, comment- and string-aware. `offset` shifts
 * the positions into the original text. Nested blocks are NOT excluded — use
 * `ownCustomProperties` for one rule's own declarations.
 */
export function extractDeclarations(bodyText: string, offset = 0): CssCustomPropertyDecl[] {
  return extractAllDeclarations(bodyText, offset)
    .filter((d) => d.prop.startsWith('--'))
    .map((d) => ({
      name: d.prop,
      rawValue: d.rawValue,
      declStart: d.declStart,
      declEnd: d.declEnd,
      valueStart: d.valueStart,
      valueEnd: d.valueEnd,
    }));
}

/** Every `prop: value;` declaration (the last one may omit its `;`). */
export function extractAllDeclarations(
  bodyText: string,
  offset = 0
): (CssDecl & { declEnd: number })[] {
  const out: (CssDecl & { declEnd: number })[] = [];
  const n = bodyText.length;
  let i = 0;
  let declStart = 0;
  const flush = (end: number, terminatorLen: number) => {
    const decl = bodyText.slice(declStart, end);
    // Leading whitespace / comments (a trailing comment of the previous declaration, a section
    // header) are tolerated before the property name.
    const m = /^(?:\s|\/\*[\s\S]*?\*\/)*(--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)\s*:/.exec(decl);
    if (m) {
      const afterColon = decl.slice(m[0].length);
      const leadingWs = afterColon.length - afterColon.trimStart().length;
      const trailingWs = afterColon.length - afterColon.trimEnd().length;
      out.push({
        prop: m[1],
        rawValue: afterColon.trim(),
        declStart: offset + declStart,
        declEnd: offset + end + terminatorLen,
        valueStart: offset + declStart + m[0].length + leadingWs,
        valueEnd: offset + declStart + decl.length - trailingWs,
      });
    }
  };
  while (i < n) {
    const ch = bodyText[i];
    if (ch === '/' && bodyText[i + 1] === '*') {
      i = skipComment(bodyText, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(bodyText, i);
      continue;
    }
    if (ch === ';') {
      flush(i, 1);
      declStart = i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  if (bodyText.slice(declStart).trim()) flush(n, 0);
  return out;
}

/** `text` with every child block of `rules[index]` blanked to spaces (offsets preserved). */
function ownBody(text: string, rules: CssRule[], index: number): string {
  const r = rules[index];
  const chars = text.slice(r.bodyStart, r.bodyEnd).split('');
  for (const c of rules) {
    if (c.parent !== index) continue;
    for (let k = c.preludeStart; k <= c.bodyEnd; k++) {
      const at = k - r.bodyStart;
      if (at >= 0 && at < chars.length && chars[at] !== '\n') chars[at] = ' ';
    }
  }
  return chars.join('');
}

/** One rule's own custom-property declarations (child blocks excluded). */
export function ownCustomProperties(
  text: string,
  rules: CssRule[],
  index: number
): CssCustomPropertyDecl[] {
  return extractDeclarations(ownBody(text, rules, index), rules[index].bodyStart);
}

/** One rule's own declarations of any property (child blocks excluded). */
export function ownDeclarations(text: string, rules: CssRule[], index: number): CssDecl[] {
  return extractAllDeclarations(ownBody(text, rules, index), rules[index].bodyStart);
}

/** Split a selector list at top-level commas (respects `()`, `[]` and strings). */
export function splitSelectorList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const s = selector.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) out.push(last);
  return out.filter(Boolean);
}

/** Split a value at top-level commas (or another separator) — respects `()` and strings. */
export function splitTopLevel(value: string, sep: ',' | ' ' = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      i = skipString(value, i) - 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch))) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Line and column (1-based) of an offset. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}
