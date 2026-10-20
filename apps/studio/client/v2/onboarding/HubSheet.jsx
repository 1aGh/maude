// client/v2/onboarding/HubSheet.jsx — "Connect to your own hub" (02 ob-adv-sheets, S6.9). The sheet S11.14's
// Settings › Connections mounts as "Add a team server…" (G0-D/D12), so it is a view: it owns its fields and
// calls back; what Test connection and Connect DO is the caller's (Home: `/_home/hub/{test,prepare}`).
//
//   <HubSheet onTest={(url) => {ok, version?, error?}} onConnect={({url, email?, password?}) => {ok, error?}} onCancel />
//
// The password lives in this component's state only until Connect is pressed: it is read once, handed to
// `onConnect`, and the field is emptied at once — nothing the sheet draws, before or after, contains it, and
// an error line is the server's own words, never an echo. "Invite link or key" rests until the hub's invite
// redeem has a Home route (the hub's own `/join` door in a browser is what carries an invite today).

import { useEffect, useRef, useState } from 'react';

import { AdvModal, AdvSheet, Sw } from './AdvSheet.jsx';
import { HUB_WORDS as W } from './onboarding-model.js';

/**
 * @param {{ onTest: (url: string) => Promise<{ok: boolean, version?: string|null, error?: string}>,
 *           onConnect: (v: {url: string, email?: string, password?: string}) => Promise<{ok: boolean, error?: string}>,
 *           onCancel: () => void, initialUrl?: string }} props
 */
export function HubSheet({ onTest, onConnect, onCancel, initialUrl = '' }) {
  const [url, setUrl] = useState(initialUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const connect = async () => {
    // read once, empty the field now — the password never outlives this call in the page
    const creds = email.trim() || password ? { email: email.trim(), password } : null;
    setPassword('');
    setError(null);
    setBusy(true);
    let r;
    try {
      r = await onConnect(creds ? { url: url.trim(), ...creds } : { url: url.trim() });
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
        canSubmit={!!url.trim()}
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
            aria-pressed="true"
            data-testid="onb-hub-mode-password"
          >
            {W.modePassword}
          </button>
          <button
            type="button"
            className="ob-seg-b"
            aria-pressed="false"
            aria-disabled="true"
            data-testid="onb-hub-mode-invite"
          >
            {W.modeInvite}
          </button>
        </span>

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
