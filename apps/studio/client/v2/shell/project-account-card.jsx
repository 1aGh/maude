// client/v2/shell/project-account-card.jsx — 2.0.5 W4: THIS project's account, opened from the avatar
// (your own face in the Share cluster) and from the account chip.
//
// PRESENTATIONAL. The words and the paths come from project-account-model.js; the host
// (share-cluster-host.jsx) runs them. Every button runs a registry action through `run(id)` or the
// kind's existing sign-out path through `onSignOut(path)` — and a row is drawn only where its path
// exists (a browser tab gets the facts and no button). Sign out asks first (CONTRACT §4).

import { useEffect, useRef, useState } from 'react';
import { onCanvasPointer } from './canvas-pointer.js';

/**
 * The popover the card sits in, under the Share cluster's start. Esc, a press outside and a press in the
 * canvas close it; a press on an opener (`data-account-opener` — your face, the account chip) is the
 * opener's own toggle, so it is not an outside press.
 */
export function ProjectAccountPopover({ open, onClose, children }) {
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (wrap.current?.contains(t)) return;
      if (t?.closest?.('[data-account-opener]')) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    const off = onCanvasPointer(() => onClose());
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      off();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sh-acct-card sh-pa-pop" role="dialog" aria-label="Account" ref={wrap}>
      {children}
    </div>
  );
}

function Line({ k, testid, children }) {
  if (!children) return null;
  return (
    <div className="sh-pa-line">
      <span className="sh-pa-k">{k}</span>
      <span className="sh-pa-v" data-testid={testid}>
        {children}
      </span>
    </div>
  );
}

/**
 * @param account projectAccount()
 * @param run (id) => void — the shell's runner (account.switch, account.github-signin)
 * @param onSignOut (path) => Promise — 'cloud-signout' | 'hub-detach' | 'github-signout'
 * @param onClose () => void
 */
export function ProjectAccountCard({ account, run, onSignOut, onClose }) {
  const [asking, setAsking] = useState(null); // the signOut spec being confirmed
  const [busy, setBusy] = useState(false);
  if (!account) return null;
  const gh = account.github;
  const ghOut = gh?.canSignOut
    ? {
        path: 'github-signout',
        label: `Sign out of GitHub (@${gh.login})…`,
        confirm: {
          title: `Sign out of @${gh.login}?`,
          body: 'Every project on it is signed out of GitHub. Your work stays on this Mac.',
          primary: 'Sign out',
          cancel: 'Cancel',
        },
      }
    : null;

  const confirm = async () => {
    const spec = asking;
    setBusy(true);
    try {
      await onSignOut?.(spec.path);
    } finally {
      setBusy(false);
      setAsking(null);
      onClose?.();
    }
  };
  const go = (id) => {
    onClose?.();
    run?.(id);
  };

  return (
    <div className="sh-pa" data-testid="project-account">
      <p className="sh-pa-h">This project’s account</p>
      <Line k="Signed in with" testid="project-account-kind">
        {account.kindLabel}
      </Line>
      <Line k="Account" testid="project-account-who">
        {account.who}
      </Line>
      <Line k={account.kind === 'team' ? 'Server' : 'Project'} testid="project-account-where">
        {account.where}
      </Line>
      <Line k="Profile on this Mac" testid="project-account-profile">
        {account.profileLabel}
      </Line>
      {gh?.login && account.kind !== 'github' ? (
        <Line k="GitHub" testid="project-account-github">
          @{gh.login}
        </Line>
      ) : null}
      {gh?.note ? (
        <p className="sh-pa-note" data-testid="project-account-github-note">
          {gh.note}
        </p>
      ) : null}

      {asking ? (
        <div className="sh-acct-ask" role="alertdialog" data-testid="project-account-confirm">
          <strong>{asking.confirm.title}</strong>
          <span>{asking.confirm.body}</span>
          <span className="sh-acct-btns">
            <button
              type="button"
              className="btn btn--sm"
              data-testid="project-account-signout-cancel"
              onClick={() => setAsking(null)}
            >
              {asking.confirm.cancel}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              data-testid="project-account-signout-confirm"
              disabled={busy}
              onClick={confirm}
            >
              {asking.confirm.primary}
            </button>
          </span>
        </div>
      ) : (
        <>
          {account.switch || gh?.canSignIn || account.signOut || ghOut ? (
            <hr className="sh-acct-sep" />
          ) : null}
          {account.switch ? (
            <button
              type="button"
              className="sh-acct-act"
              data-testid="project-account-switch"
              onClick={() => go(account.switch.id)}
            >
              {account.switch.label}
            </button>
          ) : null}
          {gh?.canSignIn ? (
            <button
              type="button"
              className="sh-acct-act"
              data-testid="project-account-github-signin"
              onClick={() => go('account.github-signin')}
            >
              Sign in with GitHub…
            </button>
          ) : null}
          {account.signOut ? (
            <button
              type="button"
              className="sh-acct-act"
              data-testid="project-account-signout"
              onClick={() => setAsking(account.signOut)}
            >
              {account.signOut.label}
            </button>
          ) : null}
          {ghOut ? (
            <button
              type="button"
              className="sh-acct-act"
              data-testid="project-account-github-signout"
              onClick={() => setAsking(ghOut)}
            >
              {ghOut.label}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
