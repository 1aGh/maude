// home/hub.ts — Home's "Connect to your own hub" (S6.6; the TeamProjects door's hub form).
//
//   POST /_home/hub/test            { url }                     → is a Maude hub answering there?
//   POST /_home/hub/prepare         { profile, url }            → prepareManagedProject (known-hub)
//                                                                  for THAT profile
//   POST /_home/hub/signin/start    { profile, url, invite? }   → #204 K2: the hub's own page to
//                                                                  open in the browser
//   POST /_home/hub/signin/poll     { id }                      → pending · signed in · why not
//   POST /_home/hub/signin/cancel   { id }
//   GET  /_api/hub-signin/return    ?state&code | ?state&error  → the browser's hop back (routes.ts
//                                                                  serves it outside the table)
//
// Rules (contract S6-slices S6.6; issue #204, decision maude/v2-michal-team-server-signin-via-hub-page):
//   - the address is https, or http only on loopback — checked before any byte leaves; never
//     userinfo, never a query or fragment;
//   - Test connection sends ONE tokenless GET /health: no credential, no body, no redirect followed;
//   - Home owns NO login method for a team server: no email, no password, no invite redeem of its
//     own. Sign in opens the hub's `/studio/signin` (an invite: the hub's own `/join/<key>`) in the
//     browser with a desktop request (sync/hub-browser-signin.ts); the hub sends the browser back to
//     HOME's loopback return with a one-time code that only this process's PKCE verifier redeems.
//     Only the exchanged token is kept, in THIS profile's hubs.json (the profile is fixed when the
//     attempt starts, never read from the return). Every request to the hub refuses redirects.

import { NO_PASSWORD_WORDS, prepareManagedProject } from '../managed-projects.ts';
import {
  createHubBrowserSignIn,
  HUB_SIGNIN_WORDS,
  type PollAnswer,
} from '../sync/hub-browser-signin.ts';
import { saveHubCredential } from '../sync/hub-link.ts';
import { normalizeUrl } from '../sync/hubs-config.ts';
import { profileCloudPath, profileHubsPath } from './cloud.ts';
import type { HomeAnswer } from './signin.ts';

const MAX_URL = 2048;
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
  /** #204 K2 — a sign-in (or an invite accept) on the hub's own page; `origin` is Home's. */
  signInStart(body: unknown, origin: string): Promise<HomeAnswer>;
  signInPoll(body: unknown): Promise<HomeAnswer>;
  signInCancel(body: unknown): Promise<HomeAnswer>;
  /** The browser came back to Home's loopback return. */
  signInReturn(params: URLSearchParams): Promise<{ ok: boolean; message: string }>;
}

/** The words for an email or password sent to Home — it takes neither (issue #204). */
export { NO_PASSWORD_WORDS };

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
  // #204 K2 — one flow per Home process; each attempt carries the profile it may write
  const browserSignIn = createHubBrowserSignIn({ fetchImpl: hubFetch });

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

    // Home owns no login method for a team server (#204): a credential sent here is refused, unsent
    if (body.email !== undefined || body.password !== undefined)
      return answer(400, { ok: false, reason: 'password-retired', error: NO_PASSWORD_WORDS });
    const r = await prepareManagedProject(
      {},
      { kind: 'known-hub', url: a.url },
      { cloudConfigPath, hubsConfigPath, fetchImpl: hubFetch }
    );
    if (!r.ok) return answer(r.status || 502, { ok: false, error: r.error });
    return answer(200, { ...r, profile });
  }

  // #204 K2 — "Sign in" / "Invite link or key": the hub's own page in the browser. The address and
  // an invite are checked here before anything leaves; the invite key (or the hub's own invite link,
  // which must name THIS hub) only ever becomes the path of the page the browser opens.
  async function signInStart(raw: unknown, origin: string): Promise<HomeAnswer> {
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const profile = typeof body.profile === 'string' ? body.profile : '';
    const hubsConfigPath = profileHubsPath(profile);
    if (!profileCloudPath(profile) || !hubsConfigPath)
      return answer(400, { ok: false, error: 'unknown profile' });
    const a = hubAddress(body.url);
    if (!a.ok) return answer(400, { ok: false, error: a.error });
    let invite: string | undefined;
    if (body.invite !== undefined && body.invite !== null && body.invite !== '') {
      const t = hubInviteToken(body.invite, a.url);
      if (!t.ok) return answer(400, { ok: false, error: t.error });
      invite = t.value;
    }
    const r = await browserSignIn.start(a.url, origin, {
      invite,
      save: (u, token, role, expiresAt, account) =>
        saveHubCredential(u, token, role, expiresAt, hubsConfigPath, account),
    });
    if (!r.ok)
      return answer(r.status, {
        ok: false,
        error: r.error,
        ...(r.reason ? { reason: r.reason } : {}),
      });
    return answer(200, { ...r, profile });
  }

  async function signInPoll(raw: unknown): Promise<HomeAnswer> {
    const r: PollAnswer = browserSignIn.poll((raw as { id?: unknown } | null)?.id);
    return answer(200, r);
  }

  async function signInCancel(raw: unknown): Promise<HomeAnswer> {
    browserSignIn.cancel((raw as { id?: unknown } | null)?.id);
    return answer(200, { ok: true });
  }

  const signInReturn = (params: URLSearchParams) => browserSignIn.onReturn(params);

  return { test, prepare, signInStart, signInPoll, signInCancel, signInReturn };
}

const MAX_INVITE = 256;
const INVITE_RE = /^inv_[A-Za-z0-9_-]{16,200}$/;

const JOIN_WORDS = {
  badInvite: HUB_SIGNIN_WORDS.badInvite,
  otherHub: 'That invite is for a different hub address.',
};

/**
 * The invite a person pasted: the key itself (`inv_…`), or the hub's own invite link
 * `<hub>/join/<key>` — which must name THIS hub, so a link can't send the person to another host's page.
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
