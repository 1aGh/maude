/**
 * @file       commands/move-artboards-command.ts — undo entry for artboard moves
 * @scope      apps/studio/commands/move-artboards-command.ts
 * @purpose    Reversible record of an artboard-layout PATCH. Pairs the full
 *             `before` and `after` layout snapshots with an injected
 *             `patchFn` (in production, `applyArtboardLayout`; in tests, a
 *             spy). The command is rebuilt per iframe mount from a
 *             `CommandRecord` so the stack survives canvas switches
 *             (DDR-050 rev 2).
 *
 * Why full snapshots, not a sparse diff. The server-side endpoint
 * (`PATCH /_api/canvas-meta`, see api.ts:523–528) shallow-merges patch.layout
 * over the existing meta. A sparse `{ artboards: [movedOnly] }` would drop
 * every unchanged rect on its head. Storing the full array is simpler and
 * resilient — the external-edit invalidation (DDR-050 rule 6) clears the
 * stack whenever the file changes outside our PATCH so we never restore a
 * stale layout.
 */

import type { Op as AnnotationOp } from '../annotations/ops.ts';
import { type CommitRiderPayload, mintUndoGroup } from '../drag-bus.ts';
import type { CommandRecord, EditCommand } from '../undo-stack.ts';
import { registerCommand } from '../undo-stack.ts';

export interface ArtboardLayoutEntry {
  id: string;
  x: number;
  y: number;
  /** Width — JSX-authoritative; carried through for shape-completeness. */
  w?: number;
  h?: number;
}

/**
 * Signature compatible with canvas-lib's `applyArtboardLayout(layout)`.
 * Tests pass a spy; production wiring passes the real React-state-+-PATCH
 * applier.
 */
export type LayoutPatchFn = (
  layout: ArtboardLayoutEntry[],
  /** S2.9b — the annotations riding with this layout write (one PATCH, one action). */
  rider?: LayoutRider
) => void | Promise<void>;

/** S2.9b — the `annotations` rider of one layout write (`PATCH /_api/canvas-meta`). */
export interface LayoutRider {
  ops: AnnotationOp[];
  actionId: string;
  label: string;
}

export interface MoveArtboardsPayload {
  before: readonly ArtboardLayoutEntry[];
  after: readonly ArtboardLayoutEntry[];
  /** S2.9b — the annotation ops that rode with the move + their inverse (contract §2). */
  rider?: CommitRiderPayload;
}

/** Convenience constant — keeps spelling consistent across files. */
export const MOVE_ARTBOARDS_KIND = 'move-artboards';

export interface MoveArtboardsCommandInit {
  before: readonly ArtboardLayoutEntry[];
  after: readonly ArtboardLayoutEntry[];
  patchFn: LayoutPatchFn;
  /** Optional label override (equal-spacing wraps with its own copy). */
  label?: string;
  /** Telemetry kind. Defaults to `MOVE_ARTBOARDS_KIND`. */
  kind?: string;
  /** S2.9b — riders: `do` sends `ops`, `undo` sends `inverse`. */
  rider?: CommitRiderPayload;
}

export function createMoveArtboardsCommand(init: MoveArtboardsCommandInit): EditCommand {
  const { before, after, patchFn } = init;
  // Snapshot once — mutating the source arrays later cannot poison the command.
  const beforeSnapshot = before.map(cloneEntry);
  const afterSnapshot = after.map(cloneEntry);
  const movedCount = countMoved(beforeSnapshot, afterSnapshot);
  const label = init.label ?? `move ${movedCount} artboard${movedCount === 1 ? '' : 's'}`;
  const kind = init.kind ?? MOVE_ARTBOARDS_KIND;
  const rider = init.rider;
  // The first `do` IS the commit and carries the bus's undoGroup; every replay (undo, redo) is a
  // new write with a fresh id — a reused id would read as the same proposal to the home.
  let first = true;
  const riderFor = (ops: AnnotationOp[] | undefined): LayoutRider | undefined => {
    if (!rider || !ops?.length) return undefined;
    const actionId = first ? rider.undoGroup : mintUndoGroup();
    first = false;
    return { ops, actionId, label };
  };

  return {
    kind,
    label,
    async do() {
      const r = riderFor(rider?.ops);
      await (r
        ? patchFn(afterSnapshot.map(cloneEntry), r)
        : patchFn(afterSnapshot.map(cloneEntry)));
    },
    async undo() {
      first = false;
      const r = riderFor(rider?.inverse);
      await (r
        ? patchFn(beforeSnapshot.map(cloneEntry), r)
        : patchFn(beforeSnapshot.map(cloneEntry)));
    },
  };
}

/**
 * Build a persistable record from the same inputs. Use this together with
 * the EditCommand so the runtime side-effect AND the persisted shape share
 * one snapshot.
 */
export function buildMoveArtboardsRecord(opts: {
  before: readonly ArtboardLayoutEntry[];
  after: readonly ArtboardLayoutEntry[];
  label?: string;
  rider?: CommitRiderPayload;
}): CommandRecord<MoveArtboardsPayload> {
  const before = opts.before.map(cloneEntry);
  const after = opts.after.map(cloneEntry);
  const moved = countMoved(before, after);
  const label = opts.label ?? `move ${moved} artboard${moved === 1 ? '' : 's'}`;
  const rider = opts.rider?.ops.length ? structuredClone(opts.rider) : undefined;
  return {
    kind: MOVE_ARTBOARDS_KIND,
    label,
    payload: { before, after, ...(rider ? { rider } : {}) },
  };
}

/**
 * Diff helper — returns `null` when `before` and `after` describe the same
 * layout (call sites use this to skip pushing a no-op drag onto the stack).
 * Compares positions only; size diffs are ignored (size is JSX-authoritative
 * per DDR-027, position is the only mutable channel).
 */
export function diffLayoutPositions(
  before: readonly ArtboardLayoutEntry[],
  after: readonly ArtboardLayoutEntry[]
): { changed: number } | null {
  if (before.length !== after.length) return { changed: Math.max(before.length, after.length) };
  const byId = new Map<string, ArtboardLayoutEntry>();
  for (const r of before) byId.set(r.id, r);
  let changed = 0;
  for (const r of after) {
    const prev = byId.get(r.id);
    if (!prev || prev.x !== r.x || prev.y !== r.y) changed++;
  }
  if (changed === 0) return null;
  return { changed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry — rebuild EditCommand from a persisted CommandRecord + current
// iframe's sinks. Runs once on module load (top-level side-effect intentional).

registerCommand<MoveArtboardsPayload>(MOVE_ARTBOARDS_KIND, (record, sinks) => {
  const patchFn = sinks.layoutPatchFn as LayoutPatchFn | undefined;
  if (!patchFn) return null;
  return createMoveArtboardsCommand({
    before: record.payload.before,
    after: record.payload.after,
    patchFn,
    label: record.label,
    ...(record.payload.rider ? { rider: record.payload.rider } : {}),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Internals

function cloneEntry(r: ArtboardLayoutEntry): ArtboardLayoutEntry {
  const out: ArtboardLayoutEntry = { id: r.id, x: r.x, y: r.y };
  if (typeof r.w === 'number') out.w = r.w;
  if (typeof r.h === 'number') out.h = r.h;
  return out;
}

function countMoved(
  before: readonly ArtboardLayoutEntry[],
  after: readonly ArtboardLayoutEntry[]
): number {
  const byId = new Map<string, ArtboardLayoutEntry>();
  for (const r of before) byId.set(r.id, r);
  let n = 0;
  for (const r of after) {
    const prev = byId.get(r.id);
    if (!prev) {
      n++;
      continue;
    }
    if (prev.x !== r.x || prev.y !== r.y) n++;
  }
  return n;
}
