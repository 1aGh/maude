// fix-bulk B1 (#221) — `maude design export` against a server in required mode (sec-loopback-bearer
// §7.1): the app's server, and a terminal-started one, answer a key-less caller 401
// `api-key-required`. The export verb used to POST `/_api/export` (and `-estimate` / `-preflight`) with
// only a content type, so every export from the CLI and from the AI chat failed.
//
// The key comes only from where §7.6 says: the app's registry entry of an ATTESTED port, else a
// terminal server's per-user key file after `/_health` names this project — never a project file.
// Each test runs the REAL CLI against a stand-in server; nothing touches the person's app, registry or
// key folder (MAUDE_APP_REGISTRY_FILE and XDG_STATE_HOME point into a scratch dir).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');
const ATTEST = 'ab'.repeat(32);
const API = 'ef'.repeat(32);

const dirs = [];
const closers = [];
after(async () => {
  for (const c of closers) await c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function scratch() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'mdx-')));
  dirs.push(d);
  return d;
}
function project() {
  const root = scratch();
  mkdirSync(join(root, '.design'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), '{}');
  return root;
}
const rootIdOf = (root) => createHash('sha256').update(root).digest('hex').slice(0, 12);
const mac = (key, n, rootId, port) =>
  createHmac('sha256', key).update(`maude-attest/1\n${n}\n${rootId}\n${port}`).digest('hex');

/**
 * A stand-in studio in required mode: every route but `/_health` and `/_api/shell/attest` needs
 * `x-maude-api-key: <apiKey>` (401 api-key-required otherwise). Records each export request.
 */
function requiredModeServer({ rootId, apiKey = API, attestKey = ATTEST } = {}) {
  return new Promise((done) => {
    const exports = [];
    const srv = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const port = srv.address().port;
      if (u.pathname === '/_health') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ ok: true, app: 'design', rootId }));
      }
      if (u.pathname === '/_api/shell/attest') {
        res.setHeader('content-type', 'application/json');
        return res.end(
          JSON.stringify({ mac: mac(attestKey, u.searchParams.get('n'), rootId, port) })
        );
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const key = req.headers['x-maude-api-key'] ?? null;
        exports.push({ path: u.pathname, key });
        if (key !== apiKey) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'api-key-required' }));
        }
        if (u.pathname === '/_api/export-estimate') {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ files: 1, lane: 'this-mac', bytes: 2048, seconds: 1 }));
        }
        if (u.pathname === '/_api/export-preflight') {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ print: false }));
        }
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="flyer.pdf"',
        });
        res.end(Buffer.from('%PDF-1.7'));
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      closers.push(() => new Promise((r) => srv.close(() => r())));
      done({ port: srv.address().port, exports });
    });
  });
}

/** A registry the stand-in app wrote: 0600, `app.pid` alive (this test's own process). */
function writeRegistry(file, root, port) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      app: { pid: process.pid, version: '2.1.2' },
      servers: [
        {
          root,
          rootId: rootIdOf(root),
          state: 'running',
          port,
          pid: process.pid,
          attestKey: ATTEST,
          apiKey: API,
          kind: 'project',
        },
      ],
    })
  );
  chmodSync(file, 0o600);
}

/** This process's env minus what makes a verb think it runs in an AI session on another project. */
function outsideAiSession(env) {
  const out = { ...env };
  for (const k of [
    'CLAUDE_PLUGIN_ROOT',
    'CLAUDE_PROJECT_DIR',
    'MAUDE_HOOK_SESSION',
    'MAUDE_SESSION_ROOT',
    'MAUDE_CHAT_ID',
    'MAUDE_AGENT_ACTOR',
  ])
    delete out[k];
  return out;
}

function run(cwd, args, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, 'design', 'export', ...args], {
      cwd,
      env: { ...outsideAiSession(process.env), ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

/** A scratch env: a registry path and a state dir that are this test's own. */
function isolatedEnv() {
  const d = scratch();
  return {
    MAUDE_APP_REGISTRY_FILE: join(d, 'app', 'servers.json'),
    XDG_STATE_HOME: join(d, 'state'),
  };
}

test('the app’s server: export, --estimate and --preflight carry the attested key', async () => {
  const root = project();
  const srv = await requiredModeServer({ rootId: rootIdOf(root) });
  const env = isolatedEnv();
  writeRegistry(env.MAUDE_APP_REGISTRY_FILE, root, srv.port);
  const p = ['--port', String(srv.port)];

  const a = await run(root, ['pdf', '--scope', 'canvas-whole', ...p], env);
  assert.equal(a.code, 0, a.stderr);
  assert.match(a.stdout, /wrote .*flyer\.pdf/);
  assert.ok(readdirSync(root).includes('flyer.pdf'));
  const est = await run(root, ['pdf', '--scope', 'canvas', '--estimate', ...p], env);
  assert.equal(est.code, 0, est.stderr);
  const pre = await run(root, ['pdf', '--scope', 'canvas', '--preflight', ...p], env);
  assert.equal(pre.code, 0, pre.stderr);
  assert.deepEqual(
    srv.exports.map((e) => [e.path, e.key]),
    [
      ['/_api/export', API],
      ['/_api/export-estimate', API],
      ['/_api/export-preflight', API],
    ]
  );
});

test('no --port: the app’s attested server wins over a planted _server.json, with its key', async () => {
  const root = project();
  const app = await requiredModeServer({ rootId: rootIdOf(root) });
  const decoy = await requiredModeServer({ rootId: rootIdOf(root), apiKey: 'cd'.repeat(32) });
  writeFileSync(
    join(root, '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port: decoy.port, url: `http://127.0.0.1:${decoy.port}` })
  );
  const env = isolatedEnv();
  writeRegistry(env.MAUDE_APP_REGISTRY_FILE, root, app.port);
  const r = await run(
    join(root, '.design'),
    ['pdf', '--scope', 'canvas-whole', '--out', root],
    env
  );
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(app.exports, [{ path: '/_api/export', key: API }]);
  assert.deepEqual(decoy.exports, [], 'the project file never redirected the export');
});

test('a terminal-started server: the key from its per-user key file, after /_health names the project', async () => {
  const root = project();
  const srv = await requiredModeServer({ rootId: rootIdOf(root) });
  const env = isolatedEnv();
  const keyDir = join(env.XDG_STATE_HOME, 'maude', 'servers');
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const keyFile = join(keyDir, `${rootIdOf(root)}.json`);
  writeFileSync(
    keyFile,
    JSON.stringify({ v: 1, port: srv.port, pid: process.pid, rootId: rootIdOf(root), apiKey: API })
  );
  chmodSync(keyFile, 0o600);
  writeFileSync(
    join(root, '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port: srv.port, url: `http://127.0.0.1:${srv.port}` })
  );
  const r = await run(root, ['pdf', '--scope', 'canvas-whole'], env);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(srv.exports, [{ path: '/_api/export', key: API }]);
});

test('no key to be had: the server’s 401 is reported, exit 1, no file', async () => {
  const root = project();
  const srv = await requiredModeServer({ rootId: rootIdOf(root) });
  const r = await run(root, ['pdf', '--scope', 'canvas-whole', '--port', String(srv.port)], {
    ...isolatedEnv(),
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /api-key-required/);
  assert.deepEqual(srv.exports, [{ path: '/_api/export', key: null }]);
  assert.ok(!readdirSync(root).includes('flyer.pdf'));
});

test('the app serves the project but its server does not attest: refused before any request', async () => {
  const root = project();
  const forged = await requiredModeServer({ rootId: rootIdOf(root), attestKey: 'cd'.repeat(32) });
  const env = isolatedEnv();
  writeRegistry(env.MAUDE_APP_REGISTRY_FILE, root, forged.port);
  const r = await run(root, ['pdf', '--scope', 'canvas-whole', '--port', String(forged.port)], env);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /did not answer the check/);
  assert.deepEqual(forged.exports, [], 'nothing was sent to a server that did not attest');
});
