/**
 * Fixtures for the git-lifecycle UI scenario (DDR-133). A LOCAL world — no GitHub, no network, no credentials
 * (decision `v2-p8-e2e-lifecycle-local-bare-remote`; the real GitHub push is checked once in the live checks):
 *
 * `remote`   — a bare repo (`git init --bare`) seeded with the e2e design project on `main`. It plays the team's
 *              GitHub repo: the spec reads its branches with `git --git-dir`, and moves it (a teammate branch, an
 *              out-of-band commit) the same way.
 * `primary`  — a clone of that bare repo, on a clean `main`, the project the app boots into.
 * `secondary`— the offline make-git-fixture repo, the target of the switch-repos step.
 *
 * Why the clone's `origin` is an `ssh://` URL and not `file://`: the product REFUSES to fetch from a file/local
 * remote (git/service.ts `classifyRemoteUrl` → 'unsafe', DDR-131 hardening — a local transport is a local-read
 * vector), so Fetch and Get latest would never run against a `file://` origin. `ssh://maude-e2e.invalid/<bare>` is
 * classified `ssh` (system git, never a token), and `GIT_SSH_COMMAND` is a shim that ignores the host and runs the
 * requested `git-upload-pack` / `git-receive-pack` on the local bare repo — so the bytes never leave the machine.
 * `GIT_SSH_VARIANT=simple` keeps git from probing the shim as OpenSSH; `GIT_ALLOW_PROTOCOL=ssh` makes any other
 * transport (https to GitHub included) a hard error for the app. No credential helper is configured on the clone.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeGitFixture } from './make-git-fixture';

const HERE = dirname(fileURLToPath(import.meta.url));
/** A reserved name (RFC 6761): nothing resolves it, and the shim never dials it. */
export const LIFECYCLE_REMOTE_HOST = 'maude-e2e.invalid';

export interface LifecycleFixture {
  primary: string;
  secondary: string;
  /** the bare repo — the team's remote */
  remote: string;
  /** the env the app and the spec's own git need to reach `remote` through the ssh shim */
  env: Record<string, string>;
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Maude E2E',
  GIT_AUTHOR_EMAIL: 'e2e@maude.local',
  GIT_COMMITTER_NAME: 'Maude E2E',
  GIT_COMMITTER_EMAIL: 'e2e@maude.local',
};

function git(cwd: string, env: Record<string, string>, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...IDENTITY, ...env },
  }).trim();
}

/**
 * The ssh stand-in. git (variant `simple`) calls it as `<shim> <host> "git-upload-pack '<path>'"`; it drops the host
 * and runs the pack command through the local git — never a socket.
 */
const SHIM = `#!/bin/sh
# maude e2e: a local stand-in for ssh — the host is ignored, the pack command runs on this machine
cmd="$2"
case "$cmd" in
  git-upload-pack\\ *|git-receive-pack\\ *|git-upload-archive\\ *) ;;
  *) echo "maude-e2e ssh shim: refused: $cmd" >&2; exit 1 ;;
esac
eval "exec git \${cmd#git-}"
`;

export function makeLifecycleFixture(): LifecycleFixture {
  const world = join(tmpdir(), 'maude-e2e-lifecycle-world');
  rmSync(world, { recursive: true, force: true });
  mkdirSync(world, { recursive: true });
  const remote = join(world, 'remote.git');
  const seed = join(world, 'seed');
  const primary = join(world, 'primary');
  const shim = join(world, 'ssh-shim.sh');
  writeFileSync(shim, SHIM);
  chmodSync(shim, 0o755);
  const env = {
    GIT_SSH_COMMAND: shim,
    GIT_SSH_VARIANT: 'simple',
    GIT_ALLOW_PROTOCOL: 'ssh',
  };

  // the team's repo: bare, `main` holds a bootable design project
  git(world, {}, 'init', '--bare', '-b', 'main', remote);
  mkdirSync(seed);
  cpSync(join(HERE, 'project', '.design'), join(seed, '.design'), { recursive: true });
  git(seed, {}, 'init', '-b', 'main');
  git(seed, {}, 'add', '-A');
  git(seed, {}, 'commit', '-m', 'fixture: initial design project');
  git(seed, env, 'push', `ssh://${LIFECYCLE_REMOTE_HOST}${remote}`, 'main');
  rmSync(seed, { recursive: true, force: true });

  // the person's clone, through the same shim the app will use
  git(world, env, 'clone', `ssh://${LIFECYCLE_REMOTE_HOST}${remote}`, primary);
  git(primary, {}, 'config', 'user.name', IDENTITY.GIT_AUTHOR_NAME);
  git(primary, {}, 'config', 'user.email', IDENTITY.GIT_AUTHOR_EMAIL);
  // an empty helper resets the list: nothing the developer configured globally is asked for anything
  git(primary, {}, 'config', 'credential.helper', '');

  const secondary = makeGitFixture();
  return { primary, secondary, remote, env };
}

/**
 * `makeLifecycleFixture` once per RUN. A wdio config is evaluated by the launcher
 * AND again by every worker, and @wdio/tauri-service starts the app in the
 * launcher's `onPrepare` — so a worker that re-made the fixture would `rm -rf`
 * the primary (and its `.design/_server.json`) under the app's running server.
 * Workers inherit the launcher's env, so the first evaluation hands its paths
 * down and later ones reuse them.
 */
export function lifecycleFixtureOnce(): LifecycleFixture {
  const made = process.env.MAUDE_E2E_LIFECYCLE_FIXTURE;
  if (made) return JSON.parse(made) as LifecycleFixture;
  const fixture = makeLifecycleFixture();
  process.env.MAUDE_E2E_LIFECYCLE_FIXTURE = JSON.stringify(fixture);
  return fixture;
}
