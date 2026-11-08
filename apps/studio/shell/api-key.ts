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

import { randomBytes, timingSafeEqual } from 'node:crypto';

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

const BOOT_KEY = takeApiKey(process.env) ?? randomBytes(32).toString('hex');

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
