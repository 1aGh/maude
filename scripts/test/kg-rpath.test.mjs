// The staged kgai `kg` must find the libkuzu.dylib shipped next to it (issue #128 §10).
//
// 1. kg-rpath.mjs adds `@loader_path` once (idempotent), fails loud, and calls the tools in the
//    order otool → install_name_tool → otool (stubbed on PATH — no real binary is touched).
// 2. sync-kg.mjs runs it on the downloaded engine before the alias copy, macOS only; the CI
//    lipo + codesign of `.kg-staging/kg` come after every sync-kg run (a load-command edit on a
//    signed file would invalidate it).
// 3. check-bundle-completeness.mjs --smoke runs the bundled `kg --version` in a stripped env.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ensureLoaderPathRpath, hasLoaderPathRpath } from '../../apps/desktop/scripts/kg-rpath.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'kg-rpath-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// Real `otool -l` shape (kgai v1.4.0 kg-darwin-arm64), trimmed to the rpath commands.
const RPATH = (p) =>
  `Load command 20\n          cmd LC_RPATH\n      cmdsize 32\n         path ${p} (offset 12)\n`;
const UPSTREAM =
  'Load command 19\n      cmd LC_LOAD_DYLIB\n         name @rpath/libkuzu.dylib (offset 24)\n' +
  RPATH('/Users/runner/work/kgai/kgai/third_party/go-kuzu/lib/dynamic/darwin') +
  RPATH('@loader_path/../lib');

test('hasLoaderPathRpath: only an exact @loader_path LC_RPATH counts', () => {
  assert.equal(hasLoaderPathRpath(UPSTREAM), false, '@loader_path/../lib is not @loader_path');
  assert.equal(hasLoaderPathRpath(UPSTREAM + RPATH('@loader_path')), true);
  // a dylib *name* that happens to be @loader_path is not an rpath
  assert.equal(
    hasLoaderPathRpath('      cmd LC_LOAD_DYLIB\n         name @loader_path (offset 24)\n'),
    false
  );
});

/** Stub `otool` + `install_name_tool` into a fresh bin dir; returns { bin, log, file }. */
function stubTools(name, { failInstall = false, lyingInstall = false } = {}) {
  const dir = join(tmp, name);
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(dir, 'calls.log');
  const state = join(dir, 'rpath-added');
  const upstream = join(dir, 'upstream.txt');
  const added = join(dir, 'added.txt');
  writeFileSync(upstream, UPSTREAM);
  writeFileSync(added, RPATH('@loader_path'));
  writeFileSync(
    join(bin, 'otool'),
    `#!/bin/sh\necho "otool $*" >> '${log}'\ncat '${upstream}'\n[ -f '${state}' ] && cat '${added}'\nexit 0\n`,
    { mode: 0o755 }
  );
  const installBody = failInstall
    ? `echo "error: no space in header for a new LC_RPATH" >&2\nexit 1\n`
    : lyingInstall
      ? 'exit 0\n'
      : `touch '${state}'\nexit 0\n`;
  writeFileSync(
    join(bin, 'install_name_tool'),
    `#!/bin/sh\necho "install_name_tool $*" >> '${log}'\n${installBody}`,
    { mode: 0o755 }
  );
  const file = join(dir, 'kg');
  writeFileSync(file, 'not really a mach-o');
  return { bin, log, file };
}

function withPath(bin, fn) {
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${saved}`;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

const calls = (log) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);

test('ensureLoaderPathRpath adds @loader_path once, then is a no-op', () => {
  const { bin, log, file } = stubTools('idempotent');
  withPath(bin, () => {
    assert.equal(ensureLoaderPathRpath(file), 'added');
    assert.deepEqual(calls(log), [
      `otool -l ${file}`,
      `install_name_tool -add_rpath @loader_path ${file}`,
      `otool -l ${file}`,
    ]);
    assert.equal(ensureLoaderPathRpath(file), 'present');
    assert.equal(calls(log).filter((c) => c.startsWith('install_name_tool')).length, 1);
  });
});

test('ensureLoaderPathRpath fails loud when install_name_tool fails', () => {
  const { bin, file } = stubTools('fails', { failInstall: true });
  withPath(bin, () => {
    assert.throws(() => ensureLoaderPathRpath(file), /install_name_tool .*no space in header/);
  });
});

test('ensureLoaderPathRpath fails loud when the rpath is still absent afterwards', () => {
  const { bin, file } = stubTools('lying', { lyingInstall: true });
  withPath(bin, () => {
    assert.throws(() => ensureLoaderPathRpath(file), /no @loader_path rpath/);
  });
});

test('sync-kg.mjs patches the downloaded engine before the alias copy, macOS only', () => {
  const src = readFileSync(join(REPO, 'apps/desktop/scripts/sync-kg.mjs'), 'utf8');
  assert.match(src, /from '\.\/kg-rpath\.mjs'/);
  const dl = src.search(/await download\(.*asset\.kg.*, kgDest, kgSize\)/);
  const patch = src.indexOf('ensureLoaderPathRpath(kgDest)');
  const alias = src.indexOf('copyFileSync(kgDest');
  assert.ok(dl > 0 && patch > dl, 'rpath step runs after the engine is downloaded');
  assert.ok(alias > patch, 'the plain `kg` alias is copied from the patched file');
  const guard = src.slice(src.lastIndexOf('\n', src.lastIndexOf('if', patch)), patch);
  assert.match(guard, /slug\.startsWith\('darwin'\)/, 'the step is gated to macOS slugs');
});

test('build-desktop.yml: lipo + codesign of the kg engine come after every sync-kg run', () => {
  const lines = readFileSync(join(REPO, '.github/workflows/build-desktop.yml'), 'utf8').split('\n');
  const syncs = lines.flatMap((l, i) => (/node scripts\/sync-kg\.mjs/.test(l) ? [i] : []));
  const signs = lines.flatMap((l, i) =>
    /codesign\b.*\.kg-staging\/kg\b/.test(l) || /--sign .*\.kg-staging\/kg$/.test(l) ? [i] : []
  );
  const lipo = lines.findIndex((l) => /lipo -create -output \.kg-staging\/kg/.test(l));
  assert.ok(syncs.length >= 2 && signs.length >= 1 && lipo > 0);
  assert.ok(Math.max(...syncs) < lipo, 'lipo after sync-kg');
  assert.ok(Math.max(...syncs) < Math.min(...signs), 'codesign after sync-kg');
});

/** A minimal Tauri `resources/` dir with a stub `kgai/kg`. */
function fixture(name, kgScript) {
  const res = join(tmp, name, 'resources');
  mkdirSync(join(res, 'apps', 'studio', 'bin'), { recursive: true });
  mkdirSync(join(res, 'kgai'), { recursive: true });
  mkdirSync(join(res, 'plugins', 'kgai', 'hooks'), { recursive: true });
  writeFileSync(join(res, 'kgai', 'VERSION'), 'v1.4.0\n');
  writeFileSync(
    join(res, 'kgai', process.platform === 'darwin' ? 'libkuzu.dylib' : 'libkuzu.so'),
    ''
  );
  writeFileSync(
    join(res, 'plugins', 'kgai', 'hooks', 'hooks.json'),
    '{"hooks":{"Stop":[{"hooks":[]}]}}'
  );
  writeFileSync(join(res, 'kgai', 'kg'), kgScript, { mode: 0o755 });
  return res;
}

function runCheck(res) {
  return spawnSync(
    process.execPath,
    [join(REPO, 'apps/desktop/scripts/check-bundle-completeness.mjs'), res, '--smoke'],
    { encoding: 'utf8', timeout: 60000, env: { ...process.env, NO_COLOR: '1' } }
  );
}

test('check-bundle-completeness --smoke runs the bundled kg --version in a stripped env', () => {
  const envLog = join(tmp, 'kg-env.txt');
  const res = fixture(
    'smoke-ok',
    `#!/bin/sh\necho "PATH=$PATH DYLD=\${DYLD_LIBRARY_PATH:-} ARGS=$*" > '${envLog}'\necho '{"name":"kg","ok":true,"version":"1.4.0"}'\n`
  );
  const r = runCheck(res);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /✓.*smoke kg --version/, out);
  assert.equal(
    readFileSync(envLog, 'utf8').trim(),
    'PATH=/usr/bin:/bin:/usr/sbin:/sbin DYLD= ARGS=--version'
  );
});

test('check-bundle-completeness --smoke fails when the bundled kg cannot load libkuzu', () => {
  const res = fixture(
    'smoke-dyld',
    `#!/bin/sh\necho "dyld[1]: Library not loaded: @rpath/libkuzu.dylib" >&2\nexit 134\n`
  );
  const r = runCheck(res);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /✗.*smoke kg --version/, out);
  assert.match(out, /Library not loaded: @rpath\/libkuzu\.dylib/);
  assert.equal(r.status, 1);
});

test('check-bundle-completeness --smoke fails when kg reports a version other than the pin', () => {
  const res = fixture('smoke-pin', `#!/bin/sh\necho '{"name":"kg","ok":true,"version":"9.9.9"}'\n`);
  const out = (({ stdout, stderr }) => `${stdout}${stderr}`)(runCheck(res));
  assert.match(out, /✗.*smoke kg --version/, out);
  assert.match(out, /9\.9\.9/);
});
