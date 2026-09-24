// Cloud Phase 27 A1 — the studio is a supervised child, and a dead child is
// visible. Every side effect is injected: the failure modes worth asserting
// (crash-loop backoff, never-ready, a stop that flushes) are the ones a real
// child makes slow and flaky to reproduce.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { BACKOFF_MS, childEnv, createStudioChild, studioLaunch } from '../src/studio-child.mjs';

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.killed = [];
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
  kill(sig) {
    this.killed.push(sig);
    // A real SIGTERM eventually produces an exit; the tests that care drive it
    // explicitly, so this only records.
  }
}

/** A harness with a controllable clock and spawn. */
function harness({ ready = true, entry = __filename, probe, ...rest } = {}) {
  const spawned = [];
  const timers = [];
  let pid = 100;
  const child = createStudioChild({
    env: { MAUDE_STUDIO_SRC: null, MAUDE_REPO_DIR: '/repo', PATH: '/bin' },
    port: 4399,
    ...rest,
    spawn: (bin, args, opts) => {
      const proc = new FakeChild(pid++);
      spawned.push({ bin, args, opts, proc });
      return proc;
    },
    probe: probe ?? (async () => ready),
    setTimer: (fn, ms) => {
      const t = { fn, ms, unref: () => t };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t);
      if (i !== -1) timers.splice(i, 1);
    },
    log: { log() {}, error() {} },
  });
  // The entry probe uses the real filesystem; point it at a file that exists so
  // launch() proceeds. `studioEntry` falls back to cwd-relative candidates.
  return { child, spawned, timers, entry };
}

const __filename = new URL(import.meta.url).pathname;

test('the child environment is minimal and carries no hub secret', () => {
  const env = childEnv(
    {
      PATH: '/bin',
      HOME: '/home/node',
      HUB_SECRET: 'do-not-leak',
      MAUDE_PROJECT_TOKEN_KEY: 'also-not',
      AWS_SECRET_ACCESS_KEY: 'definitely-not',
      MAUDE_REPO_DIR: '/repo',
      HUB_PUBLIC_URL: 'https://alligators.cloud.maude.sh',
    },
    { port: 4399 }
  );
  assert.equal(env.HUB_SECRET, undefined);
  assert.equal(env.MAUDE_PROJECT_TOKEN_KEY, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.MAUDE_WORKSPACE_MODE, '1');
  assert.equal(env.PORT, '4399');
  assert.equal(env.MAUDE_REPO_DIR, '/repo');
  // D4 — the studio is TOLD its public identity.
  assert.equal(env.HUB_PUBLIC_URL, 'https://alligators.cloud.maude.sh');
});

test('the cell pins the studio to the same git engine the hub uses', () => {
  // Cloud Phase 27 D2, and the prerequisite for every lock in the container
  // meaning anything: the studio's write paths default to isomorphic-git, which
  // keeps an in-PROCESS lock and writes `.git/index` directly — it never takes
  // `.git/index.lock` and never notices one. The hub shells out to system git,
  // which does. Two engines over one index is not a race a careful caller can
  // avoid; it is two programs writing the same file.
  const env = childEnv({ PATH: '/bin' }, { port: 4399 });
  assert.equal(env.MAUDE_USE_SYSTEM_GIT, '1');
});

test('live pairing is off unless the hub minted a credential for it', () => {
  const env = childEnv({ PATH: '/bin', MAUDE_REPO_DIR: '/repo' }, { port: 4399 });
  assert.equal(env.MAUDE_CELL_PAIRING, undefined);
  assert.equal(env.MAUDE_LOOPBACK_SYNC_URL, undefined);
  assert.equal(env.MAUDE_LOOPBACK_SYNC_TOKEN, undefined);
  // And crucially not shared-doc / no-autocommit either: those are meaningless
  // without a provider, and setting them anyway would make a later bug look
  // like a configuration that had been asked for.
  assert.equal(env.MAUDE_SHARED_DOC, undefined);
  assert.equal(env.MAUDE_SYNC_NO_AUTOCOMMIT, undefined);
});

test('a minted loopback credential turns pairing on, with its conditions attached', () => {
  const env = childEnv(
    {
      PATH: '/bin',
      MAUDE_LOOPBACK_SYNC_URL: 'http://127.0.0.1:1234',
      MAUDE_LOOPBACK_SYNC_TOKEN: 'minted',
      MAUDE_HUB_NAMESPACED: '1',
    },
    { port: 4399 }
  );
  assert.equal(env.MAUDE_CELL_PAIRING, '1');
  assert.equal(env.MAUDE_LOOPBACK_SYNC_URL, 'http://127.0.0.1:1234');
  assert.equal(env.MAUDE_LOOPBACK_SYNC_TOKEN, 'minted');
  // The two conditions that make pairing safe travel WITH it, asserted here
  // rather than passed through — they are not settings anybody should vary.
  assert.equal(env.MAUDE_SHARED_DOC, '1');
  assert.equal(env.MAUDE_SYNC_NO_AUTOCOMMIT, '1');
  // The child must compute the same wire document name as the desktop peer it
  // is meant to meet; a mismatch is two people editing two documents.
  assert.equal(env.MAUDE_HUB_NAMESPACED, '1');
  // Still no secret — pairing does not widen the minimal environment.
  assert.equal(env.HUB_SECRET, undefined);
});

test('a non-loopback pairing URL is refused at the EMITTING end too', () => {
  // The studio refuses it on receipt. This refuses to hand it over. Either
  // alone would do on a good day; the pair is what keeps "a cell never dials
  // out" (DDR-209) true when one side is edited by somebody who has not read
  // the other.
  for (const url of ['https://hub.example.com', 'http://10.0.0.5:1234', 'not-a-url']) {
    const env = childEnv(
      { PATH: '/bin', MAUDE_LOOPBACK_SYNC_URL: url, MAUDE_LOOPBACK_SYNC_TOKEN: 'minted' },
      { port: 4399 }
    );
    assert.equal(env.MAUDE_CELL_PAIRING, undefined, url);
    assert.equal(env.MAUDE_LOOPBACK_SYNC_TOKEN, undefined, url);
  }
});

test('the bug-report endpoint override actually reaches the studio', () => {
  // The studio's own comment promises self-hosters can point Report-a-Bug
  // somewhere other than the vendor's endpoint via MAUDE_REPORT_URL. Inside a
  // hub that promise was false: the allowlist did not carry the variable, so
  // the child fell back to cloud.maude.sh/report no matter what the operator
  // configured. An allowlist is only as true as its entries.
  const off = childEnv({ PATH: '/bin' }, { port: 4399 });
  assert.equal(off.MAUDE_REPORT_URL, undefined);

  const on = childEnv(
    { PATH: '/bin', MAUDE_REPORT_URL: 'https://reports.internal.example/report' },
    { port: 4399 }
  );
  assert.equal(on.MAUDE_REPORT_URL, 'https://reports.internal.example/report');
});

test('the embed allowlist reaches the studio, which frames with it (DDR-242)', () => {
  const off = childEnv({ PATH: '/bin' }, { port: 4399 });
  assert.equal(off.MAUDE_EMBED_ORIGINS, undefined);
  const on = childEnv(
    { PATH: '/bin', MAUDE_EMBED_ORIGINS: 'https://orbit.studyfi.com' },
    { port: 4399 }
  );
  assert.equal(on.MAUDE_EMBED_ORIGINS, 'https://orbit.studyfi.com');
});

test('the child environment never grows a wildcard', () => {
  // The whole guarantee is "an allowlist, not a spread". A future edit adding
  // `...env` would pass every other test in this file.
  const env = childEnv({ PATH: '/bin', SOMETHING_NEW: 'x' }, { port: 1 });
  assert.equal(env.SOMETHING_NEW, undefined);
});

test('a supervisor that has never started is idle, not restarting', () => {
  const { child } = harness({ ready: false });
  assert.equal(child.status().ok, false);
  // 'restarting' would send whoever reads /health looking for a crash that
  // never happened.
  assert.equal(child.status().state, 'idle');
});

test('an exit schedules a restart on the backoff ladder', () => {
  const { child, spawned, timers } = harness();
  child.start();
  assert.equal(spawned.length, 1, 'the child was not spawned');
  const first = spawned[0].proc;
  first.emit('exit', 1, null);
  assert.equal(child.status().ok, false);
  assert.equal(child.status().state, 'restarting');
  assert.equal(child.status().lastExit.code, 1);
  const scheduled = timers.filter((t) => BACKOFF_MS.includes(t.ms));
  assert.ok(scheduled.length >= 1, 'no restart was scheduled');
  assert.equal(scheduled[0].ms, BACKOFF_MS[0]);
});

test('repeated crashes back off rather than spinning', () => {
  const { child, spawned, timers } = harness();
  child.start();
  const delays = [];
  for (let i = 0; i < 4; i++) {
    spawned.at(-1).proc.emit('exit', 1, null);
    const t = timers.filter((x) => BACKOFF_MS.includes(x.ms)).at(-1);
    delays.push(t.ms);
    t.fn(); // fire the restart immediately
  }
  assert.deepEqual(delays, BACKOFF_MS.slice(0, 4));
});

test('stop() asks politely first', async () => {
  const { child, spawned, timers } = harness();
  child.start();
  const proc = spawned[0].proc;
  const stopping = child.stop();
  assert.deepEqual(proc.killed, ['SIGTERM']);
  proc.emit('exit', 0, 'SIGTERM');
  await stopping;
  assert.equal(child.status().state, 'stopped');
  // And a stopped supervisor does not resurrect it.
  const before = spawned.length;
  for (const t of timers) t.fn?.();
  assert.equal(spawned.length, before);
});

test('a compiled studio takes NO entry argument', () => {
  // The mistake this rules out: handing `server.ts` to a `bun build --compile`
  // binary, which treats it as a positional arg rather than an entry. It boots,
  // it looks fine, and it serves the wrong root.
  const plan = studioLaunch({ MAUDE_STUDIO_BIN: __filename });
  assert.equal(plan.kind, 'binary');
  assert.equal(plan.cmd, __filename);
  assert.deepEqual(plan.args, []);
});

test('a dev checkout runs the SOURCE entry under bun', () => {
  const studioSrc = join(dirname(dirname(dirname(__filename))), 'studio');
  const plan = studioLaunch({ MAUDE_STUDIO_SRC: studioSrc, MAUDE_BUN_PATH: '/bin/bun' });
  assert.equal(plan.kind, 'source');
  assert.equal(plan.cmd, '/bin/bun');
  assert.deepEqual(plan.args, [join(studioSrc, 'server.ts')]);
});

test('a MAUDE_STUDIO_BIN that is not there is never launched', () => {
  // The failure this rules out: a typo'd or unstaged binary path being spawned
  // anyway, so the supervisor crash-loops on ENOENT instead of falling back to
  // the source shape that is sitting right there.
  const plan = studioLaunch({ MAUDE_STUDIO_BIN: '/nope/maude-server' });
  assert.notEqual(plan?.cmd, '/nope/maude-server');
});

test('status() names the port a proxy should forward to', () => {
  const { child } = harness();
  assert.equal(child.port, 4399);
  assert.equal(child.status().port, 4399);
});

// ------------------------------------------------- D5: healthy, wrong project

const tick = () => new Promise((r) => setImmediate(r));

test('a child answering about the WRONG tree is never marked ready', async () => {
  // The one failure a liveness probe cannot see, and the one a customer would
  // notice first: something answers 200, and it is not their project. "Boots,
  // looks fine, serves the wrong root" is the mistake `studioLaunch` warns
  // about; this is the check that makes it visible instead of served.
  const { child, spawned } = harness({
    expectedRootId: 'aaaaaaaaaaaa',
    probe: async () => ({ ok: true, rootId: 'bbbbbbbbbbbb', project: 'someone else' }),
  });
  child.start();
  await tick();
  const status = child.status();
  assert.equal(status.ok, false, 'the cell must not report healthy');
  assert.equal(status.state, 'wrong-project');
  assert.deepEqual(
    { expected: status.wrongProject.expected, actual: status.wrongProject.actual },
    { expected: 'aaaaaaaaaaaa', actual: 'bbbbbbbbbbbb' }
  );
  // Killed, not accepted — and the exit handler owns the retry, because the
  // tree can still become the right one (a rehydrate finishing late).
  assert.deepEqual(spawned[0].proc.killed, ['SIGKILL']);
});

test('the matching tree is ready, and clears a previous mismatch', async () => {
  let rootId = 'bbbbbbbbbbbb';
  const { child, spawned, timers } = harness({
    expectedRootId: 'aaaaaaaaaaaa',
    probe: async () => ({ ok: true, rootId }),
  });
  child.start();
  await tick();
  assert.equal(child.status().state, 'wrong-project');

  // The rehydrate lands; the restart brings up a studio on the right tree.
  rootId = 'aaaaaaaaaaaa';
  spawned[0].proc.emit('exit', null, 'SIGKILL');
  timers
    .filter((t) => BACKOFF_MS.includes(t.ms))
    .at(-1)
    .fn();
  await tick();
  const status = child.status();
  assert.equal(status.ok, true);
  assert.equal(status.state, 'ready');
  assert.equal(status.wrongProject, undefined);
});

test('no expectation, or a studio too old to answer with one, still boots', async () => {
  // Two shapes that must not fail closed: a dev checkout with nothing
  // meaningful to compare against, and a studio whose /_health predates the
  // field. Refusing either would take a cell down over a check that never
  // ran.
  for (const [expectedRootId, verdict] of [
    [null, { ok: true, rootId: 'bbbbbbbbbbbb' }],
    ['aaaaaaaaaaaa', { ok: true }],
    ['aaaaaaaaaaaa', true],
  ]) {
    const { child } = harness({ expectedRootId, probe: async () => verdict });
    child.start();
    await tick();
    assert.equal(child.status().ok, true, JSON.stringify({ expectedRootId, verdict }));
  }
});
