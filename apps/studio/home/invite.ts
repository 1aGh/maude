// home/invite.ts — Home's invite proxy (S6.5; contract S6-S9-signin-invite-home §5.3). A
// `maude://invite/<id>` reaches Home (S6.7), and the page asks:
//
//   POST /_home/invite/peek {id}             → what the public invite page shows (no credential sent)
//   POST /_home/invite/accept {id, profile}  → that profile's device token buys a one-time handoff
//                                              code + the landing; the page trades the code on the
//                                              existing /_home/cloud/prepare lane (S6.11)
//
// The id rides in the POST body here and only in the cloud API's own path; the device token is
// read from the profile's `cloud.json` and sent only to the configured control plane. Refusals
// pass through as the cloud words them — another account's 403 unchanged (`{reason, email}`: the
// invite's own address, which peek already showed).

import { cloudUrl } from '../cloud/endpoints.ts';
import { HANDOFF_CODE_RE, PROFILE_RE, profileToken } from './cloud.ts';
import { cleanLanding, type HomeAnswer, INVITE_ID_RE } from './signin.ts';

/** A project id as the cloud mints them (the same grammar `/_home/cloud/prepare` checks). */
const PROJECT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const UNREACHABLE = {
  ok: false,
  reason: 'unreachable',
  error: 'Maude Cloud could not be reached. Try again in a moment.',
};
const ROLES = new Set(['observer', 'viewer', 'member']);
const MAX_BYTES = 64 * 1024;

const str = (v: unknown, n: number): string | null =>
  typeof v === 'string' ? v.slice(0, n) : null;

/** The cloud's refusal in its own words: only `reason` and `error` (strings), clamped. */
function refusal(body: unknown): Record<string, string> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const reason = str(b.reason, 64);
  const error = str(b.error, 500);
  if (reason) out.reason = reason;
  if (error) out.error = error;
  return out;
}

async function cloudCall(
  route: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown }
): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${cloudUrl()}${route}`, {
      method: init.method,
      headers: {
        accept: 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}`, 'x-maude-access': '2' } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    const text = await res.text();
    if (text.length > MAX_BYTES) return { status: 0, body: null };
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* status-only answer */
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

const inviteId = (body: unknown): string | null => {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === 'string' && INVITE_ID_RE.test(id) ? id : null;
};

export interface HomeInvite {
  peek(body: unknown): Promise<HomeAnswer>;
  accept(body: unknown): Promise<HomeAnswer>;
  /** Home › Shared with you: accept / decline the invitation addressed to the profile's account (no invite id). */
  pendingAccept(body: unknown): Promise<HomeAnswer>;
  pendingLeave(body: unknown): Promise<HomeAnswer>;
}

export function createHomeInvite(opts: { forget?: (profile: string) => void } = {}): HomeInvite {
  async function peek(body: unknown): Promise<HomeAnswer> {
    const id = inviteId(body);
    if (!id) return { status: 400, body: { ok: false, reason: 'bad-invite' } };
    const r = await cloudCall(`/api/invites/${id}/peek`, { method: 'GET' });
    if (r.status === 404 || r.status === 429) return { status: r.status, body: refusal(r.body) };
    const p = (r.body ?? {}) as Record<string, unknown>;
    const projectName = str(p.projectName, 200);
    const email = str(p.email, 320);
    const role = str(p.role, 16);
    if (r.status !== 200 || !projectName || !email || !role || !ROLES.has(role))
      return { status: 502, body: UNREACHABLE };
    const c = p.canvas as Record<string, unknown> | null | undefined;
    const canvas =
      c && typeof c === 'object' && str(c.path, 512)
        ? { path: str(c.path, 512), name: str(c.name, 200) }
        : null;
    const thread =
      canvas && typeof p.thread === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.thread)
        ? p.thread
        : null;
    return {
      status: 200,
      body: {
        ok: true,
        projectName,
        fromName: str(p.fromName, 200),
        email,
        role,
        ...(canvas ? { canvas } : {}),
        ...(thread ? { thread } : {}),
      },
    };
  }

  async function accept(body: unknown): Promise<HomeAnswer> {
    const id = inviteId(body);
    const profile = (body as { profile?: unknown } | null)?.profile;
    if (!id || typeof profile !== 'string' || !PROFILE_RE.test(profile))
      return { status: 400, body: { ok: false, reason: 'bad-invite' } };
    const signedOut = { status: 401, body: { ok: false, reason: 'signed-out' } };
    const token = profileToken(profile);
    if (!token) return signedOut;
    const r = await cloudCall(`/api/invites/${id}/accept`, { method: 'POST', token });
    if (r.status === 401) return signedOut;
    if (r.status === 403) {
      // another account: unchanged — the reason and the invite's own address, nothing else
      const b = (r.body ?? {}) as Record<string, unknown>;
      return {
        status: 403,
        body: {
          ...(str(b.reason, 64) ? { reason: str(b.reason, 64) } : {}),
          ...(str(b.email, 320) ? { email: str(b.email, 320) } : {}),
        },
      };
    }
    if (r.status === 404 || r.status === 426 || r.status === 429)
      return { status: r.status, body: refusal(r.body) };
    const a = (r.body ?? {}) as { code?: unknown; landing?: unknown };
    const landing = cleanLanding(a.landing);
    if (r.status !== 200 || typeof a.code !== 'string' || !HANDOFF_CODE_RE.test(a.code) || !landing)
      return { status: 502, body: UNREACHABLE };
    return { status: 200, body: { ok: true, code: a.code, landing } };
  }

  /**
   * `{profile, projectId, canvas?}` → the cloud's `POST /api/invites/pending/accept|leave` with that profile's device
   * token. The invitation is named by project (and canvas) — the account's own address is the key on the cloud side,
   * so no invite id is ever read, sent or returned here. The profile's cached listing is dropped on success so the
   * next read no longer shows the row.
   */
  async function pending(verb: 'accept' | 'leave', body: unknown): Promise<HomeAnswer> {
    const b = (body ?? {}) as Record<string, unknown>;
    const profile = b.profile;
    const projectId = b.projectId;
    const canvas = b.canvas ?? null;
    if (
      typeof profile !== 'string' ||
      !PROFILE_RE.test(profile) ||
      typeof projectId !== 'string' ||
      projectId.length > 128 ||
      !PROJECT_ID_RE.test(projectId) ||
      (canvas !== null && (typeof canvas !== 'string' || canvas.length > 512))
    )
      return { status: 400, body: { ok: false, reason: 'bad-invite' } };
    const signedOut = { status: 401, body: { ok: false, reason: 'signed-out' } };
    const token = profileToken(profile);
    if (!token) return signedOut;
    const r = await cloudCall(`/api/invites/pending/${verb}`, {
      method: 'POST',
      token,
      body: { projectId, canvas },
    });
    if (r.status === 401) return signedOut;
    if (r.status === 404 || r.status === 426 || r.status === 429) {
      // gone: the list is stale — the next read fixes it
      if (r.status === 404) opts.forget?.(profile);
      return { status: r.status, body: refusal(r.body) };
    }
    if (verb === 'leave') {
      if (r.status !== 200) return { status: 502, body: UNREACHABLE };
      opts.forget?.(profile);
      return { status: 200, body: { ok: true } };
    }
    const a = (r.body ?? {}) as { code?: unknown; landing?: unknown };
    const landing = cleanLanding(a.landing);
    if (r.status !== 200 || typeof a.code !== 'string' || !HANDOFF_CODE_RE.test(a.code) || !landing)
      return { status: 502, body: UNREACHABLE };
    opts.forget?.(profile);
    return { status: 200, body: { ok: true, code: a.code, landing } };
  }

  return {
    peek,
    accept,
    pendingAccept: (b) => pending('accept', b),
    pendingLeave: (b) => pending('leave', b),
  };
}
