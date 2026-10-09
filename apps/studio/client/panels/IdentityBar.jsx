// Phase 28 (epic E3) Task 6 — the GitHub identity rail (sidebar FOOTER).
//
// Compact: just an avatar (signed in) or a small "Sign in with GitHub" button
// (signed out), docked at the bottom of the sidebar. Clicking the avatar opens an
// account menu UPWARD (New project / Pull a copy / Share / Sign out). Sign-in runs
// GitHub's device flow (code modal). All chrome is the shell maude DS — solid
// surfaces, the .st-dialog scrim+card treatment, no canvas-side `.panel`. In a
// plain browser (no Tauri shell) the rail renders nothing.

import { useEffect, useRef, useState } from 'react';

import CreateProject from './CreateProject.jsx';
import {
  fetchIdentity,
  isNativeApp,
  isSignedIn,
  onDeviceCode,
  onMenuNewProject,
  onSignedIn,
  openVerification,
  signIn,
  signOut,
} from '../github.js';

function Icon({ name, size = 16 }) {
  const p = {
    'chevron-up': <polyline points="3.5 10 8 5.5 12.5 10" />,
    external: (
      <>
        <path d="M6 3.5H3.2A.7.7 0 0 0 2.5 4.2v8.6a.7.7 0 0 0 .7.7h8.6a.7.7 0 0 0 .7-.7V10" />
        <line x1="8" y1="8" x2="13" y2="3" />
        <polyline points="9.5 3 13 3 13 6.5" />
      </>
    ),
    copy: (
      <>
        <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" />
        <path d="M3 10.5V3.2A.7.7 0 0 1 3.7 2.5H10" />
      </>
    ),
    plus: (
      <>
        <line x1="8" y1="3" x2="8" y2="13" />
        <line x1="3" y1="8" x2="13" y2="8" />
      </>
    ),
    download: (
      <>
        <line x1="8" y1="2.5" x2="8" y2="10" />
        <polyline points="4.5 7 8 10.5 11.5 7" />
        <polyline points="3 12.8 3 13.6 13 13.6 13 12.8" />
      </>
    ),
    invite: (
      <>
        <circle cx="6" cy="5.5" r="2.5" />
        <path d="M2 13.5a4 4 0 0 1 8 0" />
        <line x1="13" y1="5" x2="13" y2="9" />
        <line x1="11" y1="7" x2="15" y2="7" />
      </>
    ),
    signout: (
      <>
        <path d="M6.5 13.5H3.2a.7.7 0 0 1-.7-.7V3.2a.7.7 0 0 1 .7-.7h3.3" />
        <line x1="13" y1="8" x2="6.5" y2="8" />
        <polyline points="10 5 13 8 10 11" />
      </>
    ),
  }[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {p}
    </svg>
  );
}

function GitHubMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function initialsOf(identity) {
  const src = (identity?.name || identity?.login || '?').trim();
  const parts = src.split(/[\s_-]+/).filter(Boolean);
  const ini = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return ini.toUpperCase();
}

function Avatar({ identity, size = 26 }) {
  return (
    <span className="gi-avatar" style={{ width: size, height: size }}>
      {initialsOf(identity)}
    </span>
  );
}

export default function IdentityBar() {
  const native = isNativeApp();
  const [state, setState] = useState('loading'); // loading | out | in
  const [identity, setIdentity] = useState(null);
  const [device, setDevice] = useState(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState(null); // null | 'new' | 'get' | 'share'
  const [copied, setCopied] = useState(false);
  const unlistenRef = useRef(null);
  const railRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state; // keep current for the (subscribe-once) menu listener

  useEffect(() => {
    let alive = true;
    if (!native) return;
    (async () => {
      try {
        const signed = await isSignedIn();
        if (!alive) return;
        if (signed) {
          let r = await fetchIdentity();
          // A valid keychain token can still hit a transient identity-fetch failure at
          // mount (bridge not ready / GitHub 5xx / rate-limit) — retry before falling back
          // to the signed-out CTA so we don't flash "Sign in" at a signed-in user.
          for (let i = 0; i < 2 && alive && !(r.ok && r.json?.ok); i += 1) {
            await new Promise((res) => setTimeout(res, 800));
            r = await fetchIdentity();
          }
          if (!alive) return;
          if (r.ok && r.json?.ok) {
            setIdentity({ login: r.json.login, name: r.json.name, avatar_url: r.json.avatar_url });
            setState('in');
          } else setState('out');
        } else setState('out');
      } catch {
        if (alive) setState('out');
      }
    })();
    return () => {
      alive = false;
      unlistenRef.current?.then?.((fn) => fn?.());
    };
  }, [native]);

  // Live-update when sign-in completes in ANOTHER surface (the wizard's Door A emits
  // `github://signed-in`). Without this the rail can sit on "Sign in" with a valid token
  // until a full reload. Flip to signed-in off the event's login, then enrich the profile.
  useEffect(() => {
    if (!native) return undefined;
    const p = onSignedIn(async (login) => {
      setIdentity((cur) => cur || { login, name: null, avatar_url: null });
      setState('in');
      const r = await fetchIdentity();
      if (r.ok && r.json?.ok)
        setIdentity({ login: r.json.login, name: r.json.name, avatar_url: r.json.avatar_url });
    });
    return () => {
      p?.then?.((fn) => fn?.());
    };
  }, [native]);

  // Native File ▸ New Project… (menu.rs emits `menu://new-project`). Open the create
  // dialog once the GitHub check settled — even when signed out, since it offers a
  // local-only project (no GitHub needed); the dialog gates the GitHub option itself.
  useEffect(() => {
    if (!native) return undefined;
    const p = onMenuNewProject(() => {
      if (stateRef.current !== 'loading') setView('new');
    });
    return () => {
      p?.then?.((fn) => fn?.());
    };
  }, [native]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (railRef.current && !railRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  async function handleSignIn() {
    setError('');
    setSigning(true);
    setDevice(null);
    try {
      unlistenRef.current = onDeviceCode((payload) => setDevice(payload));
      const login = await signIn();
      const r = await fetchIdentity();
      setIdentity(
        r.ok && r.json?.ok
          ? { login: r.json.login, name: r.json.name, avatar_url: r.json.avatar_url }
          : { login, name: null, avatar_url: null }
      );
      setState('in');
    } catch (e) {
      setError(String(e?.message || e || 'Sign-in didn’t finish. Please try again.'));
    } finally {
      setSigning(false);
      setDevice(null);
      unlistenRef.current?.then?.((fn) => fn?.());
      unlistenRef.current = null;
    }
  }

  async function handleSignOut() {
    setMenuOpen(false);
    try {
      await signOut();
    } catch {
      /* idempotent */
    }
    setIdentity(null);
    setState('out');
  }

  function copyCode() {
    if (!device?.user_code) return;
    navigator.clipboard?.writeText(device.user_code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  }

  if (!native) return null;

  return (
    <div className="gi-rail" ref={railRef}>
      {state === 'loading' && <span className="gi-rail-hint">Checking GitHub…</span>}

      {state === 'out' && (
        <>
          <button
            type="button"
            className="btn btn--primary btn--sm gi-rail-signin"
            onClick={handleSignIn}
            disabled={signing}
          >
            <GitHubMark size={15} /> {signing ? 'Starting…' : 'Sign in with GitHub'}
          </button>
          {error && (
            <span className="gi-rail-err" title={error}>
              {error}
            </span>
          )}
        </>
      )}

      {state === 'in' && (
        <>
          <button
            type="button"
            className={'gi-rail-account' + (menuOpen ? ' is-open' : '')}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
            title={`Signed in as @${identity?.login}`}
          >
            <Avatar identity={identity} />
            <span className="gi-rail-login">@{identity?.login}</span>
            <span className="gi-rail-caret">
              <Icon name="chevron-up" size={13} />
            </span>
          </button>
          {menuOpen && (
            <div className="gi-menu" role="menu" aria-label="GitHub account">
              <div className="gi-menu-hd">
                <Avatar identity={identity} size={32} />
                <span className="gi-menu-id">
                  <span className="gi-menu-name">{identity?.name || identity?.login}</span>
                  <span className="gi-menu-login">@{identity?.login} · connected</span>
                </span>
              </div>
              <button
                type="button"
                className="gi-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setView('new');
                }}
              >
                <Icon name="plus" size={15} /> New project
              </button>
              <button
                type="button"
                className="gi-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setView('get');
                }}
              >
                <Icon name="download" size={15} /> Pull a local copy
              </button>
              <button
                type="button"
                className="gi-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setView('share');
                }}
              >
                <Icon name="invite" size={15} /> Share this project
              </button>
              <div className="gi-menu-sep" />
              <button
                type="button"
                className="gi-menu-item gi-menu-item--danger"
                role="menuitem"
                onClick={handleSignOut}
              >
                <Icon name="signout" size={15} /> Sign out
              </button>
            </div>
          )}
        </>
      )}

      {device && (
        <div
          className="gi-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Sign in with GitHub"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDevice(null);
          }}
        >
          <div className="gi-scrim" aria-hidden="true" onClick={() => setDevice(null)} />
          <div className="gi-dialog gi-dialog--code">
            <div className="gi-dc-head">
              <span className="gi-dc-marks">
                <GitHubMark size={26} />
              </span>
              <h2>Sign in with GitHub</h2>
              <p>Maude opened GitHub in your browser. Enter this code to connect your account.</p>
            </div>
            <ol className="gi-dc-steps">
              <li>
                <span className="gi-dc-step-n">1</span>
                <span className="gi-dc-step-tx">
                  Go to{' '}
                  <span className="gi-dc-url">
                    {(device.verification_uri || 'github.com/login/device').replace(
                      /^https?:\/\//,
                      ''
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm gi-dc-open"
                    onClick={() => openVerification().catch(() => {})}
                  >
                    <Icon name="external" size={14} /> Open it again
                  </button>
                </span>
              </li>
              <li>
                <span className="gi-dc-step-n">2</span>
                <span className="gi-dc-step-tx">Enter this code to connect Maude</span>
              </li>
            </ol>
            <div className="gi-code">
              <span className="gi-code-val">{device.user_code}</span>
              <button
                type="button"
                className="btn btn--ghost gi-code-copy"
                onClick={copyCode}
                aria-label="Copy the code"
              >
                <Icon name="copy" size={15} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="gi-dc-status" aria-live="polite">
              <span className="gi-pulse" aria-hidden="true" />
              <span>Waiting for you to authorize in your browser…</span>
            </div>
            <div className="gi-dc-foot">
              <button type="button" className="btn btn--ghost" onClick={() => setDevice(null)}>
                Cancel
              </button>
              <span className="gi-dc-foot-note">Nothing is stored until you authorize.</span>
            </div>
          </div>
        </div>
      )}

      {view && (
        <CreateProject
          view={view}
          identity={identity}
          signedIn={state === 'in'}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}
