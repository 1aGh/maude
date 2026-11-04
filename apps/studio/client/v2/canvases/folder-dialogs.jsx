// client/v2/canvases/folder-dialogs.jsx — #195 (2.0.4): the tree's folder and file asks, in the shell's own
// centered dialog instead of `window.prompt` / `window.confirm` (both are no-ops in Tauri's WKWebView, which is
// why "New folder here" and "Rename folder" did nothing on the desktop).
//
// `TreeAsk` owns one ask at a time: the name check before anything is sent, the busy state while the request
// runs, and the refusal under the field (folder-ask.js `askFailure`). `run(ask, name?)` is the request; it
// answers `{ ok, status?, error?, network? }`.

import { useCallback, useId, useRef, useState } from 'react';

import NameDialog from '../create/NameDialog.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { askFailure, asksForName, checkAskName, folderAskWords } from './folder-ask.js';

/** A yes/no ask on the same material as NameDialog: title, one line, Cancel and the verb. */
export function ConfirmAskDialog({
  title,
  body,
  confirm,
  busyLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}) {
  const okRef = useRef(null);
  const ref = useModalFocus({ onClose: onCancel, initialRef: okRef });
  const titleId = useId();
  return (
    <div className="nd-scrim" data-testid="tree-ask-scrim">
      <form
        ref={ref}
        className="island nd-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="tree-ask-confirm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <h2 id={titleId} className="nd-title" data-testid="tree-ask-title">
          {title}
        </h2>
        {body ? <p className="nd-body">{body}</p> : null}
        {error ? (
          <p className="nd-err" role="alert" data-testid="tree-ask-error">
            {error}
          </p>
        ) : null}
        <div className="nd-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="tree-ask-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={okRef}
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-testid="tree-ask-ok"
          >
            {busy ? busyLabel : confirm}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The host: `ask` is `{ kind, path, name? }` or null; `run(ask, name)` sends it; `onClose()` ends the ask.
 */
export function TreeAsk({ ask, run, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const words = folderAskWords(ask);

  const close = useCallback(() => {
    setBusy(false);
    setError('');
    onClose();
  }, [onClose]);

  const send = useCallback(
    async (name) => {
      if (!ask || busy) return;
      if (asksForName(ask)) {
        const v = checkAskName(ask, name);
        if (v.kind === 'keep') return close();
        if (v.kind === 'error') return setError(v.error);
        name = v.name;
      }
      setBusy(true);
      setError('');
      let res;
      try {
        res = await run(ask, name);
      } catch {
        res = { ok: false, network: true };
      }
      if (res?.ok) return close();
      setBusy(false);
      setError(askFailure(ask.kind, res));
      return undefined;
    },
    [ask, busy, run, close]
  );

  if (!ask || !words) return null;
  if (asksForName(ask)) {
    return (
      <NameDialog
        key={`${ask.kind}:${ask.path}`}
        title={words.title}
        label={words.label}
        initial={words.initial}
        confirm={words.confirm}
        busyLabel={words.busy}
        busy={busy}
        error={error}
        onSubmit={send}
        onCancel={close}
      />
    );
  }
  return (
    <ConfirmAskDialog
      title={words.title}
      body={words.body}
      confirm={words.confirm}
      busyLabel={words.busy}
      busy={busy}
      error={error}
      onConfirm={() => send()}
      onCancel={close}
    />
  );
}
