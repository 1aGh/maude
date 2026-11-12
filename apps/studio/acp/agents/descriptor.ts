// The agent descriptor: what the Studio chat needs to know to find, launch, sign in and confine
// one ACP agent. Contract: .ai/plans/notes/universal-acp-contract.md (B0) + DDR-252.
//
// Claude is descriptor `claude` with policy 'claude-meta': its least-privilege policy keeps
// riding `_meta.claudeCode.options` exactly as before (newSessionParams stays byte-identical).
// Every other agent is 'bridge-enforced' (an agent-native launch policy Maude writes per session,
// the bridge's permission gate, and a conformance probe) or 'unrestricted' (Advanced only, a
// per-project consent card, never offered).

import type { AiMay, CredentialPaths } from '../may-scope.ts';

export type BuiltinAgentId =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'gemini'
  | 'copilot'
  | 'goose'
  | 'cursor';
export type AgentId = BuiltinAgentId | `custom:${string}`;

export type AgentPolicy = 'claude-meta' | 'bridge-enforced' | 'unrestricted';

export interface AgentDetect {
  /** Command names looked up on the login-shell PATH; wrappers are resolved by READING them. */
  bins: string[];
  /** Arguments that print the version (run with a 5 s timeout, off the boot path, cached). */
  versionArgs: string[];
  /** First capture group = the semver. */
  versionRe: RegExp;
  /** Below this the agent is not offered. */
  minVersion: string;
  /** Inclusive upper bound of what passed the conformance probe; above it → "Untested version". */
  testedMax: string;
}

export type AgentLaunch =
  | {
      kind: 'adapter-js';
      /** Bundled adapter package (pinned in apps/studio/package.json). */
      adapterPkg: string;
      /** The adapter's bin name inside that package. */
      adapterBin: string;
      /** Env var that tells the adapter where the user's own agent binary is. */
      agentBinEnv?: string;
    }
  | {
      kind: 'native-acp';
      /** Arguments that put the user's own binary into ACP mode. */
      args: string[];
    };

export interface AgentAuth {
  /** 'session-new': session/new fails until signed in. 'none': works with no account. */
  gate: 'session-new' | 'none';
  /** argv (after the binary) that reports sign-in state; exit 0 = signed in. */
  statusArgs?: string[];
  /** argv (after the binary) that starts the vendor's own sign-in. */
  loginArgs?: string[];
  /** Env names a BYOK key for this agent is injected as (B7) — into THIS agent's env only. */
  apiKeyEnv?: string[];
}

export interface PolicyCtx {
  /** pinScopeRoot(repoRoot) */
  scopeRoot: string;
  /** readBoundaryRoots(...) */
  readRoots: readonly string[];
  /** scopeRoot (+ the chat scratch dir) */
  writeRoots: readonly string[];
  credentialPaths: CredentialPaths;
  may: AiMay;
  /** Design roots whose runtime state the agent must not write. */
  designRoots: readonly string[];
  /** The discovered real binary of the agent (realpath). */
  agentBin: string;
}

export interface LaunchPolicy {
  env: Record<string, string>;
  args?: string[];
}

export interface Enforcement {
  /** Agent-native launch policy built from the session scope: the real read/write/network boundary. */
  launchPolicy(ctx: PolicyCtx): LaunchPolicy;
  readGate: 'os-sandbox' | 'agent-permission-engine';
  shellGate: 'os-sandbox' | 'command-text';
  /** Mode pinned after session/new; the bridge refuses a switch to any `refuse` mode. */
  pinMode?: { modeId: string; refuse: string[] };
  /** A refusal ends the whole turn (Codex). The panel says why instead of showing an error. */
  rejectEndsTurn: boolean;
  /** rawInput keys a request may carry a path in (normalised through acp/agent-path.ts). */
  targetKeys: string[];
}

export interface AgentDescriptor {
  id: AgentId;
  label: string;
  /** Vendor shown on the reply badge and in "<label> reported: …". */
  vendor: string;
  /** Vendor status page linked from attributed errors. */
  statusUrl?: string;
  detect: AgentDetect;
  launch: AgentLaunch;
  auth: AgentAuth;
  /** Env names added back on top of the shared scrub. */
  envAllow: string[];
  policy: AgentPolicy;
  /** Required when policy === 'bridge-enforced'. */
  enforcement?: Enforcement;
  plugins: 'claude-meta' | 'harness:codex' | 'harness:opencode' | 'none';
  /** Shown in Settings when the connect step must say where prompts go (opencode's hosted model). */
  connectNote?: string;
}

/** Compare dotted numeric versions; non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type VersionFit = 'ok' | 'too-old' | 'untested';

export function versionFit(d: AgentDescriptor, version: string): VersionFit {
  if (compareVersions(version, d.detect.minVersion) < 0) return 'too-old';
  if (compareVersions(version, d.detect.testedMax) > 0) return 'untested';
  return 'ok';
}

/** Bridge-enforced descriptors must carry their enforcement; fail loud at load, not at a prompt. */
export function assertDescriptor(d: AgentDescriptor): AgentDescriptor {
  if (d.policy === 'bridge-enforced' && !d.enforcement) {
    throw new Error(`agent ${d.id}: policy bridge-enforced needs an enforcement block`);
  }
  if (d.policy !== 'claude-meta' && d.plugins === 'claude-meta') {
    throw new Error(`agent ${d.id}: only the claude-meta policy can carry plugins over _meta`);
  }
  return d;
}
