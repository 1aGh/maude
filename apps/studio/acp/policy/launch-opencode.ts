// F4 (B3) — opencode's launch policy: the agent-native boundary Maude writes per session.
// Contract: .ai/plans/notes/universal-acp-contract.md § "Launch policies" + DDR-252.
//
// opencode has no OS sandbox; its own permission engine is the read boundary. Measured (B0,
// opencode-mock-extdir-nongit): under `external_directory:"deny"` opencode itself refuses outside
// read / write / glob and `bash cat ../x`. The boundary is the GIT ROOT, not cwd (a named gap).
//
// - `read:"allow"`: a `read:"ask"` request reaches the bridge with no path (`locations:[]`,
//   `rawInput:{}`) and is unclassifiable, so reads are left to `external_directory`.
// - `edit`/`bash:"ask"`: every write and shell call reaches the bridge's gate (enforce.ts).
// - `webfetch`/`websearch:"deny"`: removes the tools. Stays denied when the person's "Search the web"
//   switch is ON: Maude's web tools are separate and gated by the bridge (narrower reading; see
//   launch-codex.ts).
// - The block is repeated at `agent.build.permission` and `agent.plan.permission` (B0 open q. 6): an
//   agent-level block in the person's global config may beat the global one.
// - The person's own MCP servers and plugins (open q. 3) would run outside every gate. `mcp:{}` MERGES
//   with the global opencode.json (measured, F6), so F6b names each of the person's servers
//   `enabled:false` (opencode-user-config.ts reads them at spawn), and OPENCODE_PURE=1 skips every
//   external plugin, config-listed or in a plugin folder (measured, F6b).
//
// Pure: no file system, no process.

import type { LaunchPolicy, PolicyCtx } from '../agents/descriptor.ts';
import { absPath, inside, rootPath } from './launch-codex.ts';
import { disabledMcp, type PersonOpencodeConfig } from './opencode-user-config.ts';

/**
 * B0 open question 2: `external_directory` as a path map that re-allows the read roots.
 *
 * Measured in F4 (contract note, "F4 measurement"; opencode 1.18.30, project outside git): a map
 * `{"*":"deny","<root>/**":"allow",…}` re-allows read / glob / `bash cat` under a root and keeps
 * everything else refused. Rules are LAST MATCH WINS (a credential deny written before the allow
 * was overridden), so the order in `externalDirectory` is load-bearing. `grep`/`glob` are judged by
 * their SEARCH root only: a grep over an allowed root read a credential file inside it. Hence a
 * root that contains (or sits in) a credential store is never re-allowed.
 *
 * `true` = the measured map; `false` = the string `"deny"` (B0), which leaves every read root
 * outside the git root unreadable for opencode.
 */
export const OPENCODE_EXTERNAL_DIRECTORY_MAP = true;

/** Env flags: never the served repo's own config, never ~/.claude, no updates/sharing/downloads. */
export const OPENCODE_FLAGS: Readonly<Record<string, string>> = Object.freeze({
  // the served repo is untrusted (DDR-054 / DDR-144 F2 analog)
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  // don't import ~/.claude instructions/skills into a non-Claude agent
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  // F6b — no external plugins at all (config `plugin` entries and plugin folders): a plugin is code
  // that runs inside opencode's own process, outside every Maude gate.
  OPENCODE_PURE: '1',
});

type Rule = 'allow' | 'ask' | 'deny';

/** The `external_directory` value: the map built from the read roots, or the string `"deny"`. */
export function externalDirectory(
  ctx: PolicyCtx,
  useMap: boolean = OPENCODE_EXTERNAL_DIRECTORY_MAP
): Rule | Record<string, Rule> {
  const roots = ctx.readRoots.map((r) => rootPath(r, 'read root'));
  const creds = [
    ...ctx.credentialPaths.dirs.map((d) => absPath(d, 'credential dir')),
    ...ctx.credentialPaths.files.map((f) => absPath(f, 'credential file')),
  ];
  if (!useMap) return 'deny';
  // A root on, in, or around a credential store is not re-allowed: grep/glob over it would reach
  // the store's contents whatever the deny below says (measured).
  const clear = (r: string) => !creds.some((c) => inside(r, c) || inside(c, r));
  // Last match wins (measured): deny all, re-allow the roots, then deny the credential stores again.
  const map: Record<string, Rule> = { '*': 'deny' };
  for (const r of roots) if (clear(r)) map[`${r}/**`] = 'allow';
  for (const c of creds) {
    map[c] = 'deny';
    map[`${c}/**`] = 'deny';
  }
  return map;
}

export function opencodePermission(
  ctx: PolicyCtx,
  useMap: boolean = OPENCODE_EXTERNAL_DIRECTORY_MAP
) {
  return {
    read: 'allow',
    edit: 'ask',
    bash: 'ask',
    external_directory: externalDirectory(ctx, useMap),
    webfetch: 'deny',
    websearch: 'deny',
    // Security review 2026-11-12 (attacker A4): no sub-agents. A `task` child runs as another opencode
    // agent (`general`, `explore`, or one from the person's own config), whose own permission block
    // wins over this one; Maude repeats its block only for build/plan. Measured on 1.18.30 with the
    // conformance probe (contract note, "A4").
    task: 'deny',
  } as const;
}

/** The person's config as far as the launch policy needs it: which MCP servers to switch off. */
export type OpencodePerson = Pick<PersonOpencodeConfig, 'mcpNames'>;

export function opencodeConfig(
  ctx: PolicyCtx,
  useMap: boolean = OPENCODE_EXTERNAL_DIRECTORY_MAP,
  person: OpencodePerson = { mcpNames: [] }
) {
  absPath(ctx.scopeRoot, 'scopeRoot');
  for (const w of ctx.writeRoots) absPath(w, 'write root');
  const permission = opencodePermission(ctx, useMap);
  return {
    permission,
    agent: { build: { permission }, plan: { permission } },
    mcp: disabledMcp(person.mcpNames),
    plugin: [],
  };
}

export function opencodeLaunchPolicy(
  ctx: PolicyCtx,
  useMap: boolean = OPENCODE_EXTERNAL_DIRECTORY_MAP,
  person: OpencodePerson = { mcpNames: [] }
): LaunchPolicy {
  return {
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig(ctx, useMap, person)),
      ...OPENCODE_FLAGS,
    },
  };
}
