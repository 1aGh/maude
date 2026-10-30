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
  // One left-to-right pass: a string literal is kept whole, and a comment is dropped from wherever it
  // STARTS — so a `/*` inside a `//` comment (or a `//` inside a string) never opens anything.
  const noComments = source.replace(
    /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m, str) => (str ? m : ' ')
  );
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

// V2-8.18: a `//` comment that mentions a glob (`access/*`) opened a "block comment" in the old stripper,
// which then ate every import up to the next `*/` — door-fingerprint.ts's imports were invisible to the walk
// and the real `docker build` of the hub image failed on two un-COPY'd modules.
test('a line comment that mentions a glob does not hide the imports after it', () => {
  const src = [
    '// reaches `node:*` plus the light `access/*` modules',
    "import { a } from '../access/request.ts';",
    "import { b } from '../sync/file-membership.ts';",
    '/** a doc comment closes here */',
    "const url = 'http://x/*y';",
    "import { c } from './after.ts';",
  ].join('\n');
  assert.deepEqual(relativeImports(src), [
    '../access/request.ts',
    '../sync/file-membership.ts',
    './after.ts',
  ]);
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

/** A stage's COPY sources from the build context (repo-relative), up to the next FROM. */
function stageCopies(stage) {
  const text = readFileSync(join(HUB, 'Dockerfile'), 'utf8').replace(/\\\n/g, ' ');
  const lines = text.split('\n');
  const start = lines.findIndex((l) =>
    new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${stage}\\b`, 'i').test(l)
  );
  assert.ok(start >= 0, `no ${stage} stage`);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^FROM\s/i.test(line)) break;
    const m = /^COPY\s+(.*)$/i.exec(line.trim());
    if (!m || /--from=/.test(m[1])) continue;
    const args = m[1].split(/\s+/).filter((a) => a && !a.startsWith('--'));
    for (const src of args.slice(0, -1)) out.push(src.replace(/\/+$/, ''));
  }
  return out;
}

function studioSources(dir = join(REPO, 'apps/studio')) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test', 'e2e', '.design'].includes(e.name)) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...studioSources(abs));
    else if (/\.(mjs|js|ts|tsx)$/.test(e.name) && !/\.test\.(mjs|js|ts|tsx)$/.test(e.name))
      out.push(abs);
  }
  return out;
}

// V2-8.18: the studio-build stage compiles the cloud `maude-server` from `COPY apps/studio ./` plus whatever
// the studio reaches outside apps/studio. The studio came to import hub modules (project-transactions/*,
// votes) and cli/lib guards; nothing staged them, and the real `docker build` of the hub image failed.
test('every module the cloud studio build reaches outside apps/studio is COPY’d into the studio-build stage', () => {
  const copies = stageCopies('studio-build');
  const copied = (rel) =>
    rel.startsWith('apps/studio/') || copies.some((c) => rel === c || rel.startsWith(`${c}/`));
  const { seen } = walkHub(studioSources());
  const missing = [];
  for (const abs of seen) {
    const rel = relative(REPO, abs).split('\\').join('/');
    if (!copied(rel)) missing.push(rel);
  }
  assert.deepEqual(
    missing.sort(),
    [],
    `not COPY'd into the studio-build stage: ${missing.join(', ')}`
  );
});
