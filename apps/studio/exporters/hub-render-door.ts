// hub-render-door.ts — S8.5b-3: the desktop half of the cloud render door (contract §8–§9).
//
// A desktop reaches the cloud renderer through the LINKED hub's bearer door
// (`/api/projects/current/v1/render-jobs…`, S8.5b-2). It holds no other credential: the peer token it
// already syncs with is the only secret, sent as `Authorization: Bearer` and nowhere else — never in a
// URL, a log line or an answer, and never to a second host (`redirect: 'error'`).
//
// The hub is UNTRUSTED to peers (DDR-054), so every answer is read as data: the job id in an answer is
// ignored (this Mac's id is authoritative), progress is clamped, error text is capped and rendered as
// text, the artifact is streamed with a hard byte ceiling and its name goes through the tracker's own
// untrusted-name rule. The door exists only when the hub's `/health` lists `render-jobs-v1`; otherwise
// the getter answers null and the Render row stays hidden (never a dead-end wait).

import type { TargetAnswer } from '../outbox/policy.ts';
import { parseCellState } from '../sync/park.ts';
import {
  artifactCap,
  CLOUD_ACCESS_REMOVED_WORDS,
  CLOUD_CAP_WORDS,
  CLOUD_FINGERPRINT_MAX,
  CLOUD_TOO_BIG_WORDS,
  CloudArtifactTooLargeError,
  type CloudJobStatus,
  type CloudRenderDoor,
  cloudNotSyncedWords,
  readCapped,
} from './remote.ts';

/** The `/health` capability a hub lists when its render door is on (S8.5b §4.4). */
export const RENDER_DOOR_CAPABILITY = 'render-jobs-v1';

const JOB_ID_RE = /^i_[a-z0-9]{20}$/;
const MAX_ANSWER_BYTES = 256 * 1024;
const DEFAULT_RETRY_MS = 15_000;
const MAX_RETRY_MS = 10 * 60 * 1000;
/** Silence after which a poll first asks whether the cell is asleep (§7). */
const QUIET_PROBE_MS = 60_000;

export interface HubRenderDoorOptions {
  /** the linked hub's origin */
  hubUrl: string;
  /** the peer token, read per call (a re-sign-in replaces it); null = signed out */
  token: () => string | null;
  fetchImpl?: typeof fetch;
  /** artifact ceiling; default is the same one a local render reply is held to */
  maxArtifactBytes?: number;
  now?: () => number;
  timeoutMs?: number;
  artifactTimeoutMs?: number;
}

type Json = Record<string, unknown>;

/** Text from an untrusted answer: printable, one line, capped. */
function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
}

function retryAfter(body: Json | null, header: string | null): number {
  const raw = Number(body?.retryAfterMs ?? (header ? Number(header) * 1000 : Number.NaN));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RETRY_MS;
  return Math.min(Math.max(Math.round(raw), 1000), MAX_RETRY_MS);
}

function clampProgress(v: unknown): { current: number; total: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { current, total } = v as Json;
  if (typeof current !== 'number' || typeof total !== 'number') return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(total)) return undefined;
  const t = Math.min(Math.max(Math.floor(total), 0), 1_000_000);
  const c = Math.min(Math.max(Math.floor(current), 0), t);
  return t > 0 ? { current: c, total: t } : undefined;
}

export function createHubRenderDoor(opts: HubRenderDoorOptions): CloudRenderDoor {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.hubUrl.replace(/\/+$/, '');
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  /** the last time the hub answered us about a job — silence past QUIET_PROBE_MS asks first */
  let lastHeard: number | null = null;

  const jobsPath = '/api/projects/current/v1/render-jobs';

  /** `signed-out` = no token to send; `network` = no answer; else the response. */
  async function reach(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extra: { timeoutMs?: number } = {}
  ): Promise<'signed-out' | 'network' | Response> {
    const token = opts.token();
    if (!token) return 'signed-out';
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // the bearer never follows a Location to another host
        redirect: 'error',
        signal: AbortSignal.timeout(extra.timeoutMs ?? timeoutMs),
      });
    } catch {
      return 'network';
    }
  }

  async function readJson(res: Response): Promise<Json | null> {
    try {
      const bytes = await readCapped(res, MAX_ANSWER_BYTES);
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Json)
        : null;
    } catch {
      return null;
    }
  }

  return {
    async submit(job) {
      if (!JOB_ID_RE.test(job.jobId)) return { ok: false, status: 400, code: 'bad-id' };
      if (job.expect && job.expect.length > CLOUD_FINGERPRINT_MAX)
        return { ok: false, status: 409, code: 'too-big', message: CLOUD_TOO_BIG_WORDS };
      const r = await reach('POST', jobsPath, {
        jobId: job.jobId,
        spec: job.spec,
        label: job.label,
        ...(job.expect ? { expect: job.expect } : {}),
      });
      if (r === 'signed-out') return { ok: false, status: 401 };
      if (r === 'network') return { ok: false, network: true };
      lastHeard = now();
      const body = await readJson(r);
      const code = cleanText(body?.code, 40);
      if (r.status === 200 || r.status === 202) {
        return { ok: true, ...(body?.already === true ? { already: true } : {}) };
      }
      if (r.status === 401) return { ok: false, status: 401 };
      if (r.status === 402) return { ok: false, status: 402, code: 'plan' };
      if (r.status === 403) return { ok: false, status: 403, code: 'forbidden' };
      if (r.status === 404)
        return {
          ok: false,
          status: 404,
          code: code === 'unknown-project' ? 'unknown-project' : 'not-found',
        };
      if (r.status === 409) {
        const c = code === 'id-taken' || code === 'not-synced' ? code : 'conflict';
        return {
          ok: false,
          status: 409,
          code: c,
          ...(c === 'not-synced' ? { message: cloudNotSyncedWords(null) } : {}),
        };
      }
      if (r.status === 422)
        return {
          ok: false,
          status: 422,
          code: 'cap',
          message: cleanText(body?.message, 300) ?? CLOUD_CAP_WORDS,
        };
      if (r.status === 425) {
        const behind = Array.isArray(body?.behind) ? body.behind : [];
        return {
          ok: false,
          status: 425,
          code: 'not-synced',
          retryAfterMs: retryAfter(body, null),
          message: cloudNotSyncedWords(typeof behind[0] === 'string' ? behind[0] : null),
        };
      }
      if (r.status === 429)
        return {
          ok: false,
          status: 429,
          code: 'busy',
          retryAfterMs: retryAfter(body, r.headers.get('retry-after')),
        };
      if (r.status >= 500) return { ok: false, status: r.status };
      return { ok: false, status: r.status, code: `http-${r.status}` } satisfies TargetAnswer;
    },

    async status(jobId): Promise<CloudJobStatus> {
      if (!JOB_ID_RE.test(jobId)) return { state: 'gone' };
      // A Mac that slept or went offline may have outlived its cell: ask (without waking it) before a
      // poll would. A sleeping cell lost its jobs and files; a self-hosted hub (404) is skipped.
      if (lastHeard === null || now() - lastHeard >= QUIET_PROBE_MS) {
        const p = await reach('GET', '/_cell/state', undefined, { timeoutMs: 10_000 });
        if (p === 'signed-out' || p === 'network') return { state: 'unreachable' };
        const parsed = parseCellState(
          p.status,
          p.headers.get('content-type'),
          (await p.text().catch(() => '')).slice(0, 4096)
        );
        if (parsed.kind === 'state' && parsed.state === 'asleep') return { state: 'gone' };
      }
      const r = await reach('GET', `${jobsPath}/${jobId}`);
      if (r === 'signed-out' || r === 'network') return { state: 'unreachable' };
      lastHeard = now();
      if (r.status === 404 || r.status === 410) return { state: 'gone' };
      if (r.status === 403) return { state: 'failed', error: CLOUD_ACCESS_REMOVED_WORDS };
      if (r.status !== 200) return { state: 'unreachable' };
      const body = await readJson(r);
      const job = (body?.job && typeof body.job === 'object' ? body.job : body) as Json | null;
      const state = job?.state ?? job?.status;
      if (state === 'done') return { state: 'done' };
      if (state === 'failed') {
        const error = cleanText(job?.error, 500);
        return { state: 'failed', ...(error ? { error } : {}) };
      }
      if (state === 'queued' || state === 'running') {
        const progress = clampProgress(job?.progress);
        return { state, ...(progress ? { progress } : {}) };
      }
      return { state: 'unreachable' }; // a state we do not know: ask again, trust nothing
    },

    async artifact(jobId) {
      if (!JOB_ID_RE.test(jobId)) return null;
      const r = await reach('GET', `${jobsPath}/${jobId}/file`, undefined, {
        timeoutMs: opts.artifactTimeoutMs ?? 10 * 60 * 1000,
      });
      if (r === 'signed-out' || r === 'network' || r.status !== 200) {
        if (r !== 'signed-out' && r !== 'network') await r.body?.cancel().catch(() => {});
        return null;
      }
      lastHeard = now();
      const max = opts.maxArtifactBytes ?? artifactCap();
      let body: Uint8Array;
      try {
        body = await readCapped(r, max);
      } catch {
        throw new CloudArtifactTooLargeError();
      }
      // the name is the tracker's to sanitize; the content type is ignored and so is any job id
      const disposition = r.headers.get('content-disposition') ?? '';
      const fromDisposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
      const raw = r.headers.get('x-maude-filename') ?? fromDisposition ?? null;
      return { filename: raw ? raw.slice(0, 255) : null, body };
    },
  };
}

// ─── the boot getter: a door only while the linked hub lists the capability ──────────────────────

export interface HubRenderDoorGetterOptions {
  /** the linked hub and the token this Mac holds for it, or null (unlinked / signed out) */
  hub: () => { url: string; token: string } | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** how long a "yes" is trusted before it is re-asked in the background */
  yesMs?: number;
  /** how long a "no" is trusted (a hub updated to list the capability appears without a restart) */
  noMs?: number;
  maxArtifactBytes?: number;
}

type Known = { url: string; has: boolean; at: number } | null;

/**
 * `() => CloudRenderDoor | null`, the shape `createHttp`'s `opts.cloudRenderDoor` takes. The door is
 * built only once the linked hub's `/health` has listed `render-jobs-v1` for the CURRENT link; a hub
 * that does not (older, no render service, flag off) or one not yet asked answers null — the Render row
 * stays hidden. The probe runs in the background (the getter is synchronous); `settle()` lets the
 * outbox sender wait for the first answer so a queued cloud render is not dropped on a cold start.
 */
export function createHubRenderDoorGetter(o: HubRenderDoorGetterOptions) {
  const now = o.now ?? Date.now;
  const yesMs = o.yesMs ?? 5 * 60_000;
  const noMs = o.noMs ?? 30_000;
  let known: Known = null;
  let inflight: Promise<void> | null = null;
  let door: { url: string; value: CloudRenderDoor } | null = null;

  function probe(url: string): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await (o.fetchImpl ?? fetch)(`${url.replace(/\/+$/, '')}/health`, {
          signal: AbortSignal.timeout(8_000),
          redirect: 'error',
        });
        if (!res.ok) return; // no answer about capabilities: keep what we knew
        const body = (await res.json()) as { capabilities?: unknown };
        const has =
          Array.isArray(body?.capabilities) &&
          body.capabilities.some((c) => c === RENDER_DOOR_CAPABILITY);
        known = { url, has, at: now() };
      } catch {
        /* unreachable: keep what we knew; the sender treats unknown as "ask later" */
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function fresh(url: string): Known {
    return known && known.url === url ? known : null;
  }

  function refreshIfStale(url: string): void {
    const k = fresh(url);
    if (!k || now() - k.at > (k.has ? yesMs : noMs)) void probe(url);
  }

  return {
    /** The door now, or null. Never blocks. */
    door(): CloudRenderDoor | null {
      const hub = o.hub();
      if (!hub) return null;
      refreshIfStale(hub.url);
      const k = fresh(hub.url);
      if (!k?.has) return null;
      if (!door || door.url !== hub.url) {
        door = {
          url: hub.url,
          value: createHubRenderDoor({
            hubUrl: hub.url,
            // read per call: a re-sign-in swaps the token without rebuilding the door
            token: () => o.hub()?.token ?? null,
            fetchImpl: o.fetchImpl,
            now: o.now,
            maxArtifactBytes: o.maxArtifactBytes,
          }),
        };
      }
      return door.value;
    },
    /**
     * Wait for the capability to be known for the current link. Resolves true when it is (yes or no),
     * false when the hub could not be asked (offline): the sender then waits instead of refusing.
     */
    async settle(): Promise<boolean> {
      const hub = o.hub();
      if (!hub) return true; // unlinked: a plain "no cloud", final
      if (fresh(hub.url)) return true;
      await probe(hub.url);
      return fresh(hub.url) !== null;
    },
    /** Boot: ask once now so the first estimate already knows. */
    warm(): void {
      const hub = o.hub();
      if (hub) void probe(hub.url);
    },
    /** A reconnect or a re-link: forget what was learned. */
    invalidate(): void {
      known = null;
      door = null;
    },
  };
}
