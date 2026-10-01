// The browser door — Cloud Phase 27 A2, under DDR-209.
//
// WHAT THIS FILE USED TO BE. `canvas/routes.mjs` served a studio: it rendered a
// page, listed canvases, built modules, wrote comments and applied edits — 469
// lines of studio-page plus five supporting modules, against a real client of
// 15,073. The owner opened his own project in a browser and found a different,
// poorer application than the one on his desktop.
//
// WHAT IT IS NOW. A door. It decides three things and forwards everything else
// to the real studio running on loopback:
//
//   1. is rendering paused for this tenant (the on-call kill switch, A3);
//   2. is this request for the SHELL origin or the CANVAS origin (DDR-054);
//   3. is there a session — and if not, where does this person sign in.
//
// It renders exactly two things, both of which are pages a studio cannot serve
// because the studio is not the thing that is wrong: "paused" and "signing in".

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { designRootFor } from './design-root.mjs';

/**
 * THE KILL SWITCH (Phase 25 A3).
 *
 * Per-tenant, not fleet-wide: an incident in one project must not take
 * everybody's door off its hinges, and a switch that costs everyone is a
 * switch nobody dares use. Two ways to throw it, because the two hands that
 * reach for it are different:
 *
 *   MAUDE_RENDER_DISABLED=1        the cell's own env (operator, needs a restart)
 *   <repo>/../.render-off          a file in the tenant's volume (on-call, instant)
 *
 * Reading a file per request is deliberate: during an incident the person
 * needs it to take effect NOW, not after a container restart they then have to
 * wait out.
 */
export function renderDisabled(env = process.env) {
  if (env.MAUDE_RENDER_DISABLED === '1') return 'operator';
  const repoDir = env.MAUDE_REPO_DIR;
  if (repoDir && existsSync(join(repoDir, '..', '.render-off'))) return 'on-call';
  if (repoDir && existsSync(join(repoDir, '.render-off'))) return 'on-call';
  return null;
}

/** The origin the canvas iframe loads from. */
export function canvasOriginFor(request, env = process.env) {
  const explicit = env.MAUDE_CANVAS_ORIGIN ?? env.MAUDE_PUBLIC_CANVAS_ORIGIN;
  if (explicit) return { origin: explicit.replace(/\/+$/, ''), separate: true, prefix: '' };
  const host = request?.headers?.host ?? '';
  const zone = env.CELL_ZONE;
  const tenant = env.MAUDE_TENANT_ID;
  if (zone && tenant && host.endsWith(`.${zone}`)) {
    // ONE shared canvas hostname for the whole fleet, tenant in the path. A
    // per-tenant canvas hostname would be a second custom domain to provision,
    // delete and reconcile for every project — more moving parts for the same
    // origin boundary.
    return { origin: `https://canvas.${zone}`, separate: true, prefix: `/${tenant}` };
  }
  return { origin: '', separate: false, prefix: '' };
}

/**
 * Did this request arrive on the segregated canvas origin?
 *
 * TOLD FIRST, INFERRED SECOND. The data plane knows the answer — it routed the
 * request — and says so with `x-maude-canvas-origin`, which it also strips from
 * every request on the project hostname so it cannot be forged from outside.
 *
 * The Host fallback exists for the deployment with no Worker in front (a
 * self-hoster who has pointed a second hostname at their hub). It is a FALLBACK
 * because it is the thing that was wrong: after a request has crossed a Durable
 * Object and a container proxy, `Host` is not the name the browser typed, so
 * every canvas request fell through to the shell lane and was answered with
 * "sign in to open this project" — to an iframe that has no cookie and never
 * will, since a cookie able to reach this origin is precisely what DDR-054
 * exists to prevent.
 *
 * Both signals are honoured rather than one replacing the other: they are true
 * in different deployments, and a check that needs to know which one it is in
 * is a check that gets it wrong in the third.
 */
export const CANVAS_ORIGIN_HEADER = 'x-maude-canvas-origin';

export function isCanvasHost(request, env = process.env) {
  if (request?.headers?.[CANVAS_ORIGIN_HEADER] === '1') return true;
  const host = (request?.headers?.host ?? '').toLowerCase();
  const zone = env.CELL_ZONE;
  if (zone && host === `canvas.${zone}`) return true;
  const explicit = env.MAUDE_PUBLIC_CANVAS_ORIGIN ?? env.MAUDE_CANVAS_ORIGIN;
  if (!explicit) return false;
  try {
    return host === new URL(explicit).host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Paths the HUB answers itself. Everything else on the shell origin belongs to
 * the studio.
 *
 * An ALLOWLIST of hub-owned prefixes rather than a list of studio paths, and
 * that direction is deliberate: the studio's route table grows every phase and
 * the hub's does not. Getting it the other way round would mean every new studio
 * feature is invisible in the cloud until someone remembers this file — which is
 * a fair description of how Phase 25 ended up with a hand-written page.
 */
export const HUB_OWNED = Object.freeze([
  '/health',
  '/admin',
  '/auth/',
  '/join',
  '/invites',
  '/assets/',
  '/api/export',
  '/.well-known/',
]);

export function isHubOwned(pathname) {
  return HUB_OWNED.some((p) =>
    p.endsWith('/')
      ? pathname.startsWith(p)
      : pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`)
  );
}

/**
 * Decide what happens to one shell-origin request, short of forwarding it.
 *
 * Returns `null` when the caller should proxy. Kept separate from the doing so
 * the ordering — pause, then project-presence, then session — is one readable
 * thing rather than four early returns inside an HTTP handler.
 */
export function doorVerdict({ request, pathname, env = process.env, session }) {
  const off = renderDisabled(env);
  if (off) return { kind: 'paused', by: off };

  const designRoot = designRootFor(env);
  if (!designRoot || !existsSync(designRoot)) return { kind: 'no-project' };

  if (!session) return { kind: 'sign-in', to: signInUrl({ request, env, pathname }) };
  return null;
}

/**
 * Where an unauthenticated browser goes to sign in.
 *
 * The address the CUSTOMER is at — never the Host header. Behind the outbound
 * tunnel the Host is the tunnel's internal hostname, and a Host-derived return
 * URL sent a member to an address that was not their project's. Twice, in
 * production. `HUB_PUBLIC_URL` is what the control plane sets to the
 * customer-facing name; the header is only a fallback for a hub that has none.
 */
export function signInUrl({ request, env = process.env }) {
  // BOTH, or neither. The tenant id alone used to be the switch, with the
  // control-plane address defaulted to cloud.maude.sh — so a hub that had a
  // tenant id for its own reasons (asset key prefix, namespacing) and no
  // dashboard URL would send every unauthenticated visitor to the vendor's
  // SaaS to sign in for a project the SaaS does not host. Requiring the
  // address to be CONFIGURED is the same rule the landing page keeps.
  const dashboard = env.HUB_DASHBOARD_URL;
  const tenant = env.MAUDE_TENANT_ID;
  const publicBase = (env.HUB_PUBLIC_URL ?? '').replace(/\/+$/, '');
  const back = `${publicBase || `https://${request?.headers?.host ?? ''}`}/auth/browser`;
  // Platform: the Maude account, at the control plane. Self-hosted (E2): this
  // hub's own users, at its own sign-in — one door each, one studio.
  return tenant && dashboard
    ? `${dashboard}/projects/${encodeURIComponent(tenant)}/browser?return=${encodeURIComponent(back)}`
    : '/studio/signin';
}

export const PAUSED_MESSAGE =
  'Rendering is paused for this project while we look into something. ' +
  'Your work is safe and nothing has been changed. Maude Desktop still opens it normally.';

/**
 * HTML-escape one interpolated value for the server-rendered pages — this
 * one, `signInPage` (browser-auth.mjs) and `joinPage` (join-page.mjs). One
 * escaper for all three, here because this module is the leaf the other two
 * already import from. `null`/`undefined` render as nothing, not "null".
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** A plain page for the states that are not the studio. */
export function servicePage(title, message, { action = null, refreshSeconds = null } = {}) {
  const esc = escapeHtml;
  // Opt-in, script-free polling for the "still starting" states: the page
  // re-asks the same URL and simply becomes the studio once it answers.
  const refresh = refreshSeconds
    ? `<meta http-equiv="refresh" content="${Number(refreshSeconds)}">\n`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refresh}<title>${esc(title)}</title>
<link rel="stylesheet" href="/admin/style.css">
</head>
<body class="service-page"><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${
    action ? `<a class="button" href="${esc(action.href)}">${esc(action.label)}</a>` : ''
  }${oidcButton()}</main></body></html>`;
}

/**
 * "Sign in with <provider>" — Track C C6.
 *
 * Server-rendered and script-free, for the same reason the rest of this page
 * is: it is opened when something is already wrong, and a page that needs a
 * bundle to show a link is a page that can fail to show it.
 *
 * Under `hybrid` it sits beside the password form; under `strict` it is the
 * only way in. That promise is kept by TWO callers: `servicePage()` below and
 * `signInPage()` in browser-auth.mjs. For a while it had only the first, so
 * the sentence above was true of the intent and false of the product — a
 * `strict` hub rendered a password form that `cloud-identity` refuses, and the
 * one working door was a URL the UI never showed. It costs NOTHING against the
 * admin bundle's gz ceiling — this
 * file is not in that bundle, which is why the plan's "the People view plus an
 * OIDC button will blow the budget" framing was wrong on both halves.
 */
export function oidcButton(env = process.env) {
  const mode = env.HUB_OIDC_MODE;
  if (mode !== 'hybrid' && mode !== 'strict') return '';
  let label = String(env.HUB_OIDC_LABEL ?? '').trim();
  if (!label) {
    try {
      label = new URL(String(env.HUB_OIDC_ISSUER ?? '')).hostname;
    } catch {
      label = 'your identity provider';
    }
  }
  return `<p><a class="button" href="/auth/oidc/start">Sign in with ${escapeHtml(label)}</a></p>`;
}
