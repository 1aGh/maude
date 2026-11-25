// The invite landing page — what a person SEES when they open `/join/<token>`.
//
// Cloud Phase 6 built the server half of the magic-link path (mint, look,
// redeem) and left the client half to a `maude://` desktop deep link that was
// never built. Until 2026-08-21 a browser opening the link got the LOOK
// endpoint's JSON — `{"ok":true,"workspace":…,"needsEmail":false,…}` — and
// nothing else: no words, no form, no way in. The persona this path exists
// for (DDR-193 §5: the invited teammate who has never used git) read raw JSON.
//
// Since Cloud Phase 25 (E2) the studio is a browser page at `/` behind a
// cookie session, so the landing page redeems IN THE BROWSER: one form, one
// POST, and the person is in the studio. No desktop required.
//
// Words per the v2 CONTRACT §3–§4 (Maude v2 S9.14): a self-hosted hub is a
// "project" to the person reading this, never a "workspace", and the page
// names no protocol ("identity provider") and never says "we".
//
// Server-rendered and script-free, like `signInPage` and `servicePage`: this
// is the first thing a newcomer sees, and a page that needs a bundle to show
// a form is a page that can fail to show it.
//
// The raw token appears here exactly once — as the form's hidden field, so
// the redeem is a POST body and never a URL the browser navigates away from
// (Referer headers, proxy logs). The page is `no-store`.
//
// THE PROVIDER BUTTON CARRIES THE INVITE. It used to be the shared sign-in
// link (`<a href="/auth/oidc/start">`), which dropped the invitation: the
// person signed in, had no account, and waited in the pending queue for an
// admin. It is a second FORM now — a POST with the same hidden field — so the
// invite reaches the callback inside the signed transaction cookie and is the
// approval (oidc-routes.mjs `resolveVerified`). Still never a URL.

import { escapeHtml as esc, oidcLabel, webPage } from './studio-door.mjs';
import { MIN_PASSWORD_LENGTH } from './users.mjs';

/** A hostname for the heading — `https://design.acme.com/` → `design.acme.com`. */
function workspaceName(workspace) {
  if (!workspace) return 'this project';
  const raw = String(workspace);
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw;
  }
}

/** The provider button for an invite: a POST that carries the invite, never a link. */
function providerForm(token, env, { switchAccount = false, label = null } = {}) {
  const name = oidcLabel(env);
  if (!name) return '';
  return `<form method="post" action="/auth/oidc/start">
  <input type="hidden" name="invite" value="${esc(token)}">${
    switchAccount ? '<input type="hidden" name="switch" value="1">' : ''
  }
  <button type="submit" class="btn btn--primary btn--lg" data-testid="join-provider">${esc(label ?? `Continue with ${name}`)}</button>
</form>`;
}

/**
 * "This invitation is for someone else" — the provider said who is signed in,
 * and it is not the address the invitation names. Nothing was used up: the
 * button signs in again and asks the provider to choose the account.
 */
export function inviteMismatchPage({ token, inviteEmail, email, env = process.env }) {
  return webPage({
    title: 'This invitation is for another address',
    heading: `This invitation is for ${esc(inviteEmail)}`,
    sub: `You signed in as <strong>${esc(email)}</strong>. The invitation still works — sign in with <strong>${esc(inviteEmail)}</strong> to use it.`,
    testid: 'join-mismatch',
    body: providerForm(token, env, { switchAccount: true, label: 'Use another account' }),
  });
}

/**
 * The welcome + redeem form.
 *
 * @param {object} args
 * @param {string}      args.token       the raw invite value (goes into the hidden field, nowhere else)
 * @param {string|null} args.workspace   the hub's public URL
 * @param {string|null} args.email       the address the invite is bound to, or null for an open invite
 * @param {string|null} [args.error]     one plain sentence to show above the button
 * @param {object}      [args.env]
 * @param {boolean}     [args.desktop]   the Maude app opened this invite (issue #204 K2): after the
 *                                       redeem the person goes back to the app, not the browser studio
 */
export function joinPage({
  token,
  workspace,
  email,
  error = null,
  env = process.env,
  desktop = false,
  hubName = null,
  description = null,
  inviter = null,
  role = null,
}) {
  const name = hubName || workspaceName(workspace);
  const oidc = providerForm(token, env);
  const passwordsRefused = env.HUB_OIDC_MODE === 'strict';
  const heading = inviter
    ? `${esc(inviter)} invited you to ${esc(name)}`
    : `You're invited to ${esc(name)}`;
  const who = inviter
    ? `<span class="k-av k-av--${tone(inviter)}" aria-hidden="true">${esc(inviter.charAt(0))}</span>`
    : '';
  const roleChip = role
    ? `<span class="ma-web-role" data-testid="join-role">${role === 'admin' ? 'You will be an Admin' : 'You can edit'}</span>`
    : '';
  const err = error ? `<p class="ma-web-err" role="alert">${esc(error)}</p>` : '';
  const app = desktop
    ? '<p class="ma-web-fine" data-desktop>After you join, you go back to the Maude app.</p>'
    : workspace
      ? `<p class="ma-web-fine" data-desktop>Using the Maude app? After you join, choose <b>Open a project you were invited to</b> and sign in with <b>${esc(String(workspace))}</b> and this email.</p>`
      : '';

  // Under `strict` the hub refuses passwords outright (`cloud-identity`), so an
  // account this form would create could never sign in again once the first
  // session expires. Same rule `signInPage` keeps: strict renders the provider
  // link alone, and says so.
  if (passwordsRefused) {
    return webPage({
      title: `Join ${name}`,
      heading,
      who,
      sub: `${workspace || hubName ? esc(name) : 'This project'} signs people in through its own sign-in page. Sign in there${
        email ? ` with <strong>${esc(email)}</strong>` : ''
      } and you're in — the invitation is all you need.`,
      body: `${roleChip}${err}${oidc}`,
    });
  }
  const passwordLine = email
    ? `Choose a password and you're in — no download, no setup. Already have an account on this project? Enter its password instead.`
    : `Choose a password and you're in — no download, no setup.`;
  // The provider, when there is one, is the way in (the invite rides through it — design canvas 16,
  // ts-invitee step 1); a password is the other way, under "or".
  const form = `<form class="ma-web-form" method="post" action="/join" autocomplete="on">
  <input type="hidden" name="token" value="${esc(token)}">
  <label class="field" for="email"><span class="field-label">Email</span>${
    email
      ? `<input class="input" id="email" name="email" type="email" value="${esc(email)}" readonly autocomplete="username">`
      : `<input class="input" id="email" name="email" type="email" autocomplete="username" required${oidc ? '' : ' autofocus'} placeholder="you@example.com">`
  }</label>
  <label class="field" for="password"><span class="field-label">${email ? 'Password' : 'Choose a password'}</span>
  <input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required${
    email && !oidc ? ' autofocus' : ''
  }>
  <span class="field-hint">${
    email
      ? `New here: at least ${MIN_PASSWORD_LENGTH} characters. You'll use it to sign in next time.`
      : `At least ${MIN_PASSWORD_LENGTH} characters. You'll use it to sign in next time.`
  }</span></label>
  ${err}
  <button type="submit" class="btn btn--lg${oidc ? '' : ' btn--primary'}">Join ${esc(name)}</button>
</form>`;
  return webPage({
    title: `Join ${name}`,
    heading,
    who,
    sub: oidc ? esc(description || workspaceName(workspace)) : passwordLine,
    body: `${roleChip}${
      oidc
        ? `${oidc}${email ? `<p class="ma-web-fine">Use ${esc(email)} — that's who the invitation is for.</p>` : ''}<p class="ma-web-or">or</p><p class="ma-web-fine">${passwordLine}</p>`
        : ''
    }${form}${app}`,
  });
}

/** The avatar's colour from a name — the same five tones the admin page uses. */
function tone(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 5;
}
