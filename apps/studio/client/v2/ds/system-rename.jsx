// client/v2/ds/system-rename.jsx — P8 round 7: "Rename…" of a pinned system row (13 · ds-multi-menu).
//
// The row's name turns into a field holding the name, selected — the same gesture as renaming a canvas in place
// (canvases/inline-rename.jsx, and its `cv-rename*` look). ↵ renames, esc keeps the name; a click away renames when
// there is a change and nothing is wrong. An empty name, one past 64 characters, or one another system already
// shows is refused under the field and the field stays open; nothing is sent. The commit hands the cleaned name to
// `onCommit` (the tree runs `ds.rename`, whose toast carries the Undo).

import { useEffect, useRef, useState } from 'react';
import { checkSystemName, RENAME_SYSTEM_WORDS } from './rename-write.js';

/**
 * @param {{ ds: string, current: string, others?: string[], onCommit: (name: string) => void,
 *           onDone: () => void }} p
 */
export function SystemRenameField({ ds, current, others = [], onCommit, onDone }) {
  const [draft, setDraft] = useState(current);
  // the refusal and the text it was about: it speaks while the field still holds that text
  const [refused, setRefused] = useState(null);
  const error = refused && refused.text === draft ? refused.error : '';
  const ref = useRef(null);
  const settled = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const finish = (fn) => {
    if (settled.current) return;
    settled.current = true;
    fn?.();
    onDone();
  };

  const submit = (fromBlur = false) => {
    if (settled.current) return;
    // the field's own text: a key can arrive before the change event's render (the state may lag a keystroke)
    const text = ref.current?.value ?? draft;
    const v = checkSystemName({ draft: text, current, others });
    if (v.kind === 'keep') return finish();
    if (v.kind === 'error') {
      if (fromBlur) return finish();
      setDraft(text);
      setRefused({ text, error: v.error });
      ref.current?.focus();
      return undefined;
    }
    return finish(() => onCommit(v.name));
  };

  const errId = `lp-ds-rename-err-${ds}`;
  return (
    <span className="lp-ds-rename">
      <input
        ref={ref}
        className={`cv-rename lp-ds-rename-input${error ? ' is-invalid' : ''}`}
        type="text"
        value={draft}
        maxLength={80}
        spellCheck={false}
        autoComplete="off"
        aria-label={RENAME_SYSTEM_WORDS.field}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errId : undefined}
        data-testid="canvases-ds-rename-input"
        data-ds={ds}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish();
          }
        }}
        onBlur={() => submit(true)}
        onClick={(e) => e.stopPropagation()}
      />
      {error ? (
        <span
          id={errId}
          className="cv-rename-err"
          role="alert"
          data-testid="canvases-ds-rename-error"
        >
          {error}
        </span>
      ) : (
        <span className="cv-rename-hint" data-testid="canvases-ds-rename-hint">
          <kbd className="kbd">↵</kbd> rename · <kbd className="kbd">esc</kbd> keep “{current}”
        </span>
      )}
    </span>
  );
}
