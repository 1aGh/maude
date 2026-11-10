// #206 T6.3d (contract 206-cli-reuses-desktop.md §3, §4, §9; DDR-250) — the CLI finds the desktop
// app's server for a project through the app-owned registry and believes a port only after a
// challenge-response against `/_api/shell/attest`. A planted `_server.json` never wins while the
// registry names the root; a forged MAC, a dead app pid or a registry anyone else could write is
// refused. Every test points MAUDE_APP_REGISTRY_FILE at a temp dir: the real app data dir is never
// read or written.
//
// Run: node --test cli/lib/desktop-locate.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  apiKeyFor,
  appDataRegistryPath,
  cleanName,
  ensureDesktop,
  isAppPid,
  locateDesktop,
  probeDesktop,
  readRegistry,
  registryPath,
  serverKeyDir,
  terminalKeyFor,
} from './desktop-locate.mjs';
import { postStudio, probeStudio, studioHeaders } from './studio-locate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = 'ab'.repeat(32);
const WRONG = 'cd'.repeat(32);
const REAL_APP_DIR = join(homedir(), 'Library', 'Application Support', 'com.maude.app');

const rootIdOf = (root) =>
  createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 12);
const mac = (key, n, rootId, port) =>
  createHmac('sha256', key).update(`maude-attest/1\n${n}\n${rootId}\n${port}`).digest('hex');

const dirs = [];
const closers = [];
function scratch() {
  // short: a unix socket path is capped near 104 bytes on macOS
  const d = mkdtempSync(join(tmpdir(), 'mdl-'));
  dirs.push(d);
  return d;
}
function project() {
  const root = realpathSync(scratch());
  mkdirSync(join(root, '.design'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), '{}');
  return root;
}

/** A stand-in server: attest answered with `key` for `rootId` at its own port; /_health as a studio. */
function fakeServer({ key = KEY, rootId, health = {}, slowAttests = 0, slowMs = 0 } = {}) {
  return new Promise((res) => {
    const seen = [];
    const posts = [];
    const keys = [];
    const srv = createServer((req, resp) => {
      const u = new URL(req.url, 'http://x');
      seen.push(u.pathname);
      keys.push(req.headers['x-maude-api-key'] ?? null);
      const port = srv.address().port;
      resp.setHeader('content-type', 'application/json');
      if (u.pathname === '/_api/shell/attest') {
        const n = u.searchParams.get('n') ?? '';
        if (!/^[0-9a-f]{32}$/.test(n)) {
          resp.statusCode = 400;
          return resp.end('{}');
        }
        const answer = () => resp.end(JSON.stringify({ mac: mac(key, n, rootId, port) }));
        // a server under load (an export, a boot): the first `slowAttests` answers come late
        if (seen.filter((x) => x === '/_api/shell/attest').length <= slowAttests)
          return void setTimeout(answer, slowMs);
        return answer();
      }
      if (u.pathname === '/_api/ui/open' && req.method === 'POST') {
        let b = '';
        req.on('data', (d) => (b += d));
        req.on('end', () => {
          posts.push(JSON.parse(b));
          resp.end(JSON.stringify({ open: JSON.parse(b) }));
        });
        return;
      }
      if (u.pathname === '/_health')
        return resp.end(
          JSON.stringify({ ok: true, app: 'design', pid: process.pid, rootId, ...health })
        );
      resp.statusCode = 404;
      resp.end('{}');
    });
    srv.listen(0, '127.0.0.1', () => {
      closers.push(() => new Promise((r) => srv.close(() => r())));
      res({ port: srv.address().port, seen, posts, keys });
    });
  });
}

/** A stand-in app socket: answers each request with `reply(req)`; records the requests. */
function fakeSocket(path, reply) {
  return new Promise((res) => {
    const reqs = [];
    const srv = createNetServer((c) => {
      let buf = '';
      c.setEncoding('utf8');
      c.on('data', async (d) => {
        buf += d;
        if (!buf.includes('\n')) return;
        const req = JSON.parse(buf.trim());
        reqs.push(req);
        const r = await reply(req, reqs.length);
        c.end(JSON.stringify(r));
      });
    });
    srv.listen(path, () => {
      closers.push(() => new Promise((r) => srv.close(() => r())));
      res({ reqs });
    });
  });
}

function writeRegistry(file, servers, { appPid = process.pid, v = 1, mode = 0o600 } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      v,
      app: { pid: appPid, version: '2.0.0', socket: join(dirname(file), 'cli.sock'), started: 'x' },
      servers,
    })
  );
  chmodSync(file, mode);
}

const running = (root, port, attestKey = KEY, extra = {}) => ({
  root,
  rootId: rootIdOf(root),
  label: 'p-l0123456789abcdef',
  state: 'running',
  port,
  pid: process.pid,
  attestKey,
  profile: 'default',
  kind: 'project',
  busy: false,
  ...extra,
});

function plantServerJson(root, port) {
  writeFileSync(
    join(root, '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port, url: `http://127.0.0.1:${port}/` })
  );
}

function deadPid() {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

let REG_DIR;
let REG;
const env = () => ({ ...process.env, MAUDE_APP_REGISTRY_FILE: REG });
before(() => {
  REG_DIR = scratch();
  REG = join(REG_DIR, 'servers.json');
  // studio-locate reads process.env: point it at the fake registry for the whole file
  process.env.MAUDE_APP_REGISTRY_FILE = REG;
});
after(async () => {
  for (const c of closers) await c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const reset = () => {
  rmSync(REG, { force: true });
  rmSync(join(REG_DIR, 'cli.sock'), { force: true });
};

describe('registryPath', () => {
  test('the override wins; the platform default is only computed, never created', () => {
    assert.equal(registryPath({ MAUDE_APP_REGISTRY_FILE: '/x/servers.json' }), '/x/servers.json');
    assert.equal(
      appDataRegistryPath({}, 'darwin', '/home/u'),
      '/home/u/Library/Application Support/com.maude.app/servers.json'
    );
    assert.equal(
      appDataRegistryPath({ XDG_DATA_HOME: '/d' }, 'linux', '/home/u'),
      '/d/com.maude.app/servers.json'
    );
  });

  test('under a test runner only an explicit override counts (never the person’s running Maude)', () => {
    assert.equal(registryPath({}, 'darwin', '/h'), null); // node --test sets NODE_TEST_CONTEXT
    assert.equal(registryPath({ NODE_ENV: 'test' }, 'darwin', '/h'), null);
    // a relative override is ignored, never resolved against the cwd
    assert.equal(registryPath({ MAUDE_APP_REGISTRY_FILE: 'rel.json' }, 'darwin', '/h'), null);
  });
});

describe('readRegistry refuses what the app did not write', () => {
  test('group/world writable, oversize, wrong v, no app pid, a symlink', () => {
    const root = project();
    const ok = [running(root, 4000)];
    reset();
    writeRegistry(REG, ok);
    assert.ok(readRegistry(REG));
    writeRegistry(REG, ok, { mode: 0o620 });
    assert.equal(readRegistry(REG), null, 'group-writable');
    writeRegistry(REG, ok, { mode: 0o602 });
    assert.equal(readRegistry(REG), null, 'world-writable');
    writeRegistry(REG, ok, { v: 2 });
    assert.equal(readRegistry(REG), null, 'wrong v');
    writeRegistry(REG, ok, { appPid: 0 });
    assert.equal(readRegistry(REG), null, 'no app pid');
    writeFileSync(REG, `{"v":1,"app":{"pid":1},"servers":[],"pad":"${'x'.repeat(1024 * 1024)}"}`);
    chmodSync(REG, 0o600);
    assert.equal(readRegistry(REG), null, 'over 1 MiB');
    const other = join(scratch(), 'real.json');
    writeRegistry(other, ok);
    rmSync(REG, { force: true });
    symlinkSync(other, REG);
    assert.equal(readRegistry(REG), null, 'a symlink');
    reset();
  });

  test('a running entry with no key or no port is not running', () => {
    const root = project();
    reset();
    writeRegistry(REG, [{ ...running(root, 4000), attestKey: undefined }]);
    assert.equal(readRegistry(REG).servers[0].state, 'starting');
    reset();
  });
});

describe('locateDesktop', () => {
  test('an attested app server for this root → its port, label and kind', async () => {
    const root = project();
    const s = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, s.port)]);
    assert.deepEqual(await locateDesktop(root, { env: env() }), {
      port: s.port,
      label: 'p-l0123456789abcdef',
      kind: 'project',
    });
    reset();
  });

  test('a forged MAC (wrong key) → null, and the state says unverified', async () => {
    const root = project();
    const s = await fakeServer({ key: WRONG, rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, s.port)]);
    assert.equal(await locateDesktop(root, { env: env() }), null);
    assert.equal((await probeDesktop(root, { env: env() })).state, 'unverified');
    reset();
  });

  test('a MAC for another root or another port → null', async () => {
    const root = project();
    const other = project();
    const s = await fakeServer({ rootId: rootIdOf(other) });
    reset();
    writeRegistry(REG, [running(root, s.port)]);
    assert.equal(await locateDesktop(root, { env: env() }), null);
    reset();
  });

  test('a dead app pid → no-app', async () => {
    const root = project();
    const s = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, s.port)], { appPid: deadPid() });
    assert.equal(await locateDesktop(root, { env: env() }), null);
    assert.equal((await probeDesktop(root, { env: env() })).state, 'no-app');
    reset();
  });

  test('an entry for another root is not this root', async () => {
    const root = project();
    const other = project();
    const s = await fakeServer({ rootId: rootIdOf(other) });
    reset();
    writeRegistry(REG, [running(other, s.port)]);
    assert.equal((await probeDesktop(root, { env: env() })).state, 'absent');
    reset();
  });
});

describe('studio-locate asks the app first', () => {
  test('a planted _server.json + a registry naming another port → the registry wins', async () => {
    const root = project();
    const app = await fakeServer({ rootId: rootIdOf(root) });
    const planted = await fakeServer({ rootId: rootIdOf(root) }); // echoes pid + rootId
    reset();
    writeRegistry(REG, [running(root, app.port)]);
    plantServerJson(root, planted.port);
    const r = await probeStudio(root, { timeoutMs: 1500 });
    assert.equal(r.studio?.port, app.port);
    assert.equal(planted.seen.length, 0, 'the planted listener is never contacted');
    reset();
  });

  test('the registry names this root but the MAC is forged → no studio, _server.json ignored', async () => {
    const root = project();
    const app = await fakeServer({ key: WRONG, rootId: rootIdOf(root) });
    const planted = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, app.port)]);
    plantServerJson(root, planted.port);
    const r = await probeStudio(root, { timeoutMs: 1500 });
    assert.equal(r.studio, undefined);
    assert.equal(planted.seen.length, 0);
    reset();
  });

  test('no app running → today’s _server.json + /_health rootId path', async () => {
    const root = project();
    const own = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    plantServerJson(root, own.port);
    const r = await probeStudio(root, { timeoutMs: 1500 });
    assert.equal(r.studio?.port, own.port);
    reset();
  });
});

describe('the app socket (ensure / show)', () => {
  test('resting → ensure over the socket → running, attested', async () => {
    const root = project();
    const s = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [{ root, rootId: rootIdOf(root), state: 'resting', kind: 'project' }]);
    const sock = await fakeSocket(join(REG_DIR, 'cli.sock'), () => {
      writeRegistry(REG, [running(root, s.port)]); // the app woke the tab
      return { status: 'running', port: s.port, label: 'p-l0123456789abcdef' };
    });
    assert.equal((await probeDesktop(root, { env: env() })).state, 'resting');
    const r = await ensureDesktop(root, { env: env() });
    assert.equal(r.state, 'running');
    assert.equal(r.port, s.port);
    assert.equal(sock.reqs[0].v, 1);
    assert.equal(sock.reqs[0].op, 'ensure');
    assert.equal(sock.reqs[0].root, root);
    assert.equal(sock.reqs[0].purpose, 'capture');
    reset();
  });

  test('the socket names a port that does not attest → fallback', async () => {
    const root = project();
    const s = await fakeServer({ key: WRONG, rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, s.port)]);
    await fakeSocket(join(REG_DIR, 'cli.sock'), () => ({ status: 'running', port: s.port }));
    const r = await ensureDesktop(root, { env: env(), timeoutMs: 300 });
    assert.equal(r.state, 'fallback');
    assert.equal(r.reason, 'unverified');
    reset();
  });

  test('consent → status poll → running', async () => {
    const root = project();
    const s = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, []);
    const sock = await fakeSocket(join(REG_DIR, 'cli.sock'), (req, n) => {
      if (req.op === 'ensure') return { status: 'consent', ticket: 't1' };
      if (n < 3) return { status: 'consent', ticket: 't1' };
      writeRegistry(REG, [running(root, s.port)]);
      return { status: 'running', port: s.port };
    });
    const lines = [];
    const r = await ensureDesktop(root, { env: env(), pollMs: 20, log: (l) => lines.push(l) });
    assert.equal(r.state, 'running');
    assert.deepEqual(
      sock.reqs.map((q) => q.op),
      ['ensure', 'status', 'status']
    );
    assert.equal(sock.reqs[1].ticket, 't1');
    assert.equal(lines.length, 1, 'the consent line is printed once');
    reset();
  });

  test('cap-full → fallback with the one line; branch-changed-unsent → refused', async () => {
    const root = project();
    reset();
    writeRegistry(REG, []);
    let next = { status: 'cap-full' };
    await fakeSocket(join(REG_DIR, 'cli.sock'), () => next);
    const a = await ensureDesktop(root, { env: env() });
    assert.equal(a.state, 'fallback');
    assert.match(a.line, /3 busy projects/);
    next = { status: 'refused', reason: 'branch-changed-unsent' };
    const b = await ensureDesktop(root, { env: env() });
    assert.equal(b.state, 'refused');
    reset();
  });

  test('too many sheets → fallback with a line that says what to do', async () => {
    const root = project();
    reset();
    writeRegistry(REG, []);
    await fakeSocket(join(REG_DIR, 'cli.sock'), () => ({
      status: 'refused',
      reason: 'too-many-sheets',
    }));
    const r = await ensureDesktop(root, { env: env() });
    assert.equal(r.state, 'fallback');
    assert.equal(r.reason, 'too-many-sheets');
    assert.match(r.line, /separate server/);
    assert.match(r.line, /Open project/);
    reset();
  });

  test('a branch-changed warning prints no bidi or invisible characters', async () => {
    const root = project();
    const s = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, s.port)]);
    await fakeSocket(join(REG_DIR, 'cli.sock'), () => ({
      status: 'running',
      port: s.port,
      warning: { kind: 'branch-changed', was: 'ma\u202ein\u200b', now: 'fe\u2066at\u2069\nx' },
    }));
    const lines = [];
    await ensureDesktop(root, { env: env(), log: (l) => lines.push(l) });
    const w = lines.find((l) => l.includes('switched from'));
    assert.ok(w, lines.join('|'));
    assert.ok(w.includes('from main to feat x'), w);
    assert.equal(cleanName('a\u00adb\u{e0041}c\ufeff'), 'abc');
    reset();
  });

  test('no socket → fallback (today’s behaviour); a regular file named cli.sock is not a socket', async () => {
    const root = project();
    reset();
    writeRegistry(REG, []);
    assert.equal((await ensureDesktop(root, { env: env() })).reason, 'no-socket');
    writeFileSync(join(REG_DIR, 'cli.sock'), '');
    assert.equal((await ensureDesktop(root, { env: env() })).reason, 'no-socket');
    reset();
  });
});

describe('isAppPid — runtime-health never kills the app’s server', () => {
  test('the app pid and its servers’ pids are the app’s', () => {
    const root = project();
    reset();
    writeRegistry(REG, [running(root, 4000, KEY, { pid: 424242 })], { appPid: 515151 });
    assert.equal(isAppPid(424242, { env: env() }), true);
    assert.equal(isAppPid(515151, { env: env() }), true);
    assert.equal(isAppPid(616161, { env: env() }), false);
    reset();
  });
});

describe('the CLI mode the bash helpers call', () => {
  const run = (args) =>
    new Promise((res) => {
      const c = spawn(process.execPath, [join(HERE, 'desktop-locate.mjs'), ...args], {
        env: env(),
      });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (err += d));
      c.on('exit', (code) => res({ code, out, err }));
    });

  test('port: 0 + the port when attested; 10 without the app; 11 when forged', async () => {
    const root = project();
    const good = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, good.port)]);
    const a = await run(['port', '--root', root]);
    assert.equal(a.code, 0);
    assert.equal(a.out.trim(), String(good.port));
    reset();
    assert.equal((await run(['port', '--root', root])).code, 10);
    const bad = await fakeServer({ key: WRONG, rootId: rootIdOf(root) });
    writeRegistry(REG, [running(root, bad.port)]);
    const c = await run(['port', '--root', root]);
    assert.equal(c.code, 11);
    assert.equal(c.out, '');
    reset();
  });
});

// sec-loopback-bearer §7.6 — an app server requires its per-spawn API key from every caller. The CLI
// takes it from the registry entry of the ATTESTED port only and sends it on every request.
describe('the app server API key', () => {
  const API = 'ef'.repeat(32);
  const runMode = (args) =>
    new Promise((res) => {
      const c = spawn(process.execPath, [join(HERE, 'desktop-locate.mjs'), ...args], {
        env: env(),
      });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('exit', (code) => res({ code, out }));
    });

  test('readRegistry keeps a well-formed apiKey and drops a malformed one', () => {
    const root = project();
    reset();
    writeRegistry(REG, [running(root, 4100, KEY, { apiKey: API })]);
    assert.equal(readRegistry(REG).servers[0].apiKey, API);
    writeRegistry(REG, [running(root, 4100, KEY, { apiKey: 'short' })]);
    assert.equal(readRegistry(REG).servers[0].apiKey, undefined);
    reset();
  });

  test('an attested port hands out its key; a forged MAC or another port never does', async () => {
    const root = project();
    const good = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, good.port, KEY, { apiKey: API })]);
    assert.equal((await locateDesktop(root, { env: env() })).apiKey, API);
    assert.equal(await apiKeyFor(root, good.port, { env: env() }), API);
    assert.equal(await apiKeyFor(root, good.port + 1, { env: env() }), null);
    const bad = await fakeServer({ key: WRONG, rootId: rootIdOf(root) });
    writeRegistry(REG, [running(root, bad.port, KEY, { apiKey: API })]);
    assert.equal(await apiKeyFor(root, bad.port, { env: env() }), null);
    reset();
  });

  test('studio-locate: verbs and hooks send the key to the app studio, none to a project server', async () => {
    const root = project();
    const app = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, app.port, KEY, { apiKey: API })]);
    const { studio } = await probeStudio(root);
    assert.equal(studio.owner, 'app');
    assert.equal(studioHeaders(studio)['x-maude-api-key'], API);
    await postStudio(studio, '/_api/ui/open', { panel: 'chat' });
    assert.equal(app.keys.at(-1), API, 'the POST carried the key');
    reset();
    const own = await fakeServer({ rootId: rootIdOf(root) });
    plantServerJson(root, own.port);
    const { studio: cli } = await probeStudio(root);
    assert.equal(cli.port, own.port);
    assert.equal(studioHeaders(cli)['x-maude-api-key'], undefined);
    await postStudio(cli, '/_api/ui/open', { panel: 'chat' });
    assert.equal(own.keys.at(-1), null, 'no key to a server the app did not start');
  });

  test('key mode: the key on stdout when attested on that port; 10 otherwise; 11 when forged', async () => {
    const root = project();
    const good = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, good.port, KEY, { apiKey: API })]);
    const a = await runMode(['key', '--root', root, '--port', String(good.port)]);
    assert.equal(a.code, 0);
    assert.equal(a.out.trim(), API);
    const b = await runMode(['key', '--root', root, '--port', String(good.port + 1)]);
    assert.equal(b.code, 10);
    assert.equal(b.out, '');
    const bad = await fakeServer({ key: WRONG, rootId: rootIdOf(root) });
    writeRegistry(REG, [running(root, bad.port, KEY, { apiKey: API })]);
    const c = await runMode(['key', '--root', root, '--port', String(bad.port)]);
    assert.equal(c.code, 11);
    assert.equal(c.out, '');
    reset();
  });

  // fix-bulk B1 — `key` exited 11 against the app's live server: one attest with a 1.5 s budget, while
  // `port` mode retries. A busy app server (an export, a fresh boot) answers late; the key is still
  // handed out only for an attested port, and a forged MAC still exits 11.
  test('key mode: an app server that answers the check late still gets its key', async () => {
    const root = project();
    const slow = await fakeServer({ rootId: rootIdOf(root), slowAttests: 1, slowMs: 2000 });
    reset();
    writeRegistry(REG, [running(root, slow.port, KEY, { apiKey: API })]);
    const a = await runMode(['key', '--root', root, '--port', String(slow.port)]);
    assert.equal(a.code, 0);
    assert.equal(a.out.trim(), API);
    const u = await runMode(['launch-url', '--root', root, '--port', String(slow.port)]);
    assert.equal(u.code, 0);
    assert.match(u.out, /maude-launch=/);
    reset();
  });
});

describe('hygiene', () => {
  test('every registry this suite used is under the temp dir, never the app data dir', () => {
    assert.ok(REG.startsWith(realpathSync(tmpdir())) || REG.startsWith(tmpdir()));
    assert.equal(REG.startsWith(REAL_APP_DIR), false);
    assert.equal(registryPath(env()), REG);
  });
});

describe('callers ask the app first', () => {
  const REPO_ROOT = join(HERE, '..', '..');
  const SERVER_UP = join(REPO_ROOT, 'apps', 'studio', 'bin', 'server-up.sh');
  // only node + the system tools: no bun, so a fall-through to "start a server" fails at once
  // instead of booting one
  function lanePath() {
    const bin = join(scratch(), 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'node'));
    return `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`;
  }
  const serverUp = (root, extra = []) =>
    new Promise((res) => {
      const c = spawn('bash', [SERVER_UP, '--root', root, ...extra], {
        env: {
          ...env(),
          PATH: lanePath(),
          NO_OPEN: '1',
          MAUDE_NO_AUTOBUILD: '1',
          MAUDE_FORCE_SOURCE: '1',
          MAUDE_DEV_SERVER_BIN: '',
          CLAUDE_PLUGIN_ROOT: '',
        },
      });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (err += d));
      c.on('exit', (code) => res({ code, out, err }));
    });

  test('server-up: the attested app server, not the planted _server.json, and no spawn', async () => {
    const root = project();
    const app = await fakeServer({ rootId: rootIdOf(root) });
    const planted = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, app.port)]);
    plantServerJson(root, planted.port);
    const r = await serverUp(root);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), String(app.port));
    assert.equal(planted.seen.length, 0);
    assert.equal(existsSync(join(root, '.design', '_server.log')), false, 'nothing spawned');
    reset();
  });

  // sec-loopback-bearer §7.5 — an auto-tier verb never prints a launch token: the AI agent reads its
  // stdout. `--url` prints the plain address; `--open` opens the browser itself with the link.
  test('server-up --url / --open: no launch token on stdout; --open hands it to the browser', async () => {
    const root = project();
    const app = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, app.port, KEY, { apiKey: 'ab'.repeat(32) })]);
    const run = (flag) =>
      new Promise((res) => {
        const bin = join(scratch(), 'bin');
        mkdirSync(bin);
        symlinkSync(process.execPath, join(bin, 'node'));
        const seen = join(bin, 'opened.txt');
        for (const name of ['open', 'xdg-open'])
          writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${seen}'\n`, {
            mode: 0o755,
          });
        const c = spawn('bash', [SERVER_UP, '--root', root, flag], {
          env: {
            ...env(),
            PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
            NO_OPEN: '1',
            MAUDE_NO_AUTOBUILD: '1',
            MAUDE_FORCE_SOURCE: '1',
            MAUDE_DEV_SERVER_BIN: '',
            CLAUDE_PLUGIN_ROOT: '',
          },
        });
        let out = '';
        let err = '';
        c.stdout.on('data', (d) => (out += d));
        c.stderr.on('data', (d) => (err += d));
        c.on('exit', (code) =>
          res({ code, out, err, opened: existsSync(seen) ? readFileSync(seen, 'utf8') : '' })
        );
      });
    for (const flag of ['--url', '--open']) {
      const r = await run(flag);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.trim(), `http://localhost:${app.port}/`);
      assert.doesNotMatch(r.out + r.err, /maude-launch/);
      if (flag === '--open')
        assert.match(r.opened, /\/\?maude-launch=\d+\.[0-9a-f]{32}\.[0-9a-f]{64}/);
      else assert.equal(r.opened, '');
    }
    reset();
  });

  const PREP = join(REPO_ROOT, 'apps', 'studio', 'bin', 'prep.sh');
  const prep = (root) =>
    new Promise((res) => {
      const c = spawn('bash', [PREP, '--root', root, '--json'], {
        env: {
          ...env(),
          PATH: `${lanePath()}:/opt/homebrew/bin:/usr/local/bin`,
          CLAUDE_PROJECT_DIR: '',
        },
      });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('exit', (code) => res({ code, out }));
    });

  test('prep: server.owner is app (the attested port, not _server.json), cli, or none', async (t) => {
    const jq = spawnSync('jq', ['--version'], {
      env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin' },
    });
    if (jq.status !== 0) return t.skip('no jq');
    const root = project();
    const app = await fakeServer({ rootId: rootIdOf(root) });
    const planted = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, app.port)]);
    plantServerJson(root, planted.port);
    let r = await prep(root);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out).server, { up: true, port: app.port, owner: 'app' });
    reset();
    r = await prep(root);
    assert.deepEqual(JSON.parse(r.out).server, { up: true, port: planted.port, owner: 'cli' });
    rmSync(join(root, '.design', '_server.json'));
    r = await prep(root);
    assert.deepEqual(JSON.parse(r.out).server, { up: false, port: null, owner: 'none' });
    reset();
  });

  test('server-up: a forged MAC → exit 1, no fallback to _server.json, no spawn', async () => {
    const root = project();
    const app = await fakeServer({ key: WRONG, rootId: rootIdOf(root) });
    const planted = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, app.port)]);
    plantServerJson(root, planted.port);
    const r = await serverUp(root);
    assert.equal(r.code, 1);
    assert.match(r.err, /did not answer the check/);
    assert.equal(r.out, '');
    assert.equal(planted.seen.length, 0);
    assert.equal(existsSync(join(root, '.design', '_server.log')), false);
    reset();
  });

  test('server-up --show: the app shows the project → exit 0, nothing on stdout', async () => {
    const root = project();
    reset();
    writeRegistry(REG, []);
    const sock = await fakeSocket(join(REG_DIR, 'cli.sock'), () => ({
      status: 'shown',
      label: 'p-x',
    }));
    const r = await serverUp(root, ['--show']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, '');
    assert.equal(sock.reqs[0].op, 'show');
    assert.equal(existsSync(join(root, '.design', '_server.log')), false);
    reset();
  });

  test('maude design open: the app routes canvas+artboard; @element and --mode go to the attested tab', async () => {
    const { runOpen } = await import('./design-open.mjs');
    const root = project();
    writeFileSync(join(root, '.design', 'home.tsx'), '');
    const tab = await fakeServer({ rootId: rootIdOf(root) });
    const planted = await fakeServer({ rootId: rootIdOf(root) });
    plantServerJson(root, planted.port);
    reset();
    writeRegistry(REG, []);
    const sock = await fakeSocket(join(REG_DIR, 'cli.sock'), () => {
      writeRegistry(REG, [running(root, tab.port)]); // the shown tab's server comes up
      return { status: 'shown', label: 'p-x' };
    });
    let out = '';
    const code = await runOpen({
      words: ['home.tsx#hero@cta', '--mode', 'preview'],
      env: env(),
      cwd: root,
      out: { write: (s) => (out += s) },
      err: { write: () => {} },
      showFollowUpMs: 3000,
    });
    assert.equal(code, 0, out);
    assert.equal(sock.reqs[0].op, 'show');
    assert.equal(sock.reqs[0].element, 'cta');
    assert.deepEqual(tab.posts, [
      { canvas: 'home.tsx', artboard: 'hero', element: 'cta', mode: 'preview' },
    ]);
    assert.equal(planted.seen.length, 0, 'never the planted _server.json');
    reset();
  });

  test('server-up: refused for unsent changes on another branch → exit 4', async () => {
    const root = project();
    reset();
    writeRegistry(REG, []);
    await fakeSocket(join(REG_DIR, 'cli.sock'), () => ({
      status: 'refused',
      reason: 'branch-changed-unsent',
    }));
    const r = await serverUp(root);
    assert.equal(r.code, 4);
    assert.match(r.err, /unsaved changes/);
    reset();
  });

  test('maude design open: the app shows the canvas over the socket', async () => {
    const { runOpen } = await import('./design-open.mjs');
    const root = project();
    writeFileSync(join(root, '.design', 'home.tsx'), '');
    reset();
    writeRegistry(REG, []);
    const sock = await fakeSocket(join(REG_DIR, 'cli.sock'), () => ({ status: 'shown' }));
    let out = '';
    const code = await runOpen({
      words: ['home.tsx#hero'],
      env: env(),
      cwd: root,
      out: { write: (s) => (out += s) },
      err: { write: () => {} },
    });
    assert.equal(code, 0);
    assert.match(out, /showing home\.tsx#hero in Maude/);
    assert.equal(sock.reqs[0].op, 'show');
    assert.equal(sock.reqs[0].root, root);
    assert.equal(sock.reqs[0].canvas, 'home.tsx');
    assert.equal(sock.reqs[0].artboard, 'hero');
    reset();
  });

  test('maude design serve: points at the app instead of a second server; --force keeps it', async () => {
    const { serveDesktopGuard } = await import('../commands/design.mjs');
    const root = project();
    const app = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    writeRegistry(REG, [running(root, app.port)]);
    const a = await serveDesktopGuard(['--root', root, '--port', '4400'], { env: env() });
    assert.equal(a.served?.port, app.port);
    const b = await serveDesktopGuard(['--root', root, '--force'], { env: env() });
    assert.equal(b.served, null);
    assert.deepEqual(b.forwarded, ['--root', root]);
    reset();
  });
});

// sec-loopback-bearer §7.5 — a terminal-started server writes its own key to a 0600 file in the
// per-user state dir. The CLI reads it only for the port `/_health` tied to this root, never from
// the project, and refuses a file another user (or the group) could have written.
describe('a terminal-started server key', () => {
  const API = '7a'.repeat(32);
  let STATE;
  let prevState;
  before(() => {
    STATE = scratch();
    prevState = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = STATE;
  });
  after(() => {
    if (prevState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prevState;
  });
  const keyFile = (root, rec, mode = 0o600) => {
    const dir = serverKeyDir({ XDG_STATE_HOME: STATE });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const f = join(dir, `${rootIdOf(root)}.json`);
    rmSync(f, { force: true });
    writeFileSync(f, JSON.stringify({ v: 1, rootId: rootIdOf(root), apiKey: API, ...rec }), {
      mode,
    });
    chmodSync(f, mode);
    return f;
  };
  const runMode = (args) =>
    new Promise((res) => {
      const c = spawn(process.execPath, [join(HERE, 'desktop-locate.mjs'), ...args], {
        env: { ...env(), XDG_STATE_HOME: STATE },
      });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('exit', (code) => res({ code, out }));
    });

  test('terminalKeyFor: the right port and a live pid only; a loose mode never', () => {
    const root = project();
    const e = { XDG_STATE_HOME: STATE };
    keyFile(root, { port: 4410, pid: process.pid });
    assert.equal(terminalKeyFor(root, 4410, { env: e }), API);
    assert.equal(terminalKeyFor(root, 4411, { env: e }), null);
    keyFile(root, { port: 4410, pid: deadPid() });
    assert.equal(terminalKeyFor(root, 4410, { env: e }), null);
    keyFile(root, { port: 4410, pid: process.pid }, 0o644);
    assert.equal(terminalKeyFor(root, 4410, { env: e }), null);
    keyFile(root, { port: 4410, pid: process.pid, rootId: 'ffffffffffff' });
    assert.equal(terminalKeyFor(root, 4410, { env: e }), null);
  });

  test('probeStudio carries the key and every request sends it', async () => {
    const root = project();
    const srv = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    plantServerJson(root, srv.port);
    keyFile(root, { port: srv.port, pid: process.pid });
    const { studio } = await probeStudio(root);
    assert.equal(studio.apiKey, API);
    assert.equal(studioHeaders(studio)['x-maude-api-key'], API);
    await postStudio(studio, '/_api/ui/open', { canvas: 'a.tsx' });
    assert.equal(srv.keys.at(-1), API);
  });

  test('key + launch-url modes: the key file of the server /_health ties to this root', async () => {
    const root = project();
    const srv = await fakeServer({ rootId: rootIdOf(root) });
    reset();
    keyFile(root, { port: srv.port, pid: process.pid });
    const k = await runMode(['key', '--root', root, '--port', String(srv.port)]);
    assert.equal(k.code, 0);
    assert.equal(k.out.trim(), API);
    const u = await runMode(['launch-url', '--root', root, '--port', String(srv.port)]);
    assert.equal(u.code, 0);
    const m =
      /^http:\/\/localhost:(\d+)\/\?maude-launch=(\d+)\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(
        u.out.trim()
      );
    assert.ok(m, u.out);
    assert.equal(Number(m[1]), srv.port);
    const want = createHmac('sha256', API).update(`maude-launch/1\n${m[2]}\n${m[3]}`).digest('hex');
    assert.equal(m[4], want);
    // another project's server on that port: no key
    const other = await fakeServer({ rootId: 'ffffffffffff' });
    keyFile(root, { port: other.port, pid: process.pid });
    assert.equal((await runMode(['key', '--root', root, '--port', String(other.port)])).code, 10);
    const plain = await runMode(['launch-url', '--root', root, '--port', String(other.port)]);
    assert.equal(plain.out.trim(), `http://localhost:${other.port}/`);
  });
});
