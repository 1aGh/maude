// helper-deps.mjs — the single source of truth for "which npm packages does each
// standalone `maude design <verb>` helper actually import". Shared by BOTH
// `stage-resources.mjs` (to STAGE those closures into the bundle) and
// `check-bundle-completeness.mjs` (to ASSERT they're staged). Data-driven from
// the helpers' real import graph — so a NEW helper that adds a new dependency is
// staged automatically AND verified, closing the "vždy dělat build i
// dependencies" gap without a hand-maintained list to forget (RCA G4/G7).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Classify each `maude design` helper by reading its `.sh`:
 *   • routed     — curls the local dev-server `/_api/<verb>` (deps ride the
 *                  compiled server's embedded closure; nothing to stage);
 *   • standalone — `exec bun run _<verb>.mjs` (needs its npm closure on disk);
 *   • other      — neither (pure jq/curl-free shell).
 */
export function classifyHelpers(binDir) {
  if (!existsSync(binDir)) return [];
  const out = [];
  for (const f of readdirSync(binDir)) {
    if (!f.endsWith('.sh') || f.startsWith('_')) continue;
    const verb = f.slice(0, -3);
    const src = readFileSync(join(binDir, f), 'utf8');
    const routed = /_api\//.test(src) && !/\bexec\s+bun\s+run\b/.test(src);
    const bunEntry = src.match(/bun\s+run\s+"?\$SCRIPT_DIR\/(_[\w-]+\.mjs)/);
    out.push({
      verb,
      sh: f,
      track: routed ? 'routed' : bunEntry ? 'standalone' : 'other',
      entry: bunEntry ? bunEntry[1] : null,
      needsBun: /command -v bun/.test(src) || /\bexec\s+bun\s+run\b/.test(src),
    });
  }
  return out;
}

// Strip `/* … */` and `// …` comments before scraping. Without this, prose that
// merely QUOTES a name after the word "from" (e.g. a doc comment reading
// `from "serif" to …`) is captured by the greedy `from` alternative below and
// staged as a phantom npm dep — which does not just add dead weight, it FAILS
// the packaging build (`missing serif (design helper)`, 2026-08-12). Not an AST
// walk (see the note on collectImports), just the cheap 90 % of it.
function stripComments(text) {
  return (
    text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      // A template literal is text a helper GENERATES (canvas-edit.ts writes a reel's
      // `import … from '@remotion/media'` into a new canvas), never an import it loads.
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
  );
}

// Match import/export…from, bare import, and static/dynamic require/import().
const SPEC_RE =
  /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveLocal(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const cands = [
    base,
    `${base}.ts`,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.mjs'),
    join(base, 'index.js'),
  ];
  return cands.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function pkgName(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

/**
 * Walk the module graph from an entry `_*.mjs`, following relative (`./`/`../`)
 * imports through the source (.ts/.mjs/.js/.tsx), and return every BARE npm
 * package specifier it (transitively, through local files) imports. Cycle-guarded.
 *
 * NOTE (ethical-hacker review, DDR-177 §Security addendum): this is a REGEX scrape
 * over raw source, not an AST walk — so an `import 'pkg'` inside a `//` comment or
 * a string literal is also collected, which would stage `pkg` into the bundle as
 * dead weight (it is never executed — a real, uncommented `import` is needed to run
 * it). Accepted below the medium severity floor: the input is first-party helper
 * source (a reviewable edit), and `check-bundle-completeness` only asserts presence.
 * Follow-up if the helper surface grows: switch to an AST/`oxc-parser` walk and
 * cross-check the derived set against a reviewed allowlist.
 */
export function collectImports(entryFile) {
  const bare = new Set();
  const seen = new Set();
  const stack = [entryFile];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of stripComments(text).matchAll(SPEC_RE)) {
      const spec = (m[1] || m[2] || m[3] || '').trim();
      // A real module specifier has no whitespace/comma — the greedy `from`
      // alternative can otherwise span statements and capture junk.
      if (!spec || /[\s,]/.test(spec) || spec.startsWith('node:') || spec.startsWith('bun:'))
        continue;
      // An interpolated specifier is code the helper GENERATES (clip-ops.ts writes
      // `from '${specifier}'` into a canvas), never a package the helper itself loads.
      if (spec.includes('${')) continue;
      // A backslash never appears in a module specifier: it is a regex literal that quotes one
      // (ds-resolver.ts's `/from\s*["']@maude\/ds["']/`), never an import.
      if (spec.includes('\\')) continue;
      // `import type … from 'x'` is erased at build time — nothing loads `x` at runtime.
      if (/^(?:import|export)\s+type\b/.test(m[0])) continue;
      // `@maude/*` is never an npm package here: `@maude/canvas-lib` is the
      // dev-server's VIRTUAL specifier (canvas-build resolves it to
      // apps/studio/canvas-lib.tsx — DDR-025), and it reaches this scrape only
      // from generated-canvas source inside template strings (e.g.
      // _import-figma.mjs boardHostCanvas). Staging it would hard-fail on a
      // package.json that can't exist.
      if (spec.startsWith('@maude/')) continue;
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const local = resolveLocal(file, spec);
        if (local) stack.push(local);
        continue;
      }
      // A bare specifier must be a valid npm name: the lazy `from` alternative can match string
      // text (sync/doc-name.ts's "…could not be read from ' +" message once read as package `+`).
      if (!/^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*(?:\/.*)?$/i.test(spec)) continue;
      bare.add(pkgName(spec));
    }
  }
  return [...bare].sort();
}

/**
 * The union of every STANDALONE helper's npm import closure (package names).
 * `binDir` = `<studio>/bin`. This is exactly what `stage-resources.mjs` must
 * stage so the `bun run` helpers resolve their imports in the packaged app.
 */
export function standaloneHelperNpmDeps(binDir) {
  const deps = new Set();
  for (const h of classifyHelpers(binDir)) {
    if (h.track !== 'standalone' || !h.entry) continue;
    const entryFile = join(binDir, h.entry);
    for (const d of collectImports(entryFile)) deps.add(d);
  }
  return [...deps].sort();
}

const SHIM_RE = /exportShimPath\(\s*['"]([^'"\s]+)['"]\s*\)/g;
const SKIP_DIRS = new Set(['node_modules', 'test', 'dist', 'client', '.git']);

/**
 * Every render shim the SERVER spawns itself — `exportShimPath('<basename>')` in
 * `apps/studio/**.ts` (the exporters, the thumbnail renderer `_thumbs-playwright.mjs`).
 * They are not `maude design` helpers, so `classifyHelpers` never sees them; a shim
 * that is not staged in `<studio>/bin` (or lacks its npm closure) fails only in the
 * packaged app — exports error, Home covers stay grey. `studioDir` = `<studio>`.
 */
export function serverRenderShims(studioDir) {
  const found = new Set();
  const walk = (dir) => {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP_DIRS.has(n)) continue;
      const abs = join(dir, n);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))
        for (const m of stripComments(readFileSync(abs, 'utf8')).matchAll(SHIM_RE)) found.add(m[1]);
    }
  };
  walk(studioDir);
  return [...found].sort();
}

/** The server's render shims that are not staged (`missing: ['file']`) or whose npm
 *  closure is not under `<studio>/node_modules` (`missing: [<pkg>…]`). Empty = complete. */
export function renderShimGaps(studioDir) {
  const gaps = [];
  for (const shim of serverRenderShims(studioDir)) {
    const entry = join(studioDir, 'bin', shim);
    if (!existsSync(entry)) {
      gaps.push({ shim, missing: ['file'] });
      continue;
    }
    const missing = collectImports(entry).filter(
      (d) => !existsSync(join(studioDir, 'node_modules', d))
    );
    if (missing.length) gaps.push({ shim, missing });
  }
  return gaps;
}
