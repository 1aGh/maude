// `maude hub workspace-up` end-to-end via spawnSync — the properties that only
// hold on the REAL command surface, not on the planning layer under it.
//
// Both cases come from the first live AWS run of `workspace-up` (2026-08-20).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');

const { classifyDrillFailure, repeatedFlag } = await import('./hub-workspace.mjs');

function runCli(args, { cwd, env } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'maude-workspace-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const BASE = [
  'hub',
  'workspace-up',
  '--domain',
  'design.acme.com',
  '--acme-email',
  'ops@acme.com',
  '--admin-email',
  'ops@acme.com',
];

// M3 — the recommended seed URL is
// `https://x-access-token:<PAT>@github.com/org/repo.git` (`seed-repo.mjs`
// accepts no other shape), and this command printed it unredacted, `--dry-run`
// included. On the live run the PAT landed in SSM command history, CloudTrail
// and a session transcript, and had to be revoked.
test('--dry-run never prints the seed URL credential', () => {
  withDir((dir) => {
    const r = runCli(
      [...BASE, '--dry-run', '--seed-repo', 'https://x-access-token:SECRET123@github.com/o/r.git'],
      { cwd: dir }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = `${r.stdout}${r.stderr}`;
    assert.ok(!out.includes('SECRET123'), 'the token must not reach stdout or stderr');
    assert.match(out, /https:\/\/\*\*\*@github\.com\/o\/r\.git/);
  });
});

// M2 — `--admin-password` beat the existing `.env`, so the new value was
// written to disk while `seedFirstUser()` (first boot only) kept the old one.
// The verification step then reported `HTTP 401 — the first user cannot sign
// in`, and the only repair anyone found was `docker compose down -v`: on a
// live box, losing the project rather than fixing the password.
test('--admin-password on a re-run is refused, not silently written', () => {
  withDir((dir) => {
    const first = runCli([...BASE, '--dry-run', '--admin-password', 'first-password-ok'], {
      cwd: dir,
    });
    assert.equal(first.status, 0, first.stderr);

    // Stand in for a hub that has already booted once.
    writeFileSync(
      join(dir, '.env'),
      "MAUDE_ADMIN_EMAIL='ops@acme.com'\nMAUDE_ADMIN_PASSWORD='first-password-ok'\nHUB_SECRET='abc'\n",
      { mode: 0o600 }
    );

    const rerun = runCli([...BASE, '--admin-password', 'second-password-ok'], { cwd: dir });
    assert.notEqual(rerun.status, 0, 'a re-run with a new password must not report success');
    assert.match(`${rerun.stdout}${rerun.stderr}`, /already exists/i);
    // The file on disk must still describe the password the database holds.
    assert.match(readFileSync(join(dir, '.env'), 'utf8'), /first-password-ok/);
    assert.ok(!readFileSync(join(dir, '.env'), 'utf8').includes('second-password-ok'));
  });
});

test('a re-run WITHOUT --admin-password still proceeds past the password gate', () => {
  withDir((dir) => {
    writeFileSync(
      join(dir, '.env'),
      "MAUDE_ADMIN_EMAIL='ops@acme.com'\nMAUDE_ADMIN_PASSWORD='first-password-ok'\nHUB_SECRET='abc'\n",
      { mode: 0o600 }
    );
    const r = runCli([...BASE, '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, '.env')));
  });
});

// M1 — on the live AWS run `restore-drill` reported a flat red `failed` for
// something that was not a backup problem at all: the host clone had no
// `node_modules`, so `backup.mjs` died on `Cannot find module
// 'better-sqlite3'`, and the image ships the bundled server rather than
// `cli/bin/maude.mjs`, so there was no third place to try. An operator reading
// "the backup is broken" starts recovering from a problem they do not have.
test('a drill that could not RUN is skipped, not failed', () => {
  const verdict = classifyDrillFailure(
    "maude hub backup: Cannot find module 'better-sqlite3'\nRequire stack: /x/apps/hub/src/backup.mjs"
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.skipped, true, 'unrunnable must not be reported as a failure');
  assert.match(verdict.note, /could not run/i);
});

test('a missing backup engine is skipped too', () => {
  const verdict = classifyDrillFailure(
    'maude hub: the backup engine (apps/hub/src/backup.mjs) was not found.'
  );
  assert.equal(verdict.skipped, true);
});

test('no generation yet is skipped and says when to retry', () => {
  const verdict = classifyDrillFailure('no complete backup generation exists');
  assert.equal(verdict.skipped, true);
  assert.match(verdict.note, /6h/);
});

// The drill doing its job must stay loud — this is the case the skips above
// must never swallow.
test('a REAL restore failure is still a failure', () => {
  const verdict = classifyDrillFailure('restored database has documents 0 — refusing to pass');
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.skipped, 'an empty restore is a genuine failure, not a skip');
  assert.match(verdict.note, /provisioning drill failed/);
});

// M7 — without a canvas domain the stack comes up green and every canvas is a
// blank frame. Verification never catches it (all eight steps pass), so the
// COMMAND has to say it — loudly, in both the dry run and the real one.
test('--dry-run without --canvas-domain warns that canvases will not render remotely', () => {
  withDir((dir) => {
    const r = runCli([...BASE, '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(`${r.stdout}${r.stderr}`, /canvases will NOT render in remote browsers/i);
    assert.match(r.stdout, /canvas\s+NOT SET/);
  });
});

test('--canvas-domain silences the warning and renders the full chain', () => {
  withDir((dir) => {
    const r = runCli([...BASE, '--dry-run', '--canvas-domain', 'canvas.acme.com'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const out = `${r.stdout}${r.stderr}`;
    assert.ok(!/NOT render in remote browsers/i.test(out), 'warning must be gone');
    assert.match(r.stdout, /canvas\s+https:\/\/canvas\.acme\.com/);
    // The duty list tells the operator the second DNS record is on them.
    assert.match(r.stdout, /DNS for the canvas domain/);
  });
});

test('--embed-origin is repeatable and comma-splittable (DDR-242)', () => {
  assert.deepEqual(
    repeatedFlag(
      [
        '--embed-origin',
        'https://a.acme.com',
        '--x',
        'y',
        '--embed-origin=https://b.acme.com, https://c.acme.com',
      ],
      'embed-origin'
    ),
    ['https://a.acme.com', 'https://b.acme.com', 'https://c.acme.com']
  );
  withDir((dir) => {
    const r = runCli(
      [
        ...BASE,
        '--dry-run',
        '--embed-origin',
        'https://orbit.acme.com',
        '--embed-origin',
        'https://b.acme.com',
      ],
      { cwd: dir }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /embeds\s+https:\/\/orbit\.acme\.com https:\/\/b\.acme\.com/);
  });
  withDir((dir) => {
    const r = runCli([...BASE, '--dry-run', '--embed-origin', 'https://*.acme.com'], { cwd: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /embedOrigin/);
  });
});

test('--local does not warn — localhost IS reachable from the browser that matters there', () => {
  withDir((dir) => {
    const r = runCli(
      ['hub', 'workspace-up', '--local', '--admin-email', 'ops@acme.com', '--dry-run'],
      { cwd: dir }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/NOT render in remote browsers/i.test(`${r.stdout}${r.stderr}`));
  });
});

// M10 — `--render` on a host the sidecar image is not published for.
//
// On the live AWS run the flag was accepted, the compose file was written, the
// image PULLED (Docker falls back across architectures on pull), and the truth
// arrived as `exec format error` in a container log — after 2.99 GB. The
// judgement lives in `classifyRenderImage` (unit-tested next door); what is
// only true out here is that the command asks BEFORE it writes.

/**
 * A `docker` on PATH that answers exactly one question — which platforms an
 * image is published for — and exits non-zero for everything else, so a test
 * that slips past the gate fails loudly instead of trying to boot a stack.
 *
 * `manifest inspect --verbose` is the shape the real probe uses: an ARRAY of
 * descriptors for a manifest list, ONE object for a single-platform image.
 */
function withFakeDocker({ platforms, missing = false }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'maude-fake-docker-'));
  let script;
  if (missing) {
    script =
      '#!/bin/sh\ncase "$*" in\n' +
      '  "manifest inspect --verbose "*) echo "manifest unknown" >&2; exit 1 ;;\n' +
      'esac\nexit 90\n';
  } else {
    const descriptor = (p) => ({
      Ref: 'ghcr.io/1agh/maude-render',
      Descriptor: { platform: { os: p.split('/')[0], architecture: p.split('/')[1] } },
    });
    const body = platforms.length === 1 ? descriptor(platforms[0]) : platforms.map(descriptor);
    script =
      '#!/bin/sh\ncase "$*" in\n' +
      '  "manifest inspect --verbose "*) cat <<\'JSON\'\n' +
      `${JSON.stringify(body, null, 2)}\nJSON\n    exit 0 ;;\n` +
      'esac\nexit 90\n';
  }
  const bin = join(dir, 'docker');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  try {
    return fn({ PATH: `${dir}:${process.env.PATH}` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What `hostContainerPlatform()` will report inside the child process. */
const HOST_PLATFORM = `linux/${{ x64: 'amd64', arm64: 'arm64' }[process.arch] ?? process.arch}`;

test('--render on a host the image is not published for refuses, and writes NOTHING', () => {
  withDir((dir) => {
    // s390x so the case holds on any machine this suite runs on.
    const r = withFakeDocker({ platforms: ['linux/s390x'] }, (env) =>
      runCli([...BASE, '--render', '--image-tag', 'v1.0.2'], { cwd: dir, env })
    );
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    const out = `${r.stdout}${r.stderr}`;
    assert.match(out, /--render cannot work on this machine/);
    assert.match(out, /exec format error/);
    assert.match(out, new RegExp(HOST_PLATFORM.replace('/', '\\/')));
    // The whole point: no compose file naming a container that cannot start.
    assert.ok(!existsSync(join(dir, 'docker-compose.yml')), 'no compose file may be written');
    assert.ok(!existsSync(join(dir, '.env')), 'no .env may be written');
  });
});

test('--render without --image-tag says the sidecar has no :latest, before pulling it', () => {
  withDir((dir) => {
    const r = withFakeDocker({ missing: true }, (env) =>
      runCli([...BASE, '--render'], { cwd: dir, env })
    );
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /RELEASE TAGS ONLY/);
    assert.ok(!existsSync(join(dir, 'docker-compose.yml')));
  });
});

test('--render on a multi-arch image covering this host proceeds', () => {
  withDir((dir) => {
    const r = withFakeDocker({ platforms: ['linux/amd64', 'linux/arm64', HOST_PLATFORM] }, (env) =>
      runCli([...BASE, '--render', '--image-tag', 'v1.0.3', '--dry-run'], { cwd: dir, env })
    );
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /DRY RUN/);
    assert.ok(!/cannot work on this machine/.test(`${r.stdout}${r.stderr}`));
  });
});

test('no docker at all is a warning, not a refusal — an offline operator is not the bug', () => {
  withDir((dir) => {
    const r = runCli([...BASE, '--render', '--image-tag', 'v1.0.3', '--dry-run'], {
      cwd: dir,
      // An empty PATH: `which docker` cannot find anything.
      env: { PATH: join(dir, 'nothing-here') },
    });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /could not check whether/);
  });
});
