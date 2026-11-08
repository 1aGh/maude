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

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { isLoopbackHost } from '../sync/loopback.ts';
import { isWorkspaceMode } from '../workspace-mode.ts';
import { isCliRole } from './cli-yield.ts';

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
/**
 * §7.5 — a terminal-started server (role `cli`: `maude design serve`, `server-up`) mints its own
 * key, writes it to the per-user key file (shell/key-file.ts) and opens with a launch token.
 */
const TERMINAL_REQUIRED = ENV_KEY === null && isCliRole(process.env);
/**
 * §7.1 — a starter handed this process its key (the desktop app), or a terminal starter asked
 * for one (§7.5): every main-origin caller needs it. A server started with neither (a bare
 * `bun server.ts`, a test harness) keeps phase 1: credential routes only.
 */
const BOOT_REQUIRED = ENV_KEY !== null || TERMINAL_REQUIRED;

/** This process's key (in-process launch-URL minting, phase 2b). */
export function bootApiKey(): string {
  return BOOT_KEY;
}

/** §7.5 — did this server mint its own key as a terminal-started server (it writes the key file)? */
export function terminalKeyMode(): boolean {
  return TERMINAL_REQUIRED && !isWorkspaceMode();
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
const LAUNCH_DOMAIN = 'maude-launch/1';
const COOKIE_NAME_DOMAIN = 'maude-cookie-name/1';
export const LAUNCH_TTL_SEC = 300;
/** §7.2 — a session not used for this long is gone (the page trades its key or a fresh link again). */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const LAUNCH_RE = /^(\d{1,12})\.([0-9a-f]{32})\.([0-9a-f]{64})$/;
const SESSION_VALUE_RE = /^[0-9a-f]{64}$/;
const MAX_USED_NONCES = 4096;
const MAX_SESSIONS = 256;
const SHELL_OWN_CREDENTIAL_RE =
  /^\/_api\/shell\/(status|attest|clip-export|clip-asset|clip-import)$/;

const hmacHex = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');
const sha256Hex = (v: string) => createHash('sha256').update(v).digest('hex');
const noStore = { 'Cache-Control': 'no-store' };

/** The session cookie's name: per key, so two servers on 127.0.0.1 never overwrite each other's. */
export function sessionCookieName(key: string): string {
  return `maude_k_${hmacHex(key, COOKIE_NAME_DOMAIN).slice(0, 12)}`;
}

/**
 * §7.2 — the live sessions: sha256(cookie value) → last use (ms). The value is random and held only
 * in this process (never derived from the key), so a leaked cookie dies with idleness or a restart.
 */
export type SessionStore = Map<string, number>;
const SESSIONS: SessionStore = new Map();

function sessionLive(store: SessionStore, value: string, nowMs: number): boolean {
  if (!SESSION_VALUE_RE.test(value)) return false;
  const id = sha256Hex(value);
  const seen = store.get(id);
  if (seen === undefined) return false;
  if (nowMs - seen > SESSION_IDLE_MS) {
    store.delete(id);
    return false;
  }
  store.set(id, nowMs);
  return true;
}

/** A fresh session. Each exchange rotates: the session the caller presented, if any, is dropped. */
function openSession(store: SessionStore, nowMs: number, replacing: string | null): string {
  if (replacing) store.delete(sha256Hex(replacing));
  for (const [id, seen] of store) if (nowMs - seen > SESSION_IDLE_MS) store.delete(id);
  while (store.size >= MAX_SESSIONS) {
    let oldest: string | null = null;
    let at = Number.POSITIVE_INFINITY;
    for (const [id, seen] of store) {
      if (seen < at) {
        at = seen;
        oldest = id;
      }
    }
    if (oldest === null) break;
    store.delete(oldest);
  }
  const value = randomBytes(32).toString('hex');
  store.set(sha256Hex(value), nowMs);
  return value;
}

function setCookieHeader(key: string, value: string): string {
  return `${sessionCookieName(key)}=${value}; Path=/; HttpOnly; SameSite=Strict`;
}

/** A one-time launch token (§7.4): `<ts>.<nonce>.<mac>`. Anyone holding the key can mint one. */
export function mintLaunchToken(key: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = String(Math.floor(nowSec));
  return `${ts}.${nonce}.${hmacHex(key, `${LAUNCH_DOMAIN}\n${ts}\n${nonce}`)}`;
}

/** Used launch nonces → the token's own `ts` (unix s). Only an expired entry is ever dropped. */
export type NonceStore = Map<string, number>;
const USED_NONCES: NonceStore = new Map();

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

/**
 * §7.8 — routes only the person may call: a browser session on a same-origin request, never the
 * header key every helper and verb sends. (Spend approval and spend limits depend on the body; their
 * routes ask `personRequest` themselves, in http.ts.)
 */
const PERSON_ONLY: readonly (readonly [string, RegExp])[] = [
  ['POST', /^\/_api\/git\/push$/],
  ['POST', /^\/_api\/share\/invites(\/[^/]+\/resend)?$/],
  ['POST', /^\/_api\/cloud\/(attach|attach\/code|move|signin\/start)$/],
];

export function isPersonOnlyRoute(method: string, pathname: string): boolean {
  return PERSON_ONLY.some(([m, re]) => m === method && re.test(pathname));
}

/**
 * The session cookie, counted only same-origin: the canvas origin is the same host on another port,
 * which a cookie treats as same-site. An `Origin` naming another host never rides it either (an
 * engine that sends no Fetch Metadata). Returns the live value, else null.
 */
function sessionCookieOf(
  req: Request,
  key: string,
  store: SessionStore,
  nowMs: number
): string | null {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return null;
  const origin = req.headers.get('origin');
  if (origin && !sameHostOrigin(req, origin)) return null;
  const got = cookieValue(req, sessionCookieName(key));
  return got !== null && sessionLive(store, got, nowMs) ? got : null;
}

function loopbackHostHeader(req: Request): boolean {
  const host = req.headers.get('host');
  if (!host) return false;
  try {
    return isLoopbackHost(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** What authenticated a main-origin request (recorded by the gate, read by `requestCredential`). */
export type RequestCredential = 'key' | 'session';
const CREDENTIAL_OF = new WeakMap<Request, RequestCredential>();

/**
 * §7.3 — the credential the gate saw on this request, on an exempt path too (`/_canvas-shell` mints a
 * frame capability only for an authenticated caller). null = none, or the gate did not run.
 */
export function requestCredential(req: Request): RequestCredential | null {
  return CREDENTIAL_OF.get(req) ?? null;
}

/**
 * §7.8 — is this request the person at the studio page? In required mode: a browser session (the
 * cookie, never the header key) on a `Sec-Fetch-Site: same-origin` request whose `Origin` is this
 * server. Outside required mode (phase 1, a cell behind its proxy) the old rule: a browser sends
 * `Origin` on a write, the CLI never does.
 */
export function personRequest(req: Request, opts: { required?: boolean } = {}): boolean {
  const origin = req.headers.get('origin');
  if (!(opts.required ?? apiKeyRequired())) return !!origin;
  if (CREDENTIAL_OF.get(req) !== 'session') return false;
  if (req.headers.get('sec-fetch-site') !== 'same-origin') return false;
  return !!origin && sameHostOrigin(req, origin);
}

function redirectWithoutLaunch(url: URL): Response {
  url.searchParams.delete(LAUNCH_PARAM);
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${url.pathname}${url.search}`,
      'Referrer-Policy': 'no-referrer',
      ...noStore,
    },
  });
}

type GateOpts = {
  key?: string;
  required?: boolean;
  workspace?: boolean;
  usedNonces?: NonceStore;
  sessions?: SessionStore;
  /** unix seconds */
  now?: number;
};

const plainText = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...noStore },
  });

function launchExchange(
  url: URL,
  key: string,
  used: NonceStore,
  sessions: SessionStore,
  now: number
): Response {
  const m = LAUNCH_RE.exec(url.searchParams.get(LAUNCH_PARAM) ?? '');
  const fresh = !!m && now - Number(m[1]) <= LAUNCH_TTL_SEC && Number(m[1]) - now <= 30;
  if (
    !m ||
    !fresh ||
    used.has(m[2]) ||
    !keyMatches(m[3], hmacHex(key, `${LAUNCH_DOMAIN}\n${m[1]}\n${m[2]}`))
  ) {
    return plainText(
      401,
      'This Maude link has expired or was already used. Open the project again from Maude, or run `maude design browse`.'
    );
  }
  if (used.size >= MAX_USED_NONCES) {
    // only a token past its lifetime can be forgotten: a forgotten live one would open twice
    for (const [nonce, ts] of used) if (now - ts > LAUNCH_TTL_SEC) used.delete(nonce);
    if (used.size >= MAX_USED_NONCES)
      return plainText(
        429,
        'Too many Maude links were opened at once. Try again in a few minutes.'
      );
  }
  used.set(m[2], Number(m[1]));
  url.searchParams.delete(LAUNCH_PARAM);
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${url.pathname}${url.search}`,
      'Set-Cookie': setCookieHeader(key, openSession(sessions, now * 1000, null)),
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
  const sessions = opts.sessions ?? SESSIONS;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const nowMs = opts.now !== undefined ? opts.now * 1000 : Date.now();
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return refuse(401, 'api-key-required');
  }
  const { pathname } = url;
  const method = req.method.toUpperCase();
  const read = method === 'GET' || method === 'HEAD';
  const launch =
    read && (pathname === '/' || pathname === '/index.html') && url.searchParams.has(LAUNCH_PARAM);
  // C7 — the two exchanges answer a loopback Host only: a rebound name never gets a session
  if ((launch || pathname === SESSION_PATH) && !loopbackHostHeader(req))
    return refuse(403, 'local request required');

  const cookie = sessionCookieOf(req, key, sessions, nowMs);
  if (launch) {
    // a page that already holds the session (a reload, a helper navigating twice) just drops the
    // parameter — its token stays unspent and unchecked
    if (cookie) return redirectWithoutLaunch(url);
    return launchExchange(url, key, opts.usedNonces ?? USED_NONCES, sessions, now);
  }

  const presented = presentedKey(req);
  if (pathname === SESSION_PATH) {
    if (method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (presented === null) return refuse(401, 'api-key-required');
    if (!keyMatches(presented, key)) return refuse(401, 'api-key-invalid');
    return new Response(null, {
      status: 204,
      headers: {
        'Set-Cookie': setCookieHeader(key, openSession(sessions, nowMs, cookie)),
        ...noStore,
      },
    });
  }

  const keyOk = presented !== null && keyMatches(presented, key);
  if (keyOk) CREDENTIAL_OF.set(req, 'key');
  else if (presented === null && cookie) CREDENTIAL_OF.set(req, 'session');
  if (isExempt(method, pathname)) return null;
  if (presented !== null && !keyOk) return refuse(401, 'api-key-invalid');
  if (!keyOk && !cookie) return refuse(401, 'api-key-required');
  if (isPersonOnlyRoute(method, pathname) && !personRequest(req, { required: true }))
    return refuse(403, 'person-only');
  return null;
}
