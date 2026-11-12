// E2E ONLY — point a non-Claude agent the real server spawns at a loopback scripted model.
//
// The local end-to-end run (scripts/acp-e2e-local.ts) drives the REAL server with the REAL agent
// binaries and must reach the agent's real model path offline, with no account. The production
// launch policy names no model endpoint, so this switch adds the same model wiring the conformance
// probe uses (acp/agents/conformance.ts `profileFor(d).injectModel`), after the launch policy, and
// nothing else: no permission, no MCP server, no hook.
//
// Narrow on purpose:
//   • `e2eSwitch` — a release build ignores it whatever its env holds (release-build.ts);
//   • only `http://127.0.0.1:<port>` (no path, no user info) — never a remote endpoint;
//   • never Claude (its model path is the person's own `claude`);
//   • the switch itself is dropped from the agent's env.

import { e2eSwitch, IS_RELEASE_BUILD } from '../../release-build.ts';
import { profileFor } from './conformance.ts';
import type { AgentDescriptor } from './descriptor.ts';

export const E2E_AGENT_MODEL_SWITCH = 'MAUDE_E2E_AGENT_MODEL_URL';

/** The loopback model origin the switch names, or null (unset, release build, not loopback http). */
export function e2eAgentModelUrl(
  env: Readonly<Record<string, string | undefined>>,
  release: boolean = IS_RELEASE_BUILD
): string | null {
  const v = e2eSwitch(env as Record<string, string | undefined>, E2E_AGENT_MODEL_SWITCH, release);
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port) return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== ''))
    return null;
  return `http://127.0.0.1:${u.port}`;
}

/**
 * Apply the switch to one spawn's env (mutated). True when the agent's model now points at the
 * loopback model. The switch never reaches the agent, applied or not.
 */
export function applyE2eAgentModel(
  d: AgentDescriptor,
  spawnEnv: Record<string, string>,
  env: Readonly<Record<string, string | undefined>> = process.env,
  release: boolean = IS_RELEASE_BUILD
): boolean {
  delete spawnEnv[E2E_AGENT_MODEL_SWITCH];
  if (d.policy === 'claude-meta') return false;
  const url = e2eAgentModelUrl(env, release);
  if (!url) return false;
  const profile = profileFor(d);
  if (!profile) return false;
  profile.injectModel(spawnEnv, url);
  return true;
}
