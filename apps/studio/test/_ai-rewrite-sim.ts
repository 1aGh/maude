// V2-2.19 — the AI-rewrite simulator of contract V2-1.4 §6 (the spike's `ids.ts` mutations, ported).
//
// Ground truth: every JSX element gets `data-cd-gt="gN"`. Every id walker and print ignores
// `data-cd-*` attributes other than `data-cd-id`, so the tag never changes an id, a print or a
// re-attach score. One artboard per trial is rewritten the way an AI that keeps the attributes of
// the elements it keeps would rewrite it. Recipes:
//   small:   1 insert + 5 % restyle
//   typical: 2 inserts, 1 wrap, 1 delete, 1 swap, 20 % restyle, 10 % text
//   heavy:   5 inserts, 3 wraps, 3 deletes, 3 swaps, 60 % restyle, 40 % text
// The rewrite honours the lock rule: it never touches an element that carries `data-cd-locked`,
// and never wraps or deletes one of its ancestors.
//
// This walker is deliberately independent of `element-ids.ts`, so the test does not grade the
// module under test with its own ruler.

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

// biome-ignore lint/suspicious/noExplicitAny: oxc-parser AST nodes are heterogeneous.
type AnyNode = any;

export interface Rng {
  next(): number;
  seed: number;
}

/** The spike's xorshift, so the same seed walks the same choices. */
export function makeRng(seed = 0x9e3779b9): Rng {
  const r: Rng = {
    seed,
    next() {
      r.seed ^= r.seed << 13;
      r.seed ^= r.seed >>> 17;
      r.seed ^= r.seed << 5;
      return ((r.seed >>> 0) % 1_000_000) / 1_000_000;
    },
  };
  return r;
}
const pick = <T>(rng: Rng, a: T[]): T => a[Math.floor(rng.next() * a.length)] as T;

const PASCAL = /^[A-Z][A-Za-z0-9_]*$/;
function componentNameOf(node: AnyNode): string | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'FunctionDeclaration' && PASCAL.test(node.id?.name ?? '')) return node.id.name;
  if (node.type === 'VariableDeclarator' && PASCAL.test(node.id?.name ?? '')) {
    const init = node.init;
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression'))
      return node.id.name;
  }
  if (node.type === 'FunctionExpression' && PASCAL.test(node.id?.name ?? '')) return node.id.name;
  return null;
}
function tagOf(node: AnyNode): string {
  const n = node.openingElement?.name;
  if (!n) return '?';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${n.object?.name ?? '?'}.${n.property?.name ?? '?'}`;
  return '?';
}
function attrNode(opening: AnyNode, name: string): AnyNode | null {
  for (const a of opening?.attributes ?? [])
    if (a?.type === 'JSXAttribute' && a.name?.name === name) return a;
  return null;
}
function strAttr(opening: AnyNode, name: string): string | null {
  const a = attrNode(opening, name);
  if (!a) return null;
  return a.value?.type === 'Literal' && typeof a.value.value === 'string' ? a.value.value : '';
}

export interface SimEl {
  i: number;
  node: AnyNode;
  tag: string;
  comp: string;
  parent: number;
  kids: number[];
  directChild: boolean;
  artboard: string | null;
  gt: string | null;
  cdId: string | null;
  locked: boolean;
  start: number;
  end: number;
}

export function simWalk(file: string, src: string): SimEl[] | null {
  const parsed = parseSync(file, src, { sourceType: 'module' });
  if (parsed.errors?.length) return null;
  const out: SimEl[] = [];
  const comps: string[] = [''];
  const stack: number[] = [];
  const abStack: (string | null)[] = [null];
  function visit(node: AnyNode, inChildren: boolean): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c, inChildren);
      return;
    }
    if (typeof node.type !== 'string') return;
    const comp = componentNameOf(node);
    if (comp !== null) comps.push(comp);
    if (node.type === 'JSXElement') {
      const parent = stack.length ? (stack[stack.length - 1] as number) : -1;
      const tag = tagOf(node);
      const isAb = tag === 'DCArtboard';
      const ab = isAb ? strAttr(node.openingElement, 'id') : abStack[abStack.length - 1];
      const el: SimEl = {
        i: out.length,
        node,
        tag,
        comp: comps[comps.length - 1] as string,
        parent,
        kids: [],
        directChild: inChildren,
        artboard: ab ?? null,
        gt: strAttr(node.openingElement, 'data-cd-gt'),
        cdId: strAttr(node.openingElement, 'data-cd-id') || null,
        locked: attrNode(node.openingElement, 'data-cd-locked') !== null,
        start: node.start,
        end: node.end,
      };
      out.push(el);
      if (parent >= 0) (out[parent] as SimEl).kids.push(el.i);
      stack.push(el.i);
      if (isAb) abStack.push(ab ?? null);
      visit(node.openingElement?.attributes, false);
      visit(node.children, true);
      if (isAb) abStack.pop();
      stack.pop();
      if (comp !== null) comps.pop();
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k], false);
    }
    if (comp !== null) comps.pop();
  }
  visit(parsed.program, false);
  return out;
}

/** Insert ` attr="value"` after the tag name of every element `val` names a value for. */
export function tagAll(
  file: string,
  src: string,
  attr: string,
  val: (e: SimEl) => string | null
): string {
  const els = simWalk(file, src);
  if (!els) return src;
  const s = new MagicString(src);
  for (const e of els) {
    const v = val(e);
    if (v === null) continue;
    const end = e.node.openingElement?.name?.end;
    if (typeof end === 'number') s.appendLeft(end, ` ${attr}="${v}"`);
  }
  return s.toString();
}

/** Ground-truth tags `g0…gN` on every element. */
export function tagGroundTruth(file: string, src: string): string {
  let g = 0;
  return tagAll(file, src, 'data-cd-gt', () => `g${g++}`);
}

function hasLockedInside(els: SimEl[], e: SimEl): boolean {
  if (e.locked) return true;
  return e.kids.some((k) => hasLockedInside(els, els[k] as SimEl));
}
function inArtboard(els: SimEl[], ab: string): SimEl[] {
  return els.filter((e) => e.artboard === ab && e.tag !== 'DCArtboard');
}
function movable(els: SimEl[], ab: string): SimEl[] {
  return inArtboard(els, ab).filter((e) => e.directChild && e.parent >= 0);
}

function mInsert(rng: Rng, file: string, src: string, ab: string): string | null {
  const els = simWalk(file, src);
  const c = els ? movable(els, ab) : [];
  if (!c.length) return null;
  const e = pick(rng, c);
  const s = new MagicString(src);
  s.appendLeft(e.start, '<div className="ai-new">New block</div>');
  return s.toString();
}
function mWrap(rng: Rng, file: string, src: string, ab: string): string | null {
  const els = simWalk(file, src);
  const c = els ? movable(els, ab).filter((e) => !hasLockedInside(els, e)) : [];
  if (!c.length) return null;
  const e = pick(rng, c);
  const s = new MagicString(src);
  s.appendLeft(e.start, '<div className="ai-wrap">');
  s.appendRight(e.end, '</div>');
  return s.toString();
}
function mDelete(rng: Rng, file: string, src: string, ab: string): string | null {
  const els = simWalk(file, src);
  const c = els ? movable(els, ab).filter((e) => !hasLockedInside(els, e)) : [];
  if (!c.length) return null;
  const e = pick(rng, c);
  const s = new MagicString(src);
  s.remove(e.start, e.end);
  return s.toString();
}
function mSwap(rng: Rng, file: string, src: string, ab: string): string | null {
  const els = simWalk(file, src);
  if (!els) return null;
  const pairs: [SimEl, SimEl][] = [];
  for (const e of movable(els, ab)) {
    if (e.locked) continue;
    const sib = (els[e.parent] as SimEl).kids.map((k) => els[k] as SimEl).filter((x) => x.directChild);
    const nx = sib[sib.indexOf(e) + 1];
    if (nx && !nx.locked) pairs.push([e, nx]);
  }
  if (!pairs.length) return null;
  const [a, b] = pick(rng, pairs);
  const s = new MagicString(src);
  const ta = src.slice(a.start, a.end);
  const tb = src.slice(b.start, b.end);
  s.overwrite(a.start, a.end, tb);
  s.overwrite(b.start, b.end, ta);
  return s.toString();
}
function mRestyle(rng: Rng, file: string, src: string, ab: string, frac: number): string | null {
  const els = simWalk(file, src);
  if (!els) return null;
  const s = new MagicString(src);
  let n = 0;
  for (const e of inArtboard(els, ab)) {
    if (rng.next() >= frac || e.locked) continue;
    const a = attrNode(e.node.openingElement, 'className');
    if (a?.value?.type === 'Literal') {
      s.overwrite(a.value.start, a.value.end, JSON.stringify(`${a.value.value} ai-x`));
      n++;
    } else if (!a) {
      const end = e.node.openingElement?.name?.end;
      if (typeof end === 'number') {
        s.appendLeft(end, ' className="ai-x"');
        n++;
      }
    }
  }
  return n ? s.toString() : src;
}
function mText(rng: Rng, file: string, src: string, ab: string, frac: number): string | null {
  const els = simWalk(file, src);
  if (!els) return null;
  const s = new MagicString(src);
  for (const e of inArtboard(els, ab)) {
    if (rng.next() >= frac || e.locked) continue;
    const t = (e.node.children ?? []).find(
      (c: AnyNode) => c?.type === 'JSXText' && String(c.value).trim()
    );
    if (!t) continue;
    const raw = String(src.slice(t.start, t.end));
    const lead = raw.match(/^\s*/)?.[0] ?? '';
    const trail = raw.match(/\s*$/)?.[0] ?? '';
    s.overwrite(t.start, t.end, `${lead}${raw.trim()} now${trail}`);
  }
  return s.toString();
}

export interface Recipe {
  name: 'small' | 'typical' | 'heavy';
  ops: Array<[string, number]>;
}
export const RECIPES: Recipe[] = [
  {
    name: 'small',
    ops: [
      ['insert', 1],
      ['restyle', 0.05],
    ],
  },
  {
    name: 'typical',
    ops: [
      ['insert', 2],
      ['wrap', 1],
      ['delete', 1],
      ['swap', 1],
      ['restyle', 0.2],
      ['text', 0.1],
    ],
  },
  {
    name: 'heavy',
    ops: [
      ['insert', 5],
      ['wrap', 3],
      ['delete', 3],
      ['swap', 3],
      ['restyle', 0.6],
      ['text', 0.4],
    ],
  },
];

/** Rewrite one artboard by `recipe`. Keeps every attribute of every element it keeps. */
export function applyRecipe(rng: Rng, file: string, src: string, ab: string, r: Recipe): string {
  let cur = src;
  for (const [op, k] of r.ops) {
    const reps = op === 'restyle' || op === 'text' ? 1 : k;
    for (let i = 0; i < reps; i++) {
      let next: string | null = null;
      if (op === 'insert') next = mInsert(rng, file, cur, ab);
      else if (op === 'wrap') next = mWrap(rng, file, cur, ab);
      else if (op === 'delete') next = mDelete(rng, file, cur, ab);
      else if (op === 'swap') next = mSwap(rng, file, cur, ab);
      else if (op === 'restyle') next = mRestyle(rng, file, cur, ab, k);
      else if (op === 'text') next = mText(rng, file, cur, ab, k);
      if (next && simWalk(file, next)) cur = next;
    }
  }
  return cur;
}

/**
 * The AI forgets ids: drop each `data-cd-id` of an (unlocked) element in artboard `ab` with
 * probability `p`. Returns the new source and the ground-truth tags whose id was dropped.
 */
export function dropIds(
  rng: Rng,
  file: string,
  src: string,
  ab: string,
  p: number
): { source: string; droppedGt: Set<string> } {
  const els = simWalk(file, src) ?? [];
  const s = new MagicString(src);
  const droppedGt = new Set<string>();
  for (const e of els) {
    if (e.artboard !== ab || !e.cdId || e.tag === 'DCArtboard' || e.locked) continue;
    if (rng.next() < p) {
      const a = attrNode(e.node.openingElement, 'data-cd-id');
      if (a) {
        s.remove(a.start - 1, a.end);
        if (e.gt) droppedGt.add(e.gt);
      }
    }
  }
  return { source: s.toString(), droppedGt };
}

/** Ground-truth tag → authored id, for every element that carries both. */
export function idsByGt(file: string, src: string): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const e of simWalk(file, src) ?? []) if (e.gt) m.set(e.gt, e.cdId);
  return m;
}

/** Artboard ids of the canvas, in source order. */
export function artboardsOf(file: string, src: string): string[] {
  return (simWalk(file, src) ?? [])
    .filter((e) => e.tag === 'DCArtboard' && e.artboard)
    .map((e) => e.artboard as string);
}
