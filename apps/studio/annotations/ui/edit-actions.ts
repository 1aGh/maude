/**
 * @file       annotations/ui/edit-actions.ts — what a UI edit sends, as element ops
 * @scope      apps/studio/annotations/ui/edit-actions.ts
 * @purpose    DDR-242 AD4 + AD8 (Task 26). Every whiteboard edit the canvas
 *             makes — move, resize, restyle, create, delete, duplicate, z-order,
 *             group, align, re-bind an arrow — is ONE op batch built here from
 *             the board and world-space intent, through the element registry.
 *             No stroke geometry, no whole-board diff: a move patches x/y of
 *             the moved roots (their contents are parent-relative and follow),
 *             a bound arrow end is a reference and needs no patch at all.
 *
 *             Pure and React-free; the layer applies the batch locally
 *             (board.ts) and sends it (DDR-242 §4). Undo is its inverse.
 */

import { keyBetween, orderKeys } from '../fractional-index.ts';
import type { Op } from '../ops.ts';
import { defOf } from '../registry.ts';
import type { Scene } from '../scene.ts';
import type { AnnotationElement, ArrowEnd, Box } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Ids

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix = 's'): string {
  let out = `${prefix}_`;
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += ID_CHARS[b % ID_CHARS.length];
  return out;
}

export function newGroupId(): string {
  return newId('g');
}

// ─────────────────────────────────────────────────────────────────────────────
// World ⇄ parent space

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Shift every parent-space coordinate of a record by (dx, dy): x/y, pen points, free arrow ends. */
export function shiftRecord(
  el: Record<string, unknown>,
  dx: number,
  dy: number
): Record<string, unknown> {
  if (dx === 0 && dy === 0) return el;
  const out = { ...el };
  if (typeof out.x === 'number') out.x = (out.x as number) + dx;
  if (typeof out.y === 'number') out.y = (out.y as number) + dy;
  if (Array.isArray(out.points)) {
    out.points = (out.points as number[]).map((v, i) => v + (i % 2 === 0 ? dx : dy));
  }
  for (const k of ['start', 'end'] as const) {
    const e = out[k] as ArrowEnd | undefined;
    if (e && !('el' in e)) out[k] = { x: e.x + dx, y: e.y + dy };
  }
  return out;
}

/** World box → the element's parent space. */
export function toParentBox(scene: Scene, el: AnnotationElement, world: Box): Box {
  const o = scene.originOf(el);
  return { x: world.x - o.x, y: world.y - o.y, w: world.w, h: world.h };
}

// ─────────────────────────────────────────────────────────────────────────────
// Placement (z-order within a parent)

function siblings(scene: Scene, parent: string | null): readonly AnnotationElement[] {
  return scene.childrenOf(parent);
}

/** Index key on top of `parent`'s children (or at the back). */
export function indexAt(scene: Scene, parent: string | null, where: 'top' | 'back'): string {
  const kids = siblings(scene, parent);
  if (!kids.length) return keyBetween(null, null);
  if (where === 'back') return keyBetween(null, (kids[0] as AnnotationElement).index);
  return keyBetween((kids[kids.length - 1] as AnnotationElement).index, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Create

export interface CreateOpts {
  /** Where it goes in paint order among its siblings. Default: on top. */
  z?: 'top' | 'back' | { above: string };
  /** Force a parent (null = top level); default: the container its centre lands in. */
  parent?: string | null;
}

/**
 * A new element from a WORLD-space record (no id/index/parent needed): it joins
 * the section its centre lands in — a section inside another nests there —
 * and is converted to that parent's coordinates.
 */
export function createOp(
  scene: Scene,
  world: Record<string, unknown> & { type: string },
  opts: CreateOpts = {}
): { op: Op; id: string } {
  const id = (typeof world.id === 'string' && world.id) || newId();
  const def = defOf(world.type);
  let parent: string | null = opts.parent === undefined ? null : opts.parent;
  if (opts.parent === undefined) {
    const probe = { ...world, id, index: 'a0' } as AnnotationElement;
    const b = def?.bounds(probe, { origin: { x: 0, y: 0 }, resolve: () => null }) ?? null;
    if (b) {
      const exclude = new Set<string>([id]);
      parent = scene.containerAt(b.x + b.w / 2, b.y + b.h / 2, exclude)?.id ?? null;
      // A container only nests inside a strictly larger one.
      if (parent && def?.caps.container) {
        const pb = scene.worldBox(parent);
        if (pb && pb.w * pb.h <= b.w * b.h) parent = null;
      }
    }
  }
  const origin = parent
    ? (() => {
        const p = scene.get(parent) as AnnotationElement;
        const po = scene.originOf(p);
        return { x: po.x + num(p.x), y: po.y + num(p.y) };
      })()
    : { x: 0, y: 0 };
  const z = opts.z ?? 'top';
  let index: string;
  if (typeof z === 'object') {
    const kids = siblings(scene, parent);
    const at = kids.findIndex((k) => k.id === z.above);
    const lo = at >= 0 ? (kids[at] as AnnotationElement).index : null;
    const hi = at >= 0 && at + 1 < kids.length ? (kids[at + 1] as AnnotationElement).index : null;
    index = keyBetween(lo, hi);
  } else {
    index = indexAt(scene, parent, z);
  }
  const rec = shiftRecord({ ...world, id, index }, -origin.x, -origin.y);
  if (parent) rec.parent = parent;
  else delete rec.parent;
  return { op: { op: 'put', el: rec as AnnotationElement }, id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Move (+ re-parent at drop)

/** Of `ids`, those not inside another of `ids` — contents ride their container. */
export function rootsOf(scene: Scene, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => scene.get(id) && !scene.ancestors(id).some((a) => set.has(a)));
}

/**
 * Move `ids` by a world delta. Only the roots are patched — a section's
 * contents are relative to it. With `reparent`, a root whose centre lands in
 * another section (or out of its own) changes parent at the same world place
 * (the drop).
 */
export function moveOps(
  scene: Scene,
  ids: Iterable<string>,
  dx: number,
  dy: number,
  opts: { reparent?: boolean } = {}
): Op[] {
  const roots = rootsOf(scene, ids);
  const moving = new Set<string>();
  for (const r of roots) {
    moving.add(r);
    for (const d of scene.descendants(r)) moving.add(d.id);
  }
  const ops: Op[] = [];
  for (const id of roots) {
    const el = scene.get(id) as AnnotationElement;
    const def = defOf(el.type);
    let set: Record<string, unknown> = def ? def.translate(el, dx, dy) : shiftRecord(el, dx, dy);
    if (opts.reparent) {
      const wb = scene.worldBox(el);
      if (wb) {
        const cx = wb.x + wb.w / 2 + dx;
        const cy = wb.y + wb.h / 2 + dy;
        let next = scene.containerAt(cx, cy, moving)?.id ?? null;
        if (next && def?.caps.container) {
          const nb = scene.worldBox(next);
          if (nb && nb.w * nb.h <= wb.w * wb.h) next = null;
        }
        const cur = scene.effectiveParent(el);
        if (next !== cur) {
          const from = scene.originOf(el);
          const to = next
            ? (() => {
                const p = scene.get(next) as AnnotationElement;
                const po = scene.originOf(p);
                return { x: po.x + num(p.x), y: po.y + num(p.y) };
              })()
            : { x: 0, y: 0 };
          const moved = { ...el, ...set };
          set = { ...set, ...shiftRecord(moved, from.x - to.x, from.y - to.y) };
          for (const k of ['id', 'type', 'index', 'groups', 'author'] as const) delete set[k];
          set.parent = next ?? undefined;
          set.index = indexAt(scene, next, 'top');
          if (!next) {
            ops.push({ op: 'patch', id, set: omitUndef(set), unset: ['parent'] });
            continue;
          }
        }
      }
    }
    ops.push({ op: 'patch', id, set: omitUndef(set) });
  }
  return ops;
}

function omitUndef(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resize / rotate / restyle

/** Fit an element to a WORLD box (its registry `resize`). */
export function resizeOp(scene: Scene, id: string, world: Box): Op | null {
  const el = scene.get(id);
  const def = el ? defOf(el.type) : null;
  if (!el || !def) return null;
  const box = toParentBox(scene, el, {
    x: Math.min(world.x, world.x + world.w),
    y: Math.min(world.y, world.y + world.h),
    w: Math.abs(world.w),
    h: Math.abs(world.h),
  });
  return { op: 'patch', id, set: def.resize(el, box, scene.ctx(el)) };
}

export function patchOp(id: string, set: Record<string, unknown>, unset?: string[]): Op {
  return { op: 'patch', id, set, ...(unset?.length ? { unset } : {}) };
}

/** Set (or, with `undefined`, reset to default) fields on many elements. */
export function styleOps(ids: Iterable<string>, fields: Record<string, unknown>): Op[] {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) unset.push(k);
    else set[k] = v;
  }
  return [...ids].map((id) => ({
    op: 'patch' as const,
    id,
    set,
    ...(unset.length ? { unset } : {}),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete / duplicate

export function deleteOps(ids: Iterable<string>): Op[] {
  // Children before their containers: each op then removes a leaf, and the
  // op layer's own fix-ups (freeze bound arrow ends) run per element.
  return [...ids].map((id) => ({ op: 'delete' as const, id })).reverse();
}

/**
 * Copies of `ids` (callers pass the full set — contents included), offset by a
 * world delta. Parents, groups and arrow bindings inside the copied set are
 * remapped to the copies; a binding to an element outside the set stays on it.
 * Copies go on top of their siblings.
 */
export function duplicateOps(
  scene: Scene,
  ids: Iterable<string>,
  dx: number,
  dy: number
): { ops: Op[]; idMap: Map<string, string> } {
  const set = new Set([...ids].filter((id) => scene.get(id)));
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const order = scene.paintOrder().filter((e) => set.has(e.id));
  for (const el of order) idMap.set(el.id, newId());
  const topKey = new Map<string, string | null>();
  const nextKey = (parent: string | null) => {
    const k = parent ?? '';
    const prev = topKey.has(k)
      ? (topKey.get(k) as string | null)
      : (() => {
          const kids = siblings(scene, parent);
          return kids.length ? (kids[kids.length - 1] as AnnotationElement).index : null;
        })();
    const key = keyBetween(prev, null);
    topKey.set(k, key);
    return key;
  };
  const ops: Op[] = [];
  for (const el of order) {
    const nid = idMap.get(el.id) as string;
    const p = scene.effectiveParent(el);
    const parent = p && idMap.has(p) ? (idMap.get(p) as string) : p;
    const isRoot = !p || !set.has(p);
    let rec: Record<string, unknown> = { ...el, id: nid, index: nextKey(parent) };
    if (isRoot) rec = shiftRecord(rec, dx, dy);
    if (parent) rec.parent = parent;
    else delete rec.parent;
    if (Array.isArray(el.groups)) {
      rec.groups = (el.groups as string[]).map((g) => {
        let m = groupMap.get(g);
        if (!m) {
          m = newGroupId();
          groupMap.set(g, m);
        }
        return m;
      });
    }
    for (const k of ['start', 'end'] as const) {
      const e = rec[k] as ArrowEnd | undefined;
      if (e && 'el' in e && idMap.has(e.el)) rec[k] = { ...e, el: idMap.get(e.el) };
    }
    delete rec.author;
    ops.push({ op: 'put', el: rec as AnnotationElement });
  }
  return { ops, idMap };
}

// ─────────────────────────────────────────────────────────────────────────────
// Groups

export function outermostGroup(el: AnnotationElement | undefined): string | null {
  const g = el?.groups;
  return Array.isArray(g) && g.length ? (g[g.length - 1] as string) : null;
}

/** `ids` plus every member of their outermost groups. */
export function expandGroups(scene: Scene, ids: readonly string[]): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const g = outermostGroup(scene.get(id));
    if (g) groups.add(g);
  }
  const out = new Set(ids);
  if (groups.size) {
    for (const el of scene.byId.values()) {
      const g = outermostGroup(el);
      if (g && groups.has(g)) out.add(el.id);
    }
  }
  return [...out];
}

export function groupOps(
  scene: Scene,
  ids: readonly string[]
): { ops: Op[]; members: string[] } | null {
  const members = expandGroups(scene, ids).filter((id) => scene.get(id));
  if (members.length < 2) return null;
  const g = newGroupId();
  const ops: Op[] = members.map((id) => {
    const cur = (scene.get(id)?.groups as string[] | undefined) ?? [];
    return { op: 'patch', id, set: { groups: [...cur, g] } };
  });
  return { ops, members };
}

export function ungroupOps(scene: Scene, ids: readonly string[]): Op[] {
  const dissolve = new Set<string>();
  for (const id of ids) {
    const g = outermostGroup(scene.get(id));
    if (g) dissolve.add(g);
  }
  if (!dissolve.size) return [];
  const ops: Op[] = [];
  for (const el of scene.byId.values()) {
    const g = outermostGroup(el);
    if (!g || !dissolve.has(g)) continue;
    const rest = (el.groups as string[]).slice(0, -1);
    ops.push(
      rest.length
        ? { op: 'patch', id: el.id, set: { groups: rest } }
        : { op: 'patch', id: el.id, unset: ['groups'] }
    );
  }
  return ops;
}

// ─────────────────────────────────────────────────────────────────────────────
// Z-order (per parent; a group's members move as one unit)

export type ZOrder = 'front' | 'back' | 'forward' | 'backward';

export function reorderOps(scene: Scene, ids: readonly string[], op: ZOrder): Op[] {
  const sel = new Set(expandGroups(scene, ids));
  const parents = new Set<string | null>();
  for (const id of sel) {
    const el = scene.get(id);
    if (el) parents.add(scene.effectiveParent(el));
  }
  const ops: Op[] = [];
  for (const parent of parents) {
    const kids = siblings(scene, parent);
    const units: AnnotationElement[][] = [];
    for (const k of kids) {
      const g = outermostGroup(k);
      const last = units[units.length - 1];
      if (last && g != null && outermostGroup(last[0]) === g) last.push(k);
      else units.push([k]);
    }
    const isSel = (u: AnnotationElement[]) => u.some((e) => sel.has(e.id));
    let arr: AnnotationElement[][];
    if (op === 'front') arr = [...units.filter((u) => !isSel(u)), ...units.filter(isSel)];
    else if (op === 'back') arr = [...units.filter(isSel), ...units.filter((u) => !isSel(u))];
    else {
      arr = [...units];
      if (op === 'forward') {
        for (let i = arr.length - 2; i >= 0; i--) {
          const cur = arr[i] as AnnotationElement[];
          const above = arr[i + 1] as AnnotationElement[];
          if (isSel(cur) && !isSel(above)) {
            arr[i] = above;
            arr[i + 1] = cur;
          }
        }
      } else {
        for (let i = 1; i < arr.length; i++) {
          const cur = arr[i] as AnnotationElement[];
          const below = arr[i - 1] as AnnotationElement[];
          if (isSel(cur) && !isSel(below)) {
            arr[i] = below;
            arr[i - 1] = cur;
          }
        }
      }
    }
    const idsInOrder = arr.flat().map((e) => e.id);
    const prev = new Map(kids.map((k) => [k.id, k.index]));
    for (const [id, key] of orderKeys(idsInOrder, prev)) {
      if (prev.get(id) !== key) ops.push({ op: 'patch', id, set: { index: key } });
    }
  }
  return ops;
}

// ─────────────────────────────────────────────────────────────────────────────
// Align / distribute (units: groups; contents ride their section)

export type AlignEdge = 'left' | 'h-center' | 'right' | 'top' | 'v-center' | 'bottom';

interface Unit {
  ids: string[];
  box: Box;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function unitsOf(scene: Scene, ids: readonly string[]): Unit[] {
  const roots = rootsOf(scene, expandGroups(scene, ids));
  const byGroup = new Map<string, Unit>();
  const units: Unit[] = [];
  for (const el of scene.paintOrder()) {
    if (!roots.includes(el.id)) continue;
    const b = scene.worldBox(el);
    if (!b) continue;
    const g = outermostGroup(el);
    const u = g ? byGroup.get(g) : undefined;
    if (u) {
      u.ids.push(el.id);
      u.box = union(u.box, b);
    } else {
      const nu = { ids: [el.id], box: b };
      if (g) byGroup.set(g, nu);
      units.push(nu);
    }
  }
  return units;
}

function unitMoves(scene: Scene, moves: Array<[Unit, number, number]>): Op[] {
  const ops: Op[] = [];
  for (const [u, dx, dy] of moves)
    if (dx !== 0 || dy !== 0) ops.push(...moveOps(scene, u.ids, dx, dy));
  return ops;
}

export function alignOps(scene: Scene, ids: readonly string[], edge: AlignEdge): Op[] {
  const units = unitsOf(scene, ids);
  if (units.length < 2) return [];
  const all = units.slice(1).reduce((b, u) => union(b, u.box), (units[0] as Unit).box);
  return unitMoves(
    scene,
    units.map((u) => {
      const b = u.box;
      if (edge === 'left') return [u, all.x - b.x, 0];
      if (edge === 'h-center') return [u, all.x + all.w / 2 - (b.x + b.w / 2), 0];
      if (edge === 'right') return [u, all.x + all.w - (b.x + b.w), 0];
      if (edge === 'top') return [u, 0, all.y - b.y];
      if (edge === 'v-center') return [u, 0, all.y + all.h / 2 - (b.y + b.h / 2)];
      return [u, 0, all.y + all.h - (b.y + b.h)];
    })
  );
}

export function distributeOps(scene: Scene, ids: readonly string[], axis: 'h' | 'v'): Op[] {
  const units = unitsOf(scene, ids);
  if (units.length < 3) return [];
  const lead = (u: Unit) => (axis === 'h' ? u.box.x : u.box.y);
  const size = (u: Unit) => (axis === 'h' ? u.box.w : u.box.h);
  const sorted = [...units].sort((a, b) => lead(a) - lead(b));
  const first = sorted[0] as Unit;
  const last = sorted[sorted.length - 1] as Unit;
  const span = lead(last) + size(last) - lead(first);
  const total = sorted.reduce((m, u) => m + size(u), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = lead(first);
  const moves: Array<[Unit, number, number]> = [];
  for (const u of sorted) {
    const d = cursor - lead(u);
    moves.push(axis === 'h' ? [u, d, 0] : [u, 0, d]);
    cursor += size(u) + gap;
  }
  return unitMoves(scene, moves);
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrows

/** Point an arrow end at an element (auto / pinned magnet) or a free WORLD point. */
export function arrowEndOp(
  scene: Scene,
  arrowId: string,
  which: 'start' | 'end',
  target: { el: string; nx?: number; ny?: number } | { x: number; y: number }
): Op | null {
  const el = scene.get(arrowId);
  if (!el || el.type !== 'arrow') return null;
  if ('el' in target) {
    const end: ArrowEnd =
      target.nx !== undefined && target.ny !== undefined
        ? { el: target.el, nx: target.nx, ny: target.ny }
        : { el: target.el };
    return { op: 'patch', id: arrowId, set: { [which]: end } };
  }
  const o = scene.originOf(el);
  return { op: 'patch', id: arrowId, set: { [which]: { x: target.x - o.x, y: target.y - o.y } } };
}
