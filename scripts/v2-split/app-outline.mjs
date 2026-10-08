#!/usr/bin/env node
// Outline of App()'s body: one row per top-level statement in the component, grouped into
// runs of the same hook kind, with line ranges. Plans the hook extraction of V2-0.2.
//   bun scripts/v2-split/app-outline.mjs apps/studio/client/app.jsx [App] [--min N]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
const file = resolve(process.argv[2]);
const fnName = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'App';
const min = Number(process.argv[process.argv.indexOf('--min') + 1]) || 0;
const require = createRequire(join(resolve('apps/studio'), 'package.json'));
const { parseSync } = require('oxc-parser');
const src = readFileSync(file, 'utf8');
const { program } = parseSync(file, src, { sourceType: 'module', lang: 'jsx' });
const starts = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
const line = (o) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= o) lo = m; else hi = m - 1; } return lo + 1; };
const fn = program.body.find((s) => s.type === 'FunctionDeclaration' && s.id?.name === fnName);
const kindOf = (st) => {
  if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression') {
    const c = st.expression.callee; return c.name || c.property?.name || 'call';
  }
  if (st.type === 'VariableDeclaration') {
    const init = st.declarations[0]?.init;
    if (init?.type === 'CallExpression') return init.callee.name || init.callee.property?.name || 'call';
    return init ? init.type.replace('Expression', '') : 'var';
  }
  return st.type.replace('Statement', '').replace('Declaration', '');
};
const name = (st) => st.type === 'VariableDeclaration' ? src.slice(st.declarations[0].id.start, st.declarations[0].id.end).replace(/\s+/g, ' ').slice(0, 60) : st.type === 'FunctionDeclaration' ? st.id.name : '';
for (const st of fn.body.body) {
  const a = line(st.start), b = line(st.end), n = b - a + 1;
  if (n >= min) console.log(`${String(a).padStart(5)}-${String(b).padEnd(5)} ${String(n).padStart(5)}  ${kindOf(st).padEnd(14)} ${name(st)}`);
}
