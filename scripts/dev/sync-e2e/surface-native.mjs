import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { treeManifest } from './surface-provenance.mjs';

// Linux's debug build stages resources beside the ELF executable. It is not a
// macOS .app or a signed release: retain that distinction in every run's proof.
export function resolveSurfaceNative({ root, platform = process.platform, app }) {
  const debug = join(root, 'apps/desktop/src-tauri/target/debug');
  if (!['darwin', 'linux'].includes(platform))
    throw new Error(`Unsupported surface platform: ${platform}`);
  const candidate = resolve(
    app ||
      (platform === 'darwin'
        ? join(debug, 'bundle/macos/Maude.app/Contents/MacOS/maude-desktop')
        : join(debug, 'maude-desktop'))
  );
  if (platform === 'darwin' && !candidate.includes('.app/Contents/MacOS/')) {
    throw new Error('The macOS surface requires a bundled .app/Contents/MacOS/ executable.');
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new Error(
      `Build a native debug app first, or pass --app with its executable: ${candidate}`
    );
  }
  const executable = realpathSync(candidate);
  const base = platform === 'darwin' ? resolve(executable, '../..') : dirname(executable);
  const resources = platform === 'darwin' ? join(base, 'Resources') : base;
  for (const path of [
    join(dirname(executable), 'maude-server'),
    join(resources, 'package.json'),
    join(resources, 'apps/studio/dist/client.bundle.js'),
    join(resources, 'cli/commands/design.mjs'),
  ]) {
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error(`Missing staged runtime: ${path}`);
  }
  return {
    app: executable,
    platform,
    kind: platform === 'darwin' ? 'macos-bundle' : 'linux-staged-debug',
    base,
    resources,
  };
}

export function surfaceNativeManifest(native) {
  if (native.kind === 'macos-bundle') return treeManifest(resolve(native.base, '..'));
  const files = [];
  // Never recurse over target/debug itself: deps/incremental are huge build
  // caches, not runtime resources. Hash all staged executable/resource inputs.
  for (const name of [
    basename(native.app),
    'maude-server',
    'maude',
    'agent-browser',
    'package.json',
    'apps',
    'cli',
    'plugins',
    'kgai',
  ]) {
    const path = join(native.base, name);
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      files.push(
        ...treeManifest(path).files.map((file) => ({ ...file, path: `${name}/${file.path}` }))
      );
    } else {
      files.push({
        path: name,
        bytes: statSync(path).size,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      });
    }
  }
  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
