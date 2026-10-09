#!/usr/bin/env node
// Frozen v1 reachability manifest (plan V2-2.0c).
//
//   node scripts/v2-manifest/scan-v1.mjs --write    scan today's code → apps/studio/client/v2/v1-manifest.json
//   node scripts/v2-manifest/scan-v1.mjs --check    exit 1 when the code has a v1 entry point the frozen
//                                                   manifest does not list (added after the freeze)
//   node scripts/v2-manifest/scan-v1.mjs --stats    counts per kind, nothing written
//
// "Reachable v1 entry point" = anything a person can invoke in today's studio, read from source:
//   item         an object literal with a `label` and an `id`/`op`/`key`/`action`/`value` — menu rows
//                (the six MENU_NAMES dropdowns), palette actions, Settings tabs, context-menu rows,
//                tool groups, dock tabs
//   button       a <button> / role="button" with an onClick, named by its text, aria-label or title
//   keydown      a keydown listener (addEventListener('keydown') or onKeyDown=) with the keys it reads
//   contextmenu  an onContextMenu handler
//   panel        a dock panel id (ui-prefs DOCK_PANEL_IDS) and every panels/*.jsx component
//   testid       every hook in apps/studio/client/testids.json (the V2-0.1 testid contract)
//   native-menu  every item of the Tauri app menu (apps/desktop/src-tauri/src/menu.rs)
// Ids are stable strings `<kind>:<file>#<scope>/<key>`; the manifest is written once (the freeze)
// and only ever grows by an explicit --write. scripts/check-v2-nothing-deleted.mjs maps every
// entry to a v2 home.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(REPO, 'apps/studio/client/v2/v1-manifest.json');
const ts = createRequire(join(REPO, 'apps/studio/package.json'))('typescript');

// The shell (client/**) plus the canvas-iframe chrome a person reaches today.
const ROOTS = [
  ['apps/studio/client', /\.(jsx?|tsx?)$/],
  [
    'apps/studio',
    /^(context-menu|canvas-shell|tool-palette|annotations-layer|comments-overlay|participants-chrome|video-comp)\.tsx$/,
  ],
];
const SKIP = /(^|\/)(v2\/contracts|node_modules|__tests__)(\/|$)|\.test\.|\.d\.ts$/;

function files() {
  const out = [];
  for (const [root, re] of ROOTS) {
    const abs = join(REPO, root);
    const walk = (dir, deep) => {
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        const rel = relative(REPO, p).split('\\').join('/');
        if (SKIP.test(rel)) continue;
        if (statSync(p).isDirectory()) {
          if (deep) walk(p, true);
        } else if (re.test(deep ? rel : name)) out.push(rel);
      }
    };
    walk(abs, root === 'apps/studio/client');
  }
  return out;
}

const slug = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'x';

function textOf(node, sf) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(sf).slice(1, -1);
  if (ts.isJsxExpression(node)) return textOf(node.expression, sf);
  return null;
}

/** The entry's scope: the nearest named function/class, plus the nearest variable inside it
 *  (`FileDropdown.items`) when one is closer — so rows keep their component's name. */
function scopeOf(node) {
  let varName = null;
  const named = (name) => (varName ? `${name}.${varName}` : name);
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name)
      return named(n.name.text);
    if (ts.isMethodDeclaration(n) && n.name && ts.isIdentifier(n.name)) return named(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const init = n.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
        return named(n.name.text);
      if (!varName) varName = n.name.text;
    }
  }
  return varName ?? 'module';
}

/** The nearest enclosing function-like node (to resolve a handler name locally). */
function enclosingFn(node) {
  for (let n = node.parent; n; n = n.parent)
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isArrowFunction(n) ||
      ts.isFunctionExpression(n) ||
      ts.isMethodDeclaration(n)
    )
      return n;
  return null;
}

/** A stable key for an unnamed button: the start of its onClick handler's source. */
function handlerText(attr, sf) {
  if (!attr || attr === true) return 'x';
  return attr.getText(sf).replace(/\s+/g, ' ').slice(1, 60);
}

function jsxAttr(attrs, name) {
  for (const a of attrs.properties)
    if (ts.isJsxAttribute(a) && a.name.getText() === name) return a.initializer ?? true;
  return undefined;
}

function staticChildrenText(el, sf) {
  if (!ts.isJsxElement(el)) return null;
  const parts = [];
  const visit = (n) => {
    if (ts.isJsxText(n)) parts.push(n.text);
    else if (ts.isJsxExpression(n) && n.expression && ts.isStringLiteral(n.expression))
      parts.push(n.expression.text);
    else ts.forEachChild(n, visit);
  };
  for (const c of el.children) visit(c);
  const t = parts.join(' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

function scanFile(rel) {
  const src = readFileSync(join(REPO, rel), 'utf8');
  const kind = rel.endsWith('x')
    ? ts.ScriptKind.TSX
    : rel.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const add = (e) => found.push({ file: rel, ...e });

  const visit = (node) => {
    // item — { id|op|key|action|value: '…', label: '…' }
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map();
      for (const p of node.properties)
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)))
          props.set(p.name.text, p.initializer);
      const label = textOf(props.get('label'), sf);
      const keyProp = ['id', 'op', 'key', 'action', 'value'].find(
        (k) => textOf(props.get(k), sf) != null
      );
      if (label != null && keyProp) {
        const shortcut =
          textOf(props.get('shortcut'), sf) ?? textOf(props.get('kbd'), sf) ?? undefined;
        add({
          kind: 'item',
          scope: scopeOf(node),
          key: textOf(props.get(keyProp), sf),
          label,
          shortcut,
        });
      }
    }
    // button / role=button with onClick; contextmenu; keydown via onKeyDown=
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const attrs = node.attributes;
      const role = textOf(jsxAttr(attrs, 'role'), sf);
      const testid = textOf(jsxAttr(attrs, 'data-testid'), sf) ?? undefined;
      if (
        (tag === 'button' || role === 'button' || role === 'menuitem' || role === 'tab') &&
        jsxAttr(attrs, 'onClick')
      ) {
        const el = ts.isJsxOpeningElement(node) ? node.parent : node;
        const label =
          textOf(jsxAttr(attrs, 'aria-label'), sf) ??
          staticChildrenText(el, sf) ??
          textOf(jsxAttr(attrs, 'title'), sf) ??
          testid ??
          null;
        add({
          kind: 'button',
          scope: scopeOf(node),
          key: testid ?? label ?? `onclick-${handlerText(jsxAttr(attrs, 'onClick'), sf)}`,
          label: label ?? '(dynamic)',
          testid,
        });
      }
      if (jsxAttr(attrs, 'onContextMenu'))
        add({
          kind: 'contextmenu',
          scope: scopeOf(node),
          key: testid ?? tag,
          label: `right-click on <${tag}>`,
          testid,
        });
      const onKey = jsxAttr(attrs, 'onKeyDown');
      if (onKey)
        add({
          kind: 'keydown',
          scope: scopeOf(node),
          key: testid ?? tag,
          label: `keys on <${tag}>`,
          keys: keysIn(onKey, sf),
          testid,
        });
    }
    // keydown via addEventListener('keydown', …)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener' &&
      textOf(node.arguments[0], sf) === 'keydown'
    ) {
      add({
        kind: 'keydown',
        scope: scopeOf(node),
        key: 'listener',
        label: 'keydown listener',
        keys: keysIn(node.arguments[1], sf, enclosingFn(node)),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Key names a handler compares against: e.key === 'k', e.code === 'KeyK', key === 'Escape', case 'Enter'. */
function keysIn(node, sf, scopeNode = null) {
  if (!node) return [];
  let target = node;
  if (scopeNode !== null && ts.isIdentifier(node)) {
    // a named handler: resolve it in the listener's own function first, then the file
    target = findDecl(scopeNode, node.text) ?? findDecl(sf, node.text) ?? node;
  }
  const keys = new Set();
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && /^={2,3}$/.test(n.operatorToken.getText(sf))) {
      const l = n.left.getText(sf);
      const r = textOf(n.right, sf);
      if (r != null && /(^|\.)(key|code)$|^k$/.test(l)) keys.add(r);
    }
    if (ts.isCaseClause(n)) {
      const v = textOf(n.expression, sf);
      if (v != null && v.length <= 16) keys.add(v);
    }
    ts.forEachChild(n, visit);
  };
  visit(target);
  return [...keys].sort();
}

function findDecl(root, name) {
  if (!root) return null;
  let hit = null;
  const visit = (n) => {
    if (hit) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) hit = n;
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name)
      hit = n;
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(root, visit);
  return hit;
}

function panels() {
  const out = [];
  const prefs = readFileSync(join(REPO, 'apps/studio/ui-prefs.ts'), 'utf8');
  const m = prefs.match(/DOCK_PANEL_IDS\s*=\s*\[([\s\S]*?)\]/);
  for (const id of m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [])
    out.push({
      kind: 'panel',
      file: 'apps/studio/ui-prefs.ts',
      scope: 'DOCK_PANEL_IDS',
      key: id,
      label: `dock panel ${id}`,
    });
  for (const name of readdirSync(join(REPO, 'apps/studio/client/panels')).sort()) {
    if (!/^[A-Z].*\.jsx$/.test(name)) continue;
    out.push({
      kind: 'panel',
      file: `apps/studio/client/panels/${name}`,
      scope: 'component',
      key: name.replace(/\.jsx$/, ''),
      label: name.replace(/\.jsx$/, ''),
    });
  }
  return out;
}

function testids() {
  const list = JSON.parse(readFileSync(join(REPO, 'apps/studio/client/testids.json'), 'utf8'));
  return list.map((t) => ({
    kind: 'testid',
    file: t.producer?.file ?? 'apps/studio/client/testids.json',
    scope: t.region ?? 'shell',
    key: t.hook,
    label: t.meaning,
    testid: t.hook,
  }));
}

function nativeMenu() {
  const rel = 'apps/desktop/src-tauri/src/menu.rs';
  const src = readFileSync(join(REPO, rel), 'utf8');
  const out = [];
  for (const m of src.matchAll(
    /MenuItemBuilder::with_id\(\s*(\w+)\s*,\s*"([^"]+)"\s*\)([\s\S]*?)\.build/g
  )) {
    const acc = m[3].match(/\.accelerator\("([^"]+)"\)/);
    out.push({
      kind: 'native-menu',
      file: rel,
      scope: 'menu',
      key: m[1],
      label: m[2],
      shortcut: acc?.[1],
    });
  }
  for (const m of src.matchAll(/SubmenuBuilder::new\(\s*app\s*,\s*"([^"]+)"\s*\)/g))
    out.push({
      kind: 'native-menu',
      file: rel,
      scope: 'submenu',
      key: m[1],
      label: `${m[1]} menu`,
    });
  for (const p of ['about', 'quit', 'undo', 'redo', 'cut', 'copy', 'paste', 'select_all'])
    if (new RegExp(`\\.${p}\\(`).test(src))
      out.push({
        kind: 'native-menu',
        file: rel,
        scope: 'predefined',
        key: p,
        label: p.replace('_', ' '),
      });
  return out;
}

export function scan() {
  const raw = [...files().flatMap(scanFile), ...panels(), ...testids(), ...nativeMenu()];
  const seen = new Map();
  const entries = raw.map((e) => {
    const base = `${e.kind}:${e.file.replace(/^apps\//, '')}#${e.scope}/${slug(e.key)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}~${n}`;
    const out = { id, kind: e.kind, label: e.label, file: e.file, scope: e.scope };
    if (e.shortcut) out.shortcut = e.shortcut;
    if (e.keys?.length) out.keys = e.keys;
    if (e.testid) out.testid = e.testid;
    return out;
  });
  return entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function counts(entries) {
  const c = {};
  for (const e of entries) c[e.kind] = (c[e.kind] ?? 0) + 1;
  return Object.fromEntries(Object.entries(c).sort());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const entries = scan();
  if (mode === '--stats') {
    console.log(JSON.stringify({ total: entries.length, ...counts(entries) }, null, 2));
  } else if (mode === '--write') {
    const head = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
      cwd: REPO,
      encoding: 'utf8',
    }).trim();
    const doc = {
      schema: 'maude.v1-manifest/1',
      about:
        'Every reachable v1 entry point, frozen before any chrome moves (V2-2.0c). Generated by scripts/v2-manifest/scan-v1.mjs; scripts/check-v2-nothing-deleted.mjs maps each one to its v2 home.',
      frozenAt: head,
      total: entries.length,
      counts: counts(entries),
      entries,
    };
    writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`v1 manifest: ${entries.length} entry points → ${relative(REPO, OUT)}`);
  } else if (mode === '--check') {
    const frozen = new Set(JSON.parse(readFileSync(OUT, 'utf8')).entries.map((e) => e.id));
    const added = entries.filter((e) => !frozen.has(e.id) && !e.file.includes('/client/v2/'));
    for (const e of added) console.log(`NEW  ${e.id}  (${e.label})`);
    console.log(
      added.length
        ? `v1 manifest: ${added.length} v1 entry point(s) appeared after the freeze — map them in nothing-deleted.json and re-freeze with --write`
        : 'v1 manifest: no v1 entry point outside the freeze'
    );
    process.exit(added.length ? 1 : 0);
  } else {
    console.error('usage: scan-v1.mjs --write | --check | --stats');
    process.exit(2);
  }
}
