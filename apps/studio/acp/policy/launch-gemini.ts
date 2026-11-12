// B8 — Gemini CLI's launch policy (`gemini --acp`): the agent-native boundary Maude writes per
// session. Contract: .ai/plans/notes/universal-acp-contract.md § "B8 — Gemini and Copilot".
//
// Gemini has no OS sandbox by default (`-s` re-runs the whole CLI under a Seatbelt profile that
// confines writes, not reads, and whose custom profiles come from the PROJECT's `.gemini/`: not
// used). Its own engine is the boundary, the bridge's gate the second one (shellGate
// 'command-text', like opencode):
//   • file tools are held to the workspace (the session folder); a path outside is refused by
//     Gemini itself;
//   • approval mode is pinned to `default` (every shell command and write asks); `yolo` and
//     `autoEdit` are refused by the bridge and switched off in settings (`disableYoloMode`,
//     `disableAlwaysAllow`);
//   • GEMINI_CLI_HOME is a Maude-owned folder (agent-home.ts): the person's `~/.gemini/settings.json`
//     (MCP servers, hooks, allowed tools), extensions, skills, agents, policies and trusted folders
//     never load. Maude's settings go in BOTH the user settings of that home and the SYSTEM settings
//     file (GEMINI_CLI_SYSTEM_SETTINGS_PATH, the highest-precedence layer): MCP, extensions, skills
//     and hooks off, the web tools excluded, folder trust on;
//   • the served repo's own `.gemini/` (workspace settings, commands, policies, hooks, MCP servers)
//     loads only for a TRUSTED folder, and nothing makes it trusted: folder trust is on in the
//     system layer (a workspace file cannot switch it off), Maude's home has no trustedFolders.json
//     (removed at every spawn), GEMINI_CLI_TRUST_WORKSPACE is scrubbed with every GEMINI_* name and
//     `--skip-trust` is never passed. Measured on 0.66 (contract note "B8"): a project and a git-root
//     `.gemini/` with MCP servers, hooks, `tools.allowed`, a policy allowing the shell and
//     `folderTrust.enabled:false` changed nothing. The conformance probe plants exactly that on
//     every run, so a version that starts trusting the folder fails the probe. Not refused: many
//     repositories carry a `.gemini/` for Gemini Code Assist.
//
// The pure builder takes the home path; `geminiLaunchPolicyFor` makes the home (impure).

import { join } from 'node:path';

import type { LaunchPolicy, PolicyCtx } from '../agents/descriptor.ts';
import { ensureMaudeAgentHome, type HostEnv, homeOf } from './agent-home.ts';
import { absPath } from './launch-codex.ts';

export const GEMINI_HOME_NAME = 'gemini-home';

/** Web tools removed from the model's list, whatever the person's switch says. */
export const GEMINI_EXCLUDED_TOOLS = ['web_fetch', 'google_web_search'] as const;

/** The settings Maude writes (user settings of its home AND the system settings layer). */
export function geminiSettings() {
  return {
    general: { disableAutoUpdate: true, disableUpdateNag: true },
    privacy: { usageStatisticsEnabled: false },
    tools: { exclude: [...GEMINI_EXCLUDED_TOOLS], sandbox: false },
    mcpServers: {},
    hooks: {},
    hooksConfig: { enabled: false },
    security: {
      folderTrust: { enabled: true },
      disableYoloMode: true,
      disableAlwaysAllow: true,
    },
    admin: {
      mcp: { enabled: false },
      extensions: { enabled: false },
      skills: { enabled: false },
    },
  };
}

/** Config surfaces Gemini reads from its home that Maude never writes; removed at every spawn. */
export const GEMINI_HOME_FOREIGN = [
  '.gemini/extensions',
  '.gemini/commands',
  '.gemini/policies',
  '.gemini/agents',
  '.gemini/skills',
  '.gemini/GEMINI.md',
  '.gemini/trustedFolders.json',
  '.gemini/.env',
  '.agents',
  '.env',
] as const;

/** Pure: the policy for a session, given Maude's Gemini home (GEMINI_CLI_HOME). */
export function geminiLaunchPolicy(ctx: PolicyCtx, geminiHome: string): LaunchPolicy {
  absPath(ctx.scopeRoot, 'scopeRoot');
  for (const w of ctx.writeRoots) absPath(w, 'write root');
  absPath(geminiHome, 'gemini home');
  return {
    env: {
      GEMINI_CLI_HOME: geminiHome,
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(geminiHome, 'system-settings.json'),
    },
    args: ['--approval-mode', 'default'],
  };
}

/** The person's own `~/.gemini` (honouring their GEMINI_CLI_HOME). */
export function personGeminiDir(env: HostEnv = process.env): string {
  const h = env.GEMINI_CLI_HOME;
  return join(h?.startsWith('/') ? h : homeOf(env), '.gemini');
}

/** Make (or repair) Maude's Gemini home and return its path (impure). */
export function ensureMaudeGeminiHome(env: HostEnv = process.env): string {
  const settings = `${JSON.stringify(geminiSettings(), null, 2)}\n`;
  const person = personGeminiDir(env);
  return ensureMaudeAgentHome(
    {
      name: GEMINI_HOME_NAME,
      foreign: GEMINI_HOME_FOREIGN,
      // Sign-in: the person's Google login is shared through links (an API key comes from the
      // chat key store, B7). Everything else in their ~/.gemini stays out.
      links: {
        '.gemini/oauth_creds.json': join(person, 'oauth_creds.json'),
        '.gemini/google_accounts.json': join(person, 'google_accounts.json'),
      },
      files: { '.gemini/settings.json': settings, 'system-settings.json': settings },
    },
    env
  );
}

/** The enforcement's launch policy: make the home, build the policy. */
export function geminiLaunchPolicyFor(ctx: PolicyCtx): LaunchPolicy {
  return geminiLaunchPolicy(ctx, ensureMaudeGeminiHome(ctx.hostEnv ?? process.env));
}
