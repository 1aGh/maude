#!/usr/bin/env node
// Move-only refactoring tool for the V2-0.2 split of apps/studio/client/app.jsx.
//
// It moves code VERBATIM — the only text it adds is `export`, `import` lines, a hook /
// render-function wrapper and its call site — and refuses any move it cannot prove is
// behaviour-identical. Binding resolution uses the TypeScript checker (scope-correct, so a
// shadowed name or a property key is never mistaken for a variable reference).
//
//   top     move top-level declarations into a module
//           move.mjs top --file <src> --to <module> --names A,B,C
//   hook    move a contiguous run of statements inside a component body into a custom hook,
//           called at the same position (hook order unchanged)
//           move.mjs hook --file <src> --fn App --lines 13338-14404 --name useDgnListener --to <module>
//   render  move one JSX expression inside a component's render into a plain render function
//           (NOT a component — no new fiber), called in place: {renderX({...})}
//           move.mjs render --file <src> --fn App --lines 16200-16330 --name renderMenubar --to <module>
//
// Common flags: --dry-run (print the plan, write nothing).
//
// Refusals (exit 1, nothing written):
//   · a moved top-level declaration needs another top-level declaration that stays in <src>
//     (would make an import cycle) — move that one first or together;
//   · hook/render: the run reads a component-local `const` declared AFTER the run (TDZ at the
//     call site), or a `let`/`var` that is written anywhere (a by-value copy would go stale),
//     or writes a component-local, or contains a top-level `return`;
//   · hook: a binding declared by the run is reassigned after it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(REPO, 'apps/studio/package.json'));
const ts = require('typescript');

const argv = process.argv.slice(2);
const OP = argv[0];
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DRY = argv.includes('--dry-run');
const FILE = resolve(opt('--file') ?? '');
const TO = opt('--to') ? resolve(opt('--to')) : null;

function fail(msg) {
  console.error(`move: ${msg}`);
  process.exit(1);
}
if (!['top', 'hook', 'render'].includes(OP)) fail('usage: move.mjs top|hook|render --file <src> --to <module> …');
if (!existsSync(FILE)) fail(`no such file ${FILE}`);
if (!TO) fail('--to <module> is required');

const src = readFileSync(FILE, 'utf8');
const kindFor = (f) => (f.endsWith('.tsx') ? ts.ScriptKind.TSX : f.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JSX);
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, kindFor(FILE));
const opts = { allowJs: true, jsx: ts.JsxEmit.ReactJSX, noResolve: true, noLib: true, types: [], target: ts.ScriptTarget.Latest };
const host = ts.createCompilerHost(opts);
const origGet = host.getSourceFile.bind(host);
host.getSourceFile = (f, l, e, s) => (resolve(f) === FILE ? sf : origGet(f, l, e, s));
const program = ts.createProgram([FILE], opts, host);
const checker = program.getTypeChecker();
if (sf.parseDiagnostics?.length) fail(`parse errors in ${FILE}: ${sf.parseDiagnostics[0].messageText}`);

const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

// ── binding resolution ────────────────────────────────────────────────────────────────────
const BINDING_KINDS = new Set([
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.NamespaceImport,
]);
function declOf(id) {
  const p = id.parent;
  let sym;
  if (p && ts.isShorthandPropertyAssignment(p) && p.name === id) sym = checker.getShorthandAssignmentValueSymbol(p);
  else sym = checker.getSymbolAtLocation(id);
  const d = sym?.valueDeclaration ?? sym?.declarations?.[0];
  if (!d || !BINDING_KINDS.has(d.kind) || d.getSourceFile() !== sf) return null;
  return d;
}
function containerOf(node) {
  let n = node.parent;
  while (n && !ts.isSourceFile(n) && !ts.isFunctionLike(n)) n = n.parent;
  return n;
}
// The statement that declares a binding, directly in `body` (a Block's statements or SourceFile).
function declStatement(d) {
  let n = d;
  while (n.parent && !ts.isSourceFile(n.parent) && !ts.isBlock(n.parent)) n = n.parent;
  if (ts.isImportClause(n) || ts.isImportSpecifier(n) || ts.isNamespaceImport(n)) {
    while (!ts.isImportDeclaration(n)) n = n.parent;
  }
  return n;
}
function isConst(d) {
  let n = d;
  while (n && !ts.isVariableDeclarationList(n)) n = n.parent;
  return !!n && (n.flags & ts.NodeFlags.Const) !== 0;
}
function identifiers(nodes) {
  const out = [];
  const visit = (n) => {
    if (ts.isIdentifier(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  for (const n of nodes) visit(n);
  return out;
}
function isWrite(id) {
  const p = id.parent;
  if (ts.isBinaryExpression(p) && p.left === id && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  return false;
}
function declaredNames(stmt) {
  const names = [];
  const pat = (b) => {
    if (ts.isIdentifier(b)) names.push(b);
    else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) for (const e of b.elements) if (!ts.isOmittedExpression(e)) pat(e.name);
  };
  if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) pat(d.name);
  else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) names.push(stmt.name);
  return names;
}

// ── imports ───────────────────────────────────────────────────────────────────────────────
// For an import binding: {spec, kind: 'default'|'named'|'ns', imported, local, sideEffect?}
function importInfo(d) {
  const decl = declStatement(d);
  const spec = decl.moduleSpecifier.text;
  if (ts.isImportClause(d)) return { spec, kind: 'default', local: d.name.text };
  if (ts.isNamespaceImport(d)) return { spec, kind: 'ns', local: d.name.text };
  return { spec, kind: 'named', imported: (d.propertyName ?? d.name).text, local: d.name.text };
}
function rebase(spec, fromFile, toFile) {
  if (!spec.startsWith('.')) return spec;
  let r = relative(dirname(toFile), resolve(dirname(fromFile), spec));
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}
function importLines(infos, fromFile, toFile) {
  const bySpec = new Map();
  for (const i of infos) {
    const s = rebase(i.spec, fromFile, toFile);
    if (!bySpec.has(s)) bySpec.set(s, { def: null, ns: null, named: new Map() });
    const g = bySpec.get(s);
    if (i.kind === 'default') g.def = i.local;
    else if (i.kind === 'ns') g.ns = i.local;
    else g.named.set(i.local, i.imported);
  }
  const lines = [];
  for (const [s, g] of bySpec) {
    const named = [...g.named].map(([l, im]) => (l === im ? l : `${im} as ${l}`)).sort();
    if (g.ns) lines.push(`import ${g.def ? `${g.def}, ` : ''}* as ${g.ns} from '${s}';`);
    if (named.length || (g.def && !g.ns)) {
      const parts = [];
      if (g.def && !g.ns) parts.push(g.def);
      if (named.length) parts.push(`{ ${named.join(', ')} }`);
      lines.push(`import ${parts.join(', ')} from '${s}';`);
    }
  }
  return lines;
}

// ── text edits ────────────────────────────────────────────────────────────────────────────
// Edits are [start, end, replacement] on `src`; applied right-to-left.
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b[0] - a[0]);
  let out = text;
  let last = Infinity;
  for (const [s, e, r] of sorted) {
    if (e > last) fail('overlapping edits');
    out = out.slice(0, s) + r + out.slice(e);
    last = s;
  }
  return out;
}
const lastImportEnd = (file) => {
  const imps = file.statements.filter(ts.isImportDeclaration);
  return imps.length ? imps[imps.length - 1].end : 0;
};
function relSpec(fromFile, toFile) {
  let r = relative(dirname(fromFile), toFile);
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

// Write (or append to) the target module: header imports + body.
function writeModule(target, needImports, body, header) {
  let existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
  let lines = importLines(needImports, FILE, target);
  if (existing) {
    const tsf = ts.createSourceFile(target, existing, ts.ScriptTarget.Latest, true, kindFor(target));
    const have = new Set();
    for (const st of tsf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      const c = st.importClause;
      if (c.name) have.add(c.name.text);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) have.add(c.namedBindings.name.text);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) have.add(e.name.text);
    }
    lines = importLines(needImports.filter((i) => !have.has(i.local)), FILE, target);
    const at = lastImportEnd(tsf);
    const ins = lines.length ? `${at ? '\n' : ''}${lines.join('\n')}${at ? '' : '\n'}` : '';
    existing = existing.slice(0, at) + ins + existing.slice(at);
    return `${existing.replace(/\s*$/, '')}\n\n${body.trim()}\n`;
  }
  return `${header}${lines.length ? `${lines.join('\n')}\n\n` : ''}${body.trim()}\n`;
}

// JSX may only go to a .jsx/.tsx module (the client's own convention).
function assertJsxTarget(nodes, target) {
  if (/\.(jsx|tsx)$/.test(target)) return;
  let jsx = false;
  const visit = (n) => {
    if (jsx) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) jsx = true;
    else ts.forEachChild(n, visit);
  };
  for (const n of nodes) visit(n);
  if (jsx) fail(`the moved code contains JSX — use a .jsx target, not ${relative(REPO, target)}`);
}

function headerFor(target) {
  return `// ${relative(join(REPO, 'apps/studio/client'), target)} — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).\n\n`;
}

// Add `import { names } from '<module>'` to the source file (merging into an existing one).
function sourceImportEdit(names, target) {
  const spec = relSpec(FILE, target);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== spec) continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      const all = [...new Set([...nb.elements.map((e) => e.getText(sf)), ...names])].sort();
      return [nb.getStart(sf), nb.end, `{ ${all.join(', ')} }`];
    }
  }
  const at = lastImportEnd(sf);
  return [at, at, `\nimport { ${[...names].sort().join(', ')} } from '${spec}';`];
}

// ── op: top ───────────────────────────────────────────────────────────────────────────────
function opTop() {
  const want = new Set((opt('--names') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  if (!want.size) fail('--names is required');
  const moved = [];
  const found = new Set();
  for (const st of sf.statements) {
    const names = declaredNames(st).map((n) => n.text);
    if (!names.length) continue;
    const hit = names.filter((n) => want.has(n));
    if (!hit.length) continue;
    if (hit.length !== names.length) fail(`statement at line ${lineOf(st.getStart(sf))} declares ${names.join(', ')}; name all of them`);
    for (const n of names) found.add(n);
    moved.push(st);
  }
  for (const n of want) if (!found.has(n)) fail(`no top-level declaration named ${n}`);
  const movedSet = new Set(moved);
  const movedNames = new Set(moved.flatMap((s) => declaredNames(s).map((n) => n.text)));

  const needImports = new Map();
  const cycle = new Set();
  for (const id of identifiers(moved)) {
    const d = declOf(id);
    if (!d || !ts.isSourceFile(containerOf(d))) continue;
    const st = declStatement(d);
    if (movedSet.has(st)) continue;
    if (ts.isImportDeclaration(st)) {
      const info = importInfo(d);
      needImports.set(info.local, info);
    } else cycle.add(id.text);
  }
  if (cycle.size) fail(`moving these would need top-level names that stay in the source (import cycle): ${[...cycle].sort().join(', ')}`);

  // Names the remaining source still uses.
  const usedOutside = new Set();
  for (const id of identifiers(sf.statements.filter((s) => !movedSet.has(s)))) {
    const d = declOf(id);
    if (d && movedSet.has(declStatement(d))) usedOutside.add(id.text);
  }

  const body = moved
    .map((st) => {
      const full = src.slice(st.pos, st.end).replace(/^\s*\n/, '');
      const startInFull = full.length - (st.end - st.getStart(sf));
      return `${full.slice(0, startInFull)}export ${full.slice(startInFull)}`;
    })
    .join('\n\n');
  const edits = moved.map((st) => [st.pos, st.end, '']);
  if (usedOutside.size) edits.push(sourceImportEdit(usedOutside, TO));

  assertJsxTarget(moved, TO);
  report({ moved: [...movedNames], imports: [...needImports.keys()], exportsBack: [...usedOutside] });
  if (DRY) return;
  // Removing [st.pos, st.end] takes the statement with its own leading trivia, so the
  // spacing of what remains is untouched — never a global whitespace rewrite (strings!).
  const newSrc = applyEdits(src, edits);
  mkdirSync(dirname(TO), { recursive: true });
  writeFileSync(TO, writeModule(TO, [...needImports.values()], body, headerFor(TO)));
  writeFileSync(FILE, newSrc);
}

// ── component body helpers (hook / render) ────────────────────────────────────────────────
function componentFn() {
  const name = opt('--fn') ?? 'App';
  const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!fn?.body) fail(`no function ${name}`);
  return fn;
}
function parseLines() {
  const m = (opt('--lines') ?? '').match(/^(\d+)-(\d+)$/);
  if (!m) fail('--lines <from>-<to> is required');
  return [Number(m[1]), Number(m[2])];
}
// Free component-local reads of `nodes`, with the TDZ / mutation checks.
function freeLocals(fn, nodes, runStart, runEnd, { allowLaterConst = false } = {}) {
  const free = new Map(); // name -> decl
  const problems = [];
  for (const id of identifiers(nodes)) {
    const d = declOf(id);
    if (!d) continue;
    const c = containerOf(d);
    if (c !== fn) continue;
    if (d.pos >= runStart && d.end <= runEnd) continue; // declared inside the run
    const st = declStatement(d);
    if (isWrite(id)) problems.push(`writes component-local "${id.text}" (line ${lineOf(id.getStart(sf))})`);
    if (!ts.isFunctionDeclaration(st) && st.pos >= runStart && !allowLaterConst) {
      problems.push(`reads "${id.text}" declared after the run (line ${lineOf(st.getStart(sf))}) — TDZ at the call site`);
    }
    if (ts.isVariableDeclaration(d) || ts.isBindingElement(d)) {
      if (!isConst(d)) {
        const writes = identifiers([fn.body]).filter((x) => isWrite(x) && declOf(x) === d);
        if (writes.length) problems.push(`reads let/var "${id.text}" which is written at line ${lineOf(writes[0].getStart(sf))}`);
      }
    }
    free.set(id.text, d);
  }
  return { free, problems: [...new Set(problems)] };
}
function moduleImportsFor(nodes) {
  const need = new Map();
  const cycle = new Set();
  for (const id of identifiers(nodes)) {
    const d = declOf(id);
    if (!d || !ts.isSourceFile(containerOf(d))) continue;
    const st = declStatement(d);
    if (ts.isImportDeclaration(st)) {
      const info = importInfo(d);
      need.set(info.local, info);
    } else cycle.add(id.text);
  }
  return { need, cycle };
}
const sortByDecl = (m) => [...m.entries()].sort((a, b) => a[1].pos - b[1].pos).map(([n]) => n);
// `{ a, b, c }` wrapped at ~100 columns with the given indent (one line when it fits).
function braceList(names, indent) {
  if (!names.length) return '{}';
  const one = `{ ${names.join(', ')} }`;
  if (one.length + indent.length <= 100) return one;
  const lines = [];
  let cur = '';
  for (const n of names) {
    const next = cur ? `${cur}, ${n}` : n;
    if (next.length + indent.length + 2 > 100 && cur) {
      lines.push(`${cur},`);
      cur = n;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return `{\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`;
}

// ── op: hook ──────────────────────────────────────────────────────────────────────────────
function opHook() {
  const fn = componentFn();
  const [from, to] = parseLines();
  const name = opt('--name');
  if (!name || !/^use[A-Z]/.test(name)) fail('--name must be a hook name (useX)');
  const stmts = fn.body.statements.filter((s) => lineOf(s.getStart(sf)) >= from && lineOf(s.end) <= to);
  if (!stmts.length) fail('no whole statements in that line range');
  const first = stmts[0];
  const last = stmts[stmts.length - 1];
  const all = fn.body.statements;
  const i0 = all.indexOf(first);
  if (all.slice(i0, i0 + stmts.length).some((s, k) => s !== stmts[k])) fail('run is not contiguous');
  if (lineOf(first.getStart(sf)) !== from) console.warn(`note: run starts at line ${lineOf(first.getStart(sf))}`);
  if (stmts.some((s) => ts.isReturnStatement(s))) fail('run contains a top-level return');

  const runStart = first.pos;
  const runEnd = last.end;
  const { free, problems } = freeLocals(fn, stmts, runStart, runEnd);
  const { need, cycle } = moduleImportsFor(stmts);
  if (cycle.size) problems.push(`needs top-level names still in the source: ${[...cycle].sort().join(', ')}`);

  // Bindings the run declares that the rest of the component uses.
  const outside = all.filter((s) => !stmts.includes(s));
  const returned = new Set();
  for (const id of identifiers(outside)) {
    const d = declOf(id);
    if (!d || containerOf(d) !== fn) continue;
    if (d.pos >= runStart && d.end <= runEnd) {
      if (isWrite(id)) problems.push(`"${id.text}" is reassigned after the run (line ${lineOf(id.getStart(sf))})`);
      // A hoisted function used BEFORE the run would hit the destructuring's TDZ.
      if (id.getStart(sf) < runStart) problems.push(`"${id.text}" is used before the run (line ${lineOf(id.getStart(sf))})`);
      // A returned let/var is a by-value copy: a later write inside the run would not reach the caller.
      if ((ts.isVariableDeclaration(d) || ts.isBindingElement(d)) && !isConst(d)) {
        const writes = identifiers(stmts).filter((x) => isWrite(x) && declOf(x) === d);
        if (writes.length) problems.push(`returned let/var "${id.text}" is written inside the run (line ${lineOf(writes[0].getStart(sf))})`);
      }
      returned.add(id.text);
    }
  }
  if (problems.length) fail(`cannot extract lines ${from}-${to} as ${name}:\n  - ${problems.join('\n  - ')}`);

  const params = sortByDecl(free);
  const ret = [...returned].sort();
  const indent = '  ';
  const runText = src.slice(runStart, runEnd).replace(/^\s*\n/, '');
  const body = `export function ${name}(${braceList(params, '')}) {\n${runText}${ret.length ? `\n${indent}return ${braceList(ret, indent)};` : ''}\n}`;
  const call = `\n${indent}${ret.length ? `const ${braceList(ret, indent)} = ` : ''}${name}(${braceList(params, indent)});`;
  assertJsxTarget(stmts, TO);
  report({ hook: name, lines: `${from}-${to}`, params: params.length, returns: ret, imports: [...need.keys()] });
  if (DRY) return;
  const edits = [[runStart, runEnd, call], sourceImportEdit([name], TO)];
  mkdirSync(dirname(TO), { recursive: true });
  writeFileSync(TO, writeModule(TO, [...need.values()], body, headerFor(TO)));
  writeFileSync(FILE, applyEdits(src, edits));
}

// ── op: render ────────────────────────────────────────────────────────────────────────────
// Selects the outermost JSX element / JSX expression container / parenthesized expression
// that starts on --lines' first line and ends on its last line, inside the component.
function opRender() {
  const fn = componentFn();
  const [from, to] = parseLines();
  const name = opt('--name');
  if (!name || !/^render[A-Z]/.test(name)) fail('--name must be renderX');
  let target = null;
  const visit = (n) => {
    if (target) return;
    const ok =
      (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) || ts.isJsxExpression(n)) &&
      lineOf(n.getStart(sf)) === from &&
      lineOf(n.end) === to;
    if (ok) target = n;
    else ts.forEachChild(n, visit);
  };
  visit(fn.body);
  if (!target) fail(`no JSX element/expression spanning exactly lines ${from}-${to}`);
  if (ts.isJsxExpression(target) && !target.expression) fail('empty JSX expression');
  const inner = ts.isJsxExpression(target) ? target.expression : target;
  // Everything inside the component's return is evaluated after all locals exist: allow
  // later-declared consts (the call happens where the JSX was).
  const { free, problems } = freeLocals(fn, [inner], target.pos, target.end, { allowLaterConst: true });
  const { need, cycle } = moduleImportsFor([inner]);
  if (cycle.size) problems.push(`needs top-level names still in the source: ${[...cycle].sort().join(', ')}`);
  if (problems.length) fail(`cannot extract lines ${from}-${to} as ${name}:\n  - ${problems.join('\n  - ')}`);
  const params = sortByDecl(free);
  const text = src.slice(inner.getStart(sf), inner.end);
  const body = `export function ${name}(${braceList(params, '')}) {\n  return (\n    ${text}\n  );\n}`;
  // A JSX child element is replaced by an expression container; an expression container keeps its braces.
  const parentIsJsx = ts.isJsxElement(target.parent) || ts.isJsxFragment(target.parent);
  const call = `${name}(${braceList(params, '      ')})`;
  const replacement = ts.isJsxExpression(target) || parentIsJsx ? `{${call}}` : call;
  report({ render: name, lines: `${from}-${to}`, params: params.length, imports: [...need.keys()] });
  if (DRY) return;
  const edits = [[target.getStart(sf), target.end, replacement], sourceImportEdit([name], TO)];
  mkdirSync(dirname(TO), { recursive: true });
  writeFileSync(TO, writeModule(TO, [...need.values()], body, headerFor(TO)));
  writeFileSync(FILE, applyEdits(src, edits));
}

function report(o) {
  console.log(JSON.stringify({ op: OP, file: relative(REPO, FILE), to: relative(REPO, TO), dry: DRY, ...o }));
}

if (OP === 'top') opTop();
else if (OP === 'hook') opHook();
else opRender();
