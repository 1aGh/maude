// fix-bulk W1 follow-up — no recipe teaches `curl-local` against a studio route that needs the key.
//
// Since 2.1.0 the studio's main origin answers every caller without its key 401 `api-key-required`
// (contract sec-loopback-bearer §7, apps/studio/shell/api-key.ts `isExempt`). `curl-local` is a plain
// loopback curl and sends no key, by design, so a recipe like `maude design curl-local
// http://127.0.0.1:<port>/_api/canvas …` works against a key-less dev server and fails against the
// app — which is where the AI chat runs. The plugin taught exactly that for creating, renaming and
// moving a canvas; those recipes now teach `maude design canvas-new` / `canvas-move`.
//
// This scans what the AI is taught — plugin markdown and Codex mirrors, the registry's agent recipes
// (actions/agents.ts and the generated manifests), and the CLI's hook / guard hints — for a
// `curl-local` that names an `/_api/` route in the same paragraph. The few routes a curl-local still
// reaches without the key are listed (EXEMPT). Recipes not converted yet are named in PENDING, a
// closed ratchet: a new one is red, and so is a PENDING entry that no recipe uses any more.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Routes the key gate answers without a credential (api-key.ts `isExempt`, the GET half aside). */
const EXEMPT = new Set(['/_api/hub-signin/return', '/_api/shell/status', '/_api/shell/session']);

/**
 * Never again through curl-local: a verb that sends the studio's key replaces each family —
 * canvas-new / canvas-move (W1 follow-up), then asset-trash / asset-rename, retry-save and the
 * `sync` sub-verbs compare / keep-mine / use-theirs / keep-both / publish-ai-edit /
 * discard-ai-edit / cancel-transfer (fix-bulk 2026-11-10 follow-up), and footage show|save.
 */
const BANNED = new Set([
  '/_api/canvas',
  '/_api/fs-move',
  '/_api/assets/trash',
  '/_api/assets/rename',
  '/_api/diagnostics/disk-retry',
  '/_api/project/conflict',
  '/_api/project/ai-action',
  '/_api/sync/cancel-assets',
  '/_api/footage',
]);

/**
 * Recipes still taught through curl-local against a keyed route (each broken against the app). A
 * closed ratchet, empty since the fix-bulk 2026-11-10 follow-up: a new one gets a verb, never a line.
 */
const PENDING = new Set([]);

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const isTest = (p) => /\.test\.[cm]?[jt]sx?$/.test(p) || p.includes('/test/');

function taughtFiles() {
  const plugin = walk(join(ROOT, 'plugins'), (p) => /\.(md|json)$/.test(p) && !isTest(p));
  const hints = ['design-hook.mjs', 'bash-guard.mjs', 'design-help.gen.mjs'].map((f) =>
    join(ROOT, 'cli', 'lib', f)
  );
  const registry = [
    join(ROOT, 'apps', 'studio', 'actions', 'agents.ts'),
    join(ROOT, 'apps', 'studio', 'actions.manifest.json'),
  ];
  return [...plugin, ...hints, ...registry];
}

/** Every `/_api/…` route a `curl-local` in `text` is taught against: `[route, where]`. */
export function curlLocalRoutes(text, { markdown = true } = {}) {
  const out = [];
  // The unit: a line of source, a manifest or a markdown table; a whole markdown paragraph otherwise
  // (prose wraps, a shell recipe continues with `\`).
  const units = [];
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split('\n');
    if (!markdown || lines.some((l) => /^\s*\|/.test(l))) units.push(...lines);
    else units.push(lines.join(' '));
  }
  for (const unit of units) {
    if (!/design curl-local/.test(unit)) continue; // a taught command, not a comment naming the verb
    for (const r of unit.matchAll(/\/_api\/[A-Za-z0-9_\-/]*[A-Za-z0-9_-]/g))
      out.push([r[0], unit.replace(/\s+/g, ' ').trim().slice(0, 160)]);
  }
  return out;
}

test('the detector sees the old recipes (not vacuous)', () => {
  const old = `Create it with \`maude design curl-local http://127.0.0.1:<port>/_api/canvas --method POST --data '{"kind":"blank"}'\``;
  assert.deepEqual(
    curlLocalRoutes(old).map(([r]) => r),
    ['/_api/canvas']
  );
  const wrapped =
    'Make the canvas: `POST /_api/fs-move` through\n`maude design curl-local`, then Edit.';
  assert.deepEqual(
    curlLocalRoutes(wrapped).map(([r]) => r),
    ['/_api/fs-move']
  );
  assert.deepEqual(curlLocalRoutes('`maude design canvas-new "<name>"`'), []);
});

test('no taught curl-local recipe hits a keyed studio route (ratchet: PENDING)', () => {
  const found = new Map(); // route → [file: excerpt]
  for (const file of taughtFiles()) {
    const markdown = file.endsWith('.md');
    for (const [route, where] of curlLocalRoutes(readFileSync(file, 'utf8'), { markdown })) {
      if (EXEMPT.has(route)) continue;
      const list = found.get(route) ?? [];
      list.push(`${relative(ROOT, file)}: ${where}`);
      found.set(route, list);
    }
  }
  const banned = [...found].filter(([r]) => BANNED.has(r)).flatMap(([, w]) => w);
  assert.deepEqual(banned, [], 'these routes have verbs that send the key: teach the verb');
  const fresh = [...found].filter(([r]) => !PENDING.has(r) && !BANNED.has(r));
  assert.deepEqual(
    fresh,
    [],
    'a new curl-local recipe against a keyed route — the studio answers it 401 (give it a verb)'
  );
  const gone = [...PENDING].filter((r) => !found.has(r));
  assert.deepEqual(gone, [], 'no recipe uses these any more — drop them from PENDING');
});
