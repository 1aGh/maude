// client/v2/onboarding/ConnectAiSheet.jsx — "Connect AI" (02 ob-adv-sheets, S6.9): S5.13's ConnectSheet (the ONE
// Claude connect sheet) with the Advanced reading — title "Connect AI", the API-key option beside Claude, and the
// status word. A view: the caller owns what Connect does (Home: `connectClaudeHome` over `/_home/ai/*`).
//
// The API key option is drawn and RESTS. Maude's AI runs on the person's own Claude subscription: the adapter's
// environment is scrubbed of `ANTHROPIC_API_KEY` on purpose (DDR-123 guardrail 1, acp/env.ts), so there is no
// place for a key to be kept yet. A resting option says that the choice exists (a hidden one would hide it); the
// decision to lift the guardrail is the lead's, and it would turn this on without changing the sheet.

import ConnectSheet from '../ai/ConnectSheet.jsx';
import { AdvModal, Sw } from './AdvSheet.jsx';
import { AI_WORDS as W } from './onboarding-model.js';

/**
 * @param {{ connected?: boolean, phase?: 'idle'|'installing'|'waiting', error?: string|null,
 *           onConnect: () => void, onCancel: () => void }} props
 */
export function ConnectAiSheet({
  connected = false,
  phase = 'idle',
  error = null,
  onConnect,
  onCancel,
}) {
  return (
    <AdvModal onCancel={onCancel}>
      <ConnectSheet
        title={W.title}
        lead={null}
        fine={null}
        phase={phase}
        error={error}
        onConnect={onConnect}
        onCancel={onCancel}
      >
        <span className="ob-opt" aria-disabled="true" data-testid="onb-ai-apikey">
          <span className="ob-radio" aria-hidden="true" />
          <span className="ob-opt-txt">
            <strong>{W.key}</strong>
            <span>{W.keySub}</span>
            <input
              className="ob-input ob-mono"
              type="text"
              disabled
              aria-label={W.key}
              placeholder={W.keyHint}
              autoComplete="off"
              spellCheck={false}
            />
          </span>
        </span>
        <span className="ob-ok" role="status">
          <Sw state={connected ? 'ok' : 'off'} testid="onb-ai-status">
            {connected ? W.on : W.off}
          </Sw>
        </span>
      </ConnectSheet>
    </AdvModal>
  );
}
