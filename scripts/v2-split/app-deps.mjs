#!/usr/bin/env node
// For each top-level statement of a component body: its line range, kind, declared names,
// forward references (component-local consts declared LATER — a TDZ problem for extraction),
// and writes to component-local let/var. Proposes maximal extractable runs.
//   bun scripts/v2-split/app-deps.mjs apps/studio/client/app.jsx App [--runs]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
const FILE = resolve(process.argv[2]);
const FN = process.argv[3] || 'App';
const require = createRequire(join(resolve('apps/studio'), 'package.json'));
const ts = require('typescript');
const src = readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const opts = { allowJs: true, jsx: ts.JsxEmit.ReactJSX, noResolve: true, noLib: true, types: [] };
const host = ts.createCompilerHost(opts);
const og = host.getSourceFile.bind(host);
host.getSourceFile = (f, ...r) => (resolve(f) === FILE ? sf : og(f, ...r));
const checker = ts.createProgram([FILE], opts, host).getTypeChecker();
const line = (p) => sf.getLineAndCharacterOfPosition(p).line + 1;
const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === FN);
const body = fn.body.statements;
const KINDS = new Set([ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.BindingElement, ts.SyntaxKind.FunctionDeclaration]);
const declOf = (id) => {
  const p = id.parent;
  const sym = p && ts.isShorthandPropertyAssignment(p) && p.name === id ? checker.getShorthandAssignmentValueSymbol(p) : checker.getSymbolAtLocation(id);
  const d = sym?.valueDeclaration ?? sym?.declarations?.[0];
  return d && KINDS.has(d.kind) && d.getSourceFile() === sf ? d : null;
};
const owner = (d) => { let n = d; while (n.parent && n.parent !== fn.body) n = n.parent; return n.parent === fn.body ? n : null; };
const idx = new Map(body.map((s, i) => [s, i]));
const info = body.map((s, i) => {
  const fwd = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const d = declOf(n);
      if (d) { const o = owner(d); if (o && idx.get(o) > i && !ts.isFunctionDeclaration(o)) fwd.add(idx.get(o)); }
    }
    ts.forEachChild(n, visit);
  };
  visit(s);
  return { i, from: line(s.getStart(sf)), to: line(s.end), fwd: [...fwd] };
});
const withFwd = info.filter((x) => x.fwd.length);
console.log(`${body.length} statements; ${withFwd.length} read a later const`);
for (const x of withFwd) console.log(`  ${x.from}-${x.to} → ${x.fwd.map((j) => info[j].from).join(',')}`);
