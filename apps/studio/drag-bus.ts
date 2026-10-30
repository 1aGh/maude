/**
 * @file       drag-bus.ts — the stable half of canvas-lib's `DragStateBus` (S2.9b)
 * @scope      apps/studio/drag-bus.ts
 * @purpose    Contract `client/v2/contracts/S2-S4-artboard-motion-ids.md` §1–§2:
 *             live drag frames OUTSIDE React (`subscribeFrames`), commit riders
 *             (`onCommit`), the committed layout (`layoutRects`), and THE door every
 *             artboard-position commit goes through (`commitPositions`). DesignCanvas
 *             (canvas-lib.tsx) creates one per mount and wires `layout` + `commit`;
 *             the drag hook feeds `emitFrame`.
 *
 * One commit = one undo group: the bus mints `undoGroup`, asks every rider
 * synchronously for the annotation ops that ride with the move, and hands the
 * layout and those ops to `commit` together — canvas-lib turns that into ONE
 * `PATCH /_api/canvas-meta { file, patch: { layout }, annotations: { ops,
 * actionId: undoGroup } }`, which the server proposes as one action (one ⌘Z).
 * The DDR-050 record keeps the riders' INVERSE ops, so a legacy link's local ⌘Z
 * puts the members back with the artboard.
 *
 * React-free and canvas-safe: imported by the canvas iframe's graph, so it
 * imports types only.
 */

import type { Op as AnnotationOp } from './annotations/ops.ts';
import type { DragFrame } from './use-artboard-drag.tsx';

export type { DragFrame };

/** Final position + delta of one artboard a commit moves (world units). */
export type MovedArtboard = { id: string; x: number; y: number; dx: number; dy: number };

/** A rider: the annotation ops that ride with a move, or null for none. Called synchronously. */
export type CommitRider = (moved: MovedArtboard[], undoGroup: string) => AnnotationOp[] | null;

/** The committed layout: meta positions + JSX sizes, world units. */
export type LayoutRect = { id: string; x: number; y: number; w: number; h: number };

/** Optional metadata accompanying a position commit. */
export interface CommitPositionsOptions {
  /**
   * HUD / undo-stack label override. Default = `"move N artboard(s)"`.
   * Distribute / align gestures pass their own label so undo HUD reads
   * `"Undone — equal-space 4 artboards"` instead of `"Undone — move 4 artboards"`.
   */
  label?: string;
  /** The write id the layout and its riders share; minted by the bus when absent. */
  undoGroup?: string;
  /**
   * `false` = no riders (members keep their world positions). Artboard RESIZE (S2.8 — a
   * left/top handle moves the origin) and the ⌥-drag duplicate gesture pass it (contract §2).
   */
  riders?: boolean;
}

/** What a commit hands canvas-lib's undo push: the rider ops and their inverse. */
export interface CommitRiderPayload {
  ops: AnnotationOp[];
  inverse: AnnotationOp[];
  undoGroup: string;
}

export const UNDO_GROUP_RE = /^[A-Za-z0-9_-]{1,96}$/;

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `ab-move-` + 10 random base-36 characters (contract §2 step 1). */
export function mintUndoGroup(rand: () => number = Math.random): string {
  let s = 'ab-move-';
  for (let i = 0; i < 10; i++)
    s += ID_CHARS[Math.floor(rand() * ID_CHARS.length) % ID_CHARS.length];
  return s;
}

/**
 * The inverse of a rider op — a `patch` whose `expect` covers every field it
 * sets (the rule the server holds riders to): set ⇄ expect, strict. Anything
 * else cannot be undone locally and is null.
 */
export function invertRiderOp(op: AnnotationOp): AnnotationOp | null {
  if (op.op !== 'patch' || !op.set || op.unset?.length) return null;
  const keys = Object.keys(op.set);
  if (!keys.length || !op.expect) return null;
  const set: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(k in op.expect)) return null;
    set[k] = op.expect[k];
  }
  return { op: 'patch', id: op.id, set, expect: { ...op.set }, strict: true };
}

/**
 * The `PATCH /_api/canvas-meta` body of one layout write: a rider rides a layout-only patch
 * (contract §2 step 3 — `{ file, patch: { layout }, annotations?: { ops, actionId, label } }`).
 */
export function canvasMetaBody(
  file: string,
  patch: { layout?: unknown; viewport?: unknown },
  rider?: { ops: AnnotationOp[]; actionId: string; label?: string }
): Record<string, unknown> {
  const rides = !!rider?.ops.length && patch.layout !== undefined && patch.viewport === undefined;
  return {
    file,
    patch,
    ...(rides && rider
      ? {
          annotations: {
            ops: rider.ops,
            actionId: rider.actionId,
            ...(rider.label ? { label: rider.label } : {}),
          },
        }
      : {}),
  };
}

export interface DragBusCoreDeps {
  /** The committed layout right now (DesignCanvas's `artboardsRef`). */
  layout(): readonly LayoutRect[];
  /** Push the undo record for one commit (canvas-lib: `buildMoveArtboardsRecord` + push). */
  commit(
    after: LayoutRect[],
    before: LayoutRect[],
    opts: { label?: string; rider?: CommitRiderPayload }
  ): void;
  warn?: (msg: string, err?: unknown) => void;
}

export interface DragBusCore {
  /** Synchronous, at most once per animation frame, outside React. Returns the unsubscribe. */
  subscribeFrames(fn: (f: DragFrame) => void): () => void;
  /** The drag hook's door (not part of the S4 contract surface). */
  emitFrame(f: DragFrame): void;
  /** Riders for the commit (§2). Returns the unsubscribe. */
  onCommit(fn: CommitRider): () => void;
  /** The committed layout: meta positions + JSX sizes, world units. */
  layoutRects(): ReadonlyArray<LayoutRect>;
  /** THE door for every artboard-position commit made from the canvas. */
  commitPositions(
    moved: { id: string; x: number; y: number }[],
    opts?: CommitPositionsOptions
  ): void;
}

export function createDragBusCore(deps: DragBusCoreDeps): DragBusCore {
  const frames = new Set<(f: DragFrame) => void>();
  const riders = new Set<CommitRider>();
  const warn = deps.warn ?? ((msg, err) => console.warn(`[drag-bus] ${msg}`, err ?? ''));
  const rect = (r: LayoutRect): LayoutRect => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h });

  return {
    subscribeFrames(fn) {
      frames.add(fn);
      return () => void frames.delete(fn);
    },
    emitFrame(f) {
      for (const fn of [...frames]) {
        try {
          fn(f);
        } catch (err) {
          warn('frame subscriber failed', err);
        }
      }
    },
    onCommit(fn) {
      riders.add(fn);
      return () => void riders.delete(fn);
    },
    layoutRects() {
      return deps.layout().map(rect);
    },
    commitPositions(moved, opts) {
      const before = deps.layout().map(rect);
      const byId = new Map(moved.map((m) => [m.id, m]));
      const changed: MovedArtboard[] = [];
      const after = before.map((r) => {
        const m = byId.get(r.id);
        if (!m || (m.x === r.x && m.y === r.y)) return r;
        changed.push({ id: r.id, x: m.x, y: m.y, dx: m.x - r.x, dy: m.y - r.y });
        return { ...r, x: m.x, y: m.y };
      });
      // A click without movement: nothing happened, nothing to undo, no riders.
      if (!changed.length) return;
      const undoGroup =
        opts?.undoGroup && UNDO_GROUP_RE.test(opts.undoGroup) ? opts.undoGroup : mintUndoGroup();
      const ops: AnnotationOp[] = [];
      const inverse: AnnotationOp[] = [];
      if (opts?.riders !== false) {
        for (const fn of [...riders]) {
          let out: AnnotationOp[] | null = null;
          try {
            out = fn(changed, undoGroup);
          } catch (err) {
            warn('commit rider failed', err);
          }
          if (!out?.length) continue;
          // A rider's ops ride only if all of them can be undone with the artboard.
          const inv = out.map(invertRiderOp);
          if (inv.some((x) => x === null)) {
            warn('commit rider returned ops that cannot ride (patch + expect only); dropped');
            continue;
          }
          ops.push(...out);
          inverse.unshift(...(inv as AnnotationOp[]).reverse());
        }
      }
      deps.commit(after, before, {
        ...(opts?.label ? { label: opts.label } : {}),
        ...(ops.length ? { rider: { ops, inverse, undoGroup } } : {}),
      });
    },
  };
}
