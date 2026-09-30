/**
 * @file       annotations/schema.ts — the annotations-v2 board: validate, parse, serialize
 * @scope      apps/studio/annotations/schema.ts
 * @purpose    DDR-242 §2–§3. A board is `{"format":"maude.annotations","v":2,
 *             "elements":[…]}` written with ONE element per line in a
 *             deterministic order, so the same board is the same bytes on every
 *             machine and a git diff shows exactly which element changed.
 *
 *             Validation is TOTAL and per element: a bad element is dropped and
 *             reported, never the whole board (the DDR-223 lesson — emptiness
 *             must never be manufactured from a parse problem). Board-level
 *             rules: unique ids, a valid `index` (repaired, not dropped), no
 *             parent cycles, nesting depth ≤ MAX_NESTING_DEPTH, element and byte
 *             caps.
 */

import { MAX_BOARD_BYTES, MAX_ELEMENTS, MAX_NESTING_DEPTH } from './constants.ts';
import { parseJsonSafe } from './fields.ts';
import { compareOrder, isValidOrderKey, keyBetween } from './fractional-index.ts';
import { defOf, validateElement } from './registry.ts';
import type { AnnotationElement } from './types.ts';

export const BOARD_FORMAT = 'maude.annotations';
export const BOARD_VERSION = 2;

export interface Dropped {
  id?: string;
  reason: string;
}

export interface BoardResult {
  elements: AnnotationElement[];
  dropped: Dropped[];
}

/** Sort key: depth first, then parent, then (index, id) — parents always precede children. */
function canonicalOrder(elements: readonly AnnotationElement[]): AnnotationElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const depth = (e: AnnotationElement): number => {
    let d = 0;
    let cur = e.parent;
    while (cur !== undefined && d <= MAX_NESTING_DEPTH) {
      d++;
      cur = byId.get(cur)?.parent;
    }
    return d;
  };
  const depths = new Map(elements.map((e) => [e.id, depth(e)]));
  return [...elements].sort((a, b) => {
    const da = depths.get(a.id) as number;
    const db = depths.get(b.id) as number;
    if (da !== db) return da - db;
    const pa = a.parent ?? '';
    const pb = b.parent ?? '';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return compareOrder(a, b);
  });
}

/**
 * Validate an untrusted element list into canonical records.
 *  - invalid records are dropped + reported;
 *  - a duplicate id keeps the FIRST occurrence;
 *  - an invalid `index` is repaired (appended after its siblings) — a z-order
 *    glitch is never a reason to lose content;
 *  - a `parent` that is missing, not a container, cyclic or too deep is cleared
 *    (the element is kept at top level, its coordinates unchanged — the caller
 *    of a live edit never produces that; this only guards hostile/stale input).
 */
export function validateElements(raw: readonly unknown[]): BoardResult {
  const dropped: Dropped[] = [];
  const out: AnnotationElement[] = [];
  const seen = new Set<string>();
  const needsIndex: Record<string, unknown>[] = [];
  for (const item of raw.slice(0, MAX_ELEMENTS)) {
    let candidate = item;
    // Repair a bad index before validation so the element survives it.
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const idx = (candidate as Record<string, unknown>).index;
      if (typeof idx !== 'string' || !isValidOrderKey(idx)) {
        candidate = { ...(candidate as Record<string, unknown>), index: 'a0' };
        needsIndex.push(candidate as Record<string, unknown>);
      }
    }
    const r = validateElement(candidate);
    if (!r.ok) {
      dropped.push({ id: r.id, reason: r.reason });
      continue;
    }
    if (seen.has(r.el.id)) {
      dropped.push({ id: r.el.id, reason: 'duplicate id' });
      continue;
    }
    seen.add(r.el.id);
    out.push(r.el);
  }
  if (raw.length > MAX_ELEMENTS) {
    dropped.push({
      reason: `board exceeds ${MAX_ELEMENTS} elements; ${raw.length - MAX_ELEMENTS} dropped`,
    });
  }
  const byId = new Map(out.map((e) => [e.id, e]));
  // Parent sanity: missing / non-container / cycle / too deep → top level.
  for (const el of out) {
    if (el.parent === undefined) continue;
    const seenChain = new Set<string>([el.id]);
    let cur: string | undefined = el.parent;
    let depth = 0;
    let ok = true;
    while (cur !== undefined) {
      const p = byId.get(cur);
      if (
        !p ||
        seenChain.has(cur) ||
        !defOf(p.type)?.caps.container ||
        ++depth > MAX_NESTING_DEPTH
      ) {
        ok = false;
        break;
      }
      seenChain.add(cur);
      cur = p.parent;
    }
    if (!ok) {
      delete el.parent;
      dropped.push({ id: el.id, reason: 'invalid parent cleared (kept at top level)' });
    }
  }
  // Index repair: append after the siblings' current maximum, in input order.
  const repaired = new Set(needsIndex.map((c) => c.id));
  for (const el of out) {
    if (!repaired.has(el.id)) continue;
    let max: string | null = null;
    for (const s of out) {
      if (s === el || repaired.has(s.id) || s.parent !== el.parent) continue;
      if (max === null || s.index > max) max = s.index;
    }
    el.index = keyBetween(max, null);
    repaired.delete(el.id);
  }
  return { elements: canonicalOrder(out), dropped };
}

/** Parse a board file (untrusted text). A malformed file yields zero elements + a report. */
export function parseBoard(text: string): BoardResult {
  if (text.length > MAX_BOARD_BYTES) {
    return { elements: [], dropped: [{ reason: 'board file exceeds the byte cap' }] };
  }
  const doc = parseJsonSafe(text);
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { elements: [], dropped: [{ reason: 'not a board document' }] };
  }
  const d = doc as Record<string, unknown>;
  if (d.format !== BOARD_FORMAT || typeof d.v !== 'number') {
    return { elements: [], dropped: [{ reason: 'unknown board format' }] };
  }
  if (d.v > BOARD_VERSION) {
    return {
      elements: [],
      dropped: [{ reason: `board format v${d.v} is newer than this client` }],
    };
  }
  return validateElements(Array.isArray(d.elements) ? d.elements : []);
}

/**
 * Canonical bytes. Records are already canonical (spec key order, defaults
 * omitted); this fixes the element order and the one-element-per-line layout.
 */
export function serializeBoard(elements: readonly AnnotationElement[]): string {
  const ordered = canonicalOrder(elements);
  if (ordered.length === 0) {
    return `{"format":"${BOARD_FORMAT}","v":${BOARD_VERSION},"elements":[]}\n`;
  }
  const lines = ordered.map((e) => JSON.stringify(e));
  return `{"format":"${BOARD_FORMAT}","v":${BOARD_VERSION},"elements":[\n${lines.join(',\n')}\n]}\n`;
}

export function isEmptyBoard(elements: readonly unknown[]): boolean {
  return elements.length === 0;
}

/** Canonical form of one record (re-validated). Throws only on programmer error. */
export function canonical(el: Record<string, unknown>): AnnotationElement {
  const r = validateElement(el);
  if (!r.ok) throw new Error(`invalid element ${String(el.id)}: ${r.reason}`);
  return r.el;
}
