// QuitDialog.jsx — S5.14: "Quit while AI is working?" (03 `ai-quit`, V2-1.15 §5.9).
//
// The native shell (quit.rs) decides: it probes every project's own runs, picks this tab, and
// sends `quit://ask {nonce, chats}` through this page's own shell channel (shell-bus.js). This
// page only shows the question and answers `quit_answer {nonce, answer}` — `shown` as soon as
// it is on screen, then `quit` or `cancel`. Stopping, publishing and the exit are the shell's
// and each studio's business; nothing here can quit another project or skip its stop. A page
// that never says `shown` gets the native dialog instead, and a second ⌘Q always quits.
//
// Outside the desktop app there is no shell: `listen` resolves a no-op and this renders nothing.

import { useCallback, useEffect, useRef, useState } from 'react';

import { listen } from '../../shell-bus.js';
import { parseQuitAsk, quitDialogText } from './stopped.js';

function answer(nonce, kind) {
  const invoke = typeof window !== 'undefined' ? window.__TAURI__?.core?.invoke : null;
  if (!invoke) return Promise.resolve(false);
  return invoke('quit_answer', { nonce, answer: kind }).catch(() => false);
}

export function QuitDialog() {
  const [ask, setAsk] = useState(null); // {nonce, chats}
  const [quitting, setQuitting] = useState(false);
  const quitRef = useRef(null);
  const returnFocus = useRef(null);

  useEffect(() => {
    let off = () => {};
    let alive = true;
    listen('quit://ask', (payload) => {
      const next = parseQuitAsk(payload);
      if (!next) return;
      returnFocus.current = document.activeElement;
      setQuitting(false);
      setAsk(next);
    })
      .then((unlisten) => {
        if (alive) off = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, []);

  // On screen → tell the shell, and put focus on Quit (the dialog's default action).
  useEffect(() => {
    if (!ask) return;
    quitRef.current?.focus();
    void answer(ask.nonce, 'shown');
  }, [ask]);

  const close = useCallback(() => {
    setAsk(null);
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && typeof el.focus === 'function') el.focus();
  }, []);

  const cancel = useCallback(() => {
    if (!ask || quitting) return;
    void answer(ask.nonce, 'cancel');
    close();
  }, [ask, quitting, close]);

  const quit = useCallback(() => {
    if (!ask || quitting) return;
    setQuitting(true);
    void answer(ask.nonce, 'quit');
  }, [ask, quitting]);

  if (!ask) return null;
  const words = quitDialogText(ask.chats);
  return (
    <div className="gi-modal ai-quit-modal" role="presentation">
      <div className="gi-scrim" aria-hidden="true" onClick={cancel} />
      <div
        className="gi-dialog ai-quit-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ai-quit-title"
        aria-describedby="ai-quit-body"
        data-testid="ai-quit-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      >
        <h2 id="ai-quit-title" className="ai-quit-title">
          {words.title}
        </h2>
        <p id="ai-quit-body" className="ai-quit-body">
          {quitting ? 'Stopping AI and keeping what it finished…' : words.body}
        </p>
        <div className="ai-quit-actions">
          <button
            type="button"
            className="btn"
            data-testid="ai-quit-cancel"
            disabled={quitting}
            onClick={cancel}
          >
            {words.secondary}
          </button>
          <button
            ref={quitRef}
            type="button"
            className="btn btn--primary"
            data-testid="ai-quit-confirm"
            disabled={quitting}
            onClick={quit}
          >
            {words.primary}
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuitDialog;
