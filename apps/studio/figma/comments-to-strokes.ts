/**
 * @file       figma/comments-to-strokes.ts — Figma review comments → annotations.
 * @scope      apps/studio/figma/comments-to-strokes.ts
 * @purpose    Bring across the notes a designer actually left on a file.
 *
 * @rationale  Figma comments live on `/v1/files/:key/comments`, NOWHERE in the
 *             document tree. An importer that walks the tree — which is every
 *             version of this one until now — therefore misses every single
 *             one. The live StudyFi file carries 133 of them ("Chybí", "A/b
 *             test", "redirect do nastaveni…"): the actual review record, the
 *             part a handoff is FOR, imported as zero.
 *
 * @invariant  A COMMENT IS DATA. The message is third-party free text: it goes
 *             through `cleanText`'s zero-glyph strip and length bound like every
 *             other imported string, is never parsed, and never reaches anything
 *             that could act on it (DDR-216 D1/D6a).
 *
 * @invariant  RESOLVED THREADS ARE CARRIED, NOT DROPPED. A resolved comment is
 *             the record of a decision already made; discarding it silently is
 *             the same content loss this importer keeps relearning. They arrive
 *             on grey paper instead of yellow.
 */

import {
  DEFAULT_STICKY_COLOR,
  STICKY_PALETTE,
  type StickyStroke,
  type Stroke,
} from '../annotations-model.ts';
import type { FigmaComment } from './client.ts';
import { cleanText, type ImportReport } from './sanitize.ts';
import type { FigmaNode } from './types.ts';

/** Matches the sticky cap in `to-strokes.ts` — a thread is not an essay. */
const COMMENT_TEXT_CAP = 1200;
/** Paper size. Wide enough for a sentence, short enough not to bury the design. */
const CARD_W = 240;
const CARD_MIN_H = 120;
const CARD_MAX_H = 520;
const CARD_FONT = 13;
/** Rough wrap width in characters at `CARD_FONT` — height is estimated, not laid out. */
const CHARS_PER_LINE = 30;
const LINE_H = 18;
/** Grey paper for a settled thread; slot 0 (yellow) stays "still open". */
const RESOLVED_COLOR = STICKY_PALETTE[2];
/** A pathological file should not paper the canvas over. */
export const MAX_COMMENT_STROKES = 300;

export interface CommentStrokesResult {
  strokes: Stroke[];
  /** Thread ids this page placed. Raw Figma ids, matching `unplacedIds`. */
  placedIds: string[];
  /**
   * Thread ids this page could not place, because the node they name is not in
   * it. Per page that is NORMAL — a comment lives on exactly one page — so this
   * is deliberately not reported here. The caller intersects it across every
   * page; a thread unplaced EVERYWHERE is an orphan whose target was deleted
   * from the file, and only the caller can know that.
   */
  unplacedIds: string[];
}

/** The id of the sticky a comment thread becomes (so `--into` can name its author). */
export function commentStrokeId(commentId: string): string {
  return `figc_${commentId.replace(/[^0-9A-Za-z]+/g, '_')}`;
}

/** Index every node on a page by id, so a pin can find what it hangs off. */
export function indexNodes(root: FigmaNode): Map<string, FigmaNode> {
  const out = new Map<string, FigmaNode>();
  const walk = (n: FigmaNode): void => {
    out.set(n.id, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

/**
 * Turn a file's comments into sticky annotations positioned over the page.
 *
 * World coordinates match the artboards: the pin sits at its target node's
 * absolute position plus the comment's offset within that node, normalized to
 * the same page origin the canvas used.
 */
export function commentsToStrokes(
  comments: readonly FigmaComment[],
  nodes: ReadonlyMap<string, FigmaNode>,
  origin: { x: number; y: number },
  report: ImportReport,
  pageId?: string
): CommentStrokesResult {
  // Replies hang off their root pin; only roots get a card.
  const repliesByParent = new Map<string, FigmaComment[]>();
  const roots: FigmaComment[] = [];
  for (const c of comments) {
    if (c.parentId) {
      const list = repliesByParent.get(c.parentId);
      if (list) list.push(c);
      else repliesByParent.set(c.parentId, [c]);
    } else {
      roots.push(c);
    }
  }

  const strokes: Stroke[] = [];
  const placedIds: string[] = [];
  const unplacedIds: string[] = [];

  for (const root of roots) {
    if (strokes.length >= MAX_COMMENT_STROKES) {
      report.add(root.id, 'COMMENT', 'asset-cap-reached', `>${MAX_COMMENT_STROKES} comments`);
      break;
    }

    // Where does this pin live? Either inside a node on this page, or — for a
    // canvas-level pin — at page coordinates directly.
    let wx: number;
    let wy: number;
    if (root.nodeId && root.nodeId !== pageId) {
      const target = nodes.get(root.nodeId);
      const bb = target?.absoluteBoundingBox;
      if (!bb) {
        unplacedIds.push(root.id);
        continue;
      }
      wx = bb.x + (root.x ?? 0);
      wy = bb.y + (root.y ?? 0);
    } else if (root.x !== undefined && root.y !== undefined) {
      wx = root.x;
      wy = root.y;
    } else {
      unplacedIds.push(root.id);
      continue;
    }

    const body = composeThread(root, repliesByParent.get(root.id) ?? []);
    const clean = cleanText(body, COMMENT_TEXT_CAP);
    if (clean.strippedHidden) report.add(root.id, 'COMMENT', 'hidden-chars-dropped');
    if (clean.truncated) report.add(root.id, 'COMMENT', 'truncated-text');
    if (!clean.text.trim()) continue;

    const lines = clean.text
      .split('\n')
      .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CHARS_PER_LINE)), 0);
    const h = Math.min(CARD_MAX_H, Math.max(CARD_MIN_H, lines * LINE_H + 24));

    const card: StickyStroke = {
      id: commentStrokeId(root.id),
      tool: 'sticky',
      color: root.resolved ? RESOLVED_COLOR : DEFAULT_STICKY_COLOR,
      x: Math.round(wx - origin.x),
      y: Math.round(wy - origin.y),
      w: CARD_W,
      h: Math.round(h),
      text: clean.text,
      fontSize: CARD_FONT,
    };
    strokes.push(card);
    placedIds.push(root.id);
    report.add(root.id, 'COMMENT', 'imported', root.resolved ? 'resolved' : 'open');
  }

  return { strokes, placedIds, unplacedIds };
}

/**
 * One thread as one card's body. The author handle is provenance shown as text
 * — a display string, never an identifier anything acts on (D7).
 */
function composeThread(root: FigmaComment, replies: readonly FigmaComment[]): string {
  const head = root.resolved ? '✓ ' : '';
  const who = (c: FigmaComment) => (c.author ? `${c.author}: ` : '');
  const parts = [`${head}${who(root)}${root.message}`];
  const ordered = [...replies].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  for (const r of ordered) parts.push(`↳ ${who(r)}${r.message}`);
  return parts.join('\n');
}
