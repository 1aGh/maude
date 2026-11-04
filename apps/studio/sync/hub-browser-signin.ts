// Sign in to a team server in the browser — issue #204 (Maude 2.0.4).
//
// Michal's decision (`maude/v2-michal-team-server-signin-via-hub-page`): the desktop owns NO
// login method for a team server. "Sign in" opens the hub's OWN page (`/studio/signin`), which
// offers whatever that hub offers — a password, "Sign in with <issuer>" (OIDC), … — and the hub
// sends the browser back to THIS server's loopback return route with a one-time code
// (apps/hub/src/desktop-signin.mjs has the hub half and the flow drawing).
//
//   start(url)   tokenless /health probe (a Maude hub that says `desktop-signin-v1`), then a
//                fresh attempt: `state` (32 hex) + PKCE `verifier`, both kept HERE, in memory;
//                answers the hub page URL the client opens in the browser.
//   onReturn()   the browser lands on `/_api/hub-signin/return?code&state` (or `&error`): the
//                state must name a live attempt of THIS process, once. The code + verifier go to
//                `<hub>/auth/desktop/exchange` (POST, no redirect followed); the token that comes
//                back is stored through `saveHubCredential` — the same per-profile hubs.json slot
//                the email/password sign-in used, never a new store.
//   poll(id)     the client waits on the attempt: pending · signed in · why not.
//
// The token never travels in a URL and never reaches the page: only this process sees it. The
// code that does travel is single use, a minute long, and worthless without the verifier, which
// never left this process — so a code read from browser history, a log or another app that
// grabbed the loopback hop cannot be redeemed by anyone else.

import { createHash, randomBytes } from 'node:crypto';
import { saveHubCredential } from './hub-link.ts';
import { normalizeUrl, safeAccount } from './hubs-config.ts';

/** The hub's `/health` capability word for this flow (apps/hub/src/desktop-signin.mjs). */
export const DESKTOP_SIGNIN_CAPABILITY = 'desktop-signin-v1';
/** The loopback path the hub may send the browser back to (the hub allows exactly this one). */
export const HUB_SIGNIN_RETURN_PATH = '/_api/hub-signin/return';
/** As long as the hub keeps the request (DESKTOP_TXN_TTL_MS). */
export const ATTEMPT_TTL_MS = 10 * 60_000;
/** Attempts alive at once — each one is a browser tab somebody opened. */
const MAX_ATTEMPTS = 5;
const PROBE_TIMEOUT_MS = 4000;
const EXCHANGE_TIMEOUT_MS = 15_000;

/** Plain words for every way this ends (CONTRACT §3/§4: no token, no OAuth, no code). */
export const HUB_SIGNIN_WORDS = {
  badAddress: "That doesn't look like a team server address.",
  notHttps: 'The team server address must start with https://.',
  unreachable:
    "Couldn't reach that team server. Check the address, or ask whoever runs it whether it's online.",
  notMaude: "That address answered, but it isn't a Maude team server. Check the address.",
  needsUpdate:
    'This team server needs an update before Maude can sign in to it. Ask whoever runs it to update it to Maude 2.0.4 or newer.',
  tooMany: 'Too many sign-ins are open. Finish or cancel one first.',
  expired: 'The sign-in took too long. Start it again.',
  pending:
    'You signed in, but nobody has given your account access to this team server yet. Ask whoever runs it to approve you.',
  denied: 'This account cannot sign in to this team server.',
  refused: 'The team server did not accept the sign-in. Start it again.',
  exchangeUnreachable: "Couldn't reach the team server to finish signing in. Start it again.",
  update:
    'This team server needs a newer Maude to give this account access. Update Maude, then sign in again.',
  browserOnly:
    'This account can only view this project, and viewing works in the browser. Ask whoever runs the team server for edit access.',
  saveFailed: "Couldn't save the sign-in on this computer.",
  unknown: "This sign-in wasn't started in this Maude window, or it's already finished.",
} as const;

type Attempt = {
  id: string;
  url: string;
  verifier: string;
  createdAt: number;
  phase: 'waiting' | 'exchanging' | 'done' | 'failed';
  result?:
    | { ok: true; url: string; user: { email: string; role: string } }
    | { ok: false; error: string };
};

export type StartAnswer =
  | { ok: true; id: string; signInUrl: string; expiresIn: number }
  | { ok: false; error: string; status: number };

export type PollAnswer =
  | { ok: true; pending: true }
  | { ok: true; url: string; user: { email: string; role: string } }
  | { ok: false; error: string };

export interface HubBrowserSignInDeps {
  fetchImpl?: typeof fetch;
  /** Where the credential goes — the same call the email/password sign-in made. */
  save?: (url: string, token: string, role?: string, expiresAt?: number, account?: string) => void;
  /** After a credential is stored: e.g. cycle sync when it renews the linked team server's. */
  onSignedIn?: (url: string) => void | Promise<void>;
  now?: () => number;
}

const isLoopbackHostname = (h: string) =>
  h === 'localhost' || h === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(h);

/** The one address grammar this flow sends anything to: https, or http only on loopback. */
export function teamServerAddress(
  raw: unknown
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048)
    return { ok: false, error: HUB_SIGNIN_WORDS.badAddress };
  let u: URL;
  let norm: string;
  try {
    norm = normalizeUrl(raw.trim());
    u = new URL(norm);
  } catch {
    return { ok: false, error: HUB_SIGNIN_WORDS.badAddress };
  }
  if (u.username || u.password) return { ok: false, error: HUB_SIGNIN_WORDS.badAddress };
  if (u.protocol === 'http:' && !isLoopbackHostname(u.hostname))
    return { ok: false, error: HUB_SIGNIN_WORDS.notHttps };
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    return { ok: false, error: HUB_SIGNIN_WORDS.badAddress };
  return { ok: true, url: norm };
}

/** The return target for a request that reached this server on `origin` (loopback http only). */
export function returnUriFor(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' || !isLoopbackHostname(u.hostname) || !u.port) return null;
    return `${u.protocol}//${u.host}${HUB_SIGNIN_RETURN_PATH}`;
  } catch {
    return null;
  }
}

export function createHubBrowserSignIn(deps: HubBrowserSignInDeps = {}) {
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const save =
    deps.save ??
    ((u: string, t: string, r?: string, e?: number, a?: string) =>
      saveHubCredential(u, t, r, e, undefined, a));
  const attempts = new Map<string, Attempt>();

  const sweep = () => {
    const t = now();
    for (const [k, a] of attempts) if (t - a.createdAt > ATTEMPT_TTL_MS) attempts.delete(k);
  };

  async function probe(url: string): Promise<'ok' | 'unreachable' | 'not-maude' | 'old'> {
    try {
      const res = await doFetch(`${url}/health`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return 'not-maude';
      const j = (await res.json().catch(() => null)) as {
        ok?: unknown;
        capabilities?: unknown;
      } | null;
      if (j?.ok !== true) return 'not-maude';
      return Array.isArray(j.capabilities) && j.capabilities.includes(DESKTOP_SIGNIN_CAPABILITY)
        ? 'ok'
        : 'old';
    } catch {
      return 'unreachable';
    }
  }

  /** A new attempt for `rawUrl`; `origin` is where the browser comes back (this server). */
  async function start(rawUrl: unknown, origin: string): Promise<StartAnswer> {
    const addr = teamServerAddress(rawUrl);
    if (!addr.ok) return { ok: false, error: addr.error, status: 400 };
    const redirectUri = returnUriFor(origin);
    if (!redirectUri) return { ok: false, error: HUB_SIGNIN_WORDS.unknown, status: 403 };
    sweep();
    const live = [...attempts.values()].filter((a) => a.phase === 'waiting');
    if (live.length >= MAX_ATTEMPTS)
      return { ok: false, error: HUB_SIGNIN_WORDS.tooMany, status: 429 };
    const p = await probe(addr.url);
    if (p === 'unreachable') return { ok: false, error: HUB_SIGNIN_WORDS.unreachable, status: 502 };
    if (p === 'not-maude') return { ok: false, error: HUB_SIGNIN_WORDS.notMaude, status: 502 };
    if (p === 'old') return { ok: false, error: HUB_SIGNIN_WORDS.needsUpdate, status: 409 };
    const id = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    attempts.set(id, { id, url: addr.url, verifier, createdAt: now(), phase: 'waiting' });
    const q = new URLSearchParams({
      client: 'desktop',
      state: id,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
    });
    return {
      ok: true,
      id,
      signInUrl: `${addr.url}/studio/signin?${q.toString()}`,
      expiresIn: ATTEMPT_TTL_MS / 1000,
    };
  }

  const fail = (a: Attempt, error: string) => {
    a.phase = 'failed';
    a.result = { ok: false, error };
  };

  /**
   * The browser came back. Returns what the return page says. A state this process did not
   * start, or one already used, changes nothing (an unrequested or replayed callback).
   */
  async function onReturn(params: URLSearchParams): Promise<{ ok: boolean; message: string }> {
    sweep();
    const state = params.get('state') ?? '';
    const a = /^[0-9a-f]{32}$/.test(state) ? attempts.get(state) : undefined;
    if (!a || a.phase !== 'waiting') return { ok: false, message: HUB_SIGNIN_WORDS.unknown };
    a.phase = 'exchanging'; // single use from here on, whatever happens next
    const error = params.get('error');
    if (error) {
      fail(a, error === 'pending' ? HUB_SIGNIN_WORDS.pending : HUB_SIGNIN_WORDS.denied);
      return {
        ok: false,
        message: a.result?.ok === false ? a.result.error : HUB_SIGNIN_WORDS.denied,
      };
    }
    const code = params.get('code') ?? '';
    if (!code || code.length > 128) {
      fail(a, HUB_SIGNIN_WORDS.refused);
      return { ok: false, message: HUB_SIGNIN_WORDS.refused };
    }
    let res: Response;
    try {
      res = await doFetch(`${a.url}/auth/desktop/exchange`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: a.verifier }),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      });
    } catch {
      fail(a, HUB_SIGNIN_WORDS.exchangeUnreachable);
      return { ok: false, message: HUB_SIGNIN_WORDS.exchangeUnreachable };
    }
    const body = (await res.json().catch(() => null)) as {
      token?: unknown;
      expiresAt?: unknown;
      user?: { email?: unknown; role?: unknown };
      reason?: unknown;
    } | null;
    if (!res.ok || typeof body?.token !== 'string' || !body.token) {
      const words =
        res.status === 426
          ? HUB_SIGNIN_WORDS.update
          : res.status === 409
            ? HUB_SIGNIN_WORDS.browserOnly
            : res.status === 401
              ? HUB_SIGNIN_WORDS.denied
              : HUB_SIGNIN_WORDS.refused;
      fail(a, words);
      return { ok: false, message: words };
    }
    const role = typeof body.user?.role === 'string' ? body.user.role : 'member';
    const email = safeAccount(body.user?.email) ?? '';
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : undefined;
    try {
      save(a.url, body.token, role, expiresAt, email || undefined);
    } catch {
      fail(a, HUB_SIGNIN_WORDS.saveFailed);
      return { ok: false, message: HUB_SIGNIN_WORDS.saveFailed };
    }
    a.phase = 'done';
    a.result = { ok: true, url: a.url, user: { email, role } };
    try {
      await deps.onSignedIn?.(a.url);
    } catch (err) {
      console.error('[hub-signin] after sign-in:', err);
    }
    return { ok: true, message: 'Signed in. You can close this tab and go back to Maude.' };
  }

  /** The client's wait. A finished attempt answers once, then is forgotten. */
  function poll(id: unknown): PollAnswer {
    sweep();
    const a = typeof id === 'string' ? attempts.get(id) : undefined;
    if (!a) return { ok: false, error: HUB_SIGNIN_WORDS.expired };
    if (a.phase === 'waiting' || a.phase === 'exchanging') return { ok: true, pending: true };
    attempts.delete(a.id);
    return a.result ?? { ok: false, error: HUB_SIGNIN_WORDS.refused };
  }

  /** Cancel: the attempt is gone, so a later return for it changes nothing. */
  function cancel(id: unknown): void {
    if (typeof id === 'string') attempts.delete(id);
  }

  return { start, onReturn, poll, cancel, size: () => attempts.size };
}

export type HubBrowserSignIn = ReturnType<typeof createHubBrowserSignIn>;

/** The page the browser shows after the hop back — this server's own words, nothing echoed. */
export function returnPage(r: { ok: boolean; message: string }): Response {
  const title = r.ok ? 'Signed in' : 'Not signed in';
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
    );
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Maude</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1014;color:#e9ecf3;
font:15px/1.6 -apple-system,system-ui,sans-serif;padding:24px}main{width:min(24rem,100%)}
h1{font-size:1.3rem;margin:0 0 .5rem}p{color:#c3c9d6}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(r.message)}</p></main></body></html>`;
  return new Response(html, {
    status: r.ok ? 200 : 400,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}
