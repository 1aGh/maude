#!/usr/bin/env node
// Independent proof that the V2-0.2 split is move-only.
//
//   bun scripts/v2-split/verify-verbatim.mjs --base <git-ref> [--root <checkout>]
//
// 0. Every client file that existed at <base>, other than app.jsx, is byte-identical.
// 1. Every non-import top-level statement of <base>:apps/studio/client/app.jsx appears VERBATIM
//    (byte-identical, optionally prefixed with `export `) in exactly one of app.jsx + the new modules.
// 2. Every non-import top-level statement of every client file that did not exist at <base>
//    is either such a moved statement, a generated hook (`export function useX({…}) {…}`) or a
//    generated render function (`export function renderX({…}) { return (…); }`) — nothing else.
// 3. App(): inline every generated hook call and render call back into the current App and
//    compare with the base App (whitespace-normalized). Must be equal.
// Exit 0 = proven; 1 = a difference (printed); 2 = could not run.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const ROOT = resolve(opt('--root') ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const BASE = opt('--base');
if (!BASE) {
  console.error('usage: verify-verbatim.mjs --base <git-ref> [--root <checkout>]');
  process.exit(2);
}
const require = createRequire(join(ROOT, 'apps/studio/package.json'));
const ts = require('typescript');
const CLIENT = join(ROOT, 'apps/studio/client');
const APP = 'apps/studio/client/app.jsx';

const parse = (name, text) =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.JSX);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const baseSrc = git('show', `${BASE}:${APP}`);
const baseFiles = new Set(git('ls-tree', '-r', '--name-only', BASE, 'apps/studio/client').split('\n').filter(Boolean));

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk(CLIENT).map((p) => ({ rel: relative(ROOT, p), src: readFileSync(p, 'utf8') }));
const errors = [];

// ── 1 + 2: top-level statements ───────────────────────────────────────────────────────────
const baseSf = parse('app.jsx', baseSrc);
const stmtText = (sf, st) => sf.text.slice(st.getStart(sf), st.end);
const baseStmts = baseSf.statements.filter((s) => !ts.isImportDeclaration(s));
const index = new Map(); // text → [files]
const GEN_HOOK = /^export function (use[A-Z]\w*)\(/;
const GEN_RENDER = /^export function (render[A-Z]\w*)\(/;
const generated = new Map(); // name → { sf, node, kind }
for (const f of files) {
  const isNew = !baseFiles.has(f.rel);
  // Every client file that existed at <base>, other than app.jsx, must be untouched.
  if (!isNew && f.rel !== APP) {
    if (git('show', `${BASE}:${f.rel}`) !== f.src) errors.push(`${f.rel}: changed since ${BASE} (the split may only touch app.jsx and new modules)`);
    continue;
  }
  const sf = parse(f.rel, f.src);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) continue;
    let text = stmtText(sf, st);
    if (text.startsWith('export ')) {
      const h = text.match(GEN_HOOK) || text.match(GEN_RENDER);
      if (h && isNew && !baseStmts.some((b) => stmtText(baseSf, b) === text.slice(7))) {
        generated.set(h[1], { sf, node: st, kind: h[1].startsWith('use') ? 'hook' : 'render', file: f.rel });
        continue;
      }
      text = text.slice(7);
    }
    if (!index.has(text)) index.set(text, []);
    index.get(text).push(f.rel);
    // app.jsx is held to the same rule as a new module: what is left in it must come from base.
    if (!baseStmts.some((b) => stmtText(baseSf, b) === text) && !(f.rel === APP && ts.isFunctionDeclaration(st) && st.name?.text === 'App')) {
      errors.push(`${f.rel}: statement not from base app.jsx: ${text.slice(0, 90).replace(/\s+/g, ' ')}…`);
    }
  }
}
let appBase = null;
for (const st of baseStmts) {
  const text = stmtText(baseSf, st);
  if (ts.isFunctionDeclaration(st) && st.name?.text === 'App') appBase = st;
  const where = (index.get(text) ?? []).filter((f) => f !== APP || !(ts.isFunctionDeclaration(st) && st.name?.text === 'App'));
  if (ts.isFunctionDeclaration(st) && st.name?.text === 'App') continue; // checked in 3
  if (where.length !== 1) errors.push(`base statement found ${where.length}× (want 1): ${text.slice(0, 90).replace(/\s+/g, ' ')}…`);
}

// ── 3: App() equals base after inlining generated hooks / renders ──────────────────────────
const appNow = files.find((f) => f.rel === APP);
const appSf = parse('app.jsx', appNow.src);
const appFn = appSf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'App');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
function hookInline(name) {
  const g = generated.get(name);
  const body = g.node.body.statements;
  const last = body[body.length - 1];
  const keep = ts.isReturnStatement(last) && last.expression && ts.isObjectLiteralExpression(last.expression) ? body.slice(0, -1) : body;
  // From the first statement's full start: the run's leading comments moved with it.
  return g.sf.text.slice(keep[0].pos, keep[keep.length - 1].end);
}
function renderInline(name) {
  const g = generated.get(name);
  let e = g.node.body.statements[0].expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return g.sf.text.slice(e.getStart(g.sf), e.end);
}
const edits = [];
const visit = (n) => {
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && generated.has(n.expression.text)) {
    const name = n.expression.text;
    const g = generated.get(name);
    if (g.kind === 'hook') {
      let st = n;
      while (st.parent && st.parent !== appFn.body) st = st.parent;
      edits.push([st.getStart(appSf), st.end, hookInline(name)]);
      return;
    }
    const target = ts.isJsxExpression(n.parent) ? n.parent : n;
    const parentIsJsx = ts.isJsxExpression(n.parent) && (ts.isJsxElement(n.parent.parent) || ts.isJsxFragment(n.parent.parent));
    const inner = renderInline(name);
    // `{renderX()}` stood for either a JSX child element (no braces originally) or `{expr}`.
    const isElem = /^<[\s\S]*>$/.test(inner.trim()) && !inner.trim().startsWith('<>') ? true : /^<>/.test(inner.trim());
    edits.push([target.getStart(appSf), target.end, parentIsJsx && isElem ? inner : ts.isJsxExpression(n.parent) ? `{${inner}}` : inner]);
    return;
  }
  ts.forEachChild(n, visit);
};
visit(appFn);
edits.sort((a, b) => b[0] - a[0]);
let rebuilt = appNow.src;
for (const [s, e, r] of edits) rebuilt = rebuilt.slice(0, s) + r + rebuilt.slice(e);
const rebuiltSf = parse('app.jsx', rebuilt);
const rebuiltApp = rebuiltSf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'App');
const a = norm(stmtText(baseSf, appBase));
const b = norm(stmtText(rebuiltSf, rebuiltApp));
if (a !== b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  errors.push(`App() differs after inlining at char ${i}:\n  base: …${a.slice(Math.max(0, i - 120), i + 120)}…\n  now:  …${b.slice(Math.max(0, i - 120), i + 120)}…`);
}

const gen = [...generated.values()];
console.log(
  `checked ${baseStmts.length} base statements across ${files.length} client files; ` +
    `${gen.filter((g) => g.kind === 'hook').length} hooks, ${gen.filter((g) => g.kind === 'render').length} render functions inlined back`
);
if (errors.length) {
  for (const e of errors.slice(0, 30)) console.log(`FAIL ${e}`);
  if (errors.length > 30) console.log(`… ${errors.length - 30} more`);
  process.exit(1);
}
console.log('move-only: proven (verbatim statements, nothing added, App() identical after inlining)');
