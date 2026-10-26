// V2-8.3 (p8-e2e-specs-b): a desktop e2e spec can only be green if every hook it reaches for still exists.
//
// The default lane went red with 28 specs after P8 moved hooks and words (v1 class selectors such as
// `.sh-rp-tab` / `.cv-meta--count`, retired testids), and nobody knew until a person ran the app on a
// screen. This is the offline half: every `data-testid` / `data-tour` / class selector a spec or helper
// names must still be produced by the product's source (client, canvas lib, shell) — a literal, or a
// template/concatenation prefix for a dynamic id (`canvas-row-${slug}`).
//
// What it cannot know: that the element is VISIBLE at that step, or that the words match. Those need the
// screen lane. What it does catch: a rename, a retirement, a v1 class that no CSS or JSX mentions any more.
//
// A selector that is deliberately not a product hook (a fixture page's own markup, a native shell element,
// something a spec plants itself) is listed in `ELSEWHERE` below, with its reason — never silently skipped.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const E2E = join(ROOT, 'apps/desktop/e2e');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'target',
  'test',
  '.git',
  '_e2e-evidence',
  'vendor',
  'gen',
  'tour',
  '.claude',
]);

function walk(dir, re, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.') && name !== '.design') continue; // the fixture project's design root
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, re, out);
    else if (re.test(name)) out.push(p);
  }
  return out;
}

/** What the product can produce: the studio (client, canvas lib, server-rendered shells) and the desktop shell pages. */
function productCorpus() {
  const files = [
    ...walk(join(ROOT, 'apps/studio'), /\.(m?[jt]sx?|css|html)$/),
    ...walk(join(ROOT, 'apps/desktop/src'), /\.(m?[jt]sx?|css|html)$/),
    ...walk(join(ROOT, 'apps/desktop/src-tauri/src'), /\.rs$/),
    // the fixture project's own canvases carry their own hooks (`smoke-h1`, `smoke-card-body`)
    ...walk(join(E2E, 'fixtures'), /\.(m?[jt]sx?|html)$/, []),
  ];
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** `foo-${x}` / `'foo-' + x` in the product → `foo-`: a dynamic id's fixed head. */
export function dynamicHeads(corpus) {
  const heads = new Set();
  for (const m of corpus.matchAll(/([a-z][a-z0-9]*(?:-[a-z0-9]+)*-)\$\{/g)) heads.add(m[1]);
  for (const m of corpus.matchAll(/['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)*-)['"]\s*\+/g))
    heads.add(m[1]);
  return heads;
}

/**
 * Every hook a spec names, as `{ kind, name, dynamic, prefixOnly, file, line }`.
 * `dynamic`: the name holds a `${…}` (only its head is checked). `prefixOnly`: `^=` / `*=` selectors name a head.
 */
export function selectorsIn(text, file = '') {
  const found = [];
  const lines = text.split('\n');
  const add = (kind, raw, i, prefixOnly = false) => {
    let name = raw;
    let dynamic = false;
    const at = name.indexOf('${');
    if (at >= 0) {
      name = name.slice(0, at);
      dynamic = true;
    }
    if (!name) return;
    found.push({ kind, name, dynamic, prefixOnly, file, line: i + 1 });
  };
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment names things on purpose
    for (const m of line.matchAll(/data-testid(\^|\*|\$)?=\\?["']?([A-Za-z0-9_${}.:<>-]+)/g)) {
      add('testid', m[2], i, m[1] === '^' || m[1] === '*' || m[1] === '$');
    }
    for (const m of line.matchAll(/data-tour=\\?["']?([A-Za-z0-9_${}.:-]+)/g)) add('tour', m[1], i);
    // the `tid('x')` / `canvasRow('x')` / `dsRow(...)` helpers specs define or share
    for (const m of line.matchAll(
      /\b(?:tid|canvasRow|byTestId|testid)\(\s*(['"`])([A-Za-z0-9_${}.:<>-]+)\1/g
    )) {
      add('testid', m[2], i);
    }
    // class selectors inside a selector string: $('.x'), $$('button.x'), querySelector('…'), closest('…'), matches('…')
    for (const m of line.matchAll(
      /(?:\$\$?|querySelector(?:All)?|closest|matches)\(\s*(['"`])((?:(?!\1).)*)\1/g
    )) {
      const sel = m[2].replace(/\[[^\]]*\]/g, ' ');
      for (const c of sel.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
        if (/^\d/.test(c[1])) continue;
        add('class', c[1], i);
      }
    }
  });
  return found;
}

/**
 * Selectors that are NOT a hook of this product, with why. A path-relative file keeps an entry honest: it is
 * only exempt in the spec that needs it.
 */
const ELSEWHERE = [
  // Asserted ABSENT — the spec names a retired hook to prove it is gone:
  {
    file: 'scenarios/acp-cold-start.e2e.ts',
    name: 'acp-not-connected',
    why: 'asserted absent (the banner was retired)',
  },
  {
    file: 'scenarios/onboarding.e2e.ts',
    name: 'onboarding-wizard',
    why: 'asserted absent (the wizard was retired for Home)',
  },
  // Planted by the spec itself, not by the product:
  {
    file: 'scenarios/s20-deployment.e2e.ts',
    name: 's20-release-check',
    why: 'the slug of a throwaway canvas the spec writes',
  },
  {
    file: 'multiplayer/surface.e2e.ts',
    name: 'surface-moved-media',
    why: 'markup of a canvas the spec seeds',
  },
  {
    file: 'multiplayer/surface.e2e.ts',
    name: 'surface-dep',
    why: 'markup of a canvas the spec seeds',
  },
  // A diagnostic read whose answer may be `null`:
  {
    file: 'scenarios/team-project.e2e.ts',
    name: 'sp-note',
    why: 'read into a report object; null is a valid answer',
  },
];

const hooks = JSON.parse(readFileSync(join(ROOT, 'apps/studio/client/testids.json'), 'utf8'));
const corpus = productCorpus();
const heads = dynamicHeads(corpus);

function hookExists({ kind, name, dynamic, prefixOnly }) {
  if (kind === 'class') {
    return new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[-]/g, '\\-')}([^A-Za-z0-9_-]|$)`).test(
      corpus
    );
  }
  if (kind === 'tour') return corpus.includes(name);
  // a literal anywhere in the product (JSX attribute, helper table, template head)…
  if (corpus.includes(name)) return true;
  // …or a dynamic id whose head the product builds (`canvas-row-${slug}` → `canvas-row-ui-smoke`)
  if (!dynamic || prefixOnly) {
    for (const h of heads) if (h.length >= 4 && name.startsWith(h)) return true;
  }
  // …or a pattern hook the contract lists and has not retired (`panel-tab-<id>`)
  return hooks.some((h) => {
    if (h.v2 === 'retired' || !String(h.kind).startsWith('testid')) return false;
    if (h.hook === name) return true;
    if (!h.hook.includes('<')) return false;
    const head = h.hook.slice(0, h.hook.indexOf('<'));
    return head.length >= 4 && name.startsWith(head);
  });
}

const specs = [
  ...walk(join(E2E, 'scenarios'), /\.e2e\.ts$/),
  ...walk(join(E2E, 'helpers'), /\.ts$/),
  ...walk(join(E2E, 'multiplayer'), /\.e2e\.ts$/),
];

test('the scan reads the selector forms specs use', () => {
  const s = selectorsIn(
    [
      `await $('[data-testid="kind-chip-video"]').click();`,
      'await $$(\'[data-testid^="canvas-row-"]\');',
      'await $(`[data-testid="canvas-row-${slug}"]`);',
      "const row = await canvasRow('canvas-row-ui-smoke');",
      "await $('button.sh-rp-tab');",
      "// $('.in-a-comment')",
    ].join('\n')
  );
  assert.deepEqual(
    s.map((x) => `${x.kind}:${x.name}${x.dynamic ? '*' : ''}${x.prefixOnly ? '^' : ''}`),
    [
      'testid:kind-chip-video',
      'testid:canvas-row-^',
      'testid:canvas-row-*',
      'testid:canvas-row-ui-smoke',
      'class:sh-rp-tab',
    ]
  );
});

test('a hook nothing produces is not found in the product', () => {
  assert.equal(
    hookExists({ kind: 'testid', name: 'zz-no-such-hook', dynamic: false, prefixOnly: false }),
    false
  );
  assert.equal(
    hookExists({ kind: 'class', name: 'zz-no-such-class', dynamic: false, prefixOnly: false }),
    false
  );
  assert.equal(
    hookExists({ kind: 'testid', name: 'canvas-row-ui-smoke', dynamic: false, prefixOnly: false }),
    true
  );
  assert.equal(
    hookExists({ kind: 'class', name: 'cv-meta--count', dynamic: false, prefixOnly: false }),
    true
  );
});

test('every hook a desktop e2e spec or helper names still exists in the product', () => {
  const missing = [];
  for (const f of specs) {
    const rel = relative(E2E, f);
    for (const s of selectorsIn(readFileSync(f, 'utf8'), rel)) {
      if (ELSEWHERE.some((e) => e.file === rel && e.name === s.name)) continue;
      if (!hookExists(s))
        missing.push(`${rel}:${s.line}  ${s.kind} "${s.name}"${s.dynamic ? ' (dynamic)' : ''}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `selectors the product no longer produces:\n  ${missing.join('\n  ')}`
  );
});
