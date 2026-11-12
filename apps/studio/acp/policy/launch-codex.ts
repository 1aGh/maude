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
//
// Network: stays off through the `:workspace` base (`networkAccess:false`), and Codex's own web
// search is removed with `web_search:"disabled"`. Both stay off when the person's "Search the web"
// switch is ON: Maude's web tools (`maude design fetch-asset` …) are separate and gated by the bridge;
// opening the sandbox's network or Codex's search would be a second, unaccounted egress path. The note
// reads "web off ↔ may.web" in one row and "web_search disabled" unconditionally in the policy; this
// takes the narrower reading.
//
// Pure: no file system, no process. The host (platform + home) is a parameter so tests stay exact.

import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { RUNTIME_STATE_DIRS } from '../../sync/file-membership.ts';
import type { LaunchPolicy, PolicyCtx } from '../agents/descriptor.ts';

export type FsAccess = 'none' | 'read' | 'write';

export interface LaunchHost {
  platform: NodeJS.Platform;
  home: string;
}

export function currentHost(): LaunchHost {
  return { platform: process.platform, home: process.env.HOME || homedir() };
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
 * B3 — each design root's runtime-state folders (the DDR-115 taxonomy, `RUNTIME_STATE_DIRS`:
 * `_canvas-state`, `_state`, `_chat`, `_comments`, `_untrusted`, `_history`, `_trash`, `_draw`,
 * `_smoke`, …), made READ-only inside the writable scope: Codex may read them (the brief says so)
 * but never plant a chat transcript, a comment, a grant-adjacent state file or a history snapshot.
 * Only the top-level folders of each design root are named; the bridge's write gate covers a
 * deeper runtime path and the root-level runtime FILES (`_server.json`, `_active.json`, `_sync.json`
 * …): a permission profile names paths, it cannot glob files, so those are not in the profile.
 * A design root outside every write root is skipped: naming it `read` would widen what Codex reads.
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

/** The `permissions.maude.filesystem` map (path → access), most specific path wins in Seatbelt. */
export function codexFilesystem(
  ctx: PolicyCtx,
  host: LaunchHost = currentHost()
): Record<string, FsAccess> {
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
  for (const r of reads) if (granted(r)) fs.set(r, 'read');
  for (const w of writes) if (granted(w)) fs.set(w, 'write');
  // A runtime folder that IS a write root (none today: the chat scratch lives in the temp folder)
  // stays writable; one that holds a deeper write root is read-only above it, writable below.
  for (const r of runtimeStateDirs(ctx.designRoots, writes)) {
    if (granted(r) && fs.get(r) !== 'write') fs.set(r, 'read');
  }
  for (const c of creds) fs.set(c, 'none');
  return Object.fromEntries(fs);
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
