// Preparing a MANAGED project — plan T19–T22 (DDR-241 follow-on).
//
// A designer who was added to a project should be able to open it without
// choosing a folder, having Git, or pasting a token. The desktop does that in
// two halves:
//
//   1. HERE (the running studio, which holds the Maude Cloud device session or
//      a team-server credential the browser sign-in already stored): obtain the
//      hub credential, then ask the project what it looks like (its bootstrap)
//      — name, canvas groups — so the local copy can be declared correctly
//      before it exists. Issue #204: the desktop owns NO login method for a
//      team server — no email, no password. A team server is signed in to on
//      its OWN page (routes/hub-signin.ts); `known-hub` opens what that stored.
//   2. The native shell (`managed_project_open`) creates the project's own
//      copy under the app's data directory from exactly what this returns,
//      and switches to it; the sync runtime then brings everything down.
//
// Nothing here writes into the folder this studio is serving.

import { createCloudEndpoints } from './cloud/endpoints.ts';
import type { Context } from './context.ts';
import { getHubRecord, normalizeUrl } from './sync/hubs-config.ts';

export type PrepareInput =
  | { kind: 'cloud'; projectId: string }
  | { kind: 'handoff'; code: string; claimedProject?: string }
  /** A team server this machine already holds a credential for (the browser sign-in stored it). */
  | { kind: 'known-hub'; url: string };

/** The words for an email or password sent to open a team-server project — the app takes neither
 *  (issue #204). Signing in is the hub's own page; the one fallback is the pasted access token. */
export const NO_PASSWORD_WORDS = "Sign in on the team server's own page — press Sign in.";

export type PrepareBody =
  | { ok: true; input: PrepareInput }
  | { ok: false; status: 400; error: string; reason?: 'password-retired' };

/** True for a body that carries a team-server email or password, or the retired `hub` kind. */
function carriesPassword(b: Record<string, unknown>): boolean {
  return b.email !== undefined || b.password !== undefined || b.kind === 'hub';
}

/** `POST /_api/projects/prepare` body → a typed input, or a plain 400. Anything carrying an email
 *  or a password is refused for EVERY kind before an input is built — the secret is never read,
 *  forwarded or echoed. */
export function parsePrepareBody(body: unknown): PrepareBody {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (carriesPassword(b))
    return { ok: false, status: 400, reason: 'password-retired', error: NO_PASSWORD_WORDS };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (b.kind) {
    case 'cloud':
      return { ok: true, input: { kind: 'cloud', projectId: str(b.projectId) } };
    case 'handoff':
      return {
        ok: true,
        input: {
          kind: 'handoff',
          code: str(b.code),
          claimedProject: str(b.claimedProject) || undefined,
        },
      };
    case 'known-hub':
      return { ok: true, input: { kind: 'known-hub', url: str(b.url) } };
    default:
      return { ok: false, status: 400, error: 'unknown kind' };
  }
}

export interface PreparedProject {
  ok: true;
  serverUrl: string;
  /** Stable id on that server — the managed copy is keyed by (server, id). */
  projectId: string;
  name: string;
  role: string | null;
  canvasGroups: string[];
  /** The project's save mode, when the server says ('transactions' | 'legacy'). */
  mode: string | null;
}

export type PrepareResult =
  | PreparedProject
  | {
      ok: false;
      error: string;
      status: number;
      /** S9.17b: a Can view account's `409 browser-door` — `url` is a validated cell front door
       *  (cloud/endpoints.ts); the page opens it as a cell tab. No credential was stored. */
      reason?: 'browser-door';
      url?: string;
    };

const GROUP = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,59}$/u;

/** Canvas groups a project uses, from its manifest when it does not declare them. */
export function groupsFromBootstrap(boot: {
  canvasGroups?: unknown;
  docs?: { path: string | null; retired?: boolean }[];
  dirs?: string[];
}): string[] {
  const out = new Set<string>();
  const add = (g: unknown) => {
    if (typeof g === 'string' && GROUP.test(g)) out.add(g);
  };
  if (Array.isArray(boot.canvasGroups)) {
    for (const g of boot.canvasGroups)
      add(typeof g === 'string' ? g : (g as { path?: unknown })?.path);
  }
  for (const d of boot.docs ?? []) {
    if (d.retired || !d.path) continue;
    const first = d.path.split('/')[0];
    if (d.path.includes('/')) add(first);
  }
  for (const dir of boot.dirs ?? []) add(dir.split('/')[0]);
  if (out.size === 0) {
    out.add('system');
    out.add('ui');
  }
  return [...out].slice(0, 32);
}

function sameServer(a: string | undefined, b: string): boolean {
  if (!a) return false;
  try {
    return normalizeUrl(a) === normalizeUrl(b);
  } catch {
    return false;
  }
}

async function bootstrapOf(
  url: string,
  token: string,
  doFetch: typeof fetch = fetch
): Promise<Record<string, unknown> | null> {
  try {
    const res = await doFetch(`${url}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** What preparing needs from its caller: a project server passes its Context; the Home server
 *  (V2-3.3), which serves no project, passes nothing but the profile's `cloud.json`. */
export interface PrepareCtx {
  cfg?: { linkedHub?: { url?: string } | null };
  syncControl?: Context['syncControl'];
}

export async function prepareManagedProject(
  ctx: PrepareCtx,
  input: PrepareInput,
  /** `hubsConfigPath`: where the hub credential is stored and read back (N-H1 — Home prepares
   *  for one profile at a time, so never the process-global file for another profile).
   *  `fetchImpl` (S6.6): every request to a team server goes through it — Home passes one that
   *  refuses redirects, so a 307 can never carry the token to another host. */
  opts: { cloudConfigPath?: string; hubsConfigPath?: string; fetchImpl?: typeof fetch } = {}
): Promise<PrepareResult> {
  // A caller outside the types can still hand over a retired shape (an email, a password, the old
  // `hub` kind): refused before any request, here as well as at the route.
  if (carriesPassword(input as unknown as Record<string, unknown>))
    return { ok: false, error: NO_PASSWORD_WORDS, status: 400 };
  let serverUrl: string;
  let projectId: string | null = null;
  let role: string | null = null;
  let name: string | null = null;

  if (input.kind === 'cloud' || input.kind === 'handoff') {
    // openManaged / openManagedCode read no project path — only the device session
    const cloud = createCloudEndpoints({
      paths: { repoRoot: '', designRoot: '' },
      cloudConfigPath: opts.cloudConfigPath,
      hubsConfigPath: opts.hubsConfigPath,
    });
    const r =
      input.kind === 'cloud'
        ? await cloud.openManaged(input.projectId)
        : await cloud.openManagedCode(input.code, input.claimedProject);
    const j = r.json as {
      ok?: boolean;
      url?: string;
      role?: string;
      project?: string;
      error?: string;
      reason?: string;
    };
    if (!j.ok && j.reason === 'browser-door' && typeof j.url === 'string') {
      return {
        ok: false,
        status: 409,
        reason: 'browser-door',
        url: j.url,
        error: j.error ?? 'The project could not be opened.',
      };
    }
    if (!j.ok || !j.url)
      return { ok: false, error: j.error ?? 'The project could not be opened.', status: r.status };
    serverUrl = j.url;
    projectId = j.project ?? (input.kind === 'cloud' ? input.projectId : null);
    role = j.role ?? null;
    name = projectId;
  } else {
    try {
      serverUrl = normalizeUrl(input.url);
    } catch {
      return { ok: false, error: "That doesn't look like a workspace address.", status: 400 };
    }
    if (!getHubRecord(serverUrl, opts.hubsConfigPath)?.token) {
      return { ok: false, error: 'Sign in to that workspace first.', status: 401 };
    }
  }

  const token = getHubRecord(serverUrl, opts.hubsConfigPath)?.token;
  if (!token)
    return { ok: false, error: 'The sign-in could not be saved on this computer.', status: 500 };
  const boot = await bootstrapOf(serverUrl, token, opts.fetchImpl);
  if (boot && typeof boot.projectId === 'string') projectId ??= boot.projectId;
  // SIGN IN AGAIN (T20): a new credential for the server this studio is
  // already syncing with. Reopening the same project attaches to this very
  // process (the shell never starts a second one for a running project), and
  // the running runtime still holds the credential the project refused — so
  // cycle it onto the one just stored. The link is unchanged and never re-read
  // from disk; only the credential is new, and this process wrote it.
  if (input.kind !== 'known-hub' && sameServer(ctx.cfg?.linkedHub?.url, serverUrl)) {
    try {
      await ctx.syncControl?.restart();
    } catch (err) {
      console.error('[managed] could not restart sync on the new sign-in:', err);
    }
  }
  const host = new URL(serverUrl).host;
  projectId ??= host;
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(projectId)) projectId = host.replace(/[^A-Za-z0-9._-]/g, '-');
  return {
    ok: true,
    serverUrl,
    projectId,
    name: name ?? (projectId === 'local' ? host : projectId),
    role,
    canvasGroups: groupsFromBootstrap((boot ?? {}) as Parameters<typeof groupsFromBootstrap>[0]),
    mode: boot && typeof boot.mode === 'string' ? boot.mode : null,
  };
}
