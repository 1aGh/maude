// server-up.sh must not respawn a studio that is alive but slow to answer.
//
// 2026-10-28: on a loaded Mac the liveness probe (`curl --max-time 2` on /_health) timed out against a healthy,
// running studio (studyfi-design, the design.studyfi.com sync). server-up called it stale, deleted _server.json and
// started a second instance, and the first one ended: the person's open studio and its sync went down twice in one
// morning. A probe that TIMES OUT means something is listening; only a refused connection or a wrong identity is
// stale.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const SERVER_UP = new URL('../../apps/studio/bin/server-up.sh', import.meta.url).pathname;

function world() {
  const root = mkdtempSync(join(tmpdir(), 'server-up-busy-'));
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.design'), { recursive: true });
  // a stand-in for the compiled binary (the allowlist wants maude-<slug>/maude); it only records that it ran
  const binDir = join(root, 'maude-test-arm64');
  mkdirSync(binDir);
  const marker = join(root, 'spawned');
  const bin = join(binDir, 'maude');
  writeFileSync(bin, `#!/bin/sh\necho "$@" > '${marker}'\n`);
  chmodSync(bin, 0o755);
  return { root, repo, marker, bin, done: () => rmSync(root, { recursive: true, force: true }) };
}

// A fake studio: answers /_health as the design server for `repo`, after `delayMs`.
function fakeStudio(repo, { delayMs, app = 'design' }) {
  const rootId = createHash('sha256').update(realpathSync(repo)).digest('hex').slice(0, 12);
  const src = `
    const http = require('node:http');
    const s = http.createServer((q, r) => setTimeout(() => {
      r.setHeader('content-type', 'application/json');
      r.end(JSON.stringify({ ok: true, app: ${JSON.stringify(app)}, pid: process.pid, rootId: ${JSON.stringify(rootId)} }));
    }, ${delayMs}));
    s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) =>
    child.stdout.once('data', (d) => resolve({ child, port: Number(String(d).trim()) }))
  );
}

function serverUp(w, extra = []) {
  return spawnSync('bash', [SERVER_UP, '--root', w.repo, '--timeout', '2', ...extra], {
    encoding: 'utf8',
    env: { ...process.env, MAUDE_DEV_SERVER_BIN: w.bin, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1' },
    timeout: 60_000,
  });
}

test('a live studio that answers /_health slower than 2 s is kept, not respawned', async () => {
  const w = world();
  const { child, port } = await fakeStudio(w.repo, { delayMs: 3500 });
  try {
    const state = join(w.repo, '.design', '_server.json');
    writeFileSync(state, JSON.stringify({ pid: child.pid, port }));
    const r = serverUp(w);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), String(port));
    assert.equal(existsSync(w.marker), false, `a second instance was started:\n${r.stderr}`);
    assert.equal(existsSync(state), true, '_server.json of the running studio was deleted');
  } finally {
    child.kill();
    w.done();
  }
});

test('a dead pid with nothing listening is still stale: respawn', async () => {
  const w = world();
  try {
    const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    writeFileSync(
      join(w.repo, '.design', '_server.json'),
      JSON.stringify({ pid: Number(gone.stdout.trim()), port: 1 })
    );
    serverUp(w);
    assert.equal(existsSync(w.marker), true, 'a stale _server.json did not start the server');
  } finally {
    w.done();
  }
});

test('a live pid whose port answers as something else (pid or port reused) is stale: respawn', async () => {
  const w = world();
  const { child, port } = await fakeStudio(w.repo, { delayMs: 0, app: 'not-design' });
  try {
    writeFileSync(join(w.repo, '.design', '_server.json'), JSON.stringify({ pid: child.pid, port }));
    serverUp(w);
    assert.equal(existsSync(w.marker), true, 'an impostor on the port was taken for the studio');
  } finally {
    child.kill();
    w.done();
  }
});

test('a listener that never answers is reported, and no second instance is started', async () => {
  const w = world();
  const { child, port } = await fakeStudio(w.repo, { delayMs: 60_000 });
  try {
    const state = join(w.repo, '.design', '_server.json');
    writeFileSync(state, JSON.stringify({ pid: child.pid, port }));
    const r = serverUp(w);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /not starting a second one/);
    assert.equal(existsSync(w.marker), false, 'a second instance was started');
    assert.equal(existsSync(state), true);
  } finally {
    child.kill();
    w.done();
  }
});

// 2026-10-28, the same studio again: server-up started the server with `nohup … &`, so it stayed in the CALLER's
// process group. An agent's shell tool that times out or is stopped signals its whole group — and the person's
// studio got SIGTERM ("Stopping…") with nobody having asked for it. The server must live in its own session.
test('the started server survives a signal to the process group that ran server-up', async () => {
  const w = world();
  const pidFile = join(w.root, 'server.pid');
  writeFileSync(w.bin, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 300\n`);
  const caller = spawn('bash', [SERVER_UP, '--root', w.repo, '--timeout', '1'], {
    detached: true, // its own group, standing in for the agent's shell
    stdio: 'ignore',
    env: { ...process.env, MAUDE_DEV_SERVER_BIN: w.bin, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1' },
  });
  const group = caller.pid;
  await new Promise((r) => caller.once('exit', r));
  for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    try {
      process.kill(-group, 'SIGTERM');
    } catch {} // the group may already be empty — that is the fix
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(alive(), true, 'the studio died with the shell that started it');
  } finally {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
    w.done();
  }
});
