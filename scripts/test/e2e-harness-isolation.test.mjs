// V2-8.3 (p8-e2e-fix-r1): every desktop e2e spec file runs in its own app, from a clean config home, in front.
//
// Three harness defects made the r1 full run red in ways that had nothing to do with the specs:
//   1. @wdio/tauri-service's embedded provider launches ONE app per lane and runs every spec's session against it,
//      so a spec inherited the previous one's live page (an open chat, a composer draft, a pinned panel), and the
//      per-spec reset in `beforeSession` deleted `_server.json` and the stores under the running app.
//      → the reset moved to the launcher's `onWorkerEnd`, after `stopE2eApp` (the service respawns a dead app).
//   2. scripts/v2-test-lane.sh hands a job ONE `v2-lane-config.*` XDG home; wdio.conf adopted it (`??=`), so a
//      full run shared prefs/profiles across every lane and spec, and the fake-AI guard refused it.
//      → wdio.conf replaces any home that is not a `maude-e2e-*` one (isE2eConfigHome).
//   3. a covered / non-key app freezes WebKit and fails the canvas ⌘Z focus gate.
//      → `bringAppToFront` before every test — guarded, so it never LAUNCHES the app outside the harness env.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const E2E = new URL('../../apps/desktop/e2e/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, E2E), 'utf8');
const { isE2eConfigHome } = await import(new URL('helpers/config-home.ts', E2E).href);
const { stopE2eApp } = await import(new URL('helpers/app-lifecycle.ts', E2E).href);

test('only a maude-e2e-* home is the harness’s own — never ~/.config, never the lane wrapper’s', () => {
  assert.equal(isE2eConfigHome(join(tmpdir(), 'maude-e2e-xdg-abc123')), true);
  assert.equal(isE2eConfigHome(join(tmpdir(), 'maude-e2e-share-roles-x', 'config')), true);
  assert.equal(isE2eConfigHome(join(tmpdir(), 'v2-lane-config.Ab12Cd')), false);
  assert.equal(isE2eConfigHome(join(homedir(), '.config')), false);
  assert.equal(isE2eConfigHome(join(homedir(), '.config', 'maude-e2e-sneaky')), false);
  assert.equal(isE2eConfigHome(''), false);
  assert.equal(isE2eConfigHome(undefined), false);
});

test('wdio.conf replaces an inherited home that is not ours (no `??=`), and its prefs/cloud pointers follow', () => {
  const conf = read('wdio.conf.ts');
  assert.doesNotMatch(conf, /XDG_CONFIG_HOME \?\?=/);
  assert.match(conf, /if \(!isE2eConfigHome\(inherited\)\)/);
  assert.match(conf, /'MAUDE_UI_PREFS_PATH', 'prefs\.json'/);
  assert.match(conf, /'MAUDE_CLOUD_CONFIG', 'cloud\.json'/);
  assert.match(read('helpers/fake-ai.ts'), /if \(!isE2eConfigHome\(xdg\)\)/);
});

test('the per-spec reset runs between apps (onWorkerEnd after stopE2eApp), never in the worker', () => {
  const conf = read('wdio.conf.ts');
  const before = conf.slice(conf.indexOf('beforeSession()'), conf.indexOf('async beforeSuite()'));
  assert.doesNotMatch(
    before,
    /resetE2eAppState\(\)|resetFixtureRuntime\(\)|restoreFixtureTree\(\)/
  );
  const end = conf.slice(conf.indexOf('onWorkerEnd:'));
  assert.match(
    end,
    /await stopE2eApp\(Number\(process\.env\.TAURI_WEBDRIVER_PORT\)\)[\s\S]*resetE2eAppState\(\)[\s\S]*restoreFixtureTree\(\)[\s\S]*resetFixtureRuntime\(\)/
  );
});

test('bringAppToFront never launches the app: activate only if it is running', () => {
  const src = read('helpers/app-front.ts');
  assert.match(src, /if application id "\$\{E2E_BUNDLE_ID\}" is running then tell application id/);
  assert.doesNotMatch(read('helpers/canvas-frame.ts'), /osascript/);
  assert.match(read('wdio.conf.ts'), /beforeTest\(\) \{\s*bringAppToFront\(\);/);
});

/** A listener on a free port, run from a copy of node named `name` (the app's binary name is what is checked). */
async function listenerNamed(name) {
  const dir = mkdtempSync(join(tmpdir(), 'maude-e2e-stop-'));
  const bin = join(dir, name);
  copyFileSync(process.execPath, bin);
  const port = await new Promise((r) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
  const child = spawn(
    bin,
    [
      '-e',
      `require('net').createServer().listen(${port}, '127.0.0.1'); setInterval(() => {}, 1e6)`,
    ],
    { stdio: 'ignore' }
  );
  const exited = new Promise((r) => child.once('exit', () => r(true)));
  for (let i = 0; i < 100; i++) {
    const up = await new Promise((r) => {
      const s = createServer()
        .once('error', () => r(true))
        .listen(port, '127.0.0.1', () => s.close(() => r(false)));
    });
    if (up) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    port,
    child,
    exited,
    cleanup: () => {
      child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('stopE2eApp stops the maude-desktop on the lane port and nothing else listening there', {
  skip: process.platform !== 'darwin' && process.platform !== 'linux',
}, async () => {
  const other = await listenerNamed('not-maude');
  try {
    assert.deepEqual(await stopE2eApp(other.port, 2000), []);
    assert.equal(other.child.exitCode, null, 'a foreign listener is left alone');
  } finally {
    other.cleanup();
  }
  const app = await listenerNamed('maude-desktop');
  try {
    const stopped = await stopE2eApp(app.port, 5000);
    assert.deepEqual(stopped, [app.child.pid]);
    assert.equal(await app.exited, true);
  } finally {
    app.cleanup();
  }
});
