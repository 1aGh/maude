// "Restore only <artboard>" as ONE `restore` action — the I/O half of S1.13's splice, shared by
// Version history (routes/history.ts, `POST /_api/project/restore { artboard }`) and the Trash
// (routes/trash.ts `restoreArtboard`, S1.13b: an artboard item comes back from the revision
// before its trash action — S1 Q3 "one splice path for both").
//
// Both read the canvas's lanes through the accepted runtime at two revisions (the old one and
// the canvas's newest), splice with `restoreArtboard` (history/restore-artboard.ts, pure), and
// propose the changed lanes with `baseContent` = the head they read, so the kernel merges
// three-way onto whatever landed meanwhile. No Response here: each caller answers in its own
// shape (Version history keeps its line / sharedKept, the Trash its `TrashOutcome`).

import type { Access } from '../access/scope.ts';
import type { RestoreOptions } from '../sync/local-kernel.ts';
import { restoreArtboard, type SpliceLane, type SpliceSide } from './restore-artboard.ts';
import type { ArtboardItem, TrashOutcome } from './trash.ts';
import { listVersions, type VersionsRuntime } from './versions.ts';

type Outcome = {
  status: 'accepted' | 'rejected';
  code?: string;
  queued?: boolean;
  actionId?: string;
};

/** What a splice restore reads and writes through (`ctx.syncControl.current()`). */
export interface SpliceRuntime extends VersionsRuntime {
  acceptedRestore?(repoRel: string, revision: number, o?: RestoreOptions): Promise<Outcome | null>;
  acceptedVersion?(
    repoRel: string,
    revision: number,
    lane?: SpliceLane,
    o?: { aside?: boolean }
  ): Promise<string | null>;
}

/** The lanes proposed, as ONE action: refused (with the HTTP status a route answers), or landed. */
export type LanesOutcome =
  | { ok: false; status: number; reason: string }
  | { ok: true; unchanged: true }
  | { ok: true; unchanged?: false; queued: boolean; actionId: string | null };

export type ArtboardRestore =
  | { ok: false; status: number; reason: string; line?: string }
  | ({ ok: true; label: string; line: string; sharedKept: string[]; why: string | null } & (
      | { unchanged: true }
      | { unchanged?: false; queued: boolean; actionId: string | null }
    ));

export const refusalStatus = (code: string | undefined): number => {
  if (code === 'forbidden' || code === 'not-in-scope' || code === 'read-only') return 403;
  if (code === 'retryable' || code === 'unreachable' || code === 'store-locked') return 503;
  return 409;
};

/** A canvas's lanes at a revision; null when it had no source then. */
export async function readSide(
  rt: SpliceRuntime,
  repoRel: string,
  rev: number
): Promise<SpliceSide | null> {
  const read = (lane: SpliceLane) =>
    rt.acceptedVersion ? rt.acceptedVersion(repoRel, rev, lane).catch(() => null) : null;
  const [html, css, meta, annotations] = await Promise.all(
    (['html', 'css', 'meta', 'annotations'] as const).map(read)
  );
  return html ? { html, css, meta, annotations } : null;
}

/** The canvas's newest accepted revision (Now); null when the home has none for it. */
export async function newestRevision(
  rt: SpliceRuntime,
  repoRel: string,
  canvas: string
): Promise<number | null> {
  const answer = await listVersions({ runtime: rt, repoRel, canvas, limit: 1 });
  return answer.ok && answer.source === 'accepted' ? answer.newest : null;
}

/** ONE `restore` action from the studio's lanes, each based on the head it read. */
export async function proposeRestoreLanes(
  rt: SpliceRuntime,
  repoRel: string,
  rev: number,
  head: SpliceSide,
  lanes: Partial<Record<SpliceLane, string>>,
  label: string
): Promise<LanesOutcome> {
  const list = (Object.entries(lanes) as [SpliceLane, string][]).map(([lane, content]) => ({
    lane,
    content,
    baseContent: head[lane] ?? '',
  }));
  if (!list.length) return { ok: true, unchanged: true };
  const r = await rt.acceptedRestore?.(repoRel, rev, { lanes: list, label }).catch(() => undefined);
  if (r === undefined) return { ok: false, status: 503, reason: 'unreachable' };
  if (r === null) return { ok: false, status: 409, reason: 'legacy' };
  if (r.status !== 'accepted') {
    // A head that moved under the splice and does not merge: read again, then decide.
    if (r.code === 'base-conflict') return { ok: false, status: 409, reason: 'stale' };
    return { ok: false, status: refusalStatus(r.code), reason: r.code ?? 'rejected' };
  }
  return { ok: true, queued: !!r.queued, actionId: r.actionId ?? null };
}

/**
 * Put ONE artboard of `canvas` back the way it was at `oldRev`, over the canvas as it is at
 * `headRev`, every other artboard byte-identical. `label(artboardLabel)` words the action.
 */
export async function restoreArtboardAt(
  rt: SpliceRuntime,
  o: {
    repoRel: string;
    canvas: string;
    oldRev: number;
    headRev: number | null;
    artboard: string;
    label: (artboardLabel: string) => string;
  }
): Promise<ArtboardRestore> {
  if (!rt.acceptedRestore || !rt.acceptedVersion)
    return { ok: false, status: 409, reason: 'legacy' };
  const [old, head] = await Promise.all([
    readSide(rt, o.repoRel, o.oldRev),
    o.headRev === null ? null : readSide(rt, o.repoRel, o.headRev),
  ]);
  if (!old || !head) return { ok: false, status: 409, reason: 'not-in-version' };
  const s = restoreArtboard(o.canvas, head, old, o.artboard);
  if (!s.ok) return { ok: false, status: 409, reason: s.reason, line: s.line };
  const line = o.label(s.label);
  const r = await proposeRestoreLanes(rt, o.repoRel, o.oldRev, head, s.lanes, line);
  if (!r.ok) return r;
  return { ...r, label: s.label, line, sharedKept: s.sharedKept, why: s.why };
}

/** "Restored “Hero” from the trash" — the canvas restore's words (sync/index.ts), for one artboard. */
export const trashRestoreLine = (label: string): string => `Restored “${label}” from the trash`;

/**
 * S1.13b — the Trash's `restoreArtboard` seam (routes/trash.ts): the artboard comes back from
 * the revision BEFORE its trash action, spliced over Now (S1 Q3). The session is judged first,
 * like every write: a canvas-only session that was not granted the canvas gets `not-in-scope`,
 * the answer a missing item gets (U1); anyone else needs `trash` and `edit` on it.
 */
export function trashArtboardRestorer(deps: {
  /** `ctx.syncControl.current()` — null while no home answers. */
  control: () => SpliceRuntime | object | null | undefined;
  /** `.design` — the design root relative to the repo root. */
  designRel: string;
  /** After an accepted, unqueued restore: say so (routes/project-undo.ts `announceAction`). */
  announce?: (actionId: string) => void;
}): (item: ArtboardItem, access: Access) => Promise<TrashOutcome | null> {
  const designRel = deps.designRel.replace(/^\/+|\/+$/g, '');
  return async (item, access) => {
    const canvas = item.path;
    if (access.canvasOnly && !access.seesCanvas(canvas))
      return { status: 'rejected', code: 'not-in-scope' };
    if (!access.can('trash', canvas) || !access.can('edit', canvas))
      return { status: 'rejected', code: 'forbidden' };
    const rt = deps.control() as SpliceRuntime | null | undefined;
    if (!rt) return { status: 'rejected', code: 'unreachable' };
    if (!Number.isSafeInteger(item.rev) || item.rev < 1)
      return { status: 'rejected', code: 'not-in-version' };
    const repoRel = designRel ? `${designRel}/${canvas}` : canvas;
    const headRev = await newestRevision(rt, repoRel, canvas).catch(() => undefined);
    if (headRev === undefined) return { status: 'rejected', code: 'unreachable' };
    const r = await restoreArtboardAt(rt, {
      repoRel,
      canvas,
      oldRev: item.rev - 1,
      headRev,
      artboard: item.artboard,
      label: (l) => trashRestoreLine(item.label ?? l),
    });
    if (!r.ok) return { status: 'rejected', code: r.reason };
    if (r.unchanged) return { status: 'accepted' };
    if (r.actionId && !r.queued) deps.announce?.(r.actionId);
    return {
      status: 'accepted',
      ...(r.queued ? { queued: true } : {}),
      ...(r.actionId ? { actionId: r.actionId } : {}),
    };
  };
}
