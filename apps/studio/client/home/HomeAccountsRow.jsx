// client/home/HomeAccountsRow.jsx — 2.1.1 B4 (artboard 14): "Accounts on this Mac", the row on top of
// Home. One card per account (a Maude Cloud account by its e-mail, your server by its host) with where
// the person is signed in and whether that sign-in works; a sign-in that stopped working (or is
// missing) is fixed from its own card — Maude Cloud through Home's own sign-in, your server through the
// team-server sign-in with the address already filled in. Cards come from `homeAccountCards`
// (home-accounts-model.js); a server that does not answer has no button (nothing for the person to fix).

import { useEffect, useRef, useState } from 'react';

import { AcctFace, StateWord } from './HomeConnection.jsx';
import {
  hubSignInCancel,
  hubSignInPoll,
  hubSignInStart,
  openTeamServerSignIn,
} from './home-api.js';
import { slugOf } from './home-accounts-model.js';
import { CONN_TONE } from './home-where-model.js';

const POLL_MS = 1200;
const SIGNIN_WORDS = {
  unreachable: 'Couldn’t reach that server. Check the address, or whether it’s online.',
  noBrowser: 'The browser didn’t open. Nothing changed — try again.',
  refused: 'That sign-in page can’t be opened from here. Nothing changed.',
};

/**
 * @param {{ cards: object[], native: boolean, onCloudSignIn: (card: object) => unknown,
 *           onAddCloud: () => void, onAddTeam: () => void, onChanged?: () => unknown,
 *           pollMs?: number }} props
 */
export function HomeAccountsRow({
  cards,
  native,
  onCloudSignIn,
  onAddCloud,
  onAddTeam,
  onChanged,
  pollMs = POLL_MS,
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null); // the card key whose sign-in waits on the browser
  const [error, setError] = useState(null);
  const attempt = useRef(null); // { id, stop }
  const wrap = useRef(null);

  // leaving Home (or a new attempt) ends the one that waits
  useEffect(
    () => () => {
      const a = attempt.current;
      attempt.current = null;
      if (a) {
        a.stop();
        void hubSignInCancel(a.id);
      }
    },
    []
  );
  useEffect(() => {
    if (!adding) return undefined;
    const onKey = (e) => e.key === 'Escape' && setAdding(false);
    const onDown = (e) => wrap.current && !wrap.current.contains(e.target) && setAdding(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [adding]);

  if (!cards.length && !native) return null;

  const waitForBrowser = (id) =>
    new Promise((resolve) => {
      let timer = null;
      const stop = () => {
        clearTimeout(timer);
        resolve({ ok: false, cancelled: true });
      };
      attempt.current = { id, stop };
      const tick = async () => {
        const p = await hubSignInPoll(id);
        if (attempt.current?.id !== id) return;
        if (p.json?.pending) {
          timer = setTimeout(tick, pollMs);
          return;
        }
        attempt.current = null;
        resolve(
          p.ok && p.json?.ok
            ? { ok: true }
            : { ok: false, error: p.json?.error || SIGNIN_WORDS.unreachable }
        );
      };
      timer = setTimeout(tick, 0);
    });

  const fixServer = async (card) => {
    setError(null);
    setBusy(card.key);
    const s = await hubSignInStart(card.fix.profile, card.fix.url);
    if (!s.ok || !s.json?.ok) {
      setBusy(null);
      setError(s.json?.error || SIGNIN_WORDS.unreachable);
      return;
    }
    const id = s.json.id;
    const opened = await openTeamServerSignIn(s.json.signInUrl);
    if (opened !== 'ok') {
      void hubSignInCancel(id);
      setBusy(null);
      setError(opened === 'refused' ? SIGNIN_WORDS.refused : SIGNIN_WORDS.noBrowser);
      return;
    }
    const done = await waitForBrowser(id);
    setBusy(null);
    if (done.cancelled) return;
    if (!done.ok) {
      setError(done.error);
      return;
    }
    await onChanged?.();
  };

  const fix = (card) => (card.fix.path === 'cloud-signin' ? onCloudSignIn(card) : fixServer(card));

  return (
    <section
      className="home-sec home-acr"
      aria-labelledby="home-h-accounts"
      data-testid="home-accounts-row"
    >
      <h2 className="home-h" id="home-h-accounts">
        Accounts on this Mac
        {native ? (
          <span className="home-h-right home-acr-add" ref={wrap}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="home-accounts-row-add"
              aria-haspopup="menu"
              aria-expanded={adding}
              onClick={() => setAdding((o) => !o)}
            >
              Add an account…
            </button>
            {adding ? (
              <span className="island home-acr-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="row-item"
                  data-testid="home-accounts-row-add-cloud"
                  onClick={() => {
                    setAdding(false);
                    onAddCloud?.();
                  }}
                >
                  Add a Maude Cloud account…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="row-item"
                  data-testid="home-accounts-row-add-team"
                  onClick={() => {
                    setAdding(false);
                    onAddTeam?.();
                  }}
                >
                  Connect to a team server…
                </button>
              </span>
            ) : null}
          </span>
        ) : null}
      </h2>
      <div className="home-acr-cards">
        {cards.map((c) => {
          const id = slugOf(c);
          const bad = c.state === 'rejected' || c.state === 'missing';
          return (
            <span
              key={c.key}
              className={`home-acc${bad ? ' home-acc--bad' : ''}`}
              data-kind={c.kind}
              data-state={c.state}
              data-testid={`home-account-card-${id}`}
            >
              <AcctFace face={c.face} state={c.state} size="lg" />
              <span className="home-acc-t">
                <strong>{c.title}</strong>
                <span>{c.sub}</span>
                <StateWord tone={CONN_TONE[c.state]} testid={`home-account-state-${id}`}>
                  {c.word}
                </StateWord>
              </span>
              {c.fix ? (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  data-testid={`home-account-signin-${id}`}
                  disabled={!native || busy === c.key}
                  onClick={() => fix(c)}
                >
                  {busy === c.key ? 'Waiting for the browser…' : c.fix.label}
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      {error ? (
        <p className="home-acct-note" role="alert" data-testid="home-accounts-row-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
