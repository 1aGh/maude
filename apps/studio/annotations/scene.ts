/**
 * @file       annotations/scene.ts — world-space view over a set of elements
 * @scope      apps/studio/annotations/scene.ts
 * @purpose    Elements store PARENT-relative geometry (DDR-242 §1). The scene
 *             turns that into world space: parent origins, world boxes, arrow
 *             endpoints, paint order (a container is followed by its subtree),
 *             subtree queries and top-most hit-testing. Pure and React-free —
 *             the canvas, the AI projection and the hub all use this one.
 */

import { MAX_NESTING_DEPTH } from './constants.ts';
import { arrowEnds, type ResolvedArrow } from './elements/arrow.model.ts';
import { textBindable } from './elements/text.model.ts';
import { compareOrder } from './fractional-index.ts';
import { defOf } from './registry.ts';
import type { AnnotationElement, Box, GeomCtx } from './types.ts';

const TOP = '\u0000top';

export class Scene {
  readonly byId: ReadonlyMap<string, AnnotationElement>;
  private readonly kids = new Map<string, AnnotationElement[]>();
  private readonly originCache = new Map<string, { x: number; y: number }>();

  constructor(elements: Iterable<AnnotationElement>) {
    const byId = new Map<string, AnnotationElement>();
    for (const el of elements) byId.set(el.id, el);
    this.byId = byId;
    for (const el of byId.values()) {
      const p = this.effectiveParent(el);
      const key = p ?? TOP;
      const list = this.kids.get(key);
      if (list) list.push(el);
      else this.kids.set(key, [el]);
    }
    for (const list of this.kids.values()) list.sort(compareOrder);
  }

  get(id: string): AnnotationElement | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * The parent an element is actually drawn under: its `parent` when that names
   * an existing CONTAINER reachable without a cycle, else top level. A dangling
   * parent (deleted concurrently) degrades to top level — never to a lost node.
   */
  effectiveParent(el: AnnotationElement): string | null {
    const seen = new Set<string>([el.id]);
    let cur = el.parent;
    let depth = 0;
    let first: string | null = null;
    while (cur !== undefined) {
      const p = this.byId.get(cur);
      if (!p || seen.has(cur) || !defOf(p.type)?.caps.container || depth >= MAX_NESTING_DEPTH) {
        return null;
      }
      if (first === null) first = cur;
      seen.add(cur);
      cur = p.parent;
      depth++;
    }
    return first;
  }

  /** Children of `parent` (null = top level) in paint order. */
  childrenOf(parent: string | null): readonly AnnotationElement[] {
    return this.kids.get(parent ?? TOP) ?? [];
  }

  /** Every element in paint order: siblings by (index, id), a container before its subtree. */
  paintOrder(): AnnotationElement[] {
    const out: AnnotationElement[] = [];
    const walk = (parent: string | null) => {
      for (const el of this.childrenOf(parent)) {
        out.push(el);
        if (defOf(el.type)?.caps.container) walk(el.id);
      }
    };
    walk(null);
    return out;
  }

  /** All descendants of `id` (not including it), in paint order. */
  descendants(id: string): AnnotationElement[] {
    const out: AnnotationElement[] = [];
    const walk = (parent: string) => {
      for (const el of this.childrenOf(parent)) {
        out.push(el);
        walk(el.id);
      }
    };
    walk(id);
    return out;
  }

  /** Ancestor ids, nearest first. */
  ancestors(id: string): string[] {
    const out: string[] = [];
    const el = this.byId.get(id);
    let cur = el ? this.effectiveParent(el) : null;
    while (cur) {
      out.push(cur);
      const p = this.byId.get(cur);
      cur = p ? this.effectiveParent(p) : null;
    }
    return out;
  }

  /** World origin of the element's parent (0,0 at top level). */
  originOf(el: AnnotationElement): { x: number; y: number } {
    const p = this.effectiveParent(el);
    if (!p) return { x: 0, y: 0 };
    const cached = this.originCache.get(p);
    if (cached) return cached;
    const parent = this.byId.get(p) as AnnotationElement;
    const po = this.originOf(parent);
    const o = {
      x: po.x + (typeof parent.x === 'number' ? parent.x : 0),
      y: po.y + (typeof parent.y === 'number' ? parent.y : 0),
    };
    this.originCache.set(p, o);
    return o;
  }

  ctx(el: AnnotationElement): GeomCtx {
    return { origin: this.originOf(el), resolve: (id) => this.resolve(id) };
  }

  private resolve(id: string): { box: Box; rot: number; bindable: boolean } | null {
    const el = this.byId.get(id);
    if (!el) return null;
    const def = defOf(el.type);
    if (!def?.caps.box) return null;
    const box = this.worldBox(el);
    if (!box) return null;
    let bindable = def.caps.bindable;
    if (el.type === 'text') bindable = textBindable(box.w, box.h);
    return { box, rot: typeof el.rot === 'number' ? el.rot : 0, bindable };
  }

  /** Unrotated world bounds, or null (unknown type without a box, degenerate arrow…). */
  worldBox(elOrId: AnnotationElement | string): Box | null {
    const el = typeof elOrId === 'string' ? this.byId.get(elOrId) : elOrId;
    if (!el) return null;
    const def = defOf(el.type);
    let local: Box | null;
    if (def) {
      // Arrows resolve their hosts in world space and return parent-space bounds.
      local = def.bounds(el, this.ctx(el));
    } else {
      const { x, y, w, h } = el as Record<string, unknown>;
      local =
        typeof x === 'number' &&
        typeof y === 'number' &&
        typeof w === 'number' &&
        typeof h === 'number'
          ? { x, y, w, h }
          : null;
    }
    if (!local) return null;
    const o = this.originOf(el);
    return { x: local.x + o.x, y: local.y + o.y, w: local.w, h: local.h };
  }

  /** World endpoints of an arrow. */
  arrowWorld(el: AnnotationElement): ResolvedArrow | null {
    if (el.type !== 'arrow') return null;
    const r = arrowEnds(el, this.ctx(el));
    if (!r) return null;
    const o = this.originOf(el);
    return { ...r, x1: r.x1 + o.x, y1: r.y1 + o.y, x2: r.x2 + o.x, y2: r.y2 + o.y };
  }

  /** Top-most element whose hit-test accepts the WORLD point, optionally filtered. */
  hitTest(
    wx: number,
    wy: number,
    tol: number,
    accept: (el: AnnotationElement) => boolean = () => true
  ): AnnotationElement | null {
    const order = this.paintOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const el = order[i] as AnnotationElement;
      if (!accept(el)) continue;
      const def = defOf(el.type);
      const o = this.originOf(el);
      if (def) {
        if (def.hitTest(el, wx - o.x, wy - o.y, tol, this.ctx(el))) return el;
      } else {
        const b = this.worldBox(el);
        if (
          b &&
          wx >= b.x - tol &&
          wx <= b.x + b.w + tol &&
          wy >= b.y - tol &&
          wy <= b.y + b.h + tol
        ) {
          return el;
        }
      }
    }
    return null;
  }

  /**
   * Deepest container whose world box contains the world point — the section an
   * element dropped at that point belongs to. `exclude` skips a subtree (the
   * dragged selection must not become its own parent).
   */
  containerAt(
    wx: number,
    wy: number,
    exclude: ReadonlySet<string> = new Set()
  ): AnnotationElement | null {
    let best: AnnotationElement | null = null;
    let bestDepth = -1;
    for (const el of this.byId.values()) {
      if (exclude.has(el.id) || !defOf(el.type)?.caps.container) continue;
      if (this.ancestors(el.id).some((a) => exclude.has(a))) continue;
      const b = this.worldBox(el);
      if (!b || wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h) continue;
      const depth = this.ancestors(el.id).length;
      if (depth > bestDepth) {
        best = el;
        bestDepth = depth;
      }
    }
    return best;
  }
}
