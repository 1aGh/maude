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

import { writeGrant } from './access-forward.mjs';
import { createAccount, createSession, getAccountByEmail } from './accounts.mjs';
import { track } from './analytics.mjs';
import { GOOGLE_BUTTON_CSS, googleButton, lockup, PAGE_CSS } from './brand.mjs';
import { audit } from './db.mjs';
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

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Maude</title><style>${PAGE_CSS}${GOOGLE_BUTTON_CSS}\n  main { max-width: 26rem; }</style></head><body><main>${lockup()}${body}</main></body></html>`;
}

function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      'referrer-policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

const ROLE_MEANING = {
  observer: 'You’ll be able to look at the work.',
  viewer: 'You’ll be able to look at the work and leave comments.',
  member: 'You’ll be able to design and edit alongside the team.',
};

/**
 * The invitation page, in the shape the visitor's situation calls for.
 *
 * `mode` is one of:
 *   'join'    — signed in as the invited address; one button.
 *   'sign-in' — an account with this address exists; go sign in first.
 *   'create'  — no account; choose a password right here.
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
  return page(
    `Join ${projectName}`,
    `<h1>Join ${esc(projectName)}</h1>
     <p class="quiet">This invitation is for <strong>${esc(email)}</strong>. ${esc(meaning)}</p>
     ${mismatch}
     ${error ? `<p class="error">${esc(error)}</p>` : ''}
     <div class="card">${body}</div>`
  );
}

/** Look up an invite and decide whether it can still be used. */
async function liveInvite(env, inviteId, { now = Date.now() } = {}) {
  if (!/^[0-9a-f-]{36}$/.test(inviteId)) return null;
  const row = await env.DB.prepare(
    `SELECT i.*, p.name AS project_name FROM project_invites i
       JOIN projects p ON p.id = i.project_id
      WHERE i.id = ?`
  )
    .bind(inviteId)
    .first();
  if (!row) return null;
  if (row.redeemed_at || row.revoked_at || row.expires_at < now) return null;
  return row;
}

/**
 * The address a `next=/invite/<id>` hand-off is FOR, or null.
 *
 * Read by the Google leg so the account chooser opens on the right person.
 * Deliberately derived from the invitation rather than accepted as a query
 * parameter: a `?hint=` anyone can set is a small phishing surface for no gain,
 * and this is the one address the link is actually about. A dead or spent
 * invitation yields null — the sign-in still works, it just does not preselect.
 */
export async function inviteHintFor(env, next) {
  const m = /^\/invite\/([0-9a-f-]{36})$/.exec(next ?? '');
  if (!m) return null;
  try {
    return (await liveInvite(env, m[1]))?.email ?? null;
  } catch {
    return null; // a hint is a nicety; never fail sign-in over one
  }
}

/**
 * Add the membership (or, for an invitation to one canvas, the grant), mark
 * the invite spent, and write the audit line.
 */
async function redeem(env, invite, accountId, { now = Date.now(), ctx = null } = {}) {
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
    await env.DB.prepare(
      `INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, account_id) DO UPDATE SET role = excluded.role`
    )
      .bind(invite.project_id, accountId, invite.role, now)
      .run();
  }
  await env.DB.prepare('UPDATE project_invites SET redeemed_at = ? WHERE id = ?')
    .bind(now, invite.id)
    .run();
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
}

/**
 * Route `/invite/<id>`. Returns a Response, or null when the path is not ours.
 *
 * @param {{ account: {id: string, email: string} | null }} ctx  the signed-in
 *   account, resolved by the caller the same way every surface resolves it.
 */
export async function handleInviteRoutes(request, env, { account, ctx = null } = {}) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/invite\/([^/]+)$/);
  if (!m) return null;

  const invite = await liveInvite(env, decodeURIComponent(m[1]));
  if (!invite) return html(page('Invitation', `<h1>Invitation</h1><p>${DEAD_LINK}</p>`), 404);

  const view = {
    projectName: invite.project_name,
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
    page('Invitation', `<h1>Invitation</h1><p>${DEAD_LINK}</p>`),
  ].join('\n');
}
