/**
 * @file       annotations-groups.ts — FigJam v3 grouping + duplicate + z-order
 * @scope      apps/studio/annotations-groups.ts
 * @purpose    Pure helpers over the Stroke model (no React, no DOM) for the
 *             group/ungroup, duplicate (Cmd+D / Alt+drag / paste), and z-order
 *             manipulations. Group model = Excalidraw-style flat tag-array:
 *             every stroke carries `groupIds` ordered DEEPEST → SHALLOWEST and
 *             the OUTERMOST group id is the LAST element. There is no group
 *             node — selection logic expands a clicked stroke to everything
 *             sharing its outermost group id. tldraw's lifecycle rules are
 *             copied as `normalizeGroups` (empty group self-deletes,
 *             single-member group auto-dissolves).
 */

import { gid, rid, type Stroke, translateOne } from './annotations-model.ts';

/** The stroke's outermost (shallowest) group id, or null when ungrouped. */
export function outermostGroupOf(s: Stroke): string | null {
  const ids = s.groupIds;
  if (!ids || ids.length === 0) return null;
  return ids[ids.length - 1] ?? null;
}

/** Shallow-copy a stroke with its `groupIds` key dropped entirely (so an
 *  ungrouped stroke round-trips byte-identically — no `groupIds: []`). */
function stripGroupIds(s: Stroke): Stroke {
  const { groupIds: _drop, ...rest } = s;
  return rest as Stroke;
}

/**
 * Selection-expansion (FigJam: clicking a group member selects the whole
 * group). Expands every id whose stroke belongs to a group to ALL strokes
 * sharing that outermost group id. Result is in document (z) order, deduped.
 */
export function expandIdsToGroups(ids: readonly string[], strokes: readonly Stroke[]): string[] {
  const want = new Set(ids);
  const groups = new Set<string>();
  for (const s of strokes) {
    if (!want.has(s.id)) continue;
    const g = outermostGroupOf(s);
    if (g) groups.add(g);
  }
  const out: string[] = [];
  for (const s of strokes) {
    const g = outermostGroupOf(s);
    if (want.has(s.id) || (g != null && groups.has(g))) out.push(s.id);
  }
  // Preserve ids that don't resolve to a live stroke (defensive — a stale
  // selection entry must not silently disappear from the caller's set).
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

export interface GroupResult {
  strokes: Stroke[];
  groupId: string;
  /** Document-order ids of every member of the new group. */
  memberIds: string[];
}

/**
 * Group the (expanded) selection under a fresh outermost group id. Members are
 * reordered CONTIGUOUS — the block lands where the topmost member sat, so the
 * group's z-position matches FigJam (group adopts the front-most member's
 * layer; relative order inside is preserved). Returns null when fewer than two
 * members resolve (nothing to group).
 */
export function groupStrokes(
  strokes: readonly Stroke[],
  ids: readonly string[],
  newId: string = gid()
): GroupResult | null {
  const memberIds = new Set(
    expandIdsToGroups(ids, strokes).filter((id) => strokes.some((s) => s.id === id))
  );
  if (memberIds.size < 2) return null;
  const members: Stroke[] = [];
  const rest: Stroke[] = [];
  let lastMemberIdx = -1;
  strokes.forEach((s, i) => {
    if (memberIds.has(s.id)) {
      members.push({ ...s, groupIds: [...(s.groupIds ?? []), newId] });
      lastMemberIdx = i;
    } else {
      rest.push(s);
    }
  });
  // Insert the contiguous block after every non-member that sat below the
  // topmost member — the group keeps the front-most member's z position.
  let insertAt = 0;
  for (let i = 0; i < lastMemberIdx; i++) {
    const s = strokes[i];
    if (s && !memberIds.has(s.id)) insertAt++;
  }
  const out = [...rest.slice(0, insertAt), ...members, ...rest.slice(insertAt)];
  return { strokes: out, groupId: newId, memberIds: members.map((m) => m.id) };
}

/**
 * Dissolve the outermost group of every selected stroke (Cmd+Shift+G). Nested
 * groups surface one level per invocation — FigJam/tldraw semantics.
 */
export function ungroupStrokes(strokes: readonly Stroke[], ids: readonly string[]): Stroke[] {
  const sel = new Set(ids);
  const dissolve = new Set<string>();
  for (const s of strokes) {
    if (!sel.has(s.id)) continue;
    const g = outermostGroupOf(s);
    if (g) dissolve.add(g);
  }
  if (dissolve.size === 0) return [...strokes];
  return strokes.map((s) => {
    const g = outermostGroupOf(s);
    if (!g || !dissolve.has(g)) return s;
    const remaining = (s.groupIds ?? []).slice(0, -1);
    return remaining.length ? { ...s, groupIds: remaining } : stripGroupIds(s);
  });
}

/**
 * tldraw lifecycle rules — drop every group id with fewer than two members
 * (covers both the empty group after a delete and the singleton left behind by
 * a partial erase). Run after any deletion. Returns the input array when
 * nothing changed (referential no-op).
 */
export function normalizeGroups(strokes: readonly Stroke[]): Stroke[] {
  const counts = new Map<string, number>();
  for (const s of strokes) {
    for (const g of s.groupIds ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const dead = new Set<string>();
  for (const [g, n] of counts) if (n < 2) dead.add(g);
  if (dead.size === 0) return strokes as Stroke[];
  return strokes.map((s) => {
    if (!s.groupIds?.some((g) => dead.has(g))) return s;
    const keep = s.groupIds.filter((g) => !dead.has(g));
    return keep.length ? { ...s, groupIds: keep } : stripGroupIds(s);
  });
}

export interface DuplicateResult {
  strokes: Stroke[];
  /** Ids of the selectable clones (anchored-text clones excluded — they're
   *  selected through their host, FigJam semantics). */
  newIds: string[];
  /** Original id → its clone's id. */
  idMap: Map<string, string>;
}

/**
 * Clone the (expanded) selection with fresh ids, remapping every internal
 * reference: `groupIds` (each old group → one fresh id, so the copy is its own
 * group), anchored-text `anchorId`, and arrow binds between co-duplicated
 * strokes. A bind to a NON-duplicated host is kept pointing at the original
 * (Excalidraw/FigJam: duplicating a bound arrow keeps the attachment). Clones
 * append at the end of the array (top of z) offset by (dx, dy).
 */
export function duplicateStrokes(
  strokes: readonly Stroke[],
  ids: readonly string[],
  dx: number,
  dy: number,
  makeId: () => string = rid,
  makeGroupId: () => string = gid
): DuplicateResult {
  const dupSet = new Set(expandIdsToGroups(ids, strokes));
  // Anchored text travels with its host even though it's never independently
  // selected — clone it alongside a duplicated host.
  for (const s of strokes) {
    if (s.tool === 'text' && s.anchorId && dupSet.has(s.anchorId)) dupSet.add(s.id);
  }
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const clones: Stroke[] = [];
  for (const s of strokes) {
    if (!dupSet.has(s.id)) continue;
    const nid = makeId();
    idMap.set(s.id, nid);
    const moved = translateOne(structuredClone(s) as Stroke, dx, dy);
    const clone: Stroke = { ...moved, id: nid };
    if (clone.groupIds) {
      clone.groupIds = clone.groupIds.map((g) => {
        let mapped = groupMap.get(g);
        if (!mapped) {
          mapped = makeGroupId();
          groupMap.set(g, mapped);
        }
        return mapped;
      });
    }
    clones.push(clone);
  }
  for (const c of clones) {
    if (c.tool === 'text' && c.anchorId) {
      const mapped = idMap.get(c.anchorId);
      if (mapped) c.anchorId = mapped;
    }
    if (c.tool === 'arrow') {
      if (c.startBind) {
        const mapped = idMap.get(c.startBind.hostId);
        if (mapped) c.startBind = { ...c.startBind, hostId: mapped };
      }
      if (c.endBind) {
        const mapped = idMap.get(c.endBind.hostId);
        if (mapped) c.endBind = { ...c.endBind, hostId: mapped };
      }
    }
  }
  return {
    strokes: [...strokes, ...clones],
    newIds: clones.filter((c) => !(c.tool === 'text' && c.anchorId)).map((c) => c.id),
    idMap,
  };
}

export type ZOrderOp = 'front' | 'back' | 'forward' | 'backward';

/**
 * Z-order = array order (render order; no fractional index needed under the
 * whole-SVG LWW sync). Units move together: a maximal run of strokes sharing
 * one outermost group id is one unit, an ungrouped stroke is its own unit —
 * so `]` on a group hops the whole NEIGHBOURING group, never interleaves.
 */
export function reorderStrokes(
  strokes: readonly Stroke[],
  ids: readonly string[],
  op: ZOrderOp
): Stroke[] {
  const sel = new Set(expandIdsToGroups(ids, strokes));
  if (sel.size === 0) return [...strokes];
  const units: Stroke[][] = [];
  for (const s of strokes) {
    const g = outermostGroupOf(s);
    const last = units[units.length - 1];
    const lastFirst = last?.[0];
    if (last && lastFirst && g != null && outermostGroupOf(lastFirst) === g) last.push(s);
    else units.push([s]);
  }
  const isSel = (u: Stroke[]): boolean => u.some((s) => sel.has(s.id));
  if (op === 'front') {
    const rest = units.filter((u) => !isSel(u));
    const selUnits = units.filter(isSel);
    return [...rest, ...selUnits].flat();
  }
  if (op === 'back') {
    const rest = units.filter((u) => !isSel(u));
    const selUnits = units.filter(isSel);
    return [...selUnits, ...rest].flat();
  }
  const arr = [...units];
  if (op === 'forward') {
    for (let i = arr.length - 2; i >= 0; i--) {
      const cur = arr[i];
      const above = arr[i + 1];
      if (cur && above && isSel(cur) && !isSel(above)) {
        arr[i] = above;
        arr[i + 1] = cur;
      }
    }
  } else {
    // backward
    for (let i = 1; i < arr.length; i++) {
      const cur = arr[i];
      const below = arr[i - 1];
      if (cur && below && isSel(cur) && !isSel(below)) {
        arr[i] = below;
        arr[i - 1] = cur;
      }
    }
  }
  return arr.flat();
}
