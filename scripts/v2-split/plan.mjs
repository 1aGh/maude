#!/usr/bin/env node
// Check a module map for the V2-0.2 split: every top-level declaration of the source is
// assigned to a module (or stays), the module graph is acyclic, and print a move order.
//   bun scripts/v2-split/plan.mjs apps/studio/client/app.jsx scripts/v2-split/modules.json
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [file, mapFile] = process.argv.slice(2);
const rows = JSON.parse(
  execFileSync('bun', ['scripts/v2-split/outline.mjs', file, '--json'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
);
const map = JSON.parse(readFileSync(mapFile, 'utf8')); // { "client/x.jsx": ["A","B"], ... }
const owner = new Map();
for (const [mod, names] of Object.entries(map))
  for (const n of names) {
    if (owner.has(n)) console.log(`DUP ${n}`);
    owner.set(n, mod);
  }
const decls = rows.filter((r) => r.kind !== 'ImportDeclaration');
const imports = new Set(rows.filter((r) => r.kind === 'ImportDeclaration').flatMap((r) => r.names));
const STAY = '(app.jsx)';
const modOf = (n) => owner.get(n) ?? STAY;
for (const n of owner.keys())
  if (!decls.some((r) => r.names.includes(n))) console.log(`UNKNOWN ${n}`);
const edges = new Map();
let lines = 0;
for (const r of decls) {
  const from = modOf(r.names[0]);
  for (const n of r.names)
    if (modOf(n) !== from) console.log(`SPLIT-STATEMENT ${r.names.join(',')}`);
  if (from !== STAY) lines += r.lines;
  for (const ref of r.refs) {
    if (imports.has(ref)) continue;
    const to = modOf(ref);
    if (to === from) continue;
    if (!edges.has(from)) edges.set(from, new Map());
    const m = edges.get(from);
    if (!m.has(to)) m.set(to, new Set());
    m.get(to).add(`${r.names[0]}→${ref}`);
  }
}
let bad = 0;
for (const [from, m] of edges)
  for (const [to, why] of m)
    if (to === STAY) {
      bad++;
      console.log(`NEEDS-APP ${from} → app.jsx: ${[...why].slice(0, 8).join(' ')}`);
    }
// topological order over modules
const mods = Object.keys(map);
const order = [];
const state = new Map();
const visit = (m, path) => {
  if (state.get(m) === 2) return;
  if (state.get(m) === 1) {
    bad++;
    console.log(`CYCLE ${[...path, m].join(' → ')}`);
    return;
  }
  state.set(m, 1);
  for (const [to] of edges.get(m) ?? []) if (to !== STAY) visit(to, [...path, m]);
  state.set(m, 2);
  order.push(m);
};
for (const m of mods) visit(m, []);
console.log(
  `\nmove order (leaves first):\n${order.map((m, i) => `${String(i + 1).padStart(2)}. ${m}  (${map[m].length} decls) → ${[...(edges.get(m)?.keys() ?? [])].filter((t) => t !== STAY).join(', ') || '-'}`).join('\n')}`
);
const stay = decls
  .filter((r) => modOf(r.names[0]) === STAY && r.kind !== 'ExpressionStatement')
  .map((r) => r.names.join(','));
console.log(`\nstays in app.jsx: ${stay.join(' ')}`);
console.log(`moved lines: ${lines}`);
process.exit(bad ? 1 : 0);
