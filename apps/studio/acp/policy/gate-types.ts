// The permission gate the bridge holds for an agent that is not Claude (universal ACP, B3).
//
// F3 left a call site (one function → select / refuse / ask) and F5 built the rules
// (acp/policy/enforce.ts: decide · answer · observe · forbidden methods · refusal notices). This is
// the ONE interface between them (B3 wiring): F5's semantics, with the scope read live per call.
//   • decide — rules 1–9 for one `session/request_permission`. An allow carries `audienceHold`: the
//     bridge runs its audience check (H1) before granting. An ask carries `strippedOptions`: the card
//     shows only `allow_once` / `reject_once` (rule 9).
//   • answer — the person's card answer, checked against what the card showed; an allow is
//     remembered so the tripwire does not fire on a call the person approved.
//   • observe — rule 12, per streamed `session/update`.
//   • isForbiddenClientMethod — rule 11: `fs/*` and `terminal/*` from any non-Claude agent.
//   • refusalNotice / cardRefusalNotice — rule 13, the line the panel shows when a refusal ends the
//     agent's turn (`rejectEndsTurn`).
// Implemented by acp/policy/bridge-gate.ts `createBridgeGate`; the bridge never calls enforce.ts
// directly. A non-Claude agent with no gate wired is refused everything (fail closed).

import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

import type { AgentDescriptor, PolicyCtx } from '../agents/descriptor.ts';
import type { GateResult, GateState, TripwireVerdict } from './enforce.ts';

export type { GateResult, GateState, TripwireVerdict } from './enforce.ts';

export interface PermissionGateInput {
  req: RequestPermissionRequest;
  descriptor: AgentDescriptor;
  /** The same scope the launch policy was built from, read live (the "AI may" switches can change). */
  ctx: PolicyCtx;
  /** Per-request facts the bridge holds live: stopped, this chat's read grants, a run's write scope. */
  state: GateState;
}

export interface PermissionGate {
  decide(input: PermissionGateInput): GateResult;
  answer(result: GateResult, optionId: string | null | undefined): RequestPermissionResponse;
  observe(update: unknown, ctx: PolicyCtx): TripwireVerdict;
  isForbiddenClientMethod(method: string): boolean;
  refusalNotice(result: GateResult): string | null;
  cardRefusalNotice(): string | null;
}
