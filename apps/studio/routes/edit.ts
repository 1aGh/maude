// routes/edit.ts — `POST /_api/edit-op` (S2.1; contract client/v2/contracts/S2-edit-ops.md).
//
// The ONE dispatch route for S2's structural writes and S3's links: the op name is the registry
// action id, the writers are pure (`edit-ops/<op>.ts`), the order of refusals is the dispatcher's
// (`edit-ops/dispatch.ts`). MAIN ORIGIN ONLY — in neither canvas allowlist; the untrusted canvas
// iframe asks through the shell (`dgn:'edit-op'`, client/hooks/use-canvas-bridge.jsx) and the
// shell pins `file` to the active canvas. `readOnly: 'refused'`: a viewer, a Can comment session
// and a format-gated project get the read-only gate's 403 before this handler runs (minRole edit).
//
// One request = one file write = one kernel action (V2-1.5). Writes to one file are serialized.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type { RunRegistry } from '../ai/runs.ts';
import { CLIP_EDIT_VERBS } from '../edit-ops/clip/index.ts';
import { type AiHoldHit, dispatchEditOp, statusOf } from '../edit-ops/dispatch.ts';
import { createWriteLog, type WriteLog } from '../edit-ops/revert.ts';
import { type EditOp, MAX_BODY } from '../edit-ops/types.ts';
import { heldByAi } from './agent.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface EditRouteDeps {
  designRoot: string;
  /** `.design` — a `file` may carry it as a prefix */
  designRel: string;
  repoRoot: string;
  /** `activity:suppress` / `activity:unsuppress` on the studio bus (the base announcement) */
  emit(event: string, payload?: unknown): void;
  /** the pre-op snapshot for /design:rollback (best effort) */
  snapshot?(rel: string, before: string, reason: string): Promise<unknown>;
  /** THE run registry — AI holds (V2-1.15 §4 #13) */
  runs?: RunRegistry;
  /** accepted-revisions mode: the action a write became, by repo-relative path + bytes */
  actionFor?(repoRel: string, after: string): string | null;
  /** tests only: an op table instead of `EDIT_OPS` */
  ops?: readonly EditOp[];
  log?: WriteLog;
}

/** designRoot-relative `.tsx` path of an existing canvas inside the design root, or null. */
export function resolveCanvasRel(
  designRoot: string,
  designRel: string,
  file: string
): string | null {
  let p = file.replace(/\\/g, '/').replace(/^\/+/, '');
  const dr = designRel.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  if (dr && p.startsWith(`${dr}/`)) p = p.slice(dr.length + 1);
  if (!p.endsWith('.tsx')) p = `${p}.tsx`;
  if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  // Runtime state is never a canvas (DDR-115: `_history/`, `_draw/`, …).
  if (p.startsWith('_')) return null;
  try {
    const root = realpathSync(designRoot);
    const real = realpathSync(path.join(designRoot, ...p.split('/')));
    if (!real.startsWith(root + path.sep) || !statSync(real).isFile()) return null;
    return path.relative(root, real).split(path.sep).join('/');
  } catch {
    return null;
  }
}

/**
 * S7.6 — a live AI run LEASES `artboard` of `canvas` (null = any artboard of it): an AI cut owns
 * the whole comp, so an artboard-scoped clip / video op refuses with `held-by-ai`. A waiting run
 * holds nothing yet; a member's run counts (its `artboards` are its leases).
 */
export function artboardHeldByAi(
  registry: RunRegistry,
  canvas: string,
  artboard: string | null
): AiHoldHit | null {
  const key = registry.canvasKey(canvas);
  const hit = (l: { canvas: string; artboard: string }) =>
    (l.canvas === key || l.canvas === canvas) && (artboard === null || l.artboard === artboard);
  for (const r of registry.live())
    if (r.state !== 'waiting' && r.leases.some(hit)) return { mine: true };
  for (const r of registry.view().others)
    if (r.state !== 'waiting' && r.artboards.some(hit)) return { mine: false };
  return null;
}

/** The legacy `/_api/clip-edit` body (`{canvas, artboardId?, stableId, contentHash?, verb, …}`) as
 *  an edit-op request, or null when its verb has no op. Every other key rides along as a param. */
export function clipEditToEditOp(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { canvas, artboardId, verb, ...rest } = body as Record<string, unknown>;
  const op = typeof verb === 'string' ? CLIP_EDIT_VERBS.get(verb) : undefined;
  if (!op) return null;
  const params: Record<string, unknown> = { ...rest };
  if (typeof artboardId === 'string' && artboardId) params.artboard = artboardId;
  return { file: canvas, op, targets: [], params };
}

export function createEditRoutes(deps: EditRouteDeps): RouteSpec[] {
  const log = deps.log ?? createWriteLog();
  const chains = new Map<string, Promise<unknown>>();
  const abs = (rel: string) => path.join(deps.designRoot, ...rel.split('/'));
  const serialized = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(run);
    chains.set(key, next);
    void next.finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
    return next;
  };

  const run = (body: unknown) => {
    const file = (body as { file?: unknown } | null)?.file;
    const key =
      typeof file === 'string'
        ? (resolveCanvasRel(deps.designRoot, deps.designRel, file) ?? '')
        : '';
    return serialized(key, () =>
      dispatchEditOp(body, {
        resolve: (f) => resolveCanvasRel(deps.designRoot, deps.designRel, f),
        read: (rel) => {
          try {
            return readFileSync(abs(rel), 'utf8');
          } catch {
            return null;
          }
        },
        write: async (rel, before, after, label) => {
          deps.emit('activity:suppress', rel);
          try {
            await Bun.write(abs(rel), after);
          } catch (e) {
            deps.emit('activity:unsuppress', rel);
            throw e;
          }
          try {
            await deps.snapshot?.(rel, before, label);
          } catch {
            /* snapshot best-effort */
          }
        },
        heldByAi: (rel, element) => (deps.runs ? heldByAi(deps.runs, rel, element) : null),
        artboardHeldByAi: (rel, artboard) =>
          deps.runs ? artboardHeldByAi(deps.runs, rel, artboard) : null,
        actionFor: (rel, after) =>
          deps.actionFor?.(
            path.relative(deps.repoRoot, abs(rel)).split(path.sep).join('/'),
            after
          ) ?? null,
        log,
        ...(deps.ops ? { ops: deps.ops } : {}),
      })
    );
  };

  return [
    {
      method: 'POST',
      path: '/_api/edit-op',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { ok: false, code: 'invalid', message: 'That edit is too large.' });
        const text = await req.text();
        if (text.length > MAX_BODY)
          return json(413, { ok: false, code: 'invalid', message: 'That edit is too large.' });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return json(400, { ok: false, code: 'invalid', message: 'The edit is not readable.' });
        }
        const result = await run(body);
        return json(statusOf(result), result);
      },
    },
    {
      // S7.6 — the legacy clip-verb door, kept as an ALIAS of the dispatcher (S7-slices Q2): the
      // old body shape, the same bytes as `clip.<verb>` through /_api/edit-op, the same refusals.
      // No `seq` any more: undo is the project's (V2-1.5), the timeline-local revert is retired.
      method: 'POST',
      path: '/_api/clip-edit',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const text = await req.text();
        if (text.length > 16 * 1024) return json(413, { ok: false, error: 'body too large' });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return json(400, { ok: false, error: 'body required' });
        }
        const mapped = clipEditToEditOp(body);
        if (!mapped) {
          const verb = (body as { verb?: unknown } | null)?.verb;
          return json(400, { ok: false, error: `unknown clip verb "${String(verb ?? '')}"` });
        }
        const r = await run(mapped);
        if (!r.ok) return json(statusOf(r), { ok: false, code: r.code, error: r.message });
        return json(200, {
          ok: true,
          ...(r.detail ?? {}),
          actionId: r.actionId,
          writeId: r.writeId,
          rev: r.rev,
        });
      },
    },
  ];
}
