// Undo over the one op log — V2-1.5 §5.3 (S5.5).
//
//   GET  /_api/project/undo-stack?canvas=<repoRel>[&since=<ms>]  → { ok, entries, redo }
//   POST /_api/project/undo  { actionId } | { actionIds } | { chatId }  (+ redo?, via?)
//                            → { ok, actionId, undoes, skipped? } · 409 undo-conflict
//
// MAIN ORIGIN ONLY (never `origin: 'canvas'`): history names people, and undo is
// a write the untrusted canvas must not be able to make (DDR-054/088). Both
// answer through `ctx.syncControl.current()` — the hub runtime for a linked
// project, the local home otherwise — so no route learns which home answered
// (S5-kernel-foundation §5).
//
// `via` says who asked: `keys` (⌘Z / ⇧⌘Z — the default for one id) labels the
// action "Undo" / "Redo", which the ⌘Z projection reads as a FLIP of its target;
// `panel` (Undo this chat, Undo history, Version history) labels it by what it
// undid, which the projection reads as an ENTRY ⌘Z can take back.
//
// An old hub refuses `actionIds` as `invalid`: "Undo this chat" is then
// disabled with one line, never replayed as a sequence of single undos
// (V2-1.5 Q2 — a half-applied chat undo is worse than none).

import { fold, initialState, view } from '../client/v2/undo/projection.js';
import type { AcceptedHistoryRow } from '../sync/index.ts';
import { parseUndoTarget, type UndoTarget } from '../sync/undo-target.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 8 * 1024;
export const NEEDS_HUB_UPDATE = 'Undo this chat needs the team server to be updated';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

type UndoAnswer = {
  status: 'accepted' | 'rejected';
  code?: string;
  queued?: boolean;
  actionId?: string;
  undoes?: string | string[];
  skipped?: Array<{ doc?: string; lane?: string; reason: string; conflictWith?: string }>;
};

export interface ProjectUndoRuntime {
  acceptedHistory?(q: {
    limit?: number;
    before?: number | null;
    path?: string | null;
    mine?: boolean;
  }): Promise<unknown[] | null>;
  acceptedUndo?(
    target: string | UndoTarget,
    redo?: boolean,
    o?: { via?: 'keys' | 'panel' }
  ): Promise<UndoAnswer | null>;
}

export interface ProjectUndoDeps {
  /** `ctx.syncControl.current()` — null while no home answers. */
  control: () => ProjectUndoRuntime | null | undefined;
  /** `.design` — `canvas=<repoRel>` → the design-root-relative path history rows carry. */
  designRel: string;
  /** ctx.bus.emit — `project:action` (V2-1.5 §5.3). */
  emit?: (event: string, payload: unknown) => void;
}

/** V2-1.5 §5.3 bus payload, from a history row (+ the attribution when known). */
export function projectActionEvent(
  row: AcceptedHistoryRow,
  artboards: Record<string, string[]> = {}
): Record<string, unknown> {
  return {
    actionId: row.actionId,
    actor: row.actor,
    mine: row.mine,
    kind: row.kind,
    label: row.label,
    revision: row.revision,
    committedAt: row.committedAt,
    madeAt: row.madeAt ?? row.committedAt,
    canvases: row.canvases,
    artboards,
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.chatId ? { chatId: row.chatId } : {}),
    ...(row.undoes ? { undoes: row.undoes } : {}),
    ...(row.partial ? { partial: true } : {}),
  };
}

/** Announce an accepted action on the bus: its row is read back so the payload is the log's. */
export async function announceAction(
  deps: Pick<ProjectUndoDeps, 'control' | 'emit'>,
  actionId: string,
  artboards: Record<string, string[]> = {}
): Promise<void> {
  if (!deps.emit) return;
  const rows = (await deps
    .control()
    ?.acceptedHistory?.({ limit: 20 })
    .catch(() => null)) as AcceptedHistoryRow[] | null | undefined;
  const row = rows?.find((r) => r.actionId === actionId);
  if (row) deps.emit('project:action', projectActionEvent(row, artboards));
}

function designRelOf(repoRel: string, designRel: string): string {
  const p = repoRel.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  return prefix !== '/' && p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

export function createProjectUndoRoutes(deps: ProjectUndoDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/project/undo-stack',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const url = new URL(req.url);
        const repoRel = url.searchParams.get('canvas');
        if (!repoRel || repoRel.length > 1024 || repoRel.includes('\0'))
          return json(400, { ok: false, reason: 'canvas=<repoRel> is required' });
        const since = Number(url.searchParams.get('since') ?? 0);
        const runtime = deps.control();
        if (!runtime?.acceptedHistory) return json(200, { ok: false, reason: 'legacy' });
        const rows = await runtime
          .acceptedHistory({ path: repoRel, limit: 200, mine: true })
          .catch(() => undefined);
        if (rows === undefined) return json(200, { ok: false, reason: 'unreachable' });
        if (rows === null) return json(200, { ok: false, reason: 'legacy' });
        const canvas = designRelOf(repoRel, deps.designRel);
        // The SAME reducer the shell runs (client/v2/undo/projection.js), over history oldest first.
        const state = fold(
          initialState({ canvas, openedAt: Number.isFinite(since) && since > 0 ? since : 0 }),
          [...(rows as AcceptedHistoryRow[])]
            .sort((a, b) => a.revision - b.revision)
            .map((action) => ({ type: 'action', action }))
        );
        return json(200, { ok: true, ...view(state) });
      },
    },
    {
      method: 'POST',
      path: '/_api/project/undo',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { ok: false, reason: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return new Response('body must be JSON', { status: 400 });
        }
        const parsed = parseUndoTarget(body);
        if (!parsed.ok) return new Response(parsed.reason, { status: 400 });
        const viaRaw = (body as { via?: unknown }).via;
        const via: 'keys' | 'panel' =
          viaRaw === 'panel' || viaRaw === 'keys'
            ? viaRaw
            : 'actionId' in parsed.target
              ? 'keys'
              : 'panel';
        const runtime = deps.control();
        const r = runtime?.acceptedUndo
          ? await runtime.acceptedUndo(parsed.target, parsed.redo, { via })
          : null;
        if (!r) return json(200, { ok: false, reason: 'legacy' });
        const multi = !('actionId' in parsed.target);
        if (r.status !== 'accepted' && multi && r.code === 'invalid') {
          // A hub older than S5.1a: no `actionIds`. Disabled, with the line.
          return json(409, { ok: false, reason: 'needs-hub-update', line: NEEDS_HUB_UPDATE });
        }
        if (r.status === 'accepted' && r.actionId && !r.queued) {
          void announceAction(deps, r.actionId).catch(() => {});
        }
        return json(r.status === 'accepted' ? 200 : 409, {
          ok: r.status === 'accepted',
          ...r,
        });
      },
    },
  ];
}
