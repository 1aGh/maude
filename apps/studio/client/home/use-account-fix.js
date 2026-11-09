// client/home/use-account-fix.js — 2.1.2 HB1: one account's "Sign in again" / "Sign in", shared by the
// banner on top of Home (artboard 16) and the accounts list behind the chip (artboard 17), so both show
// the same "Waiting…" and the same plain-words error. Moved here from the 2.1.1 accounts row (B4):
//   cloud-signin  Home's own Maude Cloud sign-in for THAT profile (`onCloudSignIn`, home-app drops a
//                 dead credential first)
//   hub-signin    the team-server sign-in with the address filled in: start → open the browser → poll
//                 until the server vouched → `onChanged` (Home reloads)
// A person's click starts it; nothing here retries on its own.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  hubSignInCancel,
  hubSignInPoll,
  hubSignInStart,
  openTeamServerSignIn,
} from './home-api.js';

const POLL_MS = 1200;
export const SIGNIN_WORDS = Object.freeze({
  unreachable: 'Couldn’t reach that server. Check the address, or whether it’s online.',
  noBrowser: 'The browser didn’t open. Nothing changed — try again.',
  refused: 'That sign-in page can’t be opened from here. Nothing changed.',
});
/** The fix button while the browser has the sign-in (short: it sits on a narrow line). */
export const WAITING_WORD = 'Waiting…';

/**
 * @param {{ onCloudSignIn: (card: object) => unknown, onChanged?: () => unknown, pollMs?: number }} in
 * @returns {{ busy: string|null, error: string|null, clearError: () => void,
 *             fix: (card: object) => Promise<void> }}
 */
export function useAccountFix({ onCloudSignIn, onChanged, pollMs = POLL_MS }) {
  const [busy, setBusy] = useState(null); // the card key whose sign-in waits on the browser
  const [error, setError] = useState(null);
  const attempt = useRef(null); // { id, stop }

  // leaving Home ends the attempt that waits
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

  const waitForBrowser = useCallback(
    (id) =>
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
      }),
    [pollMs]
  );

  const fixServer = useCallback(
    async (card) => {
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
    },
    [onChanged, waitForBrowser]
  );

  const fix = useCallback(
    async (card) => {
      if (!card?.fix || busy) return;
      if (card.fix.path === 'cloud-signin') {
        setError(null);
        await onCloudSignIn(card);
        return;
      }
      await fixServer(card);
    },
    [busy, onCloudSignIn, fixServer]
  );

  return { busy, error, clearError: () => setError(null), fix };
}
