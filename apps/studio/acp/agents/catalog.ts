// The curated, pinned agent catalog. Shaped after the public ACP registry
// (cdn.agentclientprotocol.com/registry/v1/latest/registry.json, snapshot read 2026-11-12) but
// never fetched or run from it: an agent appears only when its own CLI is already on this Mac.
//
// Policy status (DDR-252):
//   claude    claude-meta      today's path, unchanged
//   codex     bridge-enforced  probe passed in full on 0.154 / 0.165 / 0.166 (F6b)
//   opencode  bridge-enforced  probe passed in full on 1.18.30 (F6b)
//   gemini    bridge-enforced  probe passed in full on 0.66.0 (B8)
//   copilot   bridge-enforced  probe passed in full on 1.0.105 (B8)
//   goose, cursor: 'unrestricted' until their own probe passes

import { ensureMaudeCodexHome, refuseProjectCodexConfig } from '../policy/codex-home.ts';
import { codexLaunchPolicy, currentHost } from '../policy/launch-codex.ts';
import { copilotLaunchPolicyFor } from '../policy/launch-copilot.ts';
import { geminiLaunchPolicyFor } from '../policy/launch-gemini.ts';
import {
  OPENCODE_EXTERNAL_DIRECTORY_MAP,
  opencodeLaunchPolicy,
} from '../policy/launch-opencode.ts';
import { readPersonOpencodeConfig } from '../policy/opencode-user-config.ts';
import {
  type AgentDescriptor,
  type AgentId,
  assertDescriptor,
  type Enforcement,
} from './descriptor.ts';

const SEMVER = /(\d+\.\d+\.\d+)/;

/** rawInput keys a request may carry a path in (B0 frames: opencode filePath/filepath/path). */
const TARGET_KEYS = ['filePath', 'filepath', 'file_path', 'path', 'abs_path', 'paths'];

export const CLAUDE: AgentDescriptor = assertDescriptor({
  id: 'claude',
  label: 'Claude',
  vendor: 'Anthropic',
  statusUrl: 'https://status.anthropic.com',
  detect: {
    bins: ['claude'],
    versionArgs: ['--version'],
    versionRe: SEMVER,
    minVersion: '0.0.0',
    testedMax: '999.0.0',
  },
  launch: {
    kind: 'adapter-js',
    adapterPkg: '@agentclientprotocol/claude-agent-acp',
    adapterBin: 'claude-agent-acp',
    agentBinEnv: 'CLAUDE_CODE_EXECUTABLE',
  },
  auth: {
    gate: 'session-new',
    statusArgs: ['auth', 'status', '--json'],
    loginArgs: ['auth', 'login', '--claudeai'],
  },
  envAllow: [],
  policy: 'claude-meta',
  plugins: 'claude-meta',
});

export const CODEX: AgentDescriptor = assertDescriptor({
  id: 'codex',
  label: 'Codex',
  vendor: 'OpenAI',
  statusUrl: 'https://status.openai.com',
  detect: {
    bins: ['codex'],
    versionArgs: ['--version'],
    versionRe: /codex-cli (\d+\.\d+\.\d+)/,
    // The bundled codex-acp 2.5.0 depends on @openai/codex ^0.165. The conformance probe passed every
    // check on 0.154 (the person's, through codex-acp's app-server), 0.165 and 0.166 once runtime
    // state was `none` in the permission profile (2026-11-12, contract note "F6b").
    minVersion: '0.154.0',
    testedMax: '0.166.99',
  },
  launch: {
    kind: 'adapter-js',
    adapterPkg: '@agentclientprotocol/codex-acp',
    adapterBin: 'codex-acp',
    agentBinEnv: 'CODEX_PATH',
  },
  auth: {
    gate: 'session-new',
    statusArgs: ['login', 'status'],
    loginArgs: ['login'],
    apiKeyEnv: ['OPENAI_API_KEY'],
  },
  envAllow: [],
  // Bridge-enforced (DDR-252): every conformance check passes on 0.154 / 0.165 / 0.166. F6b fixed the
  // person's MCP servers / hooks (a Maude-owned CODEX_HOME) and refuses a project `.codex/`; runtime
  // state the agent does not own is `none` in the permission profile (a `read` inside the `write`
  // scope does not stop writes under codex-acp's workspace-write mode; `none` does). Connect still
  // runs the probe on this Mac's binary before the first chat.
  policy: 'bridge-enforced',
  enforcement: {
    // F6b — a Maude-owned CODEX_HOME (made or repaired here, at every spawn; a failure stops the
    // spawn): the person's config.toml / hooks.json never load, only their sign-in is shared. A
    // project `.codex/` (which codex-acp makes a trusted layer) stops the spawn.
    launchPolicy: (ctx) => {
      refuseProjectCodexConfig(ctx.scopeRoot);
      return codexLaunchPolicy(
        ctx,
        currentHost(),
        ensureMaudeCodexHome(ctx.hostEnv ?? process.env)
      );
    },
    readGate: 'os-sandbox',
    shellGate: 'os-sandbox',
    pinMode: { modeId: 'workspace-write', refuse: ['agent', 'agent-full-access'] },
    rejectEndsTurn: true,
    targetKeys: TARGET_KEYS,
  },
  plugins: 'harness:codex',
});

export const OPENCODE: AgentDescriptor = assertDescriptor({
  id: 'opencode',
  label: 'opencode',
  vendor: 'opencode',
  detect: {
    bins: ['opencode'],
    versionArgs: ['--version'],
    versionRe: SEMVER,
    minVersion: '1.18.30',
    testedMax: '1.18.99',
  },
  launch: { kind: 'native-acp', args: ['acp'] },
  auth: { gate: 'none', loginArgs: ['auth', 'login'] },
  envAllow: [],
  // F6b (2026-11-12): the conformance probe passed every check on 1.18.30, project outside git and
  // its own git repo, with the person's MCP servers named off and plugins / tools / a project
  // `.opencode` refused at spawn (contract note, "F6b"). Re-run the probe before raising testedMax.
  policy: 'bridge-enforced',
  enforcement: {
    // F6b — each of the person's MCP servers named off (read at every spawn); a config that cannot
    // be read, a plugin or tool, or a `.opencode` folder in or above the project stops the spawn
    // (opencode imports that code whatever its flags say).
    launchPolicy: (ctx) =>
      opencodeLaunchPolicy(
        ctx,
        OPENCODE_EXTERNAL_DIRECTORY_MAP,
        readPersonOpencodeConfig(ctx.hostEnv ?? process.env, ctx.scopeRoot)
      ),
    readGate: 'agent-permission-engine',
    shellGate: 'command-text',
    rejectEndsTurn: false,
    targetKeys: TARGET_KEYS,
  },
  plugins: 'harness:opencode',
  connectNote:
    'Without a provider of your own, opencode sends prompts to its free hosted model. Pick a provider in opencode first if that is not what you want.',
});

function unprobed(
  id: AgentId,
  label: string,
  vendor: string,
  bin: string,
  args: string[]
): AgentDescriptor {
  return assertDescriptor({
    id,
    label,
    vendor,
    detect: {
      bins: [bin],
      versionArgs: ['--version'],
      versionRe: SEMVER,
      minVersion: '0.0.0',
      testedMax: '0.0.0',
    },
    launch: { kind: 'native-acp', args },
    auth: { gate: 'session-new' },
    envAllow: [],
    policy: 'unrestricted',
    plugins: 'none',
  });
}

/**
 * B8 — Gemini CLI under Maude's limits: a Maude-owned GEMINI_CLI_HOME + system settings (no MCP,
 * extensions, skills, hooks or web tools), approval mode pinned to `default`, the project never
 * trusted (acp/policy/launch-gemini.ts). Shell is judged by command text.
 */
export const GEMINI_ENFORCEMENT: Enforcement = {
  launchPolicy: geminiLaunchPolicyFor,
  readGate: 'agent-permission-engine',
  shellGate: 'command-text',
  pinMode: { modeId: 'default', refuse: ['yolo', 'autoEdit'] },
  rejectEndsTurn: false,
  targetKeys: TARGET_KEYS,
};

/**
 * B8 — Copilot CLI under Maude's limits: a Maude-owned COPILOT_HOME (no MCP, hooks, plugins or
 * trusted folders), no web tool, every URL denied, project Copilot config refused
 * (acp/policy/launch-copilot.ts). Shell is judged by command text.
 */
export const COPILOT_ENFORCEMENT: Enforcement = {
  launchPolicy: copilotLaunchPolicyFor,
  readGate: 'agent-permission-engine',
  shellGate: 'command-text',
  pinMode: {
    modeId: 'https://agentclientprotocol.com/protocol/session-modes#agent',
    refuse: ['https://agentclientprotocol.com/protocol/session-modes#autopilot'],
  },
  rejectEndsTurn: false,
  targetKeys: TARGET_KEYS,
};

// B8 (2026-11-12): the conformance probe passed every check on 0.66.0, project outside git and its
// own git repo, with a planted project `.gemini/` inert (contract note, "B8"). Shell: Gemini sends
// no rawInput, so the gate refuses every shell command (fail closed) until enforce.ts reads its
// title. Re-run the probe before raising testedMax.
export const GEMINI: AgentDescriptor = assertDescriptor({
  id: 'gemini',
  label: 'Gemini CLI',
  vendor: 'Google',
  statusUrl: 'https://status.cloud.google.com',
  detect: {
    bins: ['gemini'],
    versionArgs: ['--version'],
    versionRe: SEMVER,
    minVersion: '0.66.0',
    testedMax: '0.66.99',
  },
  launch: { kind: 'native-acp', args: ['--acp'] },
  // Sign-in is Google's own (ACP authenticate / the CLI); an API key comes from the chat key store.
  auth: { gate: 'session-new', apiKeyEnv: ['GEMINI_API_KEY'] },
  envAllow: [],
  policy: 'bridge-enforced',
  enforcement: GEMINI_ENFORCEMENT,
  plugins: 'none',
});

// B8 (2026-11-12): the conformance probe passed every check on 1.0.105, project outside git and its
// own git repo (contract note, "B8"). Copilot releases often and changes behaviour between patch
// releases, so testedMax is the measured release itself.
export const COPILOT: AgentDescriptor = assertDescriptor({
  id: 'copilot',
  label: 'GitHub Copilot CLI',
  vendor: 'GitHub',
  statusUrl: 'https://www.githubstatus.com',
  detect: {
    bins: ['copilot'],
    versionArgs: ['--version'],
    versionRe: SEMVER,
    minVersion: '1.0.105',
    testedMax: '1.0.105',
  },
  launch: { kind: 'native-acp', args: ['--acp'] },
  auth: { gate: 'session-new', loginArgs: ['login'] },
  envAllow: [],
  policy: 'bridge-enforced',
  enforcement: COPILOT_ENFORCEMENT,
  plugins: 'none',
});
export const GOOSE = unprobed('goose', 'Goose', 'Block', 'goose', ['acp']);
export const CURSOR = unprobed('cursor', 'Cursor agent', 'Cursor', 'cursor-agent', ['acp']);

/** Order = order in Settings and in the offer line. Claude first, always. */
export const CATALOG: readonly AgentDescriptor[] = Object.freeze([
  CLAUDE,
  CODEX,
  OPENCODE,
  GEMINI,
  COPILOT,
  GOOSE,
  CURSOR,
]);

export function agentById(id: string): AgentDescriptor | undefined {
  return CATALOG.find((d) => d.id === id);
}

/** Whether Studio may proactively offer this agent (Design Decision 1): bridge-enforced only. */
export function isOfferable(d: AgentDescriptor): boolean {
  return d.id !== 'claude' && d.policy === 'bridge-enforced';
}
