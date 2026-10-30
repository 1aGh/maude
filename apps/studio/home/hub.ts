// home/hub.ts — Home's "Connect to your own hub" (S6.6; the TeamProjects door's hub form).
//
//   POST /_home/hub/test     { url }                              → is a Maude hub answering there?
//   POST /_home/hub/prepare  { profile, url, email?, password? }  → prepareManagedProject for THAT
//                                                                   profile (kind hub / known-hub)
//   POST /_home/hub/join     { profile, url, token, email, password } → S6.11b: redeem a hub invite
//                                                                   (the hub's JSON POST /join), then
//                                                                   the same prepare-shaped answer
//
// Rules (contract S6-slices S6.6):
//   - the address is https, or http only on loopback — checked before any byte leaves; never
//     userinfo, never a query or fragment;
//   - Test connection sends ONE tokenless GET /health: no credential, no body, no redirect followed;
//   - the password is posted once, to `<url>/auth/login`, after the same tokenless probe
//     (signInToWorkspace) — never stored, never echoed, never logged by Home. Only the minted token
//     is kept, in THIS profile's hubs.json. Every request to the hub refuses redirects, so a 307
//     cannot replay the password (or the token) at another host.

import { ACCESS_VERSION } from '../access/scope.ts';
import { type PrepareResult, prepareManagedProject } from '../managed-projects.ts';
import { saveHubCredential } from '../sync/hub-link.ts';
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
  /** S6.11b — redeem a hub invite (`POST /join`), keep the session, prepare the project. */
  join(body: unknown): Promise<HomeAnswer>;
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

  // S6.11b — "Invite link or key": redeem a hub invite through the hub's own JSON `POST /join`
  // (apps/hub auth-routes.mjs), after the same tokenless probe. The invite token, the email and the
  // password ride that one POST body and nowhere else — never a URL, never a log line, never an
  // answer. Only the minted session is kept, in THIS profile's hubs.json; the project then prepares
  // exactly like a hub this Mac already holds a sign-in for.
  async function join(raw: unknown): Promise<HomeAnswer> {
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const profile = typeof body.profile === 'string' ? body.profile : '';
    const cloudConfigPath = profileCloudPath(profile);
    const hubsConfigPath = profileHubsPath(profile);
    if (!cloudConfigPath || !hubsConfigPath)
      return answer(400, { ok: false, error: 'unknown profile' });
    const a = hubAddress(body.url);
    if (!a.ok) return answer(400, { ok: false, error: a.error });
    const token = hubInviteToken(body.token, a.url);
    if (!token.ok) return answer(400, { ok: false, error: token.error });
    const { email, password } = body;
    if (typeof email !== 'string' || !email.trim() || email.length > MAX_EMAIL)
      return answer(400, { ok: false, error: 'Enter your email address.' });
    if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD)
      return answer(400, { ok: false, error: 'Enter your password.' });

    // the same tokenless probe Test connection sends: nothing secret goes to a non-hub
    const probe = await test({ url: a.url });
    if (probe.status !== 200) {
      const b = probe.body as { error?: string };
      return answer(probe.status, { ok: false, error: b.error ?? JOIN_WORDS.unreachable });
    }

    let res: Response;
    try {
      res = await hubFetch(`${a.url}/join`, {
        method: 'POST',
        // the caller honours a canvas invite's access claim (S9.6b), or the hub refuses to spend it
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-maude-access': String(ACCESS_VERSION),
        },
        body: JSON.stringify({ token: token.value, email: email.trim(), password }),
        signal: AbortSignal.timeout(JOIN_TIMEOUT_MS),
      });
    } catch {
      return answer(502, { ok: false, error: JOIN_WORDS.unreachable });
    }
    let j: Record<string, unknown> | null = null;
    try {
      const text = await res.text();
      j = text.length <= MAX_HEALTH_BYTES ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      j = null;
    }
    if (res.status !== 201 || j?.ok !== true || typeof j.token !== 'string' || !j.token) {
      return answer(joinStatus(res.status), {
        ok: false,
        reason: joinReason(res.status, j?.reason),
        error: joinError(res.status, j?.reason, j?.error),
      });
    }
    const user = (j.user && typeof j.user === 'object' ? j.user : {}) as {
      role?: unknown;
      email?: unknown;
    };
    const role = typeof user.role === 'string' ? user.role : 'member';
    const expiresAt = typeof j.expiresAt === 'number' ? j.expiresAt : undefined;
    try {
      saveHubCredential(
        a.url,
        j.token,
        role,
        expiresAt,
        hubsConfigPath,
        typeof user.email === 'string' ? user.email : email.trim()
      );
    } catch {
      return answer(500, {
        ok: false,
        error: "Couldn't save the hub connection on this computer.",
      });
    }
    const r = await prepareManagedProject(
      {},
      { kind: 'known-hub', url: a.url },
      { cloudConfigPath, hubsConfigPath, fetchImpl: hubFetch }
    );
    if (!r.ok) return answer(r.status || 502, { ok: false, error: r.error });
    return answer(200, { ...r, role: r.role ?? role, profile });
  }

  return { test, prepare, join };
}

const JOIN_TIMEOUT_MS = 15_000;
const MAX_INVITE = 256;
const INVITE_RE = /^inv_[A-Za-z0-9_-]{16,200}$/;

const JOIN_WORDS = {
  unreachable: "Couldn't reach that hub. Check the address, or whether it's online.",
  badInvite: "That doesn't look like an invite link or key.",
  otherHub: 'That invite is for a different hub address.',
  dead: "This invite doesn't work any more. Ask whoever invited you for a new one.",
  rateLimited: 'Too many attempts. Wait a minute and try again.',
  refused: 'The hub refused the invite.',
};

/**
 * The invite a person pasted: the key itself (`inv_…`), or the hub's own invite link
 * `<hub>/join/<key>` — which must name THIS hub, so a link can't send the password to another host.
 */
export function hubInviteToken(
  raw: unknown,
  hubUrl: string
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: JOIN_WORDS.badInvite };
  const s = raw.trim();
  if (!s || s.length > MAX_INVITE) return { ok: false, error: JOIN_WORDS.badInvite };
  if (INVITE_RE.test(s)) return { ok: true, value: s };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: JOIN_WORDS.badInvite };
  }
  const m = /^(.*)\/join\/([^/]+)$/.exec(u.pathname);
  if (!m || u.username || u.password || u.search || u.hash)
    return { ok: false, error: JOIN_WORDS.badInvite };
  let key: string;
  try {
    key = decodeURIComponent(m[2] ?? '');
  } catch {
    return { ok: false, error: JOIN_WORDS.badInvite };
  }
  if (!INVITE_RE.test(key)) return { ok: false, error: JOIN_WORDS.badInvite };
  const at = hubAddress(`${u.origin}${m[1] ?? ''}`);
  if (!at.ok || at.url !== hubUrl) return { ok: false, error: JOIN_WORDS.otherHub };
  return { ok: true, value: key };
}

const joinStatus = (status: number) =>
  status === 410 || status === 400 || status === 403 || status === 429 || status === 426
    ? status
    : 502;

const REASONS = new Set([
  'expired',
  'already-used',
  'revoked',
  'unknown',
  'email-mismatch',
  'email-required',
  'account-failed',
  'no-access',
  'password-refused-oidc-strict',
]);
const joinReason = (status: number, reason: unknown) =>
  typeof reason === 'string' && REASONS.has(reason)
    ? reason
    : status === 429
      ? 'rate-limited'
      : status === 410
        ? 'gone'
        : 'refused';

/** A refused join's reason → our words. */
const REASON_WORDS: Record<string, string> = {
  expired: JOIN_WORDS.dead,
  revoked: JOIN_WORDS.dead,
  'already-used': 'This invite was already used. Ask whoever invited you for a new one.',
  'email-mismatch': 'This invite is for a different email address.',
  'email-required': 'Enter your email address.',
  'account-failed': "The hub couldn't create your account. Try again in a minute.",
  'no-access': "This account can't open that hub.",
  'password-refused-oidc-strict':
    'This hub signs you in through your organisation, not a password.',
};

/**
 * Always OUR words (gate-b-sec1): the hub's own `error` text is never shown — Home is a trusted surface and a
 * hostile or compromised hub could put phishing words there ("call support at …"). Only the status and the
 * reason code pick the sentence.
 */
function joinError(status: number, reason: unknown, _error?: unknown): string {
  if (status === 429) return JOIN_WORDS.rateLimited;
  if (typeof reason === 'string' && Object.hasOwn(REASON_WORDS, reason))
    return REASON_WORDS[reason] as string;
  if (status === 410) return JOIN_WORDS.dead;
  return JOIN_WORDS.refused;
}
