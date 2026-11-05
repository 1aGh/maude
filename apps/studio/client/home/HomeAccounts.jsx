// client/home/HomeAccounts.jsx — 2.0.5 W4b: Home's avatar and the card it opens.
//
// Every profile on this Mac by its label, with the accounts it is signed in with (Maude Cloud,
// team servers, GitHub): Sign out per account where Home has a path (asks first), Sign in with
// GitHub for a profile without it, and add / switch at the foot. What each row means and why a
// row has no button: home-accounts-model.js. The card fetches the team-server sign-ins when it
// opens (`GET /_home/accounts`) and after every sign-out.

import { useCallback, useEffect, useRef, useState } from 'react';

import { cloudSignOut, getAccounts, hubSignOut, shellInvoke, shellListen } from './home-api.js';
import { homeAccounts } from './home-accounts-model.js';
import { githubSignIn } from '../v2/onboarding/github-home.js';

const KIND_TITLE = { cloud: 'Maude Cloud', team: 'Team server', github: 'GitHub' };

/** The team-server sign-ins of `ids`, re-read when `open` turns on or `gen` moves. */
function useHubProfiles(ids, open, gen) {
  const [hubProfiles, setHubProfiles] = useState([]);
  const key = ids.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`; `gen` re-reads
  useEffect(() => {
    if (!open || !key) return undefined;
    let live = true;
    getAccounts(key.split(',')).then((r) => {
      if (live && r.ok && Array.isArray(r.json?.profiles)) setHubProfiles(r.json.profiles);
    });
    return () => {
      live = false;
    };
  }, [open, key, gen]);
  return hubProfiles;
}

/**
 * @param shell / clouds / native — Home's data
 * @param onAddCloud () => void     Home's Maude Cloud sign-in (a fresh profile when one is signed in)
 * @param onAddTeam () => void      the Advanced › team server sheet
 * @param onChanged () => Promise   reload Home's data after a sign-out / sign-in
 */
export function HomeAccounts({ shell, clouds, native, onAddCloud, onAddTeam, onChanged }) {
  const [open, setOpen] = useState(false);
  const [gen, setGen] = useState(0);
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ghCode, setGhCode] = useState(null);
  const wrap = useRef(null);
  const ids = (shell?.profiles ?? []).map((p) => p?.id).filter((id) => typeof id === 'string');
  const hubProfiles = useHubProfiles(ids, open, gen);
  const model = homeAccounts({ native, shell, clouds, hubProfiles });

  const close = useCallback(() => {
    setOpen(false);
    setAsking(null);
    setError(null);
  }, []);
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
  // the GitHub device code arrives as a shell message while a sign-in from this card runs
  useEffect(() => {
    if (!open || !native) return undefined;
    let off = () => {};
    shellListen('github://device-code', (p) => setGhCode(p?.user_code ?? null)).then((u) => {
      off = u;
    });
    return () => off();
  }, [open, native]);

  if (!model.face) return null;

  const signOut = async () => {
    const spec = asking;
    setBusy(true);
    setError(null);
    const r =
      spec.path === 'cloud-signout'
        ? await cloudSignOut(spec.profile)
        : await hubSignOut(spec.profile, spec.url);
    setBusy(false);
    setAsking(null);
    if (!r.ok || !r.json?.ok) {
      setError(r.json?.error || 'Couldn’t sign out. Nothing changed — try again.');
      return;
    }
    setGen((g) => g + 1);
    await onChanged?.();
  };
  const ghSignIn = async (profile) => {
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

  return (
    <span className="home-top-acct" ref={wrap}>
      <button
        type="button"
        className="home-top-acct-btn"
        data-testid="home-top-face"
        aria-label={model.face.title}
        title={model.face.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span
          className={`home-face home-face--md home-face--${model.face.tone}`}
          aria-hidden="true"
        >
          {model.face.initial}
        </span>
      </button>
      {open ? (
        <div
          className="home-accts"
          role="dialog"
          aria-label="Accounts on this Mac"
          data-testid="home-accounts"
        >
          <p className="home-accts-h">Accounts on this Mac</p>
          {model.profiles.map((p) => (
            <section
              key={p.id}
              className="home-accts-p"
              data-testid={`home-accounts-profile-${p.id}`}
            >
              <h3 className="home-accts-ph">
                <span className={`home-acctf home-acctf--${p.face.tone}`} aria-hidden="true">
                  {p.face.initial}
                </span>
                {p.label}
              </h3>
              {p.accounts.length ? (
                <ul className="home-accts-list">
                  {p.accounts.map((a) => (
                    <li
                      key={a.key}
                      className="home-accts-row"
                      data-testid={`home-account-${p.id}-${a.kind}`}
                    >
                      <span className="home-accts-t">
                        <strong>
                          {a.kind === 'team'
                            ? `${KIND_TITLE.team} · ${a.host}`
                            : KIND_TITLE[a.kind]}
                        </strong>
                        {a.who ? <span>{a.who}</span> : null}
                      </span>
                      {a.signOut ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          data-testid={`home-account-signout-${p.id}-${a.kind}`}
                          onClick={() => setAsking(a.signOut)}
                          disabled={busy}
                        >
                          Sign out…
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="home-accts-none">Not signed in to anything yet.</p>
              )}
              {p.githubSignIn ? (
                <button
                  type="button"
                  className="home-accts-act"
                  data-testid={`home-account-github-signin-${p.id}`}
                  onClick={() => ghSignIn(p.id)}
                  disabled={busy}
                >
                  Sign in with GitHub…
                </button>
              ) : null}
            </section>
          ))}
          {ghCode ? (
            <p className="home-accts-note" data-testid="home-accounts-github-code">
              Enter <strong>{ghCode}</strong> on the GitHub page that opened.
            </p>
          ) : null}
          {error ? (
            <p className="home-accts-note" role="alert" data-testid="home-accounts-error">
              {error}
            </p>
          ) : null}
          {asking ? (
            <div className="home-accts-ask" role="alertdialog" data-testid="home-accounts-confirm">
              <strong>{asking.confirm.title}</strong>
              <span>{asking.confirm.body}</span>
              <span className="home-accts-btns">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="home-accounts-signout-cancel"
                  onClick={() => setAsking(null)}
                >
                  {asking.confirm.cancel}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  data-testid="home-accounts-signout-confirm"
                  disabled={busy}
                  onClick={signOut}
                >
                  {asking.confirm.primary}
                </button>
              </span>
            </div>
          ) : null}
          {model.add ? (
            <div className="home-accts-foot">
              <button
                type="button"
                className="home-accts-act"
                data-testid="home-accounts-add-cloud"
                onClick={() => {
                  close();
                  onAddCloud?.();
                }}
              >
                {model.add.cloud}
              </button>
              <button
                type="button"
                className="home-accts-act"
                data-testid="home-accounts-add-team"
                onClick={() => {
                  close();
                  onAddTeam?.();
                }}
              >
                {model.add.team}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
