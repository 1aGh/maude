// Preparing a MANAGED project — plan T19–T22 (DDR-241 follow-on).
//
// A designer who was added to a project should be able to open it without
// choosing a folder, having Git, or pasting a token. The desktop does that in
// two halves:
//
//   1. HERE (the running studio, which holds the Maude Cloud device session or
//      takes a team-server sign-in): obtain and store the hub credential, then
//      ask the project what it looks like (its bootstrap) — name, canvas
//      groups — so the local copy can be declared correctly before it exists.
//   2. The native shell (`managed_project_open`) creates the project's own
//      copy under the app's data directory from exactly what this returns,
//      and switches to it; the sync runtime then brings everything down.
//
// Nothing here writes into the folder this studio is serving.

import type { Context } from './context.ts';
import { createCloudEndpoints } from './cloud/endpoints.ts';
import { getHubRecord, normalizeUrl } from './sync/hubs-config.ts';
import { signInToWorkspace } from './sync/workspace-signin.ts';

export type PrepareInput =
  | { kind: 'cloud'; projectId: string }
  | { kind: 'handoff'; code: string; claimedProject?: string }
  | { kind: 'hub'; url: string; email: string; password: string }
  /** A team server this machine already holds a credential for. */
  | { kind: 'known-hub'; url: string };

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

export type PrepareResult = PreparedProject | { ok: false; error: string; status: number };

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
    for (const g of boot.canvasGroups) add(typeof g === 'string' ? g : (g as { path?: unknown })?.path);
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

async function bootstrapOf(
  url: string,
  token: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${url}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function prepareManagedProject(
  ctx: Context,
  input: PrepareInput
): Promise<PrepareResult> {
  let serverUrl: string;
  let projectId: string | null = null;
  let role: string | null = null;
  let name: string | null = null;

  if (input.kind === 'cloud' || input.kind === 'handoff') {
    const cloud = createCloudEndpoints(ctx);
    const r =
      input.kind === 'cloud'
        ? await cloud.openManaged(input.projectId)
        : await cloud.openManagedCode(input.code, input.claimedProject);
    const j = r.json as { ok?: boolean; url?: string; role?: string; project?: string; error?: string };
    if (!j.ok || !j.url) return { ok: false, error: j.error ?? 'The project could not be opened.', status: r.status };
    serverUrl = j.url;
    projectId = j.project ?? (input.kind === 'cloud' ? input.projectId : null);
    role = j.role ?? null;
    name = projectId;
  } else if (input.kind === 'hub') {
    const r = await signInToWorkspace({ url: input.url, email: input.email, password: input.password });
    if (!r.json.ok) return { ok: false, error: r.json.error, status: r.status };
    serverUrl = r.json.url;
    role = r.json.user.role;
  } else {
    try {
      serverUrl = normalizeUrl(input.url);
    } catch {
      return { ok: false, error: "That doesn't look like a workspace address.", status: 400 };
    }
    if (!getHubRecord(serverUrl)?.token) {
      return { ok: false, error: 'Sign in to that workspace first.', status: 401 };
    }
  }

  const token = getHubRecord(serverUrl)?.token;
  if (!token) return { ok: false, error: 'The sign-in could not be saved on this computer.', status: 500 };
  const boot = await bootstrapOf(serverUrl, token);
  if (boot && typeof boot.projectId === 'string') projectId ??= boot.projectId;
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
