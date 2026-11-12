// The call site the bridge leaves for the bridge-enforced permission gate (F3 → F5).
// F5 implements it in acp/policy/enforce.ts (contract rules 1–13); the bridge only calls it.
//
// It runs for every `session/request_permission` from an agent whose policy is NOT 'claude-meta',
// before the Claude-shaped gates (which key on Claude tool names and see nothing useful here).
// A 'bridge-enforced' agent with no gate wired fails closed: every request is refused.

import type { PermissionOption, RequestPermissionRequest } from '@agentclientprotocol/sdk';

import type { AgentDescriptor, PolicyCtx } from '../agents/descriptor.ts';

export interface PermissionGateInput {
  req: RequestPermissionRequest;
  descriptor: AgentDescriptor;
  /** The same scope the launch policy was built from, read live (grants can change mid-chat). */
  ctx: PolicyCtx;
}

export type GateDecision =
  /** Answer the agent with this offered option, no card (an `allow_once` the rules allow). */
  | { kind: 'select'; optionId: string }
  /** Refuse with no card: the agent's `reject_once` option if offered, else `cancelled`. */
  | { kind: 'refuse'; reason: string }
  /** The person decides, offered only these options (`allow_always` already stripped, rule 9). */
  | { kind: 'ask'; options: PermissionOption[] };

export type PermissionGate = (input: PermissionGateInput) => GateDecision;
