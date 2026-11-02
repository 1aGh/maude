#!/usr/bin/env node
// V2-2.3 — after connect.mjs moves surfaces out of ShellTree, drop the store names ShellTree no
// longer reads from its destructuring (they stay in the store for the connected surfaces).
//   node scripts/v2-split/prune-tree.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = join(REPO, 'apps/studio/client/app.jsx');
const ts = createRequire(join(REPO, 'apps/studio/package.json'))('typescript');
const src = readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const tree = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'ShellTree');
const declStmt = tree.body.statements[0];
const pattern = declStmt.declarationList.declarations[0].name;
const used = new Set();
const visit = (n) => {
  if (ts.isIdentifier(n)) used.add(n.text);
  ts.forEachChild(n, visit);
};
for (const s of tree.body.statements.slice(1)) visit(s);
const groups = [];
let dropped = 0;
for (const g of pattern.elements) {
  const names = g.name.elements.map((e) => e.name.text).filter((x) => used.has(x));
  dropped += g.name.elements.length - names.length;
  if (names.length) groups.push([g.propertyName?.text ?? g.name.text, names]);
}
const text = `const {\n${groups.map(([g, names]) => `    ${g}: {\n${names.map((x) => `      ${x},`).join('\n')}\n    },`).join('\n')}\n  } = useShellStore();`;
const out = src.slice(0, declStmt.getStart()) + text + src.slice(declStmt.getEnd());
writeFileSync(FILE, out);
console.log(
  `ShellTree: dropped ${dropped} names it no longer reads; keeps ${groups.reduce((a, [, n]) => a + n.length, 0)}`
);
