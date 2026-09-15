#!/usr/bin/env bun
// Source vocabulary of real canvases — plan T23 (DDR-241).
//
// Which JSX constructs real design projects are made of, and how much of it the
// structured UI operations (apps/studio/sync/source-ops.ts) can address by
// stable identity. Anything they cannot is a CODE candidate: it still travels
// and merges as source (three-way, conflicts to the person) — never converted
// lossily into something the operations understand.
//
//   bun scripts/dev/source-vocabulary.ts <designRoot> [<designRoot>...] [--md]
//
// Reports aggregate counts only — no source text leaves the machine.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { printUniqueness } from '../../apps/studio/canvas-edit.ts';
import { parseSync } from '../../apps/studio/node_modules/oxc-parser';

type AnyNode = Record<string, any>;

interface Tally {
  canvases: number;
  parseErrors: number;
  elements: number;
  authoredIds: number;
  customComponents: number;
  artboards: number;
  artboardsLiteral: number;
  textLiteral: number;
  textExpression: number;
  attrLiteral: number;
  attrExpression: number;
  spreads: number;
  styleLiteralObject: number;
  styleLiteralProps: number;
  styleExpressionProps: number;
  styleExpression: number;
  mapRendered: number;
  conditionalRendered: number;
  imports: number;
  relativeImports: number;
  printed: number;
  uniquePrints: number;
}

const zero = (): Tally => ({
  canvases: 0,
  parseErrors: 0,
  elements: 0,
  authoredIds: 0,
  customComponents: 0,
  artboards: 0,
  artboardsLiteral: 0,
  textLiteral: 0,
  textExpression: 0,
  attrLiteral: 0,
  attrExpression: 0,
  spreads: 0,
  styleLiteralObject: 0,
  styleLiteralProps: 0,
  styleExpressionProps: 0,
  styleExpression: 0,
  mapRendered: 0,
  conditionalRendered: 0,
  imports: 0,
  relativeImports: 0,
  printed: 0,
  uniquePrints: 0,
});

const CANVAS_LIB = new Set(['DesignCanvas', 'DCSection', 'DCArtboard', 'DCPostit', 'DCFrame']);
const isLit = (n: AnyNode | null | undefined) =>
  !!n && (n.type === 'Literal' || n.type === 'StringLiteral' || n.type === 'NumericLiteral');

function walkFiles(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile() && e.name.endsWith('.tsx') && statSync(p).size < 4_000_000) out.push(p);
  }
}

function tallyFile(abs: string, t: Tally): void {
  const src = readFileSync(abs, 'utf8');
  const parsed = parseSync(abs, src, { sourceType: 'module' });
  t.canvases += 1;
  if (parsed.errors?.length) {
    t.parseErrors += 1;
    return;
  }
  const u = printUniqueness(abs, src);
  t.printed += u.elements;
  t.uniquePrints += u.unique;
  const visit = (node: AnyNode, parent: AnyNode | null): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c, parent);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'ImportDeclaration') {
      t.imports += 1;
      if (String(node.source?.value ?? '').startsWith('.')) t.relativeImports += 1;
    }
    if (node.type === 'CallExpression' && node.callee?.property?.name === 'map') {
      const hasJsx = JSON.stringify(node.arguments ?? []).includes('"JSXElement"');
      if (hasJsx) t.mapRendered += 1;
    }
    if (
      (node.type === 'LogicalExpression' || node.type === 'ConditionalExpression') &&
      parent?.type === 'JSXExpressionContainer' &&
      JSON.stringify(node).includes('"JSXElement"')
    ) {
      t.conditionalRendered += 1;
    }
    if (node.type === 'JSXElement') {
      t.elements += 1;
      const o = node.openingElement;
      const name = o?.name?.type === 'JSXIdentifier' ? String(o.name.name) : '';
      if (/^[A-Z]/.test(name) && !CANVAS_LIB.has(name)) t.customComponents += 1;
      for (const a of o?.attributes ?? []) {
        if (a.type === 'JSXSpreadAttribute') {
          t.spreads += 1;
          continue;
        }
        const an = String(a.name?.name ?? '');
        if (an === 'data-cd-id') t.authoredIds += 1;
        const v = a.value;
        if (an === 'style') {
          const e = v?.type === 'JSXExpressionContainer' ? v.expression : null;
          if (e?.type === 'ObjectExpression') {
            t.styleLiteralObject += 1;
            for (const p of e.properties ?? []) {
              if (p.type === 'Property' && isLit(p.value)) t.styleLiteralProps += 1;
              else t.styleExpressionProps += 1;
            }
          } else t.styleExpression += 1;
          continue;
        }
        if (
          v === null ||
          v === undefined ||
          isLit(v) ||
          (v.type === 'JSXExpressionContainer' && isLit(v.expression))
        )
          t.attrLiteral += 1;
        else t.attrExpression += 1;
      }
      if (name === 'DCArtboard') {
        t.artboards += 1;
        const lit = (k: string) =>
          (o.attributes ?? []).some(
            (a: AnyNode) =>
              a.name?.name === k &&
              (isLit(a.value) ||
                (a.value?.type === 'JSXExpressionContainer' && isLit(a.value.expression)))
          );
        if (lit('id') && lit('width')) t.artboardsLiteral += 1;
      }
      for (const c of node.children ?? []) {
        if (c.type === 'JSXText' && c.value.trim()) t.textLiteral += 1;
        else if (
          c.type === 'JSXExpressionContainer' &&
          c.expression?.type !== 'JSXEmptyExpression'
        ) {
          if (!JSON.stringify(c.expression).includes('"JSXElement"')) t.textExpression += 1;
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k], node);
    }
  };
  visit(parsed.program, null);
}

const args = process.argv.slice(2);
const md = args.includes('--md');
const roots = args.filter((a) => !a.startsWith('--'));
if (!roots.length) {
  console.error('usage: bun scripts/dev/source-vocabulary.ts <designRoot>... [--md]');
  process.exit(2);
}
const total = zero();
const perRoot: [string, Tally][] = [];
for (const root of roots) {
  const files: string[] = [];
  walkFiles(root, files);
  const t = zero();
  for (const f of files) tallyFile(f, t);
  perRoot.push([path.basename(path.resolve(root, '..')) || root, t]);
  for (const k of Object.keys(t) as (keyof Tally)[]) total[k] += t[k];
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const t = total;
const rows: [string, string, string][] = [
  [
    'Canvases (parse errors)',
    `${t.canvases} (${t.parseErrors})`,
    'broken TSX travels as a held candidate',
  ],
  ['JSX elements', `${t.elements}`, `addressable by print: delete / duplicate / move`],
  [
    '— with a unique print',
    `${t.uniquePrints} (${pct(t.uniquePrints, t.printed)})`,
    're-found after a concurrent structural change; the rest re-apply only when nothing moved',
  ],
  ['— authored `data-cd-id`', `${t.authoredIds}`, 'stable by construction'],
  [
    '— custom component usages',
    `${t.customComponents}`,
    'edited at the usage; the definition is code',
  ],
  [
    'Literal text children',
    `${t.textLiteral}`,
    `text op (${pct(t.textLiteral, t.textLiteral + t.textExpression)} of text)`,
  ],
  [
    'Expression text children',
    `${t.textExpression}`,
    'code candidate (the `{var}` resolver covers traced literals)',
  ],
  [
    'Literal attributes',
    `${t.attrLiteral}`,
    `set / remove (${pct(t.attrLiteral, t.attrLiteral + t.attrExpression)} of attributes)`,
  ],
  ['Expression attributes', `${t.attrExpression}`, 'code candidate'],
  ['Spread attributes', `${t.spreads}`, 'code candidate'],
  ['Inline style objects', `${t.styleLiteralObject}`, 'style.* set / remove per property'],
  [
    '— literal style properties',
    `${t.styleLiteralProps}`,
    `${pct(t.styleLiteralProps, t.styleLiteralProps + t.styleExpressionProps)} of style properties`,
  ],
  ['— expression style properties', `${t.styleExpressionProps}`, 'code candidate'],
  ['Style expressions (not an object literal)', `${t.styleExpression}`, 'code candidate'],
  [
    'Artboards (literal id + width)',
    `${t.artboards} (${t.artboardsLiteral})`,
    'artboard ops by authored id',
  ],
  [
    '`.map()`-rendered lists',
    `${t.mapRendered}`,
    'edits reach the array literal; structure is code',
  ],
  ['Conditionally rendered JSX', `${t.conditionalRendered}`, 'code candidate'],
  [
    'Imports (relative)',
    `${t.imports} (${t.relativeImports})`,
    'preserved verbatim; never rewritten',
  ],
];
if (md) {
  console.log(`| Construct | Count | Structured operations |\n|---|---:|---|`);
  for (const [a, b, c] of rows) console.log(`| ${a} | ${b} | ${c} |`);
  console.log(`\nCorpora: ${perRoot.map(([n, x]) => `${n} (${x.canvases} canvases)`).join(', ')}.`);
} else {
  console.log(JSON.stringify({ total, perRoot: Object.fromEntries(perRoot) }, null, 2));
}
