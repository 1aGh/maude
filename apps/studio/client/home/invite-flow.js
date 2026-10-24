// client/home/invite-flow.js — an invite reaches Home (S6.11; 02 ob-invite-landed, ob-home-team, ob-edge-accounts;
// contract S6-S9-signin-invite-home §5.1–§5.3, S6 Q12).
//
//   `maude://invite/<id>` → Rust parks the id for Home (`take_pending_invite`) and nudges `invite://open {id}`
//   → peek (what the public invite page shows) → which profile on this Mac holds the invite's address?
//       one does            → the sheet "Join <project> as <address>?" → Join = accept with it → a one-time
//                             handoff code + the landing. A link is never an accept: any web page can open a
//                             `maude://` URL, so the person always presses Join (gate-b-sec3 M2).
//       another account     → the sheet "Open the invite as <address>?" → Open = a sign-in for the invite in a
//                             NEW profile (Rust `home_cloud_sign_in_prepare({forInvite})` never re-signs a
//                             profile that holds an account), so every other tab keeps its own
//       nobody signed in    → the same sheet; Open = that sign-in
//   → `/_home/cloud/prepare` with the code → `managed_project_open` → `open_project({target:{canvas, thread}})`
//
// The deferred path: an invite opened in the browser before Maude was installed is redeemed by the cloud at
// sign-in, and the first sign-in's poll answers `landing` — Home opens it the same way (a normal prepare).
//
// The invite id is a bearer secret. It lives in a ref (never state, never the DOM), rides only in POST bodies to
// Home's own server and in the Rust invoke, is never logged and never put in a URL. Another account is ALWAYS
// said out loud (the sheet) — Home never attaches an invite to whichever account happens to be signed in.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  inviteAccept,
  invitePeek,
  prepareCloud,
  prepareCloudLink,
  shellListen,
  takePendingInvite,
} from './home-api.js';

export const INVITE_ID_RE = /^[0-9a-f-]{36}$/;
const THREAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const INVITE_WORDS = {
  gone: 'This invitation link is not valid. Ask the person who invited you for a new one.',
  unreachable: 'cloud.maude.sh could not be reached. Try again in a moment.',
  busy: 'Too many tries with that invitation. Wait a minute, then open the link again.',
  update: 'This invitation needs a newer Maude. Update Maude, then open the link again.',
  open: 'Open',
  cancel: 'Cancel',
  join: 'Join',
  waiting: 'Waiting for your browser…',
  again: 'Open the page again',
  thisWindow: 'This window, now',
  newTab: 'A new tab',
};

/** Two e-mail addresses name the same account (the cloud compares case-insensitively). */
export const sameAddress = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.trim() !== '' &&
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** The accounts signed in on this Mac, from Home's cloud listings: `[{profile, email}]`. */
export function signedInAccounts(clouds) {
  return (clouds ?? [])
    .filter((c) => c?.signedIn && typeof c.profile === 'string' && c.profile)
    .map((c) => ({
      profile: c.profile,
      email: typeof c.account?.email === 'string' ? c.account.email : null,
    }));
}

const str = (v, n) => (typeof v === 'string' && v.trim() ? v.slice(0, n) : null);

/** A peek answer's facts, checked again (the Home server already clamped them). null = not an invite. */
export function cleanInvite(json) {
  if (!json || typeof json !== 'object') return null;
  const projectName = str(json.projectName, 200);
  const email = str(json.email, 320);
  const role = ['observer', 'viewer', 'member'].includes(json.role) ? json.role : null;
  if (!projectName || !email || !role) return null;
  const canvas =
    json.canvas && typeof json.canvas === 'object' && str(json.canvas.path, 512)
      ? { path: json.canvas.path, name: str(json.canvas.name, 200) ?? json.canvas.path }
      : null;
  return { projectName, fromName: str(json.fromName, 200), email, role, canvas };
}

/** The refusals every invite call shares, as a plan. null = not one of them. */
function refusalPlan(r) {
  if (r?.status === 404) return { kind: 'notice', words: INVITE_WORDS.gone };
  if (r?.status === 429) return { kind: 'notice', words: INVITE_WORDS.busy };
  if (r?.status === 426) return { kind: 'notice', words: INVITE_WORDS.update };
  return null;
}

/**
 * What a peek answer means on THIS Mac. Pure.
 *   { kind: 'ask', mode: 'join', invite, current }            a profile holds the invite's address — the
 *                                                             person still presses Join (never accepted by a link)
 *   { kind: 'ask', mode: 'other-account', invite, current }   signed in, but as someone else
 *   { kind: 'ask', mode: 'signed-out', invite }               nobody is signed in
 *   { kind: 'notice', words }                                 dead, rate-limited or unreachable
 */
export function planInvite(peek, clouds) {
  const refused = refusalPlan(peek);
  if (refused) return refused;
  const invite = peek?.ok ? cleanInvite(peek.json) : null;
  if (!invite) return { kind: 'notice', words: INVITE_WORDS.unreachable };
  const accounts = signedInAccounts(clouds);
  const mine = accounts.find((a) => sameAddress(a.email, invite.email));
  if (mine) return { kind: 'ask', mode: 'join', invite, current: mine };
  if (accounts.length) return { kind: 'ask', mode: 'other-account', invite, current: accounts[0] };
  return { kind: 'ask', mode: 'signed-out', invite };
}

/** Where in the project a landing points: `{canvas, thread?}`, or null for the project alone. Pure. */
export function landingTarget(landing) {
  const canvas = str(landing?.canvas, 1024);
  if (!canvas) return null;
  const thread =
    typeof landing.thread === 'string' && THREAD_RE.test(landing.thread) ? landing.thread : null;
  return thread ? { canvas, thread } : { canvas };
}

/**
 * What an accept answer means. Pure.
 *   { kind: 'open', code, landing }                    trade the code, land there
 *   { kind: 'ask', mode: 'other-account'|'signed-out' } say so, offer the sign-in (never attach silently)
 *   { kind: 'notice', words }
 */
export function planAccept(r, { profile, invite }) {
  if (r?.status === 403) {
    const email = str(r.json?.email, 320) ?? invite.email;
    return {
      kind: 'ask',
      mode: 'other-account',
      invite: { ...invite, email },
      current: { profile, email: null },
    };
  }
  if (r?.status === 401) return { kind: 'ask', mode: 'signed-out', invite };
  const refused = refusalPlan(r);
  if (refused) return refused;
  const j = r?.json;
  if (
    !r?.ok ||
    !j?.ok ||
    typeof j.code !== 'string' ||
    !j.landing ||
    typeof j.landing.project !== 'string'
  )
    return { kind: 'notice', words: INVITE_WORDS.unreachable };
  return { kind: 'open', code: j.code, landing: j.landing };
}

/**
 * After a sign-in finished (`useCloudSignIn`'s `onSignedIn`). Pure.
 *   pending = the invite waiting for this sign-in (or null)
 *   { kind: 'accept', profile }        the new account is the invite's — accept with it
 *   { kind: 'ask', mode: 'other-account', ... }  the browser signed in someone else: say so again
 *   { kind: 'landing', profile, landing }        no invite here, but the cloud redeemed one at sign-in
 *   null                                         nothing to open
 */
export function planAfterSignIn({ profile, email, landing }, pending) {
  if (pending?.invite) {
    if (sameAddress(email, pending.invite.email)) return { kind: 'accept', profile };
    return {
      kind: 'ask',
      mode: 'other-account',
      invite: pending.invite,
      current: { profile, email: str(email, 320) },
    };
  }
  if (landing && typeof landing.project === 'string' && landing.project)
    return { kind: 'landing', profile, landing };
  return null;
}

/** The sheet's words (02 ob-edge-accounts). Pure. */
export function inviteSheetWords({ mode, invite, current }) {
  // O3: no inviter name (unset, or an invite from before v18) → no name, never an address
  const lead = invite.fromName
    ? `${invite.fromName} invited that address to ${invite.projectName}.`
    : `That address is invited to ${invite.projectName}.`;
  if (mode === 'join') {
    const as = current?.email || invite.email;
    return {
      title: invite.fromName
        ? `Join ${invite.projectName} from ${invite.fromName} as ${as}?`
        : `Join ${invite.projectName} as ${as}?`,
      body: lead,
      fine: `Opens ${invite.projectName} in its own tab, signed in as ${as}.`,
    };
  }
  if (mode === 'other-account')
    return {
      title: `Open the invite as ${invite.email}?`,
      body: current?.email
        ? `${lead} This window is signed in as ${current.email}.`
        : `${lead} This window is signed in with another account.`,
      fine: `Opens ${invite.projectName} in its own tab, signed in as ${invite.email}. To switch the whole app: Settings › General › Account.`,
    };
  return {
    title: `Open the invite as ${invite.email}?`,
    body: lead,
    fine: `Sign in as ${invite.email} in your browser — ${invite.projectName} opens here after.`,
  };
}

/**
 * Accept with `profile`, trade the code, open the landing. deps: { accept(id, profile), prepareLink(profile,
 * link), openPrepared(prep, name, profile, target) }. Returns the accept plan (`open` once the tab opened).
 */
export async function acceptAndOpen({ id, profile, invite }, deps) {
  const r = await deps.accept(id, profile);
  const plan = planAccept(r, { profile, invite });
  if (plan.kind !== 'open') return plan;
  const prep = await deps.prepareLink(profile, { project: plan.landing.project, code: plan.code });
  await deps.openPrepared(prep, invite.projectName, profile, landingTarget(plan.landing));
  return plan;
}

/**
 * Join an invitation listed on Home (Shared with you): accept it by project (and canvas) with the profile it was
 * listed under, trade the code, open the landing. No invite id exists on this path. deps: { acceptPending(profile,
 * projectId, canvas), prepareLink, openPrepared }. Returns the accept plan, so the caller can say a refusal in words.
 */
export async function joinPendingAndOpen({ profile, projectId, canvasPath, projectName }, deps) {
  const r = await deps.acceptPending(profile, projectId, canvasPath);
  const plan = planAccept(r, { profile, invite: { projectName, email: null } });
  if (plan.kind !== 'open') return plan;
  const prep = await deps.prepareLink(profile, { project: plan.landing.project, code: plan.code });
  await deps.openPrepared(prep, projectName, profile, landingTarget(plan.landing));
  return plan;
}

/** The deferred landing: a normal prepare of the project, then the canvas and thread. deps: { prepare,
 *  openPrepared }. */
export async function openLanding({ profile, landing }, deps) {
  const prep = await deps.prepare(profile, null, landing.project);
  await deps.openPrepared(prep, landing.project, profile, landingTarget(landing));
}

/**
 * Home's invite controller. `signin` is the page's `useCloudSignIn` (begin / cancel / reopen / state);
 * `openPrepared` is Home's own (browser door, managed copy → tab).
 * Returns { sheet, open, cancel, reopen, afterSignIn }.
 */
export function useInviteFlow({
  native,
  clouds,
  cloudsReady,
  signin,
  openPrepared,
  reload,
  onNotice,
}) {
  const [sheet, setSheet] = useState(null); // null | { mode, invite, current, busy }
  const sheetRef = useRef(null);
  sheetRef.current = sheet;
  const pending = useRef(null); // { id, invite? } — the id stays out of React state
  const busy = useRef(false);
  const live = useRef(null);
  live.current = { clouds, signin, openPrepared, reload, onNotice };

  const deps = useCallback(
    () => ({
      accept: inviteAccept,
      prepareLink: prepareCloudLink,
      prepare: prepareCloud,
      openPrepared: (...a) => live.current.openPrepared(...a),
    }),
    []
  );

  const settle = useCallback((plan) => {
    const cur = live.current;
    if (plan.kind === 'ask') {
      setSheet({
        mode: plan.mode,
        invite: plan.invite,
        current: plan.current ?? null,
        busy: false,
      });
      if (pending.current) pending.current.invite = plan.invite;
      return;
    }
    pending.current = null;
    setSheet(null);
    if (plan.kind === 'notice') cur.onNotice?.(plan.words);
    else cur.reload?.();
  }, []);

  const accept = useCallback(
    async (profile) => {
      const p = pending.current;
      if (!p?.invite) return;
      try {
        settle(await acceptAndOpen({ id: p.id, profile, invite: p.invite }, deps()));
      } catch {
        settle({ kind: 'notice', words: INVITE_WORDS.unreachable });
      }
    },
    [deps, settle]
  );

  const handle = useCallback(async () => {
    const p = pending.current;
    if (!p || p.invite || busy.current) return;
    busy.current = true;
    try {
      // every outcome is a sheet or a notice: a link alone never accepts (M2)
      settle(planInvite(await invitePeek(p.id), live.current.clouds));
    } catch {
      settle({ kind: 'notice', words: INVITE_WORDS.unreachable });
    } finally {
      busy.current = false;
    }
  }, [settle]);

  // One invite at a time: one the person is reading (or signing in for) is never replaced.
  const receive = useCallback(
    (id) => {
      if (typeof id !== 'string' || !INVITE_ID_RE.test(id) || pending.current) return;
      pending.current = { id };
      if (cloudsReady) handle();
    },
    [cloudsReady, handle]
  );

  useEffect(() => {
    if (cloudsReady && pending.current && !pending.current.invite) handle();
  }, [cloudsReady, handle]);

  // the link that launched the app (parked), and links while Home runs (the event nudges; take consumes)
  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    let off = null;
    const take = (hint) =>
      takePendingInvite()
        .then((id) => alive && receive(typeof id === 'string' ? id : hint))
        .catch(() => alive && receive(hint));
    take(null);
    shellListen('invite://open', (p) => take(typeof p?.id === 'string' ? p.id : null)).then(
      (fn) => {
        if (alive) off = fn;
        else fn();
      }
    );
    return () => {
      alive = false;
      off?.();
    };
  }, [native, receive]);

  /** The sheet's primary button. Join (the address is signed in here): accept with that profile, the one
   *  explicit step. Open: a sign-in for the invite (Rust makes the new profile; the cloud pre-fills the address). */
  const open = useCallback(() => {
    const p = pending.current;
    if (!p?.invite) return;
    const s = sheetRef.current;
    setSheet((x) => (x ? { ...x, busy: true } : x));
    if (s?.mode === 'join' && s.current?.profile) {
      accept(s.current.profile);
      return;
    }
    live.current.signin.begin({ forInvite: p.id });
  }, [accept]);

  const cancel = useCallback(() => {
    const ph = live.current.signin.state?.phase;
    if (ph === 'starting' || ph === 'waiting') live.current.signin.cancel();
    pending.current = null;
    setSheet(null);
  }, []);

  /** Called from `onSignedIn`; true when it opened (or is asking about) something, so Home skips its toast. */
  const afterSignIn = useCallback(
    async (r) => {
      const plan = planAfterSignIn(r ?? {}, pending.current);
      if (!plan) return false;
      if (plan.kind === 'accept') {
        // only the sign-in the sheet's Open started accepts; any other sign-in asks Join first (M2)
        if (sheetRef.current?.busy) await accept(plan.profile);
        else
          settle({
            kind: 'ask',
            mode: 'join',
            invite: pending.current.invite,
            current: { profile: plan.profile, email: str(r?.email, 320) },
          });
      } else if (plan.kind === 'landing') {
        try {
          await openLanding(plan, deps());
          live.current.reload?.();
        } catch {
          live.current.onNotice?.(INVITE_WORDS.unreachable);
        }
      } else settle(plan);
      return true;
    },
    [accept, deps, settle]
  );

  // the sign-in for the invite ended without an account (timeout / failure / cancelled in the browser):
  // the sheet takes its Open back
  const phase = signin?.state?.phase;
  useEffect(() => {
    if (phase === 'idle' || phase === 'timeout' || phase === 'failed')
      setSheet((s) => (s?.busy ? { ...s, busy: false } : s));
  }, [phase]);

  return { sheet, open, cancel, reopen: signin?.reopen, afterSignIn };
}
