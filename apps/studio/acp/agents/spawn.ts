// How the bridge starts one ACP agent from its descriptor (F3 / plan Task B2, contract rule 14).
// Pure: the bridge resolves the binaries, the scope and the prefs, then asks this ONE function for
// the argv and the whole child env, so a test can assert exactly what an agent is handed.
//
// Claude (policy 'claude-meta') comes out exactly as before the descriptor existed
// (test/acp-agent-spawn.test.ts pins it): its least-privilege policy rides `_meta.claudeCode`,
// not the env. Every other agent gets its launch policy's env (and argv for native ACP) plus
// MAUDE_NO_EGRESS when web is off — it has no `_meta` channel for either.
//
// B7 (DDR-252) — the agent's own stored chat key (acp/agents/chat-key.ts) is added AFTER the scrub
// and the launch policy, for this descriptor only. The one read outside the inputs: when the caller
// passes no `chatKeyEnv`, it comes from the 0600 key store (generation/keys.ts) at spawn time. A
// Claude spawn without the Advanced opt-in adds nothing.
//
// S3 (defender H1) — the other read outside the inputs: an agent whose reads are judged by its own
// permission engine (`readGate: 'agent-permission-engine'`: opencode, Gemini, Copilot) is refused
// (`UnsafeLinkError`, code `agent-unsafe-link`) while any root it is given holds a link out of the
// read roots (acp/agents/link-scan.ts). A root that does not exist holds no link.

import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { DEV_SERVER_ROOT } from '../../paths.ts';
import { chatSpawnEnv, scrubAgentEnv, teamsSpawnEnv } from '../env.ts';
import { mayEnv } from '../may-scope.ts';
import { chatKeyEnvFor } from './chat-key.ts';
import type { AgentDescriptor, PolicyCtx } from './descriptor.ts';
import { upToGitRoot } from '../policy/agent-home.ts';
import { assertNoUnsafeLinks } from './link-scan.ts';

/** realpath when it exists (a link must not pass for Maude's own folder), else the resolved path. */
function realOr(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

/** The git repository root above `scopeRoot` when it differs from it (none → []). */
function gitRootAbove(scopeRoot: string): string[] {
  const chain = upToGitRoot(scopeRoot);
  const top = chain[chain.length - 1];
  return top && top !== resolve(scopeRoot) ? [top] : [];
}

/** Maude's own studio folder (DEV_SERVER_ROOT) or inside it. */
function isMaudeOwnRoot(r: string): boolean {
  const own = realOr(DEV_SERVER_ROOT);
  const abs = realOr(r);
  return abs === own || abs.startsWith(own.endsWith(sep) ? own : own + sep);
}

export interface AgentSpawnInput {
  descriptor: AgentDescriptor;
  /**
   * `scrubAgentEnv(process.env, descriptor.envAllow)`. The caller scrubs, so every spawn site
   * visibly goes through the one scrub (acp-env.test.ts pins that).
   */
  scrubbed: Record<string, string>;
  /** The agent's real binary: `launch.agentBinEnv` for an adapter, argv[0] for native ACP. */
  agentBin: string;
  /** adapter-js only — the bundled adapter's entry script. */
  adapterEntry?: string;
  /** adapter-js only — the JS runtime that runs it (probe.ts `resolveAgentRuntime`). */
  runtime?: { bin: string; bunBeBun: boolean };
  /** The session scope the launch policy is built from. */
  policyCtx: PolicyCtx;
  /** What the chat's `maude design` verbs are held to (the actor env). */
  actor: {
    sessionRoot: string;
    readRoots: readonly string[];
    ownPorts?: readonly number[];
    /** This chat's scratch, when it could be made safely; absent → TMPDIR left as it was. */
    tmpdir?: string | null;
    grantsFile?: string;
  };
  /** Settings › Advanced › teams (Claude only). */
  teams: boolean;
  chatId?: string;
  /** path.delimiter (':' on POSIX) — a parameter so the function stays pure. */
  delimiter: string;
  /**
   * B7 — the env this agent's stored chat key becomes (`chatKeyEnvFor`). Absent → read from the key
   * store now; `{}` → none (tests, and any caller that must not read the store).
   */
  chatKeyEnv?: Record<string, string>;
}

export interface AgentSpawn {
  cmd: string[];
  env: Record<string, string>;
}

export function agentSpawn(input: AgentSpawnInput): AgentSpawn {
  const d = input.descriptor;
  const env: Record<string, string> = { ...input.scrubbed };
  let cmd: string[];
  // S3 — before the launch policy (which reads the person's config): a refused spawn touches nothing.
  if (d.enforcement?.readGate === 'agent-permission-engine') {
    const c = input.policyCtx;
    assertNoUnsafeLinks({
      // Maude's own install folder (a read root for canvas-lib & co.) is app-owned, not the
      // project's: its package-manager links (pnpm in a source checkout) are not an attacker's.
      // Review N1 — these agents treat the whole git repository as the project (opencode's
      // boundary is the git root), so a link in a sibling folder of a subfolder project counts.
      roots: [...c.writeRoots, ...c.readRoots, ...gitRootAbove(c.scopeRoot)].filter(
        (r) => !isMaudeOwnRoot(r)
      ),
      readRoots: c.readRoots,
      credentialPaths: c.credentialPaths,
      label: d.label,
      projectRoot: c.scopeRoot,
    });
  }
  const policy = d.enforcement?.launchPolicy(input.policyCtx);

  if (d.launch.kind === 'adapter-js') {
    if (!input.adapterEntry || !input.runtime) {
      throw new Error(`agent ${d.id}: an adapter-js launch needs its adapter entry and runtime`);
    }
    // DDR-123 guardrail #2 (Claude) and its analog for every adapter: pin it to the person's OWN
    // agent binary (CODEX_PATH, CLAUDE_CODE_EXECUTABLE), never a bundled one.
    if (d.launch.agentBinEnv) env[d.launch.agentBinEnv] = input.agentBin;
    // RCA-G1 — our own compiled self behaves as `bun` only with BUN_BE_BUN=1.
    if (input.runtime.bunBeBun) env.BUN_BE_BUN = '1';
    cmd = [input.runtime.bin, input.adapterEntry];
  } else {
    cmd = [input.agentBin, ...d.launch.args, ...(policy?.args ?? [])];
  }

  if (policy) {
    // The launch policy is Maude's own code, but it never gets to hand the agent a secret the
    // scrub drops (ANTHROPIC_*, MAUDE_SHELL_*, …): its keys go through the same scrub.
    Object.assign(env, scrubAgentEnv(policy.env, Object.keys(policy.env)));
  }
  // B7 — this agent's own key, after the scrub and the policy (neither can drop or forge it), and
  // only the names chatKeyEnvFor allows for THIS descriptor.
  Object.assign(env, input.chatKeyEnv ?? chatKeyEnvFor(d));
  // Claude carries the egress switch in `_meta.claudeCode.options.env` (newSessionParams); an
  // agent without that channel carries it from spawn.
  if (d.policy !== 'claude-meta') Object.assign(env, mayEnv(input.policyCtx.may));

  // The actor env, last, so nothing above can name another chat's root or ports.
  // V2-2.4b — `maude design hook` tells a Maude chat run from a terminal one by this.
  env.MAUDE_AGENT_ACTOR = 'maude-chat';
  // gate-b-sec2 — the project this chat's maude verbs are held to.
  env.MAUDE_SESSION_ROOT = input.actor.sessionRoot;
  // V2-8.9 H2 — the read boundary for the verbs that read a path they are given.
  env.MAUDE_READ_ROOTS = input.actor.readRoots.join(input.delimiter);
  // V2-8.9 re-check 2 H-a — this session's own server ports; none → unset (helpers refuse all).
  const ports = (input.actor.ownPorts ?? []).filter(
    (p) => Number.isInteger(p) && p > 0 && p < 65536
  );
  if (ports.length) env.MAUDE_OWN_PORTS = [...new Set(ports)].join(',');
  // V2-8.9 M2 — the agent's temp folder is this chat's own scratch.
  if (input.actor.tmpdir) env.TMPDIR = `${input.actor.tmpdir}/`;
  if (input.actor.grantsFile) env.MAUDE_GRANTS_FILE = input.actor.grantsFile;

  // S11.13 — agent teams are a Claude Code switch; V2-1.15 §5.4 — this chat's id and no other's.
  const withTeams =
    d.policy === 'claude-meta' ? teamsSpawnEnv(env, { experimentalTeams: input.teams }) : env;
  return { cmd, env: chatSpawnEnv(withTeams, input.chatId) };
}
