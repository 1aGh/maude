// Sign in to a team server in the browser — issue #204 (sync/hub-browser-signin.ts has the flow).
//
//   POST /_api/hub-signin/start   { url }  → { ok, id, signInUrl, expiresIn } | { ok:false, error }
//   POST /_api/hub-signin/poll    { id }   → { ok, pending } | { ok, url, user } | { ok:false, error }
//   POST /_api/hub-signin/cancel  { id }   → { ok }
//   GET  /_api/hub-signin/return  ?state&code | ?state&error   (the browser's hop back from the hub)
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
  return [
    {
      method: 'POST',
      path: '/_api/hub-signin/start',
      origin: 'main',
      readOnly: 'allowed',
      async handle(req) {
        const b = await body(req);
        const r = await signIn.start(b.url, new URL(req.url).origin);
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
