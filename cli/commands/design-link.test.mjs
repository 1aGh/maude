// End-to-end CLI tests for `maude design link|unlink|status|adopt` via async spawn.
//
// /health is faked with a plain node:http server — we don't need a real
// Hocuspocus instance. spawnSync would block the parent's event loop and
// prevent the mock from responding; async spawn keeps the loop ticking.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');

const PORT = Number.parseInt(process.env.HUB_TEST_PORT_DESIGN ?? '14396', 10);
const URL = `http://127.0.0.1:${PORT}`;

let mockServer;
let workspace;
let hubsConfigPath;

before(async () => {
  mockServer = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url.startsWith('/health?'))) {
      const body = JSON.stringify({
        ok: true,
        version: '0.0.0-mock',
        uptimeMs: 1234,
        port: PORT,
        dataDir: '/tmp/mock',
        tokenCount: 0,
        authMode: 'dev',
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolveLi) => mockServer.listen(PORT, '127.0.0.1', resolveLi));
});

after(async () => {
  if (mockServer) await new Promise((r) => mockServer.close(r));
});

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'maude-design-link-ws-'));
  mkdirSync(join(workspace, '.design'), { recursive: true });
  writeFileSync(
    join(workspace, '.design/config.json'),
    JSON.stringify({ name: 'test', ds: 'default' }, null, 2),
    'utf8'
  );
  hubsConfigPath = join(workspace, 'hubs.json');
});

function runCli(args, extraEnv = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: workspace,
      env: { ...process.env, HUBS_CONFIG_PATH: hubsConfigPath, ...extraEnv },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 8000);
    child.on('exit', (status, signal) => {
      clearTimeout(timer);
      resolveResult({ status, signal, stdout, stderr });
    });
  });
}

function cleanup() {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
}

// V2-8.9 defender M1: linking hands this Mac's hub credential to a hub — the person's act at a
// terminal, never an AI session's (the permission card would show a shell line, not the hub).
test('link refuses inside an AI session and writes nothing', async () => {
  for (const env of [
    { MAUDE_AGENT_ACTOR: 'maude-chat' },
    { MAUDE_CHAT_ID: 'chat_1' },
    { MAUDE_HOOK_SESSION: 'sess-1' },
  ]) {
    const res = await runCli(['design', 'link', URL, '--token', 'mau_test', '--yes'], env);
    assert.equal(res.status, 1, JSON.stringify(env));
    assert.match(res.stderr, /in a terminal yourself/);
    const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
    assert.equal(cfg.linkedHub, undefined);
    assert.equal(existsSync(hubsConfigPath), false);
  }
  cleanup();
});

test('link without --token exits 2', async () => {
  const res = await runCli(['design', 'link', URL]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--token <value> is required/);
  cleanup();
});

test('link without positional url exits 2', async () => {
  const res = await runCli(['design', 'link', '--token', 'mau_x']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /<url> positional argument is required/);
  cleanup();
});

test('link writes linkedHub + hubs.json + prints reachability', async () => {
  const res = await runCli(['design', 'link', URL, '--token', 'mau_test']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /linked .* to http:\/\/127\.0\.0\.1:/);
  assert.match(res.stdout, /hub:\s+v[0-9.]/);

  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub.url, URL);
  assert.equal(typeof cfg.linkedHub.linkedAt, 'number');
  assert.equal(cfg.linkedHub.adopt, undefined);

  const hubs = JSON.parse(readFileSync(hubsConfigPath, 'utf8'));
  assert.equal(hubs.hubs[URL].token, 'mau_test');
  cleanup();
});

test('link --adopt records adopt:true in linkedHub', async () => {
  const res = await runCli(['design', 'link', URL, '--token', 'mau_test', '--adopt']);
  assert.equal(res.status, 0, res.stderr);
  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub.adopt, true);
  cleanup();
});

test('adopt subcommand is an alias of link --adopt', async () => {
  const res = await runCli(['design', 'adopt', URL, '--token', 'mau_test']);
  assert.equal(res.status, 0, res.stderr);
  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub.adopt, true);
  cleanup();
});

test('DDR-079: link without a flag omits syncTsx (= default ON, restore-proof)', async () => {
  const res = await runCli(['design', 'link', URL, '--token', 'mau_test']);
  assert.equal(res.status, 0, res.stderr);
  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  // We never write syncTsx:true to encode the default — absence means on.
  assert.equal(cfg.linkedHub.syncTsx, undefined);
  assert.match(res.stdout, /TSX sync: on by default/);
  cleanup();
});

test('DDR-079: link --no-sync-tsx records syncTsx:false (project opt-out)', async () => {
  const res = await runCli(['design', 'link', URL, '--token', 'mau_test', '--no-sync-tsx']);
  assert.equal(res.status, 0, res.stderr);
  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub.syncTsx, false);
  assert.match(res.stdout, /TSX sync: off \(opted out/);
  cleanup();
});

test('DDR-079: link --sync-tsx pins syncTsx:true explicitly', async () => {
  const res = await runCli(['design', 'link', URL, '--token', 'mau_test', '--sync-tsx']);
  assert.equal(res.status, 0, res.stderr);
  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub.syncTsx, true);
  cleanup();
});

test('DDR-079: status surfaces the migration advisory when syncTsx is unset', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);
  const res = await runCli(['design', 'status']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /TSX sync:\s+on \(default/);
  assert.match(res.stdout, /syncTsx is not set/);
  cleanup();
});

test('DDR-079: status --json reports effective + explicit syncTsx', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test', '--no-sync-tsx']);
  const res = await runCli(['design', 'status', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.syncTsx, false);
  assert.equal(payload.syncTsxExplicit, false);
  cleanup();
});

test('link against unreachable URL exits 1 unless --force', async () => {
  const dead = 'http://127.0.0.1:1';
  const fail = await runCli(['design', 'link', dead, '--token', 'mau_test']);
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /cannot reach/);

  const forced = await runCli(['design', 'link', dead, '--token', 'mau_test', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /NOT REACHED/);
  cleanup();
});

test('unlink drops linkedHub + token; idempotent on solo repo', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);

  const res = await runCli(['design', 'unlink']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /dropped link/);

  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub, undefined);

  const hubs = JSON.parse(readFileSync(hubsConfigPath, 'utf8'));
  assert.equal(URL in hubs.hubs, false);

  const second = await runCli(['design', 'unlink']);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /already in solo mode/);
  cleanup();
});

test('unlink --keep-token leaves hubs.json entry intact', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);
  await runCli(['design', 'unlink', '--keep-token']);

  const hubs = JSON.parse(readFileSync(hubsConfigPath, 'utf8'));
  assert.equal(hubs.hubs[URL].token, 'mau_test');
  cleanup();
});

test('status on solo repo reports solo mode', async () => {
  const res = await runCli(['design', 'status']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /solo mode/);
  cleanup();
});

test('status on linked repo reports hub URL + reachability + token presence', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);
  const res = await runCli(['design', 'status']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /linked mode/);
  assert.match(res.stdout, /token stored:\s+yes/);
  assert.match(res.stdout, /hub status:\s+up/);
  cleanup();
});

test('status --json emits structured payload', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);
  const res = await runCli(['design', 'status', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.mode, 'linked');
  assert.equal(payload.url, URL);
  assert.equal(payload.tokenStored, true);
  assert.equal(payload.hub.reachable, true);
  // No `maude design serve` running in this test → no _sync.json → idle.
  assert.equal(payload.sync.agent, 'idle');
  cleanup();
});

test('status reports zero-syncable when _sync.json is notSyncable (DDR-060 / 9.1-D)', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);
  // Simulate the dev-server having written a zero-syncable _sync.json.
  writeFileSync(
    join(workspace, '.design/_sync.json'),
    JSON.stringify({
      linked: true,
      notSyncable: true,
      url: URL,
      reason: '4 TSX canvas(es) found but none are syncable — see DDR-060.',
      tsxCount: 4,
      canvases: 0,
      updatedAt: Date.now(),
    }),
    'utf8'
  );

  const human = await runCli(['design', 'status']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /0 syncable canvases/);
  assert.match(human.stdout, /DDR-060/);

  const json = await runCli(['design', 'status', '--json']);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.sync.notSyncable, true);
  assert.equal(payload.sync.tsxCount, 4);
  cleanup();
});

// --------------------------------------------------- DDR-102 status surfaces

test('DDR-102: status renders docs counts, rejected slugs, and the conflict recovery hint', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);
  writeFileSync(
    join(workspace, '.design/_sync.json'),
    JSON.stringify({
      state: 'online',
      queuedOps: 0,
      lastSyncAt: 1760000000000,
      offlineSince: null,
      flash: null,
      updatedAt: Date.now(),
      url: URL,
      canvases: 83,
      docs: { synced: 81, pending: 0, rejected: 2 },
      rejectedSlugs: ['system-tokens', 'system-type'],
      conflicts: [
        {
          slug: 'ui-maskot',
          kind: 'cold-start-diverged',
          winner: 'local',
          snapshots: {
            local: '2026-06-11T10:00:00.000Z',
            hub: '2026-06-11T10:00:00.001Z',
          },
          at: 1760000001000,
        },
      ],
    }),
    'utf8'
  );

  const human = await runCli(['design', 'status']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /docs: 81 synced · 0 pending · 2 rejected/);
  assert.match(human.stdout, /not syncing:\s+system-tokens, system-type/);
  assert.match(human.stdout, /ui-maskot — diverged, kept local \(newest-wins\)/);
  assert.match(human.stdout, /local@2026-06-11T10:00:00\.000Z/);
  assert.match(human.stdout, /hub@2026-06-11T10:00:00\.001Z/);
  assert.match(human.stdout, /\/design:rollback ui-maskot/);

  // --json passes the new fields through verbatim.
  const json = await runCli(['design', 'status', '--json']);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.sync.docs.rejected, 2);
  assert.equal(payload.sync.conflicts[0].winner, 'local');
  cleanup();
});

test('DDR-102: status renders an OLD-shape _sync.json (no docs/rejectedSlugs) unchanged', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_test']);
  writeFileSync(
    join(workspace, '.design/_sync.json'),
    JSON.stringify({
      state: 'online',
      queuedOps: 0,
      lastSyncAt: null,
      offlineSince: null,
      flash: null,
      updatedAt: Date.now(),
      url: URL,
      canvases: 5,
      conflicts: [],
    }),
    'utf8'
  );
  const human = await runCli(['design', 'status']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /sync agent:\s+online/);
  assert.doesNotMatch(human.stdout, /docs:/);
  assert.doesNotMatch(human.stdout, /not syncing:/);
  cleanup();
});

test('DDR-102: re-linking the same hub prints the token-replacement notice', async () => {
  await runCli(['design', 'link', URL, '--token', 'mau_first']);
  const second = await runCli(['design', 'link', URL, '--token', 'mau_second']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /replacing the stored token for/);
  assert.match(second.stdout, /EVERY project linked to this hub on this machine/);
  cleanup();
});

// --------------------------------------------------- DDR-054 F2/F4 trust gate

const REMOTE_URL = 'http://hub.invalid:9999'; // .invalid never resolves (RFC 6761)

test('linking a non-loopback hub without --yes (non-TTY) refuses', async () => {
  // The spawned child has no TTY on stdin, so the gate must refuse rather
  // than silently link a remote hub in a script.
  const res = await runCli(['design', 'link', REMOTE_URL, '--token', 'mau_x', '--force']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /requires confirmation/);
  // No link written.
  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub, undefined);
  cleanup();
});

test('linking a non-loopback hub with --yes records trust + links', async () => {
  const res = await runCli(['design', 'link', REMOTE_URL, '--token', 'mau_x', '--yes', '--force']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /confirmed via --yes/);
  assert.match(res.stderr, /UNTRUSTED/); // F3 linked-mode banner

  const cfg = JSON.parse(readFileSync(join(workspace, '.design/config.json'), 'utf8'));
  assert.equal(cfg.linkedHub.url, REMOTE_URL);

  // Trust is recorded PER-MACHINE (hubs.json), never in a committable repo file.
  const hubs = JSON.parse(readFileSync(hubsConfigPath, 'utf8'));
  assert.ok(hubs.trusted.includes(REMOTE_URL), 'hub should be trusted on this machine');
  assert.equal(
    existsSync(join(workspace, '.maude/trusted-hubs')),
    false,
    'no committable trust file'
  );

  // Re-linking the now-trusted hub no longer needs --yes.
  const second = await runCli(['design', 'link', REMOTE_URL, '--token', 'mau_y', '--force']);
  assert.equal(second.status, 0, second.stderr);
  cleanup();
});

test('--adopt against a non-loopback hub lists the upload manifest in the gate', async () => {
  writeFileSync(join(workspace, '.design/screen.html'), '<button>hi</button>', 'utf8');
  const res = await runCli(['design', 'adopt', REMOTE_URL, '--token', 'mau_x', '--yes', '--force']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /will UPLOAD 1 local file/);
  assert.match(res.stderr, /\.design\/screen\.html/);

  const hubs = JSON.parse(readFileSync(hubsConfigPath, 'utf8'));
  assert.equal(typeof hubs.hubs[REMOTE_URL].adoptedAt, 'number'); // F4 attestation
  cleanup();
});
