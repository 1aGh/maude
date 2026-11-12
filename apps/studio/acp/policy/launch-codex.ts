// F4 (B3) — Codex's launch policy: the agent-native boundary Maude writes per session.
// Contract: .ai/plans/notes/universal-acp-contract.md § "Launch policies" + DDR-252.
//
// codex-acp takes no CLI flags; everything rides env on the adapter:
//   CODEX_PATH          the user's own codex (realpath from discovery), never a bundled one
//   INITIAL_AGENT_MODE  workspace-write: the default `agent` mode hands escalations to Codex's own
//                       "Guardian" model reviewer and never asks the person
//   CODEX_CONFIG        a permission profile `maude` on top of `:workspace`. `:workspace` alone confines
//                       writes and network but NOT reads (codex-sandbox.txt: a credential outside the
//                       project was read). So the profile denies the user trees, re-allows each read
//                       root `read` and the scope + chat scratch `write`, and denies every credential
//                       store `none`. Seatbelt applies the most specific path, so a credential store
//                       inside a root stays denied (measured on 0.154 and 0.166, profile B).
//                       S1 (security review 2026-11-12): Codex's writes inside its workspace never
//                       reach Maude's write gate, so what the gate protects in a project is in the
//                       profile itself (`codexProtectedPaths` + `codexProtectedGlobs`), and the temp
//                       folders other chats and sessions use are denied (`systemDenies`).
//
// Network: stays off through the `:workspace` base (`networkAccess:false`), and Codex's own web
// search is removed with `web_search:"disabled"`. Both stay off when the person's "Search the web"
// switch is ON: Maude's web tools (`maude design fetch-asset` …) are separate and gated by the bridge;
// opening the sandbox's network or Codex's search would be a second, unaccounted egress path. The note
// reads "web off ↔ may.web" in one row and "web_search disabled" unconditionally in the policy; this
// takes the narrower reading.
//
// Pure: no file system, no process. The host (platform + home) is a parameter so tests stay exact.

import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { RUNTIME_STATE_DIRS, RUNTIME_STATE_FILES } from '../../sync/file-membership.ts';
import type { LaunchPolicy, PolicyCtx } from '../agents/descriptor.ts';
import { AGENT_RUNTIME_OUTPUTS, PROTECTED_IN_PROJECT, PROTECTED_PREFIXES } from '../write-scope.ts';

export type FsAccess = 'none' | 'read' | 'write';

export interface LaunchHost {
  platform: NodeJS.Platform;
  home: string;
  /**
   * S1 (A3) — this server's own temp folder, canonical (macOS: `/private/var/folders/<…>/T`). Every
   * chat's scratch lives under it (`chatScratchDir`), so it is denied and the chat's own scratch is
   * re-allowed. Omitted → only the fixed temp folders are denied.
   */
  tmpdir?: string;
}

function realTmpdir(): string | undefined {
  try {
    return realpathSync(tmpdir());
  } catch {
    return undefined;
  }
}

export function currentHost(): LaunchHost {
  return { platform: process.platform, home: process.env.HOME || homedir(), tmpdir: realTmpdir() };
}

const DISK_ROOT = resolve(sep);

/** An absolute, normalised path (no trailing separator, no `..`); anything else throws. */
export function absPath(p: unknown, what: string): string {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0') || !isAbsolute(p)) {
    throw new Error(`launch policy: ${what} must be an absolute path, got ${JSON.stringify(p)}`);
  }
  return resolve(p);
}

/** A grant root: absolute, and never the disk root (a grant there would cancel every deny). */
export function rootPath(p: unknown, what: string): string {
  const abs = absPath(p, what);
  if (abs === DISK_ROOT) throw new Error(`launch policy: ${what} may not be the disk root`);
  return abs;
}

export const inside = (p: string, root: string) =>
  p === root || p.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

/**
 * The folders that hold people's files, denied wholesale before the roots are re-allowed: the
 * platform's user and volume trees, plus the parent of this home (any layout), or the home itself when
 * it sits directly under the disk root (root's `/root`).
 */
export function userTrees(host: LaunchHost): string[] {
  const out = new Set<string>();
  if (host.platform === 'darwin') {
    out.add('/Users');
    out.add('/Volumes');
  } else if (host.platform === 'linux') {
    out.add('/home');
  }
  if (host.home && isAbsolute(host.home)) {
    const home = resolve(host.home);
    const parent = dirname(home);
    if (home !== DISK_ROOT) out.add(parent === DISK_ROOT ? home : parent);
  }
  return [...out];
}

/**
 * S1 (attacker A3) — folders outside the user trees that `:workspace` would let Codex read: the
 * temp folders other sessions and other chats write (`/private/tmp`: every Claude Code session's
 * command output; this server's temp folder: every other chat's scratch) and the local databases a
 * package manager keeps (`/opt/homebrew/var`, `/usr/local/var`). `none`; the chat's own scratch is a
 * write root and so re-allowed (more specific). Codex itself runs outside the sandbox, and the
 * commands it runs get the chat scratch as TMPDIR (spawn.ts), so they keep a writable temp folder
 * (measured, S1: `scratch-write`).
 */
export function systemDenies(host: LaunchHost): string[] {
  const out = new Set<string>();
  if (host.platform === 'darwin') {
    for (const p of ['/private/tmp', '/private/var/tmp', '/opt/homebrew/var', '/usr/local/var']) {
      out.add(p);
    }
  } else if (host.platform === 'linux') {
    for (const p of ['/tmp', '/var/tmp', '/usr/local/var']) out.add(p);
  }
  if (host.tmpdir && isAbsolute(host.tmpdir)) {
    const t = resolve(host.tmpdir);
    if (t !== DISK_ROOT && ![...out].some((o) => inside(t, o))) out.add(t);
  }
  return [...out];
}

/**
 * macOS spells `/var`, `/tmp` and `/etc` through symlinks into `/private`; Seatbelt matches the real
 * path. A root given in the short spelling (`tmpdir()` → `/var/folders/…`, how `chatScratchDir`
 * names the chat scratch) is granted in both, so a deny on the `/private` form never out-ranks it.
 */
export function spellings(p: string, host: LaunchHost): string[] {
  if (host.platform !== 'darwin') return [p];
  return /^\/(var|tmp|etc)(\/|$)/.test(p) ? [p, `/private${p}`] : [p];
}

/**
 * S1 (attacker A2) — in-project names that reach execution without a further agent action
 * (write-scope.ts `PROTECTED_IN_PROJECT`, the bridge write gate's list). Codex's writes inside its
 * workspace are never sent to that gate (`workspace-write` does not ask), so the profile itself
 * denies them. The agent-config names S2 adds to `PROTECTED_IN_PROJECT` are named here as well, so
 * the result does not depend on which change lands first.
 *
 * The root `.git` is NOT `none`: Codex's own `:workspace` protection keeps `.git` (and `.codex`,
 * `.agents`) READ-ONLY at each workspace root (measured, S1, 0.154 / 0.165 / 0.166: a write to an
 * existing `.git/config` and the creation of `.git/` both fail), and read-only is what Maude wants:
 * `none` would stop `git status`. A NESTED `.git` (a submodule's) is `none` by glob
 * (`codexProtectedGlobs`).
 */
export const CODEX_PROTECTED_NAMES: readonly string[] = [
  ...new Set([
    ...PROTECTED_IN_PROJECT.filter((n) => n !== '.git'),
    '.claude',
    '.mcp.json',
    '.codex',
    '.opencode',
    '.gemini',
    'AGENTS.md',
    'opencode.json',
    'opencode.jsonc',
  ]),
];

/** Protected multi-segment paths, root-level only (write-scope.ts `PROTECTED_PREFIXES`). */
export const CODEX_PROTECTED_PREFIXES: readonly string[] = [
  ...new Set([...PROTECTED_PREFIXES.map((p) => p.join(sep)), join('.ai', 'workflows.config.json')]),
];

/**
 * The absolute `none` entries for one root: each protected name and prefix right under it.
 * Measured (S1): `none` stops a write to an existing file, a write into an existing folder and the
 * creation of a missing one; `read` does NOT (codex-acp's `workspace-write` turn policy makes the cwd
 * writable and out-ranks it, F6b). The cost: Codex cannot READ these either (no `package.json`, no
 * `node_modules`, so no `npm` / `bun` scripts in the project; contract note "Security fixes S1").
 */
export function codexProtectedPaths(root: string): string[] {
  return [...CODEX_PROTECTED_NAMES, ...CODEX_PROTECTED_PREFIXES].map((n) => join(root, n));
}

/**
 * The same names at ANY depth, as `:workspace_roots` globs: the bridge gate matches a protected
 * segment anywhere in a path (`sub/package.json`, `sub/.claude/…`). Both the name and its subtree:
 * `**` + `/x` alone stops creating `x` but not a write into an existing `x/` (measured, S1). Seatbelt
 * matches them when a file is created, not from a snapshot (measured on macOS: new nested files were
 * refused). A nested `.git` is denied this way (at least one folder deep); the root one stays
 * Codex's own read-only.
 */
export function codexProtectedGlobs(): Record<string, FsAccess> {
  const out: Record<string, FsAccess> = {};
  for (const n of CODEX_PROTECTED_NAMES) {
    out[`**/${n}`] = 'none';
    out[`**/${n}/**`] = 'none';
  }
  out['*/**/.git'] = 'none';
  out['*/**/.git/**'] = 'none';
  return out;
}

/**
 * S1 (attacker A5) — each design root's root-level runtime FILES (`_server.json`, `_active.json`,
 * `_sync.json`, … `RUNTIME_STATE_FILES`), named as exact files (Seatbelt takes a file path that does
 * not exist yet: measured). `_active.json` steers the scope of the next `/design:edit`; `_server.json`
 * tells the `maude design` verbs which server to talk to.
 */
export function runtimeStateFiles(
  designRoots: readonly string[],
  writeRoots: readonly string[]
): string[] {
  const out = new Set<string>();
  for (const d of designRoots) {
    const root = absPath(d, 'design root');
    if (!writeRoots.some((w) => inside(root, w))) continue;
    for (const name of RUNTIME_STATE_FILES) out.add(join(root, `_${name}.json`));
  }
  return [...out];
}

/**
 * B3 — each design root's runtime-state folders (the DDR-115 taxonomy, `RUNTIME_STATE_DIRS`:
 * `_canvas-state`, `_state`, `_chat`, `_comments`, `_untrusted`, `_history`, `_trash`, `_draw`,
 * `_smoke`, …). Those the agent does not own are `none` inside the writable scope (see
 * codexFilesystem): Codex never plants a chat transcript, a comment or a grant-adjacent state file.
 * Only the top-level folders of each design root are named here; the root-level runtime FILES are
 * `runtimeStateFiles` (S1, A5: the bridge's write gate never sees a Codex write inside its
 * workspace, so the profile names them). A design root outside every write root is skipped: naming
 * it would widen what Codex reads.
 */
export function runtimeStateDirs(
  designRoots: readonly string[],
  writeRoots: readonly string[]
): string[] {
  const out = new Set<string>();
  for (const d of designRoots) {
    const root = absPath(d, 'design root');
    if (!writeRoots.some((w) => inside(root, w))) continue;
    for (const name of RUNTIME_STATE_DIRS) out.add(join(root, `_${name}`));
  }
  return [...out];
}

/**
 * The `permissions.maude.filesystem` map (path → access), most specific path wins in Seatbelt. The
 * `:workspace_roots` key holds the depth-independent protected-name globs (`codexProtectedGlobs`).
 */
export function codexFilesystem(
  ctx: PolicyCtx,
  host: LaunchHost = currentHost()
): Record<string, FsAccess | Record<string, FsAccess>> {
  const creds = [
    ...ctx.credentialPaths.dirs.map((d) => absPath(d, 'credential dir')),
    ...ctx.credentialPaths.files.map((f) => absPath(f, 'credential file')),
  ];
  const scope = rootPath(ctx.scopeRoot, 'scopeRoot');
  const reads = ctx.readRoots.map((r) => rootPath(r, 'read root'));
  const writes = [scope, ...ctx.writeRoots.map((r) => rootPath(r, 'write root'))];
  // A grant inside (or on) a credential store would be MORE specific than its `none` and win: drop it.
  const granted = (r: string) => !creds.some((c) => inside(r, c));

  const fs = new Map<string, FsAccess>();
  for (const t of userTrees(host)) fs.set(t, 'none');
  for (const t of systemDenies(host)) fs.set(t, 'none');
  for (const r of reads) if (granted(r)) for (const p of spellings(r, host)) fs.set(p, 'read');
  for (const w of writes) if (granted(w)) for (const p of spellings(w, host)) fs.set(p, 'write');
  // Runtime state the agent does not own is `none`. Measured (F6b, codex 0.154/0.165/0.166): a
  // `read` entry inside a `write` root does NOT stop a write in Seatbelt, `none` does. The folders the
  // agent may write for Claude too (`AGENT_RUNTIME_OUTPUTS`: _history, _draw, _smoke …) stay writable.
  // A runtime folder that IS a write root (none today: the chat scratch lives in the temp folder) is
  // left alone.
  for (const r of runtimeStateDirs(ctx.designRoots, writes)) {
    if (AGENT_RUNTIME_OUTPUTS.includes(basename(r))) continue;
    if (granted(r) && fs.get(r) !== 'write') fs.set(r, 'none');
  }
  // S1 — the root-level runtime files (A5) and everything the bridge gate protects in a project
  // (A2), under every write root and every design root inside one. A path that IS a write root keeps
  // its `write` (none today).
  const deny = (path: string) => {
    for (const p of spellings(path, host)) if (fs.get(p) !== 'write') fs.set(p, 'none');
  };
  for (const f of runtimeStateFiles(ctx.designRoots, writes)) deny(f);
  const designInside = ctx.designRoots
    .map((d) => absPath(d, 'design root'))
    .filter((d) => writes.some((w) => inside(d, w)));
  for (const root of new Set([...writes, ...designInside])) {
    for (const p of codexProtectedPaths(root)) deny(p);
  }
  for (const c of creds) fs.set(c, 'none');
  return { ...Object.fromEntries(fs), ':workspace_roots': codexProtectedGlobs() };
}

/**
 * B7 (DDR-252) — the env Codex hands the commands it runs. A BYOK key rides Codex's own env
 * (OPENAI_API_KEY, acp/agents/chat-key.ts) and must never reach a shell command the model writes.
 * Codex's built-in excludes (`*KEY*`, `*TOKEN*`, applied unless `ignore_default_excludes`) would
 * already drop it, but the default of that switch has moved between releases, so both are stated:
 * the built-in filter on, plus every vendor-credential pattern named (case-insensitive globs, read by
 * codex 0.154's ShellEnvironmentPolicyToml: inherit / ignore_default_excludes / exclude / set /
 * include_only). Unit-tested (test/acp-chat-keys.test.ts); a live run is the conformance probe's job.
 */
export const CODEX_SHELL_ENV_POLICY = Object.freeze({
  inherit: 'all',
  ignore_default_excludes: false,
  exclude: [
    'OPENAI_*',
    'CODEX_API_KEY',
    'DEFAULT_AUTH_REQUEST',
    'ANTHROPIC_*',
    'GEMINI_*',
    'GOOGLE_API_KEY',
    '*_API_KEY',
    '*KEY*',
    '*TOKEN*',
    '*SECRET*',
  ],
});

/** The CODEX_CONFIG object (serialised by the launch policy). */
export function codexConfig(ctx: PolicyCtx, host: LaunchHost = currentHost()) {
  return {
    web_search: 'disabled',
    default_permissions: 'maude',
    permissions: {
      maude: { extends: ':workspace', filesystem: codexFilesystem(ctx, host) },
    },
    // B0 open question 3: these empty tables MERGE with the config.toml Codex reads (measured, F6),
    // so they are not what keeps the person's MCP servers and hooks off: the Maude-owned CODEX_HOME is
    // (codex-home.ts, F6b). Kept so a server the session config could add stays empty.
    mcp_servers: {},
    hooks: {},
    shell_environment_policy: CODEX_SHELL_ENV_POLICY,
  };
}

/**
 * `codexHome` (F6b): the Maude-owned CODEX_HOME (`ensureMaudeCodexHome`, codex-home.ts) — never the
 * person's, whose config.toml / hooks.json would start their MCP servers and hooks outside the
 * sandbox. Omitted only by the pure tests of the profile itself.
 */
export function codexLaunchPolicy(
  ctx: PolicyCtx,
  host: LaunchHost = currentHost(),
  codexHome?: string
): LaunchPolicy {
  return {
    env: {
      ...(codexHome ? { CODEX_HOME: absPath(codexHome, 'codexHome') } : {}),
      CODEX_PATH: absPath(ctx.agentBin, 'agentBin'),
      INITIAL_AGENT_MODE: 'workspace-write',
      CODEX_CONFIG: JSON.stringify(codexConfig(ctx, host)),
    },
  };
}
