/**
 * @file       annotations/ui/board.ts — the canvas's element board (Task 26)
 * @scope      apps/studio/annotations/ui/board.ts
 * @purpose    DDR-242 AD8: the whiteboard UI works on v2 elements directly.
 *             One store per canvas holds the board as last applied (the
 *             server's state plus this tab's optimistic ops) and, during a
 *             gesture, a PREVIEW overlay (the dragged / resized records) that
 *             never reaches storage until the gesture commits as one op batch.
 *
 *             React-free; the layer reads it through `useSyncExternalStore`
 *             (`version` changes on every change). `scene()` is the world-space
 *             view (parents, world boxes, arrow endpoints), cached per version.
 */

import { type ApplyResult, applyOps, type Op } from '../ops.ts';
import { Scene } from '../scene.ts';
import type { AnnotationElement } from '../types.ts';

export class BoardStore {
  private base = new Map<string, AnnotationElement>();
  private overlay: Map<string, AnnotationElement | null> | null = null;
  private merged: Map<string, AnnotationElement> | null = null;
  private sceneCache: { version: number; scene: Scene } | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    this.merged = null;
    for (const l of [...this.listeners]) l();
  }

  /** The board as the UI shows it: base plus any gesture preview. */
  get elements(): ReadonlyMap<string, AnnotationElement> {
    if (!this.overlay) return this.base;
    if (!this.merged) {
      const m = new Map(this.base);
      for (const [id, el] of this.overlay) {
        if (el) m.set(id, el);
        else m.delete(id);
      }
      this.merged = m;
    }
    return this.merged;
  }

  /** The board without the preview — what the next commit diffs against. */
  get committed(): ReadonlyMap<string, AnnotationElement> {
    return this.base;
  }

  get(id: string): AnnotationElement | undefined {
    return this.elements.get(id);
  }

  scene(): Scene {
    if (this.sceneCache?.version !== this.version) {
      this.sceneCache = { version: this.version, scene: new Scene(this.elements.values()) };
    }
    return this.sceneCache.scene;
  }

  /** Replace the board (load, a peer's change). Unchanged records keep their identity. */
  setAll(elements: Iterable<AnnotationElement>): void {
    const next = new Map<string, AnnotationElement>();
    for (const el of elements) {
      const prev = this.base.get(el.id);
      next.set(el.id, prev && sameRecord(prev, el) ? prev : el);
    }
    if (next.size === this.base.size && [...next].every(([id, el]) => this.base.get(id) === el))
      return;
    this.base = next;
    this.changed();
  }

  /** Apply an op batch locally (optimistic). Returns what applied and its inverse. */
  apply(ops: readonly Op[]): ApplyResult {
    const r = applyOps(this.base, ops);
    if (r.touched.size) {
      this.base = r.state;
      this.changed();
    }
    return r;
  }

  /** Show `records` in place of their stored versions (null hides one) — a gesture in flight. */
  preview(records: ReadonlyMap<string, AnnotationElement | null>): void {
    this.overlay = new Map(records);
    this.changed();
  }

  clearPreview(): void {
    if (!this.overlay) return;
    this.overlay = null;
    this.changed();
  }

  get previewing(): boolean {
    return this.overlay !== null;
  }
}

function sameRecord(a: AnnotationElement, b: AnnotationElement): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k];
    const y = b[k];
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object' || JSON.stringify(x) !== JSON.stringify(y)) {
      return false;
    }
  }
  return true;
}
