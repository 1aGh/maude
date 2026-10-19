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
  bumpTrashSeq,
  CANVAS_ID,
  canClearTrash,
  currentTrashSeq,
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
  /**
   * `ctx.syncControl.current()` — null while no home answers. Any runtime: the
   * Trash methods are optional (an older home has none), so it is read as a
   * `TrashRuntime` here rather than every home's type naming them.
   */
  control: () => TrashRuntime | object | null | undefined;
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

// ------------------------------------------------------------------ the write stop (S9.21b)
//
// Decision v2-lead-trashed-while-open-stops-writes: a canvas moved to the trash while a tab has it
// open stops taking writes AT ONCE, on every write route — otherwise that tab's next edit writes
// the file again and brings the canvas back under the person who trashed it. What the tab had not
// sent yet is parked with the trashed canvas (V2-1.14 G1, sync/transaction-client.ts), and Restore
// brings both back. Sidecar lanes (`.meta.json`, `.annotations.json`) stop with their canvas.
// Comments stop too (they live in the canvas's own doc); per-user runtime (viewport, prefs) and
// exports do not — they change nothing of the canvas.

/** The words a refused write carries (the toast the shell says). */
export const IN_TRASH_LINE = 'This canvas is in the trash. Restore it to change it.';

/** The refusal of a write to a trashed canvas — the same body on every route. */
export function inTrashResponse(): Response {
  return json(409, { ok: false, error: 'in-trash', reason: 'in-trash', message: IN_TRASH_LINE });
}

/** The capabilities whose writes change a canvas (access/request.ts `writeCapability`). */
const CANVAS_WRITES: ReadonlySet<string> = new Set(['edit', 'annotate', 'comment']);
const SIDECAR_RE = /\.(meta\.json|annotations\.json|annotations\.svg)$/i;
const CANVAS_RE = /\.(tsx|jsx|html)$/i;

/** The canvas a designRoot-relative write target belongs to (itself, or the canvas of a sidecar). */
export function canvasStemOf(rel: string): string {
  return rel.replace(CANVAS_RE, '').replace(SIDECAR_RE, '');
}

export interface TrashWriteStopDeps {
  /** `ctx.syncControl.current()` — the Trash listing + the manifest's live docs. */
  control: () =>
    | (TrashRuntime & {
        acceptedLinkDocs?(): Promise<
          { entry: string; path: string | null; retired: boolean }[] | null
        >;
      })
    | object
    | null
    | undefined;
  /** The request's write target, designRoot-relative (access/request.ts `targetOf`). */
  target: (req: Request) => Promise<string | null | undefined>;
  /** ctx.bus.on — `trash:changed` invalidates the cached set at once. */
  on?: (event: string, fn: (...a: unknown[]) => void) => unknown;
  /** ctx.bus.emit — `trash:write-stop { stems }` after every refresh (ws.ts closes the collab lanes). */
  emit?: (event: string, payload: unknown) => void;
  /** How long a computed set is trusted without a `trash:changed` (default 30 s). */
  ttlMs?: number;
  /** How long a write waits for a refresh before the last known set answers (default 1.5 s). */
  waitMs?: number;
  now?: () => number;
}

export interface TrashWriteStop {
  /** The 409 for a canvas write whose target is in the trash, else null. `cap` = the write's capability. */
  refusal(req: Request, cap: string): Promise<Response | null>;
  /** The stems (designRoot-relative, no extension) that take no writes right now. */
  stopped(): ReadonlySet<string>;
  /** Recompute now (tests, and `trash:changed`). */
  refresh(): Promise<ReadonlySet<string>>;
}

/**
 * The write stop. A canvas is stopped while the shared Trash lists it AND no live document holds its
 * path (a new canvas made at the same place after the trash is not the trashed one). No shared Trash
 * (a legacy home, unlinked) = nothing is stopped. A listing that cannot be read keeps the last answer.
 */
export function createTrashWriteStop(deps: TrashWriteStopDeps): TrashWriteStop {
  const ttl = deps.ttlMs ?? 30_000;
  const wait = deps.waitMs ?? 1500;
  const now = deps.now ?? Date.now;
  let stems: ReadonlySet<string> = new Set();
  let at = Number.NEGATIVE_INFINITY;
  let inflight: Promise<ReadonlySet<string>> | null = null;
  /** Bumped by every `trash:changed`: a read that began before one is not the answer to it. */
  let gen = 0;

  async function compute(): Promise<ReadonlySet<string> | null> {
    const runtime = deps.control() as
      | (TrashRuntime & {
          acceptedLinkDocs?(): Promise<{ path: string | null; retired: boolean }[] | null>;
        })
      | null
      | undefined;
    if (!runtime?.acceptedTrash) return new Set();
    const listing = await runtime.acceptedTrash().catch(() => undefined);
    if (listing === undefined) return null;
    if (!listing) return new Set();
    const docs = runtime.acceptedLinkDocs
      ? await runtime.acceptedLinkDocs().catch(() => null)
      : null;
    const live = new Set(
      (docs ?? []).filter((d) => !d.retired && d.path).map((d) => canvasStemOf(d.path as string))
    );
    const out = new Set<string>();
    for (const c of listing.canvases) {
      if (typeof c?.path !== 'string' || !c.path) continue;
      const stem = canvasStemOf(c.path);
      if (!live.has(stem)) out.add(stem);
    }
    return out;
  }

  function refresh(): Promise<ReadonlySet<string>> {
    if (inflight) return inflight;
    const began = gen;
    inflight = (async () => {
      try {
        const next = await compute().catch(() => null);
        // An unreadable listing (offline) keeps the last answer and counts as a read: writes made
        // offline are not held up by a hub that cannot answer.
        at = began === gen ? now() : Number.NEGATIVE_INFINITY;
        if (next) {
          stems = next;
          deps.emit?.('trash:write-stop', { stems: [...next] });
        }
        return stems;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  deps.on?.('trash:changed', () => {
    gen += 1;
    at = Number.NEGATIVE_INFINITY;
    void refresh();
  });

  return {
    stopped: () => stems,
    refresh,
    async refusal(req, cap) {
      if (!CANVAS_WRITES.has(cap)) return null;
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
      // Just told the Trash changed (or never read): this write waits for the answer, briefly.
      // Merely old: it is answered from what is known while the set refreshes behind it.
      // (A read already under way when the Trash changed answers nothing about it — read again.)
      if (at === Number.NEGATIVE_INFINITY) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let late = false;
        const deadline = new Promise<void>((r) => {
          timer = setTimeout(() => {
            late = true;
            r();
          }, wait);
        });
        for (let i = 0; i < 3 && at === Number.NEGATIVE_INFINITY && !late; i++)
          await Promise.race([refresh(), deadline]);
        clearTimeout(timer);
      } else if (now() - at > ttl) void refresh();
      if (stems.size === 0) return null;
      const target = await deps.target(req);
      if (typeof target !== 'string' || !target) return null;
      return stems.has(canvasStemOf(target)) ? inTrashResponse() : null;
    },
  };
}

/**
 * The stop behind an access gate (http.ts `readOnlyRefusal`): the gate answers first — a viewer is
 * refused for the role, never told the canvas is in the trash — and a write it lets through meets
 * the stop with its own capability (`capOf`, access/request.ts `writeCapability`).
 */
export function withTrashStop(
  gate: (req: Request) => Promise<Response | null>,
  stop: Pick<TrashWriteStop, 'refusal'>,
  capOf: (req: Request) => string
): (req: Request) => Promise<Response | null> {
  return async (req) => (await gate(req)) ?? stop.refusal(req, capOf(req));
}

export function createTrashRoutes(deps: TrashRouteDeps): RouteSpec[] {
  const changed = () => bumpTrashSeq(deps.emit);

  /** The items this session sees, or null when the home has no shared Trash. */
  async function itemsFor(access: Access): Promise<TrashItem[] | null | undefined> {
    const runtime = deps.control() as TrashRuntime | null | undefined;
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
        const seq = currentTrashSeq();
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
            // S11.5: Restore N undoes as one step — the caller collects every restore's action id
            ...(r.actionId ? { actionId: r.actionId } : {}),
          });
        }
        const entry = (CANVAS_ID.exec(id) as RegExpExecArray)[1] as string;
        const runtime = deps.control() as TrashRuntime | null | undefined;
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
        const runtime = deps.control() as TrashRuntime | null | undefined;
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
