// client/v2/canvases/inline-rename.jsx — S1.2: rename in place (11 · pn-move, "Double-click a name").
//
// The name turns into a field with the whole name selected. ↵ renames, esc keeps the name; a click away
// renames when there is a change and nothing is wrong, else keeps the name. A name another canvas in the
// folder already has is refused here, under the field, and the field stays open (RENAME_WORDS). A name
// outside the allowed set (S1.23c) is refused with a suggestion, and the suggestion is put IN the field
// (selected), so one more ↵ accepts it.

import { useEffect, useRef, useState } from 'react';
import { checkRename, RENAME_WORDS } from './rename-model.js';

export function InlineRename({ slug, current, siblings, onCommit, onCancel }) {
  // The text, the reason under it and the count of suggestions taken in are ONE state, so a refusal that
  // carries a suggestion changes the field and the words in a single update.
  const [field, setField] = useState({ draft: current, error: '', picked: 0 });
  const { draft, error, picked } = field;
  const setError = (e) => setField((f) => ({ ...f, error: e }));
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const settled = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // A suggestion just went into the field: select it, so typing replaces it and ↵ takes it.
  useEffect(() => {
    if (picked) inputRef.current?.select();
  }, [picked]);

  const finish = (fn) => {
    if (settled.current) return;
    settled.current = true;
    fn();
  };

  const submit = async (fromBlur = false) => {
    if (settled.current || busy) return;
    const verdict = checkRename({ draft, current, siblings });
    if (verdict.kind === 'keep') return finish(onCancel);
    if (verdict.kind === 'error') {
      if (fromBlur) return finish(onCancel);
      setField((f) =>
        verdict.suggestion
          ? { draft: verdict.suggestion, error: verdict.error, picked: f.picked + 1 }
          : { ...f, error: verdict.error }
      );
      inputRef.current?.focus();
      return undefined;
    }
    setBusy(true);
    let res;
    try {
      res = await onCommit(verdict.name);
    } catch {
      res = { ok: false, error: RENAME_WORDS.failed };
    }
    setBusy(false);
    if (res?.ok === false) {
      if (fromBlur) return finish(onCancel);
      setError(res.error || RENAME_WORDS.failed);
      inputRef.current?.focus();
      return undefined;
    }
    return finish(() => onCancel(true));
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(onCancel);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        className={`cv-rename${error ? ' is-invalid' : ''}`}
        type="text"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-label="Canvas name"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `cv-rename-err-${slug}` : undefined}
        data-testid={`canvas-rename-input-${slug}`}
        disabled={busy}
        onChange={(e) => {
          const value = e.target.value;
          setField((f) => ({ ...f, draft: value, error: '' }));
        }}
        onKeyDown={onKeyDown}
        onBlur={() => submit(true)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {error ? null : (
        <span className="cv-rename-hint" data-testid="canvas-rename-hint">
          <kbd className="kbd">↵</kbd> rename · <kbd className="kbd">esc</kbd> keep “{current}”
        </span>
      )}
      {error ? (
        <p
          id={`cv-rename-err-${slug}`}
          className="cv-rename-err"
          role="alert"
          data-testid="canvas-rename-error"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
