/**
 * @file       figma/comments-to-pins.ts — Figma design comments → comment pins (S8.17b).
 * @scope      apps/studio/figma/comments-to-pins.ts
 * @purpose    Bring across the notes a designer left on a design file as what they are: comment
 *             threads, pinned where Figma pinned them, with their replies and their resolved state.
 *
 * @rationale  Michal 2026-10-21 (`v2-michal-figma-comments-as-pins`): a design file's comments arrive
 *             as comment pins, not stickies (CONTRACT §-import). A pin is a thread — it can be
 *             replied to and resolved, shows in Edit mode, and lists in the Comments panel. The
 *             sticky route (`comments-to-strokes.ts`) stays for FigJam boards, where the comments
 *             are part of the whiteboard.
 *
 * @invariant  A COMMENT IS DATA (DDR-216 D1/D6a, as in `comments-to-strokes.ts`). The message and the
 *             author's name are third-party text: `cleanText` / `cleanImportedName`, never parsed,
 *             never reaching anything that could act on them.
 *
 * @invariant  THE FIGMA AUTHOR IS A LABEL, NOT A PERSON. `author` (the record's `by`) is the person
 *             who ran the import; the Figma writer rides in `importedFrom` on the thread and on each
 *             reply (`comments/imported-from.ts`). `mentions` is always empty and the mention parser
 *             skips imported text, so nothing in an imported thread can notify anyone.
 *
 * @invariant  RESOLVED THREADS ARE CARRIED (`status: 'resolved'`), and a comment whose pinned node is
 *             not on the page is reported to the caller as unplaced, never invented a position.
 */

import { randomBytes } from 'node:crypto';

import { type ImportedFrom, sanitizeImportedFrom } from '../comments/imported-from.ts';
import type { FigmaComment } from './client.ts';
import { cleanText, type ImportReport, identifierFromNodeId } from './sanitize.ts';
import type { FigmaNode } from './types.ts';

/** A thread is not an essay; the comment store's own bound (`comments/ops.ts MAX_TEXT`). */
const TEXT_CAP = 4000;
/** A pathological file should not paper the canvas over. */
export const MAX_COMMENT_PINS = 300;

/** The artboard id an imported Figma frame gets — the rule `to-render.ts` / `to-artboard.ts` use. */
export const artboardIdOf = (nodeId: string): string =>
  identifierFromNodeId(nodeId).toLowerCase().replace(/_/g, '-');

/** A stored comment record as the importer writes it (`api.ts Comment` plus the Maude 2 keys). */
export interface PinRecord {
  id: string;
  file: string;
  selector: string;
  dom_path: string[];
  tag: string;
  classes: string;
  bounds: null;
  html_excerpt: string;
  text: string;
  status: 'open' | 'resolved';
  created: string;
  resolved_at: string | null;
  author: string;
  thread: Array<{
    id: string;
    author: string;
    body: string;
    created: string;
    importedFrom: ImportedFrom;
  }>;
  mentions: string[];
  world: { x: number; y: number };
  artboard?: string;
  importedFrom: ImportedFrom;
}

export interface PinOptions {
  /** The `file` every record carries (`.design/ui/Foo.tsx`). */
  file: string;
  /** Who ran the import — the record's `author` (`by`). */
  importer: string;
  /** Import time, ISO. */
  now: string;
  /** The Figma node ids that became artboards on the canvas. */
  frameIds: readonly string[];
  /** The page node, so a pin pinned to the page itself reads as a canvas-level pin. */
  pageId?: string;
  newId?: () => string;
  newReplyId?: () => string;
}

export interface CommentPinsResult {
  records: PinRecord[];
  /** Thread ids this page placed. Raw Figma ids, matching `unplacedIds`. */
  placedIds: string[];
  /** Thread ids this page could not place (their node is not here). Per page that is normal. */
  unplacedIds: string[];
}

const defaultId = () => `c_${randomBytes(6).toString('hex')}`;
const defaultReplyId = () => `r_${randomBytes(6).toString('hex')}`;

/** The moment a Figma comment was written, as ISO, else `fallback`. */
function when(c: FigmaComment, fallback: string): string {
  const t = Date.parse(c.createdAt ?? '');
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

/** Every descendant id of `root` → `artboard`. */
function claim(root: FigmaNode, artboard: string, into: Map<string, string>): void {
  into.set(root.id, artboard);
  for (const c of root.children ?? []) claim(c, artboard, into);
}

/**
 * Turn a design file's comments into comment-pin records positioned over the page.
 *
 * World coordinates match the artboards (`to-render.ts`: node position minus the page origin): the
 * pin sits at its node's absolute position plus the comment's offset, normalised the same way. The
 * artboard is the imported frame the node lives in (absent for a loose node outside every frame).
 */
export function commentsToPins(
  comments: readonly FigmaComment[],
  nodes: ReadonlyMap<string, FigmaNode>,
  origin: { x: number; y: number },
  report: ImportReport,
  opts: PinOptions
): CommentPinsResult {
  const newId = opts.newId ?? defaultId;
  const newReplyId = opts.newReplyId ?? defaultReplyId;

  const artboardOfNode = new Map<string, string>();
  const frameBoxes: Array<{
    artboard: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];
  for (const id of opts.frameIds) {
    const frame = nodes.get(id);
    if (!frame) continue;
    const artboard = artboardIdOf(id);
    claim(frame, artboard, artboardOfNode);
    const bb = frame.absoluteBoundingBox;
    if (bb) frameBoxes.push({ artboard, x: bb.x, y: bb.y, w: bb.width, h: bb.height });
  }

  // Replies hang off their root pin; only roots get a pin.
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

  const records: PinRecord[] = [];
  const placedIds: string[] = [];
  const unplacedIds: string[] = [];

  for (const root of roots) {
    if (records.length >= MAX_COMMENT_PINS) {
      report.add(root.id, 'COMMENT', 'asset-cap-reached', `>${MAX_COMMENT_PINS} comments`);
      break;
    }

    // Where does this pin live? Inside a node on this page, or — for a canvas-level pin — at page
    // coordinates directly.
    let ax: number;
    let ay: number;
    let artboard: string | undefined;
    if (root.nodeId && root.nodeId !== opts.pageId) {
      const bb = nodes.get(root.nodeId)?.absoluteBoundingBox;
      if (!bb) {
        unplacedIds.push(root.id);
        continue;
      }
      ax = bb.x + (root.x ?? 0);
      ay = bb.y + (root.y ?? 0);
      artboard = artboardOfNode.get(root.nodeId);
    } else if (root.x !== undefined && root.y !== undefined) {
      ax = root.x;
      ay = root.y;
      artboard = frameBoxes.find(
        (f) => ax >= f.x && ax <= f.x + f.w && ay >= f.y && ay <= f.y + f.h
      )?.artboard;
    } else {
      unplacedIds.push(root.id);
      continue;
    }

    const clean = cleanText(root.message, TEXT_CAP);
    if (clean.strippedHidden) report.add(root.id, 'COMMENT', 'hidden-chars-dropped');
    if (clean.truncated) report.add(root.id, 'COMMENT', 'truncated-text');
    if (!clean.text.trim()) continue;

    const created = when(root, opts.now);
    const thread: PinRecord['thread'] = [];
    const ordered = [...(repliesByParent.get(root.id) ?? [])].sort((a, b) =>
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    );
    for (const r of ordered) {
      const body = cleanText(r.message, TEXT_CAP);
      if (body.strippedHidden) report.add(r.id, 'COMMENT', 'hidden-chars-dropped');
      if (body.truncated) report.add(r.id, 'COMMENT', 'truncated-text');
      if (!body.text.trim()) continue;
      const at = when(r, opts.now);
      thread.push({
        id: newReplyId(),
        author: opts.importer,
        body: body.text,
        created: at,
        importedFrom: importedFrom(r, at),
      });
    }

    records.push({
      id: newId(),
      file: opts.file,
      selector: '',
      dom_path: [],
      tag: '',
      classes: '',
      bounds: null,
      html_excerpt: '',
      text: clean.text,
      status: root.resolved ? 'resolved' : 'open',
      created,
      resolved_at: root.resolved ? opts.now : null,
      author: opts.importer,
      thread,
      mentions: [],
      world: { x: Math.round(ax - origin.x), y: Math.round(ay - origin.y) },
      ...(artboard ? { artboard } : {}),
      importedFrom: importedFrom(root, created),
    });
    placedIds.push(root.id);
    report.add(root.id, 'COMMENT', 'imported', root.resolved ? 'resolved' : 'open');
  }

  return { records, placedIds, unplacedIds };
}

/** The label a Figma writer rides under. The name is untrusted: it goes through the one sanitizer. */
function importedFrom(c: FigmaComment, at: string): ImportedFrom {
  return sanitizeImportedFrom({
    source: 'figma',
    author: { name: c.author },
    at,
  }) as ImportedFrom;
}
