// client/v2/ai/NotReady.jsx — S5.13 (03 `ai-not-ready`): when AI cannot run yet, Ask AI still takes the prompt and
// KEEPS it. The server says which gate is closed (`{t:'queued'}`, or the outbox record after a reload); this draws
// the line for it and nothing else. The rest of the app keeps working.
//
//   offline      "Queued — sends when this Mac is online."  +  "AI is back when this Mac is online."
//   connect      the ConnectSheet (ask once; the waiting prompt runs when connected)
//   setting-up   "Setting up AI on this Mac. About a minute — keep drawing meanwhile."
//   used-up      "AI's allowance is used up until 18:40. Your prompt is kept and sends then."
//   quota        "90% of this 5-hour allowance used · resets 18:40" (above the field, while it still works)

import { StIcon } from '../../shell/icons.jsx';
import { notReadyModel, quotaModel } from './gate-lines.js';
import { Spark } from './icons.jsx';

const Clock = ({ size = 12 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3.2l2 1.3" />
  </svg>
);

/** One kept prompt's state line(s). `children` = the ConnectSheet when the gate is `ai-connected`. */
export function QueuedState({ queued, count = 1, children }) {
  const m = notReadyModel(queued);
  if (!m.kind) return null;
  const more = count > 1 ? ` · ${count} prompts kept` : '';
  if (m.kind === 'connect') {
    return (
      <div className="ai-nr" data-testid="ai-not-ready" data-kind="connect">
        {children}
      </div>
    );
  }
  if (m.kind === 'offline') {
    return (
      <div className="ai-nr" data-testid="ai-not-ready" data-kind="offline">
        <p className="ai-nr-queued" data-testid="ai-queued-line">
          <Clock />
          {m.lines[0]}
          {more}
        </p>
        <p className="ai-nr-offline" data-testid="ai-offline-line">
          <StIcon name="offline" size={14} />
          {m.lines[1]}
        </p>
      </div>
    );
  }
  if (m.kind === 'setting-up' || m.kind === 'used-up') {
    return (
      <div
        className="ai-nr"
        data-testid="ai-not-ready"
        data-kind={m.kind}
        role="status"
        aria-live="polite"
      >
        <div className="ai-nr-state">
          <span className={`ai-nr-ic${m.kind === 'setting-up' ? ' ai-nr-ic--busy' : ''}`}>
            {m.kind === 'setting-up' ? <Spark size={16} /> : <Clock size={16} />}
          </span>
          <p>
            <strong>{m.lead}</strong> {m.rest}
            {more}
          </p>
          {m.kind === 'setting-up' ? (
            <span className="ai-nr-bar" aria-hidden="true">
              <i />
            </span>
          ) : null}
        </div>
      </div>
    );
  }
  // An earlier ask of this chat is still ahead (O2): nothing is wrong, it goes by itself, in order.
  return (
    <div className="ai-nr" data-testid="ai-not-ready" data-kind="waiting">
      <p className="ai-nr-queued">
        <Clock />
        {m.lines[0] ?? 'Waiting to send.'}
      </p>
    </div>
  );
}

/** The almost-used-up meter, above the field while AI still works. */
export function QuotaLine({ rateLimit }) {
  const q = quotaModel(rateLimit);
  if (!q) return null;
  return (
    <p className="ai-nr-quota" data-testid="ai-quota-line">
      <span className="ai-nr-meter" aria-hidden="true">
        <i style={{ width: `${q.pct}%` }} />
      </span>
      {q.text}
    </p>
  );
}

export default QueuedState;
