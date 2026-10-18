// The CSS half of V2-1.9's evidence (§6, corpus C3) for the CSS lane (S1.10): the real v2 canvases have no
// same-name stylesheet, so one is generated per canvas — a rule per class token that its artboards render
// statically, three declarations each, seeded — and ONE declaration value is edited at a time.
//
// Ground truth is an independent source scan (never the describer's own class index): a token the canvas
// writes inside an artboard's own source range, and nowhere outside every artboard, renders in exactly
// those artboards. Tokens a dynamic prefix could also produce (`sb-role--${x}`) are left out of the sample.
//
// Used by `test/describe-lanes.test.ts` (small N, asserts the thresholds) and `test/describe-corpus.bench.ts`
// (`--css`, large N, prints the table for the hand-back).

import { readFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser';
import { type Change, describeChanges } from '../../../history/describe';
import { cssLane } from '../../../history/describe-css';
import { propLabel } from '../../../history/describe-words';
import { mulberry32, type Row } from './measure';

// biome-ignore lint/suspicious/noExplicitAny: oxc-parser AST nodes are heterogeneous.
type AnyNode = any;

const jsxName = (n: AnyNode): string => {
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return String(n.name);
  if (n.type === 'JSXMemberExpression') return `${jsxName(n.object)}.${jsxName(n.property)}`;
  return '';
};

function abIdOf(el: AnyNode): string | null {
  for (const a of el.openingElement.attributes ?? []) {
    if (a.type !== 'JSXAttribute' || a.name?.name !== 'id') continue;
    const v = a.value?.type === 'JSXExpressionContainer' ? a.value.expression : a.value;
    if (v?.type === 'Literal' && typeof v.value === 'string') return v.value;
    if (v?.type === 'TemplateLiteral')
      return v.quasis.map((q: AnyNode) => q.value.cooked).join('*');
  }
  return null;
}

interface Range {
  key: string;
  start: number;
  end: number;
}

function artboardRanges(program: AnyNode): Range[] {
  const out: Range[] = [];
  let idless = 0;
  const walk = (n: AnyNode): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'DCArtboard') {
      out.push({ key: abIdOf(n) ?? `#${idless++}`, start: n.start, end: n.end });
      return;
    }
    for (const k of Object.keys(n)) if (k !== 'type') walk(n[k]);
  };
  walk(program);
  return out;
}

const CLASS_ATTR =
  /(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`$]*)["'`]\s*\})/g;
const TOKEN = /^[A-Za-z][\w-]{2,40}$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Class tokens a source slice writes as static `className` strings. */
function staticTokens(slice: string): Set<string> {
  const out = new Set<string>();
  for (const m of slice.matchAll(CLASS_ATTR)) {
    const v = m[1] ?? m[2] ?? m[3] ?? '';
    for (const t of v.split(/\s+/)) if (TOKEN.test(t)) out.add(t);
  }
  return out;
}

/** Prefixes of classes built at run time: `` `sb-${x}` ``, `"sb-role--" + x`, `cx('a-' + x)`. */
function dynamicPrefixes(source: string): string[] {
  const out = new Set<string>();
  // `es-e--${size}` (the word run just before an interpolation) and `"sb-role--" + x`
  for (const m of source.matchAll(/([\w-]{2,40})\$\{/g)) out.add(m[1] as string);
  for (const m of source.matchAll(/["'`]([\w-]{2,40})["'`]\s*\+/g)) out.add(m[1] as string);
  return [...out];
}

export interface CssSample {
  token: string;
  artboards: string[];
}

export function sampleTokens(source: string, file: string): CssSample[] {
  const program = parseSync(file, source).program as AnyNode;
  const ranges = artboardRanges(program);
  if (!ranges.length) return [];
  const per = new Map<string, Set<string>>();
  let outside = source;
  for (const r of [...ranges].sort((a, b) => b.start - a.start))
    outside = `${outside.slice(0, r.start)}${' '.repeat(r.end - r.start)}${outside.slice(r.end)}`;
  for (const r of ranges)
    for (const t of staticTokens(source.slice(r.start, r.end))) {
      if (!per.has(t)) per.set(t, new Set());
      (per.get(t) as Set<string>).add(r.key);
    }
  const dyn = dynamicPrefixes(source);
  const out: CssSample[] = [];
  for (const [token, keys] of per) {
    if (new RegExp(`(?<![\\w-])${esc(token)}(?![\\w-])`).test(outside)) continue;
    if (dyn.some((p) => token.startsWith(p))) continue;
    // a token that is also the suffix/prefix of another token the sheet would style is fine; one that
    // is a plain word of the page text is not safe either — keep tokens with a separator or digit only.
    if (!/[-_\d]/.test(token)) continue;
    out.push({ token, artboards: [...keys] });
  }
  return out.sort((a, b) => (a.token < b.token ? -1 : 1));
}

// ── the generated sheet and its edits ───────────────────────────────────────────────────────

const HEX = '0123456789abcdef';
const hex6 = (rng: () => number): string =>
  `#${Array.from({ length: 6 }, () => HEX[Math.floor(rng() * 16)]).join('')}`;

interface Decl {
  prop: string;
  value: string;
}

function declsFor(rng: () => number): Decl[] {
  return [
    { prop: 'background', value: hex6(rng) },
    { prop: 'padding', value: `${4 + Math.floor(rng() * 40)}px` },
    { prop: rng() < 0.5 ? 'gap' : 'font-size', value: `${6 + Math.floor(rng() * 30)}px` },
  ];
}

function buildSheet(rules: Array<{ token: string; decls: Decl[] }>): string {
  return rules
    .map((r) => `.${r.token} {\n${r.decls.map((d) => `  ${d.prop}: ${d.value};`).join('\n')}\n}\n`)
    .join('\n');
}

function mutate(rng: () => number, d: Decl): string {
  if (d.value.startsWith('#')) {
    const i = 1 + Math.floor(rng() * 6);
    let c = HEX[Math.floor(rng() * 16)] as string;
    if (c === d.value[i]) c = HEX[(HEX.indexOf(c) + 5) % 16] as string;
    return `${d.value.slice(0, i)}${c}${d.value.slice(i + 1)}`;
  }
  const n = Number.parseInt(d.value, 10);
  const next =
    rng() < 0.5 ? n + 1 + Math.floor(rng() * 12) : Math.max(0, n - 1 - Math.floor(rng() * 4));
  return `${next === n ? n + 1 : next}px`;
}

export type CssVerdict = 'right' | 'wrong-words' | 'wrong-artboard' | 'fallback' | 'nothing';

export interface CssReport {
  all: Row;
  ms: number[];
  misses: Array<{
    canvas: string;
    verdict: CssVerdict;
    token: string;
    truth: string[];
    got: string[][];
    words: string[];
  }>;
}

function grade(truth: string[], d: Decl, nextValue: string, changes: Change[]): CssVerdict {
  if (!changes.length) return 'nothing';
  if (changes.some((c) => c.grade === 'F' || c.kind === 'canvas')) return 'fallback';
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (changes.some((c) => !same(c.artboards, truth))) return 'wrong-artboard';
  if (changes.length !== 1) return 'wrong-words';
  const c = changes[0] as Change;
  if (c.kind !== 'css' || c.grade !== 'W1') return 'wrong-words';
  if (!c.words.includes(`: ${propLabel(d.prop.replace(/-(\w)/g, (_, x) => x.toUpperCase()))} `))
    return 'wrong-words';
  if (!nextValue.startsWith('#')) {
    const n = Number.parseInt(nextValue, 10);
    if (!c.words.endsWith(`→ ${n} px`)) return 'wrong-words';
  }
  return 'right';
}

export function measureCss(files: string[], perCanvas: number, seed = 20261018): CssReport {
  const all: Row = { n: 0, right: 0, wrongWords: 0, wrongArtboard: 0, fallback: 0, nothing: 0 };
  const ms: number[] = [];
  const misses: CssReport['misses'] = [];
  const lane = cssLane();
  for (const f of files) {
    const source = readFileSync(f, 'utf8');
    const rng = mulberry32(seed ^ f.length);
    const samples = sampleTokens(source, f).slice(0, 60);
    if (samples.length < 2) continue;
    const rules = samples.map((s) => ({ token: s.token, decls: declsFor(rng) }));
    const before = buildSheet(rules);
    for (let i = 0; i < perCanvas; i++) {
      const ri = Math.floor(rng() * rules.length);
      const rule = rules[ri] as (typeof rules)[number];
      const d = rule.decls[Math.floor(rng() * rule.decls.length)] as Decl;
      const nextValue = mutate(rng, d);
      const edited = rules.map((r, j) =>
        j === ri
          ? { ...r, decls: r.decls.map((x) => (x === d ? { ...x, value: nextValue } : x)) }
          : r
      );
      const r = describeChanges(
        f,
        { tsx: source, css: before },
        { tsx: source, css: buildSheet(edited) },
        {
          lanes: [lane],
        }
      );
      ms.push(r.ms);
      const v = grade((samples[ri] as CssSample).artboards, d, nextValue, r.changes);
      all.n++;
      if (v === 'right') all.right++;
      else if (v === 'wrong-words') all.wrongWords++;
      else if (v === 'wrong-artboard') all.wrongArtboard++;
      else if (v === 'fallback') all.fallback++;
      else all.nothing++;
      if (v !== 'right' && misses.length < 200)
        misses.push({
          canvas: f,
          verdict: v,
          token: rule.token,
          truth: (samples[ri] as CssSample).artboards,
          got: r.changes.map((c) => c.artboards),
          words: r.changes.map((c) => c.words).slice(0, 3),
        });
    }
  }
  return { all, ms, misses };
}
