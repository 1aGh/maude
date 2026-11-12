// client/v2/ai/agents-store.js — universal ACP B6: the one `/_api/agents` list every surface reads (the offer
// line, the composer's agent chip, the Connect sheet's link, Settings › Connections › AI agents), and the
// verbs that change it (connect · sign in · disconnect · Not now).
//
// One module-level snapshot, so the panel and Settings never disagree; each write reads the list again.
// `servedFetch` (#204): a cell, or an older server without the route (404), reads as "no agents", which is
// exactly the Claude-only picture: nothing new is drawn.
//
//   connectAgentFlow({ id, consent, fetchImpl, sleep, now, signal, onPhase }) → { ok } | { ok:false, reason, detail? }
//
// Phases: 'connecting' · 'waiting' (for the vendor's own sign-in in the browser). Cancel = abort the signal
// (the sign-in is withdrawn). Pure of React so the tests drive it with a scripted fetch.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { servedFetch } from '../shell/served-routes.js';
import { connectFailWords, normalizeAgents } from './agents-model.js';

const SIGNIN_POLL_MS = 2000;
const SIGNIN_MAX_MS = 180_000;

const EMPTY = Object.freeze({ agents: [], offerAgents: [], loaded: false });
let snap = EMPTY;
const subs = new Set();
let inflight = null;

function emit() {
  for (const fn of subs) fn();
}

export function subscribeAgents(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const agentsSnapshot = () => snap;

/** Tests only: put a list in place (or reset with no argument). */
export function setAgentsForTest(body) {
  snap = body ? { ...normalizeAgents(body), loaded: true } : EMPTY;
  inflight = null;
  emit();
}

/** Read the list (once at a time); `force` asks the server to look on disk again. */
export function loadAgents({ force = false, fetchImpl } = {}) {
  if (inflight && !force) return inflight;
  const url = force ? '/_api/agents?refresh=1' : '/_api/agents';
  const run = servedFetch(url, { cache: 'no-store' }, fetchImpl ?? ((...a) => fetch(...a)))
    .then(async (res) => (res?.ok ? res.json() : null))
    .catch(() => null)
    .then((body) => {
      snap = { ...normalizeAgents(body), loaded: true };
      emit();
      return snap;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

// The profile this project talks as (`/_config.profile.id`): the last-used agent is remembered per profile.
let profileId = null;
let profileAsk = null;
export function loadProfileId(fetchImpl = (...a) => fetch(...a)) {
  if (profileId) return Promise.resolve(profileId);
  profileAsk ??= fetchImpl('/_config', { cache: 'no-store', credentials: 'same-origin' })
    .then((r) => (r?.ok ? r.json() : null))
    .catch(() => null)
    .then((cfg) => {
      const id = cfg?.profile?.id;
      profileId = typeof id === 'string' && /^[a-z0-9-]{1,32}$/.test(id) ? id : 'default';
      return profileId;
    });
  return profileAsk;
}
export const currentProfileId = () => profileId ?? 'default';

/** The list, read once on first use. */
export function useAgents() {
  const s = useSyncExternalStore(subscribeAgents, agentsSnapshot, agentsSnapshot);
  useEffect(() => {
    if (!snap.loaded) void loadAgents();
  }, []);
  return s;
}

const enc = (id) => encodeURIComponent(id);
const json = (res) => (res?.json ? res.json().catch(() => null) : null);

function post(fetchImpl, url, body) {
  return fetchImpl(url, {
    method: 'POST',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
    .then(json)
    .catch(() => null);
}

/** "Not now" on the offer: permanent, for every agent the line named. */
export async function dismissAgentOffers(ids, { fetchImpl = (...a) => fetch(...a) } = {}) {
  await Promise.all(
    (ids ?? []).map((id) => post(fetchImpl, `/_api/agents/${enc(id)}/dismiss-offer`))
  );
  await loadAgents({ fetchImpl });
}

export async function disconnectAgent(id, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const r = await post(fetchImpl, `/_api/agents/${enc(id)}/disconnect`);
  await loadAgents({ fetchImpl });
  return r ?? { ok: false };
}

/** Start the vendor's own sign-in, then wait for it (or for Cancel). */
async function signIn({ id, fetchImpl, sleep, now, signal, onPhase }) {
  const started = await post(fetchImpl, `/_api/agents/${enc(id)}/signin`);
  if (!started?.ok) return { ok: false, reason: 'signin-failed' };
  onPhase('waiting');
  const deadline = now() + SIGNIN_MAX_MS;
  for (;;) {
    if (signal?.aborted) {
      await post(fetchImpl, `/_api/agents/${enc(id)}/signin-cancel`);
      return { ok: false, reason: 'cancelled' };
    }
    if (now() > deadline) {
      await post(fetchImpl, `/_api/agents/${enc(id)}/signin-cancel`);
      return { ok: false, reason: 'timeout' };
    }
    const st = await fetchImpl(`/_api/agents/${enc(id)}/signin-status`)
      .then(json)
      .catch(() => null);
    if (st?.auth === 'signed-in' || st?.auth === 'not-needed') return { ok: true };
    // the vendor's login exited without signing in (a closed browser tab, a refused login)
    if (st && st.inFlight === false && typeof st.lastExit === 'number' && st.lastExit !== 0)
      return { ok: false, reason: 'signin-failed' };
    await sleep(SIGNIN_POLL_MS);
  }
}

/**
 * Connect one agent: register it, and when its vendor needs a sign-in first, run that sign-in and connect
 * again. It does not change the default agent, open a session or widen any permission (Design Decision 1).
 */
export async function connectAgentFlow({
  id,
  consent = false,
  signinFirst = false,
  fetchImpl = (...a) => fetch(...a),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  signal,
  onPhase = () => {},
} = {}) {
  const deps = { id, fetchImpl, sleep, now, signal, onPhase };
  const connect = () =>
    post(fetchImpl, `/_api/agents/${enc(id)}/connect`, consent ? { consent: true } : undefined);
  let r;
  if (signinFirst) {
    const s = await signIn(deps);
    if (!s.ok) return s;
  }
  onPhase('connecting');
  r = await connect();
  if (r?.needsSignin) {
    const s = await signIn(deps);
    if (!s.ok) {
      await loadAgents({ fetchImpl });
      return s;
    }
    onPhase('connecting');
    r = await connect();
  }
  await loadAgents({ fetchImpl });
  if (r?.ok) return { ok: true };
  return { ok: false, reason: r?.reason ?? 'unknown', ...(r?.detail ? { detail: r.detail } : {}) };
}

/**
 * One connect at a time, with its progress and Cancel: what the offer line and the Settings card share.
 * `phase` = 'idle' · 'connecting' · 'waiting'; `busyId` = the agent being connected; `error` = words.
 * @param deps test seam: `fetchImpl`, `sleep`, `now`
 */
export function useAgentConnect(deps = {}) {
  const [state, setState] = useState({ phase: 'idle', busyId: null, error: null, errorId: null });
  const ctl = useRef(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  useEffect(() => () => ctl.current?.abort(), []);
  const connect = useCallback(async (row, opts = {}) => {
    if (!row?.id || ctl.current) return false;
    const abort = new AbortController();
    ctl.current = abort;
    setState({ phase: 'connecting', busyId: row.id, error: null, errorId: null });
    const r = await connectAgentFlow({
      ...depsRef.current,
      id: row.id,
      consent: opts.consent === true,
      signinFirst: opts.signinFirst === true,
      signal: abort.signal,
      onPhase: (phase) => setState((s) => ({ ...s, phase })),
    });
    if (ctl.current === abort) ctl.current = null;
    const failed = !r.ok && r.reason !== 'cancelled';
    setState({
      phase: 'idle',
      busyId: null,
      error: failed ? connectFailWords(r, row.label) : null,
      errorId: failed ? row.id : null,
    });
    return r.ok;
  }, []);
  const cancel = useCallback(() => ctl.current?.abort(), []);
  return { ...state, connect, cancel };
}

/** The progress words of a connect: "Connecting Codex…" · "Sign in to Codex in your browser…". */
export function connectProgressWords(phase, label) {
  if (phase === 'waiting') return `Sign in to ${label} in your browser…`;
  if (phase === 'connecting') return `Connecting ${label}…`;
  return null;
}
