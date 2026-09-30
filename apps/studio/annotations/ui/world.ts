/**
 * @file       annotations/ui/world.ts — the board as the editing UI sees it
 * @scope      apps/studio/annotations/ui/world.ts
 * @purpose    DDR-242 AD8 (Task 26). The board is the element store
 *             (board.ts); elements keep PARENT-relative geometry. The editing
 *             tools work in world space, on the world-space `Stroke` view of
 *             each element. This projects the board into that view, per
 *             element and cached, so an unchanged element keeps its identity
 *             and its node skips re-rendering. Pure and React-free.
 */

import type { Stroke } from '../../annotations-model.ts';
import type { Scene } from '../scene.ts';
import type { AnnotationElement } from '../types.ts';
import { elementStrokes } from '../v1-adapter.ts';

export type StrokeCache = WeakMap<AnnotationElement, { key: string; strokes: Stroke[] }>;

/**
 * The board as world-space strokes, in paint order. An element whose record
 * and world placement are unchanged keeps its strokes' identity; a bound
 * arrow re-projects whenever its resolved ends move.
 */
export function projectStrokes(scene: Scene, cache: StrokeCache): Stroke[] {
  const out: Stroke[] = [];
  for (const el of scene.paintOrder()) {
    let key: string;
    if (el.type === 'arrow') {
      const r = scene.arrowWorld(el);
      key = r
        ? `${r.x1},${r.y1},${r.x2},${r.y2},${r.startAnchor?.el ?? ''},${r.endAnchor?.el ?? ''}`
        : '';
    } else {
      const o = scene.originOf(el);
      key = `${o.x},${o.y}`;
    }
    const hit = cache.get(el);
    if (hit && hit.key === key) {
      for (const s of hit.strokes) out.push(s);
      continue;
    }
    const strokes = elementStrokes(scene, el);
    cache.set(el, { key, strokes });
    for (const s of strokes) out.push(s);
  }
  return out;
}
