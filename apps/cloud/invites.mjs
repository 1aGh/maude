// Accepting a project invitation — Cloud Phase 22 Task 5 (DDR-204).
//
// The invite IS the account: somebody with no Maude account follows one link,
// chooses a password, and lands in the project — they never sign up first and
// then have to find their way. Somebody who already has an account signs in
// (or already is) and the same link attaches them.
//
// One rule carried from the rest of the identity surface: the page never
// reveals more than the link-holder is entitled to. A dead link — expired,
// revoked, already used, or simply wrong — gets ONE neutral sentence, because
// "this invite was revoked" tells a fired contractor exactly what happened and
// a guessed UUID must learn nothing at all.

import { ACCESS_VERSION_REFUSAL, declaredAccessOf } from '../studio/access/scope.ts';
import {
  accessOf,
  INVITE_THREAD,
  loadClaim,
  raiseMembership,
  validCanvasPath,
  writeGrant,
} from './access-forward.mjs';
import { createAccount, createSession, getAccountByEmail } from './accounts.mjs';
import { track } from './analytics.mjs';
import { DESKTOP_DOWNLOAD_URL, googleButton, publicPage, publicResponse } from './brand.mjs';
import { audit } from './db.mjs';
import { personalTokenAccount } from './device-auth.mjs';
import { spend } from './edge.mjs';
import { mintHandoffCode } from './handoff.mjs';
import { googleConfigured } from './oauth-google.mjs';

/**
 * The deferred deep link (S9 Q6, decision v2-S9-deferred-deep-link-server-side).
 * Opening an invitation sets this cookie for half an hour, so a person who
 * leaves to install the app and then signs in from it still lands in the
 * project: sign-in redeems it into the account (`redeemPendingInvite`), and
 * the next handoff exchange carries `landing` (`landingForInvite`). No
 * fingerprinting, no clipboard — it survives a fresh install because it lives
 * on cloud.maude.sh, where the sign-in happens.
 */
export const PENDING_INVITE_COOKIE = 'maude_pending_invite';
const PENDING_INVITE_MS = 30 * 60 * 1000;
const pendingCookie = (id, maxAge) =>
  `${PENDING_INVITE_COOKIE}=${id}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure; HttpOnly`;

const DEAD_LINK =
  'This invitation link is not valid. Ask the person who invited you for a new one.';

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// The v2 public shell (brand.mjs) — one skeleton and one header set for every
// page a person reaches from outside.
const html = (body, status = 200, extraHeaders = {}) => publicResponse(body, status, extraHeaders);
const deadInvitePage = () => publicPage({ title: 'Invitation', body: `<p>${DEAD_LINK}</p>` });

const INVITE_ID = /^[0-9a-f-]{36}$/;

const ROLE_MEANING = {
  observer: 'You’ll be able to look at the work.',
  viewer: 'You’ll be able to look at the work and leave comments.',
  member: 'You’ll be able to design and edit alongside the team.',
};

/** `ui/Poster.tsx` → `Poster` — the name a person sees for a canvas. */
export function canvasName(path) {
  const base =
    String(path ?? '')
      .split('/')
      .pop() ?? '';
  return base.replace(/\.[^.]+$/, '') || base;
}

/**
 * The invitation page (Maude v2 S9.14, canvas 02 ob-invite-page).
 *
 * The link explains itself: who invited you, to what, and the comment it points
 * at — then ONE download. Already installed? Open in Maude
 * (`maude://invite/<id>` — the invitation's id and nothing else: no e-mail, no
 * project name, no credential, S6↔S9 §5.6). After install, signing in from the
 * app redeems the invitation through the pending cookie this page sets, and
 * the app lands where the inviter pointed.
 *
 * The browser path is still here — "Just looking? See it in the browser" — as
 * a disclosure holding the account card, in the shape the visitor's situation
 * calls for. `mode` is one of:
 *   'join'    — signed in as the invited address; one button.
 *   'sign-in' — an account with this address exists; go sign in first.
 *   'create'  — no account; choose a password right here.
 * The disclosure opens by itself when there is something to say in it (an
 * error, or signed in as somebody else).
 *
 * `fromName` is the inviter's account NAME (never their e-mail; null before
 * v18 or when they set none). `canvas` is `{ path, name }` for a canvas
 * invitation; `thread` only ever comes with a canvas. The comment's TEXT lives
 * in the project, not here — the page says there is one, it does not quote it.
 */
export function invitePage({
  projectName,
  role,
  mode,
  email,
  inviteId,
  error = null,
  googleEnabled = false,
  signedInAs = null,
  fromName = null,
  canvas = null,
  thread = null,
}) {
  const meaning = ROLE_MEANING[role] ?? '';
  const action = `/invite/${esc(inviteId)}`;
  const next = `/invite/${inviteId}`;
  // Signed in, but as somebody else. Before this said so, the Google button on
  // this page read as broken: one click authenticated you as your OWN Google
  // address, came back here, found no account for the INVITED address, and
  // rendered the identical screen — no message, no hint that a session had just
  // been swapped underneath you. Saying it plainly is the whole fix; the sign-out
  // link is the way out, because you cannot accept this invitation as this person.
  const wrongPerson =
    signedInAs && email && signedInAs.toLowerCase() !== email.toLowerCase() ? signedInAs : null;
  const mismatch = wrongPerson
    ? `<p class="error">You are signed in as <strong>${esc(wrongPerson)}</strong>, but this
         invitation is for <strong>${esc(email)}</strong>. Accepting it needs that address.</p>
       <form method="post" action="/auth/logout" style="margin:0 0 var(--space-5)">
         <input type="hidden" name="next" value="${esc(next)}">
         <button type="submit">Sign out and continue as ${esc(email)}</button>
       </form>
       <p class="quiet">Or ask whoever invited you to send a new invitation
         to ${esc(wrongPerson)}.</p>`
    : '';
  let body = '';
  if (mode === 'join') {
    body = `<form method="post" action="${action}"><button type="submit">Join the project</button></form>`;
  } else if (mode === 'sign-in') {
    body = `<p>You already have a Maude account for <strong>${esc(email)}</strong>.
      Sign in and you'll come straight back here.</p>
      ${googleEnabled ? `${googleButton({ next, wide: true })}<div class="or">or</div>` : ''}
      <p><a class="btn" href="/login?next=${encodeURIComponent(next)}">Sign in</a></p>`;
  } else {
    // Cloud Phase 24 A12b. This screen is the invitee's FIRST contact with
    // Maude, and it used to be the one door in the whole funnel that offered
    // only "invent 12 characters" — while the dashboard's own front door two
    // clicks away offers one click. Worst possible place to drop the easy
    // option, so Google goes ABOVE the password field, not beside it.
    body = `${
      googleEnabled
        ? `${googleButton({ next, wide: true })}
      <p class="quiet" style="margin:var(--space-3) 0 0">Use ${esc(email)} — the address this
        invitation was sent to.</p>
      <div class="or">or</div>`
        : ''
    }<form method="post" action="${action}">
      <label for="password">Choose a password</label>
      <input type="password" id="password" name="password" minlength="12" required
             autocomplete="new-password" placeholder="at least 12 characters">
      <label style="font-weight:400"><input type="checkbox" name="disclosure" value="yes" required>
        I’ve read <a href="/signup" target="_blank">what Maude Cloud stores</a>.</label>
      <p style="margin-top:1rem"><button type="submit">Create account and join</button></p>
    </form>`;
  }
  const who = fromName ? String(fromName) : null;
  const shown = canvas && thread ? thread : null; // a thread only ever with its canvas
  const pointer = canvas
    ? `<div class="card"><strong>${esc(canvas.name)}</strong>
         <span class="quiet">${
           shown
             ? who
               ? `${esc(who)} left a comment for you on this canvas.`
               : 'A comment is waiting for you on this canvas.'
             : 'You’ll open straight onto this canvas.'
}</span></div>`
    : '';
  const arrive = canvas
    ? shown
      ? `You’re on ${esc(canvas.name)}, by ${who ? `${esc(who)}’s` : 'the'} comment`
      : `You’re on ${esc(canvas.name)}`
    : `You’re in ${esc(projectName)}`;
  return publicPage({
    title: who ? `${who} invited you to ${projectName}` : `You’re invited to ${projectName}`,
    sub: meaning,
    // The tab keeps the plain "Join <project>": it is what the page is FOR.
    tab: `Join ${projectName}`,
    body: `<p class="fine">This invitation is for <strong>${esc(email)}</strong>.</p>
     ${pointer ? `<div class="stack">${pointer}</div>` : ''}
     <div class="stack">
       <a class="btn wide" href="${DESKTOP_DOWNLOAD_URL}">Download Maude for Mac</a>
       <a class="btn secondary wide" href="maude://invite/${esc(inviteId)}">Already installed? Open in Maude</a>
     </div>
     <ol class="steps">
       <li>Download and open</li>
       <li>Sign in</li>
       <li>${arrive}</li>
     </ol>
     <details${error || wrongPerson ? ' open' : ''}>
       <summary class="fine">Just looking? See it in the browser — any computer.</summary>
       <h2 style="margin-top:var(--space-5)">Join ${esc(projectName)}</h2>
       ${mismatch}
       ${error ? `<p class="error">${esc(error)}</p>` : ''}
       <div class="card">${body}</div>
     </details>`,
  });
}

/** An invite row (any state) with its project's name, or null. */
async function inviteRow(env, inviteId) {
  if (!INVITE_ID.test(String(inviteId ?? ''))) return null;
  return (
    (await env.DB.prepare(
      `SELECT i.*, p.name AS project_name, p.state AS project_state, p.account_id AS project_owner
         FROM project_invites i
         JOIN projects p ON p.id = i.project_id
        WHERE i.id = ?`
    )
      .bind(inviteId)
      .first()) ?? null
  );
}

const isLive = (row, now) =>
  Boolean(row) &&
  !row.redeemed_at &&
  !row.revoked_at &&
  row.expires_at >= now &&
  row.project_state !== 'purged';

/** Look up an invite and decide whether it can still be used. */
export async function liveInvite(env, inviteId, { now = Date.now() } = {}) {
  const row = await inviteRow(env, inviteId);
  return isLive(row, now) ? row : null;
}

/**
 * The invitation a sign-in hand-off is about, or null: `next=/invite/<id>`, or
 * the app's own `next=/activate?…&invite=<id>` (S6↔S9 §5.1 step 4).
 */
function inviteIdFromNext(next) {
  const raw = String(next ?? '');
  const direct = /^\/invite\/([0-9a-f-]{36})$/.exec(raw);
  if (direct) return direct[1];
  if (!raw.startsWith('/activate?')) return null;
  try {
    const id = new URL(raw, 'https://cloud.invalid').searchParams.get('invite') ?? '';
    return INVITE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The address a sign-in hand-off is FOR, or null.
 *
 * Read by the Google leg so the account chooser opens on the right person, and
 * by the sign-in page to fill in the address. Deliberately derived from the
 * invitation rather than accepted as a query parameter: a `?hint=` anyone can
 * set is a small phishing surface for no gain, and this is the one address the
 * link is actually about. A dead or spent invitation yields null — the sign-in
 * still works, it just does not preselect. The address is never put in a URL.
 */
export async function inviteHintFor(env, next) {
  const id = inviteIdFromNext(next);
  if (!id) return null;
  try {
    return (await liveInvite(env, id))?.email ?? null;
  } catch {
    return null; // a hint is a nicety; never fail sign-in over one
  }
}

/**
 * The `set-cookie` value that remembers an invitation across "install the app,
 * sign in from it" — exactly what `GET /invite/<id>` sets, offered to the
 * `/activate` page the app opens with `&invite=<id>` (S6↔S9 §5.1 step 3). Null
 * for a dead or malformed id: one redemption path, one rule.
 */
export async function pendingInviteCookieFor(env, inviteId, { now = Date.now() } = {}) {
  try {
    const invite = await liveInvite(env, inviteId, { now });
    return invite ? pendingCookie(invite.id, PENDING_INVITE_MS / 1000) : null;
  } catch {
    return null;
  }
}

/**
 * Mark the invite spent FIRST — single use under a race: of two redeems that both read it live, only the one whose
 * `UPDATE … WHERE redeemed_at IS NULL` changed the row goes on — then add the membership (or, for an invitation to
 * one canvas, the grant), never LOWERING what the account already has (V2-1.7 G1: the higher of the two wins), and
 * write the audit line. Returns whether THIS call redeemed it.
 */
async function redeem(env, invite, accountId, { now = Date.now(), ctx = null } = {}) {
  const claimed = await env.DB.prepare(
    'UPDATE project_invites SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL'
  )
    .bind(now, invite.id)
    .run();
  if (!claimed?.meta?.changes) return false;
  if (invite.canvas_path) {
    // A canvas invitation ADDS that canvas and never lowers (V2-1.7 G1).
    await writeGrant(env.DB, {
      projectId: invite.project_id,
      accountId,
      canvas: invite.canvas_path,
      role: invite.role,
      source: 'invite',
      now,
    });
  } else {
    // A project invitation raises the membership and never lowers it; the owner stays the owner.
    await raiseMembership(env.DB, {
      project: { id: invite.project_id, account_id: invite.project_owner ?? null },
      accountId,
      role: invite.role,
      source: 'invite',
      now,
    });
  }
  await audit(env.DB, {
    accountId,
    projectId: invite.project_id,
    actor: `customer:${invite.email}`,
    action: 'invite.redeem',
    detail: JSON.stringify({
      invite: invite.id,
      role: invite.role,
      ...(invite.canvas_path ? { canvas: invite.canvas_path } : {}),
    }),
  });
  // The invite is the product's core action (DDR-193 §5) — worth knowing how
  // often the link actually gets followed, which is the half nobody sees.
  track(env, ctx, { name: 'invite_redeemed', accountId, projectId: invite.project_id });
  return true;
}

/**
 * What an invitation shows, and nothing more: the project's name, the
 * inviter's NAME (never their e-mail), the canvas and the comment thread. The
 * same facts feed the page and `peek`, so the API can never say more than the
 * page a stranger holding the link already sees.
 */
async function inviteFacts(env, invite) {
  let fromName = null;
  if (invite.invited_by) {
    try {
      const who = await env.DB.prepare('SELECT name FROM accounts WHERE id = ?')
        .bind(invite.invited_by)
        .first();
      const name = String(who?.name ?? '').trim();
      fromName = name ? name : null;
    } catch {
      fromName = null; // a name is a nicety (O3: null → "You're invited to …")
    }
  }
  const canvas =
    invite.canvas_path && validCanvasPath(invite.canvas_path)
      ? { path: invite.canvas_path, name: canvasName(invite.canvas_path) }
      : null;
  const thread =
    canvas && typeof invite.thread === 'string' && INVITE_THREAD.test(invite.thread)
      ? invite.thread
      : null;
  return { projectName: invite.project_name, fromName, canvas, thread };
}

/**
 * Where the app should land for one invitation, re-checked against what this
 * account can see NOW: `{ project, canvas?, thread? }`, or null when the claim
 * is gone. A canvas the claim cannot see collapses to `{ project }`; a thread
 * is kept only together with its canvas (S6↔S9 §5.2, invariant 4).
 */
async function checkedLanding(db, { projectId, accountId, canvas, thread }) {
  const { verdict } = await loadClaim(db, projectId, accountId);
  if (!verdict?.ok) return null;
  const access = accessOf(verdict);
  if (canvas && validCanvasPath(canvas) && access.seesCanvas(canvas)) {
    const t = typeof thread === 'string' && INVITE_THREAD.test(thread) ? thread : null;
    return { project: projectId, canvas, ...(t ? { thread: t } : {}) };
  }
  return { project: projectId };
}

/**
 * The "which project first" hint on the device-token reply (S6↔S9 §5.2): the
 * newest invitation this account's address redeemed in the last half hour,
 * re-checked with the claim. Null — key absent — when there is none, when it
 * was revoked, or when the claim no longer holds.
 */
export async function landingAfterSignIn(env, { accountId, email, now = Date.now() }) {
  if (!accountId || !email) return null;
  let row = null;
  try {
    row = await env.DB.prepare(
      `SELECT * FROM project_invites
        WHERE email = ? AND redeemed_at IS NOT NULL AND redeemed_at > ? AND revoked_at IS NULL
        ORDER BY redeemed_at DESC LIMIT 1`
    )
      .bind(String(email).toLowerCase(), now - PENDING_INVITE_MS)
      .first();
  } catch {
    return null; // an unreadable D1 costs the hint, never the sign-in
  }
  if (!row) return null;
  try {
    return await checkedLanding(env.DB, {
      projectId: row.project_id,
      accountId,
      canvas: row.canvas_path ?? null,
      thread: row.thread ?? null,
    });
  } catch {
    return null;
  }
}

// Each on its own budget, keyed per client like every other paid path
// (edge.mjs). `peek` is unauthenticated, so its budget is what keeps a guessed
// id from being cheap to test; `accept` costs a minted code.
const PEEK_RULE = Object.freeze({ limit: 30, windowMs: 60_000, cost: 'invite-peek' });
const ACCEPT_RULE = Object.freeze({ limit: 30, windowMs: 60_000, cost: 'invite-accept' });
const GONE = Object.freeze({ reason: 'gone', error: DEAD_LINK });

function apiJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

/**
 * `GET /api/invites/<id>/peek` (no auth) and `POST /api/invites/<id>/accept`
 * (Bearer `mpt_…`) — the app's half of an invitation (S6↔S9 §5.3).
 *
 * peek → the invite page's facts, or ONE 404 for every id that does not work
 * (wrong, expired, revoked, spent: DEAD_LINK). accept → the invitation redeemed
 * into the account and a one-time handoff code the app trades on the existing
 * link lane; idempotent for the same person for half an hour.
 */
async function handleInviteApi(request, env, { id, verb, ctx, now = Date.now() }) {
  const allowed = verb === 'peek' ? ['GET', 'HEAD'] : ['POST'];
  if (!allowed.includes(request.method)) {
    return apiJson({ reason: 'method' }, 405, { allow: allowed.join(', ') });
  }
  const budget = await spend(env, request, verb === 'peek' ? PEEK_RULE : ACCEPT_RULE, { now });
  if (!budget.ok) {
    return apiJson(
      { reason: 'rate-limited', error: 'Too many attempts. Wait a minute and try again.' },
      429,
      { 'retry-after': '60' }
    );
  }
  let asked = '';
  try {
    asked = decodeURIComponent(id);
  } catch {
    /* a malformed escape is just a wrong id */
  }

  if (verb === 'peek') {
    const invite = await liveInvite(env, asked, { now });
    if (!invite) return apiJson(GONE, 404);
    const facts = await inviteFacts(env, invite);
    return apiJson({
      projectName: facts.projectName,
      fromName: facts.fromName,
      email: invite.email,
      role: invite.role,
      ...(facts.canvas ? { canvas: facts.canvas } : {}),
      ...(facts.thread ? { thread: facts.thread } : {}),
    });
  }

  // ---- accept
  const bearer = await personalTokenAccount(env, request, { now });
  if (!bearer) return apiJson({ reason: 'signed-out' }, 401);
  const row = await inviteRow(env, asked);
  const live = isLive(row, now);
  const mine =
    Boolean(row) &&
    typeof bearer.email === 'string' &&
    row.email.toLowerCase() === bearer.email.toLowerCase();
  // Idempotent for the SAME person: redeemed by this address in the last half
  // hour (every redeem path checks the address, so "this address" is "this
  // person") answers again with a fresh code. Spent by anybody else → gone.
  const again =
    !live &&
    mine &&
    Boolean(row.redeemed_at) &&
    !row.revoked_at &&
    row.redeemed_at > now - PENDING_INVITE_MS &&
    row.project_state !== 'purged';
  if (!live && !again) return apiJson(GONE, 404);
  if (!mine) return apiJson({ reason: 'other-account', email: row.email }, 403);
  // A canvas-scoped invitation is a v2 claim; an app that does not declare v2
  // must update first — refused BEFORE anything is redeemed.
  if (row.canvas_path && declaredAccessOf(request.headers.get('x-maude-access')) !== 2) {
    return apiJson(ACCESS_VERSION_REFUSAL, 426);
  }
  if (live) await redeem(env, row, bearer.id, { now, ctx });
  const minted = await mintHandoffCode(env, {
    account: bearer,
    projectId: row.project_id,
    now,
    surface: 'app',
    declaredAccess: 2,
    canvas: row.canvas_path ?? null,
  });
  if (!minted.ok) return apiJson(GONE, 404);
  const landing = (await checkedLanding(env.DB, {
    projectId: row.project_id,
    accountId: bearer.id,
    canvas: row.canvas_path ?? null,
    thread: row.thread ?? null,
  })) ?? { project: row.project_id };
  return apiJson({ code: minted.code, landing });
}

// ---------------------------------------------------- pending, by address
//
// gate-b-sec3 finding 1: an invitation to an address that already has an account is no longer applied on the spot
// — it waits, like any other, until that person accepts. Home lists the ones addressed to the signed-in account
// ("Shared with you", accept / leave) WITHOUT the invite id: the account's own address is the key, a project (and
// canvas) names which one, so the bearer secret never reaches Home's state, DOM or URL.

const PENDING_COLS = `i.id, i.project_id, i.role, i.canvas_path, i.created_at, i.thread, i.email,
       p.name AS project_name, p.state AS project_state, p.account_id AS project_owner`;

/** Live invitations addressed to `email`, newest first (raw rows). */
async function pendingRows(db, email, now) {
  const where = `FROM project_invites i JOIN projects p ON p.id = i.project_id
     WHERE i.email = ? AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at >= ?
       AND p.state != 'purged'
     ORDER BY i.created_at DESC LIMIT 100`;
  const addr = String(email ?? '').toLowerCase();
  try {
    return (
      (
        await db
          .prepare(
            `SELECT ${PENDING_COLS}, i.invited_by, a.name AS from_name ${where.replace(
              'JOIN projects p ON p.id = i.project_id',
              'JOIN projects p ON p.id = i.project_id LEFT JOIN accounts a ON a.id = i.invited_by'
            )}`
          )
          .bind(addr, now)
          .all()
      )?.results ?? []
    );
  } catch {
    // a v17 D1: no `invited_by` / `thread` yet — no inviter name
    return (
      (
        await db
          .prepare(
            `SELECT i.id, i.project_id, i.role, i.canvas_path, i.created_at, NULL AS thread, i.email,
                    p.name AS project_name, p.state AS project_state, p.account_id AS project_owner,
                    NULL AS from_name ${where}`
          )
          .bind(addr, now)
          .all()
      )?.results ?? []
    );
  }
}

const sameScope = (row, projectId, canvas) =>
  row.project_id === projectId && (row.canvas_path ?? null) === (canvas ?? null);

/**
 * Home's "invited" rows for one account: `[{ projectId, projectName, fromName, canvas, role, invitedAt }]` — one per
 * project + canvas (the newest), names never e-mails, never an invite id. The owner's own project never lists.
 */
export async function pendingInvitesFor(env, account, { now = Date.now() } = {}) {
  if (!account?.email) return [];
  let rows = [];
  try {
    rows = await pendingRows(env.DB, account.email, now);
  } catch {
    return []; // an unreadable D1 costs the list, never Home
  }
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r.project_owner === account.id) continue;
    const key = `${r.project_id}\u0000${r.canvas_path ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const canvas =
      r.canvas_path && validCanvasPath(r.canvas_path)
        ? { path: r.canvas_path, name: canvasName(r.canvas_path) }
        : null;
    if (r.canvas_path && !canvas) continue;
    const name = String(r.from_name ?? '').trim();
    out.push({
      projectId: r.project_id,
      projectName: r.project_name,
      fromName: name || null,
      canvas,
      role: r.role,
      invitedAt: r.created_at ?? null,
    });
  }
  return out;
}

const PENDING_RULE = Object.freeze({ limit: 30, windowMs: 60_000, cost: 'invite-accept' });

/**
 * `POST /api/invites/pending/accept|leave` (Bearer `mpt_…`, JSON `{ projectId, canvas? }`) — Home's accept / leave
 * for an invitation addressed to the signed-in account. accept → the newest live one for that project + canvas
 * redeemed (never lowering, G1) and a one-time handoff code + landing, as `/api/invites/<id>/accept`; leave → every
 * live one for that project + canvas declined. Bearer only: no cookie, so no page elsewhere can press either.
 */
async function handlePendingApi(request, env, { verb, ctx, now = Date.now() }) {
  if (request.method !== 'POST') return apiJson({ reason: 'method' }, 405, { allow: 'POST' });
  const budget = await spend(env, request, PENDING_RULE, { now });
  if (!budget.ok) {
    return apiJson(
      { reason: 'rate-limited', error: 'Too many attempts. Wait a minute and try again.' },
      429,
      { 'retry-after': '60' }
    );
  }
  const bearer = await personalTokenAccount(env, request, { now });
  if (!bearer?.id || !bearer.email) return apiJson({ reason: 'signed-out' }, 401);
  let body = {};
  try {
    const b = await request.json();
    body = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch {
    body = {};
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const canvas = body.canvas ?? null;
  if (!projectId || projectId.length > 128 || (canvas !== null && !validCanvasPath(canvas))) {
    return apiJson(GONE, 404);
  }
  const rows = (await pendingRows(env.DB, bearer.email, now)).filter((r) =>
    sameScope(r, projectId, canvas)
  );
  if (!rows.length) return apiJson(GONE, 404);

  if (verb === 'leave') {
    for (const r of rows) {
      await env.DB.prepare(
        'UPDATE project_invites SET revoked_at = ? WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL'
      )
        .bind(now, r.id)
        .run();
    }
    await audit(env.DB, {
      accountId: bearer.id,
      projectId,
      actor: `customer:${bearer.email}`,
      action: 'invite.decline',
      detail: JSON.stringify({ count: rows.length, ...(canvas ? { canvas } : {}) }),
    });
    return apiJson({ ok: true });
  }

  const row = rows[0];
  if (row.canvas_path && declaredAccessOf(request.headers.get('x-maude-access')) !== 2) {
    return apiJson(ACCESS_VERSION_REFUSAL, 426);
  }
  if (!(await redeem(env, row, bearer.id, { now, ctx }))) return apiJson(GONE, 404);
  const minted = await mintHandoffCode(env, {
    account: bearer,
    projectId: row.project_id,
    now,
    surface: 'app',
    declaredAccess: 2,
    canvas: row.canvas_path ?? null,
  });
  if (!minted.ok) return apiJson(GONE, 404);
  const landing = (await checkedLanding(env.DB, {
    projectId: row.project_id,
    accountId: bearer.id,
    canvas: row.canvas_path ?? null,
    thread: row.thread ?? null,
  })) ?? { project: row.project_id };
  return apiJson({ code: minted.code, landing });
}

/**
 * Route `/invite/<id>`. Returns a Response, or null when the path is not ours.
 *
 * @param {{ account: {id: string, email: string} | null }} ctx  the signed-in
 *   account, resolved by the caller the same way every surface resolves it.
 */
export async function handleInviteRoutes(request, env, { account, ctx = null } = {}) {
  const url = new URL(request.url);
  const pendingApi = /^\/api\/invites\/pending\/(accept|leave)$/.exec(url.pathname);
  if (pendingApi) return handlePendingApi(request, env, { verb: pendingApi[1], ctx });
  const api = /^\/api\/invites\/([^/]+)\/(peek|accept)$/.exec(url.pathname);
  if (api) return handleInviteApi(request, env, { id: api[1], verb: api[2], ctx });

  const m = url.pathname.match(/^\/invite\/([^/]+)$/);
  if (!m) return null;

  let asked = '';
  try {
    asked = decodeURIComponent(m[1]);
  } catch {
    /* a malformed escape is just a wrong id */
  }
  const invite = await liveInvite(env, asked);
  if (!invite) return html(deadInvitePage(), 404);

  const view = {
    ...(await inviteFacts(env, invite)),
    role: invite.role,
    email: invite.email,
    inviteId: invite.id,
    googleEnabled: googleConfigured(env),
    signedInAs: account?.email ?? null,
  };
  const existing = await getAccountByEmail(env.DB, invite.email);
  const signedInAsInvitee = account && existing && account.id === existing.id;
  const mode = signedInAsInvitee ? 'join' : existing ? 'sign-in' : 'create';

  if (request.method === 'GET') {
    // Remember the invitation across "install the app, sign in from it".
    return html(invitePage({ ...view, mode }), 200, {
      'set-cookie': pendingCookie(invite.id, PENDING_INVITE_MS / 1000),
    });
  }
  if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);

  if (mode === 'join') {
    await redeem(env, invite, account.id, { ctx });
    return new Response(null, { status: 303, headers: { location: '/' } });
  }

  if (mode === 'sign-in') {
    // A POST in this state is a stale form or a probe — either way, the answer
    // is the same page that says to sign in first.
    return html(invitePage({ ...view, mode }), 409);
  }

  const form = await request.formData();
  if (form.get('disclosure') !== 'yes') {
    return html(
      invitePage({ ...view, mode, error: 'Please confirm you’ve read what Maude Cloud stores.' }),
      400
    );
  }
  let created;
  try {
    created = await createAccount(env.DB, {
      email: invite.email,
      password: String(form.get('password') ?? ''),
      // The invitation was mailed to THIS address and is single-use, so
      // redeeming it proves the same thing a verification link proves. Not
      // recording that (RCA 2026-08-04) barred every invited teammate from
      // Google sign-in forever — `accountForGoogle` refuses an unverified
      // password account, and nothing else here could ever clear the flag.
      emailVerified: true,
    });
  } catch {
    return html(
      invitePage({ ...view, mode, error: 'That didn’t work — use at least 12 characters.' }),
      400
    );
  }
  await env.DB.prepare('UPDATE accounts SET disclosure_accepted_at = ? WHERE id = ?')
    .bind(Date.now(), created.id)
    .run();
  track(env, ctx, { name: 'signup', accountId: created.id, props: { method: 'invite' } });
  await redeem(env, invite, created.id, { ctx });
  const session = await createSession(env.DB, created.id);
  return new Response(null, {
    status: 303,
    headers: {
      location: '/',
      'set-cookie': `maude_session=${session.token}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax; Secure; HttpOnly`,
    },
  });
}

/**
 * Sign-in redeems a pending invitation (S9 Q6). Call it once a session exists
 * for `account`. Only an invitation addressed to THIS account's e-mail is
 * redeemed — the cookie is a reminder, never a credential. Returns the
 * `set-cookie` value that clears the reminder (whatever happened), and the
 * invitation when it was redeemed.
 */
export async function redeemPendingInvite(
  env,
  request,
  account,
  { now = Date.now(), ctx = null } = {}
) {
  const cookie = request.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${PENDING_INVITE_COOKIE}=([0-9a-f-]{36})(?:;|$)`).exec(cookie);
  if (!m) return { redeemed: null, clear: null };
  const clear = pendingCookie('', 0);
  if (!account?.email) return { redeemed: null, clear };
  let invite = null;
  try {
    invite = await liveInvite(env, m[1], { now });
  } catch {
    return { redeemed: null, clear };
  }
  if (!invite || invite.email.toLowerCase() !== account.email.toLowerCase()) {
    return { redeemed: null, clear };
  }
  await redeem(env, invite, account.id, { now, ctx });
  return { redeemed: { id: invite.id, project: invite.project_id }, clear };
}

/**
 * Where an invitation redeemed in the last half hour should land the app:
 * `{ project, canvas? }`, or null. Read at handoff mint (S9 Q6).
 */
export async function landingForInvite(db, { email, projectId, now = Date.now() }) {
  if (!email) return null;
  const since = now - PENDING_INVITE_MS;
  let row = null;
  try {
    row = await db
      .prepare(
        `SELECT canvas_path FROM project_invites
          WHERE project_id = ? AND email = ? AND redeemed_at IS NOT NULL AND redeemed_at > ?
          ORDER BY redeemed_at DESC LIMIT 1`
      )
      .bind(projectId, email.toLowerCase(), since)
      .first();
  } catch {
    return null; // v16 D1 (no canvas_path yet): no landing, nothing else changes
  }
  if (!row) return null;
  return { project: projectId, ...(row.canvas_path ? { canvas: row.canvas_path } : {}) };
}

/** Every customer-facing string here, for the vocabulary lint. */
export function allInviteHtml() {
  const base = { projectName: 'Brno Alligators', inviteId: 'x'.repeat(36), googleEnabled: true };
  return [
    invitePage({ ...base, role: 'member', mode: 'create', email: 'new@example.com' }),
    invitePage({ ...base, role: 'viewer', mode: 'sign-in', email: 'old@example.com' }),
    invitePage({ ...base, role: 'member', mode: 'join', email: 'me@example.com' }),
    invitePage({
      ...base,
      role: 'member',
      mode: 'create',
      email: 'n@example.com',
      error: 'Please confirm you’ve read what Maude Cloud stores.',
    }),
    invitePage({
      ...base,
      role: 'viewer',
      mode: 'create',
      email: 'jonas@example.com',
      fromName: 'Tereza',
      canvas: { path: 'brand/Combine-kampan.tsx', name: 'Combine-kampan' },
      thread: 't-1',
    }),
    invitePage({
      ...base,
      role: 'observer',
      mode: 'create',
      email: 'jonas@example.com',
      canvas: { path: 'brand/Poster.tsx', name: 'Poster' },
    }),
    deadInvitePage(),
  ].join('\n');
}
