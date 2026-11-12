// client/v2/settings/agents-card.jsx — universal ACP B6, Design Decision 2: Settings › Connections › AI agents,
// the always-present list of the other AI agents on this Mac, right under the Claude card.
//
//   ✦  AI agents                     Other AI on this Mac.          ● Codex connected               ›
//      Codex        OpenAI          ● Connected                                         [Disconnect]
//      opencode     opencode        ● Available        Uses opencode's hosted model…    [Connect]
//      › Advanced   agents Maude cannot hold to its limits, each behind a consent card
//
// Only installed agents appear, Claude never (it keeps its own card). With nothing but Claude on this Mac the
// card is not drawn at all (agentsCardVisible) — the Claude-only Settings are unchanged.

import { useState } from 'react';

import { reasonProps } from '../access/disabled-reason.js';
import {
  agentRows,
  agentsCardSummary,
  agentsCardVisible,
  consentWords,
} from '../ai/agents-model.js';
import {
  connectProgressWords,
  disconnectAgent,
  loadAgents,
  useAgentConnect,
  useAgents,
} from '../ai/agents-store.js';
import { connectionFoldId } from './connections-model.js';
import { CardRow, SettingsCard, StatusLine } from './settings-card.jsx';

const btn = 'btn btn--sm';

/** One agent's row: its name and vendor, its state word, and its one action. */
export function AgentRow({ row, c, onAskConsent, onDisconnect }) {
  const busy = c.busyId === row.id;
  const other = c.busyId !== null && !busy;
  const progress = busy ? connectProgressWords(c.phase, row.label) : null;
  let action = null;
  if (busy)
    action = (
      <button
        type="button"
        className={btn}
        onClick={c.cancel}
        data-testid={`settings-agent-cancel-${row.id}`}
      >
        Cancel
      </button>
    );
  else if (row.action === 'connect' || row.action === 'signin')
    action = (
      <button
        type="button"
        className={btn}
        disabled={other}
        {...reasonProps(other, 'Another agent is connecting.')}
        onClick={() =>
          row.unrestricted && row.action === 'connect'
            ? onAskConsent(row)
            : c.connect(row, { signinFirst: row.action === 'signin' })
        }
        data-testid={`settings-agent-connect-${row.id}`}
      >
        {row.action === 'signin' ? 'Sign in…' : 'Connect'}
      </button>
    );
  else if (row.action === 'disconnect')
    action = (
      <button
        type="button"
        className={btn}
        disabled={other}
        onClick={() => onDisconnect(row)}
        data-testid={`settings-agent-disconnect-${row.id}`}
      >
        Disconnect
      </button>
    );
  return (
    <div className="v2s-agent" data-testid={`settings-agent-row-${row.id}`} data-state={row.state}>
      <CardRow k={row.label} action={action} testid={`settings-agent-state-${row.id}`}>
        <StatusLine sw={busy ? 'busy' : row.sw}>{progress ?? row.word}</StatusLine>
      </CardRow>
      {row.vendor ? <p className="v2s-hint v2s-agent-v">{`By ${row.vendor}`}</p> : null}
      {row.connectNote && !row.connected ? (
        <p className="v2s-hint" data-testid={`settings-agent-note-${row.id}`}>
          {row.connectNote}
        </p>
      ) : null}
      {c.errorId === row.id && c.error ? (
        <p className="v2s-conn-err" role="alert" data-testid={`settings-agent-error-${row.id}`}>
          {c.error}
        </p>
      ) : null}
    </div>
  );
}

/** The consent card an unrestricted agent needs before Connect: per project, with its own words. */
export function AgentConsent({ row, onAllow, onCancel }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled question with two buttons, not a form fieldset
    <div
      className="v2s-conn-keys"
      role="group"
      aria-label={`Allow ${row.label}`}
      data-testid="settings-agent-consent"
    >
      <p className="v2s-hint">{consentWords(row.label)}</p>
      <span className="v2s-conn-replace">
        <button
          type="button"
          className={btn}
          onClick={onCancel}
          data-testid="settings-agent-consent-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={onAllow}
          data-testid="settings-agent-consent-allow"
        >
          Allow and connect
        </button>
      </span>
    </div>
  );
}

/** The card, controlled (a `list` from `/_api/agents`); `null` when only Claude is on this Mac. */
export function AgentsCardView({ list, c, card, disconnect = disconnectAgent }) {
  const [asking, setAsking] = useState(null);
  const agents = list?.agents ?? [];
  if (!agentsCardVisible(agents)) return null;
  const { main, advanced } = agentRows(agents);
  const row = (r) => (
    <AgentRow
      key={r.id}
      row={r}
      c={c}
      onAskConsent={setAsking}
      onDisconnect={(x) => void disconnect(x.id)}
    />
  );
  return (
    <SettingsCard
      id="agents"
      testid="settings-agents-card"
      summaryTestid="settings-conn-agents-status"
      icon="sparkle"
      title="AI agents"
      desc="Other AI on this Mac, for the AI chat."
      summary={agentsCardSummary(agents)}
      sw={agents.some((a) => a.id !== 'claude' && a.connected) ? 'ok' : 'off'}
      fold={
        advanced.length
          ? {
              panel: connectionFoldId('agents'),
              hint: 'agents without Maude’s limits',
              testid: 'settings-agents-advanced',
              body: (
                <>
                  {advanced.map(row)}
                  {asking ? (
                    <AgentConsent
                      row={asking}
                      onCancel={() => setAsking(null)}
                      onAllow={() => {
                        const r = asking;
                        setAsking(null);
                        void c.connect(r, { consent: true });
                      }}
                    />
                  ) : null}
                </>
              ),
            }
          : undefined
      }
      {...card('agents')}
    >
      {main.length ? (
        main.map(row)
      ) : (
        <p className="v2s-hint">
          Only agents that need your yes first are on this Mac. See Advanced.
        </p>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => void loadAgents({ force: true })}
        data-testid="settings-agents-refresh"
      >
        Look again
      </button>
    </SettingsCard>
  );
}

/** The card, wired to the shared agent list. */
export function AgentsCard({ card }) {
  const list = useAgents();
  const c = useAgentConnect();
  return <AgentsCardView list={list} c={c} card={card} />;
}
