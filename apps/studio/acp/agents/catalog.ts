// The curated, pinned agent catalog. Shaped after the public ACP registry
// (cdn.agentclientprotocol.com/registry/v1/latest/registry.json, snapshot read 2026-11-12) but
// never fetched or run from it: an agent appears only when its own CLI is already on this Mac.
//
// Policy status (DDR-252):
//   claude    claude-meta      today's path, unchanged
//   codex     bridge-enforced  once its launch policy + conformance probe land (F4/F6); until then
//   opencode  bridge-enforced  'unrestricted' so nothing offers it
//   gemini, copilot, goose, cursor: 'unrestricted' until their own probe passes (B8)

import { codexLaunchPolicy } from '../policy/launch-codex.ts';
import { opencodeLaunchPolicy } from '../policy/launch-opencode.ts';
import { type AgentDescriptor, type AgentId, assertDescriptor } from './descriptor.ts';

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
    // The bundled codex-acp 2.5.0 depends on @openai/codex ^0.165. The F6 conformance probe ran it
    // against 0.154 (the app-server too), 0.165 and 0.166 with identical results, but no version
    // passed in full (contract note, "F6 conformance results"), so the range stays as B0 set it until
    // one does: then minVersion 0.154.0, testedMax the highest passing version.
    minVersion: '0.166.0',
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
  // Enforcement is wired (F4) but the policy stays 'unrestricted' until the conformance probe (F6,
  // acp/agents/conformance.ts) passes every check: nothing offers Codex before then. Failing on
  // 2026-11-12: a write into `.design/_state/` is allowed by the Seatbelt profile, and the person's
  // own MCP servers (~/.codex/config.toml) still start — `mcp_servers: {}` merges, it does not replace.
  policy: 'unrestricted',
  enforcement: {
    launchPolicy: (ctx) => codexLaunchPolicy(ctx),
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
  // As Codex: enforcement wired (F4), 'unrestricted' until the conformance probe (F6) passes every
  // check. Failing on 2026-11-12 (1.18.30, project outside git and its own git repo): the person's own
  // MCP servers (global opencode.json) still start — `mcp: {}` merges, it does not replace.
  policy: 'unrestricted',
  enforcement: {
    launchPolicy: (ctx) => opencodeLaunchPolicy(ctx),
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

export const GEMINI = unprobed('gemini', 'Gemini CLI', 'Google', 'gemini', ['--acp']);
export const COPILOT = unprobed('copilot', 'GitHub Copilot CLI', 'GitHub', 'copilot', ['--acp']);
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
