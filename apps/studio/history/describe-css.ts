// `describeChanges` — the CSS lane (V2-1.9 §5.5.1 step 6, S1.10).
//
// The same-name stylesheet of a canvas, diffed per rule (at-rule context + selector) and per declaration, and
// put in the words of the TSX lane: "Frame: Fill black → white", "“Buy now” (hover): Gap 8 → 4 px". The
// selector's rightmost compound WITH classes names the elements (`.fx-list li` names `.fx-list`); the
// elements and their artboards come from the TSX model's class index (`TsxModel.classElements()`: static
// tokens, `cx()` / template / `"a-" + x` prefixes, declarations through the reference closure; elements gone
// since are found on the `before` model). A rule that names no element of the canvas is the one canvas-level
// fallback "Changed the style of …" (F) — unless the caller knows the class is rendered by something else
// (`rendersClass`, the canvas's import closure) and says no: then nothing uses it and the rule is dropped.
//
// No postcss: it is only a transitive dependency of the studio (not declared), and the compiled sidecar
// (DDR-176) must not lean on one. The parser below is ~150 lines, tolerant, and never throws: braces that do
// not balance make the sheet "unparseable", which the lane reports as the fallback instead of guessing.

import type { Change, LaneContext, LaneDescriber, TsxModel } from './describe';
import {
  collapseSpace,
  nameInWords,
  plural,
  propLabel,
  quote,
  roleOf,
  sameValue,
  sentence,
  valuePair,
  valueText,
  wordsOf,
} from './describe-words';

// ── the parser ──────────────────────────────────────────────────────────────────────────────

export interface CssRule {
  /** At-rule context, outermost first: `@media (max-width: 600px)`, `@keyframes fx-spin`. */
  ctx: string[];
  /** Normalised selector (`@font-face` for a font face). */
  selector: string;
  /** Property → value; the last declaration of a property wins. */
  decls: Map<string, string>;
}

export interface ParsedCss {
  ok: boolean;
  rules: CssRule[];
  /** `@import …;`, `@layer a, b;` … */
  statements: string[];
}

const CONTAINER_AT = /^@(media|supports|layer|container|scope|starting-style|document)\b/i;
const KEYFRAMES_AT = /^@(?:-\w+-)?keyframes\b/i;

function normSelector(s: string): string {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) out += ` ${ch} `;
    else if (depth === 0 && ch === ',') out += ', ';
    else out += ch;
  }
  return collapseSpace(out).replace(/\s*,\s*/g, ', ');
}

function normAtPrelude(s: string): string {
  return collapseSpace(s)
    .replace(/\s*:\s*/g, ': ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

/** Top-level comma parts of a selector list (commas inside parens / brackets stay). */
function commaParts(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function nest(parent: string, child: string): string {
  const out: string[] = [];
  for (const p of commaParts(parent))
    for (const c of commaParts(child))
      out.push(c.includes('&') ? c.replaceAll('&', p) : `${p} ${c}`);
  return normSelector(out.join(', '));
}

interface Frame {
  kind: 'container' | 'keyframes' | 'rule';
  rule: CssRule | null;
  ctxDepth: number;
}

export function parseCss(src: string): ParsedCss {
  const rules: CssRule[] = [];
  const statements: string[] = [];
  const stack: Frame[] = [];
  const ctx: string[] = [];
  let ok = true;
  let buf = '';
  let paren = 0;

  const top = (): Frame | undefined => stack[stack.length - 1];
  const decl = (text: string): void => {
    const f = top();
    if (!f?.rule) return;
    const i = text.indexOf(':');
    if (i < 1) return;
    const prop = text.slice(0, i).trim();
    const value = collapseSpace(text.slice(i + 1));
    if (!prop || !value) return;
    f.rule.decls.set(prop.startsWith('--') ? prop : prop.toLowerCase(), value);
  };
  const flushSemicolon = (): void => {
    const text = buf.trim();
    buf = '';
    if (!text) return;
    const f = top();
    if (f?.rule) decl(text);
    else if (text.startsWith('@')) statements.push(normAtPrelude(text));
  };
  const open = (): void => {
    const prelude = buf.trim();
    buf = '';
    const parent = top();
    if (prelude.startsWith('@')) {
      const at = normAtPrelude(prelude);
      if (KEYFRAMES_AT.test(at) || CONTAINER_AT.test(at)) {
        ctx.push(at);
        stack.push({
          kind: KEYFRAMES_AT.test(at) ? 'keyframes' : 'container',
          rule: null,
          ctxDepth: 1,
        });
      } else {
        // @font-face, @page, @property, @counter-style, unknown: a leaf with declarations
        const rule: CssRule = {
          ctx: [...ctx],
          selector: at.split(/\s+/)[0] as string,
          decls: new Map(),
        };
        rules.push(rule);
        stack.push({ kind: 'rule', rule, ctxDepth: 0 });
      }
      return;
    }
    const selector =
      parent?.kind === 'rule' && parent.rule
        ? nest(parent.rule.selector, prelude)
        : normSelector(prelude);
    const rule: CssRule = { ctx: [...ctx], selector, decls: new Map() };
    rules.push(rule);
    stack.push({ kind: 'rule', rule, ctxDepth: 0 });
  };
  const close = (): void => {
    if (top()?.rule && buf.trim()) decl(buf.trim());
    buf = '';
    const f = stack.pop();
    if (!f) {
      ok = false;
      return;
    }
    for (let i = 0; i < f.ctxDepth; i++) ctx.pop();
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      buf += ' ';
      if (end < 0) {
        i = src.length;
        break;
      }
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      buf += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    if (paren === 0) {
      if (ch === '{') {
        open();
        continue;
      }
      if (ch === '}') {
        close();
        continue;
      }
      if (ch === ';') {
        flushSemicolon();
        continue;
      }
    }
    buf += ch;
  }
  if (stack.length) ok = false;
  return { ok, rules, statements };
}

// ── selectors → elements ────────────────────────────────────────────────────────────────────

/** Compounds of a complex selector (combinators outside parens / brackets split). */
function compounds(part: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of part) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const stripFunctional = (s: string): string => {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
};

const classesOf = (compound: string): string[] =>
  [...stripFunctional(compound).matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) =>
    (m[1] as string).replace(/\\(.)/g, '$1')
  );

const PSEUDO_WORD: Record<string, string> = {
  hover: 'hover',
  focus: 'focus',
  'focus-visible': 'focus',
  'focus-within': 'focus',
  active: 'pressed',
  disabled: 'disabled',
  checked: 'checked',
  'first-child': 'first',
  'last-child': 'last',
  before: 'before',
  after: 'after',
  placeholder: 'placeholder',
  selection: 'selection',
};

function statesOf(compound: string): string[] {
  const out: string[] = [];
  for (const m of stripFunctional(compound).matchAll(/::?([a-z-]+)/gi)) {
    const name = (m[1] as string).toLowerCase();
    if (name === 'root' || name === 'global') continue;
    out.push(PSEUDO_WORD[name] ?? wordsOf(name));
  }
  return out;
}

interface Target {
  classes: string[][];
  states: string[];
  /** The label for the canvas-level fallback. */
  label: string;
}

function targetOf(selector: string): Target {
  const classes: string[][] = [];
  const states: string[] = [];
  let label = '';
  for (const part of commaParts(selector)) {
    const cs = compounds(part);
    const last = cs[cs.length - 1] ?? '';
    for (const s of statesOf(last)) if (!states.includes(s)) states.push(s);
    for (let i = cs.length - 1; i >= 0; i--) {
      const k = classesOf(cs[i] as string);
      if (k.length) {
        classes.push(k);
        if (!label) label = nameInWords(k[k.length - 1] as string);
        break;
      }
    }
    if (!label) {
      const tag = /^[a-z][a-z0-9]*/i.exec(last)?.[0];
      if (tag && !/^(html|body)$/i.test(tag)) label = sentence(roleOf(tag.toLowerCase()));
    }
  }
  return { classes, states, label: label || 'this canvas' };
}

function classMatches(
  model: TsxModel | null,
  classes: string[][]
): { names: string[]; artboards: string[]; frame: boolean } | null {
  if (!model || !classes.length) return null;
  const names: string[] = [];
  const keys = new Set<string>();
  let frame = false;
  let hit = false;
  for (const e of model.classElements()) {
    const matched = classes.some((want) =>
      want.every((c) => e.classes.some((r) => (r.prefix ? c.startsWith(r.token) : c === r.token)))
    );
    if (!matched) continue;
    hit = true;
    if (!names.includes(e.name)) names.push(e.name);
    if (!e.artboards.length) frame = true;
    for (const a of e.artboards) keys.add(a);
  }
  if (!hit) return null;
  const order = model.artboards.map((a) => a.key);
  const artboards = frame
    ? []
    : [...keys].sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      });
  return { names, artboards, frame };
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]} and ${plural(names.length - 1, 'other element', 'other elements')}`;
}

// ── context words ───────────────────────────────────────────────────────────────────────────

function mediaWords(at: string): string | null {
  if (!/^@media\b/i.test(at)) return null;
  const q = at.replace(/^@media\s*/i, '');
  const out: string[] = [];
  for (const m of q.matchAll(/\(\s*(max|min)-(width|height)\s*:\s*([\d.]+)\s*(px|em|rem)\s*\)/gi)) {
    const dim = (m[2] as string).toLowerCase() === 'height' ? ' tall' : '';
    out.push(
      `${(m[1] as string).toLowerCase() === 'max' ? 'up to' : 'from'} ${m[3]} ${m[4]}${dim}`
    );
  }
  if (/prefers-color-scheme:\s*dark/i.test(q)) out.push('in dark mode');
  else if (/prefers-color-scheme:\s*light/i.test(q)) out.push('in light mode');
  if (/prefers-reduced-motion/i.test(q)) out.push('with reduced motion');
  if (/\bprint\b/i.test(q)) out.push('in print');
  return out.length ? out.join(', ') : 'in a media rule';
}

const camel = (prop: string): string =>
  prop.startsWith('--')
    ? prop
    : prop
        .replace(/^-(?:webkit|moz|ms|o)-/, '')
        .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const clean = (v: string): string => v.replace(/\s*!important\s*$/i, '').trim();

// ── the lane ────────────────────────────────────────────────────────────────────────────────

export interface CssLaneOptions {
  /**
   * Does something outside this canvas's own TSX (the import closure: kit-rendered classes) render this
   * class? `false` for every class of an unmatched rule drops the rule — nothing uses it. Absent: kept.
   */
  rendersClass?: (token: string) => boolean;
}

const css = (
  artboards: string[],
  words: string,
  grade: Change['grade'] = 'W1',
  prop?: string
): Change => ({ artboards, grade, kind: 'css', words, ...(prop ? { prop } : {}) });

function keyOf(r: CssRule, seen: Map<string, number>): string {
  let base = `${r.ctx.join(' › ')}\u0001${r.selector}`;
  if (r.selector === '@font-face')
    base += `\u0001${wordsOf(r.decls.get('font-family') ?? '')}\u0001${r.decls.get('font-weight') ?? ''}\u0001${r.decls.get('font-style') ?? ''}`;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}\u0001#${n}`;
}

function index(p: ParsedCss): Map<string, CssRule> {
  const seen = new Map<string, number>();
  const m = new Map<string, CssRule>();
  for (const r of p.rules) m.set(keyOf(r, seen), r);
  return m;
}

const declSig = (r: CssRule): string =>
  [...r.decls]
    .map(([k, v]) => `${k}:${clean(v).toLowerCase()}`)
    .sort()
    .join(';');

const isKeyframes = (r: CssRule): boolean => KEYFRAMES_AT.test(r.ctx[r.ctx.length - 1] ?? '');
const keyframesName = (r: CssRule): string =>
  (r.ctx[r.ctx.length - 1] as string)
    .replace(KEYFRAMES_AT, '')
    .trim()
    .replace(/^["']|["']$/g, '');

const fontName = (r: CssRule): string =>
  (r.decls.get('font-family') ?? 'font')
    .replace(/^["']|["']$/g, '')
    .split(',')[0]
    ?.trim() ?? 'font';

export function describeCss(ctx: LaneContext, options: CssLaneOptions = {}): Change[] {
  const srcB = ctx.before.css?.trim() ? ctx.before.css : null;
  const srcA = ctx.after.css?.trim() ? ctx.after.css : null;
  if (srcB === srcA) return [];
  if (srcB === null) return [css([], 'Style sheet added')];
  if (srcA === null) return [css([], 'Style sheet removed')];
  const pb = parseCss(srcB);
  const pa = parseCss(srcA);
  if (!pb.ok || !pa.ok) return [css([], 'Changed the style of this canvas', 'F')];

  const mapB = index(pb);
  const mapA = index(pa);
  const out: Change[] = [];
  const seenLines = new Set<string>();
  const push = (c: Change): void => {
    const k = `${c.artboards.join(',')}\u0001${c.words}`;
    if (seenLines.has(k)) return;
    seenLines.add(k);
    out.push(c);
  };

  // a rule whose selector was renamed and nothing else is no change
  const removedKeys = [...mapB.keys()].filter((k) => !mapA.has(k));
  const addedKeys = [...mapA.keys()].filter((k) => !mapB.has(k));
  const renamed = new Set<string>();
  for (const rk of removedKeys) {
    const r = mapB.get(rk) as CssRule;
    if (isKeyframes(r) || r.selector === '@font-face') continue;
    const sig = declSig(r);
    const ak = addedKeys.find(
      (k) =>
        !renamed.has(k) &&
        declSig(mapA.get(k) as CssRule) === sig &&
        (mapA.get(k) as CssRule).ctx.join() === r.ctx.join()
    );
    if (ak) {
      renamed.add(ak);
      renamed.add(rk);
    }
  }

  const opts = ctx.opts;
  const where = (
    r: CssRule,
    side: 'a' | 'b'
  ): { name: string | null; artboards: string[]; t: Target } => {
    const t = targetOf(r.selector);
    const first = side === 'a' ? ctx.modelAfter : ctx.modelBefore;
    const second = side === 'a' ? ctx.modelBefore : ctx.modelAfter;
    const m = classMatches(first, t.classes) ?? classMatches(second, t.classes);
    if (!m) return { name: null, artboards: [], t };
    const extra = [...t.states];
    for (const c of r.ctx) {
      const w = mediaWords(c);
      if (w) extra.push(w);
    }
    const base = joinNames(m.names);
    return {
      name: extra.length ? `${base} (${extra.join(', ')})` : base,
      artboards: m.artboards,
      t,
    };
  };
  const unused = (t: Target): boolean =>
    !!options.rendersClass &&
    t.classes.length > 0 &&
    t.classes.every((g) => g.every((c) => !options.rendersClass?.(c)));

  const propLines = (
    name: string | null,
    artboards: string[],
    a: Map<string, string>,
    b: Map<string, string>
  ): boolean => {
    let loose = false;
    for (const prop of new Set([...a.keys(), ...b.keys()])) {
      const va = a.get(prop);
      const vb = b.get(prop);
      const ca = va === undefined ? undefined : clean(va);
      const cb = vb === undefined ? undefined : clean(vb);
      if (ca === cb) continue;
      if (
        ca !== undefined &&
        cb !== undefined &&
        sameValue(camel(prop), { lit: true, v: ca }, { lit: true, v: cb })
      )
        continue;
      const custom = prop.startsWith('--');
      const key = camel(prop);
      const label = custom ? (opts.tokenName?.(prop) ?? nameInWords(prop)) : propLabel(key);
      let rest: string;
      if (ca !== undefined && cb !== undefined)
        rest = valuePair(key, { lit: true, v: ca }, { lit: true, v: cb }, opts).text;
      else if (cb !== undefined) rest = `set to ${valueText(key, { lit: true, v: cb }, opts)}`;
      else rest = `removed (was ${valueText(key, { lit: true, v: ca as string }, opts)})`;
      if (name) push(css(artboards, `${name}: ${label} ${rest}`, 'W1', prop));
      else if (custom) push(css([], `${label}: ${rest}`, 'W1', prop));
      else loose = true;
    }
    return loose;
  };

  // ── keyframes, font faces, rules ──
  const frames = new Map<string, { a: string[]; b: string[] }>();
  const framesOf = (m: Map<string, CssRule>, side: 'a' | 'b'): void => {
    for (const r of m.values()) {
      if (!isKeyframes(r)) continue;
      const n = keyframesName(r);
      const e = frames.get(n) ?? { a: [], b: [] };
      e[side].push(`${r.selector}{${declSig(r)}}`);
      frames.set(n, e);
    }
  };
  framesOf(mapB, 'b');
  framesOf(mapA, 'a');
  for (const [n, e] of frames) {
    if (e.a.join('|') === e.b.join('|')) continue;
    if (!e.b.length) push(css([], `Animation ${quote(n)} added`));
    else if (!e.a.length) push(css([], `Animation ${quote(n)} removed`));
    else push(css([], `Animation ${quote(n)} changed`, 'W2'));
  }

  const fallbackLabels = new Set<string>();
  const loose = (t: Target): void => {
    fallbackLabels.add(t.label);
  };

  for (const [k, r] of mapA) {
    if (isKeyframes(r) || renamed.has(k)) continue;
    const old = mapB.get(k);
    if (r.selector === '@font-face') {
      if (!old) push(css([], `Font ${quote(fontName(r))} added`));
      else if (declSig(old) !== declSig(r))
        push(css([], `Font ${quote(fontName(r))} changed`, 'W2'));
      continue;
    }
    if (!old) {
      const w = where(r, 'a');
      if (w.name) push(css(w.artboards, `${w.name}: style added`));
      else if (!unused(w.t)) loose(w.t);
      continue;
    }
    const w = where(r, 'a');
    if (!w.name && unused(w.t)) continue;
    if (propLines(w.name, w.artboards, old.decls, r.decls)) loose(w.t);
  }
  for (const [k, r] of mapB) {
    if (isKeyframes(r) || renamed.has(k) || mapA.has(k)) continue;
    if (r.selector === '@font-face') {
      push(css([], `Font ${quote(fontName(r))} removed`));
      continue;
    }
    const w = where(r, 'b');
    if (w.name) push(css(w.artboards, `${w.name}: style removed`));
    else if (!unused(w.t)) loose(w.t);
  }
  for (const label of fallbackLabels) push(css([], `Changed the style of ${label}`, 'F'));

  // statement at-rules (@import, @layer a, b;) as a set
  const sb = new Set(pb.statements);
  const sa = new Set(pa.statements);
  if ([...sa].some((s) => !sb.has(s)) || [...sb].some((s) => !sa.has(s)))
    push(css([], 'Style imports changed', 'W2'));
  return out;
}

export function cssLane(options: CssLaneOptions = {}): LaneDescriber {
  return (ctx) => describeCss(ctx, options);
}
