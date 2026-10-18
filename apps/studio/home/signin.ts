// home/signin.ts — Home signs in to Maude Cloud by itself (S6.5; contract S6-S9-signin-invite-home
// §5.1, S6-slices Q3). On a first launch there is no project server, so the Home server runs the
// device flow and writes the `cloud.json` of the profile RUST picked:
//
//   POST /_home/internal/signin/profile {profile, invite|null}   (Rust, bearer — S6.7 home.rs)
//     names the ONE profile the next sign-in may write. Single slot: a new registration replaces
//     the old one and ends the attempt in flight (Rust's own prepare does the same).
//   POST /_home/cloud/signin/start {profile?, forInvite?}        (page)
//     refused unless `profile` (absent = the registered one) and `forInvite` (when sent) are what
//     Rust registered, inside the wait. Asks the cloud for a device code, keeps it HERE, and
//     answers `{userCode, state, expiresIn}`. A second start cancels the first.
//   POST /_home/cloud/signin/poll {state}
//     `pending | done{email, landing?} | expired | cancelled`; any state but the current attempt's
//     is 409 `stale-state` and asks the cloud nothing. On `done` the token is written into the
//     registered profile's own `cloud.json` (0600, never over an existing file) and the
//     registration is spent.
//   POST /_home/cloud/signin/cancel {state}
//     the current state cancels; any other is a no-op (a stale `maude://auth/cancelled` link).
//
// The device code and the token never leave this process: no answer, URL or log line carries
// either, nor the e-mail (it is in a poll answer's body only — the page shows it).

import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { cloudUrl } from '../cloud/endpoints.ts';
import { PROFILE_RE, profileCloudPath } from './cloud.ts';

/** Home's own wait for one attempt (the device code itself lives 15 min). */
export const SIGNIN_WAIT_MS = 10 * 60 * 1000;
export const INVITE_ID_RE = /^[0-9a-f-]{36}$/;
const STATE_RE = /^[0-9a-f]{32}$/;
const USER_CODE_RE = /^(?=.*[A-Z0-9])[A-Z0-9-]{1,16}$/;
const DEVICE_CODE_MAX = 256;
const EMAIL_MAX = 320;
const UNREACHABLE = 'Maude Cloud could not be reached. Try again in a moment.';
const AGAIN = 'Start the Maude Cloud sign-in again.';

export interface HomeAnswer {
  status: number;
  body: unknown;
}

export interface Landing {
  project: string;
  canvas?: string;
  thread?: string;
}

const PROJECT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THREAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A canvas path as a landing may name it: relative, no `..`, no control or quote bytes. */
function cleanCanvas(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > 512) return null;
  if (v.startsWith('/') || v.includes('\\') || v.split('/').some((s) => s === '..' || s === ''))
    return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control bytes is the point
  return /[\u0000-\u001f\u007f"<>]/.test(v) ? null : v;
}

/** `{project, canvas?, thread?}` in its own shape only (thread only with its canvas); else null. */
export function cleanLanding(v: unknown): Landing | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  if (typeof l.project !== 'string' || l.project.length > 128 || !PROJECT_RE.test(l.project))
    return null;
  const canvas = cleanCanvas(l.canvas);
  if (!canvas) return { project: l.project };
  const thread = typeof l.thread === 'string' && THREAD_RE.test(l.thread) ? l.thread : null;
  return { project: l.project, canvas, ...(thread ? { thread } : {}) };
}

/** POST to the control plane; `{status: 0}` when it cannot be reached or answers garbage. */
async function cloudPost(route: string, body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${cloudUrl()}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    const text = await res.text();
    if (text.length > 64 * 1024) return { status: 0, body: null };
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* status-only answer */
    }
    return { status: res.status, body: parsed };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Write `cloud.json` for a profile that has none: tmp file (0600) then a hard link, which fails
 * when the target exists — so a credential already there (another account's) is never replaced,
 * and a reader never sees half a file.
 */
function writeFreshCloudFile(file: string, value: Record<string, unknown>): boolean {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existsSync(file)) return false;
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    linkSync(tmp, file);
    return true;
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
  }
}

const PLATFORM: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

interface Registration {
  profile: string;
  invite: string | null;
  at: number;
}

type Outcome =
  | { status: 'pending' }
  | { status: 'done'; email: string; landing?: Landing }
  | { status: 'expired' }
  | { status: 'cancelled' };

interface Attempt {
  state: string;
  /** dropped (set to null) the moment the attempt ends — never polled again */
  deviceCode: string | null;
  profile: string;
  startedAt: number;
  ended: Outcome | null;
  inflight: Promise<Outcome> | null;
}

export interface HomeSignIn {
  register(body: unknown): HomeAnswer;
  start(body: unknown): Promise<HomeAnswer>;
  poll(body: unknown): Promise<HomeAnswer>;
  cancel(body: unknown): HomeAnswer;
}

export function createHomeSignIn(
  opts: { now?: () => number; newState?: () => string } = {}
): HomeSignIn {
  const now = opts.now ?? Date.now;
  const newState = opts.newState ?? (() => randomBytes(16).toString('hex'));
  let registered: Registration | null = null;
  let attempt: Attempt | null = null;
  /** bumps on every start / registration — an await that comes back to another generation drops */
  let generation = 0;

  const end = (a: Attempt, outcome: Outcome) => {
    a.ended = outcome;
    a.deviceCode = null;
    return outcome;
  };

  function register(body: unknown): HomeAnswer {
    const b = (body ?? {}) as { profile?: unknown; invite?: unknown };
    const profile = typeof b.profile === 'string' ? b.profile : '';
    if (!PROFILE_RE.test(profile) || !profileCloudPath(profile))
      return { status: 400, body: { ok: false, reason: 'bad-profile' } };
    const invite = b.invite ?? null;
    if (invite !== null && (typeof invite !== 'string' || !INVITE_ID_RE.test(invite)))
      return { status: 400, body: { ok: false, reason: 'bad-invite' } };
    generation += 1;
    if (attempt && !attempt.ended) end(attempt, { status: 'cancelled' });
    attempt = null;
    registered = { profile, invite: invite as string | null, at: now() };
    return { status: 200, body: { ok: true } };
  }

  async function start(body: unknown): Promise<HomeAnswer> {
    const b = (body ?? {}) as { profile?: unknown; forInvite?: unknown };
    const reg = registered;
    const refused = { status: 403, body: { ok: false, reason: 'not-prepared', error: AGAIN } };
    if (!reg || now() - reg.at > SIGNIN_WAIT_MS) return refused;
    if (b.profile !== undefined && b.profile !== reg.profile) return refused;
    if (b.forInvite !== undefined && b.forInvite !== null && b.forInvite !== reg.invite)
      return refused;
    // a second start cancels the first, before anything is awaited
    const gen = ++generation;
    if (attempt && !attempt.ended) end(attempt, { status: 'cancelled' });
    attempt = null;

    const r = await cloudPost('/auth/device/code', {
      client: `Maude on ${PLATFORM[process.platform] ?? process.platform}`,
    });
    const c = (r.body ?? {}) as { device_code?: unknown; user_code?: unknown };
    const ok =
      r.status === 200 &&
      typeof c.device_code === 'string' &&
      c.device_code.length > 0 &&
      c.device_code.length <= DEVICE_CODE_MAX &&
      typeof c.user_code === 'string' &&
      USER_CODE_RE.test(c.user_code);
    if (!ok) return { status: 502, body: { ok: false, reason: 'unreachable', error: UNREACHABLE } };
    // another start or registration ran while we waited: this one is already superseded
    if (gen !== generation || registered !== reg) return refused;
    const state = newState();
    attempt = {
      state,
      deviceCode: c.device_code as string,
      profile: reg.profile,
      startedAt: now(),
      ended: null,
      inflight: null,
    };
    return {
      status: 200,
      body: { ok: true, userCode: c.user_code, state, expiresIn: SIGNIN_WAIT_MS / 1000 },
    };
  }

  async function tick(a: Attempt): Promise<Outcome> {
    if (a.ended) return a.ended;
    if (now() - a.startedAt > SIGNIN_WAIT_MS || !a.deviceCode) return end(a, { status: 'expired' });
    const gen = generation;
    const r = await cloudPost('/auth/device/token', { device_code: a.deviceCode });
    // cancelled, superseded or re-registered while the cloud answered: that answer is not used
    if (a.ended) return a.ended;
    if (gen !== generation || attempt !== a) return end(a, { status: 'cancelled' });
    if (r.status === 202) return { status: 'pending' };
    if (r.status === 400 && (r.body as { error?: unknown } | null)?.error === 'expired')
      return end(a, { status: 'expired' });
    const t = (r.body ?? {}) as {
      token?: unknown;
      account?: { email?: unknown };
      landing?: unknown;
    };
    if (r.status !== 200 || typeof t.token !== 'string' || !t.token.startsWith('mpt_'))
      return { status: 'pending' }; // offline / 5xx / garbage: the attempt waits, it does not die
    const email = typeof t.account?.email === 'string' ? t.account.email.slice(0, EMAIL_MAX) : '';
    const file = profileCloudPath(a.profile);
    const written =
      !!file &&
      writeFreshCloudFile(file, {
        url: cloudUrl(),
        token: t.token,
        ...(email ? { email } : {}),
        connectedAt: now(),
      });
    // the registration is spent either way: the next sign-in goes through Rust again
    registered = null;
    if (!written) return end(a, { status: 'expired' }); // "Nothing changed on this Mac"
    const landing = cleanLanding(t.landing);
    return end(a, { status: 'done', email, ...(landing ? { landing } : {}) });
  }

  async function poll(body: unknown): Promise<HomeAnswer> {
    const state = (body as { state?: unknown } | null)?.state;
    const a = attempt;
    if (!a || typeof state !== 'string' || !STATE_RE.test(state) || state !== a.state)
      return { status: 409, body: { reason: 'stale-state' } };
    // one cloud call at a time per attempt: a nudge-driven poll joins the one in flight
    if (!a.inflight)
      a.inflight = tick(a).finally(() => {
        a.inflight = null;
      });
    return { status: 200, body: await a.inflight };
  }

  function cancel(body: unknown): HomeAnswer {
    const state = (body as { state?: unknown } | null)?.state;
    const a = attempt;
    if (a && !a.ended && typeof state === 'string' && state === a.state)
      end(a, { status: 'cancelled' });
    return { status: 200, body: { ok: true } };
  }

  return { register, start, poll, cancel };
}
