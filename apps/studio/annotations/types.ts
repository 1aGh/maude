/**
 * @file       annotations/types.ts — the annotations-v2 element contract (DDR-242)
 * @scope      apps/studio/annotations/types.ts
 * @purpose    Type-only module: the element record, the per-type definition
 *             interface every registry entry implements, and the geometry
 *             context a definition computes against. React-free, DOM-free.
 */

import type { FieldSpecMap } from './fields.ts';

/**
 * A canonical element record. Always carries `id`, `type` and `index`; `parent`
 * names a container (a section) and makes `x`/`y` (and pen points / free arrow
 * points) RELATIVE to that container's origin. Every other key is type-specific
 * and default-valued keys are omitted.
 */
export interface AnnotationElement {
  id: string;
  type: string;
  parent?: string;
  index: string;
  [field: string]: unknown;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Arrow end: bound to an element (auto-facing, or pinned to a magnet) or free. */
export type ArrowEnd = { el: string; nx?: number; ny?: number } | { x: number; y: number };

export interface ElementCaps {
  /** Carries x/y/w/h (a card / shape / container). */
  box: boolean;
  rotatable: boolean;
  resizable: boolean;
  /** An arrow end can bind to it. */
  bindable: boolean;
  /** Other elements can have it as `parent` (sections). */
  container: boolean;
  /** Where its editable text lives: `text` field, `label` record, `label` string (section title), or none. */
  textSlot: 'text' | 'label' | 'title' | null;
  /** Resize keeps the aspect ratio (stickies are 1:1 at creation, not at resize). */
  aspectLock?: boolean;
}

/**
 * The world an element's geometry is computed in. Coordinates passed to and
 * returned from an `ElementDef` are in the element's PARENT space; `resolve`
 * gives another element's WORLD box + rotation (arrows need their hosts').
 */
export interface GeomCtx {
  /** World-space origin of the element's parent (0,0 at top level). */
  origin: { x: number; y: number };
  /** World-space unrotated box + rotation of any element, or null when missing / box-less. */
  resolve(id: string): { box: Box; rot: number; bindable: boolean } | null;
}

export interface ElementDef {
  type: string;
  /** Type-specific fields, in canonical key order. */
  fields: FieldSpecMap;
  caps: ElementCaps;
  /** Unrotated bounds in PARENT space, or null when degenerate. */
  bounds(el: AnnotationElement, ctx: GeomCtx): Box | null;
  /** Hit-test a point given in PARENT space. */
  hitTest(el: AnnotationElement, px: number, py: number, tol: number, ctx: GeomCtx): boolean;
  /** Field patch moving the element by (dx, dy) in parent space. */
  translate(el: AnnotationElement, dx: number, dy: number): Record<string, unknown>;
  /** Field patch fitting the element to `box` (parent space, normalized). */
  resize(el: AnnotationElement, box: Box, ctx: GeomCtx): Record<string, unknown>;
  /** False when the element is too small / empty to keep (a mis-tap). */
  meaningful(el: AnnotationElement): boolean;
}
