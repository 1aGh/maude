// edit-ops/scope-names.ts — P8 C7 (14 ed-ab-menu, clipboard): which names an object READS from the code around it.
//
// A pasted object that reads `{title}` or `props.items` out of the component it was copied from renders an error
// card where it lands (the name is not there). The clipboard asks two questions of the source text, no more:
//   needsOf(source, from, to)   the names the range reads that something around it declares (a parameter, a local
//                               const, a module-level helper, an import) — not names the range declares itself
//   scopeAt(source, pos)        the names a spot can see: the module's own and every function scope around it
// A paste whose `needs` the target cannot see is refused in words, nothing written. Plain-JS AST walk, no scope
// analyser: an over-wide `scopeAt` never refuses what would work, only what plainly would not.

import { parseSync } from 'oxc-parser';

type Node = { type: string; start: number; end: number; [k: string]: unknown };

const isNode = (v: unknown): v is Node =>
  v !== null && typeof v === 'object' && typeof (v as Node).type === 'string';

function parse(source: string): Node | null {
  try {
    const r = parseSync('scope.tsx', source, { sourceType: 'module' });
    if (r.errors?.length) return null;
    return r.program as unknown as Node;
  } catch {
    return null;
  }
}

/** Every child node of `n`, any property. */
function* kids(n: Node): Generator<Node> {
  for (const [k, v] of Object.entries(n)) {
    if (k === 'parent') continue;
    if (Array.isArray(v)) {
      for (const c of v) if (isNode(c)) yield c;
    } else if (isNode(v)) yield v;
  }
}

/** The names a binding pattern declares. */
function patternNames(p: unknown, out: Set<string>): void {
  if (!isNode(p)) return;
  switch (p.type) {
    case 'Identifier':
      out.add(String(p.name));
      return;
    case 'ObjectPattern':
      for (const prop of (p.properties as unknown[]) ?? []) {
        if (!isNode(prop)) continue;
        patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      }
      return;
    case 'ArrayPattern':
      for (const e of (p.elements as unknown[]) ?? []) patternNames(e, out);
      return;
    case 'RestElement':
      patternNames(p.argument, out);
      return;
    case 'AssignmentPattern':
      patternNames(p.left, out);
      return;
    default:
  }
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** What a function declares for its body: its parameters, its own name, and every var / let / const inside it. */
function functionNames(fn: Node, out: Set<string>): void {
  for (const p of (fn.params as unknown[]) ?? []) patternNames(p, out);
  if (isNode(fn.id)) out.add(String(fn.id.name));
  const walk = (n: Node) => {
    if (n.type === 'VariableDeclarator') patternNames(n.id, out);
    if (n.type === 'FunctionDeclaration' && n !== fn && isNode(n.id)) out.add(String(n.id.name));
    for (const c of kids(n)) walk(c);
  };
  if (isNode(fn.body)) walk(fn.body);
}

/** Names the module itself declares at its top level: imports, functions, classes, var / let / const. */
function moduleNames(program: Node): Set<string> {
  const out = new Set<string>();
  const declare = (d: unknown) => {
    if (!isNode(d)) return;
    if (d.type === 'ImportDeclaration') {
      for (const s of (d.specifiers as unknown[]) ?? [])
        if (isNode(s) && isNode(s.local)) out.add(String(s.local.name));
    } else if (d.type === 'VariableDeclaration') {
      for (const v of (d.declarations as unknown[]) ?? []) if (isNode(v)) patternNames(v.id, out);
    } else if (
      (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') &&
      isNode(d.id)
    ) {
      out.add(String(d.id.name));
    } else if (d.type === 'ExportNamedDeclaration' || d.type === 'ExportDefaultDeclaration') {
      declare(d.declaration);
    }
  };
  for (const d of (program.body as unknown[]) ?? []) declare(d);
  return out;
}

/** The names a spot can see: the module's and those of every function around `pos`. Null when the text does not parse. */
export function scopeAt(source: string, pos: number): Set<string> | null {
  const program = parse(source);
  if (!program) return null;
  const out = moduleNames(program);
  const around = (n: Node) => {
    if (FUNCTIONS.has(n.type) && n.start <= pos && pos <= n.end) functionNames(n, out);
    for (const c of kids(n)) if (c.start <= pos && pos <= c.end) around(c);
  };
  around(program);
  return out;
}

/** Names the range `[from, to)` reads that something around it declares. Null when the text does not parse. */
export function needsOf(source: string, from: number, to: number): string[] | null {
  const program = parse(source);
  if (!program) return null;
  const outer = scopeAt(source, from);
  if (!outer) return null;
  const own = new Set<string>(); // names the range declares itself (a map callback's parameter, a local const)
  const reads = new Set<string>();
  const walk = (n: Node, parent: Node | null, key: string) => {
    if (n.end <= from || n.start >= to) {
      for (const c of kids(n)) if (c.end > from && c.start < to) walk(c, n, '');
      return;
    }
    const inside = n.start >= from && n.end <= to;
    if (inside && FUNCTIONS.has(n.type)) functionNames(n, own);
    if (inside && n.type === 'VariableDeclarator') patternNames(n.id, own);
    if (n.type === 'Identifier') {
      const name = String(n.name);
      const isProp =
        parent &&
        ((parent.type === 'MemberExpression' && parent.property === n && !parent.computed) ||
          (parent.type === 'Property' &&
            parent.key === n &&
            !parent.computed &&
            !parent.shorthand) ||
          (parent.type === 'JSXAttribute' && key === 'name'));
      if (!isProp && n.start >= from && n.end <= to) reads.add(name);
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent') continue;
      if (Array.isArray(v)) {
        for (const c of v) if (isNode(c)) walk(c, n, k);
      } else if (isNode(v)) walk(v, n, k);
    }
  };
  walk(program, null, '');
  return [...reads].filter((r) => outer.has(r) && !own.has(r)).sort();
}
