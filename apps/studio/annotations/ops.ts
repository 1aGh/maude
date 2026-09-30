/**
 * @file       annotations/ops.ts — element operations + the one merge rule (DDR-242 §4)
 * @scope      apps/studio/annotations/ops.ts
 * @purpose    Every change to a board is a list of ops:
 *               put    — create, or replace an element wholesale
 *               patch  — set / unset some fields of one element
 *               delete — remove an element
 *             The SAME `applyOps` runs in the studio (local + legacy shared doc)
 *             and in the hub kernel (accepted revisions), so all three agree
 *             on one merge rule:
 *               • different elements never conflict;
 *               • different fields of one element never conflict;
 *               • the same scalar field follows acceptance order (last wins —
 *                 DDR-241 §5);
 *               • the same TEXT field is merged 3-way at character level
 *                 against the patch's `expect` (sync/source-merge.ts), so two
 *                 people typing in one sticky both keep their words;
 *               • a patch on a missing element is rejected `gone` (the client
 *                 offers to restore — it never silently re-creates).
 *             A `strict` patch (undo) only touches fields that still hold the
 *             `expect` value: undo reverts YOUR change, never a peer's later one.
 *
 *             Structural fix-ups ride along as ordinary ops so undo and peers
 *             see them: deleting an element freezes every arrow end bound to it
 *             into a free point; deleting a container re-parents children that
 *             are not deleted with it (coordinates converted — they don't jump).
 */

import { mergeSource } from '../sync/source-merge.ts';
import { MAX_NESTING_DEPTH } from './constants.ts';
import { DANGEROUS_KEYS, jsonEq } from './fields.ts';
import { defOf, validateElement } from './registry.ts';
import { Scene } from './scene.ts';
import type { AnnotationElement, ArrowEnd } from './types.ts';

export type Op =
  | { op: 'put'; el: AnnotationElement }
  | {
      op: 'patch';
      id: string;
      /** Fields to set. */
      set?: Record<string, unknown>;
      /** Fields to reset to their default (removed from the record). */
      unset?: string[];
      /** The values the author saw before editing (merge base for text; guard for strict). */
      expect?: Record<string, unknown>;
      /** Only apply fields whose current value equals `expect` (undo). */
      strict?: boolean;
    }
  | { op: 'delete'; id: string };

export type RejectReason = 'gone' | 'invalid' | 'exists' | 'stale';

export interface ApplyResult {
  /** The new state (the input map is never mutated). */
  state: Map<string, AnnotationElement>;
  /** Ops actually applied, fix-ups included, in order. */
  applied: Op[];
  /** Ops that undo `applied` (already reversed — apply as one batch). */
  inverse: Op[];
  /** Ops (or parts of strict patches) that did not apply. */
  rejected: Array<{ op: Op; reason: RejectReason; fields?: string[] }>;
  /** Ids whose record changed (created, updated or deleted). */
  touched: Set<string>;
}

/** Which field of `type` holds its editable text (merged character-wise). */
function textField(type: string): string | null {
  const slot = defOf(type)?.caps.textSlot;
  if (slot === 'text') return 'text';
  if (slot === 'title') return 'label';
  return null;
}

/**
 * Character-level merges one op batch may run. Each `mergeSource` is bounded
 * (50 ms), but a batch of thousands was not (security review) — past this,
 * later same-field text edits resolve by acceptance order instead.
 */
export const MAX_TEXT_MERGES_PER_BATCH = 50;

interface MergeBudget {
  left: number;
}

/** Merge a text value: ours vs theirs against base. Overlap → ours (acceptance order). */
function mergeText(base: unknown, ours: unknown, theirs: unknown, budget: MergeBudget): unknown {
  if (typeof base !== 'string' || typeof ours !== 'string' || typeof theirs !== 'string')
    return ours;
  if (theirs === base) return ours;
  if (ours === base) return theirs;
  if (budget.left <= 0) return ours;
  budget.left--;
  const m = mergeSource(base, ours, theirs);
  return m.ok ? m.merged : ours;
}

/** Resolve one field's new value under the merge rule. */
function mergeField(
  type: string,
  key: string,
  current: unknown,
  next: unknown,
  base: unknown,
  hasBase: boolean,
  budget: MergeBudget
): unknown {
  if (!hasBase || jsonEq(current, base)) return next;
  if (key === textField(type)) return mergeText(base, next, current, budget);
  // Shape label: merge the nested text, other label fields by acceptance order.
  if (key === 'label' && defOf(type)?.caps.textSlot === 'label') {
    const cur = (current ?? {}) as Record<string, unknown>;
    const nx = (next ?? {}) as Record<string, unknown>;
    const bs = (base ?? {}) as Record<string, unknown>;
    return {
      ...cur,
      ...nx,
      text: mergeText(bs.text ?? '', nx.text ?? '', cur.text ?? '', budget),
    };
  }
  return next;
}

/** A snapshot of `fields` on `el` (absent fields are reported as `undefined`). */
function pick(el: AnnotationElement, fields: Iterable<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = el[f];
  return out;
}

function inversePatch(before: AnnotationElement, after: AnnotationElement, id: string): Op | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const expect: Record<string, unknown> = {};
  for (const k of keys) {
    if (jsonEq(before[k], after[k])) continue;
    if (before[k] === undefined) unset.push(k);
    else set[k] = before[k];
    expect[k] = after[k];
  }
  if (!Object.keys(set).length && !unset.length) return null;
  return { op: 'patch', id, set, ...(unset.length ? { unset } : {}), expect, strict: true };
}

export function applyOps(
  input: ReadonlyMap<string, AnnotationElement>,
  ops: readonly Op[]
): ApplyResult {
  const state = new Map(input);
  const applied: Op[] = [];
  const inverse: Op[] = [];
  const rejected: ApplyResult['rejected'] = [];
  const touched = new Set<string>();
  const budget: MergeBudget = { left: MAX_TEXT_MERGES_PER_BATCH };

  // Reverse indexes, built once per batch and kept current on every commit, so
  // a delete finds its bound arrows and children without walking the board
  // (k deletes on an n-element board were O(k·n) — security review).
  let byHost: Map<string, Set<string>> | null = null;
  let byParent: Map<string, Set<string>> | null = null;
  const link = (m: Map<string, Set<string>>, key: string, id: string) => {
    const set = m.get(key);
    if (set) set.add(id);
    else m.set(key, new Set([id]));
  };
  const hostsOf = (el: AnnotationElement): string[] => {
    if (el.type !== 'arrow') return [];
    const out: string[] = [];
    for (const k of ['start', 'end'] as const) {
      const e = el[k] as ArrowEnd | undefined;
      if (e && 'el' in e) out.push(e.el);
    }
    return out;
  };
  const indexes = () => {
    if (!byHost || !byParent) {
      const h = new Map<string, Set<string>>();
      const p = new Map<string, Set<string>>();
      for (const el of state.values()) {
        for (const host of hostsOf(el)) link(h, host, el.id);
        if (el.parent !== undefined) link(p, el.parent, el.id);
      }
      byHost = h;
      byParent = p;
    }
    return { byHost, byParent } as {
      byHost: Map<string, Set<string>>;
      byParent: Map<string, Set<string>>;
    };
  };
  // World geometry is only needed for arrows bound to a deleted host; the scene
  // is rebuilt only after a geometry change, never once per delete.
  let scene: Scene | null = null;
  // Records deleted in this batch — the geometry a surviving grandchild needs
  // to keep its world position when several ancestors go at once.
  const removed = new Map<string, AnnotationElement>();

  const commit = (
    id: string,
    before: AnnotationElement | undefined,
    after: AnnotationElement | undefined,
    op: Op
  ) => {
    if (byHost && byParent) {
      if (before) {
        for (const h of hostsOf(before)) byHost.get(h)?.delete(before.id);
        if (before.parent !== undefined) byParent.get(before.parent)?.delete(before.id);
      }
      if (after) {
        for (const h of hostsOf(after)) link(byHost, h, after.id);
        if (after.parent !== undefined) link(byParent, after.parent, after.id);
      }
    }
    // Only a change to something an arrow can bind to moves endpoints; an arrow
    // edit (every delete fix-up) leaves the geometry the scene answers for as is.
    if (after && after.type !== 'arrow') scene = null;
    if (after) state.set(id, after);
    else state.delete(id);
    touched.add(id);
    applied.push(op);
    if (!before && after) inverse.push({ op: 'delete', id });
    else if (before && !after) inverse.push({ op: 'put', el: before });
    else if (before && after) {
      const inv = inversePatch(before, after, id);
      if (inv) inverse.push(inv);
    }
  };

  const deleteWithFixups = (id: string, op: Op, deleting: ReadonlySet<string>) => {
    const target = state.get(id);
    if (!target) return;
    const idx = indexes();
    // 1. Arrows bound to the deleted element keep their visible endpoint as a free point.
    for (const arrowId of [...(idx.byHost.get(id) ?? [])]) {
      const el = state.get(arrowId);
      if (!el || deleting.has(arrowId)) continue;
      scene ??= new Scene(state.values());
      const ends = scene.arrowWorld(el);
      const origin = scene.originOf(el);
      const set: Record<string, unknown> = {};
      for (const k of ['start', 'end'] as const) {
        const e = el[k] as ArrowEnd | undefined;
        if (!e || !('el' in e) || e.el !== id) continue;
        const [wx, wy] = k === 'start' ? [ends?.x1, ends?.y1] : [ends?.x2, ends?.y2];
        set[k] = { x: (wx ?? origin.x) - origin.x, y: (wy ?? origin.y) - origin.y };
      }
      if (Object.keys(set).length) applyPatch({ op: 'patch', id: el.id, set });
    }
    // 2. Children of a deleted container move up to the nearest ancestor that
    //    still exists, keeping their world position. Ancestors already deleted
    //    earlier in this batch are skipped too (a parent-first nested delete
    //    otherwise left the child pointing at a deleted parent, and it jumped).
    if (defOf(target.type)?.caps.container) {
      let dx = typeof target.x === 'number' ? target.x : 0;
      let dy = typeof target.y === 'number' ? target.y : 0;
      let newParent = target.parent;
      while (newParent !== undefined && !state.has(newParent)) {
        const gone = removed.get(newParent);
        if (!gone) {
          newParent = undefined;
          break;
        }
        dx += typeof gone.x === 'number' ? gone.x : 0;
        dy += typeof gone.y === 'number' ? gone.y : 0;
        newParent = gone.parent;
      }
      for (const childId of [...(idx.byParent.get(id) ?? [])]) {
        const child = state.get(childId);
        if (!child || deleting.has(childId)) continue;
        const set: Record<string, unknown> = {};
        const def = defOf(child.type);
        if (def) Object.assign(set, def.translate(child, dx, dy));
        const patch: Op = newParent
          ? { op: 'patch', id: child.id, set: { ...set, parent: newParent } }
          : { op: 'patch', id: child.id, set, unset: ['parent'] };
        applyPatch(patch);
      }
    }
    removed.set(id, target);
    commit(id, target, undefined, op);
  };

  /** A parent must exist, be a container, and not sit inside the element's own subtree. */
  function parentOk(el: AnnotationElement): boolean {
    if (el.parent === undefined) return true;
    const seen = new Set<string>([el.id]);
    let cur: string | undefined = el.parent;
    let depth = 0;
    while (cur !== undefined) {
      const p = state.get(cur);
      if (!p || seen.has(cur) || !defOf(p.type)?.caps.container || ++depth > MAX_NESTING_DEPTH) {
        return false;
      }
      seen.add(cur);
      cur = p.parent;
    }
    return true;
  }

  function applyPatch(op: Extract<Op, { op: 'patch' }>, canDefer = false): void {
    const cur = state.get(op.id);
    if (!cur) {
      rejected.push({ op, reason: 'gone' });
      return;
    }
    const next: Record<string, unknown> = { ...cur };
    const expect = op.expect ?? {};
    const skipped: string[] = [];
    for (const [k, v] of Object.entries(op.set ?? {})) {
      if (k === 'id' || k === 'type' || DANGEROUS_KEYS.has(k)) continue;
      const hasBase = Object.hasOwn(expect, k);
      if (op.strict && hasBase && !jsonEq(cur[k], expect[k])) {
        skipped.push(k);
        continue;
      }
      const val = mergeField(cur.type, k, cur[k], v, expect[k], hasBase, budget);
      // `null` stays (e.g. `fill: null` = no fill); validation normalizes it.
      if (val === undefined) delete next[k];
      else next[k] = val;
    }
    for (const k of op.unset ?? []) {
      if (k === 'id' || k === 'type' || k === 'index') continue;
      if (op.strict && Object.hasOwn(expect, k) && !jsonEq(cur[k], expect[k])) {
        skipped.push(k);
        continue;
      }
      delete next[k];
    }
    if (skipped.length) rejected.push({ op, reason: 'stale', fields: skipped });
    const v = validateElement(next);
    if (
      v.ok &&
      !parentOk(v.el) &&
      canDefer &&
      v.el.parent !== undefined &&
      putIds.has(v.el.parent)
    ) {
      // Its new parent is re-created later in this batch (an undo of a nested
      // delete): retry once the puts have landed.
      deferred.push(op);
      return;
    }
    if (!v.ok || !parentOk(v.el)) {
      rejected.push({ op, reason: 'invalid' });
      return;
    }
    if (jsonEq(v.el, cur)) return;
    commit(op.id, cur, v.el, op);
  }

  // Deletes in one batch are resolved together so a subtree delete doesn't
  // first re-parent children that are about to go too.
  const deleting = new Set(
    ops.filter((o) => o.op === 'delete').map((o) => (o as { id: string }).id)
  );

  // A put whose parent is created later in the same batch is retried after it.
  const putIds = new Set(
    ops.filter((o) => o.op === 'put').map((o) => (o as { el: { id?: unknown } }).el?.id)
  );
  let deferred: Extract<Op, { op: 'put' } | { op: 'patch' }>[] = [];
  const applyPut = (op: Extract<Op, { op: 'put' }>, canDefer: boolean): void => {
    const v = validateElement(op.el);
    if (!v.ok) {
      rejected.push({ op, reason: 'invalid' });
      return;
    }
    if (!parentOk(v.el)) {
      if (canDefer && v.el.parent !== undefined && putIds.has(v.el.parent)) deferred.push(op);
      else rejected.push({ op, reason: 'invalid' });
      return;
    }
    const before = state.get(v.el.id);
    if (before && jsonEq(before, v.el)) return;
    commit(v.el.id, before, v.el, { op: 'put', el: v.el });
  };

  for (const op of ops) {
    if (op.op === 'put') {
      applyPut(op, true);
    } else if (op.op === 'patch') {
      applyPatch(op, true);
    } else if (op.op === 'delete') {
      if (!state.has(op.id)) continue; // idempotent: already gone
      deleteWithFixups(op.id, op, deleting);
    }
  }
  for (let pass = 0; deferred.length && pass <= MAX_NESTING_DEPTH; pass++) {
    const retry = deferred;
    deferred = [];
    for (const op of retry) {
      if (op.op === 'put') applyPut(op, pass < MAX_NESTING_DEPTH);
      else applyPatch(op, pass < MAX_NESTING_DEPTH);
    }
  }
  for (const op of deferred) rejected.push({ op, reason: 'invalid' });
  return { state, applied, inverse: inverse.reverse(), rejected, touched };
}

/**
 * The ops that turn `before` into `after` (both canonical). Patches carry
 * `expect` = the before-values, so text edits merge against a concurrent
 * peer edit instead of overwriting it.
 */
export function diffToOps(
  before: ReadonlyMap<string, AnnotationElement>,
  after: ReadonlyMap<string, AnnotationElement>
): Op[] {
  const ops: Op[] = [];
  for (const [id, el] of after) {
    const prev = before.get(id);
    if (!prev) {
      ops.push({ op: 'put', el });
      continue;
    }
    if (prev.type !== el.type) {
      ops.push({ op: 'put', el });
      continue;
    }
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const k of new Set([...Object.keys(prev), ...Object.keys(el)])) {
      if (jsonEq(prev[k], el[k])) continue;
      if (el[k] === undefined) unset.push(k);
      else set[k] = el[k];
    }
    if (!Object.keys(set).length && !unset.length) continue;
    const keys = [...Object.keys(set), ...unset];
    ops.push({
      op: 'patch',
      id,
      ...(Object.keys(set).length ? { set } : {}),
      ...(unset.length ? { unset } : {}),
      expect: pick(prev, keys),
    });
  }
  for (const id of before.keys()) if (!after.has(id)) ops.push({ op: 'delete', id });
  return ops;
}

/** Validate an untrusted op list (from a peer / the wire) into typed ops; bad ops are dropped. */
export function parseOps(raw: unknown, max = 5000): { ops: Op[]; dropped: number } {
  if (!Array.isArray(raw)) return { ops: [], dropped: 0 };
  const ops: Op[] = [];
  let dropped = 0;
  const isRec = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
  for (const o of raw.slice(0, max)) {
    if (!isRec(o)) {
      dropped++;
      continue;
    }
    if (o.op === 'put' && isRec(o.el)) {
      ops.push({ op: 'put', el: o.el as AnnotationElement });
    } else if (o.op === 'delete' && typeof o.id === 'string') {
      ops.push({ op: 'delete', id: o.id });
    } else if (o.op === 'patch' && typeof o.id === 'string') {
      const unset = Array.isArray(o.unset)
        ? o.unset.filter((k): k is string => typeof k === 'string').slice(0, 64)
        : undefined;
      ops.push({
        op: 'patch',
        id: o.id,
        ...(isRec(o.set) ? { set: o.set } : {}),
        ...(unset?.length ? { unset } : {}),
        ...(isRec(o.expect) ? { expect: o.expect } : {}),
        ...(o.strict === true ? { strict: true } : {}),
      });
    } else dropped++;
  }
  if (raw.length > max) dropped += raw.length - max;
  return { ops, dropped };
}
