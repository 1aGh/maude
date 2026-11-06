// `maude hub token generate` CLI end-to-end via spawnSync — verifies stdout
// shape, file contents, and label-overwrite (rotation) idempotence.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readTokens } from '../../apps/hub/src/tokens.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');

function runCli(args, { cwd } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
  });
}

function withDataDir(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-cli-hub-'));
  try {
    return fn(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('hub help prints subcommand summary on stdout', () => {
  const res = runCli(['hub', 'help']);
  assert.equal(res.status, 0, res.stderr);
  // Every verb must appear in the usage header — a subcommand that exists but
  // isn't listed is one nobody finds.
  assert.match(res.stdout, /maude hub <[a-z|-]+> \[options\]/);
  for (const verb of [
    'serve',
    'token',
    'status',
    'deploy',
    'backup',
    'restore-drill',
    'asset-check',
    'purge',
  ]) {
    assert.ok(res.stdout.includes(verb), `usage must mention "${verb}"`);
  }
  assert.match(res.stdout, /token generate --label NAME/);
  assert.match(res.stdout, /token rotate --label NAME/);
  assert.match(res.stdout, /deploy <fly\|docker>/);
});

test('hub token generate without --label exits 2', () => {
  const res = runCli(['hub', 'token', 'generate']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--label <name> is required/);
});

test('hub token generate persists to the store + prints the connect command', () => {
  withDataDir((dataDir) => {
    const res = runCli(['hub', 'token', 'generate', '--label', 'alice', '--data', dataDir]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /label:\s+alice/);
    assert.match(res.stdout, /value:\s+mau_[0-9a-f]{32}/);
    assert.match(res.stdout, /maude design link/);

    const { tokens } = readTokens(dataDir);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].label, 'alice');
    // The raw value is never persisted — only labels/metadata are listable.
    assert.equal(tokens[0].value, undefined);
  });
});

test('hub token generate --label is idempotent (overwrites in place)', () => {
  withDataDir((dataDir) => {
    runCli(['hub', 'token', 'generate', '--label', 'alice', '--data', dataDir]);
    runCli(['hub', 'token', 'generate', '--label', 'alice', '--data', dataDir]);

    assert.equal(readTokens(dataDir).tokens.length, 1);
  });
});

test('hub token generate --dev uses mau_dev_ prefix', () => {
  withDataDir((dataDir) => {
    const res = runCli(['hub', 'token', 'generate', '--label', 'dev', '--data', dataDir, '--dev']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /value:\s+mau_dev_[0-9a-f]{32}/);
  });
});

test("hub token generate --scope '*' mints a hub-wide (wildcard) token", () => {
  withDataDir((dataDir) => {
    // Array-arg spawn (no shell) → '*' is passed literally, not glob-expanded.
    const res = runCli([
      'hub',
      'token',
      'generate',
      '--label',
      'peer',
      '--scope',
      '*',
      '--data',
      dataDir,
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /scope:\s+\*/);
    const { tokens } = readTokens(dataDir);
    assert.equal(tokens.length, 1);
    // Wildcard is stored as NULL and surfaced as '*' — authorizes any documentName.
    assert.equal(tokens[0].scope, '*');
  });
});

test('hub token generate --scope <value> binds the token to that documentName prefix', () => {
  withDataDir((dataDir) => {
    const res = runCli([
      'hub',
      'token',
      'generate',
      '--label',
      'peer',
      '--scope',
      'team-x',
      '--data',
      dataDir,
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /scope:\s+team-x/);
    assert.equal(readTokens(dataDir).tokens[0].scope, 'team-x');
  });
});

test('hub token generate without --scope defaults the scope to the label (DDR-053)', () => {
  withDataDir((dataDir) => {
    runCli(['hub', 'token', 'generate', '--label', 'alice', '--data', dataDir]);
    assert.equal(readTokens(dataDir).tokens[0].scope, 'alice');
  });
});

test('hub token rotate mints a fresh value for an existing label', () => {
  withDataDir((dataDir) => {
    const gen = runCli(['hub', 'token', 'generate', '--label', 'alice', '--data', dataDir]);
    const firstValue = /value:\s+(mau_[0-9a-f]{32})/.exec(gen.stdout)?.[1];
    assert.ok(firstValue, 'generate printed a value');

    const rot = runCli(['hub', 'token', 'rotate', '--label', 'alice', '--data', dataDir]);
    assert.equal(rot.status, 0, rot.stderr);
    const rotatedValue = /value:\s+(mau_[0-9a-f]{32})/.exec(rot.stdout)?.[1];
    assert.ok(rotatedValue, 'rotate printed a value');
    assert.notEqual(rotatedValue, firstValue, 'rotate changed the value');
    assert.match(rot.stdout, /rotated in/);
    // Still exactly one token under that label.
    assert.equal(readTokens(dataDir).tokens.length, 1);
  });
});

test('hub token rotate on a missing label exits 1', () => {
  withDataDir((dataDir) => {
    const res = runCli(['hub', 'token', 'rotate', '--label', 'ghost', '--data', dataDir]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no token with label "ghost"/);
  });
});

test('hub deploy fly emits fly.toml + Dockerfile with substituted placeholders', () => {
  withDataDir((outDir) => {
    const res = runCli([
      'hub',
      'deploy',
      'fly',
      '--name',
      'maude-hub-test',
      '--region',
      'fra',
      '--out',
      outDir,
    ]);
    assert.equal(res.status, 0, res.stderr);
    const flyToml = readFileSync(join(outDir, 'fly.toml'), 'utf8');
    assert.match(flyToml, /app = "maude-hub-test"/);
    assert.match(flyToml, /primary_region = "fra"/);
    assert.doesNotMatch(flyToml, /\{\{/, 'no unsubstituted placeholders');
    assert.ok(existsSync(join(outDir, 'Dockerfile')), 'Dockerfile copied alongside');
  });
});

test('hub deploy docker emits compose + Caddyfile with the image tag', () => {
  withDataDir((outDir) => {
    const res = runCli(['hub', 'deploy', 'docker', '--tag', 'v9.9.9', '--out', outDir]);
    assert.equal(res.status, 0, res.stderr);
    const compose = readFileSync(join(outDir, 'docker-compose.yml'), 'utf8');
    assert.match(compose, /ghcr\.io\/1agh\/maude-hub:v9\.9\.9/);
    assert.doesNotMatch(compose, /\{\{/, 'no unsubstituted placeholders');
    assert.ok(existsSync(join(outDir, 'Caddyfile')), 'Caddyfile emitted');
  });
});

test('hub deploy refuses to overwrite without --force', () => {
  withDataDir((outDir) => {
    runCli(['hub', 'deploy', 'docker', '--out', outDir]);
    const res = runCli(['hub', 'deploy', 'docker', '--out', outDir]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /already exists.*--force/s);
  });
});

test('hub deploy with an unknown target exits 2', () => {
  const res = runCli(['hub', 'deploy', 'kubernetes']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /target must be one of/);
});

test('hub status against an unreachable URL exits 1 with diagnostic', () => {
  const res = runCli(['hub', 'status', 'http://127.0.0.1:1']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /cannot reach/);
});

test('hub serve|token|status are the only known subcommands', () => {
  const res = runCli(['hub', 'nope']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown subcommand "nope"/);
});
