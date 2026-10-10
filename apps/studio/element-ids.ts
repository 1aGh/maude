// element-ids.ts — stable element ids and canvas-only metadata (Maude v2, V2-2.19).
// Contract: apps/studio/client/v2/contracts/V2-1.4-element-ids.md.
//
// The stable id of a canvas element is an AUTHORED string literal `data-cd-id="<id>"` in the TSX:
// readable, unique per file, never 8 hex (so it can never collide with the pipeline's computed,
// positional id, which stays a transient handle only). Ids are stamped lazily — on the first
// durable reference or a studio write to the element — never eagerly and never from the file
// watcher. Canvas-only metadata is the rest of the `data-cd-*` namespace on the same element
// (`data-cd-locked`, `data-cd-hidden`); exporters strip the whole prefix.
//
// LEAF MODULE: imports only `oxc-parser` and `magic-string`, so the `maude design check` helper
// (runtime-spawned, staged by apps/desktop/scripts/helper-deps.mjs) can load it without the
// studio. Everything here is synchronous and pure.

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

// biome-ignore lint/suspicious/noExplicitAny: oxc-parser AST nodes are heterogeneous.
type AnyNode = any;

// ── §5.1 types ────────────────────────────────────────────────────────────────────────────

/** Authored element id: `ELEMENT_ID_RE`, ≤ 48 chars, never exactly 8 hex, unique per file. */
export type ElementId = string;

/** A durable pointer at a canvas element. Never holds a computed (8-hex) id. */
export interface ElementRef {
  /** Repo-relative canvas path. */
  canvas: string;
  /** DCArtboard id. */
  artboard: string;
  element: ElementId;
  /** Index among same-id DOM nodes in that artboard (`.map()` rows). */
  occurrence?: number;
}

/** Structurally canvas-edit.ts `ElementPrint` (kept local so this module stays a leaf). */
export interface ElementPrintShape {
  component: string;
  tag: string;
  chain: string[];
  attrs: string;
  text?: string;
}

/** What a durable store keeps when the element is not stamped yet (queued stamp). */
export interface PendingElementRef {
  canvas: string;
  artboard: string;
  print: ElementPrintShape;
  /** Computed id at capture time — a hint, never the key. */
  hint: string;
  occurrence?: number;
}

/** Canvas-only metadata, read from the element's attributes. */
export interface CanvasOnly {
  /** `data-cd-locked` present. */
  locked: boolean;
  /** `data-cd-hidden` value; null when not hidden by the eye. */
  hiddenPrevDisplay: string | null;
}

// ── format ────────────────────────────────────────────────────────────────────────────────

export const ELEMENT_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const ELEMENT_ID_MAX = 48;
/** The pipeline's computed id shape (canvas-pipeline.ts `computeId`). */
export const COMPUTED_ID_RE = /^[0-9a-f]{8}$/;
/** Every attribute with this prefix is canvas-only: never printed, never exported. */
export const CANVAS_ONLY_PREFIX = 'data-cd-';

export function isValidElementId(id: unknown): id is ElementId {
  return (
    typeof id === 'string' &&
    id.length <= ELEMENT_ID_MAX &&
    ELEMENT_ID_RE.test(id) &&
    !COMPUTED_ID_RE.test(id)
  );
}

// ── the walker ────────────────────────────────────────────────────────────────────────────

export interface Span {
  start: number;
  end: number;
}

/** One JSX element of a canvas, as the id rules see it. Pre-order, like every canvas walker. */
export interface IdElement {
  i: number;
  tag: string;
  /** Enclosing PascalCase component ('' at module level). */
  component: string;
  /** Enclosing DCArtboard id (the artboard's own element included), or null. */
  artboard: string | null;
  parent: number;
  kids: number[];
  start: number;
  end: number;
  /** Offset right after the tag name — where an attribute is inserted. */
  nameEnd: number;
  /** 1-based. */
  line: number;
  /** 1-based. */
  col: number;
  /** The literal `data-cd-id` value ('' for an empty literal); null when absent or an expression. */
  id: string | null;
  idKind: 'literal' | 'expression' | null;
  idAttr: Span | null;
  locked: boolean;
  lockAttr: Span | null;
  hiddenPrevDisplay: string | null;
  /** Own JSXText, whitespace collapsed, ≤ 80 chars (canvas-edit `ownText`). */
  text: string;
  className: string;
  dcElement: string | null;
  /** Literal attributes in print form, minus `data-cd-*`, `style`, `key` (canvas-edit `literalAttrs`). */
  attrs: Array<[string, string]>;
  /** Other `data-cd-*` attributes (not id / locked), name → raw source of the value. */
  cd: Array<[string, string]>;
  /** A few accessibility labels, for messages. */
  aria: string | null;
  /** Ancestor tags, outermost first. */
  chain: string[];
}

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

function tagName(n: AnyNode): string {
  if (!n) return '?';
  if (n.type === 'JSXIdentifier') return String(n.name);
  if (n.type === 'JSXMemberExpression') return `${tagName(n.object)}.${tagName(n.property)}`;
  if (n.type === 'JSXNamespacedName') return `${n.namespace?.name}:${n.name?.name}`;
  return '?';
}

function litValue(v: AnyNode): string | null {
  if (v?.type === 'Literal' || v?.type === 'StringLiteral') return String(v.value);
  if (
    v?.type === 'JSXExpressionContainer' &&
    (v.expression?.type === 'Literal' || v.expression?.type === 'StringLiteral')
  )
    return String(v.expression.value);
  return null;
}

function lineStarts(source: string): number[] {
  const out = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}
function lineCol(starts: number[], at: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= at) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: at - (starts[lo] as number) + 1 };
}

export type WalkResult = { ok: true; elements: IdElement[] } | { ok: false; error: string };

/** Parse `source` and list its JSX elements. Never throws. */
export function walkIdElements(source: string, path = 'canvas.tsx'): WalkResult {
  let parsed: AnyNode;
  try {
    parsed = parseSync(path.endsWith('.tsx') ? path : `${path}.tsx`, source, {
      sourceType: 'module',
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (parsed.errors?.length) {
    const e = parsed.errors[0];
    return { ok: false, error: String(e?.message ?? 'parse error') };
  }
  const starts = lineStarts(source);
  const out: IdElement[] = [];
  const comps: string[] = [''];
  const stack: number[] = [];
  const abStack: (string | null)[] = [null];

  function element(node: AnyNode): IdElement {
    const opening = node.openingElement;
    const tag = tagName(opening?.name);
    const parent = stack.length ? (stack[stack.length - 1] as number) : -1;
    let id: string | null = null;
    let idKind: IdElement['idKind'] = null;
    let idAttr: Span | null = null;
    let lockAttr: Span | null = null;
    let hidden: string | null = null;
    let className = '';
    let dcElement: string | null = null;
    let aria: string | null = null;
    let abId: string | null = null;
    const attrs: Array<[string, string]> = [];
    const cd: Array<[string, string]> = [];
    for (const a of Array.isArray(opening?.attributes) ? opening.attributes : []) {
      if (a?.type !== 'JSXAttribute') continue;
      const name = a.name?.type === 'JSXIdentifier' ? String(a.name.name) : tagName(a.name);
      const v = a.value;
      const lit = litValue(v);
      if (name === 'data-cd-id') {
        idAttr = { start: a.start, end: a.end };
        if (v?.type === 'Literal' && typeof v.value === 'string') {
          id = v.value;
          idKind = 'literal';
        } else idKind = 'expression';
        continue;
      }
      if (name === 'data-cd-locked') {
        lockAttr = { start: a.start, end: a.end };
        continue;
      }
      if (name.startsWith(CANVAS_ONLY_PREFIX)) {
        if (name === 'data-cd-hidden') hidden = lit ?? '';
        cd.push([name, v ? source.slice(v.start, v.end) : 'true']);
        continue;
      }
      if (name === 'className') className = lit ?? '';
      if (name === 'data-dc-element' && lit) dcElement = lit;
      if (name === 'id' && tag === 'DCArtboard' && lit) abId = lit;
      if (!aria && lit && (name === 'aria-label' || name === 'alt' || name === 'placeholder'))
        aria = lit;
      if (name === 'style' || name === 'key') continue;
      attrs.push([name, lit ?? (v === null || v === undefined ? 'true' : '{expr}')]);
    }
    let text = '';
    for (const c of Array.isArray(node.children) ? node.children : [])
      if (c?.type === 'JSXText') text += String(c.value);
    text = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    const at = lineCol(starts, node.start);
    const artboard = tag === 'DCArtboard' ? abId : (abStack[abStack.length - 1] ?? null);
    return {
      i: out.length,
      tag,
      component: comps[comps.length - 1] as string,
      artboard,
      parent,
      kids: [],
      start: node.start,
      end: node.end,
      nameEnd: opening?.name?.end ?? node.start + 1 + tag.length,
      line: at.line,
      col: at.col,
      id,
      idKind,
      idAttr,
      locked: lockAttr !== null,
      lockAttr,
      hiddenPrevDisplay: hidden,
      text,
      className,
      dcElement,
      attrs: attrs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)),
      cd,
      aria,
      chain: stack.map((k) => (out[k] as IdElement).tag),
    };
  }

  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    const comp = componentNameOf(node);
    if (comp !== null) comps.push(comp);
    if (node.type === 'JSXElement') {
      const el = element(node);
      out.push(el);
      if (el.parent >= 0) (out[el.parent] as IdElement).kids.push(el.i);
      stack.push(el.i);
      const isAb = el.tag === 'DCArtboard';
      if (isAb) abStack.push(el.artboard);
      if (node.openingElement) visit(node.openingElement.attributes);
      visit(node.children);
      if (isAb) abStack.pop();
      stack.pop();
      if (comp !== null) comps.pop();
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
    if (comp !== null) comps.pop();
  }
  visit(parsed.program);
  return { ok: true, elements: out };
}

/** Every literal `data-cd-id` value in the walk. */
export function usedIds(elements: IdElement[]): Set<string> {
  const s = new Set<string>();
  for (const e of elements) if (e.id) s.add(e.id);
  return s;
}

// ── §4.2 / §5.2 the readable id generator ─────────────────────────────────────────────────

/** What the generator reads off an element. */
export interface IdSeed {
  tag: string;
  dcElement?: string | null;
  text?: string;
  className?: string;
}

function slug(t: string): string {
  return t
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const BASE_MAX = 40; // leaves room for a `-NNN` suffix under ELEMENT_ID_MAX

/**
 * A readable id for `el`, unique against `used` (contract §4.2): its `data-dc-element` → its own
 * text (first three words, accents removed) → its first class → its tag, plus `-2`, `-3` … on a
 * collision. Never exactly 8 hex. Deterministic. Adds the id it returns to `used`, so a batch of
 * calls never hands one id out twice. `used` must hold every id in the file AND every id a
 * durable reference still holds (detached ones included).
 */
export function generateElementId(el: IdSeed, used: Set<string>): ElementId {
  const tagSlug = slug(el.tag.replace(/([a-z0-9])([A-Z])/g, '$1-$2'));
  let base = el.dcElement ? slug(el.dcElement) : '';
  if (!base && el.text) base = slug(el.text.trim().split(/\s+/).slice(0, 3).join(' '));
  if (!base && el.className) base = slug(el.className.trim().split(/\s+/)[0] ?? '');
  if (!base) base = tagSlug;
  if (!/^[a-z]/.test(base)) base = base ? `${tagSlug || 'el'}-${base}` : tagSlug || 'el';
  if (!/^[a-z]/.test(base)) base = `el-${base}`;
  base = base.slice(0, BASE_MAX).replace(/-+$/, '');
  if (COMPUTED_ID_RE.test(base)) base = `${base}-el`;
  let id = base;
  for (let k = 2; used.has(id) || !isValidElementId(id); k++) id = `${base}-${k}`;
  used.add(id);
  return id;
}

/** The generator seed of a walked element. */
export function seedOf(e: IdElement): IdSeed {
  return { tag: e.tag, dcElement: e.dcElement, text: e.text, className: e.className };
}

// ── source helpers for writers ────────────────────────────────────────────────────────────

/**
 * The span to remove for attribute `a`: the attribute plus the whitespace before it, so
 * `<div data-cd-id="x" className>` → `<div className>` and a one-attribute-per-line layout loses
 * the whole line.
 */
export function attrRemovalSpan(source: string, a: Span): Span {
  let s = a.start;
  while (s > 0 && /\s/.test(source[s - 1] as string)) s--;
  return { start: s, end: a.end };
}

/**
 * The source text of the element range [start, end) with every `data-cd-id` and
 * `data-cd-locked` inside it removed — the body of a copy (duplicate / paste): a copy always gets
 * new ids and starts unlocked (contract §4.3, DDR-246 rule for copies).
 */
export function copyWithoutIds(
  source: string,
  elements: IdElement[],
  start: number,
  end: number
): string {
  const spans: Span[] = [];
  for (const e of elements) {
    if (e.start < start || e.end > end) continue;
    if (e.idAttr) spans.push(attrRemovalSpan(source, e.idAttr));
    if (e.lockAttr) spans.push(attrRemovalSpan(source, e.lockAttr));
  }
  spans.sort((x, y) => x.start - y.start);
  let out = '';
  let at = start;
  for (const sp of spans) {
    if (sp.start < at) continue;
    out += source.slice(at, sp.start);
    at = sp.end;
  }
  return out + source.slice(at, end);
}

/** ` data-cd-id="<id>"` inserted right after the tag name of a JSX snippet that starts with `<Tag`. */
export function withIdAttr(jsx: string, id: ElementId): string {
  const m = /^<[A-Za-z][\w.:-]*/.exec(jsx);
  if (!m) return jsx;
  return `${jsx.slice(0, m[0].length)} data-cd-id="${id}"${jsx.slice(m[0].length)}`;
}

/** Insert `data-cd-id="<id>"` on every element in `stamps` (offsets from one walk of `source`). */
export function insertIds(
  source: string,
  stamps: Array<{ nameEnd: number; id: ElementId }>
): string {
  if (!stamps.length) return source;
  const s = new MagicString(source);
  for (const st of stamps) s.appendLeft(st.nameEnd, ` data-cd-id="${st.id}"`);
  return s.toString();
}
