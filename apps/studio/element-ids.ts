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

// ── §5.4 re-attach (the `safe` matcher) ───────────────────────────────────────────────────
//
// Anchors: elements whose id exists on both sides. Candidates: for each new element WITHOUT a
// `data-cd-id`, the old elements whose id is missing, with the same tag, component and artboard.
// Score: same own text +3 (word overlap ≥ 0.5: +2) · same class list +3 (overlap ≥ 0.5: +2) · each
// equal literal attribute +1 (max 3) · parent is the anchor of the old parent +2 · each child
// anchored under the old element +2 (max 4). Accept only a MUTUAL best pair with score ≥ 5 and a
// margin ≥ 2 over the runner-up on both sides; repeat (new matches become anchors). Everything
// else gets no old id — a new element (an insert, a new wrapper) must never inherit one.
// Measured on the corpus simulation of V2-1.4 §6: 0 wrong attachments in 4,800+ dropped ids.

const MIN_SCORE = 5;
const MIN_MARGIN = 2;
const MAX_ROUNDS = 8;

interface Feat {
  words: Set<string>;
  cls: Set<string>;
  lit: Map<string, string>;
}
function words(t: string): Set<string> {
  return new Set(
    t
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

/**
 * The safe re-attach plan: new-element index → the old id it provably is. `oldEls` / `newEls` are
 * walks of the two sides. Pure; never guesses.
 */
export function reattachIds(oldEls: IdElement[], newEls: IdElement[]): Map<number, ElementId> {
  const feats = new Map<IdElement, Feat>();
  const feat = (e: IdElement): Feat => {
    let f = feats.get(e);
    if (!f) {
      const lit = new Map<string, string>();
      for (const [k, v] of e.attrs) if (k !== 'className' && v !== '{expr}') lit.set(k, v);
      f = { words: words(e.text), cls: new Set(e.className.split(/\s+/).filter(Boolean)), lit };
      feats.set(e, f);
    }
    return f;
  };
  const oldById = new Map<string, IdElement>();
  for (const e of oldEls) if (e.id && !oldById.has(e.id)) oldById.set(e.id, e);
  const seen = new Set<string>();
  const n2o = new Map<number, number>();
  for (const e of newEls) {
    const o = e.id ? oldById.get(e.id) : undefined;
    if (o && !seen.has(e.id as string)) {
      seen.add(e.id as string);
      n2o.set(e.i, o.i);
    }
  }
  const out = new Map<number, ElementId>();
  const missing = new Set<number>();
  for (const e of oldEls) if (e.id && !seen.has(e.id) && oldById.get(e.id) === e) missing.add(e.i);
  if (!missing.size) return out;
  const loose = new Set<number>();
  for (const e of newEls) if (e.idKind === null && !n2o.has(e.i)) loose.add(e.i);

  const score = (n: IdElement, o: IdElement): number => {
    let s = 0;
    const fn = feat(n);
    const fo = feat(o);
    if (n.text && n.text === o.text) s += 3;
    else if ((n.text || o.text) && jaccard(fn.words, fo.words) >= 0.5) s += 2;
    if (n.className && n.className === o.className) s += 3;
    else if (jaccard(fn.cls, fo.cls) >= 0.5) s += 2;
    let same = 0;
    for (const [k, v] of fn.lit) if (fo.lit.get(k) === v) same++;
    s += Math.min(3, same);
    if (n.parent >= 0 && o.parent >= 0 && n2o.get(n.parent) === o.parent) s += 2;
    let kidHits = 0;
    for (const k of n.kids) {
      const ok = n2o.get(k);
      if (ok !== undefined && (oldEls[ok] as IdElement).parent === o.i) kidHits++;
    }
    return s + Math.min(4, kidHits * 2);
  };
  const keyOf = (e: IdElement) => `${e.artboard ?? ''}|${e.tag}|${e.component}`;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const byKey = new Map<string, number[]>();
    for (const oi of missing) {
      const k = keyOf(oldEls[oi] as IdElement);
      const list = byKey.get(k);
      if (list) list.push(oi);
      else byKey.set(k, [oi]);
    }
    const best = new Map<number, { o: number; s: number; second: number }>();
    for (const ni of loose) {
      const n = newEls[ni] as IdElement;
      let b = -1;
      let bs = -1;
      let sec = -1;
      for (const oi of byKey.get(keyOf(n)) ?? []) {
        const sc = score(n, oldEls[oi] as IdElement);
        if (sc > bs) {
          sec = bs;
          bs = sc;
          b = oi;
        } else if (sc > sec) sec = sc;
      }
      if (b >= 0) best.set(ni, { o: b, s: bs, second: sec });
    }
    const bestForOld = new Map<number, { n: number; s: number; second: number }>();
    for (const [ni, v] of best) {
      const cur = bestForOld.get(v.o);
      if (!cur || v.s > cur.s) bestForOld.set(v.o, { n: ni, s: v.s, second: cur ? cur.s : -1 });
      else if (v.s > cur.second) cur.second = v.s;
    }
    let added = 0;
    for (const [oi, v] of bestForOld) {
      const nb = best.get(v.n);
      if (!nb || nb.o !== oi) continue;
      const margin = Math.min(v.s - v.second, nb.s - nb.second);
      if (v.s >= MIN_SCORE && margin >= MIN_MARGIN) {
        n2o.set(v.n, oi);
        out.set(v.n, (oldEls[oi] as IdElement).id as string);
        missing.delete(oi);
        loose.delete(v.n);
        added++;
      }
    }
    if (!added) break;
  }
  return out;
}

// ── §5.3 checkIds — the id part of `maude design check` ───────────────────────────────────

export type IdFindingCode =
  | 'id-lost'
  | 'id-removed'
  | 'id-duplicate'
  | 'id-expression'
  | 'id-format'
  | 'locked-changed'
  | 'cd-attr-changed';

export interface IdFinding {
  code: IdFindingCode;
  /** `id-removed` is `info` (reported in the run result); everything else blocks. */
  severity: 'error' | 'info';
  /** `<path>:<line>:<col>`, or `<path>#<artboard>` for an element that is gone. */
  where: string;
  /** One line, plain words. */
  what: string;
  /** One line: what to do. */
  fix: string;
  id?: string;
  line: number;
  col: number;
  element: { tag: string; label: string; artboard: string | null };
}

export interface CheckIdsOptions {
  /** The snapshot to diff against (the run's start snapshot, or the last accepted content). */
  against?: string;
  /** Apply the safe re-attach plan. Never from the PostToolUse hook (it would fail Claude's next Edit). */
  fix?: boolean;
  /** Repo-relative path, for `where` and the parser. */
  path?: string;
}

export interface CheckIdsResult {
  findings: IdFinding[];
  /** Ids in `against` absent from `source` (pre-fix): `id-lost` + `id-removed`. */
  lostIds: string[];
  /** The safe re-attach plan: provable matches only, by line. */
  reattach: Array<{ id: ElementId; line: number }>;
  /** Only with `fix: true`: `source` with `reattach` applied (=== source when it is empty). */
  fixed?: string;
  /** `source` does not parse. Findings are empty then. (An unparseable `against` only skips the two-sided checks.) */
  parseError?: string;
}

const ROLE: Record<string, string> = {
  a: 'Link',
  article: 'Article',
  aside: 'Sidebar',
  audio: 'Audio',
  button: 'Button',
  details: 'Details',
  div: 'Box',
  figure: 'Figure',
  footer: 'Footer',
  form: 'Form',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  header: 'Header',
  img: 'Image',
  input: 'Input',
  label: 'Label',
  li: 'List item',
  main: 'Main',
  nav: 'Navigation',
  ol: 'List',
  p: 'Text',
  section: 'Section',
  select: 'Select',
  span: 'Text',
  summary: 'Summary',
  svg: 'Icon',
  table: 'Table',
  td: 'Cell',
  textarea: 'Text field',
  th: 'Cell',
  tr: 'Row',
  ul: 'List',
  video: 'Video',
  DCArtboard: 'Artboard',
};
function roleOf(tag: string): string {
  const last = tag.includes('.') ? (tag.split('.').pop() as string) : tag;
  return ROLE[tag] ?? ROLE[last] ?? (/^[A-Z]/.test(tag) ? tag : 'Element');
}
function labelOf(e: IdElement): string {
  const l = e.dcElement || e.text || e.aria || e.className.split(/\s+/)[0] || '';
  return l.length > 40 ? `${l.slice(0, 39)}…` : l;
}
function nameOf(e: IdElement): string {
  const l = labelOf(e);
  return l ? `${roleOf(e.tag)} "${l}"` : roleOf(e.tag);
}
function printKey(e: IdElement): string {
  return `${e.component}|${e.tag}|${e.chain.join('>')}|${e.attrs.map(([k, v]) => `${k}=${v}`).join('|')}|${e.text}`;
}
function cdKey(e: IdElement): string {
  return e.cd
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(' ');
}

/**
 * The id check (contract V2-1.4 §5.3). Without `against`: `id-duplicate`, `id-expression`,
 * `id-format`. With it, also `id-lost` (an id is gone and re-attach finds its element — error),
 * `id-removed` (gone, no provable match — info), `locked-changed` (a locked element's print
 * changed, it lost its lock, or it was removed) and `cd-attr-changed` (any other `data-cd-*` on a
 * kept element changed). Synchronous and pure; `fix` only computes `fixed`, it never writes.
 */
export function checkIds(source: string, opts: CheckIdsOptions = {}): CheckIdsResult {
  const path = opts.path ?? '<source>';
  const parsePath = opts.path && /\.[cm]?[jt]sx?$/.test(opts.path) ? opts.path : 'canvas.tsx';
  const nw = walkIdElements(source, parsePath);
  if (!nw.ok) return { findings: [], lostIds: [], reattach: [], parseError: nw.error };
  const newEls = nw.elements;
  const findings: IdFinding[] = [];
  const at = (e: IdElement) => `${path}:${e.line}:${e.col}`;
  const element = (e: IdElement) => ({ tag: e.tag, label: labelOf(e), artboard: e.artboard });
  const push = (
    code: IdFindingCode,
    e: IdElement,
    what: string,
    fix: string,
    id?: string,
    where = at(e),
    severity: IdFinding['severity'] = 'error'
  ) =>
    findings.push({
      code,
      severity,
      where,
      what,
      fix,
      ...(id !== undefined ? { id } : {}),
      line: e.line,
      col: e.col,
      element: element(e),
    });

  // one-sided: expression, format, duplicate
  const byId = new Map<string, IdElement[]>();
  for (const e of newEls) {
    if (e.idKind === 'expression') {
      push(
        'id-expression',
        e,
        `data-cd-id must be a plain string ("…"), line ${e.line}.`,
        'Write the id as a quoted string literal, or remove the attribute.'
      );
      continue;
    }
    if (e.id === null) continue;
    if (!isValidElementId(e.id)) {
      push(
        'id-format',
        e,
        `data-cd-id="${e.id}" (line ${e.line}) is not a valid element id.`,
        'Use lowercase words joined by "-" (at most 48 characters, never 8 hex characters).',
        e.id
      );
    }
    const list = byId.get(e.id);
    if (list) list.push(e);
    else byId.set(e.id, [e]);
  }
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    const first = list[0] as IdElement;
    const n = list.length === 2 ? 'two' : String(list.length);
    push(
      'id-duplicate',
      first,
      `data-cd-id="${id}" is on ${n} elements (lines ${list.map((e) => e.line).join(', ')}).`,
      'Give the copy a new id or drop it — an id names one element.',
      id
    );
  }

  const ow = opts.against !== undefined ? walkIdElements(opts.against, parsePath) : null;
  const lostIds: string[] = [];
  const plan: Array<{ el: IdElement; id: ElementId }> = [];
  if (ow?.ok) {
    const oldEls = ow.elements;
    const newFirst = new Map<string, IdElement>();
    for (const e of newEls) if (e.id && !newFirst.has(e.id)) newFirst.set(e.id, e);
    const oldFirst = new Map<string, IdElement>();
    for (const e of oldEls) if (e.id && !oldFirst.has(e.id)) oldFirst.set(e.id, e);
    for (const id of oldFirst.keys()) if (!newFirst.has(id)) lostIds.push(id);
    const matched = lostIds.length ? reattachIds(oldEls, newEls) : new Map<number, ElementId>();
    const reattachedTo = new Map<string, IdElement>();
    for (const [ni, id] of matched) {
      const el = newEls[ni] as IdElement;
      reattachedTo.set(id, el);
      plan.push({ el, id });
    }
    for (const id of lostIds) {
      const o = oldFirst.get(id) as IdElement;
      const n = reattachedTo.get(id);
      if (n) {
        push(
          'id-lost',
          n,
          `${nameOf(n)} (line ${n.line}) lost data-cd-id="${id}".`,
          `Put data-cd-id="${id}" back on it — comments, locks and arrows point at it.`,
          id
        );
      } else {
        push(
          'id-removed',
          o,
          `Removed ${nameOf(o)} (${id}). Anything that pointed at it detaches.`,
          'Nothing to do if the removal was intended.',
          id,
          o.artboard ? `${path}#${o.artboard}` : `${path}:${o.line}:${o.col}`,
          'info'
        );
      }
    }
    for (const o of oldEls) {
      if (!o.id || oldFirst.get(o.id) !== o) continue;
      const n = newFirst.get(o.id) ?? reattachedTo.get(o.id);
      if (o.locked) {
        const unlock = 'Undo the change to it, or ask the person to unlock it (⇧⌘L).';
        if (!n) {
          push(
            'locked-changed',
            o,
            `${nameOf(o)} is locked and was removed — put it back.`,
            'Restore it as it was, or ask the person to unlock it (⇧⌘L) first.',
            o.id,
            o.artboard ? `${path}#${o.artboard}` : `${path}:${o.line}:${o.col}`
          );
        } else if (!n.locked) {
          push(
            'locked-changed',
            n,
            `${nameOf(n)} (line ${n.line}) lost its lock (data-cd-locked).`,
            'Put data-cd-locked back — only the person unlocks (⇧⌘L).',
            o.id
          );
        } else if (printKey(n) !== printKey(o)) {
          push('locked-changed', n, `${nameOf(n)} is locked — leave it as it is.`, unlock, o.id);
        }
      }
      if (n && newFirst.get(o.id) === n && cdKey(n) !== cdKey(o)) {
        const before = cdKey(o) || 'none';
        push(
          'cd-attr-changed',
          n,
          `${nameOf(n)} (line ${n.line}) changed its canvas-only attributes (${before} → ${cdKey(n) || 'none'}).`,
          `Keep every data-cd-* attribute exactly as it was: ${before}.`,
          o.id
        );
      }
    }
  }
  plan.sort((a, b) => a.el.start - b.el.start);
  const reattach = plan.map(({ el, id }) => ({ id, line: el.line }));
  const result: CheckIdsResult = { findings, lostIds, reattach };
  if (opts.fix) {
    result.fixed = insertIds(
      source,
      plan.map(({ el, id }) => ({ nameEnd: el.nameEnd, id }))
    );
  }
  return result;
}
