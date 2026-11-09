// client/home/HomeAccountsChip.jsx — 2.1.2 HB1 (canvas 17, artboards 15, 17, 18): accounts leave Home's
// main surface. One chip at the top right — "3 accounts", plus a dot and "1 needs sign-in" while a
// sign-in is missing or stopped working — opens "Accounts on this Mac": one line per account (its
// e-mail or host, where it is, how many projects, its state only when it isn't fine), the fix on the
// line that broke (Sign in / Sign in again, `useAccountFix`), Sign out… and GitHub in its "…", the old
// servers folded at the foot (no answer, no project) with Forget… per server and Forget all, each
// behind a question, and Add an account…. Forget only removes the saved sign-in (POST
// /_home/hub/signout), on the person's click — never on its own.
// Replaces the 2.0.5 face card (HomeAccounts.jsx) and the 2.1.1 accounts row (HomeAccountsRow.jsx).

import { useCallback, useEffect, useRef, useState } from 'react';

import { AcctFace, StateWord } from './HomeConnection.jsx';
import { cloudSignOut, hubSignOut, shellInvoke, shellListen } from './home-api.js';
import { forgetSpec, githubOf, slugOf } from './home-accounts-model.js';
import { HIcon } from './home-icons.jsx';
import { CONN_TONE } from './home-where-model.js';
import { WAITING_WORD } from './use-account-fix.js';
import { githubSignIn } from '../v2/onboarding/github-home.js';

const SIGNOUT_FAILED = 'Couldn’t sign out. Nothing changed — try again.';
const FORGET_FAILED = 'Couldn’t forget that server. Nothing changed — try again.';

/**
 * @param {{ summary: ReturnType<typeof import('./home-accounts-model.js').homeAccountsSummary>,
 *           shell: object|null, native: boolean, open: boolean, onOpen: () => void,
 *           onClose: () => void, fixer: { busy: string|null, error: string|null,
 *           fix: (card: object) => unknown }, onAddCloud: () => void, onAddTeam: () => void,
 *           onChanged?: () => unknown }} props
 */
export function HomeAccountsChip({
  summary,
  shell,
  native,
  open,
  onOpen,
  onClose,
  fixer,
  onAddCloud,
  onAddTeam,
  onChanged,
}) {
  const [menu, setMenu] = useState(null); // the card key whose "…" is open, or 'add'
  const [oldOpen, setOldOpen] = useState(false);
  const [asking, setAsking] = useState(null); // { id, title, body, primary, cancel, run }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ghCode, setGhCode] = useState(null);
  const wrap = useRef(null);

  const close = useCallback(() => {
    setMenu(null);
    setAsking(null);
    setError(null);
    onClose();
  }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    const onDown = (e) => wrap.current && !wrap.current.contains(e.target) && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);
  // the GitHub device code arrives as a shell message while a sign-in from this list runs
  useEffect(() => {
    if (!open || !native) return undefined;
    let off = () => {};
    shellListen('github://device-code', (p) => setGhCode(p?.user_code ?? null)).then((u) => {
      off = u;
    });
    return () => off();
  }, [open, native]);

  const { live, old } = summary;
  // GitHub lives in the "…" of each profile's first line
  const firstOf = new Set();
  const seen = new Set();
  for (const c of live)
    if (!seen.has(c.profile)) {
      seen.add(c.profile);
      firstOf.add(c.key);
    }

  const runAsk = async () => {
    const spec = asking;
    setBusy(true);
    setError(null);
    const failed = await spec.run();
    setBusy(false);
    setAsking(null);
    if (failed) setError(failed);
    await onChanged?.();
  };
  const askSignOut = (card) => {
    setMenu(null);
    const s = card.signOut;
    setAsking({
      id: 'signout',
      ...s.confirm,
      run: async () => {
        const r =
          s.path === 'cloud-signout'
            ? await cloudSignOut(s.profile)
            : await hubSignOut(s.profile, s.url);
        return r.ok && r.json?.ok ? null : r.json?.error || SIGNOUT_FAILED;
      },
    });
  };
  const askForget = (servers) => {
    const spec = forgetSpec(servers);
    setAsking({
      ...spec,
      run: async () => {
        let failed = null;
        for (const s of spec.servers) {
          const r = await hubSignOut(s.profile, s.url);
          if (!r.ok || !r.json?.ok) failed = r.json?.error || FORGET_FAILED;
        }
        return failed;
      },
    });
  };
  const ghSignIn = async (profile) => {
    setMenu(null);
    setError(null);
    setBusy(true);
    try {
      await githubSignIn(profile, shellInvoke);
      await onChanged?.();
    } catch (e) {
      setError(typeof e === 'string' ? e : 'GitHub sign-in didn’t finish. Try again.');
    } finally {
      setGhCode(null);
      setBusy(false);
    }
  };

  const forgettable = old.filter((c) => c.forget);
  const shownError = error || fixer.error;

  return (
    <span className="island home-top-acct" ref={wrap}>
      <button
        type="button"
        className="home-acchip"
        data-testid="home-accounts-chip"
        data-needs={summary.needs || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : onOpen())}
      >
        <HIcon name="people" size={14} />
        <span>{summary.word}</span>
        {summary.needsWord ? (
          <span className="home-acchip-needs" data-testid="home-accounts-chip-needs">
            <i aria-hidden="true" />
            {summary.needsWord}
          </span>
        ) : null}
        <HIcon name="chevron" size={12} />
      </button>
      {open ? (
        <div
          className="home-accts"
          role="dialog"
          aria-label="Accounts on this Mac"
          data-testid="home-accounts"
        >
          <p className="home-accts-h">Accounts on this Mac</p>
          <ul className="home-accts-list">
            {live.map((c) => {
              const id = slugOf(c);
              const bad = c.state === 'rejected' || c.state === 'missing';
              const gh = native && firstOf.has(c.key) ? githubOf(shell, c.profile) : null;
              const more = native && (c.signOut || gh);
              return (
                <li
                  key={c.key}
                  className={`home-acl${bad ? ' home-acl--bad' : ''}`}
                  data-kind={c.kind}
                  data-state={c.state}
                  data-testid={`home-account-card-${id}`}
                >
                  <AcctFace face={c.face} state={c.state} size="md" />
                  <span className="home-acl-t">
                    <strong>{c.title}</strong>
                    <span>{c.sub}</span>
                    {c.state !== 'ok' ? (
                      <StateWord tone={CONN_TONE[c.state]} testid={`home-account-state-${id}`}>
                        {c.word}
                      </StateWord>
                    ) : null}
                  </span>
                  {c.fix ? (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm home-acl-fix"
                      data-testid={`home-account-signin-${id}`}
                      disabled={!native || fixer.busy === c.key}
                      title={native ? undefined : 'Sign in from the Maude app on your Mac.'}
                      onClick={() => fixer.fix(c)}
                    >
                      {fixer.busy === c.key ? WAITING_WORD : c.fix.label}
                    </button>
                  ) : null}
                  {more ? (
                    <span className="home-acl-more">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`More for ${c.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menu === c.key}
                        data-testid={`home-account-more-${id}`}
                        onClick={() => setMenu((m) => (m === c.key ? null : c.key))}
                      >
                        <HIcon name="more" size={16} />
                      </button>
                      {menu === c.key ? (
                        <span className="island home-acl-menu" role="menu">
                          {gh?.login ? (
                            <span
                              className="home-acl-menu-note"
                              data-testid={`home-account-github-${c.profile}`}
                            >
                              GitHub · {gh.login}
                            </span>
                          ) : null}
                          {gh?.signIn ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="row-item"
                              data-testid={`home-account-github-signin-${c.profile}`}
                              disabled={busy}
                              onClick={() => ghSignIn(c.profile)}
                            >
                              Sign in with GitHub…
                            </button>
                          ) : null}
                          {c.signOut ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="row-item"
                              data-testid={`home-account-signout-${id}`}
                              disabled={busy}
                              onClick={() => askSignOut(c)}
                            >
                              {c.signOut.label}
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {old.length ? (
            <div className="home-accts-old">
              <button
                type="button"
                className="home-accts-oldh"
                data-testid="home-accounts-old"
                aria-expanded={oldOpen}
                onClick={() => setOldOpen((o) => !o)}
              >
                <HIcon name={oldOpen ? 'chevron' : 'submenu'} size={12} />
                <span>{summary.oldWord}</span>
                <span className="home-accts-oldw">Not answering, no projects</span>
              </button>
              {oldOpen ? (
                <ul className="home-accts-oldl">
                  {old.map((c) => {
                    const id = slugOf(c);
                    return (
                      <li key={c.key} data-testid={`home-accounts-old-row-${id}`}>
                        <HIcon name="server" size={12} />
                        <code>{c.forget?.host ?? c.title}</code>
                        {native && c.forget ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            data-testid={`home-accounts-old-forget-${id}`}
                            disabled={busy}
                            onClick={() => askForget([c.forget])}
                          >
                            Forget…
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                  {native && forgettable.length > 1 ? (
                    <li className="home-accts-oldall">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        data-testid="home-accounts-old-forget-all"
                        disabled={busy}
                        onClick={() => askForget(forgettable.map((c) => c.forget))}
                      >
                        Forget all {forgettable.length}…
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          {ghCode ? (
            <p className="home-accts-note" data-testid="home-accounts-github-code">
              Enter <strong>{ghCode}</strong> on the GitHub page that opened.
            </p>
          ) : null}
          {shownError ? (
            <p className="home-accts-note" role="alert" data-testid="home-accounts-error">
              {shownError}
            </p>
          ) : null}
          {asking ? (
            <div
              className="home-accts-ask"
              role="alertdialog"
              aria-label={asking.title}
              data-testid="home-accounts-confirm"
              data-ask={asking.id}
            >
              <strong>{asking.title}</strong>
              <span>{asking.body}</span>
              <span className="home-accts-btns">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid={`home-accounts-${asking.id}-cancel`}
                  onClick={() => setAsking(null)}
                >
                  {asking.cancel}
                </button>
                <button
                  type="button"
                  className={`btn btn--sm ${asking.id === 'signout' ? 'btn--danger' : 'btn--primary'}`}
                  data-testid={`home-accounts-${asking.id}-confirm`}
                  disabled={busy}
                  onClick={runAsk}
                >
                  {asking.primary}
                </button>
              </span>
            </div>
          ) : null}
          {native ? (
            <div className="home-accts-foot">
              <button
                type="button"
                className="home-accts-act"
                data-testid="home-accounts-add"
                aria-haspopup="menu"
                aria-expanded={menu === 'add'}
                onClick={() => setMenu((m) => (m === 'add' ? null : 'add'))}
              >
                <HIcon name="plus" size={12} /> Add an account…
              </button>
              {menu === 'add' ? (
                <span className="home-accts-addm" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="row-item"
                    data-testid="home-accounts-add-cloud"
                    onClick={() => {
                      close();
                      onAddCloud?.();
                    }}
                  >
                    Add a Maude Cloud account…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="row-item"
                    data-testid="home-accounts-add-team"
                    onClick={() => {
                      close();
                      onAddTeam?.();
                    }}
                  >
                    Connect to a team server…
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
