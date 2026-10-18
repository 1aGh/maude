// client/v2/ai/ConnectSheet.jsx — S5.13 (03 `ai-not-ready`, CONTRACT §7): the ONE "Connect your Claude account?"
// sheet. The first use of AI with no Claude account connected asks once; the prompt waits and runs as soon as it
// is connected. Exported for S6 (the first-canvas drafting flow) and for 02 `ob-ai-connect`: it is a controlled
// view — the caller owns what Connect does (the panel runs `connectClaude`; onboarding may do the same).
//
//   <ConnectSheet inline width phase="idle|installing|waiting" error onConnect onCancel>{advanced}</ConnectSheet>
//
// `inline` draws it in flow (inside the panel); otherwise it is a window sheet (the caller puts a Veil under
// it). Words are CONTRACT §7: "Connect your Claude account to let AI draft this." → Connect · Cancel.

import { useId } from 'react';
import { Spark } from './icons.jsx';

const CONNECT_LABEL = {
  idle: 'Connect',
  installing: 'Setting up Claude Code…',
  waiting: 'Waiting for your browser…',
};

export function ConnectSheet({
  width = 440,
  inline = false,
  phase = 'idle',
  error = null,
  onConnect,
  onCancel,
  children,
}) {
  const titleId = useId();
  const busy = phase !== 'idle';
  return (
    <div
      className={`ai-conn-sheet${inline ? ' ai-conn-sheet--inline' : ''}`}
      style={{ width: inline ? undefined : width, maxWidth: '100%' }}
      role={inline ? 'group' : 'dialog'}
      aria-modal={inline ? undefined : 'true'}
      aria-labelledby={titleId}
      data-testid="ai-connect-sheet"
      data-phase={phase}
    >
      <p className="ai-conn-t" id={titleId}>
        Connect your Claude account?
      </p>
      <div className="ai-conn-b">
        <p>Connect your Claude account to let AI draft this.</p>
        <span className="ai-conn-opt">
          <span className="ai-conn-ic" aria-hidden="true">
            <Spark size={14} />
          </span>
          <span className="ai-conn-txt">
            <strong>Claude Pro or Max</strong>
            <span>Sign in through your browser. Claude Code is set up for you.</span>
          </span>
        </span>
        {children}
        {error ? (
          <p className="ai-conn-err" role="alert" data-testid="ai-connect-error">
            {error}
          </p>
        ) : null}
        <p className="ai-conn-fine">Your prompt waits here and runs as soon as it's connected.</p>
      </div>
      <div className="ai-conn-a">
        <button
          type="button"
          className="btn btn--sm"
          data-testid="ai-connect-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy}
          data-testid="ai-connect-go"
          onClick={onConnect}
        >
          {CONNECT_LABEL[phase] ?? CONNECT_LABEL.idle}
        </button>
      </div>
    </div>
  );
}

export default ConnectSheet;
