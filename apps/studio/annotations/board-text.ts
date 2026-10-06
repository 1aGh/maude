/**
 * @file       annotations/board-text.ts — canonical board text from any stored form
 * @scope      apps/studio/annotations/board-text.ts
 * @purpose    DDR-242: the annotations LANE value everywhere (file, sync lane,
 *             hub store) is the canonical board text. This is the one entry
 *             point that turns whatever arrives — board JSON, a legacy
 *             `.annotations.svg`, or nothing — into that text.
 */

import { MAX_LEGACY_SVG_BYTES } from './constants.ts';
import { migrateSvg } from './migrate-v1.ts';
import { parseBoard, serializeBoard } from './schema.ts';

/**
 * Canonical board text for `text`: '' → empty board; legacy SVG → migrated;
 * board JSON → re-validated + canonical. null when it is neither (callers must
 * refuse the write, never treat it as emptiness — DDR-223).
 */
/**
 * The annotations LANE value (accepted revisions, DDR-241): canonical board
 * text, except that an EMPTY board is `''` — the lane's "no value". Studio and
 * kernel must agree byte for byte, because the lane hash is a proposal's base.
 */
export function annotationsLaneValue(text: string): string | null {
  const c = canonicalAnnotations(text);
  if (c === null) return null;
  return parseBoard(c).elements.length === 0 ? '' : c;
}

export function canonicalAnnotations(text: string): string | null {
  if (text.trim() === '') return serializeBoard([]);
  // Only an SVG document takes the legacy branch. Any other markup is NOT a
  // board — returning an empty board for it would let one malformed write
  // erase a board with content (the DDR-223 failure shape).
  if (/^\s*<svg[\s>]/i.test(text)) {
    // v1 boards were capped at 1 MB; anything far larger is not a real legacy
    // board and is refused before it reaches a parser.
    if (text.length > MAX_LEGACY_SVG_BYTES) return null;
    return serializeBoard(migrateSvg(text).elements);
  }
  if (/^\s*</.test(text)) return null;
  const parsed = parseBoard(text);
  if (parsed.elements.length === 0 && parsed.dropped.some((d) => d.id === undefined)) return null;
  return serializeBoard(parsed.elements);
}
