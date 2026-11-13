// client/v2/settings/agents-card.jsx — universal ACP B6, Design Decision 2: Settings › Connections › AI agents,
// the always-present list of the other AI agents on this Mac, right under the Claude card.
//
//   ✦  AI agents                     Other AI on this Mac.          ● Codex connected               ›
//      Codex        OpenAI          ● Connected                                         [Disconnect]
//      opencode     opencode        ● Available        Uses opencode's hosted model…    [Connect]
//      › Advanced   agents Maude cannot hold to its limits, each behind a consent card, and (B7) own API keys:
//                   "Codex API key [••••] [Save]" per agent that takes one, and Claude's opt-in
//                   "Use an Anthropic API key for Claude instead of your Claude account" behind a billing card
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
import {
  agentKeyRows,
  CLAUDE_OPTIN_WORDS,
  keyErrorWords,
  keyLooksValid,
  maskedKey,
  removeAgentKey,
  saveAgentKey,
} from './agent-keys.js';
import { connectionFoldId } from './connections-model.js';
import { CardRow, SettingsCard, StatusLine } from './settings-card.jsx';

const btn = 'btn btn--sm';

/**
 * B7 — "Use an API key" for one agent: a masked input + Save, or ••••last4 + Remove once stored. The
 * typed key lives only in this input's state and is dropped after the save; the server never sends it.
 */
export function AgentKeyRow({ row, label, save = saveAgentKey, remove = removeAgentKey, optIn }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ok = keyLooksValid(value);
  const doSave = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    const r = await save(row.id, value.trim(), optIn ? { optIn: true } : undefined);
    setBusy(false);
    setValue('');
    if (!r?.ok) setError(keyErrorWords(r));
  };
  const doRemove = async () => {
    setBusy(true);
    setError(null);
    const r = await remove(row.id);
    setBusy(false);
    if (!r?.ok) setError('Could not remove the key. Try again.');
  };
  return (
    <div className="v2s-agent" data-testid={`settings-agent-keyrow-${row.id}`}>
      <CardRow
        k={label ?? `${row.label} API key`}
        testid={`settings-agent-keystate-${row.id}`}
        action={
          row.keySet ? (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={doRemove}
              data-testid={`settings-agent-key-remove-${row.id}`}
            >
              Remove
            </button>
          ) : null
        }
      >
        <StatusLine sw={row.keySet ? 'ok' : 'off'}>
          {row.keySet ? `Using your key ${maskedKey(row.last4)}` : 'Not set'}
        </StatusLine>
      </CardRow>
      {row.keySet ? null : (
        <span className="v2s-conn-replace">
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste an API key"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doSave();
            }}
            aria-label={`${row.label} API key`}
            data-testid={`settings-agent-key-${row.id}`}
          />
          <button
            type="button"
            className={btn}
            disabled={busy || !ok}
            {...reasonProps(busy || !ok, busy ? 'Saving…' : 'Paste the key first.')}
            onClick={() => void doSave()}
            data-testid={`settings-agent-key-save-${row.id}`}
          >
            Save
          </button>
        </span>
      )}
      {error ? (
        <p className="v2s-conn-err" role="alert" data-testid={`settings-agent-key-error-${row.id}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * B7 (DDR-252 amends DDR-123) — "Use an Anthropic API key for Claude instead of your Claude account".
 * Off by default; turning it on shows the billing confirm card first, and only then the key input.
 * Removing the key turns it off.
 */
export function ClaudeApiKeyOptIn({ row, save = saveAgentKey, remove = removeAgentKey }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const on = row.keySet;
  return (
    <div className="v2s-agent" data-testid="settings-claude-apikey">
      <label className="v2s-row v2s-row--switch">
        <span className="v2s-row-t">
          <span className="v2s-row-k">
            Use an Anthropic API key for Claude instead of your Claude account
          </span>
          <span className="v2s-hint">
            {on
              ? `Billed per token to the key ${maskedKey(row.last4)}`
              : 'Off: Claude uses your Claude plan.'}
          </span>
        </span>
        <input
          type="checkbox"
          className="v2s-switch"
          role="switch"
          aria-checked={on || confirmed}
          checked={on || confirmed}
          onChange={(e) => {
            if (e.target.checked) setConfirming(true);
            else if (on) void remove(row.id);
            else setConfirmed(false);
          }}
          data-testid="settings-claude-apikey-optin"
        />
      </label>
      {confirming && !on ? (
        // biome-ignore lint/a11y/useSemanticElements: a labelled question with two buttons, not a form fieldset
        <div
          className="v2s-conn-keys"
          role="group"
          aria-label="Bill Claude to an API key"
          data-testid="settings-claude-apikey-confirm"
        >
          <p className="v2s-hint">{CLAUDE_OPTIN_WORDS}</p>
          <span className="v2s-conn-replace">
            <button
              type="button"
              className={btn}
              onClick={() => setConfirming(false)}
              data-testid="settings-claude-apikey-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => {
                setConfirming(false);
                setConfirmed(true);
              }}
              data-testid="settings-claude-apikey-confirm-yes"
            >
              Bill my API account
            </button>
          </span>
        </div>
      ) : null}
      {on || confirmed ? (
        <AgentKeyRow
          row={row}
          label="Anthropic API key"
          optIn
          save={save}
          remove={async (id) => {
            setConfirmed(false);
            return remove(id);
          }}
        />
      ) : null}
    </div>
  );
}

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
        {...reasonProps(other, 'Another agent is connecting.')}
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
export function AgentsCardView({
  list,
  c,
  card,
  disconnect = disconnectAgent,
  saveKey = saveAgentKey,
  removeKey = removeAgentKey,
}) {
  const [asking, setAsking] = useState(null);
  const agents = list?.agents ?? [];
  if (!agentsCardVisible(agents)) return null;
  const { main, advanced } = agentRows(agents);
  const { keys, claude } = agentKeyRows(agents);
  const foldBody = advanced.length || keys.length || claude;
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
        foldBody
          ? {
              panel: connectionFoldId('agents'),
              hint: advanced.length
                ? keys.length || claude
                  ? 'own API keys, agents without Maude’s limits'
                  : 'agents without Maude’s limits'
                : 'own API keys',
              testid: 'settings-agents-advanced',
              body: (
                <>
                  {keys.map((k) => (
                    <AgentKeyRow key={`key-${k.id}`} row={k} save={saveKey} remove={removeKey} />
                  ))}
                  {claude ? (
                    <ClaudeApiKeyOptIn row={claude} save={saveKey} remove={removeKey} />
                  ) : null}
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
