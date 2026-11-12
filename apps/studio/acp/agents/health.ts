// Agent health for this server run (universal ACP, contract rule 12, DDR-252).
//
// When the bridge's tripwire sees a completed tool call that broke an agent's launch policy, the
// session ends and the agent is marked unavailable here: no chat may start it again until the
// server restarts (or Settings › "Check again" clears it once the conformance probe is green).
// In memory on purpose: the evidence is this run's frames, and a planted file must never be able
// to mark an agent healthy.

import type { AgentId } from './descriptor.ts';

export interface AgentHealth {
  id: AgentId;
  available: boolean;
  /** Why it is unavailable (the tripwire's reason), when it is. */
  reason?: string;
  /** ms since epoch the agent was marked unavailable. */
  since?: number;
}

const unavailable = new Map<AgentId, { reason: string; since: number }>();

/** Rule 12 — the launch policy did not hold: no chat starts this agent again this run. */
export function markAgentUnavailable(id: AgentId, reason: string, now = Date.now()): void {
  if (!unavailable.has(id)) unavailable.set(id, { reason, since: now });
}

export function agentHealth(id: AgentId): AgentHealth {
  const u = unavailable.get(id);
  return u ? { id, available: false, reason: u.reason, since: u.since } : { id, available: true };
}

/** Every agent marked unavailable this run (the agents route lists them in Settings). */
export function unavailableAgents(): AgentHealth[] {
  return [...unavailable.entries()].map(([id, u]) => ({
    id,
    available: false,
    reason: u.reason,
    since: u.since,
  }));
}

/** Tests, and a "Check again" whose conformance probe passed. No id → every agent. */
export function clearAgentHealth(id?: AgentId): void {
  if (id === undefined) unavailable.clear();
  else unavailable.delete(id);
}
