/**
 * @file       annotations/board-io.ts — headless board file I/O (DDR-242)
 * @scope      apps/studio/annotations/board-io.ts
 * @purpose    How the headless verbs (`maude design read-annotations` /
 *             `annotate` / `import-figma`) read and write a canvas's
 *             `<slug>.annotations.json` without a dev server. Mirrors the
 *             server's strict read (api.ts `readBoard`): an oversized or
 *             unreadable file is REPORTED, never treated as an empty board —
 *             a write over it would erase whatever it holds (code review H2).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { canonicalAnnotations } from './board-text.ts';
import { MAX_BOARD_BYTES } from './constants.ts';
import { parseBoard } from './schema.ts';
import type { AnnotationElement } from './types.ts';

export interface BoardFile {
  /** The file on disk is over MAX_BOARD_BYTES — it was NOT read or parsed. */
  tooLarge?: boolean;
  /** The file exists but is not a readable board — it must not be written over. */
  unreadable?: boolean;
  /** The board as canonical text ('' when the canvas has no annotations yet). */
  boardText: string;
  elements: AnnotationElement[];
}

export function boardPath(designRoot: string, slug: string): string {
  return join(designRoot, `${slug}.annotations.json`);
}

/** Read `<slug>.annotations.json`, falling back to a not-yet-migrated `.svg`. */
export function readBoardFile(designRoot: string, slug: string): BoardFile {
  const json = boardPath(designRoot, slug);
  const legacy = join(designRoot, `${slug}.annotations.svg`);
  const path = existsSync(json) ? json : existsSync(legacy) ? legacy : null;
  if (!path) return { boardText: '', elements: [] };
  // A peer- or git-written file is untrusted (DDR-054): check the size BEFORE
  // reading it, so an oversized board never reaches a parser.
  if (statSync(path).size > MAX_BOARD_BYTES) return { tooLarge: true, boardText: '', elements: [] };
  let clean: string | null = null;
  try {
    clean = canonicalAnnotations(readFileSync(path, 'utf8'));
  } catch {
    clean = null;
  }
  if (clean === null) return { unreadable: true, boardText: '', elements: [] };
  return { boardText: clean, elements: parseBoard(clean).elements };
}

/**
 * Write board text atomically: a temp file under the (runtime-ignored)
 * `_state/` directory, then one rename — a reader never sees half a board.
 */
export function writeBoardFileAtomic(designRoot: string, slug: string, text: string): string {
  const target = boardPath(designRoot, slug);
  const scratch = join(designRoot, '_state');
  mkdirSync(scratch, { recursive: true });
  const tmp = join(scratch, `annotations-${process.pid}-${Date.now().toString(36)}.tmp`);
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, target);
  } finally {
    rmSync(tmp, { force: true });
  }
  return target;
}
