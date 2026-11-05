// What Cloudflare will refuse at upload, caught before the deploy step.
//
// The control plane stayed on its 2026-10-01 build for a month because
// `wrangler deploy` failed with 10021 `No such module "node:crypto"`: since
// v2.0 the Worker imports `../studio/access/scope.ts`, scope.ts imports
// `node:crypto`, and wrangler.toml had no `nodejs_compat`. The tests were
// green (Node has node:crypto) and `wrangler deploy --dry-run` only WARNED, so
// the first thing to say no was Cloudflare.
//
// Three pins:
//   1. every `node:` builtin the Worker's static import graph reaches is on
//      ALLOWED_NODE_BUILTINS — a new one is a reviewed choice;
//   2. reaching any `node:` builtin requires `nodejs_compat` in wrangler.toml;
//   3. the main module's named exports are all functions — workerd treats
//      every named export as an entrypoint, and a current workerd refuses the
//      whole script on a number or string export.
//
// The walk reads source text, so it needs no bundler and no install. CI also
// hands it the real bundle (`CLOUD_BUNDLE`, from `wrangler deploy --dry-run
// --outdir`): what esbuild actually kept is the ground truth for pins 1 and 2.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The `node:` modules the Worker may import. Each needs `nodejs_compat`. */
const ALLOWED_NODE_BUILTINS = Object.freeze([
  // scope.ts `photoEditHash` — a synchronous sha256 the studio and hub share.
  'node:crypto',
]);

// Clause = `x`, `{ a, b as c }`, `* as ns`, `x, { y }` — never `;`, `=` or `(`,
// so a lazy match cannot run from an `export const` to a later `from '…'`.
const FROM_RE = /^[ \t]*(import|export)\s+(type\s+)?[^;=()]*?\bfrom\s+['"]([^'"]+)['"]/gm;
const BARE_IMPORT_RE = /^[ \t]*import\s+['"]([^'"]+)['"]/gm;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Static imports of one source file: [{ spec, typeOnly }]. */
export function staticImports(src) {
  const text = stripComments(src);
  const out = [];
  for (const m of text.matchAll(FROM_RE)) out.push({ spec: m[3], typeOnly: Boolean(m[2]) });
  for (const m of text.matchAll(BARE_IMPORT_RE)) out.push({ spec: m[1], typeOnly: false });
  return out;
}

/** Walk the static (value) import graph from `entry`. */
export function workerGraph(entry) {
  const files = new Set();
  const node = new Set();
  const packages = new Set();
  const queue = [resolve(entry)];
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    if (file.endsWith('.json')) continue;
    for (const { spec, typeOnly } of staticImports(readFileSync(file, 'utf8'))) {
      if (typeOnly) continue;
      if (spec.startsWith('node:')) node.add(spec);
      else if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        assert.ok(existsSync(target), `${relative(here, file)} imports a missing ${spec}`);
        queue.push(target);
      } else packages.add(spec);
    }
  }
  return { files: [...files].map((f) => relative(here, f)), node: [...node].sort(), packages: [...packages].sort() };
}

/** The `node:` specifiers a bundled worker.js still imports statically. */
export function bundleNodeImports(bundle) {
  const specs = new Set();
  for (const m of bundle.matchAll(/^import\s[^;]*?from\s*"(node:[^"]+)"/gm)) specs.add(m[1]);
  for (const m of bundle.matchAll(/^import\s*"(node:[^"]+)"/gm)) specs.add(m[1]);
  return [...specs].sort();
}

/** `compatibility_flags` from wrangler.toml text (top-level, uncommented). */
export function compatFlags(toml) {
  const m = /^compatibility_flags\s*=\s*\[([^\]]*)\]/m.exec(toml);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const toml = readFileSync(join(here, 'wrangler.toml'), 'utf8');
const graph = workerGraph(join(here, 'worker.mjs'));

test('the walk is not vacuous: it reaches the shared studio access model', () => {
  assert.ok(graph.files.includes('../studio/access/scope.ts'), graph.files.join('\n'));
  assert.ok(graph.files.length > 30, `only ${graph.files.length} files reached`);
});

test('every node: builtin the Worker reaches is on the allowlist', () => {
  const extra = graph.node.filter((s) => !ALLOWED_NODE_BUILTINS.includes(s));
  assert.deepEqual(extra, [], `new node: import(s) in the Worker graph: ${extra.join(', ')}`);
});

test('a Worker that reaches node: builtins declares nodejs_compat', () => {
  if (graph.node.length === 0) return;
  assert.ok(
    compatFlags(toml).includes('nodejs_compat'),
    `the Worker imports ${graph.node.join(', ')} but wrangler.toml has no compatibility_flags = ["nodejs_compat"] — Cloudflare refuses the upload (10021)`
  );
});

test('the bundled worker.js (CLOUD_BUNDLE) keeps only allowed node: imports, under nodejs_compat', {
  skip: process.env.CLOUD_BUNDLE ? false : 'CLOUD_BUNDLE not set (CI sets it after the dry-run)',
}, () => {
  const kept = bundleNodeImports(readFileSync(process.env.CLOUD_BUNDLE, 'utf8'));
  assert.deepEqual(kept.filter((s) => !ALLOWED_NODE_BUILTINS.includes(s)), [], kept.join(', '));
  if (kept.length) assert.ok(compatFlags(toml).includes('nodejs_compat'), `bundle imports ${kept.join(', ')}`);
});

test('worker.mjs exports only handlers (default object + functions)', async () => {
  const mod = await import('./worker.mjs');
  const bad = Object.keys(mod).filter((k) => k !== 'default' && typeof mod[k] !== 'function');
  assert.deepEqual(bad, [], `non-handler named export(s) workerd refuses: ${bad.join(', ')}`);
});

test('the helpers see what they claim to see', () => {
  assert.deepEqual(
    staticImports("import type { A } from './a.ts';\n// import x from 'node:fs';\nimport {\n  b,\n} from 'node:crypto';\nimport './side.mjs';\n"),
    [
      { spec: './a.ts', typeOnly: true },
      { spec: 'node:crypto', typeOnly: false },
      { spec: './side.mjs', typeOnly: false },
    ]
  );
  assert.deepEqual(bundleNodeImports('import { createHash } from "node:crypto";\nconst x = 1;\n'), ['node:crypto']);
  assert.deepEqual(compatFlags('# compatibility_flags = ["nodejs_compat"]\n'), []);
  assert.deepEqual(compatFlags('compatibility_flags = ["nodejs_compat"]\n'), ['nodejs_compat']);
});
