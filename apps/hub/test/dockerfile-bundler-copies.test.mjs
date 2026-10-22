// gate-b-c4l (defender M2, release blocker) — the hub image's bundler stage copies `apps/hub` and,
// file by file, the studio / cloud modules the hub imports. A module added to that graph without a
// COPY is green everywhere (the file is on disk in every checkout) and fatal only when the image is
// built: `access/closure.ts` imported `skip-dirs.ts` since gate-b-c4g and the image could not
// bundle. This walks the hub's real import graph — every relative import of every `apps/hub/src`
// module that leaves `apps/hub`, transitively, type-only imports erased like the bundler erases
// them — and asserts each file is COPY'd into the bundler stage (a file, or a directory holding it).

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HUB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(HUB, '..', '..');

/** The bundler stage's COPY sources (repo-relative), up to the next FROM. */
function bundlerCopies() {
  const text = readFileSync(join(HUB, 'Dockerfile'), 'utf8').replace(/\\\n/g, ' ');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^FROM\s+\S+\s+AS\s+bundler\b/i.test(l));
  assert.ok(start >= 0, 'no bundler stage');
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^FROM\s/i.test(line)) break;
    const m = /^COPY\s+(.*)$/i.exec(line.trim());
    if (!m) continue;
    const args = m[1].split(/\s+/).filter((a) => a && !a.startsWith('--'));
    for (const src of args.slice(0, -1)) out.push(src.replace(/\/+$/, ''));
  }
  return out;
}

/** Relative value imports of a module (type-only imports and re-exports erased). */
function relativeImports(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const out = [];
  const re =
    /\b(import|export)\s+(type\s+)?([^'";]*?)\s*\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (let m = re.exec(noComments); m !== null; m = re.exec(noComments)) {
    if (m[2]) continue; // `import type … from` / `export type … from`
    out.push(m[4] ?? m[5] ?? m[6]);
  }
  return out;
}

function resolveSpec(fromAbs, spec) {
  const base = resolve(dirname(fromAbs), spec);
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function hubSources(dir = join(HUB, 'src')) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...hubSources(abs));
    else if (/\.(mjs|js|ts)$/.test(e.name)) out.push(abs);
  }
  return out;
}

// gate-b-c4m (defender L-C) — the walk resolves `.tsx` modules too, and an import it cannot resolve
// is a failure, not a silently dropped edge (a dropped edge hid every module behind it).
test('resolveSpec finds a .tsx module; an unresolvable import is reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4m-docker-'));
  try {
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'view.tsx'), 'export default 1;\n');
    writeFileSync(join(dir, 'lib', 'index.tsx'), 'export default 1;\n');
    const from = join(dir, 'entry.ts');
    assert.equal(resolveSpec(from, './lib/view'), join(dir, 'lib', 'view.tsx'));
    assert.equal(resolveSpec(from, './lib'), join(dir, 'lib', 'index.tsx'));
    writeFileSync(from, "import V from './lib/view';\nimport G from './gone';\n");
    assert.deepEqual(walkHub([from]).unresolved, [`${relative(REPO, from)} → ./gone`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The hub's transitive relative import graph from `sources`: what it saw, and what it could not resolve. */
function walkHub(sources) {
  const seen = new Set();
  const unresolved = [];
  const queue = [...sources];
  while (queue.length) {
    const abs = queue.shift();
    if (seen.has(abs)) continue;
    seen.add(abs);
    for (const spec of relativeImports(readFileSync(abs, 'utf8'))) {
      const dep = resolveSpec(abs, spec);
      if (dep === null) unresolved.push(`${relative(REPO, abs).split('\\').join('/')} → ${spec}`);
      else if (!/\/node_modules\//.test(dep)) queue.push(dep);
    }
  }
  return { seen, unresolved };
}

test('every module the hub bundle reaches outside apps/hub is COPY’d into the bundler stage', () => {
  const copies = bundlerCopies();
  const copied = (rel) => copies.some((c) => rel === c || rel.startsWith(`${c}/`));
  const { seen, unresolved } = walkHub(hubSources());
  assert.deepEqual(unresolved, [], `imports the walk cannot resolve: ${unresolved.join(', ')}`);
  const missing = [];
  for (const abs of seen) {
    const rel = relative(REPO, abs).split('\\').join('/');
    if (!rel.startsWith('apps/hub/') && !copied(rel)) missing.push(rel);
  }
  assert.ok(seen.has(join(REPO, 'apps/studio/access/closure.ts')), 'the walk reaches closure.ts');
  assert.deepEqual(
    missing.sort(),
    [],
    `not COPY'd into the hub bundler stage: ${missing.join(', ')}`
  );
});
