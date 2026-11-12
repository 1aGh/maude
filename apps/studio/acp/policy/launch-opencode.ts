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
// - `mcp:{}` + `plugin:[]` (open q. 3): the person's own MCP servers and plugins would run outside
//   every gate. UNVERIFIED whether OPENCODE_CONFIG_CONTENT replaces or merges these with the global
//   config's: the conformance probe (F6) must plant one and check it does not start.
//
// Pure: no file system, no process.

import type { LaunchPolicy, PolicyCtx } from '../agents/descriptor.ts';
import { absPath } from './launch-codex.ts';

/**
 * B0 open question 2 — `external_directory` as a path map that re-allows the read roots
 * (`{"*":"deny","<root>/**":"allow"}`). Default `false`: the string `"deny"` (measured in B0), so
 * folder grants stay unavailable for opencode. Set from the F4 measurement (contract note,
 * "F4 measurement").
 */
export const OPENCODE_EXTERNAL_DIRECTORY_MAP = false;

/** Env flags: never the served repo's own config, never ~/.claude, no updates/sharing/downloads. */
export const OPENCODE_FLAGS: Readonly<Record<string, string>> = Object.freeze({
  // the served repo is untrusted (DDR-054 / DDR-144 F2 analog)
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  // don't import ~/.claude instructions/skills into a non-Claude agent
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
});

type Rule = 'allow' | 'ask' | 'deny';

/** The `external_directory` value: the measured string, or the opt-in map built from the roots. */
export function externalDirectory(
  ctx: PolicyCtx,
  useMap: boolean = OPENCODE_EXTERNAL_DIRECTORY_MAP
): Rule | Record<string, Rule> {
  const roots = ctx.readRoots.map((r) => absPath(r, 'read root'));
  const creds = [
    ...ctx.credentialPaths.dirs.map((d) => absPath(d, 'credential dir')),
    ...ctx.credentialPaths.files.map((f) => absPath(f, 'credential file')),
  ];
  if (!useMap) return 'deny';
  // Later keys win in opencode's matcher (last match), so: deny all, re-allow the roots, then
  // deny every credential store again in case one sits inside a root.
  const map: Record<string, Rule> = { '*': 'deny' };
  for (const r of roots) map[`${r}/**`] = 'allow';
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
  } as const;
}

export function opencodeConfig(ctx: PolicyCtx, useMap: boolean = OPENCODE_EXTERNAL_DIRECTORY_MAP) {
  absPath(ctx.scopeRoot, 'scopeRoot');
  for (const w of ctx.writeRoots) absPath(w, 'write root');
  const permission = opencodePermission(ctx, useMap);
  return {
    permission,
    agent: { build: { permission }, plan: { permission } },
    mcp: {},
    plugin: [],
  };
}

export function opencodeLaunchPolicy(
  ctx: PolicyCtx,
  useMap: boolean = OPENCODE_EXTERNAL_DIRECTORY_MAP
): LaunchPolicy {
  return {
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig(ctx, useMap)),
      ...OPENCODE_FLAGS,
    },
  };
}
