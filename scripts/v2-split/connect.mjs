#!/usr/bin/env node
// V2-2.3 step 2 — connect a shell surface to the shell store instead of drilling its props
// through ShellTree. A MOVE: the element (attributes and children) moves verbatim into a small
// connected component that reads exactly the store names it uses.
//
//   node scripts/v2-split/connect.mjs <Component> [--dry]
//
// Before (in ShellTree):   <Menubar sharePath={sharePath} onShare={() => showShare()} … />
// After:                    function ShellMenubar() {
//                             const { shellCore: { sharePath, showShare, … }, … } = useShellStore();
//                             return (<Menubar sharePath={sharePath} onShare={() => showShare()} … />);
//                           }
//                           … and in ShellTree: <ShellMenubar />
// Refused (exit 1) when the element sits inside a callback in the JSX (its attributes could read
// that callback's parameters) or appears more than once.
// Behaviour: the connected component renders exactly when ShellTree does (a child without memo,
// plus the store context), with the same values, so the surface renders identically.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = join(REPO, 'apps/studio/client/app.jsx');
const ts = createRequire(join(REPO, 'apps/studio/package.json'))('typescript');
const [name] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
if (!name) {
  console.error('usage: connect.mjs <Component> [--dry]');
  process.exit(2);
}

const src = readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const tree = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'ShellTree');
if (!tree) throw new Error('no ShellTree — run stores.mjs first');

// the store names ShellTree destructures, by group
const decl = tree.body.statements[0].declarationList.declarations[0];
const groupOf = new Map();
for (const g of decl.name.elements)
  for (const el of g.name.elements) groupOf.set(el.name.text, g.propertyName?.text ?? g.name.text);
const groupOrder = [...new Set(groupOf.values())];

// the element
const hits = [];
const find = (n, inFn) => {
  if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && tagOf(n) === name)
    hits.push({ n, inFn });
  ts.forEachChild(n, (c) => find(c, inFn || ts.isFunctionLike(n)));
};
function tagOf(n) {
  return (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText(sf);
}
find(tree.body.statements.at(-1), false);
if (hits.length !== 1)
  throw new Error(`<${name}> appears ${hits.length} times in ShellTree — refusing`);
const { n: el, inFn } = hits[0];
if (inFn)
  throw new Error(
    `<${name}> sits inside a callback in the JSX — refusing (its attributes could read its parameters)`
  );

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
visit(el);

const groups = groupOrder
  .map((g) => [g, [...used].filter((n) => groupOf.get(n) === g).sort()])
  .filter(([, names]) => names.length);
const elText = src.slice(el.getStart(), el.getEnd());
// re-indent the element to sit inside `return (` at 4 spaces
const col = sf.getLineAndCharacterOfPosition(el.getStart()).character;
const reindented = elText
  .split('\n')
  .map((l, i) => (i === 0 ? `    ${l}` : l.startsWith(' '.repeat(col)) ? `    ${l.slice(col)}` : l))
  .join('\n');
const connected = `// V2-2.3: the ${name} surface reads the shell store directly instead of being drilled through ShellTree.
function Shell${name}() {
  const {
${groups.map(([g, names]) => `    ${g}: {\n${names.map((x) => `      ${x},`).join('\n')}\n    },`).join('\n')}
  } = useShellStore();
  return (
${reindented}
  );
}

`;
let out = src.slice(0, el.getStart()) + `<Shell${name} />` + src.slice(el.getEnd());
const treeStart = out.indexOf('// V2-2.3: the render tree.');
if (treeStart < 0) throw new Error('ShellTree header comment not found');
out = out.slice(0, treeStart) + connected + out.slice(treeStart);

// proof: the element text (modulo the re-indent) is unchanged
const norm = (s) => s.replace(/^\s+/gm, '');
if (!norm(out).includes(norm(elText))) throw new Error('move proof failed');
console.log(
  `<${name}>: ${elText.split('\n').length} lines, ${used.size} store names in ${groups.length} groups → Shell${name}`
);
if (!DRY) {
  writeFileSync(FILE, out);
  console.log('wrote app.jsx');
}
