import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { resolveSurfaceNative, surfaceNativeManifest } from './surface-native.mjs';

const roots = [];
function fixture(platform) {
  const root = mkdtempSync(join(tmpdir(), 'surface-native-'));
  roots.push(root);
  const debug = join(root, 'apps/desktop/src-tauri/target/debug');
  const base = platform === 'darwin' ? join(debug, 'bundle/macos/Maude.app/Contents') : debug;
  const app = join(base, platform === 'darwin' ? 'MacOS/maude-desktop' : 'maude-desktop');
  const resources = platform === 'darwin' ? join(base, 'Resources') : base;
  for (const file of [
    app,
    join(dirname(app), 'maude-server'),
    join(resources, 'package.json'),
    join(resources, 'apps/studio/dist/client.bundle.js'),
    join(resources, 'cli/commands/design.mjs'),
  ]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, file.endsWith('.json') ? '{}' : 'fixture');
  }
  return { root, app, base, resources };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('Linux resolves a staged native debug app, explicitly distinct from a macOS bundle', () => {
  const f = fixture('linux');
  const found = resolveSurfaceNative({ root: f.root, platform: 'linux' });
  assert.equal(found.app, f.app);
  assert.equal(found.kind, 'linux-staged-debug');
  assert.equal(found.resources, f.resources);
});
test('macOS still requires the packaged executable and resources', () => {
  const f = fixture('darwin');
  assert.equal(resolveSurfaceNative({ root: f.root, platform: 'darwin' }).kind, 'macos-bundle');
  assert.throws(
    () =>
      resolveSurfaceNative({
        root: f.root,
        platform: 'darwin',
        app: join(f.resources, 'package.json'),
      }),
    /MacOS/
  );
});
test('a raw Linux binary without the staged runtime fails before the rig starts', () => {
  const f = fixture('linux');
  rmSync(join(f.resources, 'apps/studio/dist/client.bundle.js'));
  assert.throws(() => resolveSurfaceNative({ root: f.root, platform: 'linux' }), /staged runtime/);
});
test('manifest hashes runtime inputs without traversing Cargo build caches', () => {
  const f = fixture('linux');
  mkdirSync(join(f.base, 'deps'));
  writeFileSync(join(f.base, 'deps/unrelated'), 'not runtime');
  const native = resolveSurfaceNative({ root: f.root, platform: 'linux' });
  const manifest = surfaceNativeManifest(native);
  assert.ok(manifest.files.some((file) => file.path === 'maude-server'));
  assert.ok(manifest.files.some((file) => file.path === 'apps/studio/dist/client.bundle.js'));
  assert.ok(!manifest.files.some((file) => file.path.startsWith('deps/')));
});
test('manifest hashes the explicitly selected executable even with a custom filename', () => {
  const f = fixture('linux');
  const app = join(f.base, 'candidate-desktop');
  writeFileSync(app, 'selected candidate');
  const native = resolveSurfaceNative({ root: f.root, platform: 'linux', app });
  const before = surfaceNativeManifest(native);
  assert.ok(before.files.some((file) => file.path === 'candidate-desktop'));
  writeFileSync(app, 'different candidate');
  assert.notEqual(surfaceNativeManifest(native).sha256, before.sha256);
});
