// client/v2/ai/ConnectSheet.jsx — S5.13 (03 `ai-not-ready`, CONTRACT §7): the ONE "Connect your Claude account?"
// sheet. The first use of AI with no Claude account connected asks once; the prompt waits and runs as soon as it
// is connected. Exported for S6 (the first-canvas drafting flow) and for 02 `ob-ai-connect`: it is a controlled
// view — the caller owns what Connect does (the panel runs `connectClaude`; onboarding may do the same).
//
//   <ConnectSheet inline width phase="idle|installing|waiting" error onConnect onCancel>{advanced}</ConnectSheet>
//
// `inline` draws it in flow (inside the panel); otherwise it is a window sheet (the caller puts a Veil under
// it). Words are CONTRACT §7: "Connect your Claude account to let AI draft this." → Connect · Cancel.

import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../shell/modal-focus.js';
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
  connectRef,
  // S6.9 (02 ob-adv-sheets): Home's "Connect AI" reads "Connect AI" and carries no "your prompt waits"
  // line (there is no prompt yet). The defaults are CONTRACT §7's words, unchanged for every other caller.
  title = 'Connect your Claude account?',
  lead = 'Connect your Claude account to let AI draft this.',
  fine = "Your prompt waits here and runs as soon as it's connected.",
  // 09 ex-handoff-edges draws the card without the "Claude Pro or Max" row: just the words and the two buttons
  option = true,
  children,
}) {
  const titleId = useId();
  const busy = phase !== 'idle';
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is set only while role is "dialog" (inline, the sheet is a group and carries none)
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
        {title}
      </p>
      <div className="ai-conn-b">
        {lead ? <p>{lead}</p> : null}
        {option ? (
          <span className="ai-conn-opt">
            <span className="ai-conn-ic" aria-hidden="true">
              <Spark size={14} />
            </span>
            <span className="ai-conn-txt">
              <strong>Claude Pro or Max</strong>
              <span>Sign in through your browser. Claude Code is set up for you.</span>
            </span>
          </span>
        ) : null}
        {children}
        {error ? (
          <p className="ai-conn-err" role="alert" data-testid="ai-connect-error">
            {error}
          </p>
        ) : null}
        {fine ? <p className="ai-conn-fine">{fine}</p> : null}
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
          ref={connectRef}
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

/**
 * P8 C3 (02 ob-ai-connect, 05 es-canvas-three): the sheet as drawn - a CENTRED card over a strong veil, never a
 * strip inside the panel (the stage-C "inline sheet" was clipped and unreadable). A modal: focus lands on Connect,
 * Tab stays inside, Esc is Cancel (which drops the kept prompt, so a stray click on the veil is NOT Cancel).
 * Rendered into the document body so no transformed panel ancestor can pin or clip it.
 * @param {object} props — the ConnectSheet props, plus `testid` for the veil
 */
export function ConnectModal({ testid = 'ai-connect-modal', onCancel, ...sheet }) {
  const connectRef = useRef(null);
  const root = useModalFocus({ onClose: onCancel, initialRef: connectRef });
  if (typeof document === 'undefined') return null;
  // the body is outside the app's `.maude` root, and every kit rule (`.maude .btn…`) is scoped under it:
  // without this wrapper Cancel / Connect render as bare browser buttons (D5 02 ob-ai-connect)
  return createPortal(
    <div className="maude">
      <div className="ai-conn-veil" ref={root} tabIndex={-1} data-testid={testid}>
        <ConnectSheet {...sheet} connectRef={connectRef} onCancel={onCancel} />
      </div>
    </div>,
    document.body
  );
}

export default ConnectSheet;
