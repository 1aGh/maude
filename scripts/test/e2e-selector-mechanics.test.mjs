// V2-8.3 spec drift (p8-e2e-specs-a): a desktop e2e scenario can only pass if every hook it reaches for still
// exists in the product. The lanes cannot run unattended (they need the screen), so this is the offline
// half: every `data-testid` / `data-*` attribute / class a scenario (and the helpers it imports, transitively)
// puts in a selector must be PRODUCED somewhere in the studio source, or be a live (not retired) pattern in
// `apps/studio/client/testids.json`. A spec left on a v1 class (`.sh-rp-tab`, `.cv-meta--count`) or a retired
// testid is a red test here, long before a lane burns a screen slot on it.
//
// Scope: SCOPE below. A spec joins it when its steps have been rewritten against the shipped v2 hooks.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const E2E = join(ROOT, 'apps/desktop/e2e');
const STUDIO = join(ROOT, 'apps/studio');
/** What ships a page the scenarios drive: the studio client and the desktop shell's own pages (the tab strip). */
const SOURCE_ROOTS = [STUDIO, join(ROOT, 'apps/desktop/src')];

/** Scenarios whose selectors are held to the product. Add a spec here when you rewrite it. */
export const SCOPE = [
  'scenarios/ds-review.e2e.ts',
  'scenarios/ds-reach.e2e.ts',
  'scenarios/ds-edges.e2e.ts',
  'scenarios/git-lifecycle.e2e.ts',
  'scenarios/generate-takes.e2e.ts',
  'scenarios/project-tabs-identity.e2e.ts',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'contracts', '.git', 'target', 'e2e']);
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|css)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE_EXT.test(name) && !/\.(?:test|spec|gen)\./.test(name)) out.push(p);
  }
  return out;
}

let corpusCache;
/** Everything the studio ships (client, DS board, canvas-lib …) as one string, plus the dynamic testid prefixes. */
function corpus() {
  if (corpusCache) return corpusCache;
  const text = SOURCE_ROOTS.flatMap((r) => walk(r))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  // `data-testid={`canvas-row-${slug}`}` / `testid: `x-${y}`` → the literal head is a valid prefix
  const prefixes = new Set();
  for (const m of text.matchAll(
    /(?:data-testid|[tT]estid|buttonTestid)\s*[=:]\s*\{?\s*`([^`$]*)\$\{/g
  ))
    if (m[1]) prefixes.add(m[1]);
  // …or set from script: el.setAttribute('data-testid', 'tab-' + label)
  for (const m of text.matchAll(
    /setAttribute\(\s*['"]data-testid['"]\s*,\s*['"]([^'"]+)['"]\s*\+/g
  ))
    prefixes.add(m[1]);
  // a testid built from a plain string concatenation: 'name-' + x
  for (const m of text.matchAll(/(?:data-testid|[tT]estid)\s*[=:]\s*\{?\s*['"]([^'"]+)['"]\s*\+/g))
    prefixes.add(m[1]);
  const hooks = JSON.parse(readFileSync(join(STUDIO, 'client/testids.json'), 'utf8'));
  const live = hooks.filter((h) => h.kind === 'testid' && h.v2 !== 'retired');
  const patterns = live
    .filter((h) => h.pattern)
    .map(
      (h) =>
        new RegExp(`^${h.hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>/g, '.+')}$`)
    );
  const literal = new Set(live.filter((h) => !h.pattern).map((h) => h.hook));
  // `canvas-row-meta-<slug>` → the head `canvas-row-meta-` is a valid prefix
  const patternHeads = live.filter((h) => h.pattern).map((h) => h.hook.split('<')[0]);
  corpusCache = { text, prefixes: [...prefixes], patterns, literal, patternHeads };
  return corpusCache;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is this testid produced by the product? */
export function testidExists(id, { prefix = false } = {}) {
  const c = corpus();
  const quoted = new RegExp(`['"\`]${escapeRe(id)}${prefix ? '' : '[\'"`]'}`);
  if (quoted.test(c.text)) return true;
  if (prefix) {
    if (c.prefixes.some((p) => p.startsWith(id) || id.startsWith(p))) return true;
    return (
      [...c.literal].some((h) => h.startsWith(id)) ||
      c.patternHeads.some((h) => h.startsWith(id) || id.startsWith(h))
    );
  }
  if (c.literal.has(id)) return true;
  if (c.patterns.some((re) => re.test(id))) return true;
  return c.prefixes.some((p) => id.startsWith(p));
}

export function attrExists(name) {
  return new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`).test(corpus().text);
}

export function classExists(name) {
  return new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`).test(corpus().text);
}

/** Relative imports of an e2e source, resolved to files. */
function importsOf(file, text) {
  const out = [];
  for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const base = resolve(dirname(file), m[1]);
    for (const cand of [`${base}.ts`, `${base}.mjs`, join(base, 'index.ts')])
      if (existsSync(cand)) {
        out.push(cand);
        break;
      }
  }
  return out;
}

/** The scenario plus every helper it reaches (the e2e dir only: fixtures run under bun, not in the page). */
export function filesFor(scenarioRel) {
  const seen = new Set();
  const todo = [join(E2E, scenarioRel)];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of importsOf(f, readFileSync(f, 'utf8')))
      if (dep.startsWith(`${E2E}/helpers/`)) todo.push(dep);
  }
  return [...seen];
}

/**
 * Every selector hook a source file reaches for:
 *   testids   `[data-testid="x"]` · `tid('x')` · `[data-testid^="x"]` (prefix)
 *   attrs     `[data-foo=…]` / `[data-foo]`
 *   classes   `.foo` inside a selector string handed to $ / $$ / querySelector(All) / closest / matches
 */
export function hooksIn(source) {
  // comments name hooks that are gone ("was `x`") — only code counts
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const testids = new Map(); // id → { prefix }
  const attrs = new Set();
  const classes = new Set();
  // a templated id (`row-${x}`) is built at run time: its literal head is a prefix, a bare `${x}` says nothing
  const add = (id, prefix) => {
    const cut = id.indexOf('${');
    if (cut === 0) return;
    if (cut > 0) testids.set(id.slice(0, cut), { prefix: true });
    else testids.set(id, { prefix });
  };
  for (const m of text.matchAll(/\[data-testid(\^?)=\\?["']([^"'\\\]]+)\\?["']\]/g))
    add(m[2], m[1] === '^');
  for (const m of text.matchAll(/\btid\(\s*(['"`])([^'"`]+)\1\s*\)/g)) add(m[2], false);
  for (const m of text.matchAll(/\[(data-(?!testid)[a-z][\w-]*)/g)) attrs.add(m[1]);
  const selectorCall =
    /(?:\$\$?|querySelector(?:All)?|closest|matches|waitForExist)\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;
  for (const m of text.matchAll(selectorCall)) {
    // drop attribute selectors and quoted values first, so `[data-path="ui/Home.tsx"]` yields no `.tsx` class
    const s = m[2].replace(/\[[^\]]*\]/g, '').replace(/\$\{[^}]*\}/g, '');
    for (const c of s.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(c[1]);
  }
  return { testids, attrs, classes };
}

test('hooksIn finds testids, attributes and classes in selector strings', () => {
  const h = hooksIn(
    `$('[data-testid="a-b"]'); tid('c-d'); $$('[data-testid^="e-"]');
     el.closest('.cv-row'); $('[data-ds-direction="a"]'); $('[data-path="ui/Home.tsx"]')`
  );
  assert.deepEqual([...h.testids.keys()].sort(), ['a-b', 'c-d', 'e-']);
  assert.equal(h.testids.get('e-').prefix, true);
  assert.deepEqual([...h.classes], ['cv-row']);
  assert.deepEqual([...h.attrs].sort(), ['data-ds-direction', 'data-path']);
});

test('the product check knows real, retired and made-up hooks', () => {
  assert.ok(testidExists('ds-bar-review'), 'a live testid');
  assert.ok(testidExists('canvas-row-ui-landing'), 'a pattern testid');
  assert.ok(testidExists('canvas-row-', { prefix: true }), 'a prefix');
  assert.ok(!testidExists('this-hook-is-not-in-the-product'));
  assert.ok(classExists('lp-adv-row'));
  assert.ok(!classExists('no-such-class-in-the-product'));
});

/**
 * Selector MECHANICS that read as present and never match (found in the p8 lanes, so pinned here):
 *   `$('*=text')` / `$('=text')`  WebdriverIO link-text selectors — anchors only, never a toast or a button
 *   `.selectByAttribute(` …       the embedded WebDriver's option click does not select in WKWebView (helpers/select.ts)
 * Returns `file:line: text` for every offender in `text`.
 */
export function mechanicHits(text, file = '') {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/(^|\s)\/\/.*$/, '$1');
    if (
      /\$\$?\(\s*(['"`])\*?=/.test(code) ||
      /\.selectBy(?:Attribute|VisibleText|Index)\(/.test(code)
    )
      out.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

test('mechanicHits flags link-text selectors and option clicks, not the helper', () => {
  assert.equal(mechanicHits(`const t = await $('*=The other three');`).length, 1);
  assert.equal(mechanicHits(`await $(tid('x')).selectByAttribute('value', 'main');`).length, 1);
  assert.equal(mechanicHits(`await setSelect('vh-git-branch', 'main');`).length, 0);
  assert.equal(mechanicHits(`const a = $('[data-testid="x=y"]'); // $('*=old')`).length, 0);
});

for (const scenario of SCOPE) {
  test(`${scenario}: no selector that can never match (link text, option click)`, () => {
    const hits = filesFor(scenario).flatMap((f) =>
      mechanicHits(readFileSync(f, 'utf8'), relative(ROOT, f))
    );
    assert.deepEqual(hits, [], `use a data-testid / setSelect:\n  ${hits.join('\n  ')}`);
  });
}

for (const scenario of SCOPE) {
  test(`${scenario}: every selector it uses exists in the product`, () => {
    const missing = [];
    for (const file of filesFor(scenario)) {
      const rel = relative(ROOT, file);
      const { testids, attrs, classes } = hooksIn(readFileSync(file, 'utf8'));
      for (const [id, { prefix }] of testids)
        if (!testidExists(id, { prefix }))
          missing.push(`${rel}: data-testid ${prefix ? '^=' : '='} ${id}`);
      for (const a of attrs) if (!attrExists(a)) missing.push(`${rel}: attribute ${a}`);
      for (const c of classes) if (!classExists(c)) missing.push(`${rel}: class .${c}`);
    }
    assert.deepEqual(
      missing,
      [],
      `selectors the product no longer produces:\n  ${missing.join('\n  ')}`
    );
  });
}
