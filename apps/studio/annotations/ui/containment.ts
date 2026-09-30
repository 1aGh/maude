/**
 * @file       annotations/ui/containment.ts — what an operation on a selection acts on
 * @scope      apps/studio/annotations/ui/containment.ts
 * @purpose    DDR-242 AD8 (Task 20). Containment is explicit — an element's
 *             `parent` — so every operation on a section acts on its SUBTREE:
 *             move, nudge, align, distribute, delete, copy, duplicate. One
 *             expansion (groups, then section contents, to a fixpoint) instead
 *             of each call site deciding for itself — the source of the
 *             "section moved without its contents" bugs (characterization
 *             test, known bugs).
 *
 *             Pure and React-free. It works on the element board (`parent`),
 *             so a nested section's contents come along with it.
 */

import { Scene } from '../scene.ts';
import type { AnnotationElement } from '../types.ts';

export class Containment {
  private readonly scene: Scene;
  constructor(board: Iterable<AnnotationElement>) {
    this.scene = new Scene(board);
  }

  /** Everything inside `id`, nested containers included (not `id` itself). */
  contentsOf(id: string): string[] {
    return this.scene.descendants(id).map((e) => e.id);
  }

  /** `ids` plus the full subtree of every container among them. */
  withContents(ids: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const id of ids) {
      out.add(id);
      for (const d of this.contentsOf(id)) out.add(d);
    }
    return out;
  }

  /** `ids` without those whose ancestor is also in `ids` (they ride along with it). */
  roots(ids: Iterable<string>): string[] {
    const set = new Set(ids);
    return [...set].filter((id) => !this.scene.ancestors(id).some((a) => set.has(a)));
  }

  /** The container an element is drawn in, or null at top level. */
  parentOf(id: string): string | null {
    const el = this.scene.get(id);
    return el ? this.scene.effectiveParent(el) : null;
  }

  /** Deepest container whose box holds the world point (the one a new section nests into). */
  containerAt(wx: number, wy: number, exclude?: ReadonlySet<string>): string | null {
    return this.scene.containerAt(wx, wy, exclude)?.id ?? null;
  }
}

/**
 * Selection → the ids an operation acts on: groups expanded, then every
 * selected container's subtree, repeated until nothing new joins (a group
 * member inside a section, a section inside a group).
 */
export function expandForOp(
  ids: readonly string[],
  expandGroups: (ids: readonly string[]) => readonly string[],
  containment: Containment
): string[] {
  let cur = new Set(ids);
  for (let i = 0; i < 8; i++) {
    const next = containment.withContents(expandGroups([...cur]));
    if (next.size === cur.size) return [...next];
    cur = next;
  }
  return [...cur];
}

export interface MarqueeItem {
  id: string;
  box: { x: number; y: number; w: number; h: number };
  container: boolean;
}

/**
 * What a marquee selects. Elements are taken by TOUCH; a container only when
 * the marquee ENCLOSES it — so a marquee drawn over a section's contents
 * selects the contents, never the section around them (FigJam).
 */
export function marqueeHits(
  items: readonly MarqueeItem[],
  rect: { x1: number; y1: number; x2: number; y2: number }
): string[] {
  const xMin = Math.min(rect.x1, rect.x2);
  const xMax = Math.max(rect.x1, rect.x2);
  const yMin = Math.min(rect.y1, rect.y2);
  const yMax = Math.max(rect.y1, rect.y2);
  const hits: string[] = [];
  for (const { id, box: b, container } of items) {
    const hit = container
      ? b.x >= xMin && b.x + b.w <= xMax && b.y >= yMin && b.y + b.h <= yMax
      : b.x + b.w >= xMin && b.x <= xMax && b.y + b.h >= yMin && b.y <= yMax;
    if (hit) hits.push(id);
  }
  return hits;
}

/**
 * Where a new section goes in paint order: right ABOVE the section it is
 * drawn inside (so it renders in front of it and adopts what sits on it), or
 * at the very back at top level (a container under everything on it).
 */
export function insertSection<T extends { id: string }>(
  list: readonly T[],
  section: T,
  outerId: string | null
): T[] {
  const at = outerId ? list.findIndex((x) => x.id === outerId) : -1;
  return at >= 0 ? [...list.slice(0, at + 1), section, ...list.slice(at + 1)] : [section, ...list];
}
