// client/v2/shell/account-card.jsx — S1.22a: the account chip beside the faces and its card
// (canvas 11 · pn-accounts: "The account belongs to the project, on this Mac. It sits by the faces.
// Signing out signs out every project on that account.").
//
// PRESENTATIONAL. The words come from account-card-model.js, the handlers from the host
// (share-cluster-host.jsx): "Sign in as another account…" is the shell's own `account.switch` handler,
// and "Sign out of …" calls the EXISTING sign-out path (`POST /_api/cloud/signout`, the one Settings ›
// Connections uses — V2-3.8: it clears the calling project's profile credential, and every project on
// that profile is signed out with it). Nothing here signs anyone in or out by itself.
//
// The card is a popover under the chip (opaque, the largest shadow, no backdrop-filter — M1). Esc and a
// press outside close it; the sign-out row asks first, with the verb its button carries (CONTRACT §4).

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';

function Face({ initial, tone, size = 'md' }) {
  return (
    <span className={`sh-acct-face sh-acct-face--${size}`} data-tone={tone} aria-hidden="true">
      {initial}
    </span>
  );
}

/**
 * @param chip accountChip() — null renders nothing
 * @param card accountCard()
 * @param onSwitch () => void — the shell's `account.switch`
 * @param onSignOut () => Promise — the existing sign-out path
 */
export function AccountChip({ chip, card, onSwitch, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const titleId = useId();

  const close = useCallback((refocus) => {
    setOpen(false);
    setAsking(false);
    if (refocus) btn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  if (!chip || !card) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      await onSignOut?.();
    } finally {
      setBusy(false);
      close(false);
    }
  };

  return (
    <div className="sh-acct" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className={`sh-acct-chip${open ? ' is-on' : ''}`}
        data-testid="share-cluster-account"
        data-account={chip.id}
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
        aria-label={`Account: ${chip.title}`}
        title={chip.title}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Face initial={chip.initial} tone={chip.tone} />
        <span className="sh-acct-name">{chip.label}</span>
        <StIcon name="chevron-down" size={12} />
      </button>
      {open ? (
        <div
          className="sh-acct-card"
          role="dialog"
          aria-labelledby={titleId}
          data-testid="account-card"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="sh-acct-row" data-testid="account-card-current">
            <Face initial={card.current.initial} tone={card.current.tone} size="lg" />
            <span className="sh-acct-txt">
              <strong id={titleId}>{card.current.title}</strong>
              <span>{card.current.sub}</span>
            </span>
          </div>
          {card.others.length > 0 ? (
            <>
              <hr className="sh-acct-sep" />
              <p className="sh-acct-gt">Also on this Mac</p>
              {card.others.map((o) => (
                <div
                  key={o.id}
                  className="sh-acct-row sh-acct-row--sm"
                  data-testid={`account-card-other-${o.id}`}
                >
                  <Face initial={o.initial} tone={o.tone} />
                  <span className="sh-acct-txt">
                    <strong>{o.title}</strong>
                    <span>{o.sub}</span>
                  </span>
                </div>
              ))}
            </>
          ) : null}
          <hr className="sh-acct-sep" />
          <button
            type="button"
            className="sh-acct-act"
            data-testid="account-card-switch"
            onClick={() => {
              close(false);
              onSwitch?.();
            }}
          >
            {card.switchLabel}
          </button>
          {asking ? (
            <div className="sh-acct-ask" role="alertdialog" data-testid="account-card-confirm">
              <strong>{card.signOut.confirm.title}</strong>
              <span>{card.signOut.confirm.body}</span>
              <span className="sh-acct-btns">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="account-card-signout-cancel"
                  onClick={() => setAsking(false)}
                >
                  {card.signOut.confirm.cancel}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  data-testid="account-card-signout-confirm"
                  disabled={busy}
                  onClick={signOut}
                >
                  {card.signOut.confirm.primary}
                </button>
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="sh-acct-act sh-acct-act--two"
              data-testid="account-card-signout"
              onClick={() => setAsking(true)}
            >
              <span>{card.signOut.label}</span>
              <span className="sh-acct-sub">{card.signOut.sub}</span>
            </button>
          )}
          <p className="sh-acct-foot" data-testid="account-card-foot">
            {card.foot}
          </p>
        </div>
      ) : null}
    </div>
  );
}
