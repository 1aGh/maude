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
// Server-rendered and script-free, like `signInPage` and `servicePage`: this
// is the first thing a newcomer sees, and a page that needs a bundle to show
// a form is a page that can fail to show it.
//
// The raw token appears here exactly once — as the form's hidden field, so
// the redeem is a POST body and never a URL the browser navigates away from
// (Referer headers, proxy logs). The page is `no-store`.

import { escapeHtml as esc, oidcButton } from './studio-door.mjs';
import { MIN_PASSWORD_LENGTH } from './users.mjs';

/** A hostname for the heading — `https://design.acme.com/` → `design.acme.com`. */
function workspaceName(workspace) {
  if (!workspace) return 'this workspace';
  const raw = String(workspace);
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw;
  }
}

const STYLE = `
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0e1014; color:#e9ecf3;
         font:15px/1.6 -apple-system, system-ui, sans-serif; padding:24px; }
  main { width:min(24rem, 100%); }
  h1 { font-size:1.3rem; margin:0 0 .4rem; }
  p { margin:0 0 .6rem; color:#b7bdcc; }
  label { display:block; font-size:12px; color:#828b9e; margin:12px 0 4px; }
  input { width:100%; padding:9px 11px; border-radius:9px; border:1px solid #262c38;
          background:#14171d; color:inherit; font:inherit; box-sizing:border-box; }
  input[readonly] { color:#b7bdcc; }
  .hint { font-size:12px; color:#828b9e; margin:4px 0 0; }
  button { margin-top:16px; width:100%; padding:10px; border:0; border-radius:9px;
           background:#7a86f8; color:#0f1020; font:inherit; font-weight:650; cursor:pointer; }
  .err { color:#f0a3a3; font-size:13px; margin-top:10px; }
  .button { display:block; margin-top:16px; padding:10px; border-radius:9px; text-align:center;
            border:1px solid #262c38; background:#14171d; color:inherit; text-decoration:none; font-weight:600; }
  .or { margin:18px 0 0; text-align:center; font-size:12px; color:#828b9e; }
`;

/**
 * The welcome + redeem form.
 *
 * @param {object} args
 * @param {string}      args.token       the raw invite value (goes into the hidden field, nowhere else)
 * @param {string|null} args.workspace   the hub's public URL
 * @param {string|null} args.email       the address the invite is bound to, or null for an open invite
 * @param {string|null} [args.error]     one plain sentence to show above the button
 * @param {object}      [args.env]
 */
export function joinPage({ token, workspace, email, error = null, env = process.env }) {
  const name = workspaceName(workspace);
  const oidc = oidcButton(env);
  const passwordsRefused = env.HUB_OIDC_MODE === 'strict';

  // Under `strict` the hub refuses passwords outright (`cloud-identity`), so an
  // account this form would create could never sign in again once the first
  // session expires. Same rule `signInPage` keeps: strict renders the provider
  // link alone, and says so.
  const body = passwordsRefused
    ? `<h1>You're invited to ${esc(name)}</h1>
  <p>This workspace signs people in through its identity provider. Sign in there${
    email ? ` with <strong>${esc(email)}</strong>` : ''
  } and whoever invited you will see you arrive.</p>
  ${oidc}`
    : `<form method="post" action="/join" autocomplete="on">
  <h1>You're invited to ${esc(name)}</h1>
  <p>Choose a password and you're in — no download, no setup.</p>
  <input type="hidden" name="token" value="${esc(token)}">
  <label for="email">Email</label>
  ${
    email
      ? `<input id="email" name="email" type="email" value="${esc(email)}" readonly autocomplete="username">`
      : `<input id="email" name="email" type="email" autocomplete="username" required autofocus placeholder="you@example.com">`
  }
  <label for="password">Choose a password</label>
  <input id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required${
    email ? ' autofocus' : ''
  }>
  <p class="hint">At least ${MIN_PASSWORD_LENGTH} characters. You'll use it to sign in next time.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <button type="submit">Join ${esc(name)}</button>
  ${oidc ? `<p class="or">or</p>${oidc}` : ''}
  ${
    workspace
      ? `<p class="hint" data-desktop>Using the Maude desktop app? After you join, choose <b>Open a project you were invited to</b> and sign in with <b>${esc(String(workspace))}</b> and this email.</p>`
      : ''
  }
</form>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>Join ${esc(name)}</title>
<style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}
