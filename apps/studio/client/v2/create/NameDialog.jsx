// client/v2/create/NameDialog.jsx — R3 (6): the small centered dialog that asks for a name before a canvas is
// made. Title · a name field (prefilled, selected) · Cancel and Create. Enter creates, Esc cancels; focus is
// trapped and handed back by the shell's one discipline (useModalFocus). Presentational: the host does the work.

import { useEffect, useId, useRef, useState } from 'react';

import { useModalFocus } from '../shell/modal-focus.js';

/**
 * @param {{ title: string, label: string, initial: string, confirm?: string, busy?: boolean, error?: string,
 *   busyLabel?: string, onSubmit: (name: string) => void, onCancel: () => void }} props
 * #195 — the tree's folder asks reuse this dialog ("Rename folder", "Renaming…").
 */
export default function NameDialog({
  title,
  label,
  initial,
  confirm = 'Create',
  busyLabel = 'Creating…',
  busy = false,
  error = '',
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef(null);
  const ref = useModalFocus({ onClose: onCancel, initialRef: inputRef });
  const titleId = useId();
  const name = value.trim();

  // the prefilled name is selected, so typing replaces it
  useEffect(() => {
    inputRef.current?.select?.();
  }, []);

  const submit = (e) => {
    e?.preventDefault?.();
    if (busy || !name) return;
    onSubmit(name);
  };

  return (
    <div className="nd-scrim" data-testid="name-dialog-scrim">
      <form
        ref={ref}
        className="island nd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="name-dialog"
        onSubmit={submit}
      >
        <h2 id={titleId} className="nd-title" data-testid="name-dialog-title">
          {title}
        </h2>
        <label className="field">
          <span className="field-label">{label}</span>
          <input
            ref={inputRef}
            type="text"
            className="input"
            value={value}
            maxLength={60}
            disabled={busy}
            data-testid="name-dialog-input"
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error ? (
          <p className="nd-err" role="alert" data-testid="name-dialog-error">
            {error}
          </p>
        ) : null}
        <div className="nd-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="name-dialog-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !name}
            data-testid="name-dialog-create"
          >
            {busy ? busyLabel : confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
