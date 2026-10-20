// client/v2/onboarding/AdvSheet.jsx — the shell every Advanced sheet shares (02 Onboarding ob-adv-sheets, S6.9):
// a scrim, one centred sheet built on the same plane as the Connect-AI sheet (`ai-conn-*`), a title that asks
// with the verb of its main button, and Cancel. Esc cancels. Mono is allowed inside the bodies and nowhere else
// (the canvas's note 15: "Advanced language is allowed here, and only here").

import { useEffect, useId } from 'react';

/** A scrim behind one sheet; a click on it or Esc is Cancel. */
export function AdvModal({ onCancel, children }) {
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
    <div className="home-link-modal ob-modal">
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
  return (
    <form
      className="ai-conn-sheet ob-sheet"
      style={{ width, maxWidth: '100%' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
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
  );
}
