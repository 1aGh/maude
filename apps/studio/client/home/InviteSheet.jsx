// client/home/InviteSheet.jsx — "Open the invite as you@work-studio.cz?" (02 ob-edge-accounts, S6.11, S6 Q12).
//
// `join` mode (gate-b-sec3 M2): the invite's address IS signed in here. A `maude://invite` link can come from any
// web page, so it never accepts by itself — the sheet names the project, who invited, and the account that joins,
// and Join is the one explicit step.
//
// Shown when the invite's address is not an account this Mac is signed in with (or nobody is signed in). It says
// who the invite is for, and Open signs that address in — in a NEW profile, its own tab — so the person's other
// tabs keep their accounts. It never names anything from the invite link itself: the words come from the peek
// (what the public invite page shows), and the invite id is not in this component at all.

import { useEffect } from 'react';

import { accountFace } from './home-model.js';
import { HIcon } from './home-icons.jsx';
import { INVITE_WORDS, inviteSheetWords } from './invite-flow.js';

function Face({ id, label, email }) {
  const f = accountFace({ id, label, email });
  return (
    <span className={`home-face home-inv-face home-face--${f.tone}`} aria-hidden="true">
      {f.initial}
    </span>
  );
}

/**
 * @param {{ sheet: { mode: 'join'|'other-account'|'signed-out', invite: { projectName: string, fromName: string|null,
 *           email: string }, current: { profile: string, email: string|null } | null, busy: boolean },
 *           waiting: boolean, onOpen: () => void, onCancel: () => void, onReopen?: (() => void) | null }} props
 */
export function InviteSheet({ sheet, waiting, onOpen, onCancel, onReopen = null }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const w = inviteSheetWords(sheet);
  const other = sheet.mode === 'other-account';
  const join = sheet.mode === 'join';
  return (
    <div
      className="home-link-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-inv-title"
    >
      <div className="home-link-scrim" aria-hidden="true" onClick={onCancel} />
      <div
        className="island home-link-dialog home-inv"
        data-testid="invite-sheet"
        data-mode={sheet.mode}
        data-state={waiting ? 'waiting' : 'idle'}
      >
        <h2 id="home-inv-title" data-testid="invite-sheet-title">
          {w.title}
        </h2>
        <p data-testid="invite-sheet-body">{w.body}</p>
        {other ? (
          <span className="home-inv-acc">
            <span className="home-inv-row">
              <Face id={sheet.current?.profile ?? ''} email={sheet.current?.email ?? ''} />
              <span className="home-inv-t">
                <strong>{sheet.current?.email || 'This account'}</strong>
                <span>{INVITE_WORDS.thisWindow}</span>
              </span>
            </span>
            <span className="home-inv-arrow" aria-hidden="true">
              <HIcon name="submenu" size={14} />
            </span>
            <span className="home-inv-row">
              <Face id={sheet.invite.email} email={sheet.invite.email} />
              <span className="home-inv-t">
                <strong>{sheet.invite.email}</strong>
                <span>{INVITE_WORDS.newTab}</span>
              </span>
            </span>
          </span>
        ) : null}
        {join ? (
          <span className="home-inv-acc" data-testid="invite-sheet-account">
            <span className="home-inv-row">
              <Face
                id={sheet.current?.profile ?? ''}
                email={sheet.current?.email ?? sheet.invite.email}
              />
              <span className="home-inv-t">
                <strong>{sheet.current?.email || sheet.invite.email}</strong>
                <span>{INVITE_WORDS.newTab}</span>
              </span>
            </span>
          </span>
        ) : null}
        <p className="home-inv-fine">{w.fine}</p>
        {waiting ? (
          <p className="home-inv-wait" role="status" data-testid="invite-sheet-waiting">
            {INVITE_WORDS.waiting}
            {onReopen ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="invite-sheet-reopen"
                onClick={onReopen}
              >
                {INVITE_WORDS.again}
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="home-link-foot">
          <button
            type="button"
            className="btn"
            data-testid="invite-sheet-cancel"
            onClick={onCancel}
          >
            {INVITE_WORDS.cancel}
          </button>
          {join ? (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="invite-sheet-join"
              disabled={sheet.busy}
              // biome-ignore lint/a11y/noAutofocus: the sheet asks one question; Join is its answer
              autoFocus
              onClick={onOpen}
            >
              {INVITE_WORDS.join}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="invite-sheet-open"
              disabled={sheet.busy || waiting}
              // biome-ignore lint/a11y/noAutofocus: the sheet asks one question; Open is its answer
              autoFocus
              onClick={onOpen}
            >
              {INVITE_WORDS.open}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
