// Which artboards did an edit change? — V2-1.5 §5.7 `attributeArtboards` (S5.5).
//
// The AST answer, never a text match: the `diffArtboardIds` regex lit EVERY
// artboard for 92–94 % of out-of-artboard changes and matched `<DCArtboard`
// inside a code-sample string (V2-1.5 §6). Here both sides are parsed (oxc):
//
//   - a change inside an artboard's element marks that artboard;
//   - a change inside a named declaration outside every artboard (top level,
//     or local to the canvas component) marks EVERY artboard whose JSX
//     transitively references it (`<K/>`, `K.x`, `useK()` — identifiers only,
//     so a name inside a string literal never counts);
//   - an added, removed or renamed artboard marks that id
//     (`artboard-set-changed`);
//   - imports, any other module-level change and a parse error give the whole
//     file (`scope: 'file'`, every artboard).
//
// It drives the live rings, a run's `touched` set (the A4 queue and leases),
// `project:action.artboards`, the Undo history highlight, Version history
// rows and "Made by AI". Pure and synchronous; budget ≤ 50 ms on the largest
// v2 canvas (V2-1.5 §5.8).

import { parseSync } from 'oxc-parser';

// biome-ignore lint/suspicious/noExplicitAny: oxc-parser AST nodes are heterogeneous.
type AnyNode = any;

export interface Attribution {
  /** DCArtboard ids (document order of the newer side). */
  artboards: string[];
  scope: 'artboards' | 'file';
  reason?: 'imports' | 'module-scope' | 'artboard-set-changed' | 'parse-error';
}

interface Unit {
  key: string;
  start: number;
  end: number;
  /** Identifiers this unit's code references. */
  refs: Set<string>;
}

interface Side {
  artboards: Unit[];
  /** declaration name → unit (several names can share one statement). */
  decls: Map<string, Unit>;
  imports: string;
  /** The source with every artboard / declaration span replaced by its key. */
  rest: string;
}

const isNode = (v: unknown): v is AnyNode =>
  !!v && typeof v === 'object' && typeof (v as AnyNode).type === 'string';

function jsxName(n: AnyNode): string | null {
  if (!n) return null;
  if (n.type === 'JSXIdentifier') return String(n.name);
  if (n.type === 'JSXMemberExpression') return jsxName(n.object);
  if (n.type === 'JSXNamespacedName') return null;
  return null;
}

/** Every identifier a subtree references (property keys and attribute names excluded). */
function refsOf(root: AnyNode): Set<string> {
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
      case 'JSXOpeningElement':
      case 'JSXClosingElement': {
        const name = jsxName(n.name);
        if (name) out.add(name);
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
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      if (Array.isArray(v)) for (const c of v) walk(c, n, k);
      else if (isNode(v)) walk(v, n, k);
    }
  };
  walk(root, null, '');
  return out;
}

function artboardId(el: AnyNode): string | null {
  const opening = el.openingElement;
  if (jsxName(opening?.name) !== 'DCArtboard') return null;
  for (const a of opening.attributes ?? []) {
    if (a?.type !== 'JSXAttribute' || a.name?.name !== 'id') continue;
    const v = a.value;
    if (v?.type === 'Literal' && typeof v.value === 'string') return v.value;
    if (v?.type === 'StringLiteral') return String(v.value);
    if (v?.type === 'JSXExpressionContainer' && v.expression?.type === 'Literal')
      return typeof v.expression.value === 'string' ? v.expression.value : null;
    return null;
  }
  return null;
}

/** Outermost DCArtboard elements under `root` (an id-less one → null id). */
function findArtboards(root: AnyNode): Array<{ id: string | null; node: AnyNode }> {
  const out: Array<{ id: string | null; node: AnyNode }> = [];
  const walk = (n: AnyNode): void => {
    if (!isNode(n)) return;
    if (n.type === 'JSXElement' && jsxName(n.openingElement?.name) === 'DCArtboard') {
      out.push({ id: artboardId(n), node: n });
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (isNode(v)) walk(v);
    }
  };
  walk(root);
  return out;
}

/** Names a declaration statement binds. */
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

/** The function body of a top-level statement, when it is a function. */
function functionBody(s: AnyNode): AnyNode | null {
  if (!isNode(s)) return null;
  if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration')
    return functionBody(s.declaration);
  if (
    s.type === 'FunctionDeclaration' ||
    s.type === 'FunctionExpression' ||
    s.type === 'ArrowFunctionExpression'
  )
    return s.body?.type === 'BlockStatement' ? s.body : null;
  if (s.type === 'VariableDeclaration' && s.declarations?.length === 1)
    return functionBody(s.declarations[0].init);
  return null;
}

function parseSide(source: string, file: string): Side | null {
  let parsed: AnyNode;
  try {
    parsed = parseSync(file.endsWith('.tsx') ? file : `${file}.tsx`, source, {
      sourceType: 'module',
    });
  } catch {
    return null;
  }
  if (parsed.errors?.length) return null;
  const program = parsed.program;
  const artboards: Unit[] = [];
  const decls = new Map<string, Unit>();
  const imports: string[] = [];
  const spans: Array<{ start: number; end: number; key: string }> = [];

  for (const ab of findArtboards(program)) {
    const key = ab.id ?? `#${ab.node.start}`;
    const u = { key, start: ab.node.start, end: ab.node.end, refs: refsOf(ab.node) };
    artboards.push(u);
    spans.push({ ...u, key: `\uE000ab:${key}\uE000` });
  }
  const insideArtboard = (n: AnyNode) =>
    artboards.some((a) => n.start <= a.start && a.end <= n.end);
  const addDecl = (s: AnyNode, scope: string) => {
    const names = declaredNames(s);
    if (!names.length) return false;
    const key = `${scope}${names.join(',')}`;
    const u = { key, start: s.start, end: s.end, refs: refsOf(s) };
    for (const n of names) decls.set(n, u);
    spans.push({ start: s.start, end: s.end, key: `\uE000decl:${key}\uE000` });
    return true;
  };

  for (const s of program.body ?? []) {
    if (s.type === 'ImportDeclaration') {
      imports.push(source.slice(s.start, s.end));
      spans.push({ start: s.start, end: s.end, key: '\uE000import\uE000' });
      continue;
    }
    if (!insideArtboard(s)) {
      addDecl(s, '');
      continue;
    }
    // The canvas component: its own local declarations are units too, its
    // remaining code (the DesignCanvas / DCSection wrapper) is module scope.
    const body = functionBody(s);
    if (!body) continue;
    for (const inner of body.body ?? []) {
      if (insideArtboard(inner)) continue;
      addDecl(inner, `${declaredNames(s)[0] ?? ''}/`);
    }
  }

  // The rest: everything no unit covers (outermost spans only).
  // A comment between units changes no artboard: it is blanked out of the rest.
  for (const c of parsed.comments ?? [])
    if (Number.isFinite(c?.start) && Number.isFinite(c?.end))
      spans.push({ start: c.start, end: c.end, key: ' ' });
  spans.sort((x, y) => x.start - y.start || y.end - x.end);
  let rest = '';
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start < cursor) continue;
    rest += source.slice(cursor, sp.start) + sp.key;
    cursor = sp.end;
  }
  rest += source.slice(cursor);
  return { artboards, decls, imports: imports.join('\n'), rest: rest.replace(/\s+/g, ' ') };
}

const text = (src: string, u: Unit) => src.slice(u.start, u.end);

/** Every artboard id of a source, document order (no parse → []). */
export function artboardIdsOf(source: string, file = 'canvas.tsx'): string[] {
  const side = parseSide(source, file);
  return side ? side.artboards.map((a) => a.key).filter((k) => !k.startsWith('#')) : [];
}

export function attributeArtboards(file: string, before: string, after: string): Attribution {
  const b = parseSide(before, file);
  const a = parseSide(after, file);
  const allOf = (s: Side | null) =>
    (s?.artboards ?? []).map((u) => u.key).filter((k) => !k.startsWith('#'));
  if (!a || !b) {
    const all = [...new Set([...allOf(a), ...allOf(b)])];
    return { artboards: all, scope: 'file', reason: 'parse-error' };
  }
  const every = [...new Set([...allOf(a), ...allOf(b)])];
  if (before === after) return { artboards: [], scope: 'artboards' };
  if (a.imports !== b.imports) return { artboards: every, scope: 'file', reason: 'imports' };
  // What no unit covers. An added / removed / renamed artboard or declaration
  // only moves a placeholder — that is the unit set, judged below.
  const strip = (s: Side) =>
    s.rest.replace(/\uE000(ab|decl):[^\uE000]*\uE000/g, ' ').replace(/\s+/g, ' ');
  const idless = [...a.artboards, ...b.artboards].some((u) => u.key.startsWith('#'));
  // An artboard without a literal id cannot be named, so any change is the file's.
  if (strip(a) !== strip(b) || idless)
    return { artboards: every, scope: 'file', reason: 'module-scope' };

  const marked = new Set<string>();
  let setChanged = false;
  const bAb = new Map(b.artboards.map((u) => [u.key, u]));
  const aAb = new Map(a.artboards.map((u) => [u.key, u]));
  for (const [k, u] of aAb) {
    const old = bAb.get(k);
    if (!old) {
      marked.add(k);
      setChanged = true;
    } else if (text(after, u) !== text(before, old)) marked.add(k);
  }
  for (const k of bAb.keys())
    if (!aAb.has(k)) {
      marked.add(k);
      setChanged = true;
    }

  // Changed declarations, then the reference closure over both sides' graphs.
  const changed = new Set<string>();
  for (const name of new Set([...a.decls.keys(), ...b.decls.keys()])) {
    const ua = a.decls.get(name);
    const ub = b.decls.get(name);
    if (!ua || !ub || text(after, ua) !== text(before, ub)) changed.add(name);
  }
  if (changed.size) {
    const affected = new Set(changed);
    const graph = [...a.decls, ...b.decls];
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, u] of graph) {
        if (affected.has(name)) continue;
        for (const r of u.refs)
          if (affected.has(r)) {
            affected.add(name);
            grew = true;
            break;
          }
      }
    }
    for (const u of [...a.artboards, ...b.artboards]) {
      if (u.key.startsWith('#')) continue;
      for (const r of u.refs)
        if (affected.has(r)) {
          marked.add(u.key);
          break;
        }
    }
  }
  const order = [...a.artboards.map((u) => u.key), ...b.artboards.map((u) => u.key)];
  const artboards = [...new Set(order)].filter((k) => marked.has(k) && !k.startsWith('#'));
  return {
    artboards,
    scope: 'artboards',
    ...(setChanged ? { reason: 'artboard-set-changed' as const } : {}),
  };
}
