// home/cloud.ts — Home's cloud data source (V2-1.1 §5.7).
//
//   GET /_home/cloud?profile=<id>        → that profile's projects + "Shared with you"
//   POST /_home/cloud/prepare            → the project route /_api/projects/prepare's code, for a
//                                          project not on this Mac yet
//
// Each profile signs in on its own (V2-3.1): its device token lives in its own `cloud.json`
//   default → cloudConfigPath() (the file every 1.x studio already uses; $MAUDE_CLOUD_CONFIG honoured)
//   <id>    → $XDG_CONFIG_HOME|~/.config /maude/profiles/<id>/cloud.json
// The token never leaves this process: the page gets rows, never a credential, and no route takes a
// URL to send it to — the control plane is $MAUDE_CLOUD_URL, as for every other cloud call.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { cloudConfigPath, cloudUrl } from '../cloud/endpoints.ts';
import {
  type PreparedProject,
  type PrepareResult,
  prepareManagedProject,
} from '../managed-projects.ts';
import { hubsConfigPath } from '../sync/hubs-config.ts';

export const PROFILE_RE = /^[a-z0-9-]{1,32}$/;
/** A maude:// handoff code — the same grammar `cloud/endpoints.ts` `openManagedCode` checks. */
export const HANDOFF_CODE_RE = /^mhc_[0-9a-f]{16,128}$/;
export const CLOUD_CACHE_MS = 60_000;
const MAX_CLOUD_BYTES = 1024 * 1024;
const MAX_ROWS = 500;

export function profileCloudPath(profile: string): string | null {
  if (!PROFILE_RE.test(profile)) return null;
  if (profile === 'default') return cloudConfigPath();
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'maude', 'profiles', profile, 'cloud.json');
}

/**
 * The profile's `hubs.json` — where a hub credential it obtains is stored (N-H1). The same rule as
 * `profiles.rs` `paths_in`: default → `hubsConfigPath()` (the 1.x file), any other profile →
 * `<XDG_CONFIG_HOME|~/.config>/maude/profiles/<id>/hubs.json`. The Home process serves every
 * profile, so it never reads its own process-global path for one that is not default.
 */
export function profileHubsPath(profile: string): string | null {
  if (!PROFILE_RE.test(profile)) return null;
  if (profile === 'default') return hubsConfigPath();
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'maude', 'profiles', profile, 'hubs.json');
}

function profileToken(profile: string): string | null {
  const p = profileCloudPath(profile);
  if (!p || !existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as { token?: unknown };
    return typeof parsed.token === 'string' && parsed.token ? parsed.token : null;
  } catch {
    return null; // malformed → signed out, as cloud/endpoints.ts reads it
  }
}

const str = (v: unknown, n: number): string | null =>
  typeof v === 'string' ? v.slice(0, n) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ROLES = new Set(['owner', 'admin', 'member', 'viewer', 'observer']);

/** Only the fields §5.7 names, clamped — the control plane's body reaches a renderer. */
function cleanProject(v: unknown) {
  const p = (v ?? {}) as Record<string, unknown>;
  const id = str(p.id, 128);
  if (!id) return null;
  const role = str(p.role, 16);
  return {
    id,
    name: str(p.name, 200) ?? id,
    role: role && ROLES.has(role) ? role : null,
    ownerName: str(p.ownerName, 200),
    state: str(p.state, 32),
    url: str(p.url, 512),
    updatedAt: num(p.updatedAt),
  };
}

function cleanShared(v: unknown) {
  const s = (v ?? {}) as Record<string, unknown>;
  const projectId = str(s.projectId, 128);
  if (!projectId) return null;
  const c = s.canvas as Record<string, unknown> | null | undefined;
  const role = str(s.role, 16);
  return {
    projectId,
    projectName: str(s.projectName, 200) ?? projectId,
    ownerName: str(s.ownerName, 200),
    canvas:
      c && typeof c === 'object' && str(c.path, 512)
        ? { path: str(c.path, 512), name: str(c.name, 200) }
        : null,
    role: role === 'observer' || role === 'viewer' || role === 'member' ? role : 'observer',
    grantedAt: num(s.grantedAt),
    grantedBy: str(s.grantedBy, 200),
  };
}

export interface CloudListing {
  ok: boolean;
  profile: string;
  signedIn: boolean;
  /** the control plane could not be reached — these rows are the last good answer (or empty) */
  offline?: boolean;
  /** the control plane has no /api/home yet: projects only, no `shared` */
  fallback?: boolean;
  account: { email: string | null } | null;
  projects: NonNullable<ReturnType<typeof cleanProject>>[];
  shared: NonNullable<ReturnType<typeof cleanShared>>[];
  fetchedAt: number;
  error?: string;
}

async function getCapped(url: string, token: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_CLOUD_BYTES) return { status: 0, body: null };
    const text = await res.text();
    if (text.length > MAX_CLOUD_BYTES) return { status: 0, body: null };
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* a non-JSON answer is a status-only answer */
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

export interface HomeCloud {
  listing(profile: string): Promise<CloudListing | { ok: false; status: 400; error: string }>;
  prepare(body: Record<string, unknown>): Promise<PrepareResult>;
}

export function createHomeCloud(opts: { now?: () => number } = {}): HomeCloud {
  const now = opts.now ?? Date.now;
  // per profile: the last good answer, keyed by the token it was fetched with (a re-sign-in as
  // someone else must never be served the previous account's rows)
  const cache = new Map<string, { tokenHash: string; at: number; value: CloudListing }>();
  const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

  async function listing(profile: string) {
    if (!PROFILE_RE.test(profile))
      return { ok: false as const, status: 400 as const, error: 'bad profile' };
    const token = profileToken(profile);
    const empty = (extra: Partial<CloudListing>): CloudListing => ({
      ok: false,
      profile,
      signedIn: false,
      account: null,
      projects: [],
      shared: [],
      fetchedAt: now(),
      ...extra,
    });
    if (!token) {
      cache.delete(profile);
      return empty({ error: 'Sign in to Maude Cloud first.' });
    }
    const th = tokenHash(token);
    const hit = cache.get(profile);
    if (hit && hit.tokenHash === th && now() - hit.at < CLOUD_CACHE_MS) return hit.value;

    const base = cloudUrl();
    let r = await getCapped(`${base}/api/home`, token);
    let fallback = false;
    if (r.status === 404) {
      fallback = true;
      r = await getCapped(`${base}/api/projects`, token);
    }
    if (r.status === 401 || r.status === 403) {
      cache.delete(profile);
      return empty({ error: 'This device was disconnected. Sign in again.' });
    }
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
      // offline / 5xx / garbage → the last good answer for THIS token, flagged
      if (hit && hit.tokenHash === th) return { ...hit.value, offline: true };
      return empty({ signedIn: true, offline: true, error: 'Maude Cloud could not be reached.' });
    }
    const b = r.body as { account?: { email?: unknown }; projects?: unknown; shared?: unknown };
    const value: CloudListing = {
      ok: true,
      profile,
      signedIn: true,
      ...(fallback ? { fallback } : {}),
      account: b.account ? { email: str(b.account.email, 320) } : null,
      projects: (Array.isArray(b.projects) ? b.projects.slice(0, MAX_ROWS) : [])
        .map(cleanProject)
        .filter((p): p is NonNullable<typeof p> => !!p),
      shared: fallback
        ? []
        : (Array.isArray(b.shared) ? b.shared.slice(0, MAX_ROWS) : [])
            .map(cleanShared)
            .filter((s): s is NonNullable<typeof s> => !!s),
      fetchedAt: now(),
    };
    cache.set(profile, { tokenHash: th, at: now(), value });
    return value;
  }

  /**
   * `{ profile, server?, projectId, code? }` → the project route's own `prepareManagedProject`,
   * with THAT profile's `cloud.json`: kind `cloud` (the device token), or — with a maude://
   * handoff `code` — kind `handoff`, `projectId` as the link's claimed project (a mismatch is the
   * shared code's own 409). `server` is not trusted for anything: the token and the code are only
   * ever sent to the configured control plane, which names the project's server itself. The code
   * rides in that POST body only — never a URL, never a log line.
   */
  async function prepare(
    body: Record<string, unknown>
  ): Promise<PrepareResult | (PreparedProject & { profile: string })> {
    const profile = typeof body.profile === 'string' ? body.profile : '';
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const cfgPath = profileCloudPath(profile);
    const hubsPath = profileHubsPath(profile);
    if (!cfgPath || !hubsPath) return { ok: false, error: 'unknown profile', status: 400 };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId))
      return { ok: false, error: 'unknown project', status: 400 };
    // N-H1: the hub credential the exchange obtains goes to THIS profile's hubs.json, and the
    // answer names the profile, so the shell binds the local copy to it before it spawns.
    const opts = { cloudConfigPath: cfgPath, hubsConfigPath: hubsPath };
    let r: PrepareResult;
    if (body.code !== undefined) {
      const code = body.code;
      if (typeof code !== 'string' || !HANDOFF_CODE_RE.test(code))
        return { ok: false, error: 'That link is not valid.', status: 400 };
      r = await prepareManagedProject(
        {},
        { kind: 'handoff', code, claimedProject: projectId },
        opts
      );
    } else {
      r = await prepareManagedProject({}, { kind: 'cloud', projectId }, opts);
    }
    return r.ok ? { ...r, profile } : r;
  }

  return { listing, prepare };
}
