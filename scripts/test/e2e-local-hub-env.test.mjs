// p8-secfix-f F4: the e2e lanes' local hub never inherits the developer's store / cloud env.
// The hub reads MAUDE_PROJECT_STORE_URL/_TOKEN, MAUDE_S3_*, HUB_*, MAUDE_TENANT_ID… from its env
// (apps/hub/src/server.mjs), so a `{...process.env}` child of a shell that has them would talk to a
// real store with real credentials. Both hub spawns build the child env from an allowlist instead.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hubEnv, startLocalHub } from '../../apps/desktop/e2e/fixtures/local-hub.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const POLLUTED = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/dev',
  TMPDIR: '/tmp/x',
  LANG: 'cs_CZ.UTF-8',
  MAUDE_PROJECT_STORE_URL: 'https://store.example.invalid',
  MAUDE_PROJECT_STORE_TOKEN: 'tok-store',
  MAUDE_S3_BUCKET: 'prod-bucket',
  MAUDE_S3_SECRET_ACCESS_KEY: 's3-secret',
  AWS_ACCESS_KEY_ID: 'AKIA…',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  HUB_SECRET: 'hub-secret',
  HUB_PUBLIC_URL: 'https://hub.example.invalid',
  CLOUDFLARE_API_TOKEN: 'cf',
  GH_TOKEN: 'gh',
  GITHUB_TOKEN: 'gh2',
  MAUDE_TENANT_ID: 'prod-tenant',
  MAUDE_CONTROL_PLANE_URL: 'https://maude.example.invalid',
  MAUDE_CLOUD_IDENTITY: '1',
  MAUDE_PROJECT_TOKEN_KEY: 'prod-key',
  MAUDE_BACKUP_PREFIX: 'prod/',
  ANTHROPIC_API_KEY: 'sk-ant',
};
const FORBIDDEN =
  /^(MAUDE_PROJECT_STORE_|MAUDE_S3_|AWS_|HUB_|CLOUDFLARE_|GH_TOKEN$|GITHUB_TOKEN$|MAUDE_TENANT_ID$|MAUDE_CONTROL_PLANE_URL$|MAUDE_CLOUD_IDENTITY$|MAUDE_PROJECT_TOKEN_KEY$|MAUDE_BACKUP_|ANTHROPIC_)/;

const leaked = (env) => Object.keys(env).filter((k) => FORBIDDEN.test(k));

test('hubEnv keeps the basics, drops every store / cloud / token variable, and adds only what the caller sets', () => {
  const env = hubEnv({ NO_OPEN: '1', HUB_SECRET: 'rig-secret' }, POLLUTED);
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(env.HOME, '/Users/dev');
  assert.equal(env.TMPDIR, '/tmp/x');
  assert.equal(env.LANG, 'cs_CZ.UTF-8');
  assert.equal(env.NO_OPEN, '1');
  assert.equal(env.HUB_SECRET, 'rig-secret', 'what the rig sets itself wins');
  assert.deepEqual(leaked(env), ['HUB_SECRET'], 'only the one the caller set');
  assert.deepEqual(leaked(hubEnv({}, POLLUTED)), []);
});

test('startLocalHub spawns the hub with none of the inherited store / cloud variables', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, POLLUTED, { PATH: process.env.PATH });
  let seen;
  const fakeSpawn = (_bin, _args, opts) => {
    seen = opts.env;
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.pid = 4242;
    proc.kill = () => {};
    setImmediate(() =>
      proc.stdout.emit(
        'data',
        Buffer.from('{"http":"http://127.0.0.1:1/","ws":"ws://127.0.0.1:1","tokens":{}}\n')
      )
    );
    return proc;
  };
  try {
    const hub = await startLocalHub({ dir: '/tmp/none', node: process.execPath, spawn: fakeSpawn });
    assert.equal(hub.http, 'http://127.0.0.1:1');
    assert.ok(seen, 'the injected spawn ran');
    assert.deepEqual(leaked(seen), []);

    await startLocalHub({
      dir: '/tmp/none',
      node: process.execPath,
      spawn: fakeSpawn,
      cloudKey: 'k',
    });
    assert.equal(seen.MAUDE_CLOUD_IDENTITY, '1', 'cloud mode is the caller’s, not the shell’s');
    assert.equal(seen.MAUDE_PROJECT_TOKEN_KEY, 'k');
    assert.deepEqual(
      leaked(seen).filter((k) => k !== 'MAUDE_CLOUD_IDENTITY' && k !== 'MAUDE_PROJECT_TOKEN_KEY'),
      []
    );
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the share-roles rig builds its hub env with hubEnv, not a copy of process.env', () => {
  const src = readFileSync(join(ROOT, 'apps/desktop/e2e/share-roles/stand-up.mjs'), 'utf8');
  const at = src.indexOf('// ── the hub');
  const block = src.slice(at, src.indexOf("'fixtures/share-roles-hub.mjs'", at));
  assert.ok(at > 0 && block.length > 0, 'stand-up.mjs still has its hub block');
  assert.match(block, /hubEnv\(/);
  assert.doesNotMatch(block, /\.\.\.process\.env/);
});
