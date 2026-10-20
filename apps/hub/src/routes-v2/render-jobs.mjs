// The cloud render door — S8.5b-2 (contract apps/studio/client/v2/contracts/S8.5b-cloud-render-door.md
// §4, §5, §8, §10, §12). How a desktop Maude reaches the cell's renderer with the peer token it
// already syncs with, and nothing else:
//
//   POST /api/projects/:p/v1/render-jobs            { jobId, spec, label?, expect? }  export
//   GET  /api/projects/:p/v1/render-jobs/:id                                          export
//   GET  /api/projects/:p/v1/render-jobs/:id/file                                     export
//
// Bearer only: the handler reads `authorization`, never a cookie (no ambient credential, so no
// CSRF). The hub BUILDS the session the browser proxy would hold for this person, judges export
// rights and canvas scope, checks freshness against its own checkout and forwards to the studio
// child's existing `/_api/export-jobs` lane through `studioProxy.forwardAs` — which writes the
// upstream request from scratch, so the hub token reaches neither the studio nor maude-render
// (T9). The studio judges again (`decide`, `grantLaneRefusal`, its owner-scoped job store).
//
// DARK BY CAPABILITY (§4.4, M1): the routes answer 404 — exactly like a hub without them —
// unless the hub runs a studio child, a render service is configured and `MAUDE_RENDER_DOOR=1`;
// `/health` lists `render-jobs-v1` under the same rule (`renderDoorEnabled`).
//
// Invisible = absent (V2-1.16 U1): a canvas this session may not export, a foreign job id and a
// missing one all answer 404. `not-synced` names only rels the session sees (T7).

import { createHash } from 'node:crypto';

import {
  judgeFreshness,
  MAX_BEHIND_NAMED,
  parseFingerprint,
} from '../../../studio/exporters/door-fingerprint.ts';
import { fileAccessForClaim } from '../access-files.mjs';
import { OBSERVER_REFUSAL, READ_ONLY_REFUSAL } from '../access-gate.mjs';
import { sessionKeyFor } from '../studio-proxy.mjs';

/** The `/health` capability a desktop looks for before it builds a door (S8.5b §4.4). */
export const RENDER_JOBS_CAPABILITY = 'render-jobs-v1';

const PROJECT = '[A-Za-z0-9._-]{1,128}';
const base = `^/api/projects/(${PROJECT})/v1/render-jobs`;
export const RENDER_JOBS_ROUTE = new RegExp(`${base}$`);
// Any one segment is classified here (an ill-formed id is this door's 404, never the studio's).
export const RENDER_JOB_ROUTE = new RegExp(`${base}/([^/]{1,128})$`);
export const RENDER_JOB_FILE_ROUTE = new RegExp(`${base}/([^/]{1,128})/file$`);

/** The outbox record id the desktop sends — also the studio's job id (§7). */
export const DOOR_JOB_ID_RE = /^i_[a-z0-9]{20}$/;
/** §5 — bodies ≤ 256 KB (a 2000-entry fingerprint fits). */
export const RENDER_JOBS_BODY_BYTES = 256 * 1024;
/** The studio's JSON answers are small; a bigger one is not trusted. */
const MAX_UPSTREAM_JSON = 256 * 1024;
const MAX_ERROR_CHARS = 500;

/** §10 — per actor. */
export const RENDER_JOBS_LIMITS = Object.freeze({
  /** door jobs queued + running at once */
  active: 2,
  /** accepted submits per hour */
  perHour: 30,
  /** submit requests per minute, answered or not (a flood costs a request, never a hash walk) */
  perMinute: 60,
});
/** §6 — how soon a `not-synced` desktop asks again. */
export const NOT_SYNCED_RETRY_MS = 15_000;
const BUSY_RETRY_MS = 15_000;
const MAX_TRACKED_ACTORS = 10_000;

/**
 * §4.4 / §11 — the door is on only when this hub runs a workspace studio child, a render service
 * is configured and the operator turned it on. Every other hub lists nothing and answers 404.
 */
export function renderDoorEnabled({ studio, env = process.env }) {
  return Boolean(studio) && Boolean(env.MAUDE_RENDER_URL) && env.MAUDE_RENDER_DOOR === '1';
}

/** A sliding window per actor that can say WHEN the next slot frees. */
function createWindow({ max, windowMs }) {
  const hits = new Map();
  const live = (key, now) => (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  return {
    /** ms until a slot is free (0 = free now) */
    wait(key, now) {
      const list = live(key, now);
      hits.set(key, list);
      return list.length < max ? 0 : Math.max(1000, list[0] + windowMs - now);
    },
    take(key, now) {
      const list = live(key, now);
      list.push(now);
      if (!hits.has(key) && hits.size >= MAX_TRACKED_ACTORS) {
        for (const [k, v] of hits) if (!v.some((t) => t > now - windowMs)) hits.delete(k);
        if (hits.size >= MAX_TRACKED_ACTORS) hits.delete(hits.keys().next().value);
      }
      hits.set(key, list);
    },
  };
}

async function readBody(request, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) return { tooLarge: true };
    chunks.push(chunk);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { body: v } : {};
  } catch {
    return {};
  }
}

/** An upstream JSON answer, capped; null when it is not one. */
async function readUpstreamJson(stream) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_UPSTREAM_JSON) {
        stream.destroy();
        return null;
      }
      chunks.push(chunk);
    }
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const NOT_FOUND = Object.freeze({ code: 'not-found', error: 'no such render job' });

/** The session's access as the claim the proxy forwards (`x-maude-access`). */
function claimOf(access) {
  return {
    v: 1,
    role: access.role,
    ...(access.grants.length ? { grants: access.grants.map(({ c, r }) => ({ c, r })) } : {}),
  };
}

/** The studio's job, projected: what the desktop's tracker reads, nothing the cell keeps for itself. */
function answerStatus(respondJson, jobId, body) {
  const job = Array.isArray(body?.jobs) ? body.jobs.find((j) => j?.id === jobId) : null;
  if (!job) {
    respondJson(404, { ...NOT_FOUND });
    return true;
  }
  const progress =
    job.progress && Number.isFinite(job.progress.current) && Number.isFinite(job.progress.total)
      ? { current: job.progress.current, total: job.progress.total }
      : null;
  respondJson(200, {
    job: {
      id: jobId,
      status: typeof job.status === 'string' ? job.status : 'unknown',
      ...(progress ? { progress } : {}),
      ...(typeof job.error === 'string' ? { error: job.error.slice(0, MAX_ERROR_CHARS) } : {}),
    },
  });
  return true;
}

/**
 * The runtime behind the rows. `server.mjs` builds one per hub and hands it to `runHubRoutes`
 * as `deps.renderJobs`.
 *
 * @param {object} deps
 * @param {string} deps.projectId    this hub's project (`:p` must name it, or `current`)
 * @param {(request: object) => object | null} deps.auth  `acceptedAuth`: `{ actor, readOnly, scope, access? }`
 * @param {() => boolean} deps.enabled  `renderDoorEnabled` (read per request: env can flip)
 * @param {() => object | null} deps.proxy  the studio proxy (`forwardAs`), null without a studio
 * @param {() => string | null} deps.designRoot  the checkout's design root (freshness, closure)
 * @param {() => object | null} [deps.journal]  the file plane's journal (closure paths)
 * @param {string} [deps.tenant]     the session-key namespace (`browserSession`'s)
 * @param {typeof RENDER_JOBS_LIMITS | null} [deps.limits]  null = off (`rateLimit: false`)
 * @param {() => number} [deps.now]
 */
export function createRenderJobsRoutes({
  projectId,
  auth,
  enabled,
  proxy,
  designRoot,
  journal = () => null,
  tenant = process.env.MAUDE_TENANT_ID ?? 'local',
  limits = RENDER_JOBS_LIMITS,
  now = () => Date.now(),
}) {
  const perHour = limits ? createWindow({ max: limits.perHour, windowMs: 3_600_000 }) : null;
  const perMinute = limits ? createWindow({ max: limits.perMinute, windowMs: 60_000 }) : null;
  const hash = (input) => createHash('sha256').update(input).digest('hex');

  /** The browser proxy's session for this person — the same session key, so the same jobs (Q4). */
  function sessionOf(who) {
    const { access } = who;
    return {
      email: who.actor,
      role: access.role,
      label: null,
      access: claimOf(access),
      readOnly: access.canvasOnly ? true : !!who.readOnly,
      ...(access.canvasOnly ? { canvasOnly: true } : {}),
      sessionKey: sessionKeyFor(tenant, who.actor, hash),
    };
  }

  function filesOf(who) {
    return fileAccessForClaim(claimOf(who.access), {
      scope: who.scope ?? '*',
      designRoot: designRoot(),
      journal: journal(),
    });
  }

  /**
   * §8.3 — the spec's targets, judged for this session. A canvas (Selection/Canvas scope) needs
   * `export` on it and sight of it; Folder/Whole project is project-level (`PROJECT_ONLY` for a
   * canvas-only session, L7) and needs the token's whole-project scope. Returns the grants the
   * render capability carries, or null (answered as missing).
   */
  function judgeTargets(who, files, spec) {
    const { access } = who;
    if (spec.scope === 'canvas' || spec.scope === 'selection') {
      const canvas = spec.canvas;
      if (typeof canvas !== 'string' || canvas === '' || canvas.length > 1024) return null;
      if (!files.sees(canvas) || !access.can('export', canvas)) return null;
      return access.canvasOnly ? access.grants.filter((g) => g.c === canvas) : [];
    }
    if (spec.scope === 'folder' || spec.scope === 'project') {
      if (access.canvasOnly) return null;
      if ((who.scope ?? '*') !== '*' || !access.can('export', null)) return null;
      return [];
    }
    return null;
  }

  function respondForwardRefusal(respondJson, r) {
    respondJson(r.status, r.body ?? {});
    return true;
  }

  async function submit({ request, respondJson }, who) {
    const session = sessionOf(who);
    const key = session.sessionKey;
    const wait = perMinute?.wait(key, now()) ?? 0;
    if (wait > 0) {
      respondJson(429, { code: 'busy', retryAfterMs: wait });
      return true;
    }
    perMinute?.take(key, now());

    const read = await readBody(request, RENDER_JOBS_BODY_BYTES);
    if (read.tooLarge) {
      respondJson(413, { code: 'too-large' });
      return true;
    }
    const b = read.body;
    if (!b) {
      respondJson(400, { code: 'invalid', error: 'a JSON object body is required' });
      return true;
    }
    if (typeof b.jobId !== 'string' || !DOOR_JOB_ID_RE.test(b.jobId)) {
      respondJson(400, { code: 'bad-id' });
      return true;
    }
    const spec = b.spec;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      respondJson(400, { code: 'bad-spec', field: 'spec' });
      return true;
    }
    const expect = b.expect === undefined ? [] : parseFingerprint(b.expect);
    if (!expect) {
      respondJson(400, { code: 'bad-expect' });
      return true;
    }

    const files = filesOf(who);
    const grants = judgeTargets(who, files, spec);
    if (!grants) {
      respondJson(404, { ...NOT_FOUND });
      return true;
    }

    const p = proxy();
    if (!p?.forwardAs) {
      respondJson(404, { ...NOT_FOUND });
      return true;
    }

    // Replay (§7): a job this person already holds goes straight to the studio, which answers
    // `already` (or `id-taken` for a different spec) — never a fresh limit or freshness verdict.
    const listed = await p.forwardAs(session, { method: 'GET', path: '/_api/export-jobs' });
    if (!listed.ok) return respondForwardRefusal(respondJson, listed);
    const list = listed.status === 200 ? await readUpstreamJson(listed.stream) : null;
    if (listed.status !== 200) listed.stream.resume();
    if (!list || !Array.isArray(list.jobs)) {
      respondJson(502, { code: 'upstream' });
      return true;
    }
    const door = list.jobs.filter(
      (j) => j && typeof j.id === 'string' && DOOR_JOB_ID_RE.test(j.id)
    );
    const replay = door.some((j) => j.id === b.jobId);

    if (!replay) {
      const active = door.filter((j) => j.status === 'queued' || j.status === 'running').length;
      if (limits && active >= limits.active) {
        respondJson(429, { code: 'busy', retryAfterMs: BUSY_RETRY_MS });
        return true;
      }
      const hourWait = perHour?.wait(key, now()) ?? 0;
      if (hourWait > 0) {
        respondJson(429, { code: 'busy', retryAfterMs: hourWait });
        return true;
      }
      const root = designRoot();
      const verdict = root
        ? judgeFreshness(expect, { root, visible: (rel) => files.sees(rel) })
        : { ok: expect.length === 0, behind: expect.slice(0, 1).map((e) => e.rel) };
      if (!verdict.ok) {
        respondJson(425, {
          code: 'not-synced',
          behind: verdict.behind.filter((rel) => files.sees(rel)).slice(0, MAX_BEHIND_NAMED),
          retryAfterMs: NOT_SYNCED_RETRY_MS,
        });
        return true;
      }
    }

    const r = await p.forwardAs(session, {
      method: 'POST',
      path: '/_api/export-jobs',
      body: { v: 2, spec },
      doorJob: b.jobId,
      renderGrants: grants,
    });
    if (!r.ok) return respondForwardRefusal(respondJson, r);
    const answer = await readUpstreamJson(r.stream);
    if (r.status === 200 || r.status === 202) {
      if (r.status === 202 && !replay) perHour?.take(key, now());
      // This Mac's id is authoritative; the studio's echo is not passed on.
      respondJson(r.status, {
        jobId: b.jobId,
        ...(answer?.already === true ? { already: true } : {}),
      });
      return true;
    }
    if (r.status === 429) {
      respondJson(429, { code: 'busy', retryAfterMs: BUSY_RETRY_MS });
      return true;
    }
    if (r.status >= 500) {
      respondJson(r.status, { code: 'upstream' });
      return true;
    }
    // 400 bad-spec · 403 · 404 · 409 id-taken · 422 cap: the studio's own words, capped.
    respondJson(r.status, {
      code: typeof answer?.code === 'string' ? answer.code.slice(0, 40) : `http-${r.status}`,
      ...(typeof answer?.field === 'string' ? { field: answer.field.slice(0, 80) } : {}),
      ...(typeof answer?.message === 'string'
        ? { message: answer.message.slice(0, MAX_ERROR_CHARS) }
        : {}),
    });
    return true;
  }

  async function status({ respondJson }, who, jobId) {
    const p = proxy();
    if (!p?.forwardAs) {
      respondJson(404, { ...NOT_FOUND });
      return true;
    }
    // Every poll carries a freshly minted render capability (§7, T11); the studio swaps it in on a
    // job that has not finished. A project session's is viewer with no grants. A canvas-only
    // session's must carry ONLY the job's own canvas grant, exactly like the submit's (§8.4,
    // decision v2-S8.5b-2-render-grants-narrowed; S8.5b-4 F2): the hub cannot know that canvas
    // before it reads the job, so it reads first WITHOUT a capability (a canvas-only read mints
    // none), then — the job still unfinished — reads again with the narrowed one.
    const session = sessionOf(who);
    const path = `/_api/export-jobs?id=${jobId}`;
    let r = await p.forwardAs(session, { method: 'GET', path, renderGrants: [] });
    if (!r.ok) return respondForwardRefusal(respondJson, r);
    if (who.access.canvasOnly && r.status === 200) {
      const peek = await readUpstreamJson(r.stream);
      const held = Array.isArray(peek?.jobs) ? peek.jobs.find((j) => j?.id === jobId) : null;
      const canvas = held?.spec?.canvas;
      const unfinished = held?.status === 'queued' || held?.status === 'running';
      const narrowed =
        unfinished && typeof canvas === 'string'
          ? who.access.grants.filter((g) => g.c === canvas && who.access.can('export', g.c))
          : [];
      if (narrowed.length === 0) return answerStatus(respondJson, jobId, peek);
      r = await p.forwardAs(session, { method: 'GET', path, renderGrants: narrowed });
      if (!r.ok) return respondForwardRefusal(respondJson, r);
    }
    if (r.status !== 200) {
      r.stream.resume();
      if (r.status === 404) respondJson(404, { ...NOT_FOUND });
      else respondJson(r.status >= 500 ? r.status : 502, { code: 'upstream' });
      return true;
    }
    return answerStatus(respondJson, jobId, await readUpstreamJson(r.stream));
  }

  async function file({ response, respondJson }, who, jobId) {
    const p = proxy();
    if (!p?.forwardAs) {
      respondJson(404, { ...NOT_FOUND });
      return true;
    }
    const r = await p.forwardAs(sessionOf(who), {
      method: 'GET',
      path: `/_api/export-jobs/download?id=${jobId}`,
    });
    if (!r.ok) return respondForwardRefusal(respondJson, r);
    if (r.status !== 200) {
      r.stream.resume();
      if (r.status === 404) respondJson(404, { ...NOT_FOUND });
      else if (r.status === 409) respondJson(409, { code: 'not-done' });
      else respondJson(r.status >= 500 ? r.status : 502, { code: 'upstream' });
      return true;
    }
    // Bytes, as bytes: the type is never the studio's to choose here (the desktop ignores it too).
    const head = {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    const disposition = r.headers['content-disposition'];
    if (typeof disposition === 'string') head['content-disposition'] = disposition;
    const length = r.headers['content-length'];
    if (typeof length === 'string' && /^\d+$/.test(length)) head['content-length'] = length;
    response.writeHead(200, head);
    await new Promise((resolve) => {
      r.stream.on('end', resolve);
      r.stream.on('error', () => {
        response.destroy();
        resolve();
      });
      r.stream.pipe(response);
    });
    return true;
  }

  /** One request. True when answered, false when the path is not a render-jobs route. */
  async function handle(ctx) {
    const { path, method, request, respondJson } = ctx;
    let m = RENDER_JOBS_ROUTE.exec(path);
    let kind = 'collection';
    if (!m) [m, kind] = [RENDER_JOB_FILE_ROUTE.exec(path), 'file'];
    if (!m) [m, kind] = [RENDER_JOB_ROUTE.exec(path), 'one'];
    if (!m) return false;
    // M1 — dark: a hub without the door answers exactly like one that never had it.
    if (!enabled()) {
      respondJson(404, { error: 'not found' });
      return true;
    }
    const [, project, jobId] = m;
    // Bearer only: `acceptedAuth` reads `authorization`; a cookie alone is nobody here.
    const who = auth(request);
    if (!who) {
      respondJson(401, { error: 'sign in to this project first', code: 'unauthenticated' });
      return true;
    }
    if (project !== projectId && project !== 'current') {
      respondJson(404, { error: 'no such project', code: 'unknown-project' });
      return true;
    }
    // A peer token only: the operator's secret or a dashboard token is no person with jobs.
    if (!who.access) {
      respondJson(403, { code: 'forbidden', error: 'sign in with this project’s Maude token' });
      return true;
    }
    // T4 / A19 — Can view holds no download; a read-only project session renders nothing here.
    if (who.access.role === 'observer') {
      respondJson(403, { ...OBSERVER_REFUSAL, code: 'forbidden' });
      return true;
    }
    if (!who.access.canvasOnly && who.readOnly) {
      respondJson(403, { ...READ_ONLY_REFUSAL, code: 'forbidden' });
      return true;
    }
    const isGet = method === 'GET' || method === 'HEAD';
    if (kind === 'collection') {
      if (method !== 'POST') {
        respondJson(405, { code: 'method-not-allowed' });
        return true;
      }
      return submit(ctx, who);
    }
    if (!isGet) {
      respondJson(405, { code: 'method-not-allowed' });
      return true;
    }
    if (!DOOR_JOB_ID_RE.test(jobId)) {
      respondJson(404, { ...NOT_FOUND });
      return true;
    }
    return kind === 'file' ? file(ctx, who, jobId) : status(ctx, who, jobId);
  }

  return { handle };
}

/** The row handler: the runtime comes in through `ctx.deps.renderJobs` (server.mjs). */
async function renderJobsHandler(ctx) {
  const door = ctx.deps?.renderJobs;
  if (!door || typeof door.handle !== 'function') {
    // Not wired (no studio, older boot): the same answer as a dark door.
    ctx.respondJson(404, { error: 'not found' });
    return true;
  }
  return door.handle(ctx);
}

/**
 * The rows (one table, S9 Q12; contract §5). `canvasDoor`: the handler judges every target
 * itself, so a canvas-only session passes the gate when any grant holds `export`. In NEITHER
 * canvas allowlist: the canvas origin is `CANVAS_ORIGIN_ROW`, which has no handler. The two
 * reads have no write half (the handler answers 405); it is classified `edit` like the votes
 * read rows, because `unsafe: null` means "authenticates with no peer token" in this table.
 */
export const RENDER_JOBS_ROWS = Object.freeze([
  {
    pattern: RENDER_JOBS_ROUTE,
    cap: Object.freeze({ safe: null, unsafe: 'export' }),
    scope: 'canvas',
    canvasDoor: true,
    handler: renderJobsHandler,
  },
  {
    pattern: RENDER_JOB_FILE_ROUTE,
    cap: Object.freeze({ safe: 'export', unsafe: 'edit' }),
    scope: 'canvas',
    canvasDoor: true,
    handler: renderJobsHandler,
  },
  {
    pattern: RENDER_JOB_ROUTE,
    cap: Object.freeze({ safe: 'export', unsafe: 'edit' }),
    scope: 'canvas',
    canvasDoor: true,
    handler: renderJobsHandler,
  },
]);
