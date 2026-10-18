// Undo over the one op log — V2-1.5 §5.3 (S5.5).
//
//   GET  /_api/project/undo-stack?canvas=<repoRel>[&since=<ms>]  → { ok, entries, redo }
//   POST /_api/project/undo  { actionId } | { actionIds } | { chatId }  (+ redo?, via?)
//                            → { ok, actionId, undoes, skipped? } · 409 undo-conflict
//   POST /_api/project/undo  { pendingTx, canvas }  (S2.20c — your edit waiting behind an AI run)
//                            → { ok, pending: true, pendingTx: <the inverse> } · 409 not-pending
//
// The stack folds your edits waiting behind a run in at their gesture time (`actionId: null`).
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
//
// Undo hooks (S10.2, S10 Q1): a feature whose gesture also moved state OFF the
// kernel lanes (a design-system publish moves `revisions/head.json` on Plane B)
// registers `registerUndoHook(kind, fn)`. After an ACCEPTED, delivered undo or
// redo the hooks run in registration order with the ids it undid (a redo names
// the undo it re-applies) and may add `skipped` rows. A refused undo
// (`forbidden`, `undo-conflict`, …) or a queued one runs none: the off-lane half
// never moves without its kernel half. A hook that throws is logged, never fails
// the answer — the kernel half already happened.

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

type UndoSkip = { doc?: string; lane?: string; reason: string; conflictWith?: string };

export interface UndoHookEvent {
  redo: boolean;
  /** the new undo / redo action */
  actionId: string;
  /** what it undid; a redo names the undo it re-applies */
  undoes: string[];
  skipped: UndoSkip[];
}

export type UndoHook = (
  e: UndoHookEvent
) => void | { skipped?: UndoSkip[] } | Promise<void | { skipped?: UndoSkip[] }>;

const undoHooks = new Map<string, UndoHook>();

/** Register (or replace) the hook named `kind`. Returns the unregister. */
export function registerUndoHook(kind: string, fn: UndoHook): () => void {
  undoHooks.set(kind, fn);
  return () => {
    if (undoHooks.get(kind) === fn) undoHooks.delete(kind);
  };
}

/** Run every hook for an accepted undo / redo; returns the rows they add to `skipped`. */
export async function runUndoHooks(
  e: UndoHookEvent,
  log: Pick<Console, 'error'> = console
): Promise<UndoSkip[]> {
  const extra: UndoSkip[] = [];
  for (const [kind, fn] of [...undoHooks]) {
    try {
      const r = await fn(e);
      if (r && Array.isArray(r.skipped)) extra.push(...r.skipped);
    } catch (err) {
      log.error(`[project-undo] the ${kind} undo hook failed:`, err);
    }
  }
  return extra;
}

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
  /** S2.20c — your edits of this canvas waiting behind an AI run (hub link only). */
  pendingEdits?(
    repoRel: string
  ): Array<{ transactionId: string; label: string; madeAt: number; undoes?: string }> | null;
  /**
   * S5.15 (U22) — can this home undo several actions as ONE (`actionIds`)? The local home always
   * can; a hub link asks its bootstrap (`capabilities.undoTargets`); null = not known yet.
   */
  chatUndoReady?(): boolean | null;
  /** S2.20c — ⌘Z on one of them: its inverse waits behind the same run. */
  undoPendingEdit?(
    repoRel: string,
    transactionId: string
  ): Promise<{ status: 'accepted' | 'rejected'; code?: string; transactionId?: string } | null>;
}

const TX_ID = /^[A-Za-z0-9_-]{1,128}$/;

type PendingEvent =
  | { type: 'pending'; entry: { pendingTx: string; label: string; madeAt: number } }
  | { type: 'pending-undo'; pendingTx: string; of: string; madeAt: number };

/**
 * S2.20c — the history events (oldest first) with the waiting edits folded in at their gesture
 * time: a waiting edit happened before an action that landed after it, and its place decides
 * whether that action clears it from redo (the reducer orders entries by `madeAt` too).
 */
export function withPendingEvents(
  actions: Array<{ type: 'action'; action: AcceptedHistoryRow }>,
  waiting: Array<{ transactionId: string; label: string; madeAt: number; undoes?: string }>
): Array<{ type: 'action'; action: AcceptedHistoryRow } | PendingEvent> {
  const pending: PendingEvent[] = waiting
    .filter((w) => w && typeof w.transactionId === 'string' && Number.isFinite(w.madeAt))
    .map((w) =>
      w.undoes
        ? { type: 'pending-undo', pendingTx: w.transactionId, of: w.undoes, madeAt: w.madeAt }
        : {
            type: 'pending',
            entry: { pendingTx: w.transactionId, label: w.label, madeAt: w.madeAt },
          }
    );
  const at = (e: PendingEvent) => (e.type === 'pending' ? e.entry.madeAt : e.madeAt);
  const out: Array<{ type: 'action'; action: AcceptedHistoryRow } | PendingEvent> = [];
  let i = 0;
  for (const ev of actions) {
    const t = ev.action.madeAt ?? ev.action.committedAt;
    while (i < pending.length && at(pending[i]) < t) out.push(pending[i++]);
    out.push(ev);
  }
  while (i < pending.length) out.push(pending[i++]);
  return out;
}

export interface ProjectUndoDeps {
  /** `ctx.syncControl.current()` — null while no home answers. */
  control: () => ProjectUndoRuntime | null | undefined;
  /** `.design` — `canvas=<repoRel>` → the design-root-relative path history rows carry. */
  designRel: string;
  /** ctx.bus.emit — `project:action` (V2-1.5 §5.3). */
  emit?: (event: string, payload: unknown) => void;
  /**
   * Asked before the runtime: a Response refuses the undo. S4.7 registers the
   * conversion guard here — a sticky turned into a thread someone else has
   * replied to since is refused `has-replies`, so the kernel never restores the
   * sticky while keeping the thread (contract S4-S9-votes-comments §3.2).
   */
  guard?: (target: UndoTarget, req: Request) => Promise<Response | null>;
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

/** What a run's stage end answers (the hub runtime and the local home alike). */
type StageEnd = {
  status: 'accepted' | 'rejected' | 'discarded';
  code?: string;
  actionId?: string;
  touched?: Record<string, string[]>;
} | null;

interface StageRuntime extends ProjectUndoRuntime {
  endAiAction?(
    key: string,
    outcome: 'done' | 'failed' | 'stopped',
    o?: { fence?: RunFenceLike }
  ): Promise<StageEnd>;
}

type RunFenceLike = {
  runId: string;
  leases: Array<{ entry: string; artboard: string; token: number }>;
};

/**
 * S5.5b — the run registry's `stage` hooks (ai/runs.ts `RegistryOptions.stage`): THE one place a
 * registry run's stage ends. The registry decides the outcome — a turn that ended publishes, Stop
 * / Quit publishes partial (`stopped`), an error or a lost lease holds — and the stage is named by
 * the run's id, which every caller began it with (`beginAiAction(key, label, { runId })`). A
 * published run is announced on the bus as `project:action` with the artboards it touched.
 */
export function runStageHooks(deps: {
  control: () => StageRuntime | null | undefined;
  emit?: (event: string, payload: unknown) => void;
}) {
  return {
    async publish(
      rec: { runId: string },
      o: { partial: boolean; fence: RunFenceLike }
    ): Promise<{ status: 'accepted' | 'rejected'; code?: string } | undefined> {
      const r = await deps
        .control()
        ?.endAiAction?.(rec.runId, o.partial ? 'stopped' : 'done', { fence: o.fence });
      if (!r || r.status === 'discarded') return undefined;
      if (r.status === 'accepted' && r.actionId)
        await announceAction(deps, r.actionId, r.touched ?? {}).catch(() => {});
      return { status: r.status, ...(r.code ? { code: r.code } : {}) };
    },
    async hold(rec: { runId: string }): Promise<void> {
      await deps.control()?.endAiAction?.(rec.runId, 'failed');
    },
  };
}

/** S5.15 (U22) — what the shell shows for "Undo this chat" before anyone clicks. */
export function chatUndoState(
  runtime: Pick<ProjectUndoRuntime, 'chatUndoReady'> | null | undefined
): { ok: true } | { ok: false; line: string } | null {
  const ready = runtime?.chatUndoReady?.();
  if (ready === true) return { ok: true };
  if (ready === false) return { ok: false, line: NEEDS_HUB_UPDATE };
  return null;
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
        // S2.20c — your edits waiting behind an AI run are entries too (`actionId: null`).
        const waiting = runtime.pendingEdits?.(repoRel) ?? [];
        // The SAME reducer the shell runs (client/v2/undo/projection.js), over history oldest first.
        const state = fold(
          initialState({ canvas, openedAt: Number.isFinite(since) && since > 0 ? since : 0 }),
          withPendingEvents(
            [...(rows as AcceptedHistoryRow[])]
              .sort((a, b) => a.revision - b.revision)
              .map((action) => ({ type: 'action' as const, action })),
            waiting
          )
        );
        const chatUndo = chatUndoState(runtime);
        return json(200, { ok: true, ...view(state), ...(chatUndo ? { chatUndo } : {}) });
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
        const pendingTx = (body as { pendingTx?: unknown } | null)?.pendingTx;
        if (pendingTx !== undefined) {
          // S2.20c — ⌘Z on your edit waiting behind an AI run: its inverse waits behind the same
          // run (`{ pendingTx, canvas }`); the run's staged writes are never touched.
          const canvas = (body as { canvas?: unknown }).canvas;
          if (typeof pendingTx !== 'string' || !TX_ID.test(pendingTx))
            return new Response('bad pendingTx', { status: 400 });
          if (
            typeof canvas !== 'string' ||
            !canvas ||
            canvas.length > 1024 ||
            canvas.includes('\0')
          )
            return new Response('pendingTx takes canvas=<repoRel>', { status: 400 });
          const runtime = deps.control();
          const r = runtime?.undoPendingEdit
            ? await runtime.undoPendingEdit(canvas, pendingTx)
            : null;
          if (!r) return json(200, { ok: false, reason: 'legacy' });
          if (r.status !== 'accepted')
            return json(409, { ok: false, reason: r.code ?? 'refused', code: r.code });
          return json(200, { ok: true, pending: true, pendingTx: r.transactionId ?? null });
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
        const refused = await deps.guard?.(parsed.target, req);
        if (refused) return refused;
        const runtime = deps.control();
        const multi0 = !('actionId' in parsed.target);
        if (multi0 && runtime?.chatUndoReady?.() === false) {
          // U22 — the probe already says this team server cannot: refused before the kernel.
          return json(409, { ok: false, reason: 'needs-hub-update', line: NEEDS_HUB_UPDATE });
        }
        const r = runtime?.acceptedUndo
          ? await runtime.acceptedUndo(parsed.target, parsed.redo, { via })
          : null;
        if (!r) return json(200, { ok: false, reason: 'legacy' });
        const multi = !('actionId' in parsed.target);
        if (r.status !== 'accepted' && multi && r.code === 'invalid') {
          // A hub older than S5.1a: no `actionIds`. Disabled, with the line.
          return json(409, { ok: false, reason: 'needs-hub-update', line: NEEDS_HUB_UPDATE });
        }
        let skipped = r.skipped;
        if (r.status === 'accepted' && r.actionId && !r.queued) {
          // a single-target answer keeps its v1 shape (no `undoes`): the target is what it undid
          const t = parsed.target;
          const undoes =
            r.undoes !== undefined
              ? Array.isArray(r.undoes)
                ? r.undoes
                : [r.undoes]
              : 'actionId' in t
                ? [t.actionId]
                : 'actionIds' in t
                  ? t.actionIds
                  : [];
          const extra = await runUndoHooks({
            redo: parsed.redo,
            actionId: r.actionId,
            undoes,
            skipped: r.skipped ?? [],
          });
          if (extra.length) skipped = [...(r.skipped ?? []), ...extra];
          void announceAction(deps, r.actionId).catch(() => {});
        }
        return json(r.status === 'accepted' ? 200 : 409, {
          ok: r.status === 'accepted',
          ...r,
          ...(skipped ? { skipped } : {}),
        });
      },
    },
  ];
}
