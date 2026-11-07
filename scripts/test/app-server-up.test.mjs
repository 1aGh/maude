// T1.10 (#206) — `maude design server-up` / `serve` from the packaged app must start the compiled studio
// server that sits next to the CLI, never `bun server.ts` against the staged source (no node_modules in
// the app: "dev-server runtime deps not installed: yjs y-protocols lib0").
//
// No real .app is built or run. A synthetic bundle mirrors the shipped layout:
//   Maude.app/Contents/MacOS/maude         — the CLI (here: a launcher for a cloned node running the
//                                            staged cli/, so process.execPath sits in Contents/MacOS)
//   Maude.app/Contents/MacOS/maude-server  — the compiled studio (here: a stub that answers /_health)
//   Maude.app/Contents/Resources/{cli,package.json,apps/studio/bin,…} — the staged package tree, with
//                                            no node_modules
// Also pins the check-bundle-completeness --smoke step (server-up-smoke.mjs) against the same bundle.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { serverUpSmoke } from '../../apps/desktop/scripts/server-up-smoke.mjs';
import { stubClaudeEnv } from '../lib/stub-claude.mjs';
import { stubServerSource } from '../lib/stub-studio-server.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STRIPPED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function makeApp(base, { server = true } = {}) {
  const contents = join(base, 'Maude.app', 'Contents');
  const macos = join(contents, 'MacOS');
  const res = join(contents, 'Resources');
  mkdirSync(macos, { recursive: true });
  // a clone (APFS) or copy, so the running executable really lives in Contents/MacOS
  copyFileSync(process.execPath, join(macos, 'maude-node'), constants.COPYFILE_FICLONE);
  writeFileSync(
    join(macos, 'maude'),
    '#!/bin/sh\nd=$(cd "$(dirname "$0")" && pwd)\nexec "$d/maude-node" "$d/../Resources/cli/bin/maude.mjs" "$@"\n',
    { mode: 0o755 }
  );
  if (server)
    writeFileSync(join(macos, 'maude-server'), stubServerSource(join(macos, 'maude-node')), {
      mode: 0o755,
    });
  cpSync(join(REPO, 'cli'), join(res, 'cli'), {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  });
  copyFileSync(join(REPO, 'package.json'), join(res, 'package.json'));
  cpSync(join(REPO, 'apps', 'studio', 'bin'), join(res, 'apps', 'studio', 'bin'), {
    recursive: true,
  });
  // the staged source is present but has no dependencies installed
  writeFileSync(join(res, 'apps', 'studio', 'server.ts'), '');
  mkdirSync(join(res, 'apps', 'studio', 'dist'));
  return contents;
}

function isolatedEnv(root) {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(root, 'xdg'),
    MAUDE_INDEX_DIR: join(root, 'idx'),
    MAUDE_NO_AUTOBUILD: '1',
    NO_OPEN: '1',
    ...stubClaudeEnv(home, STRIPPED_PATH),
  };
}

function project(root) {
  const proj = join(root, 'proj');
  mkdirSync(join(proj, '.design'), { recursive: true });
  writeFileSync(join(proj, '.design', 'config.json'), '{"name":"t"}');
  return proj;
}

function killStub(proj) {
  try {
    const { pid } = JSON.parse(readFileSync(join(proj, '.design', '_server.json'), 'utf8'));
    if (Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
  } catch {
    /* never started */
  }
}

function run(cmd, args, env, { untilFile, timeoutMs = 40000 } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ code: 'timeout', stdout, stderr });
    }, timeoutMs);
    let poll = null;
    if (untilFile)
      poll = setInterval(() => {
        if (existsSync(untilFile)) {
          clearInterval(poll);
          clearTimeout(timer);
          done({ code: 'file', stdout, stderr, child });
        }
      }, 200);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      done({ code, stdout, stderr });
    });
  });
}

test('server-up from the app, no node/bun on PATH: starts the compiled server beside the CLI', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maude-app-server-up-')));
  const c = makeApp(root);
  const proj = project(root);
  t.after(() => {
    killStub(proj);
    rmSync(root, { recursive: true, force: true });
  });
  const env = isolatedEnv(root);
  delete env.NO_OPEN; // server-up adds it itself (T1.9)
  const r = await run(
    join(c, 'MacOS', 'maude'),
    ['design', 'server-up', '--root', proj, '--timeout', '20'],
    env
  );
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /runtime deps not installed|bun not on/);
  const seen = JSON.parse(readFileSync(join(proj, '.design', '_stub-env.json'), 'utf8'));
  assert.equal(seen.NO_OPEN, '1');
  assert.equal(seen.MAUDE_DEV_SERVER_ROOT, join(c, 'Resources', 'apps', 'studio'));
  assert.equal(seen.MAUDE_PKG_ROOT, join(c, 'Resources'));
});

test('serve from the app: runs the compiled server beside the CLI with the staged studio', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maude-app-serve-')));
  const c = makeApp(root);
  const proj = project(root);
  t.after(() => {
    killStub(proj);
    rmSync(root, { recursive: true, force: true });
  });
  const r = await run(
    join(c, 'MacOS', 'maude'),
    ['design', 'serve', '--root', proj],
    isolatedEnv(root),
    { untilFile: join(proj, '.design', '_stub-env.json') }
  );
  assert.equal(r.code, 'file', `serve never started the app server: ${r.stderr}`);
  // the stub writes its env before it listens; give it a moment
  await new Promise((s) => setTimeout(s, 300));
  const seen = JSON.parse(readFileSync(join(proj, '.design', '_stub-env.json'), 'utf8'));
  assert.equal(seen.MAUDE_DEV_SERVER_ROOT, join(c, 'Resources', 'apps', 'studio'));
  assert.equal(seen.MAUDE_PKG_ROOT, join(c, 'Resources'));
  assert.deepEqual(seen.argv, ['--root', proj]);
});

test('the bundle smoke step: green on a bundle whose server-up boots, red on one that cannot', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maude-app-smoke-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const good = makeApp(join(root, 'good'));
  const ok = await serverUpSmoke({
    binary: join(good, 'MacOS', 'maude'),
    strippedPath: STRIPPED_PATH,
    timeoutS: 20,
  });
  assert.equal(ok.ok, true, ok.detail);
  // no compiled server in the bundle → the CLI is back on the source path, which cannot run here
  const bad = makeApp(join(root, 'bad'), { server: false });
  const no = await serverUpSmoke({
    binary: join(bad, 'MacOS', 'maude'),
    strippedPath: STRIPPED_PATH,
    timeoutS: 5,
  });
  assert.equal(no.ok, false, no.detail);
});
