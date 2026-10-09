#!/usr/bin/env node
// dgn-inventory.mjs — mechanical inventory of every shell↔canvas `dgn` postMessage type (Maude v2, V2-1.2).
//
//   node scripts/v2-dgn/dgn-inventory.mjs [--root <repo>] [--json]
//
// Reads the sources with the TypeScript parser (resolved from apps/studio/node_modules) and reports, per
// message type: who SENDS it (object literals `{ dgn: '<lit>', … }`, `bridgeRequest('<req>','<res>')`,
// scripts embedded in template strings such as inspect.ts INSPECTOR_SCRIPT, inline <script>s of
// plugins/design/templates/_shell.html, the hub's injected expiry page), who HANDLES it
// (`x.dgn === '<lit>'` / `!==` / `switch (x.dgn)` / aliases), the payload keys each side writes and reads
// (through `as` casts and local aliases), and the gates visible at each handler:
//   origin  — the listener checks e.origin before the first dgn compare, or the branch does
//   source  — the branch checks e.source against a specific window (active canvas, the asked frame)
//   parent  — the branch checks e.source === window.parent (canvas side: "only the shell may say this")
// Direction is inferred from the document each file runs in: apps/studio/client/** is the shell; every other
// scanned file runs inside the canvas iframe (canvas-lib, canvas-shell, comment-mount, _shell.html,
// INSPECTOR_SCRIPT, the hub expiry page).
//
// Purpose: the evidence behind apps/studio/client/v2/contracts/V2-1.2-mode-toolbars.md and the drift gate the
// typed bridge (V2-2.10) runs — "every literal in the sources is in the table, every c→s type has a shell
// handler, every s→c type has a canvas handler". The gate detection is a heuristic for review, not proof:
// the typed table declares the gate, and its own tests prove it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

let tsMod = null;
function loadTs() {
  if (!tsMod) tsMod = createRequire(join(REPO, 'apps/studio/package.json'))('typescript');
  return tsMod;
}

export const DEFAULT_SCAN = [
  ['apps/studio', /\.(tsx?|jsx?|mjs)$/],
  ['apps/hub/src', /\.(mjs|js|ts)$/],
  ['plugins/design/templates', /_shell\.html$/],
];
const SKIP = /node_modules|\/dist\/|\/test\/|\.test\.|\/e2e\//;

function walk(dir, re, out) {
  let ents;
  try {
    ents = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of ents) {
    const p = join(dir, n);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, re, out);
    else if (re.test(n)) out.push(p);
  }
}

/** The document a file's code runs in. */
export function sideOf(rel) {
  return rel.startsWith('apps/studio/client/') ? 'shell' : 'canvas';
}

const stripComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const GATE_RE = {
  origin: /\.origin\s*(!==|===|!=|==)|expectedOrigin|acceptCanvasNotice|canvasOrigin|parentOrigin\(\)/,
  source:
    /\.source\s*(!==|===)\s*(?!window\.parent\b)[A-Za-z_$][\w.?$]*|(!==|===)\s*e\.source\b|acceptCanvasNotice\([^)]*activeWin/,
  parent: /\.source\s*(!==|===)\s*window\.parent\b|source\s*!==\s*parent\b/,
};
function gatesOf(text) {
  const t = stripComments(text);
  return Object.entries(GATE_RE)
    .filter(([, re]) => re.test(t))
    .map(([k]) => k);
}

/** Scan one parsed source. Pushes into `out.sends` / `out.handles`. */
function scanSourceFile(ts, rel, sf, out, off = 0) {
  const side = sideOf(rel);
  const aliases = new Map();
  const unwrap = (e) => {
    while (
      e &&
      (ts.isParenthesizedExpression(e) ||
        ts.isAsExpression(e) ||
        ts.isNonNullExpression(e) ||
        (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(e)) ||
        (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)))
    )
      e = e.expression;
    return e;
  };
  const baseText = (e) => {
    const u = unwrap(e);
    return u ? u.getText(sf) : '';
  };
  const strLits = (node) => {
    node = unwrap(node);
    if (!node) return [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return [...strLits(node.whenTrue), ...strLits(node.whenFalse)];
    return [];
  };
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1 + off;
  const listenerOf = (node) => {
    let n = node.parent;
    let best = null;
    while (n) {
      if (
        (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) &&
        n.parameters.length >= 1
      ) {
        const p = n.parameters[0].name.getText(sf);
        if (/^(e|ev|evt|event)$/.test(p) && /\.data\b/.test(n.body?.getText(sf) ?? '')) best = n;
      }
      n = n.parent;
    }
    return best;
  };
  const preGates = (listener) => {
    if (!listener?.body) return [];
    const body = stripComments(listener.body.getText(sf));
    const i = body.search(/\.dgn\s*(===|!==|==)|switch\s*\(\s*[\w.]+\.dgn|\bdgn\s*(===|!==)/);
    return gatesOf(i < 0 ? body : body.slice(0, i));
  };
  const branchStmts = (cmp, neg) => {
    let n = cmp;
    while (n && !ts.isIfStatement(n) && !ts.isBlock(n) && !ts.isSourceFile(n)) n = n.parent;
    if (n && ts.isIfStatement(n)) {
      if (!neg) return [n.thenStatement];
      const blk = n.parent;
      if (blk && (ts.isBlock(blk) || ts.isSourceFile(blk))) {
        const i = blk.statements.indexOf(n);
        return blk.statements.slice(i + 1);
      }
    }
    return [];
  };
  const readsOn = (stmts, recv) => {
    const recvs = new Set([recv]);
    const keys = new Set();
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer && recvs.has(baseText(n.initializer))) {
        if (ts.isIdentifier(n.name)) recvs.add(n.name.getText(sf));
        else if (ts.isObjectBindingPattern(n.name))
          for (const el of n.name.elements) keys.add((el.propertyName ?? el.name).getText(sf));
      }
      if (ts.isPropertyAccessExpression(n) && recvs.has(baseText(n.expression))) keys.add(n.name.getText(sf));
      if (
        ts.isElementAccessExpression(n) &&
        recvs.has(baseText(n.expression)) &&
        ts.isStringLiteral(n.argumentExpression)
      )
        keys.add(n.argumentExpression.text);
      ts.forEachChild(n, visit);
    };
    for (const s of stmts) visit(s);
    keys.delete('dgn');
    return [...keys].sort();
  };

  const visit = (n) => {
    // A script embedded in a template string (INSPECTOR_SCRIPT, the hub's expiry page): parse its body.
    if (
      (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) &&
      /dgn/.test(n.getText(sf)) &&
      /postMessage|\.dgn/.test(n.getText(sf))
    ) {
      const raw = n
        .getText(sf)
        .slice(1, -1)
        .replace(/\$\{[^}]*\}/g, '0');
      const base = lineOf(n.getStart(sf)) - 1;
      const parts = [];
      if (/<script\b/i.test(raw)) {
        const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
        let m;
        while ((m = re.exec(raw)))
          parts.push([m[1], raw.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1]);
      } else parts.push([raw, 0]);
      for (const [body, pre] of parts)
        scanSourceFile(
          ts,
          rel,
          ts.createSourceFile(rel, body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
          out,
          base + pre
        );
      return;
    }
    // Send: { dgn: '<lit>', … }
    if (ts.isObjectLiteralExpression(n)) {
      const p = n.properties.find(
        (q) => ts.isPropertyAssignment(q) && q.name.getText(sf).replace(/['"]/g, '') === 'dgn'
      );
      if (p) {
        let types = strLits(p.initializer);
        const keys = n.properties
          .filter((q) => q !== p)
          .map((q) =>
            q.name ? q.name.getText(sf) : ts.isSpreadAssignment(q) ? `...${q.expression.getText(sf).slice(0, 30)}` : '?'
          );
        const dynamic = types.length === 0;
        if (dynamic) types = [`<dynamic:${p.initializer.getText(sf).slice(0, 40)}>`];
        for (const t of types) out.sends.push({ type: t, file: rel, line: lineOf(n.getStart(sf)), side, keys, dynamic });
      }
    }
    // Send + handle: bridgeRequest('<req>', '<res>', extra)
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'bridgeRequest' && n.arguments.length >= 2) {
      const extra =
        n.arguments[2] && ts.isObjectLiteralExpression(n.arguments[2])
          ? n.arguments[2].properties.map((q) => q.name?.getText(sf) ?? '...')
          : [];
      for (const t of strLits(n.arguments[0]))
        out.sends.push({ type: t, file: rel, line: lineOf(n.getStart(sf)), side, keys: ['id', ...extra], dynamic: false });
      for (const t of strLits(n.arguments[1]))
        out.handles.push({ type: t, file: rel, line: lineOf(n.getStart(sf)), side, reads: ['id'], gates: ['parent'], how: 'bridgeRequest' });
    }
    // Alias: const t = x.dgn | const { dgn } = x
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const init = unwrap(n.initializer);
      if (ts.isIdentifier(n.name) && init && ts.isPropertyAccessExpression(init) && init.name.getText(sf) === 'dgn')
        aliases.set(n.name.getText(sf), baseText(init.expression));
      if (ts.isObjectBindingPattern(n.name))
        for (const el of n.name.elements)
          if ((el.propertyName ?? el.name).getText(sf) === 'dgn') aliases.set(el.name.getText(sf), baseText(n.initializer));
    }
    // Handle: x.dgn === / !== '<lit>' (either order), or alias === '<lit>'
    if (
      ts.isBinaryExpression(n) &&
      [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(
        n.operatorToken.kind
      )
    ) {
      const neg = n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
      for (const [a0, b] of [
        [n.left, n.right],
        [n.right, n.left],
      ]) {
        const a = unwrap(a0);
        let recv = null;
        if (ts.isPropertyAccessExpression(a) && a.name.getText(sf) === 'dgn') recv = baseText(a.expression);
        else if (ts.isIdentifier(a) && aliases.has(a.getText(sf))) recv = aliases.get(a.getText(sf));
        const lits = strLits(b);
        if (recv && lits.length) {
          const stmts = branchStmts(n, neg);
          const gates = [...new Set([...preGates(listenerOf(n)), ...gatesOf(stmts.map((s) => s.getText(sf)).join('\n'))])];
          for (const t of lits)
            out.handles.push({ type: t, file: rel, line: lineOf(n.getStart(sf)), side, reads: readsOn(stmts, recv), gates, how: neg ? '!==' : '===' });
        }
      }
    }
    // Handle: switch (x.dgn) { case '<lit>': … }
    if (ts.isSwitchStatement(n)) {
      const e = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(e) && e.name.getText(sf) === 'dgn') {
        const recv = baseText(e.expression);
        const pre = preGates(listenerOf(n));
        for (const cl of n.caseBlock.clauses)
          if (ts.isCaseClause(cl))
            for (const t of strLits(cl.expression))
              out.handles.push({
                type: t,
                file: rel,
                line: lineOf(cl.getStart(sf)),
                side,
                reads: readsOn(cl.statements, recv),
                gates: [...new Set([...pre, ...gatesOf(cl.statements.map((s) => s.getText(sf)).join('\n'))])],
                how: 'case',
              });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

/** Inventory every dgn message type under `root`. */
export function inventory(root = REPO, { scan = DEFAULT_SCAN } = {}) {
  const ts = loadTs();
  const files = [];
  for (const [d, re] of scan) walk(join(root, d), re, files);
  const out = { sends: [], handles: [] };
  for (const f of files) {
    const rel = relative(root, f).split('\\').join('/');
    const src = readFileSync(f, 'utf8');
    if (!/dgn|bridgeRequest\(/.test(src)) continue;
    if (f.endsWith('.html')) {
      const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
      let m;
      while ((m = re.exec(src))) {
        const pre = src.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1;
        scanSourceFile(ts, rel, ts.createSourceFile(rel, m[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), out, pre);
      }
      continue;
    }
    const kind = f.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : f.endsWith('.ts')
        ? ts.ScriptKind.TS
        : f.endsWith('.jsx')
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.JS;
    scanSourceFile(ts, rel, ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind), out);
  }
  const byType = new Map();
  const row = (t) => {
    if (!byType.has(t)) byType.set(t, { type: t, sends: [], handles: [] });
    return byType.get(t);
  };
  for (const s of out.sends) row(s.type).sends.push(s);
  for (const h of out.handles) row(h.type).handles.push(h);
  const rows = [...byType.values()].sort((a, b) => a.type.localeCompare(b.type));
  for (const r of rows) {
    const ss = new Set(r.sends.map((s) => s.side));
    const hs = new Set(r.handles.map((h) => h.side));
    const dir = [];
    if (ss.has('canvas') && hs.has('shell')) dir.push('c2s');
    if (ss.has('shell') && hs.has('canvas')) dir.push('s2c');
    if (ss.has('canvas') && hs.has('canvas') && !ss.has('shell') && !hs.has('shell')) dir.push('self');
    if (ss.has('shell') && hs.has('shell') && !ss.has('canvas') && !hs.has('canvas')) dir.push('shell-self');
    r.dir = dir;
    r.orphan = r.sends.length === 0 ? 'no-sender' : r.handles.length === 0 ? 'no-handler' : null;
    r.dynamic = r.type.startsWith('<dynamic:');
    r.keys = [...new Set([...r.sends.flatMap((s) => s.keys.filter((k) => !k.startsWith('...'))), ...r.handles.flatMap((h) => h.reads)])].sort();
  }
  return { files: files.length, sendSites: out.sends.length, handleSites: out.handles.length, rows };
}

function shortPath(f) {
  return f
    .replace(/^apps\/studio\//, '')
    .replace(/^plugins\/design\/templates\//, 'tpl/')
    .replace(/^apps\/hub\/src\//, 'hub/');
}

function main(argv) {
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? resolve(argv[ri + 1]) : REPO;
  const inv = inventory(root);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(inv, null, 1)}\n`);
    return;
  }
  const real = inv.rows.filter((r) => !r.dynamic);
  const lines = [
    `files ${inv.files} · send sites ${inv.sendSites} · handle sites ${inv.handleSites} · types ${real.length}` +
      ` (+${inv.rows.length - real.length} dynamic send sites)`,
    '',
    '| type | dir | payload keys | senders | handlers · gates |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const r of inv.rows) {
    const byFile = new Map();
    for (const h of r.handles) {
      const k = `${shortPath(h.file)}:${h.line}`;
      if (!byFile.has(k)) byFile.set(k, new Set());
      for (const g of h.gates) byFile.get(k).add(g);
    }
    const hs = [...byFile].map(([f, g]) => `${f}${g.size ? `·${[...g].sort().join('+')}` : ''}`).join(' ');
    const ss = [...new Set(r.sends.map((s) => `${shortPath(s.file)}:${s.line}`))].join(' ');
    lines.push(`| \`${r.type}\` | ${r.dir.join('+') || r.orphan || '?'} | ${r.keys.join(', ')} | ${ss || '—'} | ${hs || '—'} |`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
