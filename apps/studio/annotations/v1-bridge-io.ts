/**
 * @file       annotations/v1-bridge-io.ts — board file I/O for the v1-era headless verbs
 * @scope      apps/studio/annotations/v1-bridge-io.ts
 * @purpose    v2-adapter: removed in Task 27 (the verbs move onto the registry).
 *
 *             `maude design annotate` / `read-annotations` still think in v1
 *             strokes / SVG. Until Task 27 rewrites them, they read and write
 *             the DDR-242 board through this bridge, so an agent's write lands
 *             in `.annotations.json` (never a stale `.annotations.svg` the boot
 *             migration would quarantine) and preserves what v1 can't express
 *             (parents of untouched elements, unknown element types).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { strokesToSvg } from '../annotations-model.ts';
import { canonicalAnnotations } from './board-text.ts';
import { MAX_BOARD_BYTES } from './constants.ts';
import { parseLegacySvg } from './migrate-v1.ts';
import { parseBoard, serializeBoard } from './schema.ts';
import type { AnnotationElement } from './types.ts';
import { elementsToStrokes, strokesToElements } from './v1-adapter.ts';

export interface BoardFile {
  /** The file on disk is over MAX_BOARD_BYTES — it was NOT read or parsed. */
  tooLarge?: boolean;
  /** The file exists but is not a readable board — it must not be written over. */
  unreadable?: boolean;
  /** The board as canonical text ('' when the canvas has no annotations yet). */
  boardText: string;
  elements: AnnotationElement[];
  /** The same board rendered as v1 SVG — what the v1-era verbs parse. */
  svg: string;
}

/** Read `<slug>.annotations.json`, falling back to a not-yet-migrated `.svg`. */
export function readBoardFile(designRoot: string, slug: string): BoardFile {
  const json = `${designRoot}/${slug}.annotations.json`;
  const legacy = `${designRoot}/${slug}.annotations.svg`;
  let text = '';
  const path = existsSync(json) ? json : existsSync(legacy) ? legacy : null;
  // A peer- or git-written file is untrusted (DDR-054): check the size BEFORE
  // reading it, so an oversized board never reaches a parser.
  if (path && statSync(path).size > MAX_BOARD_BYTES) {
    return { tooLarge: true, boardText: '', elements: [], svg: '' };
  }
  if (path) {
    // A file that exists but isn't a board is NOT an empty board — writing
    // over it would erase whatever it holds (code review H2).
    let clean: string | null = null;
    try {
      clean = canonicalAnnotations(readFileSync(path, 'utf8'));
    } catch {
      clean = null;
    }
    if (clean === null) return { unreadable: true, boardText: '', elements: [], svg: '' };
    text = clean;
  }
  const elements = text ? parseBoard(text).elements : [];
  return { boardText: text, elements, svg: strokesToSvg(elementsToStrokes(elements)) };
}

/** A v1 SVG produced by a v1-era verb → the board text to write, reconciled with `current`. */
export function boardFromV1Svg(svg: string, current: readonly AnnotationElement[]): string {
  const strokes = parseLegacySvg(svg);
  return serializeBoard(strokesToElements(strokes, new Map(current.map((e) => [e.id, e]))));
}
