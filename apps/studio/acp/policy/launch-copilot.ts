// B8 — GitHub Copilot CLI's launch policy (`copilot --acp`): the agent-native boundary Maude writes
// per session. Contract: .ai/plans/notes/universal-acp-contract.md § "B8 — Gemini and Copilot".
//
// Copilot has no OS sandbox unless its own MXC sandbox is switched on; its permission engine is the
// boundary, the bridge's gate the second one (shellGate 'command-text', like opencode):
//   • file tools are held to the working directory (+ the system temp folder, switched off with
//     `--disallow-temp-dir`); anything else is a `session/request_permission` the gate judges;
//   • every shell command and every write asks (no `--allow-*` flag, no allow-all), so each one
//     reaches the gate;
//   • `--deny-tool=url` refuses every URL a shell command or tool names, `--excluded-tools` removes
//     the web tool, `--disable-builtin-mcps` removes GitHub's own MCP servers. Like Codex and
//     opencode, web stays off even when the person's "Search the web" switch is on.
//   • COPILOT_HOME is a Maude-owned folder (agent-home.ts): the person's mcp-config.json,
//     settings.json hooks, plugins, skills, agents, trusted folders and saved URL / tool approvals
//     never load. Maude's settings.json sets `disableAllHooks`.
//   • the served repo's own Copilot config (repo settings / hooks / MCP / agents / skills) loads
//     only for a trusted folder; Maude's home trusts none, and a project carrying any of it is
//     refused anyway (fail closed).
//
// The pure builder takes the home path; `copilotLaunchPolicyFor` makes the home (impure).

import type { LaunchPolicy, PolicyCtx } from '../agents/descriptor.ts';
import {
  ensureMaudeAgentHome,
  type HostEnv,
  refuseProjectEntries,
  upToGitRoot,
} from './agent-home.ts';
import { absPath } from './launch-codex.ts';

export const COPILOT_HOME_NAME = 'copilot-home';

/** Tools removed from the model's list (web), whatever the person's switch says. */
export const COPILOT_EXCLUDED_TOOLS = ['web_fetch', 'web_search'] as const;

/** Maude's settings.json for the chat's Copilot. */
export const MAUDE_COPILOT_SETTINGS = {
  disableAllHooks: true,
  hooks: {},
  trustedFolders: [],
  allowedUrls: [],
  autoUpdate: false,
  sandbox: { enabled: false },
} as const;

/** Copilot config the served repo can carry; any of them stops the spawn (see header). */
export const COPILOT_PROJECT_CONFIG = [
  '.copilot',
  '.github/copilot',
  '.github/hooks',
  '.github/mcp.json',
  '.github/agents',
  '.github/skills',
  '.mcp.json',
] as const;

/** Config surfaces Copilot reads from its home that Maude never writes; removed at every spawn. */
export const COPILOT_HOME_FOREIGN = [
  'hooks',
  'agents',
  'skills',
  'plugins',
  'installed-plugins',
  'copilot-instructions.md',
  'lsp-config.json',
] as const;

export function copilotArgs(): string[] {
  return [
    '--disable-builtin-mcps',
    ...COPILOT_EXCLUDED_TOOLS.map((t) => `--excluded-tools=${t}`),
    '--deny-tool=url',
    '--disallow-temp-dir',
    '--no-auto-update',
  ];
}

/** Pure: the policy for a session, given Maude's Copilot home. */
export function copilotLaunchPolicy(ctx: PolicyCtx, copilotHome: string): LaunchPolicy {
  absPath(ctx.scopeRoot, 'scopeRoot');
  for (const w of ctx.writeRoots) absPath(w, 'write root');
  absPath(copilotHome, 'copilot home');
  return {
    env: { COPILOT_HOME: copilotHome, COPILOT_AUTO_UPDATE: 'false' },
    args: copilotArgs(),
  };
}

/**
 * Throws when the session folder, or any folder above it up to its git root, carries Copilot config
 * (COPILOT_PROJECT_CONFIG). Measured on 1.0.105 (contract note "B8"): a hook in the repo's hooks
 * folder ran in an UNTRUSTED folder, and also from the git root above the session folder.
 */
export function refuseProjectCopilotConfig(projectRoot: string): void {
  for (const dir of upToGitRoot(projectRoot)) {
    refuseProjectEntries(dir, COPILOT_PROJECT_CONFIG, 'Copilot');
  }
}

/** Make (or repair) Maude's Copilot home and return its path (impure). */
export function ensureMaudeCopilotHome(env: HostEnv = process.env): string {
  return ensureMaudeAgentHome(
    {
      name: COPILOT_HOME_NAME,
      foreign: COPILOT_HOME_FOREIGN,
      files: {
        'settings.json': `${JSON.stringify(MAUDE_COPILOT_SETTINGS, null, 2)}\n`,
        'mcp-config.json': `${JSON.stringify({ mcpServers: {} })}\n`,
      },
    },
    env
  );
}

/** The enforcement's launch policy: refuse project config, make the home, build the policy. */
export function copilotLaunchPolicyFor(ctx: PolicyCtx): LaunchPolicy {
  refuseProjectCopilotConfig(ctx.scopeRoot);
  return copilotLaunchPolicy(ctx, ensureMaudeCopilotHome(ctx.hostEnv ?? process.env));
}
