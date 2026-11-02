// The object-conflict card's two routes — S9.24 (10 · co-sync-back, co-conflict). A handler TABLE
// (V2-2.5); `routes/index.ts` mounts it.
//
//   GET  /_api/sync/conflicts                          → 200 { conflicts: [{ slug, file, id, type, fields, mine, theirs, actionId?, at }] }
//   POST /_api/sync/conflicts/resolve { slug, id, choice: 'mine' | 'theirs' | 'both' }
//                                                      → 200 { ok, choice, changed, copyId? } · 404 gone · 409 unreadable
//
// MAIN ORIGIN ONLY, never canvas-safe: the answer names canvases and carries element bodies.
// The record is THIS Mac's (`_state/conflicts/`, sync/conflict-record.ts) — the proposer's card.
//
// Resolve is ONE ordinary lane edit: the pick is built with `resolveObjectConflict` on the CURRENT
// head (the board on disk, which is the accepted head in accepted mode), diffed into element ops,
// and applied through the canvas's own write path (`applyAnnotationOps` — one batch, one proposal,
// one undo step). Keep theirs changes nothing (the head already holds theirs; ours is the action's
// `@aside`). Every pick then drops the entry. Needs `edit` (`readOnly: 'refused'`; the local gate's
// default capability for an unlisted write), judged on the canvas the slug names (`target`).

import { notInScopeResponse, toDesignRel } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import { type Op as AnnotationOp, diffToOps } from '../annotations/ops.ts';
import { parseBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { clearConflict, listConflicts, readConflicts } from '../sync/conflict-record.ts';
import { type ConflictChoice, resolveObjectConflict } from '../sync/object-conflict.ts';
import type { RouteSpec } from './table.ts';

export interface SyncConflictRouteDeps {
  designRoot: string;
  designRel: string;
  /** slug → the canvas's repo-relative file (api.fileForSlug), or null when it is not here. */
  fileForSlug(slug: string): Promise<string | null>;
  readBoard(
    file: string
  ): Promise<{ ok: true; text: string | null } | { ok: false; error: string }>;
  applyAnnotationOps(
    file: string,
    ops: readonly AnnotationOp[]
  ): Promise<{ ok: boolean; changed: boolean; rejected: unknown[]; error?: string }>;
  /** The request's session; null = the local owner. */
  access(req: Request): Access | null;
  /** The shells re-read the card. */
  emit?(event: string, payload: unknown): void;
}

const MAX_BODY = 4 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CHOICES: ReadonlySet<string> = new Set(['mine', 'theirs', 'both']);
const noStore = { 'Cache-Control': 'no-store' };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) return null;
  try {
    const text = await req.clone().text();
    if (text.length > MAX_BODY) return null;
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createSyncConflictRoutes(deps: SyncConflictRouteDeps): RouteSpec[] {
  /** The canvas a slug names, designRoot-relative — what access is judged on. */
  async function relOf(slug: string): Promise<{ file: string; rel: string } | null> {
    const file = await deps.fileForSlug(slug);
    if (!file) return null;
    const rel = toDesignRel(file, deps.designRel);
    return rel ? { file, rel } : null;
  }
  const sees = (access: Access | null, rel: string, cap: 'read' | 'edit') =>
    !access || (access.seesCanvas(rel) && access.can(cap, rel));

  return [
    {
      method: 'GET',
      path: '/_api/sync/conflicts',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const access = deps.access(req);
        if (access && access.role === null && !access.canvasOnly) return notInScopeResponse();
        const out: Array<Record<string, unknown>> = [];
        for (const rec of listConflicts(deps.designRoot)) {
          const where = await relOf(rec.slug);
          // A canvas that is not on this Mac (any more) has no card; one the session may not see
          // is left out exactly like a canvas with no conflict (no existence oracle).
          if (!where || !sees(access, where.rel, 'read')) continue;
          for (const c of rec.conflicts) out.push({ slug: rec.slug, file: where.file, ...c });
        }
        return json(200, { conflicts: out });
      },
    },
    {
      method: 'POST',
      path: '/_api/sync/conflicts/resolve',
      origin: 'main',
      readOnly: 'refused',
      // The gate judges `edit` on the canvas the slug names, not on a body path.
      target: async (req) => {
        const body = await readBody(req);
        const slug = typeof body?.slug === 'string' ? body.slug : '';
        if (!slug) return undefined;
        return (await relOf(slug))?.rel ?? null;
      },
      handle: async (req) => {
        const body = await readBody(req);
        if (!body) return json(400, { ok: false, reason: 'body must be a JSON object' });
        const { slug, id, choice } = body;
        if (typeof slug !== 'string' || !slug || slug.length > 200)
          return json(400, { ok: false, reason: 'slug is required' });
        if (typeof id !== 'string' || !ID_RE.test(id))
          return json(400, { ok: false, reason: 'id is required' });
        if (typeof choice !== 'string' || !CHOICES.has(choice))
          return json(400, { ok: false, reason: 'choice is mine, theirs or both' });
        const where = await relOf(slug);
        if (!where) return json(404, { ok: false, reason: 'gone' });
        const access = deps.access(req);
        if (!sees(access, where.rel, 'edit')) return notInScopeResponse();
        const entry = readConflicts(deps.designRoot, slug).find((e) => e.id === id);
        if (!entry) return json(404, { ok: false, reason: 'gone' });

        let changed = false;
        let copyId: string | null = null;
        if (choice !== 'theirs') {
          const read = await deps.readBoard(where.file);
          if (!read.ok) return json(409, { ok: false, reason: 'unreadable' });
          const els = read.text ? parseBoard(read.text).elements : [];
          const head = new Map<string, AnnotationElement>(els.map((e) => [e.id, e]));
          const r = resolveObjectConflict(
            head,
            { id, mine: entry.mine as AnnotationElement | null },
            choice as ConflictChoice
          );
          copyId = r.copyId;
          const ops = diffToOps(head, new Map(r.elements.map((e) => [e.id, e])));
          if (ops.length) {
            const applied = await deps.applyAnnotationOps(where.file, ops);
            if (!applied.ok || applied.rejected.length)
              return json(409, { ok: false, reason: applied.error ? 'unreadable' : 'stale' });
            changed = applied.changed;
          }
        }
        clearConflict(deps.designRoot, slug, id);
        deps.emit?.('sync:conflicts', { slug, id });
        return json(200, { ok: true, choice, changed, ...(copyId ? { copyId } : {}) });
      },
    },
  ];
}
