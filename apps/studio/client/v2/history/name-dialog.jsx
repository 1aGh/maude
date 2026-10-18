// client/v2/history/name-dialog.jsx — S1.14: "Name this version" (the Now row's button, V2-1.9 §5.4).
//
// The title asks with the verb the primary button does (CONTRACT §4): "Name this version" → Name version;
// the other button is Cancel. A name is trimmed, 1–80 characters, no control characters (the kernel's rule,
// checked here first so the field can say so under itself); duplicates are allowed.

import { useRef, useState } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';
import { HISTORY_WORDS } from './use-versions.js';

export const NAME_MAX = 80;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a name may not carry control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

/** @returns { ok: true, name } | { ok: false, error: string | null } — null = nothing to say yet (empty). */
export function checkName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, error: null };
  if (name.length > NAME_MAX) return { ok: false, error: HISTORY_WORDS.nameTooLong };
  if (CONTROL.test(name)) return { ok: false, error: HISTORY_WORDS.nameFailed };
  return { ok: true, name };
}

export function NameDialog({ canvasLabel, initial = '', onSubmit, onClose }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: inputRef });
  const verdict = checkName(draft);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!verdict.ok) {
      if (verdict.error) setError(verdict.error);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    let res;
    try {
      res = await onSubmit(verdict.name);
    } catch {
      res = { ok: false, error: HISTORY_WORDS.nameFailed };
    }
    setBusy(false);
    if (res?.ok === false) setError(res.error || HISTORY_WORDS.nameFailed);
  };

  return (
    <div className="vh-scrim" data-testid="vh-name-scrim">
      <form
        ref={ref}
        className="island vh-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vh-name-title"
        tabIndex={-1}
        data-testid="vh-name-dialog"
        onSubmit={submit}
      >
        <h2 id="vh-name-title" className="vh-dialog-t">
          {HISTORY_WORDS.nameTitle}
        </h2>
        <p className="vh-dialog-sub">{canvasLabel}</p>
        <input
          ref={inputRef}
          className="vh-field"
          type="text"
          value={draft}
          maxLength={NAME_MAX + 20}
          placeholder={HISTORY_WORDS.namePlaceholder}
          aria-label={HISTORY_WORDS.namePlaceholder}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'vh-name-error' : undefined}
          data-testid="vh-name-input"
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
        />
        {error ? (
          <p id="vh-name-error" className="vh-dialog-err" role="alert" data-testid="vh-name-error">
            {error}
          </p>
        ) : null}
        <div className="vh-dialog-btns">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {HISTORY_WORDS.nameCancel}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !verdict.ok}
            data-testid="vh-name-save"
          >
            {HISTORY_WORDS.nameSave}
          </button>
        </div>
      </form>
    </div>
  );
}
