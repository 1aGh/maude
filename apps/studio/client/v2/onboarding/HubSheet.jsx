// client/v2/onboarding/HubSheet.jsx — "Connect to your own hub" (02 ob-adv-sheets, S6.9). The sheet S11.14's
// Settings › Connections mounts as "Add a team server…" (G0-D/D12), so it is a view: it owns its fields and
// calls back; what Test connection and Connect DO is the caller's (Home: `/_home/hub/{test,prepare}`).
//
//   <HubSheet onTest={(url) => {ok, version?, error?}} onConnect={({url, email?, password?}) => {ok, error?}}
//             onJoin={({url, token, email, password}) => {ok, error?}} onCancel />
//   (no `onJoin` → the invite segment rests, as before S6.11b)
//
// The password lives in this component's state only until Connect is pressed: it is read once, handed to
// `onConnect`, and the field is emptied at once — nothing the sheet draws, before or after, contains it, and
// an error line is the server's own words, never an echo. S6.11b: "Invite link or key" redeems a hub invite
// (`onJoin` — Home: `/_home/hub/join`, the hub's own JSON `POST /join`); the invite key is a bearer secret
// and is treated exactly like the password — a masked field, read once on Connect and emptied at once.

import { useEffect, useRef, useState } from 'react';

import { AdvModal, AdvSheet, Sw } from './AdvSheet.jsx';
import { HUB_WORDS as W } from './onboarding-model.js';

/** `https://hub.example/join/inv_…` → `https://hub.example` (the hub's own invite link); else null. */
export function hubOfInviteLink(raw) {
  try {
    const u = new URL(String(raw ?? '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const m = /^(.*)\/join\/[^/]+$/.exec(u.pathname);
    return m ? `${u.origin}${m[1]}` : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ onTest: (url: string) => Promise<{ok: boolean, version?: string|null, error?: string}>,
 *           onConnect: (v: {url: string, email?: string, password?: string}) => Promise<{ok: boolean, error?: string}>,
 *           onJoin?: (v: {url: string, token: string, email: string, password: string}) => Promise<{ok: boolean, error?: string}>,
 *           onCancel: () => void, initialUrl?: string }} props
 */
export function HubSheet({ onTest, onConnect, onJoin, onCancel, initialUrl = '' }) {
  const [url, setUrl] = useState(initialUrl);
  const [mode, setMode] = useState('password'); // 'password' | 'invite'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [test, setTest] = useState({ phase: 'idle', version: null, error: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const seq = useRef(0); // an answer for an address that has since changed is dropped
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const runTest = async () => {
    const id = ++seq.current;
    setTest({ phase: 'busy', version: null, error: null });
    let r;
    try {
      r = await onTest(url.trim());
    } catch {
      r = { ok: false, error: W.unreachable };
    }
    if (!alive.current || id !== seq.current) return;
    setTest(
      r?.ok
        ? { phase: 'ok', version: r.version ?? null, error: null }
        : { phase: 'bad', version: null, error: r?.error || W.unreachable }
    );
  };

  const inviteMode = mode === 'invite' && !!onJoin;
  const connect = async () => {
    // read once, empty the fields now — the password (and an invite key) never outlives this call in the page
    const creds = email.trim() || password ? { email: email.trim(), password } : null;
    const key = invite.trim();
    setPassword('');
    setInvite('');
    setError(null);
    setBusy(true);
    let r;
    try {
      if (inviteMode)
        r = await onJoin({ url: url.trim(), token: key, email: email.trim(), password });
      else r = await onConnect(creds ? { url: url.trim(), ...creds } : { url: url.trim() });
    } catch {
      r = { ok: false, error: W.unreachable };
    }
    if (!alive.current) return;
    setBusy(false);
    if (!r?.ok) setError(r?.error || W.unreachable);
  };

  return (
    <AdvModal onCancel={onCancel}>
      <AdvSheet
        id="hub"
        title={W.title}
        verb={W.verb}
        busyVerb={W.busy}
        busy={busy}
        canSubmit={
          inviteMode ? !!(url.trim() && invite.trim() && email.trim() && password) : !!url.trim()
        }
        onSubmit={connect}
        onCancel={onCancel}
      >
        <span className="ob-field">
          <label className="ob-field-label" htmlFor="onb-hub-url">
            {W.addressLabel}
          </label>
          <span className="ob-row2">
            <input
              id="onb-hub-url"
              className="ob-input ob-mono"
              data-testid="onb-hub-url"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              // biome-ignore lint/a11y/noAutofocus: the sheet opens for this one field
              autoFocus
              value={url}
              onChange={(e) => {
                seq.current += 1;
                setUrl(e.target.value);
                setTest({ phase: 'idle', version: null, error: null });
              }}
            />
            <button
              type="button"
              className="btn btn--sm"
              data-testid="onb-hub-test"
              disabled={!url.trim() || test.phase === 'busy'}
              onClick={runTest}
            >
              {W.test}
            </button>
          </span>
          {test.phase === 'busy' ? (
            <span className="ob-ok" role="status">
              <Sw state="busy" testid="onb-hub-testing">
                {W.testing}
              </Sw>
            </span>
          ) : null}
          {test.phase === 'ok' ? (
            <span className="ob-ok" role="status">
              <Sw state="ok" testid="onb-hub-reachable">
                {W.reachable(test.version)}
              </Sw>
            </span>
          ) : null}
          {test.phase === 'bad' ? (
            <span className="ob-err" role="alert" data-testid="onb-hub-test-error">
              {test.error}
            </span>
          ) : null}
        </span>

        <span className="ob-seg" role="group" aria-label="How you sign in">
          <button
            type="button"
            className="ob-seg-b"
            aria-pressed={inviteMode ? 'false' : 'true'}
            data-testid="onb-hub-mode-password"
            onClick={() => setMode('password')}
          >
            {W.modePassword}
          </button>
          <button
            type="button"
            className="ob-seg-b"
            aria-pressed={inviteMode ? 'true' : 'false'}
            aria-disabled={onJoin ? undefined : 'true'}
            data-testid="onb-hub-mode-invite"
            onClick={() => {
              if (onJoin) setMode('invite');
            }}
          >
            {W.modeInvite}
          </button>
        </span>

        {inviteMode ? (
          <input
            className="ob-input"
            data-testid="onb-hub-invite"
            // a bearer secret, like the password: masked, never drawn back
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={W.modeInvite}
            placeholder={W.modeInvite}
            value={invite}
            onChange={(e) => {
              const v = e.target.value;
              setInvite(v);
              // a pasted hub link names its hub: fill an empty address (the address is not secret)
              const at = url.trim() ? null : hubOfInviteLink(v);
              if (at) {
                seq.current += 1;
                setUrl(at);
                setTest({ phase: 'idle', version: null, error: null });
              }
            }}
          />
        ) : null}

        <span className="ob-row2">
          <input
            className="ob-input"
            data-testid="onb-hub-email"
            type="email"
            autoComplete="off"
            aria-label="Email"
            placeholder="you@alligators.cz"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="ob-input"
            data-testid="onb-hub-password"
            type="password"
            autoComplete="off"
            aria-label="Password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </span>
        {error ? (
          <p className="ai-conn-err" role="alert" data-testid="onb-hub-error">
            {error}
          </p>
        ) : null}
        <p className="ob-fine">{W.fine}</p>
      </AdvSheet>
    </AdvModal>
  );
}
