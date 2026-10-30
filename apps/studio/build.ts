#!/usr/bin/env bun
// Build orchestrator for the dev-server.
//
// Three steps (run on demand):
//   (a) Client JSX bundle:  client/app.jsx + React 19  ->  dist/client.bundle.js (IIFE, tree-shaken).
//   (b) CSS bundle:         client/styles/_index.css (Lightning CSS, @layer, OKLCH fallback).
//   (c) Server binary:      server.ts  ->  dist/maude-<platform>  (bun build --compile, per-platform).
//
// Modes:
//   bun run build.ts                       -> dev build for current platform (no compile, no minify)
//   bun run build.ts --release             -> release build for all platforms in the matrix
//   bun run build.ts --release --target=bun-darwin-arm64
//   bun run build.ts --watch               -> watch client + CSS; broadcast over HMR socket
//   bun run build.ts --dry-run             -> exit 0 without writing files (smoke for CI / Task 2 validation)
//
// Per DDR-009 (Bun runtime authoritative) + DDR-012 (React 19 unified) + DDR-014 (Lightning CSS).

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browserslistToTargets, bundle as lcssBundle } from 'lightningcss';

import { cloudStubPlugin } from './cloud-build.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

const ARGS = new Set(process.argv.slice(2));
const FLAG_TARGET = process.argv.find((a) => a.startsWith('--target='))?.slice('--target='.length);
const MODE: 'dev' | 'release' | 'dry' = ARGS.has('--dry-run')
  ? 'dry'
  : ARGS.has('--release')
    ? 'release'
    : 'dev';

// DEV-ONLY override, so a test can build somewhere disposable.
//
// `test/bundle-smoke.test.ts` shells out to this script to prove the bundle
// still parses — and, until this existed, wrote its unminified DEV output
// straight over the COMMITTED release artifacts (14 MB where 2 MB ships). What
// is committed is what ships, so a suite run silently staged a broken release.
// CLAUDE.md recorded this as "observed, root cause unconfirmed"; it is this.
//
// REFUSED OUTSIDE DEV, and that guard is the whole point of the variable being
// safe. DIST is the write target for every artifact — client bundle, styles,
// dist/runtime/*, and the compiled server binary. One environment variable
// reaching a release runner would send all of them to a scratch directory, exit
// 0 with normal-looking size lines, and leave packaging to ship the COMMITTED
// artifacts instead. `check-runtime-bundles.sh` would validate those stale
// files and pass; `check-client-boots.mjs` would boot them and pass. Every gate
// green, nothing built actually shipped — a silent downgrade primitive with no
// diff and no red CI. This repo's doctrine is "what is committed is what ships"
// AND "verify the built artifact"; an unguarded override severs the two.
if (process.env.MAUDE_DIST_DIR && MODE !== 'dev') {
  console.error(
    `[build] MAUDE_DIST_DIR is a dev/test-only override and must not be set for a --${MODE} build.\n` +
      `        Refusing to build: a release that writes elsewhere ships the previously committed\n` +
      `        artifacts while every packaging gate stays green.`
  );
  process.exit(2);
}
const DIST = process.env.MAUDE_DIST_DIR || join(ROOT, 'dist');
const WATCH = ARGS.has('--watch');
/** Cloud Phase 27 D1 — build the CELL's variant (secret-bearing surfaces
 *  removed from the binary, not merely un-routed). `--cloud` with `--release`. */
const CLOUD = ARGS.has('--cloud');

const PLATFORM_MATRIX = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-linux-x64-musl',
  'bun-linux-arm64-musl',
  'bun-windows-x64',
] as const;

type PlatformTarget = (typeof PLATFORM_MATRIX)[number];

function platformSlug(target: PlatformTarget): string {
  // bun calls Windows "windows"; npm and process.platform call it "win32".
  // Sub-package directories + the build-binaries.yml matrix slug use win32-x64.
  const s = target.replace(/^bun-/, '');
  return s === 'windows-x64' ? 'win32-x64' : s;
}

function currentTarget(): PlatformTarget {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') return a === 'arm64' ? 'bun-darwin-arm64' : 'bun-darwin-x64';
  if (p === 'linux') return a === 'arm64' ? 'bun-linux-arm64' : 'bun-linux-x64';
  if (p === 'win32') return 'bun-windows-x64';
  throw new Error(`Unsupported host platform: ${p}-${a}`);
}

function ensureDist() {
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
}

async function readPluginVersion(): Promise<{ version: string }> {
  // apps/studio/ → ../../plugins/design/.claude-plugin/plugin.json (DDR-095)
  const manifest = join(ROOT, '..', '..', 'plugins', 'design', '.claude-plugin', 'plugin.json');
  try {
    const parsed = JSON.parse(await Bun.file(manifest).text()) as { version?: unknown };
    if (typeof parsed.version === 'string') return { version: parsed.version };
  } catch {
    /* fall through to dev default */
  }
  return { version: 'dev' };
}

// ---------- (a) Client JSX bundle ----------

async function buildClient(): Promise<{ outBytes: number; outPath: string }> {
  ensureDist();
  const outPath = join(DIST, 'client.bundle.js');
  // Wordmark sub-line version. Read from plugins/design/.claude-plugin/plugin.json —
  // that file ships in both npm installs AND marketplace-cache clones (it's the
  // plugin manifest, always present). The old `../../../package.json` hop
  // resolved to the repo root in dev but ENOENT'd in marketplace caches where
  // the maude bundle isn't installed as a package. DDR-044, Phase 19.
  const pkg = await readPluginVersion();
  const result = await Bun.build({
    entrypoints: [join(ROOT, 'client/app.jsx')],
    outdir: DIST,
    target: 'browser',
    // ESM — not IIFE. Bun.build's IIFE + full minify + React 19 hits a TDZ
    // bug (`Cannot access 'VZ' before initialization`) because top-level
    // `const`s get rotated past their declaration. ESM has stable hoisting
    // semantics the minifier respects. Cost: `<script type="module">` in
    // index.html (already set).
    format: 'esm',
    naming: 'client.bundle.js',
    minify: MODE === 'release',
    sourcemap: MODE === 'dev' ? 'inline' : 'none',
    define: {
      'process.env.NODE_ENV': JSON.stringify(MODE === 'release' ? 'production' : 'development'),
      __MDCC_VERSION__: JSON.stringify(pkg.version),
    },
  });
  if (!result.success) {
    const messages = result.logs.map((l) => l.message ?? String(l)).join('\n');
    throw new Error(`Client build failed:\n${messages}`);
  }
  const out = Bun.file(outPath);
  return { outBytes: out.size, outPath };
}

// ---------- (a.5) Comment mount layer (shell-owned comments) ----------
//
// canvas-comment-mount.tsx → dist/comment-mount.js. Loaded by _shell.html via
// a `<script type="module">`; its `mountCanvas(...)` wraps any canvas default
// export in the lite comment provider tree. React + the other canvas-runtime
// packages are EXTERNAL (bare specifiers resolved by _shell.html's importmap)
// so this bundle shares the single React/yjs singletons with the canvas
// module — inlining a second React would break hooks ("invalid hook call").

const COMMENT_MOUNT_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'yjs',
  'y-protocols/sync',
  'y-protocols/awareness',
  'lib0/decoding',
  'lib0/encoding',
];

async function buildCommentMount(): Promise<{ outBytes: number; outPath: string }> {
  ensureDist();
  const outPath = join(DIST, 'comment-mount.js');
  const result = await Bun.build({
    entrypoints: [join(ROOT, 'canvas-comment-mount.tsx')],
    outdir: DIST,
    target: 'browser',
    format: 'esm',
    naming: 'comment-mount.js',
    external: COMMENT_MOUNT_EXTERNALS,
    minify: MODE === 'release',
    sourcemap: MODE === 'dev' ? 'inline' : 'none',
    define: {
      // ALWAYS production React — like canvas-build.ts. React is external and
      // resolves through the importmap to the dev-server's PRODUCTION runtime
      // bundles, where `react/jsx-dev-runtime`'s `jsxDEV` is a no-op (undefined
      // at call time). Emitting dev jsx (`jsxDEV`) against a production runtime
      // throws "jsxDEV is not a function". Both halves must agree on the JSX
      // flavour — production jsx (`react/jsx-runtime`) is the contract.
      'process.env.NODE_ENV': '"production"',
    },
  });
  if (!result.success) {
    const messages = result.logs.map((l) => l.message ?? String(l)).join('\n');
    throw new Error(`Comment-mount build failed:\n${messages}`);
  }
  const out = Bun.file(outPath);
  return { outBytes: out.size, outPath };
}

// ---------- (b) CSS bundle (Lightning CSS) ----------

async function buildCss(): Promise<{ outBytes: number; outPath: string }> {
  ensureDist();
  const inputPath = join(ROOT, 'client/styles/_index.css');
  const outPath = join(DIST, 'styles.css');
  const { code } = lcssBundle({
    filename: inputPath,
    minify: MODE === 'release',
    sourceMap: false,
    targets: browserslistToTargets([
      'Chrome >= 110',
      'Safari >= 16',
      'Firefox >= 110',
      'Edge >= 110',
    ]),
    drafts: { customMedia: true },
  });
  await Bun.write(outPath, code);
  return { outBytes: code.byteLength, outPath };
}

// ---------- (b.5) Pre-built runtime bundles (Phase 19.1 / v0.18.1) ----------
//
// /_canvas-runtime/<slug>.js used to lazy-build on first request via Bun.build.
// That required a real disk node_modules/react reachable by walking up from
// the dev-server dir — false in compiled binaries (paths are virtual) AND
// false in npm installs (npm doesn't install nested workspace deps).
// Pre-building all 6 sub-bundles at release time + shipping in dist/runtime/
// eliminates the runtime dependency on disk node_modules entirely.

// Dev builds skip the runtime-bundle regen whenever every bundle is already
// on disk: the committed dist/runtime/*.js are authoritative for releases
// (CI builds with MAUDE_SKIP_RUNTIME_BUILD=1), and a dev-mode regen writes
// UNMINIFIED output that dirties the tree at ~2× the shipped size. Runtime
// bundles depend only on dependency versions, never on client/server source,
// so after a dep bump regen deliberately:
//   MAUDE_FORCE_RUNTIME_BUILD=1 bun run build.ts --release
async function runtimeBundlesComplete(): Promise<boolean> {
  const { RUNTIME_PACKAGES, slugFor } = await import('./runtime-bundle.ts');
  const outDir = join(DIST, 'runtime');
  return RUNTIME_PACKAGES.every((pkg) => existsSync(join(outDir, `${slugFor(pkg)}.js`)));
}

async function buildRuntimeBundles(): Promise<{ outDir: string; count: number; bytes: number }> {
  // Defer import so build.ts can run in --dry-run without pulling react.
  const { RUNTIME_PACKAGES, getRuntimeBundle, slugFor } = await import('./runtime-bundle.ts');
  const outDir = join(DIST, 'runtime');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  let bytes = 0;
  for (const pkg of RUNTIME_PACKAGES) {
    const slug = slugFor(pkg);
    // skipPrebuilt: don't reuse a previous build's output. minify in release.
    const bundle = await getRuntimeBundle(pkg, {
      skipPrebuilt: true,
      minify: MODE === 'release',
    });
    const outPath = join(outDir, `${slug}.js`);
    await Bun.write(outPath, bundle.js);
    bytes += bundle.js.length;
  }
  return { outDir, count: RUNTIME_PACKAGES.length, bytes };
}

// ---------- (c) Server binary (bun build --compile, per-platform) ----------

// Per-target oxc-parser binding embed. Bun 1.3.4+ regressed `--compile` NAPI
// native-binding embedding (see DDR-042-oxc-parser-bun-compile-workaround.md).
// `with { type: 'file' }` requires a literal string path, so we generate one
// thin entry file per --target whose only purpose is to (1) embed the matching
// platform binding as an asset, (2) set NAPI_RS_NATIVE_LIBRARY_PATH from the
// runtime virtual path, then (3) hand off to the real server.ts. ESM
// evaluation order guarantees the env var is set before any downstream module
// touches oxc-parser.

// oxc-parser's NAPI-RS binding packages use a richer slug than our build
// target slug — Linux needs the libc kind suffix, Windows needs the toolchain
// suffix. Mirrored from oxc-parser/src-js/bindings.js loader cases.
function oxcBindingSlug(slug: string): string {
  if (slug === 'linux-x64') return 'linux-x64-gnu';
  if (slug === 'linux-arm64') return 'linux-arm64-gnu';
  if (slug === 'win32-x64') return 'win32-x64-msvc';
  // darwin-arm64 / darwin-x64 / linux-x64-musl / linux-arm64-musl already match.
  return slug;
}

// npm/bun's installer respects each package's `os`/`cpu` fields and skips
// platform sub-packages whose filter doesn't match the host (the bindings
// declare e.g. `"cpu": ["x64"]`). For cross-compile targets — most notably
// darwin-x64 built on a darwin-arm64 CI runner — this means the matching
// `@oxc-parser/binding-<oxcSlug>` is NOT in node_modules even though it's
// listed as a direct devDependency. Fetch + extract the tarball manually so
// `with { type: 'file' }` resolution succeeds during `bun build --compile`.
async function ensureBindingForTarget(oxcSlug: string): Promise<void> {
  const bindingDir = join(ROOT, 'node_modules', '@oxc-parser', `binding-${oxcSlug}`);
  const bindingFile = join(bindingDir, `parser.${oxcSlug}.node`);
  if (existsSync(bindingFile)) return; // host install already placed it

  // Read the installed oxc-parser version so the tarball URL stays in sync.
  // Walk up from build.ts to find the workspace-visible oxc-parser package.json
  // (pnpm hoists it under node_modules/.pnpm, then symlinks at workspace level).
  let oxcVersion = '0.131.0';
  const candidates = [
    join(ROOT, 'node_modules', 'oxc-parser', 'package.json'),
    // apps/studio → ../../ = repo root → node_modules (DDR-095: was ../../../ at
    // the old plugins/design/dev-server depth).
    join(ROOT, '..', '..', 'node_modules', 'oxc-parser', 'package.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      oxcVersion = JSON.parse(readFileSync(c, 'utf8')).version;
      break;
    }
  }

  console.log(`[build] cross-compile: fetching @oxc-parser/binding-${oxcSlug}@${oxcVersion}`);
  const tarballUrl = `https://registry.npmjs.org/@oxc-parser/binding-${oxcSlug}/-/binding-${oxcSlug}-${oxcVersion}.tgz`;
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`failed to fetch ${tarballUrl}: HTTP ${response.status}`);
  }
  const tmpTgz = join(ROOT, `.binding-${oxcSlug}.tgz`);
  await Bun.write(tmpTgz, await response.arrayBuffer());
  mkdirSync(bindingDir, { recursive: true });
  // npm pack output: `package/parser.<oxcSlug>.node` + `package/package.json`.
  // --strip-components=1 drops the leading `package/` so files land in bindingDir.
  const tarProc = Bun.spawn(['tar', 'xf', tmpTgz, '-C', bindingDir, '--strip-components=1'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const tarCode = await tarProc.exited;
  if (tarCode !== 0)
    throw new Error(`tar extraction failed for binding-${oxcSlug} (exit ${tarCode})`);
  unlinkSync(tmpTgz);
}

export function writeCompileEntry(target: PlatformTarget): string {
  const slug = platformSlug(target);
  const oxcSlug = oxcBindingSlug(slug);
  const entryDir = join(DIST, '.compile-entries');
  mkdirSync(entryDir, { recursive: true });

  // ESM hoists `import` statements above top-level code, so the env-var
  // assignment MUST live in a separate leaf module that's imported BEFORE
  // server.ts — otherwise server.ts (and transitively oxc-parser) evaluates
  // first and reads NAPI_RS_NATIVE_LIBRARY_PATH before we set it.
  const initPath = join(entryDir, `init-oxc-${slug}.ts`);
  const entryPath = join(entryDir, `server-${slug}.ts`);
  const bindingSpec = `@oxc-parser/binding-${oxcSlug}/parser.${oxcSlug}.node`;
  const initContent = `// AUTO-GENERATED by build.ts — do not edit by hand.
// Per-target oxc-parser binding embed (Bun 1.3.4+ --compile NAPI regression
// workaround — see .ai/archive/decisions/DDR-042-oxc-parser-bun-compile-workaround.md).
// Side-effect module: must be imported BEFORE any oxc-parser usage.
import bindingPath from ${JSON.stringify(bindingSpec)} with { type: 'file' };
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = bindingPath;
// DDR-177 — a compiled binary must be self-contained: every runtime-spawned
// child (the canvas-build worker) resolves its JS runtime via
// resolveBunPath() = MAUDE_BUN_PATH || 'bun'. The desktop app launches this
// binary with a GUI PATH that has no 'bun', and NOTHING set MAUDE_BUN_PATH —
// so the asset sweep died with "Executable not found in $PATH" on machines
// without a user-installed bun. Default it to THIS binary: workerEnv() adds
// BUN_BE_BUN=1 when MAUDE_BUN_PATH === process.execPath, so children re-enter
// the sidecar as a plain JS runtime. An explicit launcher-set value (the
// cell's studio-child.mjs) still wins.
process.env.MAUDE_BUN_PATH ||= process.execPath;
`;
  writeFileSync(initPath, initContent);

  // Forward slashes for the import specifier even on Windows hosts — ESM uses
  // POSIX-style paths, not the host's filesystem separator.
  const realServerRel = relative(entryDir, join(ROOT, 'server.ts')).split('\\').join('/');
  // V2-3.3: `--home` must not load server.ts at all — ES modules evaluate every static import
  // first, and the project graph (http.ts alone ≈ 70 MB) puts the Home server over its 120 MB
  // RSS budget (decision maude/v2-3.3-home-entry-split). server.ts keeps its own --home branch
  // for runs from source.
  const homeRel = relative(entryDir, join(ROOT, 'home/main.ts')).split('\\').join('/');
  const entryContent = `// AUTO-GENERATED by build.ts — do not edit by hand.
// Per-target compile entry — see DDR-042-oxc-parser-bun-compile-workaround.md.
import './init-oxc-${slug}.ts';
// The variable names a /$bunfs path that exists only inside this binary, and every child inherits
// process.env (the ACP agent, the AI's Bash, a \`maude design\` helper's bun — whose oxc-parser then tries
// ONLY that path). Load oxc-parser now, while it names the embedded binding, then take it away.
await import('oxc-parser');
delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
if (process.argv.includes('--home')) (await import(${JSON.stringify(homeRel)})).runHome();
else await import(${JSON.stringify(realServerRel)});
`;
  writeFileSync(entryPath, entryContent);
  return entryPath;
}

async function buildServerBinary(
  target: PlatformTarget,
  /**
   * Cloud Phase 27 D1 — the variant a CELL runs, with the secret-bearing
   * surfaces removed from the binary rather than merely un-routed. Named
   * separately (`maude-cloud-<slug>`) so a desktop release can never pick one
   * up by accident, and so both can be built from one checkout.
   */
  { cloud = false }: { cloud?: boolean } = {}
): Promise<{ outPath: string }> {
  ensureDist();
  const slug = platformSlug(target);
  const ext = slug.startsWith('win32') ? '.exe' : '';
  const outPath = join(DIST, `maude-${cloud ? 'cloud-' : ''}${slug}${ext}`);
  const realEntry = join(ROOT, 'server.ts');
  if (!existsSync(realEntry)) {
    // Legacy fallback — pre-DDR-009 .mjs path. Doesn't use oxc-parser, so the
    // 1.3.4+ regression doesn't apply; entry stub generator is skipped.
    const legacy = join(ROOT, 'server.mjs');
    if (!existsSync(legacy)) throw new Error(`Neither server.ts nor server.mjs exists in ${ROOT}`);
    const proc = Bun.spawn(
      [
        'bun',
        'build',
        '--compile',
        `--target=${target}`,
        '--minify',
        '--sourcemap',
        `--outfile=${outPath}`,
        legacy,
      ],
      { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' }
    );
    const code = await proc.exited;
    if (code !== 0)
      throw new Error(`bun build --compile (legacy) failed for ${target} (exit ${code})`);
    return { outPath };
  }
  // Make sure the target's NAPI binding is on disk even if bun/npm's os/cpu
  // filter skipped it (cross-compile case — see ensureBindingForTarget docs).
  await ensureBindingForTarget(oxcBindingSlug(slug));
  const entry = writeCompileEntry(target);

  // The CLOUD variant goes through the Bun.build API rather than the CLI,
  // because that is the only path that takes a plugin — and a plugin is what
  // makes D1 elimination rather than un-routing. `--define` + dead-code
  // elimination was tried first and does not do it: Bun inlines the
  // dynamically-imported module and keeps the branch, so the bytes stay.
  if (cloud) {
    const result = await Bun.build({
      entrypoints: [entry],
      target: 'bun',
      minify: true,
      plugins: [cloudStubPlugin(ROOT)],
      compile: { target, outfile: outPath },
    } as Parameters<typeof Bun.build>[0]);
    if (!result.success) {
      throw new Error(`cloud compile failed for ${target}:\n${result.logs.map(String).join('\n')}`);
    }
    return { outPath };
  }

  const proc = Bun.spawn(
    [
      'bun',
      'build',
      '--compile',
      `--target=${target}`,
      '--minify',
      '--sourcemap',
      '--smol',
      `--outfile=${outPath}`,
      entry,
    ],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' }
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`bun build --compile failed for ${target} (exit ${code})`);
  return { outPath };
}

// ---------- Watch mode ----------

async function watch() {
  await buildClient();
  await buildCommentMount();
  await buildCss();
  console.log('[build:watch] initial build complete; watching client/ + server source...');

  // Bun fs.watch is recursive on darwin/linux/win32.
  const fs = await import('node:fs');
  const seen = new Map<string, number>();
  const debounce = 50;

  const trigger = async (path: string) => {
    const now = Date.now();
    const last = seen.get(path) ?? 0;
    if (now - last < debounce) return;
    seen.set(path, now);
    try {
      if (path.endsWith('.css')) {
        const r = await buildCss();
        console.log(`[build:watch] CSS rebuilt (${r.outBytes} B)`);
        broadcastHmr({ type: 'css-update', path: '/_client/styles.css', hash: now });
      } else if (/\.(jsx|tsx|ts|mjs)$/.test(path)) {
        const r = await buildClient();
        console.log(`[build:watch] client rebuilt (${r.outBytes} B)`);
        broadcastHmr({ type: 'module-update', path: '/_client/client.bundle.js', hash: now });
      }
    } catch (err) {
      console.error('[build:watch] rebuild failed:', err);
    }
  };

  fs.watch(join(ROOT, 'client'), { recursive: true }, (_, filename) => {
    if (filename) void trigger(filename);
  });
}

// HMR notifications: the dev-server (server.ts) owns the WS endpoint; here we just POST a hint.
async function broadcastHmr(payload: object) {
  try {
    const port = Bun.env.MDCC_DEV_PORT ?? '4399';
    await fetch(`http://localhost:${port}/_hmr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // server may not be running yet; ignore.
  }
}

// ---------- Orchestrate ----------

async function main() {
  if (MODE === 'dry') {
    console.log(`[build] --dry-run OK (mode=dry, target=${FLAG_TARGET ?? currentTarget()})`);
    return;
  }

  if (WATCH) {
    await watch();
    // Keep alive — fs.watch holds the event loop.
    await new Promise(() => {});
    return;
  }

  console.log(`[build] mode=${MODE}`);

  // MAUDE_SKIP_CLIENT_BUILD=1 — ship the committed dist/client.bundle.js
  // instead of regenerating it. Same contract as MAUDE_SKIP_RUNTIME_BUILD
  // above, for the same reason: the bundle is PLATFORM-INDEPENDENT JavaScript,
  // so there is nothing a per-OS rebuild can add — and measurably something it
  // can take away. With Bun pinned exactly, apps/studio/bun.lock committed and
  // sources normalised to LF, macOS and Linux both emit 1,977,006 B, identical
  // to the reviewed artifact; Bun on Windows emits 1,976,621 B from the same
  // inputs. 385 bytes nobody chose, in the file that decides whether the app
  // draws anything — and a differently-emitted bundle is exactly what opened a
  // blank window in v0.51.1 and v0.52.0. So the Windows job skips the rebuild
  // and packages the same bundle every other platform ships.
  const skipClient = process.env.MAUDE_SKIP_CLIENT_BUILD === '1';
  const t0 = performance.now();
  const client = skipClient ? null : await buildClient();
  const t1 = performance.now();
  if (client) {
    console.log(
      `[build] client.bundle.js  ${client.outBytes.toLocaleString()} B  (${(t1 - t0).toFixed(0)} ms)`
    );
  } else {
    const committed = join(DIST, 'client.bundle.js');
    if (!existsSync(committed)) {
      console.error(
        '[build] MAUDE_SKIP_CLIENT_BUILD=1 but dist/client.bundle.js is absent — nothing to ship.'
      );
      process.exit(1);
    }
    console.log(
      `[build] client.bundle.js  SKIPPED (MAUDE_SKIP_CLIENT_BUILD=1 — shipping the committed ${statSync(committed).size.toLocaleString()} B artifact)`
    );
  }

  const commentMount = await buildCommentMount();
  const t1b = performance.now();
  console.log(
    `[build] comment-mount.js  ${commentMount.outBytes.toLocaleString()} B  (${(t1b - t1).toFixed(0)} ms)`
  );

  const css = await buildCss();
  const t2 = performance.now();
  console.log(
    `[build] styles.css        ${css.outBytes.toLocaleString()} B  (${(t2 - t1b).toFixed(0)} ms)`
  );

  // Pre-built runtime bundles — ship to disk so /_canvas-runtime/* never
  // needs a runtime Bun.build (which would need disk node_modules/react,
  // absent in compiled binaries + npm installs). Phase 19.1 / v0.18.1.
  //
  // MAUDE_SKIP_RUNTIME_BUILD=1 — skip the regen and trust the committed
  // dist/runtime/*.js. Set in CI publish-main so the npm tarball ships
  // exactly what was committed in git (platform-agnostic). v0.22.0 shipped
  // a broken Ubuntu-CI motion_react.js because the on-disk authoritative
  // bundle got overwritten by `pnpm build`; this flag prevents that class
  // of regression. The check-runtime-bundles.sh step still validates the
  // on-disk artifacts against .min-sizes.json after the build.
  if (process.env.MAUDE_SKIP_RUNTIME_BUILD === '1') {
    console.log(
      '[build] dist/runtime/*.js SKIPPED (MAUDE_SKIP_RUNTIME_BUILD=1 — using committed pre-built)'
    );
  } else if (
    MODE === 'dev' &&
    process.env.MAUDE_FORCE_RUNTIME_BUILD !== '1' &&
    (await runtimeBundlesComplete())
  ) {
    console.log(
      '[build] dist/runtime/*.js SKIPPED (all present; committed bundles are authoritative — MAUDE_FORCE_RUNTIME_BUILD=1 to regen after a dep bump)'
    );
  } else {
    const runtime = await buildRuntimeBundles();
    const t2b = performance.now();
    console.log(
      `[build] dist/runtime/*.js ${runtime.bytes.toLocaleString()} B in ${runtime.count} files  (${(t2b - t2).toFixed(0)} ms)`
    );
  }

  if (MODE === 'release') {
    const targets: PlatformTarget[] = FLAG_TARGET
      ? [FLAG_TARGET as PlatformTarget]
      : [currentTarget()];
    for (const target of targets) {
      const t = performance.now();
      const bin = await buildServerBinary(target, { cloud: CLOUD });
      console.log(`[build] ${bin.outPath}  (${(performance.now() - t).toFixed(0)} ms)`);
    }
  }
}

// Only run the build when invoked directly — importers (e.g. the test suite,
// which calls `writeCompileEntry` from build.ts) should not trigger a dev
// build as a side effect.
if (import.meta.main) {
  await main();
}

export {
  buildClient,
  buildCommentMount,
  buildCss,
  buildServerBinary,
  PLATFORM_MATRIX,
  type PlatformTarget,
};
