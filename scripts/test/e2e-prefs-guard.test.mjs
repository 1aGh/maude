// p8-e2e-fix-r12 §0: a desktop e2e lane fails at once when a studio-like process runs on the person's real config.
//
// r11 pass C2: `~/.config/maude/prefs.json` moved at 09:17:52 while the team-project lane ran (and passed). Every
// e2e child inherits wdio.conf.ts's `maude-e2e-*` XDG_CONFIG_HOME, so the lane could not see it; the mtime check ran
// only after the lane. The guard (helpers/prefs-guard.ts) samples `ps eww` every 0.5 s for the whole lane: any
// maude-server / server.ts / bun / `maude --root` process that the lane started (a descendant of the launcher, or
// born after the lane started) and that lacks a `maude-e2e-*` XDG_CONFIG_HOME — or names a MAUDE_UI_PREFS_PATH
// outside one — fails the lane and the e2e app is killed. A process that was already running before the lane and is
// not the lane's own (the person's own Maude) is reported, never killed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const E2E = new URL('../../apps/desktop/e2e/', import.meta.url);
const guard = await import(new URL('helpers/prefs-guard.ts', E2E).href);
const read = (rel) => readFileSync(new URL(rel, E2E), 'utf8');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const exited = (child) =>
  new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once('exit', r)));

test('studio-like: maude-server, server.ts, bun and a `maude --root` studio — nothing else', () => {
  const yes = [
    '/x/Maude.app/Contents/MacOS/maude-server --root /p',
    '/x/Maude.app/Contents/MacOS/maude-server --home',
    'bun --no-env-file /r/apps/studio/server.ts --root /t --port 5',
    '/opt/homebrew/bin/bun test test/x.test.ts',
    '/u/.nvm/versions/node/v24/lib/node_modules/@1agh/maude/node_modules/@1agh/maude-darwin-arm64/maude --root /u/git/p',
  ];
  const no = [
    '/u/.nvm/versions/node/v24/bin/node /r/node_modules/.bin/wdio run ./wdio.conf.ts',
    '/bin/sleep 300',
    '/x/Maude.app/Contents/MacOS/maude-desktop -ApplePersistenceIgnoreState YES',
    '/x/Maude.app/Contents/MacOS/agent-browser --session s',
    'grep bun',
  ];
  for (const c of yes) assert.equal(guard.isStudioLike(c), true, c);
  for (const c of no) assert.equal(guard.isStudioLike(c), false, c);
});

test('the env a process started with is read from its `ps eww` line', () => {
  const line =
    '/x/maude-server --root /p NO_OPEN=1 XDG_CONFIG_HOME=/var/folders/t/maude-e2e-xdg-ab12 HOME=/Users/u PATH=/usr/bin';
  const env = guard.envOf(line);
  assert.equal(env.readable, true);
  assert.equal(env.XDG_CONFIG_HOME, '/var/folders/t/maude-e2e-xdg-ab12');
  assert.equal(env.MAUDE_UI_PREFS_PATH, undefined);
  assert.equal(guard.envOf('/x/bun 5').readable, false);
});

test('isolated = a maude-e2e-* XDG home, and a prefs path (when named) inside one', () => {
  const e2e = join(tmpdir(), 'maude-e2e-xdg-ab12');
  const ok = { readable: true, XDG_CONFIG_HOME: e2e };
  assert.equal(guard.isolationProblem(ok), null);
  assert.equal(
    guard.isolationProblem({ ...ok, MAUDE_UI_PREFS_PATH: join(e2e, 'maude', 'prefs.json') }),
    null
  );
  assert.match(guard.isolationProblem({ readable: true }), /XDG_CONFIG_HOME unset/);
  assert.match(
    guard.isolationProblem({ readable: true, XDG_CONFIG_HOME: join(homedir(), '.config') }),
    /XDG_CONFIG_HOME=/
  );
  assert.match(
    guard.isolationProblem({
      readable: true,
      XDG_CONFIG_HOME: join(tmpdir(), 'v2-lane-config.Ab12'),
    }),
    /XDG_CONFIG_HOME=/
  );
  assert.match(
    guard.isolationProblem({
      ...ok,
      MAUDE_UI_PREFS_PATH: join(homedir(), '.config', 'maude', 'prefs.json'),
    }),
    /MAUDE_UI_PREFS_PATH=/
  );
  assert.match(guard.isolationProblem({ readable: false }), /environment unreadable/);
});

test('the guard’s maude-e2e-* rule is config-home.ts’s (it carries a copy: no relative imports under plain node)', async () => {
  const { isE2eConfigHome } = await import(new URL('helpers/config-home.ts', E2E).href);
  for (const d of [
    join(tmpdir(), 'maude-e2e-xdg-abc'),
    join(tmpdir(), 'maude-e2e-share-roles-x', 'config'),
    join(tmpdir(), 'v2-lane-config.Ab'),
    join(homedir(), '.config'),
    join(homedir(), '.config', 'maude-e2e-sneaky'),
    '',
    undefined,
  ]) {
    assert.equal(guard.isE2eConfigHome(d), isE2eConfigHome(d), String(d));
  }
});

test('the lane owns a descendant of its roots or a process born after it started; anything older is foreign', () => {
  const rows = [
    { pid: 10, ppid: 1, started: 1_000, command: 'node wdio' },
    { pid: 11, ppid: 10, started: 2_000, command: 'maude-desktop' },
    { pid: 12, ppid: 11, started: 3_000, command: 'maude-server --root /p' },
    { pid: 20, ppid: 1, started: 500, command: 'maude --root /mine' },
    { pid: 21, ppid: 1, started: 9_000, command: 'maude-server --root /relaunched' },
  ];
  const owned = guard.laneOwned(rows, { roots: [10], laneStarted: 5_000 });
  assert.deepEqual(
    [...owned].sort((a, b) => a - b),
    [10, 11, 12, 21]
  );
});

test('an environment unreadable for a moment (a process mid-exec) is not an offender; one that stays so is', async () => {
  // r12 pass f1: a sidecar and the fake ACP agent read as unreadable in the sample right after their spawn, and the
  // guard killed two green lanes
  const off = (pid) => ({
    pid,
    ppid: 1,
    command: 'maude-server --root /p',
    why: 'environment unreadable (cannot prove isolation)',
    descendant: true,
  });
  const script = [
    { offenders: [off(1), off(2)], foreign: [] },
    { offenders: [off(2)], foreign: [] }, // 1 became readable (isolated): gone from the sample
    { offenders: [off(2)], foreign: [] },
    { offenders: [off(2)], foreign: [] },
  ];
  let i = 0;
  const seen = [];
  const g = guard.startPrefsGuard({
    roots: [process.pid],
    laneStarted: Date.now(),
    intervalMs: 20,
    sampleImpl: () => script[Math.min(i++, script.length - 1)],
    onOffender: (o) => seen.push(o.pid),
    onForeign: () => {},
  });
  await new Promise((r) => setTimeout(r, 200));
  g.stop();
  assert.deepEqual(seen, [2]);
});

test('a lane that names its own e2e home first still gets prefs/cloud pointers inside an e2e dir (invite-landing)', async () => {
  // r12 pass f1: wdio.invite-landing.conf.ts sets its own maude-e2e-xdg-* home BEFORE it imports wdio.conf, so the
  // base kept the test-lane wrapper's MAUDE_UI_PREFS_PATH (v2-lane-config.*, one dir per JOB) and Home wrote there
  const { e2ePointers } = await import(new URL('helpers/config-home.ts', E2E).href);
  const home = join(tmpdir(), 'maude-e2e-xdg-own');
  const lane = join(tmpdir(), 'v2-lane-config.Ab12');
  const env = {
    XDG_CONFIG_HOME: home,
    MAUDE_UI_PREFS_PATH: join(lane, 'maude', 'prefs.json'),
    MAUDE_CLOUD_CONFIG: join(tmpdir(), 'maude-e2e-invite-x', 'cloud.json'),
  };
  assert.deepEqual(e2ePointers(env), { MAUDE_UI_PREFS_PATH: join(home, 'maude', 'prefs.json') });
  assert.deepEqual(e2ePointers({ XDG_CONFIG_HOME: home }), {});
  assert.deepEqual(
    e2ePointers({
      XDG_CONFIG_HOME: home,
      MAUDE_CLOUD_CONFIG: join(homedir(), '.config', 'maude', 'cloud.json'),
    }),
    { MAUDE_CLOUD_CONFIG: join(home, 'maude', 'cloud.json') }
  );
  assert.match(read('wdio.conf.ts'), /Object\.assign\(process\.env, e2ePointers\(process\.env\)\)/);
});

test('the share-roles world keeps each person’s config in a maude-e2e-* dir', () => {
  const src = readFileSync(new URL('share-roles/stand-up.mjs', E2E), 'utf8');
  assert.doesNotMatch(src, /'maude-share-roles-'/);
  assert.match(src, /mkdtempSync\(join\(tmpdir\(\), 'maude-e2e-share-roles-'\)\)/);
  // each studio spreads process.env: the wrapper's MAUDE_UI_PREFS_PATH would win over its throwaway XDG home
  const at = src.indexOf('async function bootStudio');
  const boot = src.slice(at, src.indexOf('const proc = spawn(', at));
  assert.match(boot, /MAUDE_UI_PREFS_PATH: join\(root, 'config', 'maude', 'prefs\.json'\)/);
});

// ── live: a real process table ─────────────────────────────────────────────────────────────────────────────────────

function fakeBun(dir, name = 'bun') {
  const bin = join(dir, name);
  symlinkSync(process.execPath, bin); // node under a studio-like name: `ps eww` shows its env (a platform binary hides it)
  return bin;
}
const idle = ['-e', 'setTimeout(() => {}, 60_000)'];

test('live: an unisolated studio the lane started is reported within a second; an isolated one is not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-prefs-guard-'));
  const e2eHome = join(dir, 'maude-e2e-xdg-live');
  mkdirSync(e2eHome);
  const bun = fakeBun(dir);
  const base = { PATH: process.env.PATH, HOME: process.env.HOME };
  const bad = spawn(bun, idle, { env: base, stdio: 'ignore' });
  const good = spawn(bun, idle, { env: { ...base, XDG_CONFIG_HOME: e2eHome }, stdio: 'ignore' });
  const seen = [];
  const g = guard.startPrefsGuard({
    roots: [process.pid],
    laneStarted: Date.now() - 60_000,
    intervalMs: 200,
    onOffender: (o) => seen.push(o),
    onForeign: () => {},
  });
  try {
    const end = Date.now() + 5_000;
    while (Date.now() < end && !seen.some((o) => o.pid === bad.pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const hit = seen.find((o) => o.pid === bad.pid);
    assert.ok(hit, 'the unisolated process was reported');
    assert.match(hit.why, /XDG_CONFIG_HOME unset/);
    assert.ok(!seen.some((o) => o.pid === good.pid), 'the isolated process was not reported');
  } finally {
    g.stop();
    bad.kill('SIGKILL');
    good.kill('SIGKILL');
    await Promise.all([exited(bad), exited(good)]);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live: the default action kills the e2e app and fails the launcher (exit 98), never the foreign process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-prefs-guard-'));
  const macos = join(dir, 'Maude.app', 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  const app = join(macos, 'maude-desktop');
  symlinkSync('/bin/sleep', app);
  const bun = fakeBun(dir);
  const base = { PATH: process.env.PATH, HOME: process.env.HOME };
  // foreign: already running before the "lane", not its descendant
  const foreign = spawn(bun, idle, { env: base, stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 1_200)); // ps start times have 1 s resolution
  const launcher = join(dir, 'launcher.mjs');
  writeFileSync(
    launcher,
    `import { spawn } from 'node:child_process';
const g = await import(${JSON.stringify(new URL('helpers/prefs-guard.ts', E2E).href)});
const started = Date.now();
spawn(${JSON.stringify(app)}, ['60'], { stdio: 'ignore' });
setTimeout(() => {
  spawn(${JSON.stringify(bun)}, ${JSON.stringify(idle)}, { env: ${JSON.stringify(base)}, stdio: 'ignore' });
}, 300);
g.startPrefsGuard({ roots: [process.pid], laneStarted: started, intervalMs: 200, appPath: ${JSON.stringify(app)} });
setTimeout(() => process.exit(0), 15_000);
`
  );
  const child = spawn(process.execPath, [launcher], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => (err += c));
  try {
    await exited(child);
    assert.equal(child.exitCode, 98, `launcher exit code (stderr: ${err.slice(-400)})`);
    assert.match(err, /prefs-guard/);
    assert.match(err, /XDG_CONFIG_HOME unset/);
    const { execFileSync } = await import('node:child_process');
    const ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    assert.ok(!ps.includes(app), 'the e2e app was killed');
    assert.ok(alive(foreign.pid), 'the foreign process was left alone');
  } finally {
    foreign.kill('SIGKILL');
    await exited(foreign);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wiring: wdio.conf.ts starts the guard in the launcher, for the whole lane, and completeLane stops it', () => {
  const conf = read('wdio.conf.ts');
  assert.match(conf, /from '\.\/helpers\/prefs-guard'/);
  assert.match(conf, /if \(!process\.env\.WDIO_WORKER_ID\)[\s\S]{0,400}startPrefsGuard\(/);
  const complete = conf.slice(conf.indexOf('export async function completeLane'));
  assert.match(complete.slice(0, 600), /stopPrefsGuard\(\)/);
});
