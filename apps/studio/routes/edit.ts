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
//
// S2.10b — on an op-log home (`ctx.syncControl.current().proposeLanes`: the local home, or a hub link in
// accepted mode) the source AND the op's layout lane are ONE proposal, so a copy with its place, or an
// artboard moved to the trash with its entry, is one action / one ⌘Z / one Version history row — the
// pattern of routes/annotations.ts `proposerFor` and api.ts `moveArtboardsWithRider`:
//   - accepted mode: the project decides first; a refusal writes nothing; then the files are written raw
//     (no per-lane hooks, which would propose each lane on its own);
//   - the local home: the ordinary writes, then the proposal records both lanes as one action.
// An op that writes no layout keeps the ordinary source path (watcher / source-written import). Elsewhere
// (a legacy link, no link) nothing changes: one write, one legacy revert record.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type { RunRegistry } from '../ai/runs.ts';
import type { LaneChange, LanesOutcome } from '../api.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import {
  dispatchEditOp,
  type LandOutcome,
  type LandPlan,
  STALE_MESSAGE,
  statusOf,
} from '../edit-ops/dispatch.ts';
import {
  hasLayoutChange,
  layoutEntriesOf,
  mergeLayout,
  nextMetaText,
} from '../edit-ops/layout-patch.ts';
import { createWriteLog, type WriteLog } from '../edit-ops/revert.ts';
import { type EditOp, type LayoutPatch, MAX_BODY } from '../edit-ops/types.ts';
import { heldByAi } from './agent.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** How long a hub proposal is awaited before the answer says `queued` (as S4.7 / S2.9b). */
const ANSWER_WAIT_MS = 8_000;

/** The op-log home's half the route uses (`SyncRuntime.proposeLanes`, the local home's). */
export interface EditLanesRuntime {
  proposeLanes?(
    slug: string,
    lanes: LaneChange[],
    o: {
      kind: string;
      label: string;
      origin?: { trashed?: Array<{ artboard: string; label?: string }> };
    }
  ): Promise<{ status: 'accepted' | 'rejected'; code?: string; actionId?: string }> | null;
  acceptedMode?(): boolean;
}

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
  /**
   * S2.10 — the layout lane's own reader / writer (`api.loadCanvasMeta` / `api.patchCanvasMeta`, which
   * fire the `onMetaChanged` hook and the cell announce like a drag does). `file` is repo-relative
   * (`.design/ui/Foo.tsx`). Absent: an op's positions are not written and the source still is.
   */
  meta?: {
    load(file: string): Promise<Record<string, unknown> | null>;
    patch(file: string, patch: Record<string, unknown>): Promise<unknown>;
    /**
     * S2.10b — write the versioned `.meta.json` text (`api.writeCanvasMetaText`). `hooks: false` skips
     * the `onMetaChanged` hook (an accepted-mode action already carries the lane); the announce runs.
     */
    writeText?(
      file: string,
      nextText: string,
      baseText: string | null,
      o: { hooks: boolean }
    ): Promise<unknown>;
  };
  /** S2.10b — `ctx.syncControl.current()`: the hub runtime, the local home, or null. */
  control?: () => EditLanesRuntime | null | undefined;
  /** tests only: the clock `last_modified` is stamped with */
  now?: () => Date;
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

/** A home's refusal, in the dispatcher's words. */
function refusalOf(code: string | undefined): LandOutcome {
  if (code === 'forbidden' || code === 'not-in-scope')
    return { ok: false, code: 'forbidden', message: 'You can look here; ask to edit.' };
  if (code === 'base-conflict' || code === 'stale')
    return { ok: false, code: 'stale', message: STALE_MESSAGE };
  if (code === 'lease-fenced')
    return { ok: false, code: 'held-by-ai', message: "This artboard is AI's until it's done" };
  return { ok: false, code: 'invalid', message: 'That edit did not go through; try again.' };
}

export function createEditRoutes(deps: EditRouteDeps): RouteSpec[] {
  const log = deps.log ?? createWriteLog();
  const chains = new Map<string, Promise<unknown>>();
  const abs = (rel: string) => path.join(deps.designRoot, ...rel.split('/'));
  /** An op's positions → `meta.layout.artboards[]`, merged with what is there (other layout keys stay). */
  const writeLayout = async (rel: string, patch: LayoutPatch): Promise<void> => {
    const meta = deps.meta;
    if (!meta) return;
    const file = path.posix.join(deps.designRel.replace(/\\/g, '/'), rel);
    const layout = ((await meta.load(file)) ?? {}).layout;
    const rec = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
    await meta.patch(file, {
      layout: { ...rec, artboards: mergeLayout(layoutEntriesOf(layout), patch) },
    });
  };
  const readText = (rel: string): string | null => {
    try {
      return readFileSync(abs(rel), 'utf8');
    } catch {
      return null;
    }
  };
  /** The source write every path shares: announce the base, the bytes, the /design:rollback snapshot. */
  const writeSource = async (rel: string, before: string, after: string, label: string) => {
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
  };
  /** S2.10b — one action on an op-log home (header); null = no such home, the legacy path runs. */
  const land = async (p: LandPlan): Promise<LandOutcome | null> => {
    const rt = deps.control?.();
    if (!rt?.proposeLanes) return null;
    // A hub runtime answers `acceptedMode`; one that is not in it is a legacy link (the local home
    // has no such mode: it is always an op log).
    const accepted = rt.acceptedMode?.();
    if (accepted === false) return null;
    const metaRel = p.rel.replace(/\.tsx$/i, '.meta.json');
    const metaBefore = hasLayoutChange(p.layout) ? readText(metaRel) : null;
    const metaAfter = hasLayoutChange(p.layout)
      ? nextMetaText(metaBefore, p.layout, (deps.now ?? (() => new Date()))())
      : null;
    const lanes: LaneChange[] = [
      { lane: 'html', text: p.after, baseText: p.before },
      ...(metaAfter !== null
        ? [{ lane: 'meta' as const, text: metaAfter, baseText: metaBefore ?? '{}' }]
        : []),
    ];
    const action = p.action ?? { kind: 'edit' as const, label: 'Edit canvas' };
    const o = {
      kind: action.kind,
      label: action.label,
      ...(action.trashed?.length ? { origin: { trashed: action.trashed } } : {}),
    };
    const slug = canvasSlugFromRel(p.rel, deps.designRel);
    const file = path.posix.join(deps.designRel.replace(/\\/g, '/'), p.rel);
    const writeMeta = async (hooks: boolean) => {
      if (metaAfter === null) return;
      if (deps.meta?.writeText) await deps.meta.writeText(file, metaAfter, metaBefore, { hooks });
      else await Bun.write(abs(metaRel), metaAfter);
    };
    if (accepted === true) {
      // The project decides first: a refused action leaves both files as they are.
      const pending = rt.proposeLanes(slug, lanes, o);
      if (!pending) return null; // the runtime does not carry this canvas: the ordinary path
      const answer = await Promise.race<LanesOutcome>([
        pending,
        new Promise<LanesOutcome>((resolve) =>
          setTimeout(() => resolve({ status: 'accepted', queued: true }), ANSWER_WAIT_MS)
        ),
      ]);
      if (answer.status !== 'accepted') return refusalOf(answer.code);
      await writeMeta(false);
      await writeSource(p.rel, p.before, p.after, p.reason);
      // The write is complete: the projection reads these bytes now (they ARE the accepted
      // source, so nothing is proposed again) instead of holding its doc→file writer for a
      // watcher event — without it, the next accepted change (this action's ⌘Z) never reached
      // this Mac's disk.
      deps.emit('source-written', { rel: p.rel, content: p.after });
      return answer.queued
        ? { ok: true, actionId: null, queued: true }
        : { ok: true, actionId: answer.actionId ?? null };
    }
    // The local home records what the disk became; the watcher's echo then finds it recorded.
    await writeMeta(true);
    await writeSource(p.rel, p.before, p.after, p.reason);
    const answer = await rt.proposeLanes(slug, lanes, o);
    // Written either way: an unrecorded write is an ordinary write with its legacy revert record.
    return { ok: true, actionId: answer?.status === 'accepted' ? (answer.actionId ?? null) : null };
  };
  /** S2.10b — an AI run's lease on the artboard (V2-1.15 §5.2), as `heldByAi` reads element holds. */
  const heldArtboard = (rel: string, artboard: string) => {
    const runs = deps.runs;
    if (!runs) return null;
    const holder = runs.holderOf({ canvas: runs.canvasKey(rel), artboard });
    if (!holder) return null;
    return { mine: runs.live().some((r) => r.runId === holder.runId) };
  };
  const serialized = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(run);
    chains.set(key, next);
    void next.finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
    return next;
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
        const file = (body as { file?: unknown } | null)?.file;
        const key =
          typeof file === 'string'
            ? (resolveCanvasRel(deps.designRoot, deps.designRel, file) ?? '')
            : '';
        const result = await serialized(key, () =>
          dispatchEditOp(body, {
            resolve: (f) => resolveCanvasRel(deps.designRoot, deps.designRel, f),
            read: (rel) => {
              try {
                return readFileSync(abs(rel), 'utf8');
              } catch {
                return null;
              }
            },
            write: writeSource,
            writeLayout,
            land,
            heldByAi: (rel, element) => (deps.runs ? heldByAi(deps.runs, rel, element) : null),
            heldArtboard,
            actionFor: (rel, after) =>
              deps.actionFor?.(
                path.relative(deps.repoRoot, abs(rel)).split(path.sep).join('/'),
                after
              ) ?? null,
            log,
            ...(deps.ops ? { ops: deps.ops } : {}),
          })
        );
        return json(statusOf(result), result);
      },
    },
  ];
}
