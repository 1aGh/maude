// home/hub.ts — Home's "Connect to your own hub" (S6.6; the TeamProjects door's hub form).
//
//   POST /_home/hub/test     { url }                              → is a Maude hub answering there?
//   POST /_home/hub/prepare  { profile, url, email?, password? }  → prepareManagedProject for THAT
//                                                                   profile (kind hub / known-hub)
//
// Rules (contract S6-slices S6.6):
//   - the address is https, or http only on loopback — checked before any byte leaves; never
//     userinfo, never a query or fragment;
//   - Test connection sends ONE tokenless GET /health: no credential, no body, no redirect followed;
//   - the password is posted once, to `<url>/auth/login`, after the same tokenless probe
//     (signInToWorkspace) — never stored, never echoed, never logged by Home. Only the minted token
//     is kept, in THIS profile's hubs.json. Every request to the hub refuses redirects, so a 307
//     cannot replay the password (or the token) at another host.

import { type PrepareResult, prepareManagedProject } from '../managed-projects.ts';
import { normalizeUrl } from '../sync/hubs-config.ts';
import { profileCloudPath, profileHubsPath } from './cloud.ts';
import type { HomeAnswer } from './signin.ts';

const MAX_URL = 2048;
const MAX_EMAIL = 320;
const MAX_PASSWORD = 1024;
const PROBE_TIMEOUT_MS = 4000;
const MAX_HEALTH_BYTES = 64 * 1024;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

function isLoopbackHostname(h: string): boolean {
  if (h === 'localhost' || h === '[::1]') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(h);
}

/** The one address grammar Home sends anything to. */
export function hubAddress(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "That doesn't look like a hub address." };
  if (typeof raw !== 'string') return bad;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return bad;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return bad;
  }
  if (u.username || u.password || u.search || u.hash) return bad;
  if (u.protocol === 'http:' && !isLoopbackHostname(u.hostname))
    return { ok: false, error: 'The hub address must start with https://.' };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return bad;
  try {
    return { ok: true, url: normalizeUrl(s) };
  } catch {
    return bad;
  }
}

export interface HomeHub {
  test(body: unknown): Promise<HomeAnswer>;
  prepare(body: unknown): Promise<HomeAnswer>;
}

const answer = (status: number, body: unknown): HomeAnswer => ({ status, body });

export function createHomeHub(opts: { fetchImpl?: typeof fetch } = {}): HomeHub {
  const base = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  // every request to a hub: no redirect followed, no ambient credentials
  const hubFetch = ((input: string | URL | Request, init: RequestInit = {}) =>
    base(input as string, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
    })) as typeof fetch;

  async function test(body: unknown): Promise<HomeAnswer> {
    const a = hubAddress((body as { url?: unknown } | null)?.url);
    if (!a.ok) return answer(400, { ok: false, reason: 'bad-address', error: a.error });
    const unreachable = answer(502, {
      ok: false,
      reason: 'unreachable',
      error: "Couldn't reach that hub. Check the address, or whether it's online.",
    });
    let res: Response;
    try {
      res = await hubFetch(`${a.url}/health`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch {
      return unreachable;
    }
    const notMaude = answer(502, {
      ok: false,
      reason: 'not-a-maude-workspace',
      error: "That address answered, but it isn't a Maude hub.",
    });
    if (!res.ok) return notMaude;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_HEALTH_BYTES) return notMaude;
    let j: { ok?: unknown; version?: unknown } | null = null;
    try {
      const text = await res.text();
      if (text.length > MAX_HEALTH_BYTES) return notMaude;
      j = JSON.parse(text);
    } catch {
      return notMaude;
    }
    if (j?.ok !== true) return notMaude;
    const version = typeof j.version === 'string' && VERSION_RE.test(j.version) ? j.version : null;
    return answer(200, { ok: true, reachable: true, url: a.url, version });
  }

  async function prepare(raw: unknown): Promise<HomeAnswer> {
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const profile = typeof body.profile === 'string' ? body.profile : '';
    const cloudConfigPath = profileCloudPath(profile);
    const hubsConfigPath = profileHubsPath(profile);
    if (!cloudConfigPath || !hubsConfigPath)
      return answer(400, { ok: false, error: 'unknown profile' });
    const a = hubAddress(body.url);
    if (!a.ok) return answer(400, { ok: false, error: a.error });

    const signIn = body.email !== undefined || body.password !== undefined;
    let r: PrepareResult;
    if (signIn) {
      const { email, password } = body;
      if (typeof email !== 'string' || !email.trim() || email.length > MAX_EMAIL)
        return answer(400, { ok: false, error: 'Enter your email address.' });
      if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD)
        return answer(400, { ok: false, error: 'Enter your password.' });
      r = await prepareManagedProject(
        {},
        { kind: 'hub', url: a.url, email: email.trim(), password },
        { cloudConfigPath, hubsConfigPath, fetchImpl: hubFetch }
      );
    } else {
      r = await prepareManagedProject(
        {},
        { kind: 'known-hub', url: a.url },
        { cloudConfigPath, hubsConfigPath, fetchImpl: hubFetch }
      );
    }
    if (!r.ok) return answer(r.status || 502, { ok: false, error: r.error });
    return answer(200, { ...r, profile });
  }

  return { test, prepare };
}
