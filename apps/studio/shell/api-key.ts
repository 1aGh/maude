// The loopback API key for credential routes — contract `client/v2/contracts/sec-loopback-bearer.md`.
//
// A credential route uses a credential this computer holds for the person (the GitHub token, a
// cloud or team-server credential, a provider key) or spends their money. A caller that is not a
// browser sends no `Origin`, so `sameOriginWrite` let it through, and a loopback `Host` passed the
// DNS-rebind guard: any local process could use those credentials. Such a caller now needs the
// per-spawn key; a browser caller still needs to be same-origin.
//
// The key comes from `MAUDE_SHELL_API_KEY` (64 hex), read once at first import and deleted from
// `process.env` — nothing this server spawns inherits it (scrubAgentEnv also drops every
// `MAUDE_SHELL_*`, acp/env.ts). Without it the server mints one per process and writes it nowhere.
// It is never written to `_server.json` or anywhere in the project.
//
// Phase 2 (contract §7): a server whose starter handed it a key (the desktop app, for every
// project spawn) is in REQUIRED mode — every main-origin request needs the key, the app's own
// page included (`mainOriginKeyRefusal`, wired in server.ts on the main listener only). The page
// trades the key for an HttpOnly session cookie once; a browser opened from the terminal trades a
// one-time launch token in its opening URL for the same cookie.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { isWorkspaceMode } from '../workspace-mode.ts';

export const API_KEY_ENV = 'MAUDE_SHELL_API_KEY';
export const API_KEY_HEADER = 'x-maude-api-key';
const KEY_RE = /^[0-9a-fA-F]{64}$/;

/** Phase 1: the GitHub routes. Phase 2 families are listed in the contract §4. */
const CREDENTIAL_ROUTE_RE = /^\/_api\/github\//;

export function isCredentialRoute(pathname: string): boolean {
  return CREDENTIAL_ROUTE_RE.test(pathname);
}

/** Read the key from `env` and delete it there. A malformed key reads as none (fail closed). */
export function takeApiKey(env: Record<string, string | undefined> = process.env): string | null {
  const v = env[API_KEY_ENV];
  delete env[API_KEY_ENV];
  if (!v) return null;
  if (!KEY_RE.test(v)) {
    console.warn(`[maude] ${API_KEY_ENV} is not 64 hex characters; a fresh key is used instead.`);
    return null;
  }
  return v;
}

const ENV_KEY = takeApiKey(process.env);
const BOOT_KEY = ENV_KEY ?? randomBytes(32).toString('hex');
/** §7.1 — a starter handed this process its key, so every main-origin caller needs it. */
const BOOT_REQUIRED = ENV_KEY !== null;

/** This process's key (in-process launch-URL minting, phase 2b). */
export function bootApiKey(): string {
  return BOOT_KEY;
}

/** §7.1 — is this server in required mode? */
export function apiKeyRequired(): boolean {
  return BOOT_REQUIRED && !isWorkspaceMode();
}

function presentedKey(req: Request): string | null {
  const h = req.headers.get(API_KEY_HEADER);
  if (h) return h;
  const auth = req.headers.get('authorization');
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth) : null;
  return m ? m[1] : null;
}

function keyMatches(presented: string, key: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(key, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameHostOrigin(req: Request, origin: string): boolean {
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

const refuse = (status: 401 | 403, error: string) =>
  Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * `null` = let the route's own gates decide. A Response = refused here. `opts` exists for tests;
 * the server passes nothing (its boot key, and workspace mode from the environment).
 */
export function credentialRouteRefusal(
  req: Request,
  opts: { key?: string; workspace?: boolean } = {}
): Response | null {
  let pathname: string;
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    return null;
  }
  if (!isCredentialRoute(pathname)) return null;
  // A cell: the hub proxy authenticated the request, and the secret-bearing families are pruned.
  if (opts.workspace ?? isWorkspaceMode()) return null;
  const presented = presentedKey(req);
  if (presented !== null)
    return keyMatches(presented, opts.key ?? BOOT_KEY) ? null : refuse(401, 'api-key-invalid');
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (!origin && !site) return refuse(401, 'api-key-required');
  if (origin && !sameHostOrigin(req, origin)) return refuse(403, 'cross-origin rejected');
  if (site && site !== 'same-origin' && site !== 'none')
    return refuse(403, 'cross-origin rejected');
  return null;
}

/* ------------------------------------------------------------------ phase 2 (contract §7) */

export const SESSION_PATH = '/_api/shell/session';
export const LAUNCH_PARAM = 'maude-launch';
const SESSION_DOMAIN = 'maude-session/1';
const LAUNCH_DOMAIN = 'maude-launch/1';
const COOKIE_NAME_DOMAIN = 'maude-cookie-name/1';
export const LAUNCH_TTL_SEC = 300;
const LAUNCH_RE = /^(\d{1,12})\.([0-9a-f]{32})\.([0-9a-f]{64})$/;
const MAX_USED_NONCES = 4096;
const SHELL_OWN_CREDENTIAL_RE =
  /^\/_api\/shell\/(status|attest|clip-export|clip-asset|clip-import)$/;

const hmacHex = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');

/** The session cookie a key mints; its name is per key, so two servers on 127.0.0.1 never collide. */
export function sessionCookie(key: string): { name: string; value: string } {
  return {
    name: `maude_k_${hmacHex(key, COOKIE_NAME_DOMAIN).slice(0, 12)}`,
    value: hmacHex(key, SESSION_DOMAIN),
  };
}

function setCookieHeader(key: string): string {
  const c = sessionCookie(key);
  return `${c.name}=${c.value}; Path=/; HttpOnly; SameSite=Strict`;
}

/** A one-time launch token (§7.4): `<ts>.<nonce>.<mac>`. Anyone holding the key can mint one. */
export function mintLaunchToken(key: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = String(Math.floor(nowSec));
  return `${ts}.${nonce}.${hmacHex(key, `${LAUNCH_DOMAIN}\n${ts}\n${nonce}`)}`;
}

const USED_NONCES = new Set<string>();

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** §7.3 — answered without a credential. */
function isExempt(method: string, pathname: string): boolean {
  if (SHELL_OWN_CREDENTIAL_RE.test(pathname)) return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return (
    pathname === '/_health' ||
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname === '/_canvas-shell' ||
    pathname === '/_canvas-shell.html' ||
    pathname.startsWith('/_client/') ||
    pathname.startsWith('/_canvas-runtime/')
  );
}

type GateOpts = {
  key?: string;
  required?: boolean;
  workspace?: boolean;
  usedNonces?: Set<string>;
  /** unix seconds */
  now?: number;
};

const noStore = { 'Cache-Control': 'no-store' };

function launchExchange(url: URL, key: string, opts: GateOpts): Response {
  const used = opts.usedNonces ?? USED_NONCES;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const m = LAUNCH_RE.exec(url.searchParams.get(LAUNCH_PARAM) ?? '');
  const fresh = !!m && now - Number(m[1]) <= LAUNCH_TTL_SEC && Number(m[1]) - now <= 30;
  if (
    !m ||
    !fresh ||
    used.has(m[2]) ||
    !keyMatches(m[3], hmacHex(key, `${LAUNCH_DOMAIN}\n${m[1]}\n${m[2]}`))
  ) {
    return new Response(
      'This Maude link has expired or was already used. Open the project again from Maude, or run `maude design browse`.',
      { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...noStore } }
    );
  }
  // a cleared nonce is long past its 300 s lifetime by the time 4096 links were opened
  if (used.size >= MAX_USED_NONCES) used.clear();
  used.add(m[2]);
  url.searchParams.delete(LAUNCH_PARAM);
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${url.pathname}${url.search}`,
      'Set-Cookie': setCookieHeader(key),
      'Referrer-Policy': 'no-referrer',
      ...noStore,
    },
  });
}

/**
 * §7 — the required-mode gate for the MAIN listener (server.ts runs it first on the routes map and
 * in `fetch`, before any WebSocket upgrade). `null` = pass on to the route. It answers the two
 * exchanges itself: `POST /_api/shell/session` (key → cookie) and `GET /?maude-launch=` (one-time
 * token → cookie). `opts` exists for tests; the server passes nothing.
 */
export function mainOriginKeyRefusal(req: Request, opts: GateOpts = {}): Response | null {
  if (opts.workspace ?? isWorkspaceMode()) return null;
  if (!(opts.required ?? BOOT_REQUIRED)) return null;
  const key = opts.key ?? BOOT_KEY;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return refuse(401, 'api-key-required');
  }
  const { pathname } = url;
  const method = req.method.toUpperCase();
  const read = method === 'GET' || method === 'HEAD';

  if (
    read &&
    (pathname === '/' || pathname === '/index.html') &&
    url.searchParams.has(LAUNCH_PARAM)
  )
    return launchExchange(url, key, opts);

  const presented = presentedKey(req);
  if (pathname === SESSION_PATH) {
    if (method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (presented === null) return refuse(401, 'api-key-required');
    if (!keyMatches(presented, key)) return refuse(401, 'api-key-invalid');
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': setCookieHeader(key), ...noStore },
    });
  }

  if (isExempt(method, pathname)) return null;
  if (presented !== null) return keyMatches(presented, key) ? null : refuse(401, 'api-key-invalid');
  // the cookie counts only same-origin: the canvas origin is the same host on another port, which
  // a cookie treats as same-site
  const site = req.headers.get('sec-fetch-site');
  if (!site || site === 'same-origin' || site === 'none') {
    const c = sessionCookie(key);
    const got = cookieValue(req, c.name);
    if (got !== null && keyMatches(got, c.value)) return null;
  }
  return refuse(401, 'api-key-required');
}
