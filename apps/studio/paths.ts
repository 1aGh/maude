// Path resolution for the dev-server, robust across THREE runtime modes:
//
//   1. Dev (`bun server.ts`):      import.meta.url is a real file:// path,
//                                  use dirname of it.
//   2. Compiled binary, npm:       maude installed via `npm i -g @1agh/maude`;
//                                  binary lives in a sub-package dir, deps in
//                                  the parent @1agh/maude/ dir. import.meta.url
//                                  is the virtual `/$bunfs/root` (bun --compile
//                                  embedded fs) — NOT a real disk path.
//                                  Walk up from process.execPath until we find
//                                  the real apps/studio/ dir.
//   3. Compiled binary, marketplace cache: the marketplace clone ships only the
//                                  plugin markdown (plugins/design/) — the
//                                  dev-server ships via npm (package.json files),
//                                  so the runtime is resolved from the npm
//                                  package layout, never the marketplace cache.
//                                  Same walk-up logic anchors on http.ts. See
//                                  DDR-095 for the apps/studio relocation.
//
// Why this matters: Phase 19 v0.18.0 used `dirname(fileURLToPath(import.meta.url))`
// universally. In the compiled binary that's `/$bunfs/root` — a virtual path —
// so `existsSync('/$bunfs/root/dist/client.bundle.js')` always returned false
// even when the file was sitting on disk at the real install path. Self-heal
// false-triggered, http.ts /_client/* fell through to /$bunfs/root/client/*.jsx
// (raw source), runtime-bundle.ts synthetic entrypoint anchored in virtual fs
// so Bun.build couldn't walk node_modules. Every observed symptom traces to
// this one bug. Phase 19.1 / v0.18.1.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Real disk path to the dev-server install dir
 * (`apps/studio/` inside whatever package layout we're in).
 *
 * Always a directory that contains `http.ts` + `dist/` + (optionally)
 * `node_modules/` and `client/`. Never a virtual `/$bunfs/*` path.
 */
export const DEV_SERVER_ROOT: string = resolveDevServerRoot();

/** `<DEV_SERVER_ROOT>/dist/` — committed artifacts + runtime bundles + binary. */
export const DIST_DIR: string = join(DEV_SERVER_ROOT, 'dist');

/** `<DEV_SERVER_ROOT>/client/` — raw source HTML + JSX + CSS for dev fallback. */
export const CLIENT_DIR: string = join(DEV_SERVER_ROOT, 'client');

/** `<DEV_SERVER_ROOT>/dist/runtime/` — pre-built /_canvas-runtime/*.js bundles. */
export const RUNTIME_BUNDLES_DIR: string = join(DIST_DIR, 'runtime');

/**
 * `<DEV_SERVER_ROOT>/bin/` — the shell helpers behind `maude design <verb>`.
 * Resolved here rather than locally per DDR-045: inside a `bun --compile`
 * binary a local `dirname(fileURLToPath(import.meta.url))` yields the virtual
 * `/$bunfs/root`, and every `existsSync` against it silently returns false.
 */
export const BIN_DIR: string = join(DEV_SERVER_ROOT, 'bin');

/**
 * `<DEV_SERVER_ROOT>/stickers/` — bundled whiteboard sticker packs
 * (feature-whiteboard-annotation-improvements, Phase 4). Ships with the
 * `@1agh/maude` tarball (a subdir of `apps/studio`, already covered by the
 * existing `files` entry — no separate packaging step). Resolved from
 * DEV_SERVER_ROOT per DDR-045 — this is MAUDE's own bundled asset store, never
 * the served project's.
 */
export const STICKERS_DIR: string = join(DEV_SERVER_ROOT, 'stickers');

/**
 * `<DEV_SERVER_ROOT>/media/` — bundled Maude-product media (the intro
 * showreel, DDR-166 Phase 1 T2). Same shape as `STICKERS_DIR`: ships with the
 * `@1agh/maude` tarball (a subdir of `apps/studio`, already covered by the
 * existing `files` entry), resolved from DEV_SERVER_ROOT per DDR-045 — this is
 * MAUDE's OWN asset store, never the served project's `.design/assets/`, so
 * every user sees the same intro regardless of which project is open.
 */
export const MEDIA_DIR: string = join(DEV_SERVER_ROOT, 'media');

/**
 * `<DEV_SERVER_ROOT>/schema/` — the design-system schema registry
 * (`ds-schema-v1.json`), its JSON Schemas and the generated fallback layer
 * (V2-1.13 §5.1). Ships inside `apps/studio/**` like `stickers/`; resolved from
 * DEV_SERVER_ROOT per DDR-045 — Maude's own data, never the served project's.
 */
export const SCHEMA_DIR: string = join(DEV_SERVER_ROOT, 'schema');

/**
 * Absolute path to a bundled plugin's loadable tree (`commands/`, `agents/`,
 * `skills/`, `hooks/`, `.claude-plugin/plugin.json`), or `null` when this layout
 * doesn't ship it. Feeds the ACP session-scoped plugin auto-bootstrap
 * (acp/plugin-bootstrap.ts → `_meta.claudeCode.options.plugins`, DDR-143).
 *
 * Resolved from DEV_SERVER_ROOT per DDR-045 (NEVER a local
 * `dirname(fileURLToPath(import.meta.url))` — that's `/$bunfs/root` inside a
 * compiled binary). Both the dev tree and the desktop `Resources/` bundle keep
 * `plugins/` a sibling of `apps/studio/`, so `<root>/../../plugins/<p>` reaches
 * it in either layout (`path.join` collapses the `..` segments):
 *   • dev tree:            <repo>/apps/studio        → <repo>/plugins/design
 *   • desktop Resources:   …/Resources/apps/studio   → …/Resources/plugins/design
 *
 * The npm tarball ships ONLY `plugins/<p>/templates` (+ dependencies.json;
 * `plugins/flow/.claude-plugin/config.schema.json`) — NOT the plugin manifest
 * (DDR-044 minimal surface). So we gate on `.claude-plugin/plugin.json`, not the
 * dir: its ABSENCE under the npm-global / web-serve layout yields `null`, and
 * the resolver skips injection there (those users have a terminal + the manual
 * marketplace path). Only the dev tree and the staged desktop bundle carry it.
 */
export function pluginDirFrom(
  devServerRoot: string,
  plugin: 'design' | 'flow' | 'kgai'
): string | null {
  const dir = join(devServerRoot, '..', '..', 'plugins', plugin);
  return existsSync(join(dir, '.claude-plugin', 'plugin.json')) ? dir : null;
}

/** Bundled `design` plugin tree, or `null` (npm/web layout). See {@link pluginDirFrom}. */
export const DESIGN_PLUGIN_DIR: string | null = pluginDirFrom(DEV_SERVER_ROOT, 'design');

/** Bundled `flow` plugin tree, or `null` (npm/web layout). See {@link pluginDirFrom}. */
export const FLOW_PLUGIN_DIR: string | null = pluginDirFrom(DEV_SERVER_ROOT, 'flow');

/**
 * Bundled THIRD-PARTY `kgai` plugin tree (kgaidev/kgai, MIT), or `null`.
 *
 * Staged only by the desktop build (`apps/desktop/scripts/sync-kg.mjs` fetches a
 * PINNED upstream release — never vendored, never floating), so this is non-null
 * exclusively in the packaged `.app`. It carries kgai's `Stop` hook, which is the
 * autonomous decision-capture nudge; without injecting this plugin the ACP chat
 * panel captures nothing (the terminal-less DDR-177 user never marketplace-installs
 * kgai). The upstream `SessionStart` install hook is stripped at stage time.
 */
export const KGAI_PLUGIN_DIR: string | null = pluginDirFrom(DEV_SERVER_ROOT, 'kgai');

/**
 * The staged kgai engine: `{ bin, lib }` absolute paths, or `null` when this
 * layout doesn't ship it (dev tree / npm — where a user-installed `kg` on PATH
 * is used instead). `bin` is the Tauri `externalBin` sidecar (signed + notarized
 * with the app); `lib` is the directory holding `libkuzu`, exported as `KGAI_LIB`
 * so the spawn folds it into DYLD_/LD_LIBRARY_PATH (`cli/commands/kg.mjs`).
 *
 * Resolved from DEV_SERVER_ROOT per DDR-045 (never `import.meta.url`).
 */
export function resolveStagedKgai(): { bin: string; lib: string } | null {
  // Sidecars land beside the app executable; resources under Contents/Resources.
  // <Resources>/apps/studio → <Resources> → ../MacOS/<sidecar>
  const resources = join(DEV_SERVER_ROOT, '..', '..');
  const lib = join(resources, 'kgai');
  if (!existsSync(lib)) return null;
  for (const candidate of [join(resources, '..', 'MacOS', 'kg'), join(resources, 'kgai', 'kg')]) {
    if (existsSync(candidate)) return { bin: candidate, lib };
  }
  return null;
}

/**
 * Whether we are running inside a `bun --compile` standalone binary
 * (true when `import.meta.url` resolves to bun's virtual filesystem).
 *
 * Useful for code that needs to know whether disk-relative fallback paths
 * (e.g. `<DEV_SERVER_ROOT>/client/app.jsx`) are even reachable — in compiled
 * mode the answer is "only if shipped via the install layout".
 */
export const IS_COMPILED_BINARY: boolean = isVirtualBunfsPath(getImportMetaDir());

function getImportMetaDir(): string | null {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

function isVirtualBunfsPath(p: string | null): boolean {
  return p !== null && (p.startsWith('/$bunfs') || p.startsWith('B:/~BUN'));
}

function isDevServerDir(dir: string): boolean {
  // Anchor: http.ts is the route-table file — unique enough to identify the
  // dev-server install dir. We do NOT also require package.json: npm excludes
  // nested workspace package.json files from tarballs by default, so checking
  // for it caused walk-up to silently fall through to /$bunfs/root for every
  // npm-installed user. Discovered in v0.18.1 retro. Process.execPath walk-up
  // only traverses node_modules layers above the binary, so false-match risk
  // from a stray http.ts file in the user's working tree is negligible.
  return existsSync(join(dir, 'http.ts'));
}

/**
 * `\\?\C:\x` → `C:\x` and `\\?\UNC\srv\share` → `\\srv\share`; anything else
 * unchanged. Mirrors `strip_verbatim` in apps/desktop/src-tauri/src/win_process.rs.
 */
export function stripWin32Verbatim(p: string): string {
  if (p.startsWith('\\\\?\\UNC\\')) return `\\\\${p.slice(8)}`;
  if (/^\\\\\?\\[a-zA-Z]:/.test(p)) return p.slice(4);
  return p;
}

function resolveDevServerRoot(): string {
  // (0) Explicit override. Used when the runtime can't be found by walk-up — e.g.
  // the Tauri desktop bundle (DDR-106) ships apps/studio/ as an app resource and
  // sets MAUDE_DEV_SERVER_ROOT to it, because the sidecar binary sits alone in
  // Maude.app/Contents/MacOS/ with no apps/studio/ up-tree (the bundle ships the
  // full source, so `http.ts` is present at the resource root).
  // #141 — a verbatim `\\?\C:\…` root (what Tauri's resource_dir is on Windows)
  // propagates into the ACP adapter's entry path, and `node \\?\C:\…` cannot
  // start a script (nodejs/node#62446). The shell strips it; so do we.
  const override = stripWin32Verbatim(process.env.MAUDE_DEV_SERVER_ROOT ?? '');
  // Require the same `http.ts` anchor walk-up uses (not merely a `dist/` dir) so a
  // planted dist-only directory can't hijack the runtime root (security review F4).
  if (override && !isVirtualBunfsPath(override) && isDevServerDir(override)) {
    return override;
  }

  // (1) Dev mode: import.meta.url is a real file:// path AND lands in the
  // dev-server dir. Common case for `bun run server.ts`, tests, etc.
  const importDir = getImportMetaDir();
  if (importDir && !isVirtualBunfsPath(importDir) && isDevServerDir(importDir)) {
    return importDir;
  }

  // (2 + 3) Compiled binary: walk up from process.execPath until we find a dir
  // that *contains* `apps/studio/<canonical files>`. Match the npm install
  // layout (binary at @1agh/maude-<plat>/maude → walk up to @1agh/maude/, which
  // ships apps/studio/ via package.json files). The dev-server is NOT shipped via
  // the marketplace clone, so there is no marketplace-cache anchor (DDR-095).
  let cur = dirname(process.execPath);
  for (let i = 0; i < 10; i++) {
    // Check if cur itself is the dev-server root.
    if (isDevServerDir(cur)) return cur;
    // Check if cur contains apps/studio/.
    const nested = join(cur, 'apps', 'studio');
    if (isDevServerDir(nested)) return nested;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // Final fallback for unanchored test contexts (e.g. tests spawning compiled
  // binary in a tmp dir without our layout). Return the import dir even if
  // it's virtual — callers should expect existsSync to fail and surface a
  // clear error.
  return importDir ?? dirname(process.execPath);
}
