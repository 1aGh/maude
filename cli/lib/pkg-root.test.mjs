// pkg-root.mjs tests (DDR-166 T0b).
//
// The regression this locks down: a naive single-anchor check
// (`apps/studio/bin/screenshot.sh` alone) false-positives inside the Tauri
// desktop build, because `stage-resources.mjs` stages a full working copy of
// `apps/studio` into `target/debug/apps/studio/` for the sidecar's own
// runtime resolution — that staged copy has no `cli/`, so a compiled `maude`
// binary walking up from `target/debug/maude` matched it and stopped one
// level too early, resolving PKG_ROOT to `target/debug` instead of the real
// repo root. Caught by live testing against the real Tauri build (not a
// synthetic path), not by static review — worth a regression test.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  isPkgRoot,
  pkgRootFromExecDir,
  resolveAppSidecar,
  resolvePkgRoot,
  resolveTauriResourcePkgRoot,
} from './pkg-root.mjs';

function makeRealRoot(base) {
  mkdirSync(join(base, 'apps', 'studio', 'bin'), { recursive: true });
  writeFileSync(join(base, 'apps', 'studio', 'bin', 'screenshot.sh'), '#!/bin/sh\n');
  mkdirSync(join(base, 'cli', 'commands'), { recursive: true });
  writeFileSync(join(base, 'cli', 'commands', 'design.mjs'), 'export const run = () => {};\n');
}

test('isPkgRoot requires BOTH anchors — the staged-resources false-positive is rejected', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maude-pkgroot-'));
  try {
    // The exact shape of the bug: apps/studio/bin/screenshot.sh present
    // (mirrors stage-resources.mjs's staged copy), no cli/ at all.
    mkdirSync(join(tmp, 'apps', 'studio', 'bin'), { recursive: true });
    writeFileSync(join(tmp, 'apps', 'studio', 'bin', 'screenshot.sh'), '#!/bin/sh\n');
    assert.equal(isPkgRoot(tmp), false);

    // cli/ alone, no apps/studio — also not a real root.
    const tmp2 = mkdtempSync(join(tmpdir(), 'maude-pkgroot-'));
    try {
      mkdirSync(join(tmp2, 'cli', 'commands'), { recursive: true });
      writeFileSync(join(tmp2, 'cli', 'commands', 'design.mjs'), '');
      assert.equal(isPkgRoot(tmp2), false);
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }

    // Both anchors together — a genuine package root.
    makeRealRoot(tmp);
    assert.equal(isPkgRoot(tmp), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveTauriResourcePkgRoot finds the .app sibling Resources tree (RCA G2)', () => {
  // Mirror the packaged macOS layout: binary in Contents/MacOS, staged tree in
  // the SIBLING Contents/Resources — NOT an ancestor of the binary, which is why
  // the plain walk-up misses it and every `maude design <verb>` broke.
  const app = mkdtempSync(join(tmpdir(), 'maude-app-'));
  try {
    const macosDir = join(app, 'Contents', 'MacOS');
    const resources = join(app, 'Contents', 'Resources');
    mkdirSync(macosDir, { recursive: true });
    makeRealRoot(resources); // stages apps/studio/bin/screenshot.sh + cli/commands/design.mjs

    // From the binary's own dir, the sibling probe must find Resources.
    assert.equal(resolveTauriResourcePkgRoot(macosDir), resources);

    // Regression guard: Resources WITHOUT cli/ (the shipped-broken v0.45.1 shape)
    // must NOT resolve — that's exactly the false-positive isPkgRoot rejects.
    const broken = mkdtempSync(join(tmpdir(), 'maude-app-broken-'));
    try {
      const bMacos = join(broken, 'Contents', 'MacOS');
      const bRes = join(broken, 'Contents', 'Resources', 'apps', 'studio', 'bin');
      mkdirSync(bMacos, { recursive: true });
      mkdirSync(bRes, { recursive: true });
      writeFileSync(join(bRes, 'screenshot.sh'), '#!/bin/sh\n'); // no cli/ staged
      assert.equal(resolveTauriResourcePkgRoot(bMacos), null);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('resolvePkgRoot honors MAUDE_PKG_ROOT only when it actually satisfies both anchors', () => {
  const real = mkdtempSync(join(tmpdir(), 'maude-pkgroot-real-'));
  const fake = mkdtempSync(join(tmpdir(), 'maude-pkgroot-fake-'));
  const prevOverride = process.env.MAUDE_PKG_ROOT;
  try {
    makeRealRoot(real);
    // Fake: only the staged-resources-shaped anchor, same false-positive shape.
    mkdirSync(join(fake, 'apps', 'studio', 'bin'), { recursive: true });
    writeFileSync(join(fake, 'apps', 'studio', 'bin', 'screenshot.sh'), '#!/bin/sh\n');

    process.env.MAUDE_PKG_ROOT = real;
    assert.equal(resolvePkgRoot(), real);

    process.env.MAUDE_PKG_ROOT = fake;
    // Falls through past the (rejected) override to whatever the real
    // walk-up finds in THIS test process — just assert it's NOT the fake
    // dir, since accepting it would be exactly the regression.
    assert.notEqual(resolvePkgRoot(), fake);
  } finally {
    if (prevOverride === undefined) delete process.env.MAUDE_PKG_ROOT;
    else process.env.MAUDE_PKG_ROOT = prevOverride;
    rmSync(real, { recursive: true, force: true });
    rmSync(fake, { recursive: true, force: true });
  }
});

// T1.10 (#206) — from the packaged app, `maude design server-up` / `serve` ran `bun server.ts` against the
// staged studio source, which has no node_modules ("dev-server runtime deps not installed: yjs y-protocols
// lib0"), while the compiled studio server sat right next to the CLI. resolveAppSidecar finds that server
// from the running executable's own directory, and only when the package root is the app's Resources tree.
function makeApp(base, { server = true } = {}) {
  const contents = join(base, 'Maude.app', 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  writeFileSync(join(contents, 'MacOS', 'maude'), '#!/bin/sh\n', { mode: 0o755 });
  if (server)
    writeFileSync(join(contents, 'MacOS', 'maude-server'), '#!/bin/sh\n', { mode: 0o755 });
  makeRealRoot(join(contents, 'Resources'));
  return contents;
}

test('resolveAppSidecar: the app CLI finds the compiled server beside it and the staged studio', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-appsidecar-')));
  try {
    const c = makeApp(tmp);
    const r = resolveAppSidecar({
      pkgRoot: join(c, 'Resources'),
      execPath: join(c, 'MacOS', 'maude'),
    });
    assert.deepEqual(r, {
      bin: join(c, 'MacOS', 'maude-server'),
      devServerRoot: join(c, 'Resources', 'apps', 'studio'),
      pkgRoot: join(c, 'Resources'),
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveAppSidecar: a CLI reached through a symlink (a PATH link into the app) still resolves', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-appsidecar-link-')));
  try {
    const c = makeApp(tmp);
    mkdirSync(join(tmp, 'bin'));
    symlinkSync(join(c, 'MacOS', 'maude'), join(tmp, 'bin', 'maude'));
    const r = resolveAppSidecar({
      pkgRoot: join(c, 'Resources'),
      execPath: join(tmp, 'bin', 'maude'),
    });
    assert.equal(r?.bin, join(c, 'MacOS', 'maude-server'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveAppSidecar: null for a repo / npm install, a missing server, or another package root', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-appsidecar-no-')));
  try {
    // no compiled server beside the CLI
    const bare = makeApp(join(tmp, 'a'), { server: false });
    assert.equal(
      resolveAppSidecar({
        pkgRoot: join(bare, 'Resources'),
        execPath: join(bare, 'MacOS', 'maude'),
      }),
      null
    );
    // a server beside the CLI, but the package root in use is NOT that app's Resources tree
    const c = makeApp(join(tmp, 'b'));
    const other = join(tmp, 'other');
    makeRealRoot(other);
    assert.equal(resolveAppSidecar({ pkgRoot: other, execPath: join(c, 'MacOS', 'maude') }), null);
    // plain node running the repo CLI: nothing beside node
    assert.equal(resolveAppSidecar({ pkgRoot: other, execPath: process.execPath }), null);
    // an executable that does not exist
    assert.equal(resolveAppSidecar({ pkgRoot: other, execPath: join(tmp, 'nope', 'maude') }), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a binary inside <X>.app/Contents/MacOS takes the bundle's Resources over a package root above the .app", () => {
  // A debug build sits in target/debug/bundle/macos/Maude.app, and target/debug itself holds
  // staged apps/ + cli/ + package.json: the walk-up reached that tree first and server-up then ran
  // the staged source with no node_modules. The bundle's own Resources must win.
  const base = mkdtempSync(join(tmpdir(), 'maude-app-nested-'));
  try {
    makeRealRoot(base); // the decoy package root above the .app
    const app = join(base, 'bundle', 'macos', 'Maude.app');
    const macosDir = join(app, 'Contents', 'MacOS');
    const resources = join(app, 'Contents', 'Resources');
    mkdirSync(macosDir, { recursive: true });
    makeRealRoot(resources);
    assert.equal(pkgRootFromExecDir(macosDir), resources);
    // Outside an .app layout the walk-up is unchanged.
    const plain = join(base, 'target', 'debug');
    mkdirSync(plain, { recursive: true });
    assert.equal(pkgRootFromExecDir(plain), base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
