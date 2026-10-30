// The structure half of `describeChanges` (V2-1.9 §5.5.1): parse → element trees → A↔B matching.
//
// Pure and synchronous, no words (those are `describe-words.ts`) and no lanes (`describe.ts`).
//
//   parseCanvas(source)          comments blanked (same length, offsets kept), or null on a parse error
//   buildArtboard / buildRoots   JSX → `El` trees (JSX inside expressions and in attribute slots included)
//   matchContainers(pairs)       the matcher: authored `data-cd-id` → unique identical subtree → top-down
//                                child alignment (LCS on tag + name + classes + text) → mutual best by
//                                score → a stricter global mutual-best pass for moves (score ≥ 5, margin ≥ 2)

import { parseSync } from 'oxc-parser';
import type { Val } from './describe-words';

// biome-ignore lint/suspicious/noExplicitAny: oxc-parser AST nodes are heterogeneous.
export type AnyNode = any;

export const isNode = (v: unknown): v is AnyNode =>
  !!v && typeof v === 'object' && typeof (v as AnyNode).type === 'string';

// ── parsing ─────────────────────────────────────────────────────────────────────────────────

export interface Parsed {
  program: AnyNode;
  /** The source with every comment blanked (spaces; newlines kept) — AST offsets index into it. */
  src: string;
}

export function parseCanvas(source: string): Parsed | null {
  let r: AnyNode;
  try {
    r = parseSync('canvas.tsx', source, { sourceType: 'module' });
  } catch {
    return null;
  }
  if (!r || r.errors?.length) return null;
  let src = source;
  const comments: AnyNode[] = r.comments ?? [];
  if (comments.length) {
    const parts: string[] = [];
    let at = 0;
    for (const c of comments) {
      parts.push(source.slice(at, c.start), source.slice(c.start, c.end).replace(/[^\n]/g, ' '));
      at = c.end;
    }
    parts.push(source.slice(at));
    src = parts.join('');
  }
  return { program: r.program, src };
}

export function forEachChild(n: AnyNode, fn: (c: AnyNode, key: string) => void): void {
  for (const k in n) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    const v = n[k];
    if (Array.isArray(v)) {
      for (const c of v) if (isNode(c)) fn(c, k);
    } else if (isNode(v)) fn(v, k);
  }
}

export function jsxTagName(n: AnyNode): string {
  if (!n) return '?';
  if (n.type === 'JSXIdentifier') return String(n.name);
  if (n.type === 'JSXMemberExpression') return `${jsxTagName(n.object)}.${jsxTagName(n.property)}`;
  if (n.type === 'JSXNamespacedName') return `${n.namespace?.name}:${n.name?.name}`;
  return '?';
}

export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The outermost JSX elements / fragments under `node` (not entering them), in document order. */
export function outerJsx(node: AnyNode, out: AnyNode[] = []): AnyNode[] {
  if (!isNode(node)) return out;
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
    out.push(node);
    return out;
  }
  forEachChild(node, (c) => outerJsx(c, out));
  return out;
}

/** The normalised source of `node` with each outermost JSX replaced by a placeholder. */
export function sigOf(node: AnyNode, src: string): string {
  const jsx = outerJsx(node);
  if (!jsx.length) return collapse(src.slice(node.start, node.end));
  let out = '';
  let at = node.start;
  for (const j of jsx) {
    out += `${src.slice(at, j.start)}⟦⟧`;
    at = j.end;
  }
  out += src.slice(at, node.end);
  return collapse(out);
}

/** A literal's string form, or null when `n` is not a plain literal. */
export function litOf(n: AnyNode): string | null {
  if (!isNode(n)) return null;
  if (n.type === 'Literal' || n.type === 'StringLiteral' || n.type === 'NumericLiteral') {
    if (n.regex || n.bigint) return null;
    return n.value === null ? 'null' : String(n.value);
  }
  if (n.type === 'TemplateLiteral' && !n.expressions?.length)
    return String(n.quasis?.[0]?.value?.cooked ?? n.quasis?.[0]?.value?.raw ?? '');
  if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+')) {
    const inner = litOf(n.argument);
    return inner !== null && /^[\d.]+$/.test(inner)
      ? `${n.operator === '-' ? '-' : ''}${inner}`
      : null;
  }
  if (
    n.type === 'TSAsExpression' ||
    n.type === 'TSSatisfiesExpression' ||
    n.type === 'ParenthesizedExpression'
  )
    return litOf(n.expression);
  return null;
}

// ── element trees ───────────────────────────────────────────────────────────────────────────

export interface ClassRef {
  token: string;
  /** A prefix (`"sb-role--" + x`, `` `sb-${x}` ``) — every class starting with it. */
  prefix: boolean;
}

export interface El {
  /** Pre-order index within its root. */
  n: number;
  tag: string;
  /** The attribute this element sits in (`note={<Note/>}`), or null. */
  slot: string | null;
  /** Authored `data-cd-id`, or `ab:<id>` / `sec:<id>` for the canvas frame's artboards and sections. */
  matchKey: string | null;
  cdId: string | null;
  /** S3.10a — the `data-cd-link` value (a formula reads `{expr}`), or null: the one `data-cd-*` the lane words. */
  link: string | null;
  parent: El | null;
  kids: El[];
  idx: number;
  root: El;
  /** Every non-`data-cd-*` attribute except `key`, `className` and `style`. */
  attrs: Map<string, Val>;
  classes: string[];
  classRefs: ClassRef[];
  classSig: string;
  style: Map<string, Val>;
  styleSig: string | null;
  /** Own text: JSXText and plain string expressions, whitespace collapsed. */
  text: string;
  /** Non-JSX child expressions, JSX replaced by a placeholder. */
  exprs: string[];
  hash: string;
  size: number;
  /** Enclosing PascalCase component ('' at module level). */
  component: string;
  /** A `DCArtboard` leaf of the canvas frame (not descended). */
  abNode: AnyNode | null;
  /** The artboard key (a deep artboard tree's root, or a frame leaf). */
  abKey: string | null;
}

interface Ctx {
  /** Id-less artboards are keyed by their order: `#0`, `#1`, … */
  abSeq: { n: number };
  src: string;
  /** Do not descend into `DCArtboard` (the frame tree). */
  leafArtboards: boolean;
  comp: string;
}

function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Class tokens (and prefixes) from the string literals of a className expression. */
function classRefsOf(expr: AnyNode, out: ClassRef[]): void {
  const addText = (s: string, prefixTail: boolean): void => {
    const parts = s.split(/\s+/).filter(Boolean);
    const tail = prefixTail && !/\s$/.test(s);
    parts.forEach((t, i) => {
      out.push({ token: t, prefix: tail && i === parts.length - 1 });
    });
  };
  const walk = (n: AnyNode, followedByDynamic: boolean): void => {
    if (!isNode(n)) return;
    if (n.type === 'Literal' || n.type === 'StringLiteral') {
      if (typeof n.value === 'string') addText(n.value, followedByDynamic);
      return;
    }
    if (n.type === 'TemplateLiteral') {
      (n.quasis ?? []).forEach((q: AnyNode, i: number) => {
        addText(String(q.value?.cooked ?? q.value?.raw ?? ''), i < (n.expressions?.length ?? 0));
      });
      for (const e of n.expressions ?? []) walk(e, false);
      return;
    }
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      const rightLit = litOf(n.right) !== null;
      walk(n.left, !rightLit);
      walk(n.right, false);
      return;
    }
    forEachChild(n, (c) => walk(c, false));
  };
  walk(expr, false);
}

function valOf(node: AnyNode, ctx: Ctx): Val {
  const l = litOf(node);
  if (l !== null) return { lit: true, v: l };
  return { lit: false, v: sigOf(node, ctx.src) };
}

function addKidsFrom(parent: El, jsxNodes: AnyNode[], ctx: Ctx, slot: string | null): void {
  for (const j of jsxNodes) {
    if (j.type === 'JSXElement') parent.kids.push(mkEl(j, ctx, slot));
    else addChildren(parent, j.children ?? [], ctx, slot);
  }
}

function addChildren(parent: El, children: AnyNode[], ctx: Ctx, slot: string | null): void {
  const texts: string[] = [];
  for (const c of children) {
    switch (c.type) {
      case 'JSXText': {
        const t = collapse(String(c.value));
        if (t) texts.push(t);
        break;
      }
      case 'JSXElement':
        parent.kids.push(mkEl(c, ctx, slot));
        break;
      case 'JSXFragment':
        addChildren(parent, c.children ?? [], ctx, slot);
        break;
      case 'JSXExpressionContainer': {
        const e = c.expression;
        if (!e || e.type === 'JSXEmptyExpression') break;
        const l = litOf(e);
        if (l !== null) {
          const t = collapse(l);
          if (t) texts.push(t);
          break;
        }
        parent.exprs.push(sigOf(e, ctx.src));
        addKidsFrom(parent, outerJsx(e), ctx, slot);
        break;
      }
      default:
        break;
    }
  }
  if (texts.length) parent.text = collapse(`${parent.text} ${texts.join(' ')}`);
}

/** Artboard id: a literal, or a family key (`disc-${d.id}` → `disc-*`). null when absent. */
export function artboardIdOf(opening: AnyNode): string | null {
  for (const a of opening.attributes ?? []) {
    if (a?.type !== 'JSXAttribute' || a.name?.name !== 'id') continue;
    return idLiteral(a.value);
  }
  return null;
}

function idLiteral(v: AnyNode): string | null {
  if (!v) return null;
  const l = litOf(v);
  if (l !== null) return l;
  if (v.type === 'JSXExpressionContainer') return idLiteral(v.expression);
  if (v.type === 'TemplateLiteral') {
    return (v.quasis ?? [])
      .map((q: AnyNode) => String(q.value?.cooked ?? q.value?.raw ?? ''))
      .join('*');
  }
  return null;
}

function mkEl(node: AnyNode, ctx: Ctx, slot: string | null): El {
  const open = node.openingElement;
  const tag = jsxTagName(open.name);
  const el: El = {
    n: 0,
    tag,
    slot,
    matchKey: null,
    cdId: null,
    link: null,
    parent: null,
    kids: [],
    idx: 0,
    root: null as unknown as El,
    attrs: new Map(),
    classes: [],
    classRefs: [],
    classSig: '',
    style: new Map(),
    styleSig: null,
    text: '',
    exprs: [],
    hash: '',
    size: 1,
    component: ctx.comp,
    abNode: null,
    abKey: null,
  };
  let spreadN = 0;
  for (const a of open.attributes ?? []) {
    if (a.type === 'JSXSpreadAttribute') {
      el.attrs.set(`...${spreadN++}`, { lit: false, v: sigOf(a.argument, ctx.src) });
      addKidsFrom(el, outerJsx(a.argument), ctx, '...');
      continue;
    }
    const name =
      a.name?.type === 'JSXNamespacedName'
        ? `${a.name.namespace.name}:${a.name.name.name}`
        : String(a.name?.name);
    if (name === 'key') continue;
    const value = a.value;
    if (name.startsWith('data-cd-')) {
      if (name === 'data-cd-id') {
        const l = value
          ? litOf(value.type === 'JSXExpressionContainer' ? value.expression : value)
          : null;
        if (l) el.cdId = l;
      } else if (name === 'data-cd-link') {
        const l = value
          ? litOf(value.type === 'JSXExpressionContainer' ? value.expression : value)
          : null;
        el.link = l ?? '{expr}';
      }
      continue;
    }
    const expr = value?.type === 'JSXExpressionContainer' ? value.expression : value;
    if (name === 'className' || name === 'class') {
      if (!expr) continue;
      const l = litOf(expr);
      if (l !== null) {
        el.classes = l.split(/\s+/).filter(Boolean);
        el.classRefs = el.classes.map((token) => ({ token, prefix: false }));
        el.classSig = collapse(l);
      } else {
        const refs: ClassRef[] = [];
        classRefsOf(expr, refs);
        el.classRefs = refs;
        el.classes = refs.map((r) => r.token);
        el.classSig = sigOf(expr, ctx.src);
        addKidsFrom(el, outerJsx(expr), ctx, name);
      }
      continue;
    }
    if (name === 'style') {
      if (expr?.type === 'ObjectExpression') {
        let sp = 0;
        for (const p of expr.properties ?? []) {
          if (p.type === 'SpreadElement') {
            el.style.set(`...${sp++}`, { lit: false, v: sigOf(p.argument, ctx.src) });
            continue;
          }
          const k = p.key;
          const key = p.computed
            ? `[${sigOf(k, ctx.src)}]`
            : k?.type === 'Identifier'
              ? String(k.name)
              : String(litOf(k) ?? sigOf(k, ctx.src));
          el.style.set(key, valOf(p.value, ctx));
        }
      } else if (expr) {
        el.styleSig = sigOf(expr, ctx.src);
      }
      continue;
    }
    if (!value) {
      el.attrs.set(name, { lit: true, v: 'true' });
      continue;
    }
    if (expr.type === 'JSXEmptyExpression') continue;
    const jsx = outerJsx(expr);
    if (jsx.length) {
      el.attrs.set(name, { lit: false, v: sigOf(expr, ctx.src) });
      addKidsFrom(el, jsx, ctx, name);
    } else {
      el.attrs.set(name, valOf(expr, ctx));
    }
  }
  if (ctx.leafArtboards && tag === 'DCArtboard') {
    el.abNode = node;
    const id = artboardIdOf(open);
    el.abKey = id ?? `#${ctx.abSeq.n++}`;
    el.matchKey = `ab:${el.abKey}`;
  } else {
    if (tag === 'DCSection') {
      const idv = el.attrs.get('id') ?? el.attrs.get('title');
      if (idv?.lit) el.matchKey = `sec:${idv.v}`;
    }
    if (el.cdId) el.matchKey = el.cdId;
    addChildren(el, node.children ?? [], ctx, null);
  }
  return el;
}

/** Fill `n`, `parent`, `idx`, `root`, `hash`, `size` bottom-up / top-down once the tree is complete. */
function finish(root: El): void {
  let n = 0;
  const down = (e: El, parent: El | null, idx: number): void => {
    e.n = n++;
    e.parent = parent;
    e.idx = idx;
    e.root = root;
    for (let i = 0; i < e.kids.length; i++) down(e.kids[i] as El, e, i);
  };
  down(root, null, 0);
  const up = (e: El): void => {
    let size = 1;
    for (const k of e.kids) {
      up(k);
      size += k.size;
    }
    e.size = size;
    const attrs = [...e.attrs].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const style = [...e.style].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    e.hash = cyrb53(
      [
        e.tag,
        attrs.map(([k, v]) => `${k}${v.lit ? '=' : '~'}${v.v}`).join('\u0002'),
        e.classSig,
        style.map(([k, v]) => `${k}${v.lit ? '=' : '~'}${v.v}`).join('\u0002'),
        e.styleSig ?? '',
        e.text,
        e.exprs.join('\u0003'),
        e.kids.map((k) => k.hash).join('\u0004'),
        // S3.10a — a changed link is a changed element (absent link: the pre-S3.10a hash, unchanged)
        ...(e.link === null ? [] : [`link=${e.link}`]),
      ].join('\u0001')
    );
  };
  up(root);
}

/** A virtual root whose kids are `jsxNodes` (outermost JSX of a declaration / the canvas frame). */
export function buildRoots(
  jsxNodes: AnyNode[],
  src: string,
  opts: { leafArtboards?: boolean; comp?: string } = {}
): El {
  const ctx: Ctx = {
    abSeq: { n: 0 },
    src,
    leafArtboards: !!opts.leafArtboards,
    comp: opts.comp ?? '',
  };
  const root = mkVirtual(ctx);
  addKidsFrom(root, jsxNodes, ctx, null);
  finish(root);
  return root;
}

function mkVirtual(ctx: Ctx): El {
  const el: El = {
    n: 0,
    tag: '#root',
    slot: null,
    matchKey: null,
    cdId: null,
    link: null,
    parent: null,
    kids: [],
    idx: 0,
    root: null as unknown as El,
    attrs: new Map(),
    classes: [],
    classRefs: [],
    classSig: '',
    style: new Map(),
    styleSig: null,
    text: '',
    exprs: [],
    hash: '',
    size: 1,
    component: ctx.comp,
    abNode: null,
    abKey: null,
  };
  return el;
}

/** The full tree of one `DCArtboard` element (the element itself is the root). */
export function buildArtboard(
  node: AnyNode,
  src: string,
  comp = '',
  key: string | null = null
): El {
  const ctx: Ctx = { abSeq: { n: 0 }, src, leafArtboards: false, comp };
  const root = mkEl(node, ctx, null);
  root.abKey = key;
  finish(root);
  return root;
}

export function walkEls(root: El, fn: (e: El) => void): void {
  fn(root);
  for (const k of root.kids) walkEls(k, fn);
}

// ── matching ────────────────────────────────────────────────────────────────────────────────

export class Pairing {
  readonly a2b = new Map<El, El>();
  readonly b2a = new Map<El, El>();
  pair(a: El, b: El): void {
    this.a2b.set(a, b);
    this.b2a.set(b, a);
  }
  has(e: El, side: 'a' | 'b'): boolean {
    return (side === 'a' ? this.a2b : this.b2a).has(e);
  }
}

const jaccard = (a: readonly string[], b: readonly string[]): number => {
  if (!a.length && !b.length) return 0;
  const sb = new Set(b);
  let inter = 0;
  const sa = new Set(a);
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
};

const IDENT_ATTRS = [
  'data-dc-element',
  'aria-label',
  'alt',
  'title',
  'label',
  'name',
  'src',
  'href',
  'id',
];

function nameAttr(e: El): string {
  for (const k of IDENT_ATTRS) {
    const v = e.attrs.get(k);
    if (v?.lit) return v.v;
  }
  return '';
}

/** How alike two elements are (0 = never the same element). Max ≈ 14. */
export function score(a: El, b: El): number {
  if (a.tag !== b.tag) return 0;
  let s = a.slot === b.slot ? 1 : 0.5;
  if (a.hash === b.hash) s += 4;
  if (a.classSig === b.classSig) s += a.classSig ? 2 : 0.3;
  else s += 2 * jaccard(a.classes, b.classes);
  if (a.text && a.text === b.text) s += 2.5;
  else if (a.text && b.text) {
    const wa = a.text.split(' ');
    const wb = b.text.split(' ');
    s += 1.5 * jaccard(wa, wb);
  }
  let ident = 0;
  for (const k of IDENT_ATTRS) {
    const va = a.attrs.get(k);
    const vb = b.attrs.get(k);
    if (va && vb && va.v === vb.v) ident += 1.5;
  }
  s += Math.min(ident, 3);
  let same = 0;
  for (const [k, v] of a.attrs) {
    if (IDENT_ATTRS.includes(k)) continue;
    const o = b.attrs.get(k);
    if (o && o.v === v.v) same++;
  }
  s += Math.min(same * 0.25, 1);
  if (a.style.size || b.style.size) {
    let eq = 0;
    for (const [k, v] of a.style) if (b.style.get(k)?.v === v.v) eq++;
    const union =
      a.style.size + b.style.size - [...a.style.keys()].filter((k) => b.style.has(k)).length;
    s += union ? (eq / union) * 1.5 : 0;
    s += jaccard([...a.style.keys()], [...b.style.keys()]) * 0.5;
  }
  if (a.kids.length && b.kids.length) {
    const ha = new Set(a.kids.map((k) => k.hash));
    let shared = 0;
    for (const k of b.kids) if (ha.has(k.hash)) shared++;
    s += Math.min(shared, 3) * 0.5;
    if (a.kids.length === b.kids.length) s += 0.3;
  }
  if (a.idx === b.idx) s += 1;
  return s;
}

const keyOf = (e: El): string =>
  `${e.slot ?? ''}\u0001${e.tag}\u0001${e.classSig}\u0001${e.text}\u0001${nameAttr(e)}`;
const hashKey = (e: El): string => e.hash;

const IN_PARENT_MIN = 2;
const GLOBAL_MIN = 5;
const GLOBAL_MARGIN = 2;
const LCS_CELLS = 4_000_000;
const MATRIX_CELLS = 90_000;

/**
 * Pair `fa[i]` ↔ `fb[j]` along a longest common subsequence of tokens. Elements already matched to each
 * other are anchors (same token), so an unmatched duplicate lines up with its neighbours by POSITION —
 * deleting the 3rd of five identical separators pairs the survivors around it, not the first four.
 */
function lcsPairs(fa: El[], fb: El[], tok: (e: El, side: 'a' | 'b') => string): Array<[El, El]> {
  const ka = fa.map((e) => tok(e, 'a'));
  const kb = fb.map((e) => tok(e, 'b'));
  const out: Array<[El, El]> = [];
  const keep = (i: number, j: number): void => {
    if ((ka[i] as string).charCodeAt(0) === 85) out.push([fa[i] as El, fb[j] as El]);
  };
  let lo = 0;
  while (lo < ka.length && lo < kb.length && ka[lo] === kb[lo]) {
    keep(lo, lo);
    lo++;
  }
  let ha = ka.length;
  let hb = kb.length;
  const tail: Array<[number, number]> = [];
  while (ha > lo && hb > lo && ka[ha - 1] === kb[hb - 1]) {
    tail.push([ha - 1, hb - 1]);
    ha--;
    hb--;
  }
  const n = ha - lo;
  const m = hb - lo;
  if (n > 0 && m > 0 && n * m <= LCS_CELLS) {
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * w + j] =
          ka[lo + i] === kb[lo + j]
            ? (dp[(i + 1) * w + j + 1] as number) + 1
            : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ka[lo + i] === kb[lo + j]) {
        keep(lo + i, lo + j);
        i++;
        j++;
      } else if ((dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number)) i++;
      else j++;
    }
  }
  for (let t = tail.length - 1; t >= 0; t--)
    keep((tail[t] as [number, number])[0], (tail[t] as [number, number])[1]);
  return out;
}

function mutualBest(
  ua: El[],
  ub: El[],
  min: number,
  margin: number,
  skipCell = MATRIX_CELLS
): Array<[El, El, number]> {
  if (!ua.length || !ub.length || ua.length * ub.length > skipCell) return [];
  const bestA = new Array<number>(ua.length).fill(-1);
  const bestAScore = new Array<number>(ua.length).fill(0);
  const secondA = new Array<number>(ua.length).fill(0);
  const bestB = new Array<number>(ub.length).fill(-1);
  const bestBScore = new Array<number>(ub.length).fill(0);
  const secondB = new Array<number>(ub.length).fill(0);
  for (let i = 0; i < ua.length; i++) {
    for (let j = 0; j < ub.length; j++) {
      const s = score(ua[i] as El, ub[j] as El);
      if (s <= 0) continue;
      if (s > (bestAScore[i] as number)) {
        secondA[i] = bestAScore[i] as number;
        bestAScore[i] = s;
        bestA[i] = j;
      } else if (s > (secondA[i] as number)) secondA[i] = s;
      if (s > (bestBScore[j] as number)) {
        secondB[j] = bestBScore[j] as number;
        bestBScore[j] = s;
        bestB[j] = i;
      } else if (s > (secondB[j] as number)) secondB[j] = s;
    }
  }
  const out: Array<[El, El, number]> = [];
  for (let i = 0; i < ua.length; i++) {
    const j = bestA[i] as number;
    if (j < 0 || bestB[j] !== i) continue;
    const s = bestAScore[i] as number;
    if (s < min) continue;
    if (margin > 0 && (s - (secondA[i] as number) < margin || s - (secondB[j] as number) < margin))
      continue;
    out.push([ua[i] as El, ub[j] as El, s]);
  }
  return out;
}

function allDescendants(root: El, skipRoot = true): El[] {
  const out: El[] = [];
  walkEls(root, (e) => {
    if (!skipRoot || e !== root) out.push(e);
  });
  return out;
}

/**
 * Match element trees A↔B. `pairs` are the container pairs (artboard A ↔ artboard B, a declaration's
 * JSX roots, the canvas frame) whose roots are matched by the caller's identity. Several containers are
 * matched together so an element moved from one artboard into another is a move, not a delete + add.
 */
export function matchContainers(pairs: Array<[El, El]>): Pairing {
  const p = new Pairing();
  const queue: Array<[El, El]> = [];
  const take = (a: El, b: El): void => {
    if (p.has(a, 'a') || p.has(b, 'b')) return;
    p.pair(a, b);
    queue.push([a, b]);
  };
  for (const [a, b] of pairs) take(a, b);

  // (1) authored ids / frame keys, unique on both sides
  const keyA = new Map<string, El | null>();
  const keyB = new Map<string, El | null>();
  const index = (m: Map<string, El | null>, e: El): void => {
    if (!e.matchKey) return;
    m.set(e.matchKey, m.has(e.matchKey) ? null : e);
  };
  for (const [a, b] of pairs) {
    walkEls(a, (e) => index(keyA, e));
    walkEls(b, (e) => index(keyB, e));
  }
  for (const [k, a] of keyA) {
    const b = keyB.get(k);
    if (a && b && a.tag === b.tag) take(a, b);
  }

  // (2) unique identical subtrees, per container pair, biggest first
  for (const [ra, rb] of pairs) {
    if (ra.hash === rb.hash) {
      zip(ra, rb, take, p);
      continue;
    }
    const bucketA = new Map<string, El[]>();
    const bucketB = new Map<string, El[]>();
    for (const e of allDescendants(ra)) {
      if (p.has(e, 'a')) continue;
      const l = bucketA.get(e.hash);
      if (l) l.push(e);
      else bucketA.set(e.hash, [e]);
    }
    for (const e of allDescendants(rb)) {
      if (p.has(e, 'b')) continue;
      const l = bucketB.get(e.hash);
      if (l) l.push(e);
      else bucketB.set(e.hash, [e]);
    }
    const uniq: Array<[El, El]> = [];
    for (const [h, la] of bucketA) {
      const lb = bucketB.get(h);
      if (la.length === 1 && lb?.length === 1) uniq.push([la[0] as El, lb[0] as El]);
    }
    uniq.sort((x, y) => y[0].size - x[0].size);
    for (const [a, b] of uniq) if (!p.has(a, 'a') && !p.has(b, 'b')) zip(a, b, take, p);
  }

  drain(queue, p, take);

  // (3) a stricter global pass for moves
  const ua: El[] = [];
  const ub: El[] = [];
  for (const [a, b] of pairs) {
    walkEls(a, (e) => {
      if (e !== a && !p.has(e, 'a')) ua.push(e);
    });
    walkEls(b, (e) => {
      if (e !== b && !p.has(e, 'b')) ub.push(e);
    });
  }
  if (ua.length && ub.length) {
    const byTagA = group(ua);
    const byTagB = group(ub);
    const found: Array<[El, El, number]> = [];
    for (const [tag, la] of byTagA) {
      const lb = byTagB.get(tag);
      if (!lb) continue;
      // identical subtrees first (unique on both sides)
      const ha = new Map<string, El[]>();
      const hb = new Map<string, El[]>();
      for (const e of la) ha.set(e.hash, [...(ha.get(e.hash) ?? []), e]);
      for (const e of lb) hb.set(e.hash, [...(hb.get(e.hash) ?? []), e]);
      for (const [h, l1] of ha) {
        const l2 = hb.get(h);
        if (l1.length === 1 && l2?.length === 1) found.push([l1[0] as El, l2[0] as El, 99]);
      }
      found.push(...mutualBest(la, lb, GLOBAL_MIN, GLOBAL_MARGIN));
    }
    found.sort((x, y) => y[2] - x[2] || y[0].size - x[0].size);
    for (const [a, b] of found) {
      if (p.has(a, 'a') || p.has(b, 'b')) continue;
      if (a.hash === b.hash) zip(a, b, take, p);
      else take(a, b);
    }
    drain(queue, p, take);
  }
  return p;
}

function group(l: El[]): Map<string, El[]> {
  const m = new Map<string, El[]>();
  for (const e of l) {
    const g = m.get(e.tag);
    if (g) g.push(e);
    else m.set(e.tag, [e]);
  }
  return m;
}

/** Identical subtrees: pair them and their descendants positionally. */
function zip(a: El, b: El, take: (a: El, b: El) => void, p: Pairing): void {
  if (!p.has(a, 'a') && !p.has(b, 'b')) take(a, b);
  if (a.kids.length !== b.kids.length) return;
  for (let i = 0; i < a.kids.length; i++) zip(a.kids[i] as El, b.kids[i] as El, take, p);
}

function drain(queue: Array<[El, El]>, p: Pairing, take: (a: El, b: El) => void): void {
  const ids = new Map<El, number>();
  const idOf = (e: El): number => {
    let v = ids.get(e);
    if (v === undefined) {
      v = ids.size;
      ids.set(e, v);
    }
    return v;
  };
  const tier =
    (key: (e: El) => string) =>
    (e: El, side: 'a' | 'b'): string => {
      const partner = side === 'a' ? p.a2b.get(e) : p.b2a.get(e);
      if (partner) return `M${idOf(side === 'a' ? partner : e)}`;
      return `U${key(e)}`;
    };
  for (let qi = 0; qi < queue.length; qi++) {
    const [pa, pb] = queue[qi] as [El, El];
    const ua = pa.kids.filter((k) => !p.has(k, 'a'));
    const ub = pb.kids.filter((k) => !p.has(k, 'b'));
    if (!ua.length || !ub.length) continue;
    for (const [a, b] of lcsPairs(pa.kids, pb.kids, tier(hashKey))) take(a, b);
    for (const [a, b] of lcsPairs(pa.kids, pb.kids, tier(keyOf))) take(a, b);
    const ra = ua.filter((k) => !p.has(k, 'a'));
    const rb = ub.filter((k) => !p.has(k, 'b'));
    for (const [a, b] of mutualBest(ra, rb, IN_PARENT_MIN, 0)) take(a, b);
  }
  queue.length = 0;
}
