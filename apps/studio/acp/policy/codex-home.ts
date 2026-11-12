// F6b — the Maude-owned CODEX_HOME the Studio chat's Codex runs with.
// Contract: .ai/plans/notes/universal-acp-contract.md § "F6b — MCP/hooks isolation and flip".
//
// Why: the person's MCP servers and hooks in `$CODEX_HOME/config.toml` (+ `hooks.json`) start
// OUTSIDE the sandbox, and an override in CODEX_CONFIG merges with them instead of replacing them
// (measured, F6: the session config reaches app-server after it started its MCP servers). So the
// chat's Codex never reads the person's Codex home at all. It gets one Maude owns, per profile:
//
//   ~/.config/maude/agents/codex-home/                    profile `default`
//   ~/.config/maude/profiles/<id>/agents/codex-home/      any other profile
//
// That folder holds:
//   • auth.json → a SYMLINK to the person's own `$CODEX_HOME/auth.json` (default ~/.codex), so the
//     sign-in from Settings (which runs `codex login` against the person's own CODEX_HOME,
//     auth.ts) carries over, and a token refresh writes THROUGH the link into the person's file
//     (measured on 0.154: `codex login --with-api-key` under the Maude home kept the link and
//     rewrote the target). A missing target is fine: the link dangles until the person signs in.
//   • config.toml — Maude's, rewritten at every spawn (no MCP servers, no hooks, no plugins,
//     no profiles, no project trust).
//   • whatever Codex itself writes there at runtime (sessions, logs, its own skills cache).
// What is removed at every spawn: the config surfaces Codex reads from its home but never writes
// itself — `hooks.json`, `AGENTS.md`, `AGENTS.override.md` — and `rules/` (exec-policy amendments:
// an `allow` rule there would run a matching command OUTSIDE the sandbox without a card; the
// bridge never picks the "always" option that writes one, so a rule there was planted).
//
// Credentials: the folder sits under `~/.config/maude`, which `credentialPathsFor` denies to every
// agent (Codex's Seatbelt profile `none`, the bridge's live refusal); the person's real auth.json is
// on that list too (may-scope.ts). Codex reads both in its own process, outside the sandbox that
// confines its tool calls.
//
// The served repo's own `.codex/` (measured, F6b, 0.154): codex-acp marks the session folder
// `trust_level = "trusted"` in the session config it sends (its value wins over ours), so Codex loads
// the PROJECT layer `<cwd>/.codex/config.toml`, and an MCP server named there started outside the
// sandbox. A `.codex` above the session folder did not load (untrusted). So a project with a
// `.codex` entry is refused (`refuseProjectCodexConfig`): the repo is untrusted (DDR-054), and
// `.codex/` can also carry hooks, rules and agent roles.
//
// Fail closed: anything unexpected (the folder is a symlink, not ours, not a folder; auth.json is a
// folder) throws, and the chat does not start.

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { resolveProfile } from '../../shell/profile.ts';

export type HostEnv = Readonly<Record<string, string | undefined>>;

const homeOf = (env: HostEnv) => (env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir());

/** The person's own Codex home: `$CODEX_HOME` when absolute, else `~/.codex`. */
export function personCodexHome(env: HostEnv = process.env): string {
  const c = env.CODEX_HOME;
  return c && isAbsolute(c) ? resolve(c) : join(homeOf(env), '.codex');
}

/** The person's own Codex sign-in file (what Settings' Sign in writes). */
export function personCodexAuthFile(env: HostEnv = process.env): string {
  return join(personCodexHome(env), 'auth.json');
}

/** The Maude-owned Codex home for the profile this process runs as. */
export function maudeCodexHomePath(env: HostEnv = process.env): string {
  const { id } = resolveProfile(env as Record<string, string | undefined>, () => {});
  const maude = join(homeOf(env), '.config', 'maude');
  return id === 'default'
    ? join(maude, 'agents', 'codex-home')
    : join(maude, 'profiles', id, 'agents', 'codex-home');
}

/** Throws when the session folder has a `.codex` entry Codex would load as a trusted project layer. */
export function refuseProjectCodexConfig(projectRoot: string): void {
  const p = join(resolve(projectRoot), '.codex');
  let found = false;
  try {
    lstatSync(p);
    found = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (found) {
    throw new Error(
      `This project has a Codex folder (${p}). Codex would load its MCP servers and settings outside the limits Maude sets, so Maude does not start Codex while it is there.`
    );
  }
}

/** Maude's config.toml for the chat's Codex. Deliberately empty of settings. */
export const MAUDE_CODEX_CONFIG_TOML = [
  '# Written by Maude at every Studio chat start; edits here are replaced.',
  "# The chat's Codex runs with this CODEX_HOME so that none of your own MCP servers, hooks,",
  '# plugins or profiles from your Codex config start outside the sandbox. Your sign-in is shared',
  '# through auth.json, a link to your own Codex home.',
  '',
].join('\n');

/** Config surfaces Codex reads from its home but never writes itself; removed at every spawn. */
export const CODEX_HOME_FOREIGN = ['hooks.json', 'AGENTS.md', 'AGENTS.override.md', 'rules'];

function assertOwnedDir(p: string, what: string) {
  const st = lstatSync(p);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Maude's Codex home: ${what} is not a plain folder (${p})`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid) {
    throw new Error(`Maude's Codex home: ${what} is not owned by this user (${p})`);
  }
}

/** mkdir -p, creating every missing level owner-only. */
function mkdirsPrivate(p: string) {
  try {
    lstatSync(p);
    return;
  } catch {
    /* missing */
  }
  mkdirsPrivate(dirname(p));
  try {
    mkdirSync(p, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
}

/**
 * Make (or repair) the Maude-owned Codex home and return its path. Idempotent; safe to run for
 * every spawn while other chats' Codex processes use the same folder (config.toml is replaced by
 * rename, the link only when it is wrong).
 */
export function ensureMaudeCodexHome(env: HostEnv = process.env): string {
  const home = maudeCodexHomePath(env);
  const target = personCodexAuthFile(env);
  if (home === personCodexHome(env) || resolve(target) === resolve(home, 'auth.json')) {
    throw new Error("Maude's Codex home: CODEX_HOME already points at Maude's own folder");
  }
  mkdirsPrivate(home);
  assertOwnedDir(home, 'the folder');
  chmodSync(home, 0o700);

  const link = join(home, 'auth.json');
  let current: string | null = null;
  try {
    const st = lstatSync(link);
    if (st.isDirectory()) throw new Error(`Maude's Codex home: auth.json is a folder (${link})`);
    current = st.isSymbolicLink() ? readlinkSync(link) : '';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (current !== target) {
    if (current !== null) unlinkSync(link);
    symlinkSync(target, link);
  }

  for (const name of CODEX_HOME_FOREIGN) rmSync(join(home, name), { recursive: true, force: true });

  const cfg = join(home, 'config.toml');
  const tmp = join(home, `.config.toml.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, MAUDE_CODEX_CONFIG_TOML, { mode: 0o600 });
  renameSync(tmp, cfg);
  return home;
}
