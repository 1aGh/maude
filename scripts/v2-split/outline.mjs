#!/usr/bin/env node
// Outline of a module's top-level statements: kind, names, line range, size, and the
// top-level bindings each one references. Used to plan the V2-0.2 move-only split.
//   bun scripts/v2-split/outline.mjs apps/studio/client/app.jsx [--json]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const file = resolve(process.argv[2]);
const require = createRequire(join(resolve('apps/studio'), 'package.json'));
const { parseSync } = require('oxc-parser');
const src = readFileSync(file, 'utf8');
const { program, errors } = parseSync(file, src, { sourceType: 'module', lang: 'jsx' });
if (errors.length) { console.error(errors); process.exit(1); }

const lineAt = (() => { const starts = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; }; })();

function declNames(node) {
  const n = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration ?? node : node;
  if (!n) return [];
  if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') return n.id ? [n.id.name] : [];
  if (n.type === 'VariableDeclaration') return n.declarations.flatMap((d) => patNames(d.id));
  if (n.type === 'ImportDeclaration') return n.specifiers.map((s) => s.local.name);
  return [];
}
function patNames(p) {
  if (!p) return [];
  if (p.type === 'Identifier') return [p.name];
  if (p.type === 'ObjectPattern') return p.properties.flatMap((q) => patNames(q.value ?? q.argument));
  if (p.type === 'ArrayPattern') return p.elements.flatMap(patNames);
  if (p.type === 'RestElement') return patNames(p.argument);
  if (p.type === 'AssignmentPattern') return patNames(p.left);
  return [];
}
const top = new Map();
for (const st of program.body) for (const n of declNames(st)) top.set(n, st);

function refs(node, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { for (const c of node) refs(c, acc); return acc; }
  if ((node.type === 'Identifier' || node.type === 'JSXIdentifier') && top.has(node.name)) acc.add(node.name);
  for (const [k, v] of Object.entries(node)) if (k !== 'type' && v && typeof v === 'object') refs(v, acc);
  return acc;
}
const rows = program.body.map((st) => {
  const names = declNames(st);
  const r = [...refs(st)].filter((x) => !names.includes(x));
  return { kind: st.type, names, from: lineAt(st.start), to: lineAt(st.end), lines: lineAt(st.end) - lineAt(st.start) + 1, refs: r };
});
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else for (const r of rows) if (r.kind !== 'ImportDeclaration') console.log(`${String(r.from).padStart(5)}-${String(r.to).padEnd(5)} ${String(r.lines).padStart(5)}  ${r.kind.replace('Declaration','')}  ${r.names.join(',') || '-'}`);
