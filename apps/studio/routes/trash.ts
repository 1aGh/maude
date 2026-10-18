// The shared Trash — S1.7 (S1-canvas-row-slots §4, S1-trash.md).
//
//   GET  /_api/trash                         → { ok, items, canClear, seq } · { ok, legacy: true, … }
//   POST /_api/trash/restore  { id }         → { ok, id, path, renamed } · 409 cleared | taken | not-in-trash
//                                              · 403 forbidden | not-in-scope · 501 not-yet (an artboard)
//   POST /_api/trash/clear    { items? }     → { ok, cleared, skipped? } · 403 forbidden | not-in-scope
//
// MAIN ORIGIN ONLY, never canvas-safe: the list names people and the canvases of
// a project, and restore / clear-out are writes the untrusted canvas must not be
// able to make (DDR-054/088). Every answer comes through `ctx.syncControl.current()`
// (the hub runtime for a linked project, the local home otherwise), so no route
// learns which home answered (S5-kernel-foundation §5).
//
// The gate is HERE, per request, not only in the kernel: in a cell one studio
// serves an owner and an editor at once, and its link to the hub is the cell's
// own (project-level) credential — the kernel would see the cell, not the person.
// So the route judges the session's access (history/trash.ts `trashAccess`), and
// the kernel re-checks the role per op wherever the person's own credential
// reaches it (a desktop linked to a hub). Hidden ≠ refused: `canClear` only says
// what to draw; the clear route refuses an editor with 403 whatever the client drew.

import type { Access } from '../access/scope.ts';
import {
  ARTBOARD_ID,
  ARTBOARD_NOT_YET_LINE,
  type ArtboardItem,
  CANVAS_ID,
  canClearTrash,
  deriveTrash,
  NEEDS_HUB_UPDATE_LINE,
  parseClearItems,
  refusalOf,
  type TrashItem,
  type TrashOutcome,
  type TrashRuntime,
  visibleTrash,
} from '../history/trash.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 64 * 1024;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface TrashRouteDeps {
  /** `ctx.syncControl.current()` — null while no home answers. */
  control: () => TrashRuntime | null | undefined;
  /** The access this request is judged with (history/trash.ts `trashAccess`). */
  access: (req: Request) => Access;
  /** A live canvas's source by design-root-relative path; null when unreadable. */
  readSource: (designRelPath: string) => string | null;
  /** ctx.bus.emit — `trash:changed { seq }` after an accepted restore / clear-out. */
  emit?: (event: string, payload: unknown) => void;
  /**
   * S1.13's seam — "Restore only <artboard>" (V2-1.9 §5.8), the splice from the
   * revision before the trash action. Absent until S1.13 lands: an artboard
   * restore then answers 501 `not-yet`.
   */
  restoreArtboard?: (item: ArtboardItem, access: Access) => Promise<TrashOutcome | null>;
  now?: () => number;
}

async function readJson(
  req: Request
): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  if (Number(req.headers.get('content-length')) > MAX_BODY)
    return { ok: false, res: json(413, { ok: false, reason: 'too-large' }) };
  const text = await req.text();
  if (text.length > MAX_BODY)
    return { ok: false, res: json(413, { ok: false, reason: 'too-large' }) };
  if (!text.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: json(400, { ok: false, reason: 'body must be JSON' }) };
  }
}

const refused = (code: string | undefined, extra: Record<string, unknown> = {}) => {
  const r = refusalOf(code);
  return json(r.status, {
    ok: false,
    reason: r.reason,
    ...(r.reason === 'needs-hub-update' ? { line: NEEDS_HUB_UPDATE_LINE } : {}),
    ...extra,
  });
};

export function createTrashRoutes(deps: TrashRouteDeps): RouteSpec[] {
  let seq = 0;
  const changed = () => {
    seq += 1;
    deps.emit?.('trash:changed', { seq });
  };

  /** The items this session sees, or null when the home has no shared Trash. */
  async function itemsFor(access: Access): Promise<TrashItem[] | null | undefined> {
    const runtime = deps.control();
    if (!runtime?.acceptedTrash) return null;
    const listing = await runtime.acceptedTrash().catch(() => undefined);
    if (!listing) return listing;
    return visibleTrash(
      deriveTrash(listing, { readSource: deps.readSource, now: deps.now?.() }),
      access
    );
  }

  return [
    {
      method: 'GET',
      path: '/_api/trash',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const access = deps.access(req);
        const items = await itemsFor(access);
        if (items === undefined) return json(200, { ok: false, reason: 'unreachable', seq });
        if (items === null)
          return json(200, { ok: true, legacy: true, items: [], canClear: false, seq });
        return json(200, { ok: true, items, canClear: canClearTrash(access), seq });
      },
    },
    {
      method: 'POST',
      path: '/_api/trash/restore',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const parsed = await readJson(req);
        if (!parsed.ok) return parsed.res;
        const id = (parsed.body as { id?: unknown } | null)?.id;
        if (typeof id !== 'string' || !(CANVAS_ID.test(id) || ARTBOARD_ID.test(id)))
          return json(400, { ok: false, reason: 'id must be a trash item id' });
        const access = deps.access(req);
        // Nobody without `trash` somewhere gets as far as learning what is in the Trash.
        if (!access.canvasOnly && !access.can('trash', null))
          return json(403, { ok: false, reason: 'forbidden' });
        const items = await itemsFor(access);
        if (items === undefined) return json(503, { ok: false, reason: 'unreachable' });
        if (items === null) return json(409, { ok: false, reason: 'legacy' });
        const item = items.find((i) => i.id === id);
        if (!item) {
          // A canvas-only session learns nothing about a canvas it was not
          // granted: unknown, cleared and not-in-the-trash read the same (U1).
          if (access.canvasOnly) return json(403, { ok: false, reason: 'not-in-scope' });
          if (!id.startsWith('canvas:')) return json(409, { ok: false, reason: 'not-in-trash' });
          // Not listed: let the kernel say why (`cleared` is final, S1-trash.md §3).
        } else if (!access.can('trash', item.path)) {
          return json(403, { ok: false, reason: 'forbidden' });
        }
        if (item?.kind === 'artboard') {
          if (item.canvasTrashed) return json(409, { ok: false, reason: 'canvas-trashed' });
          const r = deps.restoreArtboard ? await deps.restoreArtboard(item, access) : null;
          if (!r) return json(501, { ok: false, reason: 'not-yet', line: ARTBOARD_NOT_YET_LINE });
          if (r.status !== 'accepted') return refused(r.code);
          if (!r.queued) changed();
          return json(r.queued ? 202 : 200, {
            ok: true,
            id,
            path: item.path,
            ...(r.queued ? { queued: true } : {}),
          });
        }
        const entry = (CANVAS_ID.exec(id) as RegExpExecArray)[1] as string;
        const runtime = deps.control();
        const r = runtime?.acceptedTrashRestore
          ? await runtime.acceptedTrashRestore(entry).catch(() => undefined)
          : null;
        if (r === undefined) return json(503, { ok: false, reason: 'unreachable' });
        if (!r) return json(409, { ok: false, reason: 'legacy' });
        if (r.status !== 'accepted') return refused(r.code);
        if (r.queued) return json(202, { ok: true, id, queued: true });
        changed();
        const path = r.path ?? item?.path ?? null;
        return json(200, {
          ok: true,
          id,
          path,
          renamed: !!(item && path && path !== item.path),
          ...(r.actionId ? { actionId: r.actionId } : {}),
        });
      },
    },
    {
      method: 'POST',
      path: '/_api/trash/clear',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const access = deps.access(req);
        // Project-level, owner-only (V2-1.7 §5.2 `delete`): every canvas-only
        // session is refused, whatever it holds on its canvases.
        if (access.canvasOnly) return json(403, { ok: false, reason: 'not-in-scope' });
        if (!canClearTrash(access)) return json(403, { ok: false, reason: 'forbidden' });
        const parsed = await readJson(req);
        if (!parsed.ok) return parsed.res;
        const items = parseClearItems(parsed.body);
        if (!items.ok) return json(400, { ok: false, reason: items.reason });
        const runtime = deps.control();
        const r = runtime?.acceptedTrashClear
          ? await runtime.acceptedTrashClear(items.items).catch(() => undefined)
          : null;
        if (r === undefined) return json(503, { ok: false, reason: 'unreachable' });
        if (!r) return json(409, { ok: false, reason: 'legacy' });
        if (r.status !== 'accepted') return refused(r.code);
        if (r.queued) return json(202, { ok: true, queued: true });
        changed();
        return json(200, {
          ok: true,
          cleared: r.cleared ?? [],
          ...(r.skipped?.length ? { skipped: r.skipped } : {}),
        });
      },
    },
  ];
}
