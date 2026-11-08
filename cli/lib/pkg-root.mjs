// pkg-root.mjs — real-disk `maude` package-root resolution, safe inside a
// `bun build --compile` standalone binary (DDR-166 T0b).
//
// `cli/bin/maude.mjs` originally computed PKG_ROOT via
// `dirname(fileURLToPath(import.meta.url))` walk-up — correct for the plain
// npm/node install, but the exact DDR-045 trap: inside a compiled binary,
// `import.meta.url` resolves to Bun's virtual filesystem (`/$bunfs/root` on
// POSIX, `B:/~BUN/root` on Windows), not the real on-disk location. Two
// dev-server releases (v0.18.0/v0.18.1) shipped broken because of this exact
// bug class before DDR-045 fixed it there. This module mirrors that fix
// (`apps/studio/paths.ts` `resolveDevServerRoot`) for the CLI, independently
// — not by importing paths.ts directly, to keep the CLI's compiled binary
// decoupled from the dev-server's module graph.

import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function isVirtualBunfsPath(p) {
  return p !== null && (p.startsWith('/$bunfs') || p.startsWith('B:/~BUN'));
}

/** True inside a `bun build --compile` standalone binary. Mirrors `apps/studio/paths.ts`'s `IS_COMPILED_BINARY`. */
export function isCompiledBinary() {
  return isVirtualBunfsPath(getImportMetaDir());
}

function getImportMetaDir() {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

/**
 * Anchor: `apps/studio/bin/screenshot.sh` is present in every real maude
 * package root (dev tree, npm tarball, and the Tauri desktop `Resources/`
 * bundle all ship it) and nowhere else — unique enough to identify the
 * package root without also requiring `package.json` (npm tarballs can drop
 * nested workspace `package.json` files, the exact false-negative DDR-045's
 * own retro already documents for the dev-server's analogous check).
 */
export function isPkgRoot(dir) {
  // Both anchors, not just one: `apps/studio/bin/screenshot.sh` ALONE is a
  // false-positive inside the Tauri desktop build — `stage-resources.mjs`
  // stages a full working copy of `apps/studio` (dev-server + bin scripts)
  // into `target/debug/apps/studio/` for the sidecar's own runtime
  // resolution, but that staged copy has no `cli/` — walking up from a
  // compiled `maude` binary placed at `target/debug/maude` matched THAT
  // copy first and stopped one level too early (caught by live testing
  // against the real Tauri build, not a synthetic path). `cli/commands/
  // design.mjs` only exists in a genuine package root.
  return (
    existsSync(join(dir, 'apps', 'studio', 'bin', 'screenshot.sh')) &&
    existsSync(join(dir, 'cli', 'commands', 'design.mjs'))
  );
}

/**
 * Resolve maude's own package root — real disk path, safe inside a compiled
 * binary. Priority: (0) explicit `MAUDE_PKG_ROOT` override (sidecar.rs sets this
 * on the desktop), (1) dev-mode `import.meta.url` (plain `node`/`bun run
 * cli/bin/maude.mjs`), (2) compiled-binary walk-up from `process.execPath`
 * (matches the npm-install layout: binary at `@1agh/maude-<platform>/maude`
 * walks up to `@1agh/maude/`, which ships `apps/studio/` via `package.json`
 * `files`), (3) the Tauri **`.app` sibling probe** below.
 *
 * Why (3) exists: in a packaged `Maude.app` the bundled `maude` binary lives in
 * `Contents/MacOS/` but the staged package tree (`apps/studio/`, `cli/`,
 * `package.json`) lives in the SIBLING `Contents/Resources/` — NOT an ancestor
 * of the binary, so the walk-up in (2) never reaches it and used to fall through
 * to `dirname(execPath)` = `Contents/MacOS/`, breaking every `maude design
 * <verb>` with "helper not found" (RCA issue-acp-panel-hangs-on-nodeless-machine
 * G2, reproduced on the shipped v0.45.1 `.app`). The earlier claim that the
 * binary + `Resources/apps/studio` "share a common ancestor within the walk-up
 * depth" was WRONG — `Contents/` is the common ancestor but `apps/studio` sits
 * under `Contents/Resources/`, not `Contents/`, and `cli/` isn't in the ancestry
 * at all. We probe the known Tauri resource-dir siblings explicitly instead.
 */
/**
 * Probe the Tauri packaged-app resource dir relative to the binary's own dir.
 * From `<app>/Contents/MacOS/maude`, the staged package tree is at the SIBLING
 * `<app>/Contents/Resources`. Covers macOS (`Resources`), the lower-cased
 * resource dir other Tauri targets use, and a binary co-located with a
 * `resources/` dir (dev staging). Returns the first valid pkgRoot, or null.
 * Exported so the RCA-G2 fix is unit-testable without spawning a real `.app`.
 */
export function resolveTauriResourcePkgRoot(execDir) {
  for (const rel of [['..', 'Resources'], ['..', 'resources'], ['resources']]) {
    const cand = join(execDir, ...rel);
    if (isPkgRoot(cand)) return cand;
  }
  return null;
}

function realOrNull(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * The packaged app's compiled studio server, when THIS CLI runs from the app bundle (T1.10, #206).
 *
 * From the `.app`, `maude design server-up` / `serve` used to run `bun server.ts` against the staged
 * studio source in `Contents/Resources/apps/studio`, which has no node_modules ("dev-server runtime
 * deps not installed: yjs y-protocols lib0"), while the compiled `maude-server` the desktop runs sat
 * right next to the CLI in `Contents/MacOS`. The desktop hands its children MAUDE_DEV_SERVER_BIN;
 * a terminal has no desktop parent, so the CLI finds the server itself, the same way it finds its
 * package root: from the running executable's REAL directory (a PATH symlink into the app is
 * dereferenced), and only when the package root in use IS that bundle's resource tree.
 *
 * Returns `{ bin, devServerRoot, pkgRoot }` — the env the desktop gives the same server is
 * MAUDE_DEV_SERVER_ROOT = devServerRoot and MAUDE_PKG_ROOT = pkgRoot (sidecar.rs) — or null for a
 * repo checkout or an npm install (nothing beside node / the platform binary).
 */
export function resolveAppSidecar({ pkgRoot, execPath }) {
  const real = realOrNull(execPath);
  if (!real || !pkgRoot) return null;
  const execDir = dirname(real);
  const bin = join(execDir, process.platform === 'win32' ? 'maude-server.exe' : 'maude-server');
  try {
    if (!statSync(bin).isFile()) return null;
  } catch {
    return null;
  }
  const sibling = resolveTauriResourcePkgRoot(execDir);
  if (!sibling || realOrNull(sibling) !== realOrNull(pkgRoot)) return null;
  return { bin, devServerRoot: join(sibling, 'apps', 'studio'), pkgRoot: sibling };
}

/**
 * The package root for a running executable in `execDir`. Inside `<X>.app/Contents/MacOS` the
 * bundle's own `Contents/Resources` wins: a debug build sits under `target/debug/`, which also
 * holds staged `apps/` + `cli/` + `package.json`, and the walk-up used to reach that tree first (so
 * `server-up` ran the staged source with no node_modules). Otherwise walk up (up to 10 levels),
 * then fall back to the Tauri sibling probe. Null when nothing matches.
 */
export function pkgRootFromExecDir(execDir) {
  if (basename(execDir) === 'MacOS' && basename(dirname(execDir)) === 'Contents') {
    const res = join(execDir, '..', 'Resources');
    if (isPkgRoot(res)) return res;
  }
  let cur = execDir;
  for (let i = 0; i < 10; i++) {
    if (isPkgRoot(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // Tauri `.app` sibling probe — the packaged layout the walk-up can't reach.
  return resolveTauriResourcePkgRoot(execDir);
}

export function resolvePkgRoot() {
  const override = process.env.MAUDE_PKG_ROOT;
  if (override && !isVirtualBunfsPath(override) && isPkgRoot(override)) return override;

  const importDir = getImportMetaDir();
  if (importDir && !isVirtualBunfsPath(importDir)) {
    // Dev-mode: cli/bin/maude.mjs is 2 levels under the package root.
    const candidate = join(importDir, '..', '..');
    if (isPkgRoot(candidate)) return candidate;
  }

  // `process.execPath` is the path AS INVOKED — when launched through a
  // symlink (DDR-166 T0b stages exactly this: sidecar.rs's narrow bin-link
  // dir), it's the symlink's own path, not the real target, and walking up
  // from there (e.g. ~/Library/Caches/…/bin-link/) never reaches the repo
  // root. Dereference first. Falls back to the raw path if the file somehow
  // doesn't exist (shouldn't happen — we ARE that running process).
  let execDir;
  try {
    execDir = dirname(realpathSync(process.execPath));
  } catch {
    execDir = dirname(process.execPath);
  }
  const found = pkgRootFromExecDir(execDir);
  if (found) return found;

  // Final fallback for unanchored test contexts — callers should expect
  // existsSync-based lookups to fail and surface a clear error, same
  // contract as paths.ts's own resolver. Never join a VIRTUAL importDir here
  // (`/$bunfs/root/../..` collapses to `/` via path.join — a real bug an
  // earlier draft of this function had, caught by testing against an
  // unanchored compile output before wiring this into Tauri).
  return dirname(process.execPath);
}
