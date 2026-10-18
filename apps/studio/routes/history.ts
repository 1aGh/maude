// Version history — V2-1.9 §5.11 / §5.12 (S1.12b).
//
//   GET  /_api/project/history   ?path&limit&before        → { ok, history } · { ok:false, reason: legacy|unreachable }
//   POST /_api/project/restore   { path, at | revision }   → { ok, status, actionId? } · 409 (moved from http.ts)
//   GET  /_api/project/versions  ?path&before&limit&filter → { ok, now, rows, next?, source, offline? }
//   GET  /_api/project/changes   ?path&from&to             → { ok, changes, detail, blame }
//   GET  /_api/project/source    ?path&at&lane             → { ok, source }   (raw source: `export`)
//   POST /_api/project/name      { path, at, name|null }   → { ok, actionId } · 409 hub-too-old
//   POST /_api/project/aside     { path, lane, content, label? } → { ok, actionId }
//
// Undo lives in routes/project-undo.ts (S5.5). MAIN ORIGIN ONLY, never canvas-safe: history names
// people, and name / aside / restore are writes the untrusted canvas must not make (DDR-054/088).
//
// Access is judged HERE, per request, from the session's Access (V2-1.7; `currentAccess()`), as
// well as by the kernel per op: in a cell one studio serves several people and its own link to the
// hub is the cell's, so the kernel would see the cell, not the person.
//   - rows, words, changes: `read` on the canvas — Can view included (§5.12);
//   - raw source at a version: `export` on the canvas — Can view is refused (403);
//   - name, aside, restore: `edit` on the canvas;
//   - a canvas-only session naming a canvas it was not granted: 403 `not-in-scope`, the same answer
//     a canvas that does not exist gets (U1); its AI rows read as their words (`scope: canvas-only`).

import { currentAccess, notInScopeResponse, toDesignRel } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import { offlineLine, parseFilter, type SaveWord } from '../client/v2/history/rows.ts';
import { describeBetween, parseRef } from '../history/changes.ts';
import {
  type GitEntry,
  type HistoryRowLike,
  listVersions,
  MAX_LIMIT,
  type VersionLane,
  type VersionsAnswer,
  type VersionsRuntime,
} from '../history/versions.ts';
import type { AttributionCache } from '../index/extractors/attribution-cache.ts';
import { announceAction } from './project-undo.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 4 * 1024;
/** An aside carries a whole lane body. */
const MAX_ASIDE_BODY = 4 * 1024 * 1024;
const MAX_NAME = 80;
/** C0 / DEL / C1 control characters (the kernel's own name rule). */
const hasControl = (s: string): boolean =>
  [...s].some((ch) => {
    const c = ch.codePointAt(0) as number;
    return c <= 0x1f || (c >= 0x7f && c <= 0x9f);
  });
const ASIDE_LANES = new Set(['html', 'css', 'meta', 'annotations']);
const SOURCE_LANES = new Set<VersionLane>(['html', 'css', 'meta']);
export const NAME_NEEDS_HUB_UPDATE = 'Naming versions needs the team server to be updated';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

type Outcome = {
  status: 'accepted' | 'rejected';
  code?: string;
  queued?: boolean;
  actionId?: string;
};

/** The runtime methods these routes read — all optional (an older home has none). */
export interface HistoryRuntime extends VersionsRuntime {
  acceptedRestore?(repoRel: string, revision: number): Promise<Outcome | null>;
  acceptedName?(repoRel: string, revision: number, name: string | null): Promise<Outcome | null>;
  acceptedAside?(
    repoRel: string,
    lane: 'html' | 'css' | 'meta' | 'annotations',
    content: string,
    label?: string
  ): Promise<Outcome | null>;
}

export interface HistoryRouteDeps {
  /** `ctx.syncControl.current()` — null while no home answers. */
  control: () => HistoryRuntime | object | null | undefined;
  /** `.design` — the design root relative to the repo root. */
  designRel: string;
  /** The access this request is judged with. Default: `currentAccess()` (S9.9). */
  access?: (req: Request) => Access;
  /** S1.10's attribution cache for this project (null: words computed per request). */
  cache?: () => AttributionCache | null;
  /** Actor id → display name. */
  actorName?: (actor: string) => string | undefined;
  /** A legacy hub's git history of a canvas (`cloudApi.history`). */
  gitHistory?: (repoRel: string, limit: number) => Promise<GitEntry[] | null | undefined>;
  /** One lane of a canvas at a commit (`git:` refs). */
  gitLane?: (repoRel: string, sha: string, lane: VersionLane) => Promise<string | null>;
  /** The Now row's save word for a canvas (CONTRACT §6); absent → null. */
  saveWord?: (repoRel: string) => SaveWord | null;
  /** ctx.bus.emit — `project:action` after an accepted name / aside / restore. */
  emit?: (event: string, payload: unknown) => void;
  now?: () => number;
}

async function readBody(
  req: Request,
  max: number
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  if (Number(req.headers.get('content-length')) > max)
    return { ok: false, res: json(413, { ok: false, reason: 'too-large' }) };
  const text = await req.text();
  if (text.length > max) return { ok: false, res: json(413, { ok: false, reason: 'too-large' }) };
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return { ok: false, res: json(400, { ok: false, reason: 'body must be a JSON object' }) };
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, res: json(400, { ok: false, reason: 'body must be JSON' }) };
  }
}

const refusalStatus = (code: string | undefined): number => {
  if (code === 'forbidden' || code === 'not-in-scope' || code === 'read-only') return 403;
  if (code === 'retryable' || code === 'unreachable' || code === 'store-locked') return 503;
  return 409;
};

export function createHistoryRoutes(deps: HistoryRouteDeps): RouteSpec[] {
  const accessOf = deps.access ?? (() => currentAccess());
  const runtime = () => deps.control() as HistoryRuntime | null | undefined;
  const designRel = deps.designRel.replace(/^\/+|\/+$/g, '');
  const repoRelOf = (canvas: string) => (designRel ? `${designRel}/${canvas}` : canvas);
  const clock = deps.now ?? Date.now;

  /**
   * The canvas a request names, judged for `cap`. A canvas-only session is refused a canvas it
   * was not granted exactly like a missing one (U1); anyone else without `cap` gets `forbidden`.
   */
  function judge(
    access: Access,
    raw: unknown,
    cap: 'read' | 'export' | 'edit'
  ): { ok: true; canvas: string; repoRel: string } | { ok: false; res: Response } {
    const canvas =
      typeof raw === 'string' && raw.length <= 1024 ? toDesignRel(raw, designRel) : null;
    if (!canvas || !/\.(tsx|html)$/i.test(canvas))
      return { ok: false, res: json(400, { ok: false, reason: 'path must name a canvas' }) };
    if (access.canvasOnly && !access.seesCanvas(canvas))
      return { ok: false, res: notInScopeResponse() };
    if (!access.can(cap, canvas))
      return { ok: false, res: json(403, { ok: false, reason: 'forbidden' }) };
    return { ok: true, canvas, repoRel: repoRelOf(canvas) };
  }

  // The last answer per page, for "Offline — showing versions up to 14:05" (§5.14).
  const lastGood = new Map<string, { answer: VersionsAnswer & { ok: true }; at: number }>();
  const remember = (key: string, answer: VersionsAnswer & { ok: true }) => {
    lastGood.delete(key);
    lastGood.set(key, { answer, at: clock() });
    if (lastGood.size > 64) lastGood.delete(lastGood.keys().next().value as string);
  };

  async function outcomeResponse(
    r: Outcome | null | undefined,
    extra: Record<string, unknown> = {}
  ) {
    if (r === undefined) return json(503, { ok: false, reason: 'unreachable' });
    if (r === null) return json(409, { ok: false, reason: 'legacy' });
    if (r.status !== 'accepted') {
      if (r.code === 'hub-too-old')
        return json(409, { ok: false, reason: 'hub-too-old', line: NAME_NEEDS_HUB_UPDATE });
      return json(refusalStatus(r.code), { ok: false, reason: r.code ?? 'rejected' });
    }
    if (r.queued) return json(202, { ok: true, queued: true, ...extra });
    if (r.actionId) void announceAction({ control: runtime, emit: deps.emit }, r.actionId);
    return json(200, { ok: true, ...(r.actionId ? { actionId: r.actionId } : {}), ...extra });
  }

  /** `at` → a revision: `r<n>`, or `now` (the canvas's newest version). */
  async function revisionOf(
    rt: HistoryRuntime,
    at: unknown,
    t: { canvas: string; repoRel: string }
  ): Promise<number | null> {
    const ref = parseRef(at);
    if (!ref || ref.kind === 'git') return null;
    if (ref.kind === 'rev') return ref.rev;
    const answer = await listVersions({
      runtime: rt,
      repoRel: t.repoRel,
      canvas: t.canvas,
      limit: 1,
    });
    return answer.ok && answer.source === 'accepted' ? answer.newest : null;
  }

  return [
    // ── moved from http.ts's legacy literal (T27/T28), now judged per session ──
    {
      method: 'GET',
      path: '/_api/project/history',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const url = new URL(req.url);
        const access = accessOf(req);
        const rawPath = url.searchParams.get('path');
        let repoRel: string | null = null;
        if (rawPath) {
          const t = judge(access, rawPath, 'read');
          if (!t.ok) return t.res;
          repoRel = t.repoRel;
        } else if (!access.canvasOnly && !access.can('read', null)) {
          return json(403, { ok: false, reason: 'forbidden' });
        }
        const rt = runtime();
        const rows = rt?.acceptedHistory
          ? await rt
              .acceptedHistory({
                limit: Number(url.searchParams.get('limit') ?? 50) || 50,
                before: Number(url.searchParams.get('before') ?? 0) || null,
                path: repoRel,
              })
              .catch(() => undefined)
          : null;
        if (rows === undefined) return json(200, { ok: false, reason: 'unreachable' });
        if (rows === null) return json(200, { ok: false, reason: 'legacy' });
        let history = rows as HistoryRowLike[];
        if (access.canvasOnly) {
          // Only what touched a granted canvas, naming only granted canvases (U1 / U5).
          history = history
            .map((r) => {
              const canvases = r.canvases.filter((c) => access.seesCanvas(c));
              const lanes = r.lanes
                ? Object.fromEntries(Object.entries(r.lanes).filter(([c]) => access.seesCanvas(c)))
                : undefined;
              return { ...r, canvases, ...(lanes ? { lanes } : {}) };
            })
            .filter((r) => r.canvases.length > 0);
        }
        return json(200, { ok: true, history });
      },
    },
    {
      method: 'POST',
      path: '/_api/project/restore',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const parsed = await readBody(req, MAX_BODY);
        if (!parsed.ok) return parsed.res;
        const b = parsed.body;
        if (b.artboard !== undefined || b.element !== undefined)
          // S1.13 — "Restore only <artboard>" / one object.
          return json(501, { ok: false, reason: 'not-yet' });
        const access = accessOf(req);
        const t = judge(access, b.path, 'edit');
        if (!t.ok) return t.res;
        let revision: number;
        if (b.at !== undefined) {
          const ref = parseRef(b.at);
          if (ref?.kind !== 'rev')
            return json(400, { ok: false, reason: 'at must be a version (r<n>)' });
          revision = ref.rev;
        } else {
          revision = Number(b.revision);
          if (!Number.isSafeInteger(revision) || revision < 0)
            return new Response('body must include { path, revision }', { status: 400 });
        }
        const r = await runtime()?.acceptedRestore?.(t.repoRel, revision);
        // The v1 answer shape is kept: `maude design history restore` reads it.
        if (!r) return json(200, { ok: false, reason: 'legacy' });
        if (r.status === 'accepted' && r.actionId && !r.queued)
          void announceAction({ control: runtime, emit: deps.emit }, r.actionId);
        return json(r.status === 'accepted' ? 200 : 409, { ok: r.status === 'accepted', ...r });
      },
    },
    // ── new (V2-1.9 §5.11) ──
    {
      method: 'GET',
      path: '/_api/project/versions',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const url = new URL(req.url);
        const access = accessOf(req);
        const t = judge(access, url.searchParams.get('path'), 'read');
        if (!t.ok) return t.res;
        const filter = parseFilter(url.searchParams.get('filter'));
        if (!filter) return json(400, { ok: false, reason: 'filter must be all|named|ai|people' });
        const beforeRaw = url.searchParams.get('before');
        const before = beforeRaw === null ? null : Number(beforeRaw.replace(/^r/, ''));
        if (before !== null && (!Number.isSafeInteger(before) || before < 1))
          return json(400, { ok: false, reason: 'before must be a revision' });
        const limit = Number(url.searchParams.get('limit') ?? 50);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
          return json(400, { ok: false, reason: `limit must be 1–${MAX_LIMIT}` });
        const scope = access.canvasOnly ? 'canvas-only' : 'project';
        const answer = await listVersions({
          runtime: runtime(),
          repoRel: t.repoRel,
          canvas: t.canvas,
          before,
          limit,
          filter,
          scope,
          cache: deps.cache?.() ?? null,
          actorName: deps.actorName,
          ...(deps.gitHistory
            ? {
                gitHistory: (n: number) =>
                  (deps.gitHistory as NonNullable<typeof deps.gitHistory>)(t.repoRel, n),
              }
            : {}),
        });
        const key = `${t.canvas}|${before}|${limit}|${filter}|${scope}`;
        const now = (newest: number | null) => ({
          canvas: t.canvas,
          ref: newest === null ? null : `r${newest}`,
          status: deps.saveWord?.(t.repoRel) ?? null,
          canName: access.can('edit', t.canvas),
        });
        if (!answer.ok) {
          const hit = lastGood.get(key);
          if (!hit) return json(200, { ok: false, reason: 'unreachable' });
          const { newest, ...rest } = hit.answer;
          return json(200, {
            ...rest,
            now: { ...now(newest), canName: false },
            offline: { line: offlineLine(hit.at) },
          });
        }
        remember(key, answer);
        const { newest, ...rest } = answer;
        return json(200, { ...rest, now: now(newest) });
      },
    },
    {
      method: 'GET',
      path: '/_api/project/changes',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const url = new URL(req.url);
        const access = accessOf(req);
        const t = judge(access, url.searchParams.get('path'), 'read');
        if (!t.ok) return t.res;
        const from = parseRef(url.searchParams.get('from'));
        const to = parseRef(url.searchParams.get('to') ?? 'now');
        if (!from || from.kind === 'now' || !to)
          return json(400, {
            ok: false,
            reason: 'from must be r<n> or git:<sha>; to r<n>, git:<sha> or now',
          });
        const r = await describeBetween({
          runtime: runtime(),
          repoRel: t.repoRel,
          canvas: t.canvas,
          from,
          to,
          cache: deps.cache?.() ?? null,
          ...(deps.gitLane
            ? {
                gitLane: (sha: string, lane: VersionLane) =>
                  (deps.gitLane as NonNullable<typeof deps.gitLane>)(t.repoRel, sha, lane),
              }
            : {}),
        });
        if (!r.ok) return json(r.reason === 'not-found' ? 404 : 200, r);
        return json(200, r);
      },
    },
    {
      method: 'GET',
      path: '/_api/project/source',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const url = new URL(req.url);
        const access = accessOf(req);
        // Raw source at a version is a download (§5.12 "Raw diff / source"): `export`.
        const t = judge(access, url.searchParams.get('path'), 'export');
        if (!t.ok) return t.res;
        const lane = (url.searchParams.get('lane') ?? 'html') as VersionLane;
        if (!SOURCE_LANES.has(lane))
          return json(400, { ok: false, reason: 'lane must be html|css|meta' });
        const ref = parseRef(url.searchParams.get('at') ?? 'now');
        if (!ref) return json(400, { ok: false, reason: 'at must be r<n>, git:<sha> or now' });
        let source: string | null = null;
        if (ref.kind === 'git') {
          source = deps.gitLane
            ? await deps.gitLane(t.repoRel, ref.sha, lane).catch(() => null)
            : null;
        } else {
          const rt = runtime();
          if (!rt?.acceptedVersion) return json(200, { ok: false, reason: 'legacy' });
          const rev = await revisionOf(rt, ref.kind === 'rev' ? `r${ref.rev}` : 'now', t);
          source =
            rev === null ? null : await rt.acceptedVersion(t.repoRel, rev, lane).catch(() => null);
        }
        if (source === null) return json(404, { ok: false, reason: 'not-found' });
        return json(200, { ok: true, source });
      },
    },
    {
      method: 'POST',
      path: '/_api/project/name',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const parsed = await readBody(req, MAX_BODY);
        if (!parsed.ok) return parsed.res;
        const b = parsed.body;
        const access = accessOf(req);
        const t = judge(access, b.path, 'edit');
        if (!t.ok) return t.res;
        let name: string | null = null;
        if (b.name !== null) {
          if (typeof b.name !== 'string')
            return json(400, { ok: false, reason: 'name must be a string or null' });
          name = b.name.trim();
          if (!name || [...name].length > MAX_NAME || hasControl(name))
            return json(400, {
              ok: false,
              reason: `a name is 1–${MAX_NAME} characters, no control characters`,
            });
        }
        const rt = runtime();
        if (!rt?.acceptedName) return json(409, { ok: false, reason: 'legacy' });
        const rev = await revisionOf(rt, b.at ?? 'now', t).catch(() => undefined);
        if (rev === undefined) return json(503, { ok: false, reason: 'unreachable' });
        if (rev === null)
          return json(400, { ok: false, reason: 'at must be a version (r<n>) or now' });
        const r = await rt.acceptedName(t.repoRel, rev, name).catch(() => undefined);
        return outcomeResponse(r);
      },
    },
    {
      method: 'POST',
      path: '/_api/project/aside',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const parsed = await readBody(req, MAX_ASIDE_BODY);
        if (!parsed.ok) return parsed.res;
        const b = parsed.body;
        const access = accessOf(req);
        const t = judge(access, b.path, 'edit');
        if (!t.ok) return t.res;
        if (typeof b.lane !== 'string' || !ASIDE_LANES.has(b.lane))
          return json(400, { ok: false, reason: 'lane must be html|css|meta|annotations' });
        if (typeof b.content !== 'string')
          return json(400, { ok: false, reason: 'content must be a string' });
        const label =
          typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 200) : undefined;
        const rt = runtime();
        if (!rt?.acceptedAside) return json(409, { ok: false, reason: 'legacy' });
        const r = await rt
          .acceptedAside(
            t.repoRel,
            b.lane as 'html' | 'css' | 'meta' | 'annotations',
            b.content,
            label
          )
          .catch(() => undefined);
        return outcomeResponse(r);
      },
    },
  ];
}
