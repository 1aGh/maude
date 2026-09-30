// Test fixtures for annotations-v2 boards (DDR-242), built through the real
// API only: v2 elements go through `validateElements` + `serializeBoard`, and
// v1 content through `strokesToSvg` → `migrateSvg`. Never hand-write board
// bytes where canonical form matters.

import { migrateSvg } from '../../../annotations/migrate-v1.ts';
import { parseBoard, serializeBoard, validateElements } from '../../../annotations/schema.ts';
import type { AnnotationElement } from '../../../annotations/types.ts';
import { type Stroke, strokesToSvg } from '../../../annotations-model.ts';

/** A raw sticky record (validated by `elements` / `board`). */
export function sticky(
  id: string,
  text = '',
  opts: { x?: number; y?: number; index?: string } = {}
): Record<string, unknown> {
  return {
    id,
    type: 'sticky',
    index: opts.index ?? 'a0',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    w: 200,
    h: 200,
    text,
  };
}

/** A raw image card referencing a content-addressed asset. */
export function image(id: string, href: string, opts: { x?: number; index?: string } = {}) {
  return {
    id,
    type: 'image',
    index: opts.index ?? 'a0',
    x: opts.x ?? 0,
    y: 0,
    w: 160,
    h: 160,
    href,
  };
}

/** Validated canonical elements; throws if any raw record is dropped (a fixture bug). */
export function elements(...raw: Record<string, unknown>[]): AnnotationElement[] {
  const r = validateElements(raw);
  if (r.dropped.length) throw new Error(`fixture dropped: ${JSON.stringify(r.dropped)}`);
  return r.elements;
}

/** Canonical board text for the given raw records. */
export function board(...raw: Record<string, unknown>[]): string {
  return serializeBoard(elements(...raw));
}

/** Canonical empty board (`elements: []`). */
export const EMPTY_BOARD = serializeBoard([]);

/** Element ids of a board text, in canonical order. */
export function boardIds(text: string | null): string[] {
  return text === null ? [] : parseBoard(text).elements.map((e) => e.id);
}

/** A v1 sidecar (what `strokesToSvg` wrote) and the v2 board it migrates to. */
export function v1(strokes: readonly Stroke[]): { svg: string; board: string } {
  const svg = strokesToSvg(strokes);
  return { svg, board: serializeBoard(migrateSvg(svg).elements) };
}

/** A v1 sticky stroke. */
export function v1Sticky(id: string, text = '', x = 0): Stroke {
  return {
    id,
    tool: 'sticky',
    color: '#fce8a6',
    x,
    y: 0,
    w: 100,
    h: 100,
    text,
    fontSize: 14,
  } as Stroke;
}
