// client/v2/signin/use-signin.js — Home signs in to Maude Cloud (S6.8; contract S6-S9 §5.1, Q1/Q3).
//
// The order of one attempt (every step is a call that already exists — S6.5 routes, S6.7 commands):
//   1. `home_cloud_sign_in_prepare` (Rust)  → the profile id the sign-in may write
//   2. POST /_home/cloud/signin/start        → { userCode, state }   (the device code stays on the server)
//   3. `home_cloud_sign_in_open` (Rust)      → the browser opens; Rust composes the URL itself
//   4. poll every 5 s, or at once on a `maude://auth/done` nudge (`auth://return` on the shell bus)
//   5. on `done`: `home_cloud_signed_in` (Rust records the account) → `onSignedIn` (Home reloads)
// A `maude://auth/cancelled?state=` nudge for the live attempt restores the card at once; any other
// state is a no-op (signin-model.js). No credential, device code or URL passes through this file.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
  cloudSignInCancel,
  cloudSignInPoll,
  cloudSignInStart,
  shellListen,
  signInDone,
  signInOpenBrowser,
  signInPrepare,
} from '../../home/home-api.js';
import {
  initialSignIn,
  SIGNIN_POLL_MS,
  SIGNIN_WAIT_MS,
  SIGNIN_WORDS,
  STATE_RE,
  signinReducer,
} from './signin-model.js';

const wordsOf = (e) => (typeof e === 'string' ? e : e?.message) || SIGNIN_WORDS.unreachable;

/**
 * @param {{ native: boolean, onSignedIn?: (r: {email: string, landing: unknown, profile: string}) => unknown,
 *           now?: () => number }} opts
 */
export function useCloudSignIn({ native, onSignedIn, now = Date.now }) {
  const [s, dispatch] = useReducer(signinReducer, undefined, initialSignIn);
  const [note, setNote] = useState(null);
  const sRef = useRef(s);
  sRef.current = s;
  const attempt = useRef(0); // bumps on start and cancel: an answer from an older attempt is dropped
  const polling = useRef(false);
  const signedInRef = useRef(onSignedIn);
  signedInRef.current = onSignedIn;

  const begin = useCallback(
    async (opts = {}) => {
      const cur = sRef.current;
      if (!native || cur.phase === 'starting' || cur.phase === 'waiting' || cur.phase === 'done')
        return;
      const id = ++attempt.current;
      setNote(null);
      dispatch({ type: 'start' });
      const fail = (error) => {
        if (id === attempt.current) dispatch({ type: 'start-failed', error });
      };
      let profile;
      try {
        profile = await signInPrepare(opts.forInvite);
      } catch (e) {
        fail(wordsOf(e));
        return;
      }
      if (typeof profile !== 'string' || !profile) {
        fail(SIGNIN_WORDS.unreachable);
        return;
      }
      const r = await cloudSignInStart(profile);
      const j = r.json;
      const good = r.ok && j?.ok && typeof j.userCode === 'string' && STATE_RE.test(j.state);
      if (id !== attempt.current) {
        // Cancelled while the cloud answered: that attempt must not stay alive on the server
        if (good) cloudSignInCancel(j.state);
        return;
      }
      if (!good) {
        fail(typeof j?.error === 'string' && j.error ? j.error : SIGNIN_WORDS.unreachable);
        return;
      }
      dispatch({ type: 'started', profile, userCode: j.userCode, state: j.state, at: now() });
      try {
        await signInOpenBrowser(j.userCode, j.state);
      } catch (e) {
        if (id === attempt.current) setNote(wordsOf(e));
      }
    },
    [native, now]
  );

  const cancel = useCallback(() => {
    const cur = sRef.current;
    if (cur.phase !== 'starting' && cur.phase !== 'waiting') return;
    attempt.current += 1;
    dispatch({ type: 'cancel' });
    setNote(null);
    if (cur.state) cloudSignInCancel(cur.state);
  }, []);

  const reopen = useCallback(async () => {
    const cur = sRef.current;
    if (cur.phase !== 'waiting' || !cur.userCode) return;
    setNote(null);
    try {
      await signInOpenBrowser(cur.userCode, cur.state);
    } catch (e) {
      setNote(wordsOf(e));
    }
  }, []);

  const showCode = useCallback(() => dispatch({ type: 'show-code' }), []);

  const pollNow = useCallback(async () => {
    const cur = sRef.current;
    if (cur.phase !== 'waiting' || polling.current) return;
    polling.current = true;
    try {
      dispatch({ type: 'tick', now: now() });
      const r = await cloudSignInPoll(cur.state);
      if (r.status === 409 || r.json?.reason === 'stale-state') {
        dispatch({ type: 'stale', state: cur.state });
        return;
      }
      const j = r.json;
      if (!r.ok || !j || typeof j.status !== 'string') return; // offline / hiccup: keep waiting
      dispatch({
        type: 'poll',
        state: cur.state,
        status: j.status,
        email: typeof j.email === 'string' ? j.email : '',
        landing: j.landing ?? null,
      });
      if (j.status !== 'done') return;
      let landed = cur.profile;
      try {
        const p = await signInDone(cur.profile);
        if (typeof p === 'string' && p) landed = p;
      } catch {
        /* the credential is stored; Home reads the account from the listing */
      }
      try {
        await signedInRef.current?.({
          email: typeof j.email === 'string' ? j.email : '',
          landing: j.landing ?? null,
          profile: landed,
        });
      } finally {
        dispatch({ type: 'finished' });
      }
    } finally {
      polling.current = false;
    }
  }, [now]);

  // poll while waiting; the clock also ends the wait if the poll cannot (offline)
  useEffect(() => {
    if (s.phase !== 'waiting') return undefined;
    const every = setInterval(pollNow, SIGNIN_POLL_MS);
    const left = Math.max(0, s.startedAt + SIGNIN_WAIT_MS - now());
    const end = setTimeout(
      () => dispatch({ type: 'tick', now: s.startedAt + SIGNIN_WAIT_MS }),
      left
    );
    const onFocus = () => pollNow();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(every);
      clearTimeout(end);
      window.removeEventListener('focus', onFocus);
    };
  }, [s.phase, s.startedAt, pollNow, now]);

  // `maude://auth/{done,cancelled}?state=` — Rust only forwards the live attempt's own state
  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    let off = null;
    shellListen('auth://return', (p) => {
      const cur = sRef.current;
      if (!p || typeof p.state !== 'string' || cur.phase !== 'waiting' || p.state !== cur.state)
        return;
      if (p.kind === 'cancelled') {
        attempt.current += 1;
        dispatch({ type: 'nudge', kind: 'cancelled', state: p.state });
        cloudSignInCancel(p.state);
      } else if (p.kind === 'done') {
        pollNow();
      }
    }).then((fn) => {
      if (alive) off = fn;
      else fn();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [native, pollNow]);

  // leaving the page ends the wait on this side (the server's own clock ends the attempt)
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    []
  );

  return { state: s, note, begin, cancel, reopen, showCode };
}
