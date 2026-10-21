// client/v2/onboarding/AdvSheet.jsx — the shell every Advanced sheet shares (02 Onboarding ob-adv-sheets, S6.9):
// a scrim, one centred sheet built on the same plane as the Connect-AI sheet (`ai-conn-*`), a title that asks
// with the verb of its main button, and Cancel. Esc cancels. Mono is allowed inside the bodies and nowhere else
// (the canvas's note 15: "Advanced language is allowed here, and only here").

import { useEffect, useId } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';

/** A scrim behind one sheet; a click on it or Esc is Cancel. */
export function AdvModal({ onCancel, children }) {
  // gate-b-a11y: focus lands inside on open, Tab is trapped (the sheets are aria-modal), and focus goes back
  // to the opener — or the shell's fallback — on close. Esc stays this component's (it cancels), so the
  // hook's own esc is off.
  const root = useModalFocus({ onClose: onCancel, esc: false });
  // A sheet that focuses nothing of its own (the hub sheet does) gets its first control, so a screen reader is
  // inside the dialog rather than on the scrim's wrapper.
  useEffect(() => {
    const at = root.current;
    if (at && document.activeElement === at)
      at.querySelector(
        '[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea, [role="dialog"] button:not([disabled])'
      )?.focus();
  }, [root]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div ref={root} tabIndex={-1} className="home-link-modal ob-modal">
      <div className="home-link-scrim" aria-hidden="true" onClick={onCancel} />
      {children}
    </div>
  );
}

/** A status word: a dot and a word, as the canvas's `StatusWord`. state: ok | off | busy | bad. */
export function Sw({ state = 'off', testid, children }) {
  return (
    <span className="ob-sw" data-state={state} data-testid={testid}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * One sheet. `verb` is the primary button's label and the first word of the title; while `busy` the button
 * says `busyVerb`. A sheet with nothing to submit passes `onSubmit` undefined and gets a disabled button.
 * @param {{ id: string, title: string, verb: string, busyVerb?: string, width?: number, busy?: boolean,
 *           canSubmit?: boolean, onSubmit?: () => void, onCancel: () => void, children?: any }} props
 */
export function AdvSheet({
  id,
  title,
  verb,
  busyVerb,
  width = 440,
  busy = false,
  canSubmit = true,
  onSubmit,
  onCancel,
  children,
}) {
  const titleId = useId();
  // gate-b-a11y: the dialog is a <div> around the form (`role=dialog` is not allowed on a <form> — axe
  // aria-allowed-role). Its focus lifetime is AdvModal's (one place for all five Advanced doors).
  return (
    <div
      className="ob-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ maxWidth: '100%' }}
    >
      <form
        className="ai-conn-sheet ob-sheet"
        style={{ width, maxWidth: '100%' }}
        data-testid={`onb-${id}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !busy) onSubmit?.();
        }}
      >
        <h2 className="ai-conn-t" id={titleId}>
          {title}
        </h2>
        <div className="ai-conn-b ob-sheet-b">{children}</div>
        <div className="ai-conn-a">
          <button
            type="button"
            className="btn btn--sm"
            data-testid={`onb-${id}-cancel`}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--sm btn--primary"
            data-testid={`onb-${id}-go`}
            disabled={!canSubmit || busy || !onSubmit}
          >
            {busy && busyVerb ? busyVerb : verb}
          </button>
        </div>
      </form>
    </div>
  );
}
