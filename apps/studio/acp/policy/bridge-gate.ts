// The adapter between the bridge's permission-gate call site (acp/policy/gate-types.ts) and the
// bridge-enforced rule set (acp/policy/enforce.ts, contract rules 1–13). One per bridge: the
// tripwire's memory of what each tool call said, and which calls the person approved, lives here.
//
// Which rules an agent gets:
//   • an agent with an `enforcement` block gets enforce.ts in full, whatever its `policy` says. An
//     'unrestricted' agent with a block (Codex and opencode until their conformance probe passes)
//     still runs under its launch policy (spawn.ts applies it) — consent to run it waives the probe,
//     not the second gate.
//   • an 'unrestricted' agent without one gets the same rules over a conservative stand-in: no
//     shell call is ever approved without the person (`shellGate:'os-sandbox'` = always the card),
//     and the tripwire watches credential stores only (it has no launch policy to hold).

import type { AgentDescriptor, Enforcement, PolicyCtx } from '../agents/descriptor.ts';
import {
  answerCard,
  cardRefusalNotice,
  type EnforcedDescriptor,
  gatePermission,
  isForbiddenClientMethod,
  newTripwireMemory,
  refusalNotice,
  tripwire,
} from './enforce.ts';
import type { PermissionGate } from './gate-types.ts';

/** rawInput keys a request may carry a path in, for an agent that names none (the catalog's list). */
const FALLBACK_TARGET_KEYS = ['filePath', 'filepath', 'file_path', 'path', 'abs_path', 'paths'];

const FALLBACK_ENFORCEMENT: Enforcement = {
  launchPolicy: () => ({ env: {} }),
  readGate: 'agent-permission-engine',
  shellGate: 'os-sandbox',
  rejectEndsTurn: false,
  targetKeys: FALLBACK_TARGET_KEYS,
};

/** The descriptor the rules judge with: always bridge-enforced, never Claude. */
export function enforcedFor(d: AgentDescriptor): EnforcedDescriptor {
  if (d.policy === 'claude-meta') {
    throw new Error(`agent ${d.id}: Claude is gated by its own _meta policy, not the bridge gate`);
  }
  return { ...d, policy: 'bridge-enforced', enforcement: d.enforcement ?? FALLBACK_ENFORCEMENT };
}

export function createBridgeGate(d: AgentDescriptor): PermissionGate {
  const enforced = enforcedFor(d);
  const memory = newTripwireMemory();
  return {
    decide: ({ req, ctx, state }) => gatePermission(req, enforced, ctx, state),
    answer: (result, optionId) => {
      const res = answerCard(result, optionId);
      const picked =
        res.outcome.outcome === 'selected'
          ? result.strippedOptions.find(
              (o) => o.optionId === (res.outcome as { optionId: string }).optionId
            )
          : undefined;
      if (result.toolCallId && picked?.kind === 'allow_once')
        memory.approved.add(result.toolCallId);
      return res;
    },
    observe: (update, ctx: PolicyCtx) => tripwire(update, enforced, ctx, memory),
    isForbiddenClientMethod: (method) => isForbiddenClientMethod(enforced, method),
    refusalNotice: (result) => refusalNotice(enforced, result),
    cardRefusalNotice: () => cardRefusalNotice(enforced),
  };
}
