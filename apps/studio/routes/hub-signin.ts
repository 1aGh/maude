// Sign in to a team server in the browser — issue #204 (sync/hub-browser-signin.ts has the flow).
//
//   POST /_api/hub-signin/start   { url }  → { ok, id, signInUrl, expiresIn } | { ok:false, error }
//   POST /_api/hub-signin/poll    { id }   → { ok, pending } | { ok, url, user } | { ok:false, error }
//   POST /_api/hub-signin/cancel  { id }   → { ok }
//   GET  /_api/hub-signin/return  ?state&code | ?state&error   (the browser's hop back from the hub)
//   POST /_api/hub-signin/check   { url }  → { ok, reachable, url, version } | { ok:false, reason, error }
//
// 2.1.1 T5 — "Link your server" checks the address as it is typed: `check` is Home's `/_home/hub/test`
// (home/hub.ts `createHomeHub().test`) for a project tab — ONE tokenless GET <server>/health, no
// redirect followed, no credential, only `{ ok, version }` reflected back. `start` takes an invite
// (the key, or the server's own `/join/<key>` link, which must name the same server — home/hub.ts
// `hubInviteToken`), so the invite opens the server's own invite page here as it does on Home.
//
// MAIN ORIGIN ONLY: these mint and store a team-server credential, which the untrusted canvas
// origin (DDR-054) must never reach. `guardTableRoute` applies the CSRF + DNS-rebind gates to all
// four — the return route is the ONE table spec a cross-site page may reach, and only as a
// top-level navigation (`crossSiteNavigation`): it is where the hub's page sends the browser, so
// a navigation from the hub's origin is its whole job. What protects it is what protects any
// OAuth redirect endpoint: it acts only on a `state` this process minted, once, and the code is
// worthless without the verifier that never left this process.
//
// A cell never serves these (apps/hub/src/studio-manifest.mjs: REFUSED) — a cell holds no team
// server credential of its own.

import { isHomePort, isLoopbackAddress, isTokenBridgePort } from '../bin/_curl-local.mjs';
import { classifyAddress } from '../bin/_fetch-asset.mjs';
import { createHomeHub, hubAddress, hubInviteToken } from '../home/hub.ts';
import {
  createHubBrowserSignIn,
  type HubBrowserSignIn,
  returnPage,
} from '../sync/hub-browser-signin.ts';
import type { RouteSpec } from './table.ts';

export interface HubSigninRouteDeps {
  /** The flow; a test passes one with a fake hub. */
  signIn?: HubBrowserSignIn;
  /** The team server this project syncs with — a renewed sign-in for it cycles sync. */
  linkedHubUrl?: () => string | null | undefined;
  restartSync?: () => Promise<unknown> | undefined;
  /** The address check's network seam (tests); default `fetch`. */
  fetchImpl?: typeof fetch;
  /** 2.1.1 T8 — a loopback port the check never reaches (default: the app's Home server and token
   *  bridge, from the app-owned run files — the same ports the loopback helper refuses). */
  refusedLocalPort?: (port: number) => boolean;
}

/**
 * 2.1.1 T8 — where the address check never sends its GET: an IP literal in a private, link-local or
 * reserved range, and, on loopback, this Mac's own app services (Home, the token bridge). A loopback
 * team server for local development stays allowed. Host NAMES are not resolved here (no DNS lookup on
 * a person's keystroke); the check reflects only `{ ok, version }`. Returns a refusal reason or null.
 */
export function checkTargetRefusal(
  url: string,
  refusedLocalPort: (port: number) => boolean = (p) => isHomePort(p) || isTokenBridgePort(p)
): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'bad-address';
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || isLoopbackAddress(host);
  if (loopback) {
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    return refusedLocalPort(port) ? 'local-service' : null;
  }
  const reason = classifyAddress(host);
  // a public IP literal and every host name pass; any classified range is refused
  if (reason === null || reason === 'not an ip address') return null;
  return 'private-address';
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length > 4096) return {};
    const j = JSON.parse(text || '{}');
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const json = (payload: unknown, status = 200) =>
  Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });

const sameServer = (a: string | null | undefined, b: string) => {
  try {
    return !!a && new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

export function createHubSigninRoutes(deps: HubSigninRouteDeps = {}): RouteSpec[] {
  const signIn =
    deps.signIn ??
    createHubBrowserSignIn({
      // SIGN IN AGAIN: a new credential for the team server this project already syncs with. The
      // running sync still holds the one the server refused — cycle it onto the one just stored
      // (the move the retired email/password sign-in used to make).
      onSignedIn: async (url) => {
        if (sameServer(deps.linkedHubUrl?.(), url)) await deps.restartSync?.();
      },
    });
  // the check only: Home's tokenless probe (no redirect, no ambient credentials)
  const checker = createHomeHub(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
  return [
    {
      method: 'POST',
      path: '/_api/hub-signin/start',
      origin: 'main',
      readOnly: 'allowed',
      async handle(req) {
        const b = await body(req);
        // 2.1.1 N5 — the same target refusal as `/check`: start probes the server too
        const target = hubAddress(b.url);
        if (target.ok && checkTargetRefusal(target.url, deps.refusedLocalPort))
          return json(
            { ok: false, reason: 'bad-address', error: "That isn't a team server address." },
            400
          );
        let invite: string | undefined;
        if (b.invite !== undefined && b.invite !== null && b.invite !== '') {
          const at = hubAddress(b.url);
          if (!at.ok) return json({ ok: false, error: at.error }, 400);
          const t = hubInviteToken(b.invite, at.url);
          if (!t.ok) return json({ ok: false, error: t.error }, 400);
          invite = t.value;
        }
        const r = await signIn.start(b.url, new URL(req.url).origin, invite ? { invite } : {});
        return r.ok
          ? json(r)
          : json(
              { ok: false, error: r.error, ...(r.reason ? { reason: r.reason } : {}) },
              r.status
            );
      },
    },
    {
      method: 'POST',
      path: '/_api/hub-signin/poll',
      origin: 'main',
      readOnly: 'allowed',
      async handle(req) {
        return json(signIn.poll((await body(req)).id));
      },
    },
    {
      method: 'POST',
      path: '/_api/hub-signin/cancel',
      origin: 'main',
      readOnly: 'allowed',
      async handle(req) {
        signIn.cancel((await body(req)).id);
        return json({ ok: true });
      },
    },
    {
      method: 'POST',
      path: '/_api/hub-signin/check',
      origin: 'main',
      readOnly: 'allowed',
      async handle(req) {
        const b = await body(req);
        const a = hubAddress(b.url);
        if (a.ok && checkTargetRefusal(a.url, deps.refusedLocalPort))
          return json(
            { ok: false, reason: 'bad-address', error: "That isn't a team server address." },
            400
          );
        const r = await checker.test(b);
        return json(r.body, r.status);
      },
    },
    {
      method: 'GET',
      // A literal (the route scrapers read `path:` strings) — HUB_SIGNIN_RETURN_PATH, asserted by the test.
      path: '/_api/hub-signin/return',
      origin: 'main',
      readOnly: 'allowed',
      crossSiteNavigation: true,
      async handle(req) {
        return returnPage(await signIn.onReturn(new URL(req.url).searchParams));
      },
    },
  ];
}
