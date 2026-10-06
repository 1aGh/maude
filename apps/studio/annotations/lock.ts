/**
 * @file       annotations/lock.ts — the element lock guard (#137)
 * @scope      apps/studio/annotations/lock.ts
 * @purpose    A locked element can be selected but not moved, resized,
 *             rotated, deleted or re-texted from the UI. The UI gates its
 *             gestures; `guardLockedOps` is the safety net every UI commit
 *             passes through (`commitStrokes`), so a tool path the gating
 *             misses still can't change a locked element.
 *
 *             A UX guard, NOT a permission: anyone can unlock, and the
 *             server op API, sync and undo don't enforce it (an undo batch
 *             recorded before the lock, or a pre-lock peer, must still
 *             apply). React-free, DOM-free.
 */

import { expandIdsToGroups } from '../annotations-groups.ts';
import type { Stroke } from '../annotations-model.ts';
import { jsonEq } from './fields.ts';
import type { Op } from './ops.ts';
import type { AnnotationElement } from './types.ts';

/**
 * Fields a locked element may still change. Allow-listed (not a deny-list of
 * geometry) so a field added later is guarded by default.
 *   - `index` — z-order is not a move;
 *   - `groups` — grouping a locked element doesn't move it;
 *   - `locked` — the unlock itself.
 */
export const LOCK_EXEMPT_FIELDS: ReadonlySet<string> = new Set(['index', 'groups', 'locked']);

export function isLocked(el: AnnotationElement | undefined | null): boolean {
  return el?.locked === true;
}

/** True when the op clears the lock (then the rest of the patch may apply). */
function unlocks(op: Op): boolean {
  if (op.op === 'put') return op.el.locked !== true;
  if (op.op !== 'patch') return false;
  return op.unset?.includes('locked') === true || (op.set !== undefined && op.set.locked === false);
}

/**
 * Ids whose deletion would take a locked element with it: the locked elements
 * themselves plus every ancestor container of one.
 */
function protectedFromDelete(
  prev: ReadonlyMap<string, AnnotationElement>,
  lockedIds: ReadonlySet<string>
): Set<string> {
  const out = new Set<string>();
  for (const id of lockedIds) {
    out.add(id);
    const seen = new Set<string>([id]);
    let p = prev.get(id)?.parent;
    while (p && !seen.has(p)) {
      seen.add(p);
      out.add(p);
      p = prev.get(p)?.parent;
    }
  }
  return out;
}

function pick(rec: Record<string, unknown> | undefined, keep: (k: string) => boolean) {
  if (!rec) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) if (keep(k)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Drop what a batch would do to a locked element (as of `prev`): deletes,
 * and every patched field outside `LOCK_EXEMPT_FIELDS`. A batch that unlocks
 * the element passes untouched. The delete of a container holding a locked
 * descendant is dropped too (it would take the locked element with it).
 */
export function guardLockedOps(
  prev: ReadonlyMap<string, AnnotationElement>,
  ops: readonly Op[]
): { ops: Op[]; blocked: number } {
  const lockedIds = new Set<string>();
  for (const el of prev.values()) if (isLocked(el)) lockedIds.add(el.id);
  if (!lockedIds.size) return { ops: [...ops], blocked: 0 };
  // An element unlocked anywhere in this batch is fair game for the whole batch.
  for (const op of ops) {
    const id = op.op === 'put' ? op.el.id : op.id;
    if (lockedIds.has(id) && unlocks(op)) lockedIds.delete(id);
  }
  if (!lockedIds.size) return { ops: [...ops], blocked: 0 };
  const noDelete = protectedFromDelete(prev, lockedIds);
  const out: Op[] = [];
  let blocked = 0;
  for (const op of ops) {
    if (op.op === 'delete') {
      if (noDelete.has(op.id)) {
        blocked++;
        continue;
      }
      out.push(op);
      continue;
    }
    const id = op.op === 'put' ? op.el.id : op.id;
    if (!lockedIds.has(id)) {
      out.push(op);
      continue;
    }
    const before = prev.get(id) as AnnotationElement;
    if (op.op === 'put') {
      // A replace of a locked record keeps only its exempt fields' changes.
      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      for (const k of LOCK_EXEMPT_FIELDS) {
        if (jsonEq(op.el[k], before[k])) continue;
        if (op.el[k] === undefined) unset.push(k);
        else set[k] = op.el[k];
      }
      const keys = new Set([...Object.keys(op.el), ...Object.keys(before)]);
      if ([...keys].some((k) => !LOCK_EXEMPT_FIELDS.has(k) && !jsonEq(op.el[k], before[k]))) {
        blocked++;
      }
      if (Object.keys(set).length || unset.length) {
        out.push({
          op: 'patch',
          id,
          ...(Object.keys(set).length ? { set } : {}),
          ...(unset.length ? { unset } : {}),
        });
      }
      continue;
    }
    const keep = (k: string) => LOCK_EXEMPT_FIELDS.has(k);
    const set = pick(op.set, keep);
    const unset = op.unset?.filter(keep);
    const touched = Object.keys(op.set ?? {}).length + (op.unset?.length ?? 0);
    const kept = Object.keys(set ?? {}).length + (unset?.length ?? 0);
    if (kept < touched) blocked++;
    if (!kept) continue;
    const expect = pick(op.expect, keep);
    out.push({
      op: 'patch',
      id,
      ...(set ? { set } : {}),
      ...(unset?.length ? { unset } : {}),
      ...(expect ? { expect } : {}),
      ...(op.strict ? { strict: true } : {}),
    });
  }
  return { ops: out, blocked };
}

/**
 * Ids of locked strokes in the Stroke view, including a locked shape's
 * anchored label stroke (`anchorId` → host), which inherits its host's lock.
 */
export function lockedStrokeIds(strokes: readonly Stroke[]): Set<string> {
  const out = new Set<string>();
  for (const s of strokes) if (s.locked) out.add(s.id);
  if (!out.size) return out;
  for (const s of strokes) {
    const a = (s as { anchorId?: string }).anchorId;
    if (a && out.has(a)) out.add(s.id);
  }
  return out;
}

/**
 * True when every (group-expanded) selected element is locked. A mixed
 * selection reads as unlocked, so the Lock / Unlock toggle locks all of it.
 */
export function isAllLocked(ids: readonly string[], strokes: readonly Stroke[]): boolean {
  if (!ids.length) return false;
  const locked = lockedStrokeIds(strokes);
  return expandIdsToGroups(ids, strokes).every((id) => locked.has(id));
}
