// client/v2/ai/AgentNotice.jsx — universal ACP B6, Design Decision 5: what an agent other than Claude said,
// said as ITS words, never as Maude's "AI broke".
//
//   • an error frame carrying `agent`     → "Codex reported: …" + the vendor's status page
//   • `agent-policy-violated`             → "Codex was stopped: it did not stay inside Maude's limits."
//   • `agent-needs-consent`               → the consent card (an unrestricted agent): Allow · Not now
//   • `turn-end` with `reason: 'refused'` → one quiet line (AgentRefusedLine), not an error card
//
// Claude's own errors never come here (agents-model.js `agentErrorModel` answers null for them).

import { useEffect, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { agentErrorModel } from './agents-model.js';

/** The desktop app (Tauri), where the webview has no general browser opener (DDR-054). */
const isDesktop = () => typeof window !== 'undefined' && !!window.__TAURI__;

/**
 * A vendor status page. The URL is a catalog constant the server sent, never canvas or agent text.
 * Browser: a new tab. Desktop: copied to the clipboard. The webview's openers are zone-locked
 * (`open_cloud_url`) or confirm-sheet-only (`open_link_external`, S3.10b), and DDR-054 forbids a
 * general one, so this is the same named fallback the website sheet uses: Copy link.
 */
export function openStatusPage(url, deps = {}) {
  if (!url) return Promise.resolve('failed');
  const desktop = deps.desktop ?? isDesktop();
  if (desktop) {
    const copy = deps.copy ?? ((t) => navigator.clipboard.writeText(t));
    return Promise.resolve()
      .then(() => copy(url))
      .then(
        () => 'copied',
        () => 'failed'
      );
  }
  try {
    (deps.windowOpen ?? window.open)(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve('ok');
  } catch {
    return Promise.resolve('failed');
  }
}

/** The card for an agent's own error, or null when the error is not an agent's. */
export function AgentErrorCard({ error, onRetry, onConsent, onDecline, open = openStatusPage }) {
  const [copied, setCopied] = useState(false);
  const m = agentErrorModel(error);
  if (!m) return null;
  if (m.kind === 'consent')
    return (
      <div className="ai-nc ai-nc-choice" role="alert" data-testid="ai-agent-consent">
        <p className="ai-nc-t">
          <span className="ai-nc-ic ai-nc-ic--prob" aria-hidden="true">
            <StIcon name="problem" size={14} />
          </span>
          <span className="ai-nc-tt">{m.text}</span>
        </p>
        <span className="ai-nc-a">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="ai-agent-consent-dismiss"
            onClick={onDecline}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="ai-agent-consent-allow"
            onClick={() => onConsent?.(m.agent)}
          >
            Allow
          </button>
        </span>
      </div>
    );
  return (
    <div
      className="ai-nc ai-nc-prob"
      role="alert"
      data-testid="ai-agent-error"
      data-kind={m.kind}
      data-agent={m.agent.id}
    >
      <p className="ai-nc-t">
        <span className="ai-nc-ic ai-nc-ic--prob" aria-hidden="true">
          <StIcon name="problem" size={14} />
        </span>
        <span className="ai-nc-tt" data-testid="ai-agent-error-text">
          {m.text}
        </span>
      </p>
      {m.statusUrl || (m.kind === 'reported' && onRetry) ? (
        <span className="ai-nc-a">
          {m.statusUrl ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              data-testid="ai-agent-error-status"
              onClick={() =>
                Promise.resolve(open(m.statusUrl)).then((r) => r === 'copied' && setCopied(true))
              }
            >
              {copied
                ? 'Status page link copied'
                : isDesktop()
                  ? `Copy ${m.agent.vendor || m.agent.label} status link`
                  : `${m.agent.vendor || m.agent.label} status ↗`}
            </button>
          ) : null}
          {m.kind === 'reported' && onRetry ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="ai-agent-error-retry"
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** A refused turn's notice: one quiet line under the chat, cleared when the next turn starts. */
export function AgentRefusedLine({ conn }) {
  const [notice, setNotice] = useState(null);
  useEffect(() => conn?.onNotice?.(setNotice), [conn]);
  if (!notice) return null;
  return (
    <p className="ai-agent-note" role="status" data-testid="ai-agent-refused">
      {notice}
    </p>
  );
}
