// edit-ops/scope-names.ts — P8 C7 (14 ed-ab-menu, clipboard): which names an object READS from the code around it.
//
// A pasted object that reads `{title}` or `props.items` out of the component it was copied from renders an error
// card where it lands (the name is not there). The clipboard asks these questions of the source text:
//   freeRefsOf(source, from, to)  #122 — every read of a name the range does not declare itself (identifiers, JSX
//                                 tag roots, TS type references), with its position and where it is declared:
//                                 `import` / `module` (carried by edit-ops/clip-carry.ts) or `function` / `global`
//   needsOf(source, from, to)     the `function` names of those: a parameter, hook state, the component's local
//                                 const — what a paste elsewhere can not carry
//   scopeAt(source, pos)          the names a spot can see: the module's own and every function scope around it
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

/** Where a module-level name comes from: an import, or a declaration of the module itself. */
type ModuleKind = 'import' | 'module';

/** Names the module itself declares at its top level: imports, functions, classes, var / let / const, types. */
function moduleKinds(program: Node): Map<string, ModuleKind> {
  const out = new Map<string, ModuleKind>();
  const names = new Set<string>();
  const declare = (d: unknown) => {
    if (!isNode(d)) return;
    if (d.type === 'ImportDeclaration') {
      for (const s of (d.specifiers as unknown[]) ?? [])
        if (isNode(s) && isNode(s.local)) out.set(String(s.local.name), 'import');
    } else if (d.type === 'VariableDeclaration') {
      for (const v of (d.declarations as unknown[]) ?? []) if (isNode(v)) patternNames(v.id, names);
    } else if (
      (d.type === 'FunctionDeclaration' ||
        d.type === 'ClassDeclaration' ||
        d.type === 'TSTypeAliasDeclaration' ||
        d.type === 'TSInterfaceDeclaration' ||
        d.type === 'TSEnumDeclaration') &&
      isNode(d.id)
    ) {
      names.add(String(d.id.name));
    } else if (d.type === 'ExportNamedDeclaration' || d.type === 'ExportDefaultDeclaration') {
      declare(d.declaration);
    }
  };
  for (const d of (program.body as unknown[]) ?? []) declare(d);
  for (const n of names) if (!out.has(n)) out.set(n, 'module');
  return out;
}

function moduleNames(program: Node): Set<string> {
  return new Set(moduleKinds(program).keys());
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

/**
 * #122 (122-A) — the names the range `[from, to)` reads that a FUNCTION around it declares (a parameter, hook
 * state, the component's local const): `freeRefsOf`'s `function` names. Module-level names are not needs any
 * more — the clipboard carries them (edit-ops/clip-carry.ts). Null when the text does not parse.
 */
export function needsOf(source: string, from: number, to: number): string[] | null {
  const refs = freeRefsOf(source, from, to);
  if (!refs) return null;
  return [...new Set(refs.filter((r) => r.scope === 'function').map((r) => r.name))].sort();
}

/** Where a name a range reads is declared (contract 122 §5.1). */
export type RefScope = 'import' | 'module' | 'function' | 'global';

/** One read of a name the range does not declare itself, at its place in the source. */
export interface FreeRef {
  name: string;
  start: number;
  end: number;
  /** a JSX tag name (`<Card>`, `</Card>`, the `Icons` of `<Icons.Star>`) */
  jsx: boolean;
  /** an object shorthand (`{ W }`): renaming it writes `W: W2` */
  shorthand: boolean;
  scope: RefScope;
}

/** A parsed module, for asking several ranges of it with one parse. */
export interface ScopeModule {
  readonly source: string;
  readonly program: unknown;
}

export function scopeModule(source: string): ScopeModule | null {
  const program = parse(source);
  return program ? { source, program } : null;
}

/** The type parameters a generic node declares (`<T>`). */
function typeParamNames(n: Node, out: Set<string>): void {
  const tp = n.typeParameters;
  if (!isNode(tp)) return;
  for (const p of (tp.params as unknown[]) ?? []) {
    if (!isNode(p)) continue;
    const name = p.name;
    if (isNode(name)) out.add(String(name.name));
    else if (typeof name === 'string') out.add(name);
  }
}

/**
 * What one function declares for its own body, exactly: its parameters and type parameters, its own name when
 * it is an expression, and every declaration inside it outside nested functions (blocks lumped in).
 */
function ownScopeNames(fn: Node): Set<string> {
  const out = new Set<string>();
  for (const p of (fn.params as unknown[]) ?? []) patternNames(p, out);
  if (fn.type !== 'FunctionDeclaration' && isNode(fn.id)) out.add(String(fn.id.name));
  typeParamNames(fn, out);
  const walk = (n: Node) => {
    if (n.type === 'VariableDeclarator') patternNames(n.id, out);
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && isNode(n.id))
      out.add(String(n.id.name));
    if (n.type === 'CatchClause') patternNames(n.param, out);
    if (FUNCTIONS.has(n.type)) return; // its own scope
    for (const c of kids(n)) walk(c);
  };
  if (isNode(fn.body)) walk(fn.body);
  return out;
}

/** Nodes whose non-computed `key` is a NAME, never a read. */
const KEY_NODES = new Set([
  'Property',
  'MethodDefinition',
  'PropertyDefinition',
  'AccessorProperty',
  'TSPropertySignature',
  'TSMethodSignature',
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSAbstractAccessorProperty',
]);
/** Nodes the walk never enters: they bind or name, they do not read. */
const SKIP_NODES = new Set([
  'ImportDeclaration',
  'ExportSpecifier',
  'MetaProperty',
  'TSModuleDeclaration',
  'TSImportType',
  'JSXNamespacedName',
]);

/** A JSX element name's root read: `Card`, the `Icons` of `<Icons.Star>`; null for an intrinsic tag. */
function jsxRoot(n: unknown): Node | null {
  if (!isNode(n)) return null;
  if (n.type === 'JSXIdentifier') {
    const name = String(n.name);
    return /^[a-z]/.test(name) || name.includes('-') ? null : n;
  }
  if (n.type === 'JSXMemberExpression') {
    let o: unknown = n.object;
    while (isNode(o) && o.type === 'JSXMemberExpression') o = o.object;
    return isNode(o) && o.type === 'JSXIdentifier' ? o : null;
  }
  return null;
}

type Scope = { node: Node; names: Set<string> };

/** `freeRefsOf` over an already parsed module. */
export function freeRefsIn(mod: ScopeModule, from: number, to: number): FreeRef[] {
  const program = mod.program as Node;
  const kinds = moduleKinds(program);
  const out: FreeRef[] = [];
  const chain: Scope[] = [];
  const record = (name: string, at: Node, jsx: boolean, shorthand: boolean) => {
    if (at.start < from || at.end > to) return;
    const ref = { name, start: at.start, end: at.end, jsx, shorthand };
    for (let i = chain.length - 1; i >= 0; i--) {
      const s = chain[i] as Scope;
      if (!s.names.has(name)) continue;
      if (s.node.start >= from && s.node.end <= to) return; // the range declares it itself
      out.push({ ...ref, scope: 'function' });
      return;
    }
    out.push({ ...ref, scope: kinds.get(name) ?? 'global' });
  };
  const each = (n: Node, skip?: (k: string) => boolean) => {
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent' || skip?.(k)) continue;
      if (Array.isArray(v)) {
        for (const c of v) if (isNode(c)) walk(c);
      } else if (isNode(v)) walk(v);
    }
  };
  const walk = (n: Node, shorthand = false): void => {
    if (n.end <= from || n.start >= to || SKIP_NODES.has(n.type)) return;
    let scope: Scope | null = null;
    if (FUNCTIONS.has(n.type)) scope = { node: n, names: ownScopeNames(n) };
    else if (isNode(n.typeParameters) && n.typeParameters.type === 'TSTypeParameterDeclaration') {
      scope = { node: n, names: new Set() };
      typeParamNames(n, scope.names);
    }
    if (scope) chain.push(scope);
    try {
      visit(n, shorthand);
    } finally {
      if (scope) chain.pop();
    }
  };
  const visit = (n: Node, shorthand: boolean): void => {
    const sub = (v: unknown) => {
      if (isNode(v)) walk(v);
    };
    switch (n.type) {
      case 'Identifier':
        record(String(n.name), n, false, shorthand);
        sub(n.typeAnnotation);
        return;
      case 'MemberExpression':
        sub(n.object);
        if (n.computed) sub(n.property);
        return;
      case 'LabeledStatement':
        sub(n.body);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
        return;
      case 'TSQualifiedName':
        sub(n.left);
        return;
      case 'TSTypeParameter':
        sub(n.constraint);
        sub(n.default);
        return;
      case 'TSEnumMember':
        sub(n.initializer);
        return;
      case 'AssignmentPattern':
        if (isNode(n.left)) walk(n.left, shorthand);
        sub(n.right);
        return;
      case 'JSXOpeningElement':
      case 'JSXClosingElement': {
        const root = jsxRoot(n.name);
        if (root) record(String(root.name), root, true, false);
        for (const a of (n.attributes as unknown[]) ?? []) sub(a);
        sub(n.typeArguments);
        return;
      }
      case 'JSXAttribute':
        sub(n.value);
        return;
      default:
    }
    if (n.type === 'Property' && n.shorthand) {
      if (isNode(n.value)) walk(n.value, true);
      return;
    }
    if (KEY_NODES.has(n.type)) each(n, (k) => k === 'key' && !n.computed);
    else each(n);
  };
  walk(program);
  return out;
}

/**
 * #122 (122-A) — every read in `[from, to)` of a name the range does not declare itself, with its position and
 * where it is declared: an `import`, a `module`-level declaration, a `function` around the range, or nothing
 * (`global`). JSX tag roots (`<Card>`, `</Card>`, `<Icons.Star>` → `Icons`) and TS type references count.
 * Null when the text does not parse.
 */
export function freeRefsOf(source: string, from: number, to: number): FreeRef[] | null {
  const mod = scopeModule(source);
  return mod ? freeRefsIn(mod, from, to) : null;
}

/** #122 — the names the FUNCTIONS around `pos` declare (never the module's): what shadows a module name there. */
export function functionScopeAt(source: string, pos: number): Set<string> | null {
  const program = parse(source);
  if (!program) return null;
  const out = new Set<string>();
  const around = (n: Node) => {
    if (FUNCTIONS.has(n.type) && n.start <= pos && pos <= n.end)
      for (const name of ownScopeNames(n)) out.add(name);
    for (const c of kids(n)) if (c.start <= pos && pos <= c.end) around(c);
  };
  around(program);
  return out;
}
