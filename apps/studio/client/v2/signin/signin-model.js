// client/v2/signin/signin-model.js — the sign-in card's state machine (S6.8; contract
// S6-S9-signin-invite-home §5.1, S6-slices Q1/Q3). Pure: no React, no DOM, no fetch.
//
//   idle ──start──▶ starting ──started──▶ waiting ──poll done──▶ done ──finished──▶ idle
//                      │                     │  ├─poll expired / tick ≥ 10 min──▶ timeout ──start──▶ …
//                      └─start-failed─▶ failed  └─cancel / nudge cancelled / stale──▶ idle
//
// An attempt is named by its `state` (32 lowercase hex, made by the Home server). Anything that names
// ANOTHER attempt — a late poll answer, a forged or old `maude://auth/cancelled` nudge — changes nothing
// (the same rule the Home server and Rust apply on their side). The device code and the token never
// reach this file: the card holds the `userCode` the person may type on cloud.maude.sh/activate.

/** The Home server's own wait for one attempt (`expiresIn: 600` — the device code itself lives 15 min). */
export const SIGNIN_WAIT_MS = 10 * 60 * 1000;
/** The device flow's interval; a `maude://auth/done` nudge polls at once instead. */
export const SIGNIN_POLL_MS = 5000;
export const STATE_RE = /^[0-9a-f]{32}$/;

export const initialSignIn = () => ({
  phase: 'idle', // idle | starting | waiting | done | timeout | failed
  state: null,
  userCode: null,
  profile: null,
  startedAt: 0,
  showCode: false,
  error: null,
  email: null,
  landing: null,
});

const live = (s) => s.phase === 'starting' || s.phase === 'waiting';
const mine = (s, state) => typeof state === 'string' && STATE_RE.test(state) && state === s.state;

/** The attempt ended without an account: the plain card, nothing remembered. */
const idle = () => initialSignIn();

export function signinReducer(s, e) {
  switch (e?.type) {
    case 'start':
      // one attempt at a time; Try again after a timeout or a failure is a new attempt
      return live(s) || s.phase === 'done'
        ? s
        : { ...initialSignIn(), phase: 'starting', profile: s.profile };
    case 'started':
      // the answer to a start that was cancelled meanwhile is dropped
      return s.phase === 'starting'
        ? {
            ...s,
            phase: 'waiting',
            state: e.state,
            userCode: e.userCode ?? null,
            profile: e.profile ?? s.profile,
            startedAt: e.at ?? 0,
            showCode: false,
            error: null,
          }
        : s;
    case 'start-failed':
      return s.phase === 'starting' ? { ...idle(), phase: 'failed', error: e.error ?? null } : s;
    case 'cancel':
      return live(s) ? idle() : s;
    case 'nudge':
      // `maude://auth/cancelled?state=` — only the live attempt's own state restores the card
      return e.kind === 'cancelled' && s.phase === 'waiting' && mine(s, e.state) ? idle() : s;
    case 'stale':
      return s.phase === 'waiting' && mine(s, e.state) ? idle() : s;
    case 'poll': {
      if (s.phase !== 'waiting' || !mine(s, e.state)) return s;
      if (e.status === 'done')
        return { ...s, phase: 'done', email: e.email ?? '', landing: e.landing ?? null };
      if (e.status === 'expired') return { ...idle(), phase: 'timeout', profile: s.profile };
      if (e.status === 'cancelled') return idle();
      return s; // pending
    }
    case 'tick':
      return s.phase === 'waiting' && e.now - s.startedAt >= SIGNIN_WAIT_MS
        ? { ...idle(), phase: 'timeout', profile: s.profile }
        : s;
    case 'show-code':
      return s.phase === 'waiting' ? { ...s, showCode: true } : s;
    case 'finished':
      return s.phase === 'done' ? idle() : s;
    default:
      return s;
  }
}

/**
 * What the card draws. Waiting wins over everything (the person is in the browser); offline outranks the
 * timeout / failure line because the cloud button could not work now — it wakes by itself when the Mac
 * is back (the caller passes the live `online`).
 */
export function cardMode(s, online) {
  if (s.phase === 'starting' || s.phase === 'waiting' || s.phase === 'done') return 'waiting';
  if (online === false) return 'offline';
  if (s.phase === 'timeout') return 'timeout';
  if (s.phase === 'failed') return 'failed';
  return 'idle';
}

export const SIGNIN_WORDS = {
  title: 'Keep your work on cloud.maude.sh',
  sub: 'Every Mac you use, and everyone you invite, sees the same canvases.',
  cloud: 'Sign in to cloud.maude.sh',
  local: 'Just a local project',
  waiting: 'Waiting for your browser…',
  again: 'Open the page again',
  otherDevice: 'Signed in on another device?',
  useCode: 'Enter a code instead',
  codeLine: 'Open cloud.maude.sh/activate on any device and enter this code.',
  timeoutTitle: "Sign-in didn't finish",
  timeoutBody: 'Nothing changed on this Mac. Try again whenever you like.',
  offlineTitle: 'Offline',
  offlineBody: 'Sign-in waits until this Mac is online — the button wakes up by itself.',
  offlineFoot: 'A local project works right now, and moves to the cloud any time.',
  hint: 'Opens your browser, then brings you back. 14 days free, no card.',
  advanced: 'Advanced options',
  unreachable: 'cloud.maude.sh could not be reached. Try again in a moment.',
  toastFirst: 'Signed in. What you make now lives on cloud.maude.sh.',
};

/** The toast after a sign-in: how many cloud projects arrived with the account. */
export function signedInToast(projectCount) {
  const n = Number.isFinite(projectCount) ? projectCount : 0;
  if (n <= 0) return SIGNIN_WORDS.toastFirst;
  return n === 1
    ? 'Signed in — your cloud project is here.'
    : `Signed in — your ${n} cloud projects are here.`;
}

/**
 * Is this Home a first run? No project on this Mac, no cloud account, and the lists have loaded.
 * (The card shows only then; afterwards a quiet "Sign in to cloud.maude.sh" sits in the top bar.)
 */
export function isFirstRun({ status, projectCount, signedIn }) {
  return status !== 'loading' && !signedIn && (projectCount ?? 0) === 0;
}
