// client/v2/ai/AgentOffer.jsx — universal ACP B6, Design Decision 1: the one quiet line in the AI panel's EMPTY
// state when another agent is on this Mac:
//
//   Codex is on this Mac. Use it in Maude too?  Connect · Not now
//
// The shape of OfferCard.jsx (one sentence, one button, Not now), not the component. Shown only while Claude is
// connected and idle and the server offers an agent (agents-model.js `offerModel`). "Not now" is permanent for
// every agent the line names. Connect registers the agent and starts that vendor's own sign-in, right here; a
// line naming several agents, or one with a note to read first, opens Settings › Connections › AI agents.

import { menuRunner } from '../shell/menu-runner.js';
import { offerModel } from './agents-model.js';
import {
  connectProgressWords,
  dismissAgentOffers,
  useAgentConnect,
  useAgents,
} from './agents-store.js';

/** Settings › Connections, on the AI agents card. */
export function openAgentsSettings(run = (id, p) => menuRunner.run(id, p)) {
  return run('settings.open', { tab: 'connections#agents' });
}

export function AgentOfferLine({
  agents,
  offerAgents,
  claudeConnected,
  running = false,
  conn: c,
  onDismiss = dismissAgentOffers,
  onOpenSettings = openAgentsSettings,
}) {
  const offer = offerModel({ agents, offerAgents, claudeConnected, running });
  if (!offer) return null;
  const one = offer.rows.length === 1 ? offer.rows[0] : null;
  const inline = !!one && !one.connectNote;
  const busy = c.busyId !== null && offer.ids.includes(c.busyId);
  const progress = busy ? connectProgressWords(c.phase, one?.label ?? '') : null;
  const failed = c.errorId && offer.ids.includes(c.errorId) ? c.error : null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: one labelled line with two verbs, not a form fieldset
    <div
      className="ai-agent-offer"
      data-testid="ai-agent-offer"
      role="group"
      aria-label="Another AI agent"
    >
      <p className="ai-agent-offer-t">
        {progress ?? offer.text}{' '}
        {busy ? (
          <button
            type="button"
            className="ai-agent-link"
            data-testid="ai-agent-offer-cancel"
            onClick={c.cancel}
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ai-agent-link"
              data-testid="ai-agent-offer-connect"
              onClick={() => (inline ? c.connect(one) : onOpenSettings())}
            >
              Connect
            </button>
            <span className="ai-agent-sep" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="ai-agent-link ai-agent-link--quiet"
              data-testid="ai-agent-offer-dismiss"
              onClick={() => onDismiss(offer.ids)}
            >
              Not now
            </button>
          </>
        )}
      </p>
      {failed ? (
        <p
          className="ai-agent-note ai-agent-note--err"
          role="alert"
          data-testid="ai-agent-offer-error"
        >
          {failed}
        </p>
      ) : null}
    </div>
  );
}

/** The line, wired: the shared agent list, one connect at a time. `running`: any chat of the panel runs. */
export function AgentOffer({ claudeConnected = false, running = false }) {
  const { agents, offerAgents } = useAgents();
  const c = useAgentConnect();
  return (
    <AgentOfferLine
      agents={agents}
      offerAgents={offerAgents}
      claudeConnected={claudeConnected}
      running={running}
      conn={c}
    />
  );
}
