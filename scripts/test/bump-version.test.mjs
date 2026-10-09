// scripts/bump-version.sh + check-version-parity.sh with release candidates
// (V2-2.0, T21′), in a throwaway git repo.
//
// What is held here:
//   - `X.Y.Z-rc.N` is accepted and every manifest moves in lockstep — npm,
//     plugins, the 7 sub-packages + optionalDependencies pins, the two app
//     manifests, tauri.conf.json, Cargo.toml AND the Cargo.lock entry (whose
//     rewrite regex used to match X.Y.Z only, so bumping FROM an rc would have
//     silently left it behind);
//   - an rc NEVER becomes the fleet instruction: the maude-cell / maude-render
//     image tags in wrangler.toml stay on the last stable release, and the
//     parity check refuses an rc there;
//   - What's New entries stay pending through an rc (stable users get them,
//     stamped, with the stable release);
//   - `rc` and `promote` walk the lifecycle; garbage, and ambiguous moves, are
//     refused without touching a file.
//
// The fixture copies the REAL manifests, so it breaks when their shape moves.
// bun and pnpm are kept off PATH: the script's bundle rebuild and site regen
// are skipped (they warn), which is exactly the part this test does not cover
// — and it never touches this checkout's apps/studio/dist/.
//
// To prove the tests still catch the bug, run them against other scripts:
//   BUMP_SCRIPTS_UNDER_TEST=/dir/with/old/scripts node --test scripts/test/bump-version.test.mjs

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = process.env.BUMP_SCRIPTS_UNDER_TEST
  ? resolve(process.env.BUMP_SCRIPTS_UNDER_TEST)
  : join(ROOT, 'scripts');

const SUBS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'linux-x64-musl',
  'linux-arm64-musl',
  'win32-x64',
];
const JSON_MANIFESTS = [
  'package.json',
  'plugins/design/.claude-plugin/plugin.json',
  'plugins/flow/.claude-plugin/plugin.json',
  'plugins/design/.codex-plugin/plugin.json',
  'plugins/flow/.codex-plugin/plugin.json',
  ...SUBS.map((s) => `packages/maude-${s}/package.json`),
  'apps/studio/package.json',
  'apps/hub/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
];
const OTHER_FILES = [
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/desktop/src-tauri/Cargo.lock',
  'apps/cells/wrangler.toml',
  'apps/render/wrangler.toml',
  '.bun-version',
];
const SCRIPT_FILES = [
  'bump-version.sh',
  'check-version-parity.sh',
  'stamp-whats-new.mjs',
  'check-import-coherence.sh',
];

let dir;
let env;

const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
const run = (script, ...args) =>
  spawnSync('bash', [join(dir, 'scripts', script), ...args], { cwd: dir, env, encoding: 'utf8' });
const bump = (arg) => run('bump-version.sh', arg);
const readJson = (rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));
const readText = (rel) => readFileSync(join(dir, rel), 'utf8');

function versions() {
  const v = {};
  for (const rel of JSON_MANIFESTS) v[rel] = readJson(rel).version;
  v['Cargo.toml'] = /^version = "([^"]+)"/m.exec(readText('apps/desktop/src-tauri/Cargo.toml'))[1];
  v['Cargo.lock'] = /name = "maude-desktop"\nversion = "([^"]+)"/.exec(
    readText('apps/desktop/src-tauri/Cargo.lock')
  )[1];
  for (const [k, pin] of Object.entries(readJson('package.json').optionalDependencies ?? {})) {
    if (k.startsWith('@1agh/maude-')) v[`pin ${k}`] = pin;
  }
  return v;
}
const imageTag = (rel, name) => new RegExp(`/${name}:([^"]+)"`).exec(readText(rel))[1];
const cellTag = () => imageTag('apps/cells/wrangler.toml', 'maude-cell');
const renderTag = () => imageTag('apps/render/wrangler.toml', 'maude-render');

function assertLockstep(expected) {
  const v = versions();
  for (const [k, got] of Object.entries(v))
    assert.equal(got, expected, `${k} is ${got}, want ${expected}`);
  assert.ok(
    Object.keys(v).length >= JSON_MANIFESTS.length + 2 + SUBS.length,
    'every manifest read'
  );
}

function writeWhatsNew() {
  writeFileSync(
    join(dir, 'apps/studio/whats-new.json'),
    `${JSON.stringify({ entries: [{ id: 'fixture', title: 'Fixture entry', version: null, date: null }] }, null, 2)}\n`
  );
}
const whatsNewVersion = () => readJson('apps/studio/whats-new.json').entries[0].version;

function commitAll(msg) {
  git('add', '-A');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', msg, '--allow-empty');
}
/** Every file still exactly as last committed. */
const untouched = () => git('status', '--porcelain') === '';

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'bump-version-'));
  for (const rel of [...JSON_MANIFESTS, ...OTHER_FILES]) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(dir, rel));
  }
  mkdirSync(join(dir, 'scripts'));
  for (const f of SCRIPT_FILES) {
    cpSync(join(SCRIPTS, f), join(dir, 'scripts', f));
    // bump-version.sh EXECUTES its siblings; a copy without the bit (e.g. one
    // extracted with `git show`) would fail for the wrong reason.
    chmodSync(join(dir, 'scripts', f), 0o755);
  }
  mkdirSync(join(dir, 'apps/studio'), { recursive: true });

  // A PATH with node and git but no bun / pnpm (see the header). npx may stay:
  // the script's `npx --no-install biome format … || true` is cosmetic.
  const bin = join(dir, '.bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  const gitPath = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  symlinkSync(gitPath, join(bin, 'git'));
  env = { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, LANG: 'C' };
  const leaked = spawnSync('sh', ['-c', 'command -v bun; command -v pnpm'], {
    env,
    encoding: 'utf8',
  }).stdout.trim();
  assert.equal(leaked, '', `the fixture PATH must not reach bun/pnpm, found: ${leaked}`);

  git('init', '-q');
  // Normalise to a known stable starting point, then add a pending entry.
  const norm = bump('1.8.1');
  assert.equal(norm.status, 0, norm.stderr);
  writeWhatsNew();
  commitAll('fixture at 1.8.1');
});

after(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

test('garbage and unshippable versions are refused without touching a file', () => {
  for (const bad of [
    '2.0',
    '02.0.0',
    'v2.0.0',
    '2.0.0-beta.1',
    '2.0.0-rc.0',
    '2.0.0-rc',
    '2.0.0-RC.1',
    '2.0.0-rc.1+build.5',
    '2.0.0-rc.01',
    'latest',
  ]) {
    const r = bump(bad);
    assert.equal(r.status, 2, `${bad} → exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.ok(untouched(), `${bad} left changes behind:\n${git('status', '--porcelain')}`);
  }
});

test('rc and promote are refused on a stable version (which line would it be?)', () => {
  for (const arg of ['rc', 'promote']) {
    const r = bump(arg);
    assert.equal(r.status, 2, `${arg} on 1.8.1 → exit ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /X\.Y\.Z-rc\.1|not a release candidate/);
    assert.ok(untouched());
  }
});

test('X.Y.Z-rc.N moves every manifest in lockstep and leaves the fleet on stable', () => {
  const r = bump('2.0.0-rc.1');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assertLockstep('2.0.0-rc.1');
  assert.equal(
    cellTag(),
    'v1.8.1',
    'an rc must not rewrite the cell image tag (the fleet instruction)'
  );
  assert.equal(renderTag(), 'v1.8.1', 'an rc must not rewrite the render image tag');
  assert.equal(whatsNewVersion(), null, "What's New entries stay pending through an rc");
  assert.match(r.stdout, /version parity OK: 2\.0\.0-rc\.1/);
  commitAll('rc.1');
});

test('patch|minor|major on an rc are refused (bump the rc or promote it)', () => {
  for (const arg of ['patch', 'minor', 'major']) {
    const r = bump(arg);
    assert.equal(r.status, 2, `${arg} on an rc → exit ${r.status}\n${r.stderr}`);
    assert.ok(untouched());
  }
});

test('rc bumps the release-candidate number — Cargo.lock included', () => {
  const r = bump('rc');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assertLockstep('2.0.0-rc.2');
  assert.equal(cellTag(), 'v1.8.1');
  commitAll('rc.2');
});

test('parity refuses an rc as the fleet instruction', () => {
  const p = join(dir, 'apps/cells/wrangler.toml');
  const original = readFileSync(p, 'utf8');
  try {
    writeFileSync(p, original.replace(/(\/maude-cell:)v[^"]+"/, '$1v2.0.0-rc.2"'));
    const r = run('check-version-parity.sh');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /maude-cell/);
  } finally {
    writeFileSync(p, original);
  }
  const ok = run('check-version-parity.sh');
  assert.equal(ok.status, 0, ok.stderr);
});

test('promote releases the rc as X.Y.Z and the fleet + feed follow', () => {
  const r = bump('promote');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assertLockstep('2.0.0');
  assert.equal(cellTag(), 'v2.0.0', 'the stable release rolls the fleet');
  assert.equal(renderTag(), 'v2.0.0');
  assert.equal(whatsNewVersion(), '2.0.0', 'pending entries are stamped with the STABLE release');
  commitAll('2.0.0');
});

test('the stable path is unchanged: patch → X.Y.Z+1, fleet tag follows', () => {
  writeWhatsNew();
  commitAll('another pending entry');
  const r = bump('patch');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assertLockstep('2.0.1');
  assert.equal(cellTag(), 'v2.0.1');
  assert.equal(renderTag(), 'v2.0.1');
  assert.equal(whatsNewVersion(), '2.0.1');
});
