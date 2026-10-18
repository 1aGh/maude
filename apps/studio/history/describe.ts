// `describeChanges` — "what changed" in words (V2-1.9 §5.5; S1.9 = the TSX lane).
//
//   describeChanges(canvas, before, after, opts?) → { changes, ms }
//
// A version row's body: the structural words-diff of a canvas between two versions, in CONTRACT §3–§4
// voice ("Hero: Fill black → white", "Frame added around Search field", "Artboard “Pricing” added").
// Pure and synchronous; no I/O. Budget p95 ≤ 50 ms on the largest v2 canvas (≤ 140 KB), V2-1.9 §5.16.
//
// ── The lane interface (S1.10 builds the CSS / meta / annotations lanes on this) ────────────────
//
//   1. `Lanes` holds the sources of ONE canvas at ONE version: `tsx` (required) plus `css`, `meta` and
//      `annotations` (null/undefined = the file does not exist at that version).
//   2. A lane is `(ctx: LaneContext) => Change[]`. `describeChanges` parses the TSX of both sides ONCE
//      (`ctx.before` / `ctx.after` are `TsxModel | null`, null = unparseable), runs the TSX lane
//      (`describeTsx`), then every lane in `opts.lanes` in order and concatenates the results. A lane
//      never re-parses TSX: it asks the models.
//   3. What the models offer a CSS lane (`TsxModel.classElements()`): every element of the canvas with its
//      class tokens (`{ token, prefix }` — a prefix is `"sb-role--" + x` or `` `sb-${x}` ``), its name in
//      words and the artboards it renders in (declarations reach their artboards through the reference
//      closure; anything the canvas frame renders reaches every artboard; elements gone since are found on
//      the `before` model). `artboardLabel(model, key)` gives an artboard's label.
//   4. A `Change` is one line. `artboards: []` means canvas level; a family artboard is one entry
//      (`disc-*`). Lines are NOT collapsed here — "Reworked <label> — N changes" (> 12 lines, or more than
//      half of the elements added/removed) and the row title are S1.10's (`titles.ts`).
//   5. Words: `describe-words.ts` (`propLabel`, `valuePair`, `quote`, `nameInWords`, …) — reuse them so a
//      CSS line reads the same as a TSX line ("Fill black → white", never "background: #000 → #fff").
//
// Grades: W1 = element/artboard + property + before → after · W2 = element named, change unspecified (a
// computed value, an expression that changed) · F = fallback ("Changed layout in <label>", "Changed this
// canvas"). F is only for code the describer cannot put in words (a hook, a helper without JSX).

import type { ElementRef } from '../element-ids';
import {
  type AnyNode,
  artboardIdOf,
  buildArtboard,
  buildRoots,
  type ClassRef,
  collapse,
  type El,
  forEachChild,
  isNode,
  jsxTagName,
  litOf,
  matchContainers,
  type Pairing,
  type Parsed,
  parseCanvas,
  walkEls,
} from './describe-match';
import {
  attrLabel,
  colourWord,
  firstWords,
  nameInWords,
  plural,
  propLabel,
  quote,
  quotePair,
  roleOf,
  sameValue,
  sentence,
  type Val,
  valuePair,
  valueText,
  type WordsOptions,
  wordsOf,
} from './describe-words';

// ── public types ────────────────────────────────────────────────────────────────────────────

export interface Lanes {
  tsx: string;
  css?: string | null;
  meta?: string | null;
  annotations?: string | null;
}

export type Grade = 'W1' | 'W2' | 'F';

export type ChangeKind =
  | 'style'
  | 'text'
  | 'attr'
  | 'class'
  | 'content'
  | 'added'
  | 'removed'
  | 'wrapped'
  | 'unwrapped'
  | 'moved'
  | 'reordered'
  | 'data'
  | 'css'
  | 'artboard-added'
  | 'artboard-removed'
  | 'artboard-renamed'
  | 'artboard-resized'
  | 'artboard-moved'
  | 'artboard-reordered'
  | 'artboard-settings'
  | 'section'
  | 'canvas-text'
  | 'imports'
  | 'annotation'
  | 'meta'
  | 'layout'
  | 'canvas';

export interface Change {
  /** [] = canvas level. A family artboard (`id={`disc-${d.id}`}`) is one entry, `disc-*`. */
  artboards: string[];
  grade: Grade;
  kind: ChangeKind;
  /** CONTRACT §3–§4 voice. */
  words: string;
  element?: ElementRef | { artboard: string; print: string };
  /** Source property, for blame keys and object history. */
  prop?: string;
  /** `added` / `removed`: how many elements the line stands for (its subtree) — S1.10's collapse rule. */
  weight?: number;
}

export interface DescribeOptions extends WordsOptions {
  /** Extra lanes (CSS / meta / annotations — S1.10), run after the TSX lane. */
  lanes?: LaneDescriber[];
}

export interface LaneContext {
  canvas: string;
  before: Lanes;
  after: Lanes;
  /** null = the TSX did not parse. */
  modelBefore: TsxModel | null;
  modelAfter: TsxModel | null;
  opts: DescribeOptions;
}

export type LaneDescriber = (ctx: LaneContext) => Change[];

export interface ClassElement {
  /** The element's name in words. */
  name: string;
  classes: ClassRef[];
  /** Artboard keys it renders in; [] = canvas frame level. */
  artboards: string[];
}

// ── the parsed side ─────────────────────────────────────────────────────────────────────────

interface Decl {
  key: string;
  names: string[];
  node: AnyNode;
  kind: 'component' | 'data' | 'other';
  refs: Set<string>;
  src: string;
}

export interface ArtboardInfo {
  /** `DCArtboard id`, a family key (`disc-*`), or `#<offset>` when it has no literal id. */
  key: string;
  family: boolean;
  node: AnyNode;
  /** Normalised source of the whole element (the fast "unchanged" test). */
  text: string;
}

export interface TsxModel {
  parsed: Parsed;
  artboards: ArtboardInfo[];
  /** The deep element tree of an artboard (built on first use). */
  tree(key: string): El | null;
  /** The canvas frame (sections, artboards as leaves), null when there is none. */
  frame(): El | null;
  classElements(): ClassElement[];
  /** Artboard keys the declaration reaches (reference closure; frame-rendered ones reach all). */
  reach(decl: string): string[];
  readonly decls: Decl[];
  readonly imports: string[];
  /** The module source with imports, declarations, artboards and the frame cut out. */
  readonly rest: string;
}

const PASCAL = /^[A-Z]/;

function findArtboards(root: AnyNode, out: AnyNode[] = []): AnyNode[] {
  if (!isNode(root)) return out;
  if (root.type === 'JSXElement' && jsxTagName(root.openingElement?.name) === 'DCArtboard') {
    out.push(root);
    return out;
  }
  forEachChild(root, (c) => findArtboards(c, out));
  return out;
}

/** Every identifier a subtree references (property keys and attribute names excluded). */
function refsOf(root: AnyNode, skipArtboards = false): Set<string> {
  const out = new Set<string>();
  const walk = (n: AnyNode, parent: AnyNode, field: string): void => {
    if (!isNode(n)) return;
    switch (n.type) {
      case 'Identifier':
        if (parent?.type === 'MemberExpression' && field === 'property' && !parent.computed) return;
        if (
          (parent?.type === 'Property' || parent?.type === 'ObjectProperty') &&
          field === 'key' &&
          !parent.computed
        )
          return;
        out.add(String(n.name));
        return;
      case 'JSXElement':
        if (skipArtboards && jsxTagName(n.openingElement?.name) === 'DCArtboard') return;
        break;
      case 'JSXOpeningElement':
      case 'JSXClosingElement': {
        const t = jsxTagName(n.name);
        const head = t.split('.')[0] as string;
        if (PASCAL.test(head)) out.add(head);
        for (const a of n.attributes ?? []) walk(a, n, 'attributes');
        return;
      }
      case 'JSXAttribute':
        walk(n.value, n, 'value');
        return;
      case 'Literal':
      case 'StringLiteral':
      case 'TemplateElement':
      case 'JSXText':
        return;
    }
    forEachChild(n, (c, k) => walk(c, n, k));
  };
  walk(root, null, '');
  return out;
}

function declaredNames(s: AnyNode): string[] {
  if (!isNode(s)) return [];
  if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration')
    return declaredNames(s.declaration);
  if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id?.name)
    return [String(s.id.name)];
  if (s.type === 'VariableDeclaration') {
    const names: string[] = [];
    for (const d of s.declarations ?? []) {
      if (d.id?.type === 'Identifier') names.push(String(d.id.name));
      else for (const r of refsOf(d.id)) names.push(r);
    }
    return names;
  }
  return [];
}

const isTypeOnly = (s: AnyNode): boolean => {
  const d = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
  return !!d && (d.type === 'TSTypeAliasDeclaration' || d.type === 'TSInterfaceDeclaration');
};

function unwrapExpr(n: AnyNode): AnyNode {
  let x = n;
  while (
    x &&
    (x.type === 'TSAsExpression' ||
      x.type === 'TSSatisfiesExpression' ||
      x.type === 'ParenthesizedExpression' ||
      x.type === 'TSNonNullExpression')
  )
    x = x.expression;
  return x;
}

/** The function a canvas statement is (declaration, arrow, `export default`), or null. */
function functionOf(s: AnyNode): AnyNode | null {
  if (!isNode(s)) return null;
  if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration')
    return functionOf(s.declaration);
  if (
    s.type === 'FunctionDeclaration' ||
    s.type === 'FunctionExpression' ||
    s.type === 'ArrowFunctionExpression'
  )
    return s;
  if (s.type === 'VariableDeclaration' && s.declarations?.length === 1) {
    const init = unwrapExpr(s.declarations[0].init);
    return init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
      ? init
      : null;
  }
  return null;
}

function declKind(s: AnyNode): Decl['kind'] {
  let d = s;
  while (d && (d.type === 'ExportNamedDeclaration' || d.type === 'ExportDefaultDeclaration'))
    d = d.declaration;
  if (d?.type === 'VariableDeclaration' && d.declarations?.length === 1) {
    const init = unwrapExpr(d.declarations[0].init);
    if (init) {
      if (
        init.type === 'ArrayExpression' ||
        init.type === 'ObjectExpression' ||
        litOf(init) !== null
      )
        return 'data';
      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
        return outerJsxCount(d) ? 'component' : 'other';
    }
    return outerJsxCount(d) ? 'component' : 'other';
  }
  if (d?.type === 'FunctionDeclaration') return outerJsxCount(d) ? 'component' : 'other';
  return 'other';
}

function outerJsxCount(n: AnyNode): number {
  let c = 0;
  const walk = (x: AnyNode): void => {
    if (!isNode(x) || c > 0) return;
    if (x.type === 'JSXElement' || x.type === 'JSXFragment') {
      c++;
      return;
    }
    forEachChild(x, walk);
  };
  walk(n);
  return c;
}

function outerJsxNodes(n: AnyNode, out: AnyNode[] = []): AnyNode[] {
  if (!isNode(n)) return out;
  if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
    out.push(n);
    return out;
  }
  forEachChild(n, (c) => outerJsxNodes(c, out));
  return out;
}

function artboardLabelOf(node: AnyNode, key: string): string {
  for (const a of node.openingElement?.attributes ?? []) {
    if (a?.type !== 'JSXAttribute' || a.name?.name !== 'label') continue;
    const v = a.value?.type === 'JSXExpressionContainer' ? a.value.expression : a.value;
    const l = litOf(v);
    if (l?.trim()) return l.trim();
    if (v?.type === 'TemplateLiteral') {
      const t = (v.quasis ?? [])
        .map((q: AnyNode) => String(q.value?.cooked ?? ''))
        .join('')
        .trim();
      if (t) return t;
    }
    // an expression label (`{d.name}`) has no words of its own: the id's say it
  }
  const words = nameInWords(key.replace(/\*/g, ' ').replace(/^#.*/, 'artboard'));
  return words || 'Artboard';
}

export function parseModel(source: string): TsxModel | null {
  const parsed = parseCanvas(source);
  return parsed ? analyze(parsed) : null;
}

function analyze(parsed: Parsed): TsxModel {
  const { program, src } = parsed;
  const cuts: Array<[number, number]> = [];
  const cut = (n: AnyNode): void => {
    cuts.push([n.start, n.end]);
  };
  const decls: Decl[] = [];
  const imports: string[] = [];
  const frameStmts: AnyNode[] = [];
  const abNodes: AnyNode[] = [];
  const seen = new Set<AnyNode>();

  const addDecl = (s: AnyNode, scope: string): void => {
    const names = declaredNames(s);
    decls.push({
      key: `${scope}:${names.join(',')}`,
      names,
      node: s,
      kind: declKind(s),
      refs: refsOf(s),
      src: collapse(src.slice(s.start, s.end)),
    });
    cut(s);
  };

  for (const stmt of program.body ?? []) {
    if (stmt.type === 'ImportDeclaration') {
      imports.push(collapse(src.slice(stmt.start, stmt.end)));
      cut(stmt);
      continue;
    }
    if (isTypeOnly(stmt)) {
      cut(stmt);
      continue;
    }
    const abs = findArtboards(stmt);
    if (abs.length) {
      for (const a of abs) {
        if (seen.has(a)) continue;
        seen.add(a);
        abNodes.push(a);
      }
      const fn = functionOf(stmt);
      if (fn && fn.body?.type === 'BlockStatement') {
        for (const s of fn.body.body ?? []) {
          if (findArtboards(s).length) {
            frameStmts.push(s);
            cut(s);
          } else if (declaredNames(s).length && s.type !== 'ExpressionStatement') addDecl(s, 'l');
        }
      } else if (fn?.body) {
        frameStmts.push(fn.body);
        cut(fn.body);
      } else {
        frameStmts.push(stmt);
        cut(stmt);
      }
      continue;
    }
    if (declaredNames(stmt).length) addDecl(stmt, 'm');
  }

  let idless = 0;
  const artboards: ArtboardInfo[] = abNodes.map((node) => {
    const id = artboardIdOf(node.openingElement);
    const key = id ?? `#${idless++}`;
    return {
      key,
      family: key.includes('*'),
      node,
      text: collapse(src.slice(node.start, node.end)),
    };
  });
  const abByKey = new Map(artboards.map((a) => [a.key, a]));

  // rest = everything not cut
  cuts.sort((x, y) => x[0] - y[0]);
  const restParts: string[] = [];
  let at = 0;
  for (const [s, e] of cuts) {
    if (s < at) continue;
    restParts.push(src.slice(at, s));
    at = e;
  }
  restParts.push(src.slice(at));
  const rest = collapse(restParts.join(' '));

  // the reference closure
  const declByName = new Map<string, Decl>();
  for (const d of decls) for (const n of d.names) declByName.set(n, d);
  const reachMap = new Map<Decl, Set<string>>();
  const visit = (seed: Set<string>, keys: string[]): void => {
    const seenDecl = new Set<Decl>();
    const stack = [...seed];
    while (stack.length) {
      const d = declByName.get(stack.pop() as string);
      if (!d || seenDecl.has(d)) continue;
      seenDecl.add(d);
      let r = reachMap.get(d);
      if (!r) {
        r = new Set();
        reachMap.set(d, r);
      }
      for (const k of keys) r.add(k);
      for (const n of d.refs) stack.push(n);
    }
  };
  const allKeys = artboards.map((a) => a.key);
  for (const a of artboards) visit(refsOf(a.node), [a.key]);
  const frameRefs = new Set<string>();
  for (const s of frameStmts) for (const r of refsOf(s, true)) frameRefs.add(r);
  visit(frameRefs, allKeys);
  const declByKey = new Map(decls.map((d) => [d.key, d]));

  const trees = new Map<string, El | null>();
  let frameTree: El | null | undefined;
  let classEls: ClassElement[] | undefined;

  const model: TsxModel = {
    parsed,
    artboards,
    decls,
    imports,
    rest,
    tree(key) {
      const have = trees.get(key);
      if (have !== undefined) return have;
      const info = abByKey.get(key);
      const t = info ? buildArtboard(info.node, src, '', key) : null;
      trees.set(key, t);
      return t;
    },
    frame() {
      if (frameTree !== undefined) return frameTree;
      if (!frameStmts.length) {
        frameTree = null;
        return null;
      }
      const jsx: AnyNode[] = [];
      for (const s of frameStmts) outerJsxNodes(s, jsx);
      frameTree = buildRoots(jsx, src, { leafArtboards: true });
      return frameTree;
    },
    reach(declKey) {
      const d = declByKey.get(declKey);
      const r = d ? reachMap.get(d) : undefined;
      return r ? allKeys.filter((k) => r.has(k)) : [];
    },
    classElements() {
      if (classEls) return classEls;
      const out: ClassElement[] = [];
      const take = (root: El, artboards: string[], skipRoot: boolean): void => {
        walkEls(root, (e) => {
          if (skipRoot && e === root) return;
          if (e.classRefs.length)
            out.push({ name: elementName(e, null), classes: e.classRefs, artboards });
        });
      };
      for (const a of artboards) {
        const t = model.tree(a.key);
        if (t) take(t, [a.key], false);
      }
      const fr = model.frame();
      if (fr) take(fr, [], true);
      for (const d of decls) {
        const jsx = outerJsxNodes(d.node);
        if (!jsx.length) continue;
        const root = buildRoots(jsx, src, { comp: d.names[0] ?? '' });
        take(root, model.reach(d.key), true);
      }
      classEls = out;
      return out;
    },
  };
  return model;
}

export function artboardLabel(model: TsxModel, key: string): string {
  const info = model.artboards.find((a) => a.key === key);
  return info ? artboardLabelOf(info.node, key) : nameInWords(key) || 'Artboard';
}

// ── names ───────────────────────────────────────────────────────────────────────────────────

const NAME_ATTRS = ['aria-label', 'alt', 'title', 'label', 'name'];

/**
 * An element's name in words: `data-dc-element` → `aria-label` / `alt` / `title` / `label` / `name` →
 * own text (first five words, quoted) → component name → role. `skip` leaves out the attribute / text
 * a line is about, so "Text “Buy” → “Buy now”" never names the element by the text it changes.
 */
export function elementName(e: El, skip: string | null): string {
  if (e.tag === 'DCArtboard') {
    const l = e.attrs.get('label');
    const id = e.attrs.get('id');
    const key = e.abKey ?? (id?.lit ? id.v : '');
    const w =
      l?.lit && l.v.trim()
        ? l.v
        : key.startsWith('#') || !key
          ? 'Artboard'
          : nameInWords(key.replace(/\*/g, ' '));
    return `Artboard ${quote(w)}`;
  }
  if (e.tag === 'DCSection') {
    const t = e.attrs.get('title');
    return t?.lit && t.v.trim() ? `Section ${quote(t.v)}` : 'Section';
  }
  if (skip !== 'data-dc-element') {
    const dc = e.attrs.get('data-dc-element');
    if (dc?.lit && dc.v.trim()) return sentence(dc.v.trim());
  }
  for (const k of NAME_ATTRS) {
    if (k === skip) continue;
    const v = e.attrs.get(k);
    if (v?.lit && v.v.trim()) return quote(firstWords(v.v, 5), 40);
  }
  if (skip !== 'text' && e.text) return quote(firstWords(e.text, 5), 40);
  return roleOf(e.tag);
}

const roleName = (e: El): string => roleOf(e.tag);

// ── element diff ────────────────────────────────────────────────────────────────────────────

interface Env {
  canvas: string;
  words: WordsOptions;
  mode: 'artboard' | 'decl' | 'frame';
  /** Artboards a line belongs to (decl: the reach; frame: []). */
  artboards: string[];
  prefix: string;
  model: TsxModel;
}

function ref(env: Env, e: El, abKey: string): Change['element'] {
  if (e.cdId) return { canvas: env.canvas, artboard: abKey, element: e.cdId };
  const cls = e.classes.length ? `.${e.classes.join('.')}` : '';
  const text = e.text ? ` ${quote(e.text, 24)}` : '';
  return { artboard: abKey, print: `${e.tag}${cls}${text}` };
}

function abKeyOf(root: El): string {
  if (root.abKey) return root.abKey;
  const id = root.attrs.get('id');
  return id?.lit ? id.v : '';
}

function linesFor(env: Env, root: El): string[] {
  return env.mode === 'artboard' ? [abKeyOf(root)] : env.artboards;
}

function tokenDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return { added: b.filter((t) => !sa.has(t)), removed: a.filter((t) => !sb.has(t)) };
}

const joinQ = (l: string[]): string =>
  l
    .slice(0, 3)
    .map((t) => quote(t, 24))
    .join(', ') + (l.length > 3 ? ', …' : '');

function quoted(v: Val): { text: string; num: boolean } {
  if (!v.lit) return { text: 'a formula', num: false };
  if (/^-?\d*\.?\d+$/.test(v.v)) return { text: v.v, num: true };
  if (v.v === 'true' || v.v === 'false') return { text: v.v, num: true };
  return { text: quote(v.v, 40), num: false };
}

/** Changes inside one matched element pair (not its position — see `positionLines`). */
function diffPair(env: Env, a: El, b: El, abKey: string, out: Change[]): void {
  const arts = env.mode === 'artboard' ? [abKey] : env.artboards;
  const isAb = b.tag === 'DCArtboard';
  const prefix = env.prefix;
  const nameFor = (skip: string | null) => `${prefix}${elementName(b, skip)}`;
  const el = ref(env, b, abKey);
  const push = (kind: ChangeKind, grade: Grade, words: string, prop?: string): void => {
    out.push({ artboards: arts, grade, kind, words, element: el, ...(prop ? { prop } : {}) });
  };

  // attributes
  const keys = [...new Set([...b.attrs.keys(), ...a.attrs.keys()])];
  let sizeA: [Val | undefined, Val | undefined] | null = null;
  for (const key of keys) {
    const va = a.attrs.get(key);
    const vb = b.attrs.get(key);
    if (va && vb && va.lit === vb.lit && va.v === vb.v) continue;
    if (key.startsWith('...')) {
      push('attr', 'W2', `${nameFor(null)}: Settings changed`, key);
      continue;
    }
    if (isAb) {
      if (key === 'width' || key === 'height') {
        sizeA = [a.attrs.get('width'), a.attrs.get('height')];
        continue;
      }
      if (key === 'id') continue;
      if (key === 'label') {
        out.push({
          artboards: arts,
          grade: 'W1',
          kind: 'artboard-renamed',
          words: `Artboard ${quote(va?.v ?? '')} renamed to ${quote(vb?.v ?? '')}`,
          element: el,
          prop: 'label',
        });
        continue;
      }
    }
    if (env.mode === 'frame' && b.tag === 'DCSection' && key === 'title') {
      out.push({
        artboards: [],
        grade: 'W1',
        kind: 'section',
        words: `Section ${quote(va?.v ?? '')} renamed to ${quote(vb?.v ?? '')}`,
        prop: 'title',
      });
      continue;
    }
    const kind: ChangeKind = isAb
      ? 'artboard-settings'
      : env.mode === 'frame'
        ? b.tag === 'DCSection'
          ? 'section'
          : b.tag === 'DesignCanvas' && (key === 'title' || key === 'subtitle')
            ? 'canvas-text'
            : 'attr'
        : 'attr';
    const label = attrLabel(key);
    const who = nameFor(key);
    if (!va && vb) {
      push(
        kind,
        vb.lit ? 'W1' : 'W2',
        `${who}: ${label} set to ${vb.lit ? quoted(vb).text : 'a formula'}`,
        key
      );
    } else if (va && !vb) {
      push(
        kind,
        'W1',
        `${who}: ${label} removed (was ${va.lit ? quoted(va).text : 'a formula'})`,
        key
      );
    } else if (va && vb) {
      if (!va.lit && !vb.lit) push(kind, 'W2', `${who}: ${label} changed`, key);
      else if (!va.lit || !vb.lit) {
        push(kind, 'W2', `${who}: ${label} ${quoted(va).text} → ${quoted(vb).text}`, key);
      } else {
        const qa = quoted(va);
        const qb = quoted(vb);
        if (qa.num && qb.num) {
          const css = key === 'width' || key === 'height' || key === 'gap' || key === 'size';
          const words = css ? valuePair(key, va, vb, env.words).text : `${qa.text} → ${qb.text}`;
          push(kind, 'W1', `${who}: ${label} ${words}`, key);
        } else {
          const [x, y] = quotePair(va.v, vb.v);
          push(kind, 'W1', `${who}: ${label} ${x} → ${y}`, key);
        }
      }
    }
  }
  if (isAb && sizeA) {
    const dim = (e: El, k: string): Val | undefined => e.attrs.get(k);
    const lits = [dim(a, 'width'), dim(a, 'height'), dim(b, 'width'), dim(b, 'height')];
    const label = elementName(b, null).replace(/^Artboard /, '');
    if (lits.every((v) => v?.lit)) {
      const t = (e: El): string => `${dim(e, 'width')?.v} \u00D7 ${dim(e, 'height')?.v}`;
      out.push({
        artboards: arts,
        grade: 'W1',
        kind: 'artboard-resized',
        words: `${label}: size ${t(a)} \u2192 ${t(b)}`,
        element: el,
        prop: 'size',
      });
    } else {
      for (const k of ['width', 'height']) {
        const va = dim(a, k);
        const vb = dim(b, k);
        if (!va || !vb || (va.lit === vb.lit && va.v === vb.v)) continue;
        const vp = valuePair(k, va, vb, env.words);
        out.push({
          artboards: arts,
          grade: vp.computed ? 'W2' : 'W1',
          kind: 'artboard-resized',
          words: `${label}: ${propLabel(k)} ${vp.text}`,
          element: el,
          prop: k,
        });
      }
    }
  }

  // style
  const skeys = [...new Set([...b.style.keys(), ...a.style.keys()])];
  for (const key of skeys) {
    const va = a.style.get(key);
    const vb = b.style.get(key);
    if (va && vb && sameValue(key, va, vb)) continue;
    const label = key.startsWith('...') ? 'Style' : propLabel(key);
    const who = nameFor(null);
    const kind: ChangeKind = isAb ? 'artboard-settings' : 'style';
    if (key.startsWith('...')) {
      push(kind, 'W2', `${who}: Style changed`, key);
    } else if (!va && vb) {
      push(
        kind,
        vb.lit ? 'W1' : 'W2',
        `${who}: ${label} set to ${valueText(key, vb, env.words)}`,
        key
      );
    } else if (va && !vb) {
      push(kind, 'W1', `${who}: ${label} removed (was ${valueText(key, va, env.words)})`, key);
    } else if (va && vb) {
      if (!va.lit && !vb.lit) push(kind, 'W2', `${who}: ${label} changed`, key);
      else {
        const vp = valuePair(key, va, vb, env.words);
        push(kind, vp.computed ? 'W2' : 'W1', `${who}: ${label} ${vp.text}`, key);
      }
    }
  }
  if (a.styleSig !== b.styleSig)
    push(isAb ? 'artboard-settings' : 'style', 'W2', `${nameFor(null)}: Style changed`, 'style');

  // classes
  if (a.classSig !== b.classSig) {
    const { added, removed } = tokenDiff(a.classes, b.classes);
    const who = nameFor(null);
    const kind: ChangeKind = isAb ? 'artboard-settings' : 'class';
    if (!added.length && !removed.length) push(kind, 'W2', `${who}: Style changed`, 'className');
    else if (added.length === 1 && removed.length === 1)
      push(
        kind,
        'W1',
        `${who}: Style ${quote(removed[0] as string, 24)} → ${quote(added[0] as string, 24)}`,
        'className'
      );
    else {
      if (added.length) push(kind, 'W1', `${who}: Style ${joinQ(added)} added`, 'className');
      if (removed.length) push(kind, 'W1', `${who}: Style ${joinQ(removed)} removed`, 'className');
    }
  }

  // text
  if (a.text !== b.text) {
    const who = nameFor('text');
    const kind: ChangeKind = env.mode === 'frame' && b.tag !== 'DCSection' ? 'canvas-text' : 'text';
    if (!a.text) push(kind, 'W1', `${who}: Text set to ${quote(b.text, 40)}`, 'text');
    else if (!b.text) push(kind, 'W1', `${who}: Text removed (was ${quote(a.text, 40)})`, 'text');
    else {
      const [x, y] = quotePair(a.text, b.text);
      push(kind, 'W1', `${who}: Text ${x} → ${y}`, 'text');
    }
  }

  // expressions
  if (a.exprs.length !== b.exprs.length || a.exprs.some((x, i) => x !== b.exprs[i])) {
    push('content', 'W2', `${nameFor(null)}: Content changed`, 'content');
  }
}

/** Longest increasing subsequence (indices into `seq`). */
function lis(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((seq[tails[mid] as number] as number) < (seq[i] as number)) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] as number;
    tails[lo] = i;
  }
  const out = new Set<number>();
  let k = tails.length ? (tails[tails.length - 1] as number) : -1;
  while (k >= 0) {
    out.add(k);
    k = prev[k] as number;
  }
  return out;
}

function matchedDescendants(e: El, has: (x: El) => boolean, out: El[] = []): El[] {
  for (const k of e.kids) {
    if (has(k)) out.push(k);
    else matchedDescendants(k, has, out);
  }
  return out;
}

/** All lines of one container pair: pair changes, positions, additions, removals. */
/** Elements in a subtree (itself included). */
function subtreeSize(e: El): number {
  let n = 0;
  walkEls(e, () => {
    n++;
  });
  return n;
}

function diffContainer(env: Env, ra: El, rb: El, p: Pairing, out: Change[]): void {
  const abOf = (e: El): string => (env.mode === 'artboard' ? abKeyOf(e.root) : '');
  const isLeafAb = (e: El): boolean => e.tag === 'DCArtboard' && env.mode === 'frame';

  const visitB = (b: El): void => {
    const a = p.b2a.get(b);
    if (a) {
      const frameLeaf = isLeafAb(b);
      if (b !== rb && !frameLeaf) diffPair(env, a, b, abOf(b), out);
      if (b !== rb) {
        const pa = a.parent;
        const pb = b.parent;
        if (pa && pb && p.a2b.get(pa) !== pb && p.b2a.has(pb) && p.a2b.has(pa)) {
          const abs =
            env.mode === 'artboard'
              ? [...new Set([abKeyOf(a.root), abKeyOf(b.root)])]
              : env.artboards;
          const name = `${env.prefix}${elementName(b, null)}`;
          if (frameLeaf) {
            out.push({
              artboards: [abKeyOf(b)],
              grade: 'W1',
              kind: 'artboard-moved',
              words: `${name} moved into ${elementName(pb, null)}`,
            });
          } else if (pb === pb.root) {
            if (env.mode === 'artboard') {
              out.push({
                artboards: abs,
                grade: 'W1',
                kind: 'moved',
                words: `${name} moved into ${elementName(pb, null).replace(/^Artboard /, '')}`,
                element: ref(env, b, abOf(b)),
              });
            }
          } else {
            out.push({
              artboards: abs,
              grade: 'W1',
              kind: 'moved',
              words: `${name} moved into ${elementName(pb, null)}`,
              element: ref(env, b, abOf(b)),
            });
          }
        }
      }
      // reorder among matched siblings under this matched parent
      const common = b.kids.filter((k) => {
        const ak = p.b2a.get(k);
        return !!ak && ak.parent === a;
      });
      if (common.length > 1) {
        const ranks = common.map((k) => (p.b2a.get(k) as El).idx);
        const stable = lis(ranks);
        if (stable.size < common.length) {
          common.forEach((k, i) => {
            if (stable.has(i)) return;
            const r = ranks[i] as number;
            let beforeB = 0;
            let beforeA = 0;
            for (const s of stable) {
              if (s < i) beforeB++;
              if ((ranks[s] as number) < r) beforeA++;
            }
            const up = beforeB < beforeA;
            const frameAb = isLeafAb(k);
            const sec = k.tag === 'DCSection';
            const name = `${env.prefix}${elementName(k, null)}`;
            out.push({
              artboards: frameAb
                ? [abKeyOf(k)]
                : env.mode === 'artboard'
                  ? [abOf(k)]
                  : env.artboards,
              grade: 'W1',
              kind: frameAb ? 'artboard-reordered' : sec ? 'section' : 'reordered',
              words: `${name} moved ${frameAb || sec ? (up ? 'earlier' : 'later') : up ? 'up' : 'down'}`,
              ...(frameAb || sec ? {} : { element: ref(env, k, abOf(k)) }),
            });
          });
        }
      }
    } else if (b.parent && p.b2a.has(b.parent) && !isLeafAb(b)) {
      const inner = matchedDescendants(b, (x) => p.b2a.has(x));
      const abs = linesFor(env, b.root);
      const name = `${env.prefix}${elementName(b, null)}`;
      if (inner.length && b.tag !== 'DCSection') {
        const what =
          inner.length === 1
            ? elementName(inner[0] as El, null)
            : plural(inner.length, 'element', 'elements');
        out.push({
          artboards: abs,
          grade: 'W1',
          kind: 'wrapped',
          words: `${env.prefix}${roleName(b)} added around ${what}`,
          element: ref(env, b, abOf(b)),
        });
      } else {
        out.push({
          artboards: abs,
          grade: 'W1',
          kind: b.tag === 'DCSection' ? 'section' : 'added',
          words: `${name} added`,
          element: ref(env, b, abOf(b)),
          weight: subtreeSize(b),
        });
      }
    }
    for (const k of b.kids) visitB(k);
  };
  visitB(rb);

  const visitA = (a: El): void => {
    if (!p.a2b.has(a) && a.parent && p.a2b.has(a.parent) && !isLeafAb(a)) {
      const inner = matchedDescendants(a, (x) => p.a2b.has(x));
      const abs = linesFor(env, a.root);
      const name = `${env.prefix}${elementName(a, null)}`;
      if (inner.length && a.tag !== 'DCSection') {
        const what =
          inner.length === 1
            ? elementName(inner[0] as El, null)
            : plural(inner.length, 'element', 'elements');
        out.push({
          artboards: abs,
          grade: 'W1',
          kind: 'unwrapped',
          words: `${env.prefix}${roleName(a)} removed from around ${what}`,
          element: ref(env, a, abOf(a)),
        });
      } else {
        out.push({
          artboards: abs,
          grade: 'W1',
          kind: a.tag === 'DCSection' ? 'section' : 'removed',
          words: `${name} removed`,
          element: ref(env, a, abOf(a)),
          weight: subtreeSize(a),
        });
      }
    }
    for (const k of a.kids) visitA(k);
  };
  visitA(ra);
}

// ── data / literals in declarations ─────────────────────────────────────────────────────────

const ID_PROPS = ['id', 'key', 'slug', 'name', 'label', 'title'];

interface DvCtx {
  srcA: string;
  srcB: string;
  base: string;
  out: Change[];
  artboards: string[];
  words: WordsOptions;
}

function propKey(p: AnyNode): string | null {
  if (!p || p.computed) return null;
  if (p.key?.type === 'Identifier') return String(p.key.name);
  const l = litOf(p.key);
  return l;
}

function itemName(o: AnyNode): string | null {
  if (o?.type !== 'ObjectExpression') return null;
  for (const k of ID_PROPS) {
    for (const p of o.properties ?? []) {
      if (p.type === 'SpreadElement' || propKey(p) !== k) continue;
      const l = litOf(p.value);
      if (l?.trim()) return l;
    }
  }
  return null;
}

function dvPush(c: DvCtx, path: string[], words: string, grade: Grade = 'W1'): void {
  const where = path.length ? `${c.base} › ${path.join(' › ')}` : c.base;
  c.out.push({ artboards: c.artboards, grade, kind: 'data', words: `${where}: ${words}` });
}

function scalarPair(prop: string | null, a: string, b: string, words: WordsOptions): string {
  if (/^-?\d*\.?\d+$/.test(a) && /^-?\d*\.?\d+$/.test(b)) return `${a} → ${b}`;
  if (a === 'true' || a === 'false' || b === 'true' || b === 'false') return `${a} → ${b}`;
  if (colourWord(a) && colourWord(b) && !a.includes(' ')) {
    return valuePair(prop ?? '', { lit: true, v: a }, { lit: true, v: b }, words).text;
  }
  const [x, y] = quotePair(a, b);
  return `${x} → ${y}`;
}

/** Parallel walk of two ASTs. false = the shapes differ in a way that cannot be put in words. */
function dv(c: DvCtx, a: AnyNode, b: AnyNode, path: string[], prop: string | null): boolean {
  if (!isNode(a) || !isNode(b)) return a === b;
  if (
    a.type.startsWith('TS') &&
    b.type.startsWith('TS') &&
    a.type !== 'TSAsExpression' &&
    a.type !== 'TSSatisfiesExpression' &&
    a.type !== 'TSNonNullExpression'
  )
    return true; // types are not visible
  if (
    (a.type === 'JSXElement' || a.type === 'JSXFragment') &&
    (b.type === 'JSXElement' || b.type === 'JSXFragment')
  )
    return true; // JSX is diffed as elements
  const la = litOf(a);
  const lb = litOf(b);
  if (la !== null && lb !== null) {
    if (la !== lb) {
      const label = prop ? `${propLabel(prop)} ` : '';
      dvPush(c, path, `${label}${scalarPair(prop, la, lb, c.words)}`);
    }
    return true;
  }
  if (a.type !== b.type) return false;
  if (a.type === 'ArrayExpression') return dvArray(c, a, b, path);
  if (a.type === 'ObjectExpression') return dvObject(c, a, b, path);
  if (a.type === 'Identifier') return a.name === b.name;
  if (
    collapse(c.srcA.slice(a.start, a.end)) === collapse(c.srcB.slice(b.start, b.end)) &&
    !outerJsxCount(a)
  )
    return true;
  // lockstep over the children
  const ka = Object.keys(a).filter(
    (k) => k !== 'start' && k !== 'end' && k !== 'loc' && k !== 'range'
  );
  for (const k of ka) {
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va)) {
      if (!Array.isArray(vb) || va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i++) {
        if (isNode(va[i])) {
          const step = a.type === 'VariableDeclarator' ? path : path;
          if (!dv(c, va[i], vb[i], step, null)) return false;
        } else if (va[i] !== vb[i]) return false;
      }
    } else if (isNode(va)) {
      const childProp = a.type === 'VariableDeclarator' || a.type === 'Property' ? null : prop;
      if (!dv(c, va, vb, path, childProp)) return false;
    } else if (va !== vb) return false;
  }
  return true;
}

function dvObject(c: DvCtx, a: AnyNode, b: AnyNode, path: string[]): boolean {
  const props = (o: AnyNode, src: string): Map<string, AnyNode> => {
    const m = new Map<string, AnyNode>();
    for (const p of o.properties ?? []) {
      if (p.type === 'SpreadElement') {
        m.set(`...${collapse(src.slice(p.start, p.end))}`, p);
        continue;
      }
      const k = propKey(p);
      if (k === null) return new Map([['\0bad', p]]);
      m.set(k, p);
    }
    return m;
  };
  const pa = props(a, c.srcA);
  const pb = props(b, c.srcB);
  if (pa.has('\0bad') || pb.has('\0bad')) return false;
  let ok = true;
  for (const [k, vb] of pb) {
    const va = pa.get(k);
    if (k.startsWith('...')) {
      if (!va) ok = false;
      continue;
    }
    if (!va) {
      const l = litOf(vb.value);
      dvPush(
        c,
        path,
        `${propLabel(k)} set to ${l !== null ? quote(l, 30) : 'a formula'}`,
        l !== null ? 'W1' : 'W2'
      );
      continue;
    }
    if (!dv(c, va.value, vb.value, path, k)) {
      dvPush(c, path, `${propLabel(k)} changed`, 'W2');
    }
  }
  for (const [k, va] of pa) {
    if (k.startsWith('...')) {
      if (!pb.has(k)) ok = false;
      continue;
    }
    if (!pb.has(k)) {
      const l = litOf(va.value);
      dvPush(c, path, `${propLabel(k)} removed${l !== null ? ` (was ${quote(l, 30)})` : ''}`);
    }
  }
  return ok;
}

function dvArray(c: DvCtx, a: AnyNode, b: AnyNode, path: string[]): boolean {
  const ea: AnyNode[] = (a.elements ?? []).filter(Boolean);
  const eb: AnyNode[] = (b.elements ?? []).filter(Boolean);
  const textA = (n: AnyNode) => collapse(c.srcA.slice(n.start, n.end));
  const textB = (n: AnyNode) => collapse(c.srcB.slice(n.start, n.end));
  const describeItem = (n: AnyNode): string => {
    const nm = itemName(n);
    if (nm) return quote(nm, 30);
    const l = litOf(n);
    return l !== null ? quote(l, 30) : 'an item';
  };
  const named = (l: AnyNode[]): boolean => {
    const ids = l.map(itemName);
    return l.length > 0 && ids.every((x) => x !== null) && new Set(ids).size === ids.length;
  };
  const ok = true;
  const modify = (x: AnyNode, y: AnyNode, nm: string | null): void => {
    const sub = nm ? [...path, quote(nm, 30)] : path;
    if (!dv(c, x, y, sub, null)) {
      dvPush(c, sub, 'Changed', 'W2');
    }
  };
  if (named(ea) && named(eb)) {
    const mapA = new Map(ea.map((n) => [itemName(n) as string, n]));
    const mapB = new Map(eb.map((n) => [itemName(n) as string, n]));
    for (const [k, nb] of mapB) {
      const na = mapA.get(k);
      if (!na) dvPush(c, path, `${describeItem(nb)} added`);
      else if (textA(na) !== textB(nb)) modify(na, nb, k);
    }
    for (const [k, na] of mapA) if (!mapB.has(k)) dvPush(c, path, `${describeItem(na)} removed`);
    return ok;
  }
  // positional with an LCS over the item source
  const ta = ea.map(textA);
  const tb = eb.map(textB);
  let lo = 0;
  while (lo < ta.length && lo < tb.length && ta[lo] === tb[lo]) lo++;
  let ha = ta.length;
  let hb = tb.length;
  while (ha > lo && hb > lo && ta[ha - 1] === tb[hb - 1]) {
    ha--;
    hb--;
  }
  const midA = ea.slice(lo, ha);
  const midB = eb.slice(lo, hb);
  if (midA.length === midB.length) {
    midA.forEach((x, i) => {
      modify(x, midB[i] as AnyNode, itemName(x));
    });
  } else {
    for (const x of midB) dvPush(c, path, `${describeItem(x)} added`);
    for (const x of midA) dvPush(c, path, `${describeItem(x)} removed`);
  }
  return ok;
}

// ── the TSX lane ────────────────────────────────────────────────────────────────────────────

const canvasChange = (words = 'Changed this canvas', kind: ChangeKind = 'canvas'): Change => ({
  artboards: [],
  grade: 'F',
  kind,
  words,
});

function dsOf(importLine: string): string | null {
  const m =
    /from\s+['"]([^'"]+)['"]/.exec(importLine) ?? /import\s+['"]([^'"]+)['"]/.exec(importLine);
  if (!m) return null;
  const d = /(?:^|\/)system\/([^/]+)\//.exec(m[1] as string);
  return d ? (d[1] as string) : null;
}

export function describeTsx(
  canvas: string,
  before: TsxModel | null,
  after: TsxModel | null,
  opts: WordsOptions = {}
): Change[] {
  if (!before || !after) return [canvasChange()];
  if (before.parsed.src === after.parsed.src) return [];
  const out: Change[] = [];
  const mk = (mode: Env['mode'], artboards: string[], prefix = ''): Env => ({
    canvas,
    words: opts,
    mode,
    artboards,
    prefix,
    model: after,
  });

  // artboards
  const aBy = new Map(before.artboards.map((a) => [a.key, a]));
  const bBy = new Map(after.artboards.map((a) => [a.key, a]));
  const pairs: Array<[El, El]> = [];
  const keysChanged: string[] = [];
  for (const b of after.artboards) {
    const a = aBy.get(b.key);
    if (!a || a.text === b.text) continue;
    const ra = before.tree(a.key);
    const rb = after.tree(b.key);
    if (ra && rb && ra.hash !== rb.hash) {
      pairs.push([ra, rb]);
      keysChanged.push(b.key);
    }
  }
  const lostA = before.artboards.filter((a) => !bBy.has(a.key));
  const newB = after.artboards.filter((b) => !aBy.has(b.key));
  // an artboard whose id changed but whose content did not
  const renamed = new Map<string, string>();
  for (const a of [...lostA]) {
    const ta = before.tree(a.key);
    if (!ta) continue;
    const hit = newB.find((b) => {
      const tb = after.tree(b.key);
      return (
        !!tb &&
        tb.kids.map((k) => k.hash).join() === ta.kids.map((k) => k.hash).join() &&
        tb.text === ta.text
      );
    });
    if (hit) {
      renamed.set(a.key, hit.key);
      newB.splice(newB.indexOf(hit), 1);
      lostA.splice(lostA.indexOf(a), 1);
    }
  }
  const env = mk('artboard', []);
  const pairing = pairs.length ? matchContainers(pairs) : null;
  if (pairing) {
    for (const [ra, rb] of pairs) {
      const key = abKeyOf(rb);
      diffPair(env, ra, rb, key, out); // the artboard's own settings
      diffContainer(env, ra, rb, pairing, out);
    }
  }
  for (const [from, to] of renamed) {
    out.push({
      artboards: [to],
      grade: 'W1',
      kind: 'artboard-renamed',
      words: `Artboard ${quote(artboardLabel(before, from))} renamed to ${quote(artboardLabel(after, to))}`,
    });
  }
  for (const a of lostA)
    out.push({
      artboards: [a.key],
      grade: 'W1',
      kind: 'artboard-removed',
      words: `Artboard ${quote(artboardLabel(before, a.key))} removed`,
    });
  for (const b of newB)
    out.push({
      artboards: [b.key],
      grade: 'W1',
      kind: 'artboard-added',
      words: `Artboard ${quote(artboardLabel(after, b.key))} added`,
    });

  // the canvas frame
  const fa = before.frame();
  const fb = after.frame();
  if (fa && fb && fa.hash !== fb.hash) {
    const fp = matchContainers([[fa, fb]]);
    const frameEnv = mk('frame', []);
    diffContainer(frameEnv, fa, fb, fp, out);
  }

  // declarations
  const aDecls = new Map(before.decls.map((d) => [d.key, d]));
  for (const db of after.decls) {
    const da = aDecls.get(db.key);
    if (!da || da.src === db.src) continue;
    const reach = [...new Set([...before.reach(db.key), ...after.reach(db.key)])];
    const base = nameInWords(db.names[0] ?? 'declaration');
    const lines: Change[] = [];
    const denv = mk('decl', reach, `${base} › `);
    let described = false;
    const ja = outerJsxNodes(da.node);
    const jb = outerJsxNodes(db.node);
    let jsxSame = true;
    if (ja.length || jb.length) {
      const ra = buildRoots(ja, before.parsed.src, { comp: db.names[0] });
      const rb = buildRoots(jb, after.parsed.src, { comp: db.names[0] });
      if (ra.hash !== rb.hash) {
        jsxSame = false;
        const dp = matchContainers([[ra, rb]]);
        diffContainer(denv, ra, rb, dp, lines);
      }
    }
    // literals and structure outside the JSX (data arrays, constants, strings in code)
    const c: DvCtx = {
      srcA: before.parsed.src,
      srcB: after.parsed.src,
      base,
      out: lines,
      artboards: reach,
      words: opts,
    };
    const shape = dv(c, da.node, db.node, [], null);
    described = lines.length > 0 || (jsxSame && shape);
    if (lines.length) out.push(...lines);
    else if (!described) {
      if (reach.length) {
        for (const k of reach)
          out.push({
            artboards: [k],
            grade: 'F',
            kind: 'layout',
            words: `Changed layout in ${artboardLabel(after.artboards.some((x) => x.key === k) ? after : before, k)}`,
          });
      } else out.push(canvasChange());
    }
  }

  // module-level leftovers and imports
  const restChanged = before.rest !== after.rest;
  const importsChanged = before.imports.join('\n') !== after.imports.join('\n');
  if (importsChanged) {
    const dsA = new Set(before.imports.map(dsOf).filter(Boolean) as string[]);
    const dsB = new Set(after.imports.map(dsOf).filter(Boolean) as string[]);
    const gained = [...dsB].filter((d) => !dsA.has(d));
    if (gained.length && dsA.size) {
      out.push({
        artboards: [],
        grade: 'W1',
        kind: 'imports',
        words: `Now uses the ${wordsOf(gained[0] as string)} design system`,
      });
    } else if (!out.length && !restChanged) {
      out.push(canvasChange('Changed this canvas', 'imports'));
    }
  }
  if (restChanged) out.push(canvasChange());
  if (!out.length) {
    // The sources differ but nothing visible did (formatting, type-only code): no change lines.
    return [];
  }
  return out;
}

export function describeChanges(
  canvas: string,
  before: Lanes,
  after: Lanes,
  opts: DescribeOptions = {}
): { changes: Change[]; ms: number } {
  const t0 = performance.now();
  // Models are parsed on first use and shared when both sides carry the same TSX, so a CSS-, meta- or
  // annotations-only version costs at most one parse (S1.10; an unchanged side is never parsed twice).
  let mb: TsxModel | null | undefined;
  let ma: TsxModel | null | undefined;
  const getBefore = (): TsxModel | null => {
    if (mb === undefined) mb = parseModel(before.tsx);
    return mb;
  };
  const getAfter = (): TsxModel | null => {
    if (ma === undefined) ma = before.tsx === after.tsx ? getBefore() : parseModel(after.tsx);
    return ma;
  };
  const changes =
    before.tsx === after.tsx ? [] : describeTsx(canvas, getBefore(), getAfter(), opts);
  const ctx: LaneContext = {
    canvas,
    before,
    after,
    get modelBefore() {
      return getBefore();
    },
    get modelAfter() {
      return getAfter();
    },
    opts,
  };
  for (const lane of opts.lanes ?? []) changes.push(...lane(ctx));
  return { changes, ms: performance.now() - t0 };
}
