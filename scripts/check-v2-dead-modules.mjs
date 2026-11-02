#!/usr/bin/env node
// V2-8.0 dead-module check (knip-style, no dependency).
//
// Walks the import graph from the real entry points of apps/studio and lists every
// non-test source module (.ts .tsx .js .jsx .mjs .css) that no entry reaches.
//
//   node scripts/check-v2-dead-modules.mjs [--root <repo>] [--json] [--list-reached]
//
// Exit 1 when a dead module is not on the allow-list (scripts/v2-dead-modules.allow.json,
// `{ "<repo-relative path>": "<one-line reason>" }`) or when an allow-list entry has no reason /
// is no longer dead (a stale entry hides nothing and must go).
//
// What counts as a reference (deliberately liberal — a false "alive" is cheap, a false "dead"
// deletes a feature):
//   - static / dynamic `import`, `export … from`, `require`, `import.meta.resolve`, CSS `@import`
//   - any quoted string that resolves to a module file (relative to the importing file, to the
//     studio root, or to the repo root) — covers `new URL('./x.ts', import.meta.url)`, Bun.file(…),
//     build entry lists, `<script src>` in html, registry tables keyed by path
//   - the virtual specifier `@maude/canvas-lib` (tsconfig paths)
// Test files (`*.test.*`, `test/`, `__tests__/`, `fixtures/`, `e2e/`) are neither sources nor
// entries: a module only a test reaches is dead.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_EXT = /\.(?:tsx?|jsx?|mjs|css)$/;
const SCAN_EXT = /\.(?:tsx?|jsx?|mjs|cjs|css|html|sh|json|yml|yaml|toml|rs)$/;
const TRY_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css'];
const STUDIO = 'apps/studio';

/** Entry points inside apps/studio that are not imported by anything (built / spawned / served). */
export const STUDIO_ENTRIES = [
  'server.ts', // the dev server + the compiled sidecar
  'home/main.ts', // `maude-server --home` (build.ts compile entry)
  'client/app.jsx', // the client bundle (build.ts buildClient)
  'canvas-comment-mount.tsx', // dist/comment-mount.js (build.ts buildCommentMount)
  'canvas-shell.tsx', // the canvas shell module (canvas-build.ts)
  'canvas-lib.tsx', // @maude/canvas-lib, resolved by the Bun.build plugin
  'canvas-build-worker.ts', // the isolated build worker
  'build.ts', // the release build
  'runtime-bundle.ts', // pre-built runtime bundles
  'client/embed.js', // the embed bundle
];

function isTestPath(rel) {
  return (
    /(?:^|\/)(?:test|tests|__tests__|fixtures|e2e)\//.test(rel) ||
    /\.(?:test|spec)\.[a-z]+$/.test(rel) ||
    /(?:^|\/)test-[^/]*\.[a-z]+$/.test(rel)
  );
}

function listTracked(root) {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return null;
  }
}

function listWalk(root) {
  // fallback for a non-git temp tree (the unit test)
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(r);
      else out.push(r);
    }
  }
  return out;
}

const SPEC_RES = [
  /\bfrom\s*(['"])([^'"\n]+)\1/g, // import x from / export … from
  /\bimport\s*(['"])([^'"\n]+)\1/g, // import 'x'
  /\bimport\s*\(\s*(['"`])([^'"`\n$]+)\1/g, // import('x')
  /\brequire\s*\(\s*(['"`])([^'"`\n$]+)\1/g,
  /@import\s*(?:url\()?\s*(['"])([^'"\n]+)\1/g, // css
  /@import\s+url\(\s*([^'")\s]+)\s*\)/g, // css url() unquoted (group 1 used)
];
const STRING_RE = /(['"`])((?:\\.|(?!\1)[^\\\n])+?\.(?:tsx?|jsx?|mjs|css))\1/g;

// path.join(DEV_SERVER_ROOT, 'ds', 'board', 'index.tsx') — segments of one path
const SEGMENTS_RE = /((?:(['"])[\w@.-]+\2\s*,\s*)+(['"])[\w@.-]+\.(?:tsx?|jsx?|mjs|css)\3)/g;

/** Drop block comments and whole-line `//` comments: a path named in prose is not a reference. */
function stripComments(text, rel) {
  if (!/\.(?:tsx?|jsx?|mjs|cjs|css)$/.test(rel)) return text;
  return text.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every specifier-ish string in a source text. */
function specifiersOf(rawText, rel) {
  const text = stripComments(rawText, rel);
  const out = new Set();
  for (const re of SPEC_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) out.add(m[2] ?? m[1]);
  }
  STRING_RE.lastIndex = 0;
  for (let m = STRING_RE.exec(text); m; m = STRING_RE.exec(text)) out.add(m[2]);
  SEGMENTS_RE.lastIndex = 0;
  for (let m = SEGMENTS_RE.exec(text); m; m = SEGMENTS_RE.exec(text)) {
    out.add(
      m[1]
        .split(',')
        .map((p) => p.trim().replace(/^['"]|['"]$/g, ''))
        .join('/')
    );
  }
  // shell: `bun run "$HERE/../handoff.ts"` — unquoted tokens with a $VAR/ prefix
  if (rel.endsWith('.sh')) {
    for (const m of text.matchAll(/[\w@./${}-]+\.(?:tsx?|jsx?|mjs)\b/g)) {
      const t = m[0].replace(/^(?:\$\{?\w+\}?\/)+/, '');
      out.add(t);
      out.add(`../${t}`);
    }
  }
  // html: src="…" href="…" without extension quirks are covered by STRING_RE; add bare attrs
  if (rel.endsWith('.html')) {
    for (const m of text.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)/g)) out.add(m[1]);
  }
  return out;
}

export function findDeadModules({ root, entries = STUDIO_ENTRIES, allow = {} }) {
  const tracked = listTracked(root) ?? listWalk(root);
  const trackedSet = new Set(tracked);
  const studioPrefix = `${STUDIO}/`;
  const modules = tracked.filter(
    (f) =>
      f.startsWith(studioPrefix) &&
      MODULE_EXT.test(f) &&
      !f.endsWith('.d.ts') &&
      !f.startsWith(`${STUDIO}/dist/`) &&
      !f.includes('/node_modules/') &&
      !isTestPath(f.slice(studioPrefix.length)) &&
      !/\.gen\.[a-z]+$/.test(f)
  );

  function resolveSpec(spec, fromRel) {
    if (!spec || /^(?:https?:|data:|node:|bun:|#)/.test(spec)) return null;
    if (spec === '@maude/canvas-lib') return `${STUDIO}/canvas-lib.tsx`;
    const bases = [];
    // served URLs: `/_client/<file>` is apps/studio/client/<file> (static lane)
    // (`styles.css` and `client.bundle.js` are served from dist/, built by build.ts — static-lane.ts)
    if (spec.startsWith('/_client/')) {
      if (/^\/_client\/(?:styles\.css|client\.bundle\.js)$/.test(spec)) return null;
      bases.push(`${STUDIO}/client/${spec.slice(9)}`);
    } else if (spec.startsWith('.')) bases.push(normalize(join(dirname(fromRel), spec)));
    else if (spec.startsWith('/')) bases.push(spec.slice(1), `${STUDIO}${spec}`);
    else {
      // bare-ish path strings: relative to the file, the studio root, the repo root
      bases.push(normalize(join(dirname(fromRel), spec)), normalize(join(STUDIO, spec)), spec);
    }
    for (const b of bases) {
      if (b.startsWith('..')) continue;
      const cands = [b];
      if (/\.(?:js|mjs)$/.test(b)) {
        const stem = b.replace(/\.(?:js|mjs)$/, '');
        cands.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.jsx`);
      }
      for (const e of TRY_EXT) cands.push(b + e);
      for (const e of TRY_EXT) cands.push(`${b}/index${e}`);
      for (const c of cands) if (trackedSet.has(c) && MODULE_EXT.test(c)) return c;
    }
    return null;
  }

  const read = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch {
      return '';
    }
  };

  // Reachability. Sources scanned: the studio's own non-test files (any scannable ext, so
  // html / sh / json registries count) — but a node is only "reached" via a module edge, and
  // only modules propagate; non-module sources (html, sh, json) are scanned once as roots when
  // they themselves are shipped (client/index.html, bin/*, package.json `files`).
  const reached = new Set();
  const queue = [];
  const reach = (rel, via) => {
    if (!rel || reached.has(rel)) return;
    reached.add(rel);
    queue.push(rel);
    reasons.set(rel, via);
  };
  const reasons = new Map();

  for (const e of entries) {
    const rel = `${STUDIO}/${e}`;
    if (trackedSet.has(rel)) reach(rel, 'entry');
  }
  // bin helpers + non-module shipped files under the studio are entries
  for (const f of tracked) {
    if (!f.startsWith(studioPrefix)) continue;
    const sub = f.slice(studioPrefix.length);
    if (isTestPath(sub)) continue;
    if (sub.startsWith('bin/') && MODULE_EXT.test(f)) reach(f, 'bin helper');
    if (/\.(?:html|sh)$/.test(f)) reach(f, 'shipped non-module');
  }
  // anything OUTSIDE the studio that points into it (cli/, scripts/, apps/desktop, plugins/, CI)
  const outside = tracked.filter(
    (f) =>
      !f.startsWith(studioPrefix) &&
      SCAN_EXT.test(f) &&
      !isTestPath(f) &&
      !f.startsWith('.ai/') &&
      !f.startsWith('.design/') && // the repo's own design root, not a consumer
      !f.startsWith('docs/') &&
      // bookkeeping / audit / dev-harness tooling lists files, it does not run them
      !f.startsWith('scripts/v2-') &&
      !f.startsWith('scripts/check-v2-') &&
      !f.startsWith('scripts/lint-ratchet/') &&
      !f.startsWith('scripts/dev/') &&
      !(f.endsWith('.json') && !f.endsWith('package.json')) &&
      !f.startsWith('site/content/') &&
      !f.includes('/node_modules/') &&
      !f.includes('/target/') &&
      !f.endsWith('.lock')
  );
  for (const f of outside) {
    const text = read(f);
    if (!text || text.length > 3_000_000) continue;
    if (!text.includes('studio') && !text.includes('canvas-lib')) continue;
    for (const spec of specifiersOf(text, f)) {
      const r = resolveSpec(spec, f);
      if (r?.startsWith(studioPrefix) && modules.includes(r)) reach(r, `referenced by ${f}`);
    }
    for (const m of text.matchAll(/apps\/studio\/([\w@./-]+\.(?:tsx?|jsx?|mjs|css))/g)) {
      const r = `${STUDIO}/${m[1]}`;
      if (modules.includes(r)) reach(r, `referenced by ${f}`);
    }
  }

  const textCache = new Map();
  while (queue.length) {
    const cur = queue.pop();
    if (!textCache.has(cur)) textCache.set(cur, read(cur));
    const text = textCache.get(cur);
    if (!text) continue;
    for (const spec of specifiersOf(text, cur)) {
      const r = resolveSpec(spec, cur);
      if (!r || !r.startsWith(studioPrefix)) continue;
      if (isTestPath(r.slice(studioPrefix.length))) continue;
      reach(r, `imported by ${cur}`);
    }
  }

  const dead = modules.filter((m) => !reached.has(m)).sort();
  const allowed = dead.filter((m) => Object.hasOwn(allow, m));
  const unlisted = dead.filter((m) => !Object.hasOwn(allow, m));
  const stale = Object.keys(allow).filter((m) => !dead.includes(m));
  const noReason = Object.entries(allow)
    .filter(([, why]) => typeof why !== 'string' || !why.trim())
    .map(([m]) => m);
  return { modules, reached, reasons, dead, allowed, unlisted, stale, noReason };
}

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(HERE, '..');
  const allowPath = join(root, 'scripts/v2-dead-modules.allow.json');
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
  const r = findDeadModules({ root, allow });
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify({ dead: r.dead, allowed: r.allowed, unlisted: r.unlisted }, null, 2)
    );
  }
  if (argv.includes('--list-reached')) {
    for (const m of [...r.reached].sort()) console.log(`${m}\t${r.reasons.get(m)}`);
  }
  const problems = [];
  for (const m of r.unlisted) problems.push(`dead module: ${m}`);
  for (const m of r.stale) problems.push(`allow-list entry is not dead any more (remove it): ${m}`);
  for (const m of r.noReason) problems.push(`allow-list entry without a reason: ${m}`);
  if (problems.length) {
    console.error(`dead-modules: ${r.unlisted.length} dead module(s) of ${r.modules.length}`);
    for (const p of problems) console.error(`  ${relative(root, join(root, p))}`);
    process.exit(1);
  }
  console.log(
    `dead-modules: 0 dead of ${r.modules.length} (${r.allowed.length} allow-listed with a reason)`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
