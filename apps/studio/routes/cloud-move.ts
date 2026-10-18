// Move to cloud — S6.0b, contract S6-S9 §5.5. `POST /_api/cloud/move` turns THIS local folder
// into a cloud project in the background; `GET /_api/cloud/move` reports how far it got.
//
// MAIN ORIGIN ONLY (`origin: 'main'` — never in CANVAS_SAFE_API nor routes/canvas-origin.ts): it
// spends the device token, creates a paid-plan object and links the folder, which is exactly what
// the untrusted canvas origin (DDR-054) must never reach. `guardTableRoute` adds the CSRF
// (`sameOriginWrite` / `sameOriginRead`) and DNS-rebind (`isTrustedRequestHost`) gates. A cell
// never serves it (apps/hub/src/studio-manifest.mjs: REFUSED) — a cell IS the cloud.
//
// Order (§5.5): create the cloud project (`POST <cloud>/api/projects {name}`, Bearer device
// token) → poll `GET <cloud>/api/projects` until `active` → open it and exchange at the cell
// (stores the hub credential, writes nothing in the folder) → raise the hub format marker to the
// local one (V2-1.12 §5.2, raise-only, BEFORE the first seed-up) → attach (linkedHub + the live
// sync runtime's seed-up, cloud/endpoints.ts). The canvas never waits: the POST answers once the
// cloud project exists and the rest runs here. A failure leaves the folder local, `failed`, with
// words; the next POST resumes the SAME cloud project — one folder never makes two.
//
// What leaves this Mac is decided by the sync runtime's file plane (sync/file-membership.ts
// `isRuntimeStateRel` is its `never` half); this route uploads nothing itself, and its progress
// file `_state/cloud-move.json` is in that ignored class (DDR-115, no list changes). The file
// holds no credential — only the project id, the cell address and words.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boundCloudToken, cloudConfigPath } from '../cloud/config-path.ts';
import { type CloudEndpointResult, cloudUrl } from '../cloud/endpoints.ts';
import { createHubFormatClient } from '../migrate/hub.ts';
import { getHubRecord, normalizeUrl } from '../sync/hubs-config.ts';
import type { RouteSpec } from './table.ts';

export type MoveState = 'idle' | 'provisioning' | 'linking' | 'uploading' | 'ready' | 'failed';

export interface CloudMoveDeps {
  designRoot: string;
  /** config.json `name` — the default cloud project name */
  projectName: () => string | null | undefined;
  /** the folder's own format marker (config.json `formatVersion ?? 1`) */
  localFormat: () => number;
  /** the attach lane (cloud/endpoints.ts) — the one place a hub credential and linkedHub are written */
  cloud: {
    openManaged(projectId: string): Promise<CloudEndpointResult>;
    attach(projectId: string): Promise<CloudEndpointResult>;
  };
  /** this profile's cloud.json (V2-3.3); absent = `cloudConfigPath()` */
  cloudConfigPath?: () => string;
  /** this profile's hubs.json; absent = `hubsConfigPath()` */
  hubsConfigPath?: string;
  /** seams for tests */
  fetchImpl?: typeof fetch;
  pollMs?: number;
  activeTimeoutMs?: number;
}

interface MoveFile {
  v: 1;
  state: Exclude<MoveState, 'idle'>;
  project: string;
  name: string;
  /** the cell address, once the exchange named it */
  hub?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 120;

// CONTRACT §3–§4 voice. Every failure says the work is safe where it is.
const WORDS = {
  plan: 'Choose a plan to keep editing.',
  offline: 'Maude Cloud could not be reached. Your work is still on this Mac.',
  signedOut:
    'Sign in to Maude Cloud again to finish moving this project. Your work is still on this Mac.',
  slow: 'Maude Cloud is still setting up the project. Try Move to cloud again in a few minutes.',
  gone: 'The cloud project is no longer there. Your work is still on this Mac.',
  open: 'The cloud project could not be opened. Your work is still on this Mac.',
  format:
    'The team server needs an update before this project can move to Maude 2. Your work is still on this Mac.',
  stopped:
    'Moving to the cloud stopped before it finished. Try again — your work is still on this Mac.',
};

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

class MoveFailure extends Error {}

export function createCloudMoveRoutes(deps: CloudMoveDeps): RouteSpec[] {
  const stateFile = () => join(deps.designRoot, '_state', 'cloud-move.json');
  const doFetch = (url: string, init?: RequestInit) => (deps.fetchImpl ?? fetch)(url, init);
  const pollMs = deps.pollMs ?? 3000;
  const activeTimeoutMs = deps.activeTimeoutMs ?? 10 * 60_000;

  /** The job this process is running for the folder, if any. */
  let running: Promise<void> | null = null;
  /** Serialises POSTs: two concurrent calls must not both create a cloud project. */
  let gate: Promise<unknown> = Promise.resolve();

  function readFile(): MoveFile | null {
    try {
      const f = JSON.parse(readFileSync(stateFile(), 'utf8')) as MoveFile;
      return f && f.v === 1 && typeof f.project === 'string' && PROJECT_ID.test(f.project)
        ? f
        : null;
    } catch {
      return null;
    }
  }

  function writeFile(f: MoveFile): void {
    const p = stateFile();
    const dir = join(deps.designRoot, '_state');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(f, null, 2)}\n`, 'utf8');
    renameSync(tmp, p);
  }

  function update(f: MoveFile, patch: Partial<MoveFile>): MoveFile {
    const next: MoveFile = { ...f, ...patch, updatedAt: Date.now() };
    if (patch.state && patch.state !== 'failed') next.error = undefined; // JSON.stringify drops it
    writeFile(next);
    return next;
  }

  /** The folder's linkedHub address (config.json, read fresh), or null. */
  function linkedHub(): string | null {
    try {
      const cfg = JSON.parse(readFileSync(join(deps.designRoot, 'config.json'), 'utf8'));
      const url = cfg?.linkedHub?.url;
      if (typeof url !== 'string' || !url) return null;
      try {
        return normalizeUrl(url);
      } catch {
        return url;
      }
    } catch {
      return null;
    }
  }

  function deviceToken(): string | null {
    const p = deps.cloudConfigPath?.() ?? cloudConfigPath();
    try {
      return boundCloudToken(JSON.parse(readFileSync(p, 'utf8')), cloudUrl());
    } catch {
      return null;
    }
  }

  async function cloudCall(
    path: string,
    token: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    try {
      const res = await doFetch(`${cloudUrl()}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, body: body && typeof body === 'object' ? body : {} };
    } catch {
      return { status: 0, body: {} };
    }
  }

  /** The cloud project's id from a create reply — `{project:{id}}`, `{id}` or `{project:'<id>'}`. */
  function createdId(body: Record<string, unknown>): string | null {
    const p = body.project;
    const id =
      p && typeof p === 'object' ? (p as { id?: unknown }).id : typeof p === 'string' ? p : body.id;
    return typeof id === 'string' && PROJECT_ID.test(id) ? id : null;
  }

  /** Poll until the cloud says `active`. */
  async function waitActive(project: string): Promise<void> {
    const deadline = Date.now() + activeTimeoutMs;
    for (;;) {
      const token = deviceToken();
      if (!token) throw new MoveFailure(WORDS.signedOut);
      const r = await cloudCall('/api/projects', token);
      if (r.status === 401) throw new MoveFailure(WORDS.signedOut);
      if (r.status === 402) throw new MoveFailure(WORDS.plan);
      if (r.status === 200) {
        const list = Array.isArray(r.body.projects) ? r.body.projects : [];
        const row = list.find(
          (x): x is { state?: unknown } =>
            !!x && typeof x === 'object' && (x as { id?: unknown }).id === project
        );
        if (!row) throw new MoveFailure(WORDS.gone);
        if (row.state === 'active') return;
      }
      if (Date.now() >= deadline)
        throw new MoveFailure(r.status === 200 ? WORDS.slow : WORDS.offline);
      await Bun.sleep(pollMs);
    }
  }

  /** V2-1.12 §5.2 — raise-only: the hub never goes below the folder's marker before the seed-up. */
  async function raiseFormat(hubUrl: string): Promise<void> {
    const local = deps.localFormat();
    if (!(local > 1)) return;
    const rec = getHubRecord(hubUrl, deps.hubsConfigPath);
    if (!rec) throw new MoveFailure(WORDS.open);
    const client = createHubFormatClient({ url: hubUrl, token: rec.token }, deps.fetchImpl);
    const health = await client.health();
    if (!health.ok) throw new MoveFailure(WORDS.offline);
    if ((health.formatVersion ?? 1) >= local) return;
    if (!health.capabilities.includes('format-v2')) throw new MoveFailure(WORDS.format);
    const set = await client.setFormat(local === 2 ? 2 : 1);
    if (!set.ok) throw new MoveFailure(set.status === 0 ? WORDS.offline : WORDS.format);
  }

  async function run(start: MoveFile): Promise<void> {
    let f = start;
    try {
      if (f.state === 'provisioning') {
        await waitActive(f.project);
        f = update(f, { state: 'linking' });
      }
      const opened = await deps.cloud.openManaged(f.project);
      const hubRaw = (opened.json as { url?: unknown } | null)?.url;
      if (opened.status === 401) throw new MoveFailure(WORDS.signedOut);
      if (opened.status !== 200 || typeof hubRaw !== 'string') throw new MoveFailure(WORDS.open);
      const hub = normalizeUrl(hubRaw);
      f = update(f, { state: 'linking', hub });
      await raiseFormat(hub);
      f = update(f, { state: 'uploading' });
      const attached = await deps.cloud.attach(f.project);
      if (attached.status === 401) throw new MoveFailure(WORDS.signedOut);
      const linkedTo = (attached.json as { url?: unknown } | null)?.url;
      if (attached.status !== 200 || typeof linkedTo !== 'string')
        throw new MoveFailure(WORDS.open);
      f = update(f, { state: 'ready', hub: normalizeUrl(linkedTo) });
    } catch (err) {
      const words = err instanceof MoveFailure ? err.message : WORDS.stopped;
      if (!(err instanceof MoveFailure)) console.error(`[cloud-move] ${(err as Error)?.message}`);
      try {
        update(f, { state: 'failed', error: words });
      } catch {
        /* the folder went away — nothing to report into */
      }
    }
  }

  function launch(f: MoveFile): void {
    const p = run(f).finally(() => {
      if (running === p) running = null;
    });
    running = p;
  }

  /** Is the job on file finished FOR THIS FOLDER (linked to the hub the move made)? */
  const isDone = (f: MoveFile | null) =>
    !!f && f.state === 'ready' && !!f.hub && linkedHub() === f.hub;

  async function startMove(req: Request): Promise<Response> {
    let body: { name?: unknown } = {};
    const text = await req.text().catch(() => '');
    if (text.trim()) {
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        return json(400, { ok: false, reason: 'bad-request', error: 'body must be JSON' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return json(400, { ok: false, reason: 'bad-request', error: 'body must be an object' });
    }
    if (body.name !== undefined && typeof body.name !== 'string')
      return json(400, { ok: false, reason: 'bad-request', error: 'name must be a string' });

    const job = readFile();
    // Repeat = the same answer: a job this process runs, or one already finished here.
    if (job && running) return json(200, { ok: true, project: job.project, state: 'provisioning' });
    if (isDone(job)) return json(200, { ok: true, project: job?.project, state: 'ready' });

    // Linked to any hub this move did not make → refuse before spending anything.
    const linked = linkedHub();
    if (linked && linked !== job?.hub) return json(409, { ok: false, reason: 'linked-elsewhere' });

    const token = deviceToken();
    if (!token) return json(401, { ok: false, reason: 'signed-out' });

    // A job on file (failed, or cut off by a restart) resumes the SAME cloud project.
    if (job) {
      const resumed = update(job, { state: 'provisioning' });
      launch(resumed);
      return json(200, { ok: true, project: job.project, state: 'provisioning' });
    }

    const raw = (typeof body.name === 'string' ? body.name : (deps.projectName() ?? '')).trim();
    const name = (raw || 'My project').slice(0, MAX_NAME);
    const created = await cloudCall('/api/projects', token, { method: 'POST', body: { name } });
    if (created.status === 401) return json(401, { ok: false, reason: 'signed-out' });
    if (created.status === 402) return json(402, { ok: false, reason: 'plan', error: WORDS.plan });
    const project =
      created.status === 200 || created.status === 201 ? createdId(created.body) : null;
    if (!project) return json(503, { ok: false, reason: 'offline' });

    const now = Date.now();
    const f: MoveFile = {
      v: 1,
      state: 'provisioning',
      project,
      name,
      startedAt: now,
      updatedAt: now,
    };
    writeFile(f);
    launch(f);
    return json(200, { ok: true, project, state: 'provisioning' });
  }

  return [
    {
      method: 'POST',
      path: '/_api/cloud/move',
      origin: 'main',
      // §5.5 — the `session` class (access/request.ts): moving your own folder is the owner's act on
      // their own place, like link / sign-in. A linked folder (the only one a hub role applies to)
      // answers 409 before anything happens.
      readOnly: 'allowed',
      handle(req) {
        const next = gate.then(() => startMove(req));
        gate = next.catch(() => null);
        return next;
      },
    },
    {
      method: 'GET',
      path: '/_api/cloud/move',
      origin: 'main',
      readOnly: 'allowed',
      handle() {
        const f = readFile();
        if (!f) return json(200, { state: 'idle' });
        // In progress on file but nobody here runs it (the server restarted): say so honestly.
        if (!running && f.state !== 'ready' && f.state !== 'failed')
          return json(200, { state: 'failed', project: f.project, error: WORDS.stopped });
        return json(200, {
          state: f.state,
          project: f.project,
          ...(f.state === 'failed' && f.error ? { error: f.error } : {}),
        });
      },
    },
  ];
}
