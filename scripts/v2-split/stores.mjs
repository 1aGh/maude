#!/usr/bin/env node
// V2-2.3 — state out of App(): split App() into a state owner and a render tree, joined by
// one shell store (React context), as a MOVE: every statement and the whole JSX move verbatim.
//
//   node scripts/v2-split/stores.mjs --dry   print the plan (groups, names) and verify, write nothing
//   node scripts/v2-split/stores.mjs         rewrite apps/studio/client/app.jsx
//
// Before:  function App() { <19 statements: hooks, effects, callbacks>; return (<JSX>); }
// After:   function ShellState({ children }) { <the same statements, same order>;
//            const shellStore = { <group>: { <every App-scope name the JSX reads> }, … };
//            return <ShellStoreContext.Provider value={shellStore}>{children}</…>; }
//          function ShellTree() { const { <group>: { … }, … } = useShellStore(); return (<JSX>); }
//          function App() { return (<ShellState><ShellTree /></ShellState>); }
// Groups follow the module seams: one per custom hook the binding came from (shellCore, tabs,
// canvasBridge, …) and `local` for App's own memos/callbacks/refs.
//
// Why behaviour-identical: the hooks and effects run in one component in the same order (the
// state owner), so effect order and timing relative to the commit are unchanged (the render
// tree is its child and has no effects). The owner re-renders exactly when App did; the store
// object is new each render, so the tree re-renders exactly when App's JSX did. Every name the
// JSX reads is the same binding, passed through the store unchanged.
// The script proves the move: the moved statement text + the moved JSX text equal the old ones.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = join(REPO, 'apps/studio/client/app.jsx');
const STORE_FILE = join(REPO, 'apps/studio/client/stores/shell-store.jsx');
const ts = createRequire(join(REPO, 'apps/studio/package.json'))('typescript');
const DRY = process.argv.includes('--dry');

const src = readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const app = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'App');
if (!app) throw new Error('no function App in app.jsx');
const stmts = [...app.body.statements];
const ret = stmts.pop();
if (!ts.isReturnStatement(ret)) throw new Error('App() does not end in a return');
for (const s of stmts) {
  let early = false;
  const v = (n) => {
    if (ts.isReturnStatement(n)) early = true;
    else if (!ts.isFunctionLike(n)) ts.forEachChild(n, v);
  };
  v(s);
  if (early) throw new Error('App() has an early return — not a straight move');
}

// ── App-scope bindings and the seam each one comes from ───────────────────────────────
const groupOf = new Map(); // name -> group
const groupOrder = [];
const hookGroup = (init) => {
  if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
    const h = init.expression.text;
    if (
      /^use[A-Z]/.test(h) &&
      !/^use(State|Memo|Callback|Ref|Effect|LayoutEffect|Reducer|Context|Id|Transition|DeferredValue|SyncExternalStore|ImperativeHandle)$/.test(
        h
      )
    )
      return h[3].toLowerCase() + h.slice(4);
  }
  return 'local';
};
const bindNames = (name, out) => {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindNames(el.name, out);
};
for (const s of stmts) {
  const add = (names, group) => {
    if (!groupOrder.includes(group)) groupOrder.push(group);
    for (const n of names) groupOf.set(n, group);
  };
  if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      const names = [];
      bindNames(d.name, names);
      add(names, hookGroup(d.initializer));
    }
  } else if (ts.isFunctionDeclaration(s) && s.name) add([s.name.text], 'local');
}

// ── the App-scope names the JSX reads ─────────────────────────────────────────────────
const used = new Set();
const visit = (n) => {
  if (ts.isIdentifier(n) && groupOf.has(n.text)) {
    const p = n.parent;
    const isKey =
      (ts.isPropertyAccessExpression(p) && p.name === n) ||
      (ts.isPropertyAssignment(p) && p.name === n) ||
      (ts.isJsxAttribute(p) && p.name === n) ||
      ((ts.isParameter(p) || ts.isBindingElement(p) || ts.isVariableDeclaration(p)) &&
        p.name === n);
    if (!isKey) used.add(n.text);
  }
  ts.forEachChild(n, visit);
};
visit(ret);

const groups = groupOrder
  .map((g) => [g, [...used].filter((n) => groupOf.get(n) === g).sort()])
  .filter(([, names]) => names.length);

// ── emit ──────────────────────────────────────────────────────────────────────────────
const indent = (s, pad) =>
  s
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
const objLines = (pad) =>
  groups
    .map(([g, names]) => `${pad}${g}: {\n${names.map((n) => `${pad}  ${n},`).join('\n')}\n${pad}},`)
    .join('\n');

const bodyStart = stmts[0].getFullStart();
const stmtText = src.slice(bodyStart, ret.getFullStart());
const retText = src.slice(ret.getFullStart(), ret.getEnd());
const appHead = src.slice(app.getStart(), app.body.getStart()); // "function App() "
if (!/^function App\(\)\s*$/.test(appHead)) throw new Error(`unexpected App signature: ${appHead}`);

const shellState = `function ShellState({ children }) {${stmtText}
  // V2-2.3: everything the render tree reads, grouped by the module seam it comes from.
  const shellStore = {
${objLines('    ')}
  };
  return <ShellStoreContext.Provider value={shellStore}>{children}</ShellStoreContext.Provider>;
}`;
const shellTree = `// V2-2.3: the render tree. It reads the shell store; it owns no state and no effects.
function ShellTree() {
  const {
${objLines('    ')}
  } = useShellStore();${retText}
}`;
const newApp = `function App() {
  return (
    <ShellState>
      <ShellTree />
    </ShellState>
  );
}`;

let out =
  src.slice(0, app.getStart()) +
  shellState +
  '\n\n' +
  shellTree +
  '\n\n' +
  newApp +
  src.slice(app.getEnd());
// the store import, after the last import
const lastImport = [...sf.statements].filter((s) => ts.isImportDeclaration(s)).pop();
const importLine = "import { ShellStoreContext, useShellStore } from './stores/shell-store.jsx';\n";
const cut = lastImport.getEnd() + 1;
out = out.slice(0, cut) + importLine + out.slice(cut);

// ── proof: the moved text is the old text ─────────────────────────────────────────────
const proofOk = out.includes(stmtText) && out.includes(retText);
if (!proofOk) throw new Error('move proof failed: moved text differs');

const total = groups.reduce((a, [, n]) => a + n.length, 0);
console.log(
  `App(): ${stmts.length} statements → ShellState; return JSX (${retText.split('\n').length} lines) → ShellTree`
);
console.log(
  `store: ${total} names in ${groups.length} groups — ${groups.map(([g, n]) => `${g} ${n.length}`).join(', ')}`
);
console.log('move proof: statements and JSX are byte-identical in the output');

if (!DRY) {
  writeFileSync(FILE, out);
  writeFileSync(
    STORE_FILE,
    `// The shell store (V2-2.3) — the one context the shell's state owner (ShellState in app.jsx)
// provides and every shell surface reads, so a surface needs no prop drilling and the v2 chrome
// (Phase 4) mounts under the same provider as today's. Grouped by the module seam each value
// comes from: one group per custom hook (shellCore, tabs, canvasBridge, …) plus \`local\`.
import { createContext, useContext } from 'react';

export const ShellStoreContext = createContext(null);

/** The shell store; throws outside ShellState so a surface mounted in the wrong place fails loud. */
export function useShellStore() {
  const store = useContext(ShellStoreContext);
  if (!store) throw new Error('useShellStore() outside <ShellState> — mount the surface under the shell');
  return store;
}
`
  );
  console.log('wrote app.jsx + stores/shell-store.jsx');
}
