// client/v2/onboarding/HubSheet.jsx — "Connect to your own hub" (02 ob-adv-sheets, S6.9). The sheet S11.14's
// Settings › Connections mounts as "Add a team server…" (G0-D/D12), so it is a view: it owns its fields and
// calls back; what Test connection and Sign in DO is the caller's (Home: `/_home/hub/{test,signin/*,prepare}`).
//
//   <HubSheet onTest={(url) => {ok, version?, error?}}
//             onSignIn={({url, invite, onWaiting}) => {ok, error?, cancelled?}}
//             onAbortSignIn={() => void} onCancel />
//
// Issue #204 (decision maude/v2-michal-team-server-signin-via-hub-page): the app owns NO login method for a
// team server. There is no email or password field here: Sign in opens the hub's OWN sign-in page in the
// browser (with an invite, the hub's own invite page), the sheet waits (`onWaiting` → "Finish signing in in
// your browser.", Cancel = `onAbortSignIn`) and the caller opens the project once the browser came back.
// The invite key is a bearer secret: a masked field, read once on Sign in and emptied at once; an error
// line is the server's own words, never an echo.

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
 *           onSignIn: (v: {url: string, invite: string, onWaiting: () => void}) =>
 *             Promise<{ok: boolean, error?: string, cancelled?: boolean}>,
 *           onAbortSignIn?: () => void,
 *           onCancel: () => void, initialUrl?: string }} props
 */
export function HubSheet({ onTest, onSignIn, onAbortSignIn, onCancel, initialUrl = '' }) {
  const [url, setUrl] = useState(initialUrl);
  const [invite, setInvite] = useState('');
  const [test, setTest] = useState({ phase: 'idle', version: null, error: null });
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
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

  const signIn = async () => {
    // read once, empty the field now — an invite key never outlives this call in the page
    const key = invite.trim();
    setInvite('');
    setError(null);
    setBusy(true);
    let r;
    try {
      r = await onSignIn({
        url: url.trim(),
        invite: key,
        onWaiting: () => {
          if (alive.current) setWaiting(true);
        },
      });
    } catch {
      r = { ok: false, error: W.unreachable };
    }
    if (!alive.current) return;
    setBusy(false);
    setWaiting(false);
    if (!r?.ok && !r?.cancelled) setError(r?.error || W.unreachable);
  };

  const abort = () => {
    setWaiting(false);
    onAbortSignIn?.();
  };

  return (
    <AdvModal onCancel={waiting ? abort : onCancel}>
      <AdvSheet
        id="hub"
        title={W.title}
        verb={W.verb}
        busyVerb={W.busy}
        busy={busy}
        canSubmit={!!url.trim() && !busy}
        onSubmit={signIn}
        onCancel={waiting ? abort : onCancel}
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
              disabled={busy}
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
              disabled={!url.trim() || test.phase === 'busy' || busy}
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

        <span className="ob-field">
          <label className="ob-field-label" htmlFor="onb-hub-invite">
            {W.inviteLabel}
          </label>
          <input
            id="onb-hub-invite"
            className="ob-input"
            data-testid="onb-hub-invite"
            // a bearer secret: masked, never drawn back
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={W.invitePlaceholder}
            disabled={busy}
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
        </span>

        {waiting ? (
          <p className="ob-ok" role="status" data-testid="onb-hub-waiting">
            <Sw state="busy">{W.waiting}</Sw>
          </p>
        ) : null}
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
