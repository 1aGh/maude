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

test('the lane owns its roots’ descendants and what carries ITS lane stamp — never a stranger born mid-lane (r13)', () => {
  // the 2026-10-27 V2-8.3 record: another Claude session started the debug bundle's maude-server from its own zsh
  // (91598 → claude 41821) while the default lane ran; "born after the lane started" made it the lane's, and the
  // guard failed the lane (exit 98) on a process the lane never started
  const rows = [
    { pid: 10, ppid: 1, started: 1_000, command: 'node wdio' },
    { pid: 11, ppid: 10, started: 2_000, command: 'maude-desktop' },
    { pid: 12, ppid: 11, started: 3_000, command: 'maude-server --root /p' },
    { pid: 20, ppid: 1, started: 500, command: 'maude --root /mine' },
    { pid: 21, ppid: 1, started: 9_000, command: 'maude-server --root /relaunched' },
    { pid: 41821, ppid: 1, started: 100, command: 'claude' },
    { pid: 91598, ppid: 41821, started: 8_000, command: '/bin/zsh -c x' },
    {
      pid: 91602,
      ppid: 91598,
      started: 8_500,
      command: '/b/maude-server --root /AI-StudyMate --port 4398',
    },
    { pid: 30, ppid: 1, started: 9_500, command: '/b/maude-server --home' },
    { pid: 31, ppid: 30, started: 9_600, command: 'node adapter.js' },
    { pid: 40, ppid: 1, started: 9_700, command: '/b/maude-server --home' },
  ];
  const envs = new Map([
    [30, { readable: true, MAUDE_E2E_LANE_STARTED: '5000' }],
    [40, { readable: true, MAUDE_E2E_LANE_STARTED: '4000' }], // another lane's
  ]);
  const owned = guard.laneOwned(rows, { roots: [10], laneStarted: 5_000 }, envs);
  assert.deepEqual(
    [...owned].sort((a, b) => a - b),
    [10, 11, 12, 30, 31]
  );
});

test('the lane stamp is read from a `ps eww` line', () => {
  const env = guard.envOf(
    '/x/maude-server --home MAUDE_E2E_LANE_STARTED=1761571798000 HOME=/Users/u'
  );
  assert.equal(env.MAUDE_E2E_LANE_STARTED, '1761571798000');
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

// ── A (lead, r12): where prefs actually land — ui-prefs.ts's order, realpath'd, inside a maude-e2e-* dir ──────────
// A stand-in for the person's home (the lane's os.homedir()), so no test touches the real ~/.config.
function world() {
  const base = mkdtempSync(join(tmpdir(), 'r12-guard-a-')); // NOT a maude-e2e-* name
  const realHome = join(base, 'person');
  mkdirSync(join(realHome, '.config', 'maude'), { recursive: true });
  const e2e = join(base, 'maude-e2e-world');
  mkdirSync(e2e, { recursive: true });
  return { base, realHome, e2e, done: () => rmSync(base, { recursive: true, force: true }) };
}
const problem = (w, env) =>
  guard.isolationProblem({ readable: true, ...env }, { realHome: w.realHome });

test('A: the real HOME with no XDG fails', () => {
  const w = world();
  try {
    assert.match(problem(w, { HOME: w.realHome }), /XDG_CONFIG_HOME unset/);
  } finally {
    w.done();
  }
});

test('A: the real HOME with a maude-e2e XDG passes', () => {
  const w = world();
  try {
    assert.equal(problem(w, { HOME: w.realHome, XDG_CONFIG_HOME: join(w.e2e, 'xdg') }), null);
  } finally {
    w.done();
  }
});

test('A: a maude-e2e HOME with no XDG passes (the share-roles cell studio)', () => {
  const w = world();
  try {
    mkdirSync(join(w.e2e, 'cell', 'home'), { recursive: true });
    assert.equal(problem(w, { HOME: join(w.e2e, 'cell', 'home') }), null);
  } finally {
    w.done();
  }
});

test('A: a maude-e2e HOME whose .config is a link to the real ~/.config fails', () => {
  const w = world();
  try {
    const home = join(w.e2e, 'linked-home');
    mkdirSync(home, { recursive: true });
    symlinkSync(join(w.realHome, '.config'), join(home, '.config'));
    assert.match(problem(w, { HOME: home }), /real ~\/\.config/);
  } finally {
    w.done();
  }
});

test('A: MAUDE_UI_PREFS_PATH outside maude-e2e fails even with a maude-e2e XDG', () => {
  const w = world();
  try {
    assert.match(
      problem(w, {
        HOME: join(w.e2e, 'h'),
        XDG_CONFIG_HOME: join(w.e2e, 'xdg'),
        MAUDE_UI_PREFS_PATH: join(w.base, 'v2-lane-config.Ab', 'maude', 'prefs.json'),
      }),
      /MAUDE_UI_PREFS_PATH=/
    );
  } finally {
    w.done();
  }
});

test('A: a cloud or hubs pointer, when set, is held to the same rule', () => {
  const w = world();
  try {
    const ok = { HOME: w.realHome, XDG_CONFIG_HOME: join(w.e2e, 'xdg') };
    assert.equal(problem(w, { ...ok, MAUDE_CLOUD_CONFIG: join(w.e2e, 'cloud.json') }), null);
    assert.match(
      problem(w, { ...ok, HUBS_CONFIG_PATH: join(w.realHome, '.config', 'maude', 'hubs.json') }),
      /HUBS_CONFIG_PATH=/
    );
  } finally {
    w.done();
  }
});

test('a lane config that sets a cloud or hubs pointer makes every temp dir of it under maude-e2e-*', async () => {
  // r12 pass f1: wdio.home.conf.ts kept the app's cloud.json in maude-home-e2e-cloud-* — throwaway, but not a name
  // the guard can tell from a stranger's dir (option A holds cloud/hubs pointers to the prefs rule)
  const { readdirSync } = await import('node:fs');
  const confs = [
    ...readdirSync(new URL('.', E2E)).filter((f) => /^wdio\..*conf\.ts$/.test(f)),
    ...readdirSync(new URL('multiplayer/', E2E))
      .filter((f) => f.endsWith('.conf.ts'))
      .map((f) => `multiplayer/${f}`),
  ];
  const bad = [];
  for (const f of confs) {
    const src = read(f);
    if (!/process\.env\.(MAUDE_CLOUD_CONFIG|HUBS_CONFIG_PATH)\s*=/.test(src)) continue;
    for (const m of src.matchAll(/mkdtempSync\(join\(tmpdir\(\), '([^']+)'\)\)/g))
      if (!m[1].startsWith('maude-e2e-')) bad.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
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

// ── p8-e2e-isolation-r13 ──────────────────────────────────────────────────────────────────────────────────────────
// The 2026-10-27 V2-8.3 record, finding 1: a default-lane sidecar's ACP adapter spawned the person's REAL
// ~/.local/bin/claude (HOME = theirs, so the real keychain). The lane names its own stub in MAUDE_CLAUDE_BIN; any
// other `claude` in a lane-owned tree fails the lane and is killed.

test('a claude invocation is recognised by argv0, a script runner’s argv1, or the CLI entry — a stub named otherwise is not', () => {
  assert.equal(
    guard.claudeInvocation('/Users/u/.local/bin/claude --output-format stream-json --verbose'),
    '/Users/u/.local/bin/claude'
  );
  assert.equal(guard.claudeInvocation('claude auth status'), 'claude');
  assert.equal(
    guard.claudeInvocation('/bin/sh /tmp/maude-e2e-claude-x/claude auth status'),
    '/tmp/maude-e2e-claude-x/claude'
  );
  assert.equal(
    guard.claudeInvocation(
      '/usr/local/bin/node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js -p'
    ),
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'
  );
  assert.equal(
    guard.claudeInvocation('/bin/sh /r/e2e/fixtures/fake-acp/claude-stub.sh auth status'),
    null
  );
  assert.equal(
    guard.claudeInvocation(
      'node /b/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js'
    ),
    null
  );
  assert.equal(guard.claudeInvocation('/x/Maude.app/Contents/MacOS/maude-server --root /p'), null);
});

test('the lane’s claudes: the named stub path, or anything under a named directory', () => {
  const allowed = ['/tmp/maude-e2e-claude-x/claude', undefined, '', '/r/apps/desktop/e2e/fixtures'];
  assert.equal(guard.isLaneClaude('/tmp/maude-e2e-claude-x/claude', allowed), true);
  assert.equal(guard.isLaneClaude('/r/apps/desktop/e2e/fixtures/fake-acp/claude', allowed), true);
  assert.equal(guard.isLaneClaude('/Users/u/.local/bin/claude', allowed), false);
  assert.equal(guard.isLaneClaude('claude', allowed), false);
  assert.equal(guard.isLaneClaude('/r/apps/desktop/e2e/fixtures-evil/claude', allowed), false);
});

const STAMP = '5000';
const iso = {
  readable: true,
  XDG_CONFIG_HOME: '/var/folders/t/maude-e2e-xdg-ab',
  MAUDE_E2E_LANE_STARTED: STAMP,
};
const RECORD_ROWS = [
  { pid: 10, ppid: 1, started: 1_000, command: 'node wdio' },
  { pid: 11, ppid: 10, started: 2_000, command: '/b/Maude.app/Contents/MacOS/maude-desktop' },
  {
    pid: 12,
    ppid: 11,
    started: 3_000,
    command: '/b/Maude.app/Contents/MacOS/maude-server --root /p',
  },
  {
    pid: 13,
    ppid: 12,
    started: 3_100,
    command:
      'node /b/Maude.app/Contents/Resources/apps/studio/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
  },
  {
    pid: 14,
    ppid: 13,
    started: 3_200,
    command:
      '/Users/u/.local/bin/claude --output-format stream-json --verbose --input-format stream-json',
  },
  { pid: 15, ppid: 11, started: 3_000, command: '/b/Maude.app/Contents/MacOS/maude-server --home' },
  {
    pid: 16,
    ppid: 12,
    started: 3_300,
    command: '/bin/sh /tmp/maude-e2e-claude-x/claude auth status',
  },
  // another session's server, same debug bundle, born mid-lane, on the real config
  { pid: 91598, ppid: 1, started: 8_000, command: '/bin/zsh -c x' },
  {
    pid: 91602,
    ppid: 91598,
    started: 8_500,
    command: '/b/Maude.app/Contents/MacOS/maude-server --root /AI-StudyMate --port 4398',
  },
  {
    pid: 91700,
    ppid: 91602,
    started: 8_600,
    command: '/Users/u/.local/bin/claude --output-format stream-json',
  },
];
const RECORD_ENVS = new Map([
  [11, iso],
  [12, iso],
  [13, iso],
  [14, { readable: true, HOME: '/Users/u', MAUDE_E2E_LANE_STARTED: STAMP }],
  [15, iso],
  [16, iso],
  [91602, { readable: true, HOME: '/Users/u' }],
  [91700, { readable: true, HOME: '/Users/u' }],
]);
const classifyRecord = () =>
  guard.classify({
    rows: RECORD_ROWS,
    envs: RECORD_ENVS,
    roots: [10],
    laneStarted: Number(STAMP),
    self: 10,
    laneClaudes: ['/tmp/maude-e2e-claude-x/claude'],
    realHome: '/Users/u',
  });

test('V2-8.3 record: a real claude under the lane’s app is an offender; the lane’s stub is not', () => {
  const { offenders } = classifyRecord();
  const claude = offenders.find((o) => o.pid === 14);
  assert.ok(claude, 'the real claude under the app tree fails the lane');
  assert.match(claude.why, /claude outside the lane's stub/);
  assert.equal(claude.descendant, true);
  assert.ok(!offenders.some((o) => o.pid === 16), 'the stub is the lane’s own');
});

test('V2-8.3 record: another session’s server on the real config is foreign — reported, not an offender', () => {
  const { offenders, foreign } = classifyRecord();
  assert.ok(
    !offenders.some((o) => o.pid === 91602 || o.pid === 91700),
    'never the lane’s to fail on'
  );
  assert.ok(
    foreign.some((o) => o.pid === 91602),
    'still reported'
  );
  assert.ok(!foreign.some((o) => o.pid === 91700), 'a foreign claude is not the lane’s business');
});

test('the kill takes the lane-owned tree — app, sidecars, ACP agent, claude — and nothing foreign', () => {
  const pids = guard.laneKillSet({
    rows: RECORD_ROWS,
    envs: RECORD_ENVS,
    roots: [10],
    laneStarted: Number(STAMP),
    appPath: '/b/Maude.app/Contents/MacOS/maude-desktop',
    offender: { pid: 14, descendant: true },
  });
  assert.deepEqual(
    [...pids].sort((a, b) => a - b),
    [11, 12, 13, 14, 15, 16]
  );
});

test('end-of-lane: orphaned e2e sidecars of the debug bundle (and their agents) are reaped; a live app’s, a person’s and a stranger’s are not', () => {
  const app = '/b/Maude.app/Contents/MacOS/maude-desktop';
  const rows = [
    // earlier lanes: their app died, launchd adopted the sidecars (12:45, 14:58, 15:13)
    { pid: 50, ppid: 1, started: 1, command: '/b/Maude.app/Contents/MacOS/maude-server --home' },
    {
      pid: 51,
      ppid: 1,
      started: 1,
      command: '/b/Maude.app/Contents/MacOS/maude-server --root /fx',
    },
    {
      pid: 52,
      ppid: 51,
      started: 1,
      command:
        'node /b/Maude.app/Contents/Resources/apps/studio/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
    },
    {
      pid: 53,
      ppid: 52,
      started: 1,
      command: '/Users/u/.local/bin/claude --output-format stream-json',
    },
    {
      pid: 54,
      ppid: 1,
      started: 1,
      command:
        'node /b/Maude.app/Contents/Resources/apps/studio/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
    },
    // a live e2e app's sidecar
    {
      pid: 60,
      ppid: 61,
      started: 1,
      command: '/b/Maude.app/Contents/MacOS/maude-server --root /fx',
    },
    { pid: 61, ppid: 1, started: 1, command: app },
    // another session's, orphaned too but never an e2e process
    {
      pid: 70,
      ppid: 1,
      started: 1,
      command: '/b/Maude.app/Contents/MacOS/maude-server --root /AI-StudyMate --port 4398',
    },
    // a person's installed Maude
    {
      pid: 80,
      ppid: 1,
      started: 1,
      command: '/Applications/Maude.app/Contents/MacOS/maude-server --home',
    },
  ];
  const lane = { readable: true, MAUDE_E2E_LANE_STARTED: '1' };
  const envs = new Map([
    [50, lane],
    [51, lane],
    [52, lane],
    [53, lane],
    [54, lane],
    [60, lane],
    [61, lane],
    [70, { readable: true, HOME: '/Users/u' }],
    [80, { readable: true, HOME: '/Users/u' }],
  ]);
  assert.deepEqual(
    [...guard.orphanLaneProcesses(rows, envs, app)].sort((a, b) => a - b),
    [50, 51, 52, 53, 54]
  );
});

test('wiring: wdio.conf.ts names a lane stub in MAUDE_CLAUDE_BIN, hands the guard the lane’s claudes, and completeLane reaps orphaned sidecars', () => {
  const conf = read('wdio.conf.ts');
  assert.match(
    conf,
    /if \(!process\.env\.MAUDE_CLAUDE_BIN\)[\s\S]{0,300}process\.env\.MAUDE_CLAUDE_BIN = stub/
  );
  assert.match(conf, /startPrefsGuard\(\{[\s\S]{0,400}laneClaudes:/);
  const complete = conf.slice(conf.indexOf('export async function completeLane'));
  assert.match(complete.slice(0, 600), /reapOrphanE2eSidecars\(/);
  assert.match(read('wdio.acp-cold-start.conf.ts'), /process\.env\.MAUDE_CLAUDE_BIN = ''/);
});

test('live: a real claude in the lane’s tree fails the lane and the WHOLE tree goes — app, sidecar, claude — never a stranger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-prefs-guard-'));
  const e2eHome = join(dir, 'maude-e2e-xdg-live');
  mkdirSync(e2eHome);
  const macos = join(dir, 'Maude.app', 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  // node under each name: `ps eww` shows its env, and it can spawn children (the app spawns its sidecar + a claude)
  const app = fakeBun(macos, 'maude-desktop');
  const sidecar = fakeBun(macos, 'maude-server');
  const realBin = join(dir, 'home', '.local', 'bin');
  mkdirSync(realBin, { recursive: true });
  const realClaude = fakeBun(realBin, 'claude');
  const stubDir = join(dir, 'maude-e2e-claude-live');
  mkdirSync(stubDir);
  const stub = join(stubDir, 'claude');
  writeFileSync(stub, '#!/bin/sh\necho x\n', { mode: 0o755 });
  const lane = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: e2eHome,
    MAUDE_CLAUDE_BIN: stub,
  };
  // a stranger: the same bundle's maude-server, started outside the lane, on an isolated config so only ancestry decides
  const stranger = spawn(sidecar, idle, { env: lane, stdio: 'ignore', detached: true });
  const pidsFile = join(dir, 'pids.json');
  const launcher = join(dir, 'launcher.mjs');
  writeFileSync(
    launcher,
    `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const g = await import(${JSON.stringify(new URL('helpers/prefs-guard.ts', E2E).href)});
const started = Date.now();
process.env.MAUDE_E2E_LANE_STARTED = String(started);
const appCode = \`
const { spawn } = require('node:child_process');
const s = spawn(${JSON.stringify(sidecar)}, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
setTimeout(() => {
  const c = spawn(${JSON.stringify(realClaude)}, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  require('node:fs').writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ app: process.pid, sidecar: s.pid, claude: c.pid }));
}, 400);
setTimeout(() => {}, 60000);
\`;
spawn(${JSON.stringify(app)}, ['-e', appCode], { stdio: 'ignore' });
g.startPrefsGuard({ roots: [process.pid], laneStarted: started, intervalMs: 200, appPath: ${JSON.stringify(app)},
  laneClaudes: () => [process.env.MAUDE_CLAUDE_BIN] });
setTimeout(() => process.exit(0), 15_000);
`
  );
  const child = spawn(process.execPath, [launcher], {
    env: lane,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (c) => (err += c));
  try {
    await exited(child);
    assert.equal(child.exitCode, 98, `launcher exit code (stderr: ${err.slice(-400)})`);
    assert.match(err, /claude outside the lane's stub/);
    const pids = JSON.parse(readFileSync(pidsFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    for (const k of ['app', 'sidecar', 'claude'])
      assert.ok(!alive(pids[k]), `${k} (${pids[k]}) was killed`);
    assert.ok(alive(stranger.pid), 'the stranger from the same bundle was left alone');
  } finally {
    stranger.kill('SIGKILL');
    await exited(stranger);
    rmSync(dir, { recursive: true, force: true });
  }
});
