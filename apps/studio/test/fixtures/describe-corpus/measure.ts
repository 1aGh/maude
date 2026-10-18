// The measuring half of V2-1.9's evidence (§6, corpus C3): ONE known edit at a time on real canvases,
// with exact ground truth, graded against `describeChanges`. Seeded and deterministic.
//
// Used by `test/describe-tsx.test.ts` (small N, asserts the thresholds) and `test/describe-corpus.bench.ts`
// (large N, prints the table for the hand-back). The prototype that produced the §6 numbers was never
// committed; this is its rebuild from §5.5 + §6.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { type Change, describeChanges } from '../../../history/describe';
import { propLabel } from '../../../history/describe-words';

// biome-ignore lint/suspicious/noExplicitAny: oxc-parser AST nodes are heterogeneous.
type AnyNode = any;

export type EditKind =
  | 'style'
  | 'text'
  | 'attr'
  | 'insert'
  | 'delete'
  | 'wrap'
  | 'reorder'
  | 'resize'
  | 'shared';

export const EDIT_KINDS: EditKind[] = [
  'style',
  'text',
  'attr',
  'insert',
  'delete',
  'wrap',
  'reorder',
  'resize',
  'shared',
];

export interface Edit {
  kind: EditKind;
  canvas: string;
  after: string;
  /** The artboard(s) the edit lives in (exact); for `shared`, the declaration's reach. */
  artboards: string[];
  /** Property / attribute the edit touched, when the words must name it. */
  prop?: string;
  /** Text the words should contain (the new value or its changed words). */
  needle?: string;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

interface Site {
  node: AnyNode;
  parent: AnyNode;
  /** Enclosing artboard id (null = outside every artboard). */
  ab: string | null;
  depth: number;
}

function collect(program: AnyNode): { sites: Site[]; artboards: Map<string, AnyNode> } {
  const sites: Site[] = [];
  const artboards = new Map<string, AnyNode>();
  let idless = 0;
  const walk = (n: AnyNode, parent: AnyNode, ab: string | null, depth: number): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c, parent, ab, depth);
      return;
    }
    if (typeof n.type !== 'string') return;
    let nextAb = ab;
    let nextDepth = depth;
    if (n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'DCArtboard') {
      const id = abIdOf(n) ?? `#${idless++}`;
      nextAb = id;
      nextDepth = 0;
      artboards.set(id, n);
    } else if (n.type === 'JSXElement') nextDepth = depth + 1;
    sites.push({ node: n, parent, ab: nextAb, depth: nextDepth });
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      walk(n[k], n, nextAb, nextDepth);
    }
  };
  walk(program, null, null, 0);
  return { sites, artboards };
}

const splice = (src: string, from: number, to: number, text: string): string =>
  src.slice(0, from) + text + src.slice(to);

function mutateNumber(rng: () => number, n: number): number {
  const d = 1 + Math.floor(rng() * 20);
  const out = rng() < 0.5 ? n + d : Math.max(0, n - d);
  return out === n ? n + 1 : out;
}

function mutateHex(rng: () => number, hex: string): string {
  const h = hex.slice(1);
  const i = Math.floor(rng() * h.length);
  const digits = '0123456789abcdef';
  let c = digits[Math.floor(rng() * 16)] as string;
  if (c === h[i]?.toLowerCase()) c = digits[(digits.indexOf(c) + 5) % 16] as string;
  return `#${h.slice(0, i)}${c}${h.slice(i + 1)}`;
}

function isJsxChildOf(parent: AnyNode): boolean {
  return parent?.type === 'JSXElement' || parent?.type === 'JSXFragment';
}

/** Names → the declaration nodes a source defines at module level. */
function declsOf(program: AnyNode): Array<{ names: string[]; node: AnyNode }> {
  const out: Array<{ names: string[]; node: AnyNode }> = [];
  for (const s of program.body ?? []) {
    let d = s;
    if (d.type === 'ExportNamedDeclaration' || d.type === 'ExportDefaultDeclaration')
      d = d.declaration;
    if (!d) continue;
    const names: string[] = [];
    if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id)
      names.push(d.id.name);
    if (d.type === 'VariableDeclaration')
      for (const x of d.declarations) if (x.id?.type === 'Identifier') names.push(x.id.name);
    if (names.length) out.push({ names, node: s });
  }
  return out;
}

/** Every identifier / JSX tag head a subtree names (property keys and attribute names excluded). */
function identsOf(
  n: AnyNode,
  out = new Set<string>(),
  parent: AnyNode = null,
  key = '',
  skipAb = false
): Set<string> {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) {
    for (const c of n) identsOf(c, out, parent, key, skipAb);
    return out;
  }
  if (typeof n.type !== 'string') return out;
  if (skipAb && n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'DCArtboard')
    return out;
  if (n.type === 'Identifier') {
    const isKey =
      (parent?.type === 'Property' && key === 'key' && !parent.computed) ||
      (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed);
    if (!isKey) out.add(n.name);
    return out;
  }
  if (n.type === 'JSXIdentifier') {
    if (/^[A-Z]/.test(n.name) && parent?.type !== 'JSXAttribute') out.add(n.name);
    return out;
  }
  if (n.type === 'JSXMemberExpression') {
    let o = n;
    while (o.type === 'JSXMemberExpression') o = o.object;
    out.add(o.name);
    return out;
  }
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    identsOf(n[k], out, n, k, skipAb);
  }
  return out;
}

/** Identifiers the canvas frame (the canvas function's non-declaration statements, minus artboards) names. */
function frameIdents(program: AnyNode): Set<string> {
  const out = new Set<string>();
  const hasAb = (n: AnyNode): boolean => {
    if (!n || typeof n !== 'object') return false;
    if (Array.isArray(n)) return n.some(hasAb);
    if (n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'DCArtboard') return true;
    return Object.keys(n).some((k) => k !== 'type' && hasAb(n[k]));
  };
  for (const s of program.body ?? []) {
    if (!hasAb(s)) continue;
    let d = s;
    if (d.type === 'ExportNamedDeclaration' || d.type === 'ExportDefaultDeclaration')
      d = d.declaration;
    if (d?.type === 'VariableDeclaration') d = d.declarations?.[0]?.init;
    const body = d?.body;
    if (body?.type === 'BlockStatement') {
      for (const b of body.body) {
        if (!hasAb(b)) continue;
        identsOf(b, out, null, '', true);
      }
    } else identsOf(body ?? d, out, null, '', true);
  }
  return out;
}

/** Independent ground truth for `shared`: artboards that name the declaration, through other declarations. */
function sharedReach(
  program: AnyNode,
  decls: Array<{ names: string[]; node: AnyNode }>,
  artboards: Map<string, AnyNode>,
  target: { names: string[]; node: AnyNode }
): string[] {
  const idents = new Map(decls.map((d) => [d, identsOf(d.node)] as const));
  const reaching = new Set<string>(target.names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of decls) {
      if (d.names.every((n) => reaching.has(n))) continue;
      const ids = idents.get(d) as Set<string>;
      if ([...reaching].some((r) => ids.has(r))) {
        for (const n of d.names) reaching.add(n);
        grew = true;
      }
    }
  }
  const out: string[] = [];
  // what the canvas frame renders (everything outside the artboards) reaches every artboard
  const frame = frameIdents(program);
  const frameHit = [...reaching].some((r) => frame.has(r));
  for (const [id, node] of artboards) {
    const ids = identsOf(node);
    if (frameHit || [...reaching].some((r) => ids.has(r))) out.push(id);
  }
  return out;
}

export function genEdits(
  canvas: string,
  source: string,
  rng: () => number,
  perKind: number
): Edit[] {
  let parsed: AnyNode;
  try {
    parsed = parseSync('c.tsx', source, { sourceType: 'module' });
  } catch {
    return [];
  }
  if (parsed.errors?.length) return [];
  const program = parsed.program;
  const { sites, artboards } = collect(program);
  if (!artboards.size) return [];
  const inAb = sites.filter((s) => s.ab && s.depth >= 1);
  const edits: Edit[] = [];
  const add = (e: Omit<Edit, 'canvas'>): void => {
    if (e.after === source) return;
    try {
      const r: AnyNode = parseSync('c.tsx', e.after, { sourceType: 'module' });
      if (r.errors?.length) return;
    } catch {
      return;
    }
    edits.push({ canvas, ...e });
  };
  const tryN = (cands: Site[], fn: (s: Site) => void): void => {
    const pool = [...cands];
    let made = edits.length;
    const want = made + perKind;
    let guard = 0;
    while (edits.length < want && pool.length && guard++ < perKind * 6) {
      const i = Math.floor(rng() * pool.length);
      const s = pool.splice(i, 1)[0] as Site;
      fn(s);
      made = edits.length;
    }
  };

  // style value
  const styleProps: Array<Site & { prop: AnyNode }> = [];
  for (const s of inAb) {
    const n = s.node;
    if (n.type !== 'JSXAttribute' || n.name?.name !== 'style') continue;
    const o = n.value?.expression;
    if (o?.type !== 'ObjectExpression') continue;
    for (const p of o.properties) {
      if (p.type !== 'Property' || p.computed || p.key.type !== 'Identifier') continue;
      const v = p.value;
      const isNum = v.type === 'Literal' && typeof v.value === 'number';
      const isHex =
        v.type === 'Literal' && typeof v.value === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.value);
      if ((isNum && !['zIndex', 'fontWeight', 'flex', 'opacity'].includes(p.key.name)) || isHex)
        styleProps.push({ ...s, prop: p });
    }
  }
  tryN(styleProps, (s) => {
    const p = (s as Site & { prop: AnyNode }).prop;
    const v = p.value;
    const next =
      typeof v.value === 'number'
        ? String(mutateNumber(rng, v.value))
        : `'${mutateHex(rng, v.value)}'`;
    add({
      kind: 'style',
      after: splice(source, v.start, v.end, next),
      artboards: [s.ab as string],
      prop: p.key.name,
    });
  });

  // text
  const texts = inAb.filter(
    (s) =>
      s.node.type === 'JSXText' &&
      /[A-Za-z]{3,}/.test(s.node.value) &&
      !/[{}<>&]/.test(s.node.value) &&
      s.parent?.type === 'JSXElement' &&
      !['style', 'script', 'pre', 'code'].includes(jsxName(s.parent.openingElement.name))
  );
  tryN(texts, (s) => {
    const n = s.node;
    const raw: string = n.value;
    const m = /([A-Za-z]{3,})(?![\s\S]*[A-Za-z]{3,})/.exec(raw);
    if (!m) return;
    const next = `${raw.slice(0, m.index)}Zzqx${raw.slice(m.index + (m[1] as string).length)}`;
    add({
      kind: 'text',
      after: splice(source, n.start, n.end, next),
      artboards: [s.ab as string],
      needle: 'Zzqx',
    });
  });

  // attribute
  const attrs = inAb.filter(
    (s) =>
      s.node.type === 'JSXAttribute' &&
      s.node.value?.type === 'Literal' &&
      typeof s.node.value.value === 'string' &&
      s.node.value.value.length > 0 &&
      !['className', 'style', 'key', 'id', 'class'].includes(s.node.name?.name) &&
      !String(s.node.name?.name).startsWith('data-cd-') &&
      jsxName(s.parent?.name ?? null) !== 'DCArtboard'
  );
  tryN(attrs, (s) => {
    const v = s.node.value;
    const q = source[v.start] as string;
    const inner: string = v.value;
    add({
      kind: 'attr',
      after: splice(source, v.start, v.end, `${q}${inner}zq${q}`),
      artboards: [s.ab as string],
      prop: String(s.node.name.name),
    });
  });

  // insert
  const parents = inAb.filter(
    (s) => s.node.type === 'JSXElement' && !s.node.openingElement.selfClosing
  );
  const parentsAll = [
    ...parents,
    ...sites
      .filter(
        (s) =>
          s.node.type === 'JSXElement' &&
          jsxName(s.node.openingElement.name) === 'DCArtboard' &&
          s.ab
      )
      .map((s) => s),
  ].filter((s) => !s.node.openingElement.selfClosing && s.node.closingElement);
  tryN(parentsAll, (s) => {
    const at = s.node.openingElement.end;
    add({
      kind: 'insert',
      after: splice(source, at, at, '<div>Zzqx added</div>'),
      artboards: [s.ab as string],
    });
  });

  // delete / wrap: a direct JSX child element
  const kids = inAb.filter((s) => s.node.type === 'JSXElement' && isJsxChildOf(s.parent));
  tryN(kids, (s) => {
    add({
      kind: 'delete',
      after: splice(source, s.node.start, s.node.end, ''),
      artboards: [s.ab as string],
    });
  });
  tryN(kids, (s) => {
    add({
      kind: 'wrap',
      after: splice(
        source,
        s.node.start,
        s.node.end,
        `<div>${source.slice(s.node.start, s.node.end)}</div>`
      ),
      artboards: [s.ab as string],
    });
  });

  // reorder: swap two adjacent sibling elements (distinct source)
  const swaps: Array<Site & { a: AnyNode; b: AnyNode }> = [];
  for (const s of sites) {
    if (s.node.type !== 'JSXElement' || !s.ab) continue;
    const ch: AnyNode[] = s.node.children ?? [];
    for (let i = 0; i < ch.length - 1; i++) {
      const a = ch[i];
      if (a.type !== 'JSXElement') continue;
      let j = i + 1;
      while (j < ch.length && ch[j].type === 'JSXText' && !String(ch[j].value).trim()) j++;
      const b = ch[j];
      if (b?.type !== 'JSXElement') continue;
      if (source.slice(a.start, a.end) === source.slice(b.start, b.end)) continue;
      swaps.push({ ...s, a, b });
    }
  }
  tryN(swaps, (s) => {
    const { a, b } = s as Site & { a: AnyNode; b: AnyNode };
    const ta = source.slice(a.start, a.end);
    const tb = source.slice(b.start, b.end);
    const after =
      source.slice(0, a.start) + tb + source.slice(a.end, b.start) + ta + source.slice(b.end);
    add({ kind: 'reorder', after, artboards: [s.ab as string] });
  });

  // resize
  const sizes = sites.filter(
    (s) =>
      s.node.type === 'JSXAttribute' &&
      ['width', 'height'].includes(s.node.name?.name) &&
      s.parent?.type === 'JSXOpeningElement' &&
      jsxName(s.parent.name) === 'DCArtboard' &&
      s.node.value?.expression?.type === 'Literal' &&
      typeof s.node.value.expression.value === 'number'
  );
  tryN(sizes, (s) => {
    const e = s.node.value.expression;
    add({
      kind: 'resize',
      after: splice(source, e.start, e.end, String(mutateNumber(rng, e.value))),
      artboards: [s.ab as string],
    });
  });

  // a literal in a shared declaration
  const decls = declsOf(program);
  const sharedLits: Array<{ lit: AnyNode; decl: { names: string[]; node: AnyNode } }> = [];
  for (const d of decls) {
    const stack = [d.node];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object') continue;
      if (Array.isArray(n)) {
        stack.push(...n);
        continue;
      }
      if (typeof n.type === 'string' && n.type.startsWith('TS')) continue;
      if (n.type === 'JSXElement' && jsxName(n.openingElement.name) === 'DCArtboard') continue;
      if (
        n.type === 'Literal' &&
        typeof n.value === 'string' &&
        /^[A-Za-z][A-Za-z ]{3,30}$/.test(n.value) &&
        source[n.start - 1] !== '='
      )
        sharedLits.push({ lit: n, decl: d });
      for (const k of Object.keys(n)) if (k !== 'type') stack.push(n[k]);
    }
  }
  const sharedPool = sharedLits.filter(
    (x) => sharedReach(program, decls, artboards, x.decl).length > 0
  );
  for (let i = 0; i < perKind && sharedPool.length; i++) {
    const x = sharedPool.splice(
      Math.floor(rng() * sharedPool.length),
      1
    )[0] as (typeof sharedPool)[number];
    const q = source[x.lit.start] as string;
    add({
      kind: 'shared',
      after: splice(source, x.lit.start, x.lit.end, `${q}${x.lit.value}zq${q}`),
      artboards: sharedReach(program, decls, artboards, x.decl),
    });
  }
  return edits;
}

// ── grading ─────────────────────────────────────────────────────────────────────────────────

export type Verdict = 'right' | 'wrong-words' | 'wrong-artboard' | 'fallback' | 'nothing';

const KIND_OF: Record<Exclude<EditKind, 'shared'>, Change['kind'][]> = {
  style: ['style'],
  text: ['text'],
  attr: ['attr'],
  insert: ['added'],
  delete: ['removed'],
  wrap: ['wrapped'],
  reorder: ['reordered'],
  resize: ['artboard-resized'],
};

export function grade(e: Edit, changes: Change[]): Verdict {
  if (!changes.length) return 'nothing';
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (e.kind === 'shared') {
    if (changes.some((c) => c.grade === 'F')) return 'fallback';
    const got = new Set(changes.flatMap((c) => c.artboards));
    if (got.size === 0) return 'wrong-artboard';
    if (![...got].every((k) => e.artboards.includes(k)) || e.artboards.some((k) => !got.has(k)))
      return 'wrong-artboard';
    return 'right';
  }
  if (changes.some((c) => c.kind === 'canvas' || c.kind === 'layout')) return 'fallback';
  if (changes.some((c) => !same(c.artboards, e.artboards))) return 'wrong-artboard';
  if (changes.length !== 1) return 'wrong-words';
  const c = changes[0] as Change;
  if (!KIND_OF[e.kind].includes(c.kind)) return 'wrong-words';
  if (e.prop && e.kind === 'style' && !c.words.includes(propLabel(e.prop))) return 'wrong-words';
  if (e.needle && !c.words.includes(e.needle)) return 'wrong-words';
  if (c.grade !== 'W1') return 'wrong-words';
  return 'right';
}

// ── corpus ──────────────────────────────────────────────────────────────────────────────────

export function listCanvases(root: string, v2Only: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === 'system' || name.startsWith('_') || name === 'node_modules') continue;
        if (v2Only && !`${p}/`.includes('/ui/')) continue;
        walk(p);
      } else if (name.endsWith('.tsx') && !name.startsWith('_')) {
        if (v2Only && !p.includes('/ui/v2/')) continue;
        out.push(p);
      }
    }
  };
  walk(root);
  return out.sort();
}

export interface Row {
  n: number;
  right: number;
  wrongWords: number;
  wrongArtboard: number;
  fallback: number;
  nothing: number;
}

export interface Report {
  byKind: Record<string, Row>;
  all: Row;
  ms: number[];
  /** First few failures, for debugging. */
  misses: Array<{ canvas: string; kind: EditKind; verdict: Verdict; words: string[] }>;
}

export function measure(files: string[], perKind: number, seed = 20261018): Report {
  const byKind: Record<string, Row> = {};
  const blank = (): Row => ({
    n: 0,
    right: 0,
    wrongWords: 0,
    wrongArtboard: 0,
    fallback: 0,
    nothing: 0,
  });
  const all = blank();
  const ms: number[] = [];
  const misses: Report['misses'] = [];
  for (const f of files) {
    const source = readFileSync(f, 'utf8');
    const rng = mulberry32(seed ^ f.length);
    for (const e of genEdits(f, source, rng, perKind)) {
      const r = describeChanges(f, { tsx: source }, { tsx: e.after });
      ms.push(r.ms);
      const v = grade(e, r.changes);
      let kindRow = byKind[e.kind];
      if (!kindRow) {
        kindRow = blank();
        byKind[e.kind] = kindRow;
      }
      for (const row of [kindRow, all]) {
        row.n++;
        if (v === 'right') row.right++;
        else if (v === 'wrong-words') row.wrongWords++;
        else if (v === 'wrong-artboard') row.wrongArtboard++;
        else if (v === 'fallback') row.fallback++;
        else row.nothing++;
      }
      if (v !== 'right' && misses.length < 400)
        misses.push({
          canvas: f,
          kind: e.kind,
          verdict: v,
          words: r.changes.map((c) => c.words).slice(0, 4),
        });
    }
  }
  return { byKind, all, ms, misses };
}

export function percentile(l: number[], p: number): number {
  if (!l.length) return 0;
  const s = [...l].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
}
