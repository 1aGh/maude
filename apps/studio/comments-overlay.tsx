/**
 * @file       comments-overlay.tsx — FigJam-style in-place comments overlay
 * @scope      apps/studio/comments-overlay.tsx
 * @purpose    Renders DS-styled comment pins (Phase 6 Task 2), the in-place
 *             composer bubble (Task 3), and the thread popover (Task 4)
 *             inside the canvas iframe. Sibling to `annotations-layer`, but
 *             NOT portaled into `.dc-world` — renders as a screen-coord
 *             `position: fixed` layer instead (DDR-034; see "Pin position
 *             math" below).
 *
 * Data flow (Phase 6 Task 2 — pins only; composer + thread land in Task 3/4):
 *   1. Shell (`client/app.jsx`) pushes `{ dgn: 'comments-set', comments }`
 *      into the iframe whenever its `commentsByFile[activePath]` changes.
 *   2. Overlay also fetches `/_comments?file=...` on mount as a self-heal —
 *      lets the overlay render even if the shell hasn't broadcast yet
 *      (race on first iframe load).
 *   3. Shell pushes `{ dgn: 'comment-focus', id }` when the user clicks a row
 *      in the comments panel — overlay highlights the matching pin.
 *   4. Overlay posts `{ dgn: 'comment-click', id }` back to the shell when
 *      the user clicks a pin — same channel the legacy `dgn-pin` overlay
 *      used; the shell already routes it to `setFocusedCommentId`.
 *
 * Filter respect — Phase 6 Task 2 default is "hide resolved". The shell will
 * gain a `comments-filter` channel in Task 6; until then the overlay always
 * hides resolved pins. Plan-aligned.
 *
 * Pin position math — see `resolveCommentTarget` below. Screen coords come
 * straight from `getBoundingClientRect()` on the live target; CSS zoom on the
 * world plane is already baked into that rect, so no zoom math is needed here.
 *
 * Target resolution + orphan cleanup — a canvas rewrite (`/design:edit`
 * regenerating JSX) renumbers `data-cd-id` (DDR-019's documented AST-position
 * trade-off), which can silently reanchor a comment to the wrong element or to
 * nothing. `resolveCommentTarget` tries the stored selector first, falls back
 * to a structural match via `resolveByDomPath` (dom-selection.ts) when the
 * direct hit is missing or looks like the wrong element (tag mismatch). A
 * comment whose target stays unresolvable past a short grace window is
 * DETACHED — kept, shown at its last known place, and marked — never deleted:
 * software deleting a comment is how #134/#136 lost every comment placed on a
 * sticky or on empty canvas, and how one peer's missing element deleted a
 * comment for everyone. Only a person deletes a comment. Comments on
 * annotations and on empty canvas anchor through `comment-anchor.ts`.
 *
 * Popup placement — `CommentComposer` / `CommentThread` pick a side
 * (left/right, above/below the anchor) that actually fits the viewport via
 * `placeNearPoint`, instead of always growing down-right (which used to clip
 * off-screen near the canvas edge).
 *
 * The legacy vanilla-JS `#dgn-pin-layer` injected by `inspect.ts` is hidden
 * on mount to avoid double-pins inside TSX canvases. The legacy layer still
 * renders for `.html` mocks where this React overlay never mounts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  annotationElement,
  isAnnotationId,
  isWorldPoint,
  type WorldPoint,
  worldToClient,
} from './comment-anchor.ts';
import { fromHeadline, fromWho } from './comments/from-line.ts';
import {
  type ImportedFrom,
  importedLabel,
  sanitizeImportedFrom,
} from './comments/imported-from.ts';
import { handleOfName } from './comments/mentions.ts';
import { committerRows, type MentionRow } from './comments/people.ts';
import { mmAtArtboardPx, trimOfPrint, videoPinVisible, whereOf } from './comments/where.ts';
import { resolveByDomPath } from './dom-selection.ts';
import { toneColor, toneFor } from './presence/tones.ts';
import { canCommentCanvas, isReadOnlyCanvas } from './read-only-mode.ts';
import { currentCanvasFile } from './shell-canvas-file.ts';
import { useCollab } from './use-collab.tsx';
import { useSelectionSetOptional } from './use-selection-set.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Types — kept in sync with `Comment` in `api.ts`. We mirror the shape rather
// than import to avoid pulling server types into the canvas runtime bundle.

interface OverlayBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Selection payload posted by canvas-shell's `onDropComment`. Mirrors the
// shape `hoverTargetToSelection` returns; we keep it loose so the overlay
// doesn't depend on canvas-shell types.
interface ComposeSelection {
  file?: string;
  id?: string;
  selector: string;
  artboardId?: string | null;
  /** Occurrence index within `selector` — always set by buildComposeSelection,
   *  read into the comment payload below. Missing from this local mirror of
   *  dom-selection's `Selection`, so the payload was silently sending
   *  `undefined` to the checker's eyes and the real value at runtime. */
  index: number;
  tag: string;
  classes: string;
  text: string;
  dom_path: string[];
  bounds: OverlayBounds | null;
  html: string;
  /** Set when the click landed on an annotation (comment-anchor.ts). */
  annotationId?: string;
  /** World point of the click, when the canvas has a world plane. */
  world?: WorldPoint;
}

interface ComposerState {
  selection: ComposeSelection;
  clientX: number;
  clientY: number;
  /** Where on the artboard it was placed — the video's moment, the point on paper (S9.22). */
  anchors?: { artboard?: string; t?: number; mm?: { x: number; y: number } };
}

interface OverlayReply {
  id: string;
  author: string;
  body: string;
  created: string;
  /** `ai` for an AI-written reply (S9.7b) — shown with an AI mark, never as a person. */
  authorKind?: 'ai';
  /** S8.17b — written in another tool (Figma): a label, never a member. `author` is the importer. */
  importedFrom?: ImportedFrom;
}

export interface OverlayComment {
  id: string;
  file: string;
  selector: string;
  /** Occurrence index among `querySelectorAll(selector)` — disambiguates a
   * component repeated within one artboard. Absent (old comments) → first. */
  index?: number;
  bounds: OverlayBounds | null;
  text: string;
  status: 'open' | 'resolved';
  created: string;
  resolved_at: string | null;
  author?: string;
  thread?: OverlayReply[];
  mentions?: string[];
  /** Target's tag/classes/ancestor-path at creation time — unused for
   * rendering, but the structural-fallback ingredients `resolveCommentTarget`
   * reaches for when the stored `selector` no longer identifies the right
   * element (see file header). Absent on legacy comments. */
  tag?: string;
  classes?: string;
  dom_path?: string[];
  /** Anchor on an annotation (sticky, shape, stroke…) — see comment-anchor.ts. */
  annotationId?: string;
  /** World point of the comment — the anchor of a floating comment, and the
   * last known place of an anchored one whose target is gone. */
  world?: WorldPoint;
  /** Maude 2 anchors (comments/anchors.ts): the artboard the thread is on, the second of its
   * video (`t`), the point on paper in mm from the trim corner (`mm`). */
  artboard?: string;
  t?: number;
  mm?: { x: number; y: number };
  authorKind?: 'ai';
  /** S8.17b — the thread came from another tool (Figma): who wrote it there, as a label. */
  importedFrom?: ImportedFrom;
  /** A converted sticky (S4-S9-votes-comments §3.1). */
  from?: {
    kind: string;
    id: string;
    author: string;
    convertedBy: string;
    at: string;
  };
  // html_excerpt unused at overlay layer; kept off the type to keep the
  // surface tight.
}

// ─────────────────────────────────────────────────────────────────────────────
// The shell bridge (S9.22). The overlay runs in the canvas iframe and cannot reach the privileged
// comment door (`POST /_api/comments/op`, main origin only). It asks the shell, which asks the door
// as the session — that is also how a canvas-only session replies (the old `/reply` route named no
// canvas for the local gate to judge a grant on). The shell answers `comment-op-ack` the moment it
// receives an op and `comment-op-result` when the door has answered. No ack inside ACK_MS means the
// shell has no bridge (an older shell, a standalone preview): the caller falls back to the v1
// message it always sent, so nothing is ever sent twice and nothing is lost.

const ACK_MS = 800;
const RESULT_MS = 20_000;

interface ShellReply {
  dgn?: string;
  reqId?: string | number | null;
  ok?: boolean;
  comment?: OverlayComment | null;
  error?: string;
  people?: unknown;
}

const pendingCalls = new Map<string, (m: ShellReply) => void>();
let callSeq = 0;
function onShellReply(e: MessageEvent): void {
  // Only the shell (our parent) answers; a sibling frame or the canvas's own code cannot.
  if (e.source !== window.parent) return;
  const m = e.data as ShellReply | null;
  if (!m || typeof m !== 'object' || typeof m.dgn !== 'string') return;
  if (m.dgn !== 'comment-op-ack' && m.dgn !== 'comment-op-result' && m.dgn !== 'comment-people')
    return;
  const key = `${m.dgn === 'comment-op-ack' ? 'ack' : 'res'}:${String(m.reqId)}`;
  pendingCalls.get(key)?.(m);
}

// One stable listener, added on every call: addEventListener drops a duplicate of the same function, and a
// document whose listeners were cleared (a reset test DOM) gets it back — a once-flag never would.
function installShellReplies(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('message', onShellReply);
}

const hasShell = (): boolean => typeof window !== 'undefined' && window.parent !== window;

function waitFor(key: string, ms: number): Promise<ShellReply | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(key);
      resolve(null);
    }, ms);
    pendingCalls.set(key, (m) => {
      clearTimeout(timer);
      pendingCalls.delete(key);
      resolve(m);
    });
  });
}

/**
 * Run a comment op through the shell. `null` = no shell bridge answered (fall back to the v1
 * message); otherwise the door's answer. Never throws.
 */
export async function shellCommentOp(
  op: Record<string, unknown>
): Promise<{ ok: boolean; comment?: OverlayComment | null; error?: string } | null> {
  if (!hasShell()) return null;
  installShellReplies();
  const reqId = `cm${++callSeq}`;
  const ack = waitFor(`ack:${reqId}`, ACK_MS);
  const res = waitFor(`res:${reqId}`, RESULT_MS);
  try {
    window.parent.postMessage({ dgn: 'comment-op', reqId, op }, '*');
  } catch {
    pendingCalls.delete(`ack:${reqId}`);
    pendingCalls.delete(`res:${reqId}`);
    return null;
  }
  if (!(await ack)) {
    pendingCalls.delete(`res:${reqId}`);
    return null;
  }
  const m = await res;
  if (!m) return { ok: false, error: 'That did not go through.' };
  return m.ok
    ? { ok: true, comment: m.comment ?? null }
    : { ok: false, error: m.error || 'That did not go through.' };
}

/** The people who can open this canvas, from the shell (hub `people`); null = no source. */
async function shellPeople(): Promise<MentionRow[] | null> {
  if (!hasShell()) return null;
  installShellReplies();
  const reqId = `cm${++callSeq}`;
  const answer = waitFor(`res:${reqId}`, 2500);
  try {
    window.parent.postMessage({ dgn: 'comment-people-request', reqId }, '*');
  } catch {
    pendingCalls.delete(`res:${reqId}`);
    return null;
  }
  const m = await answer;
  return Array.isArray(m?.people) ? (m.people as MentionRow[]) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Where on the canvas a comment sits (S9.22): the artboard it is on, a video's moment, a print
// artboard's millimetres. Read off the live DOM — `data-dc-screen` / `data-dc-kind` / `data-dc-print`
// are stamped by DCArtboard — and the video players' registry (`window.__maudeVideoComps`).

function artboardNode(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-dc-screen]'))
    if (el.getAttribute('data-dc-screen') === id) return el;
  return null;
}

function artboardLabelOf(id: string): string {
  const node = artboardNode(id);
  const label = node?.querySelector('.dc-artboard-label');
  const text = (label instanceof HTMLInputElement ? label.value : label?.textContent)?.trim();
  return text || id;
}

function artboardBodyRect(node: HTMLElement): DOMRect {
  return (node.querySelector('.dc-artboard-body') ?? node).getBoundingClientRect();
}

function artboardAt(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined') return null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-dc-screen]')) {
    const r = artboardBodyRect(el);
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom)
      return el.getAttribute('data-dc-screen');
  }
  return null;
}

function printPropOf(id: string): unknown {
  const raw = artboardNode(id)?.getAttribute('data-dc-print');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface CompLike {
  artboardId: string | null;
  fps: number;
  ref: { current: { getCurrentFrame?: () => number } | null };
}

/** Seconds into the video on artboard `id`, or null when no player for it is mounted. */
export function playheadSeconds(id: string): number | null {
  const reg = (globalThis as unknown as { __maudeVideoComps?: Map<string, CompLike> })
    .__maudeVideoComps;
  if (!reg) return null;
  for (const c of reg.values()) {
    if (c.artboardId !== id) continue;
    try {
      const f = c.ref.current?.getCurrentFrame?.();
      if (typeof f === 'number' && c.fps > 0) return f / c.fps;
    } catch {
      /* a player in transition */
    }
  }
  return null;
}

/** Park the video on artboard `id` at second `t` (a thread's "at 0:12" chip). False = no player. */
export function seekPlayhead(id: string, t: number): boolean {
  const reg = (globalThis as unknown as { __maudeVideoComps?: Map<string, CompLike> })
    .__maudeVideoComps;
  if (!reg) return false;
  for (const c of reg.values()) {
    if (c.artboardId !== id) continue;
    const player = c.ref.current as {
      pause?: () => void;
      seekTo?: (f: number) => void;
    } | null;
    if (!player?.seekTo) continue;
    try {
      player.pause?.();
      player.seekTo(Math.max(0, Math.round(t * c.fps)));
      return true;
    } catch {
      /* a player in transition */
    }
  }
  return false;
}

/** The v2 anchors for a comment placed at a client point on `artboardId` (or whichever artboard is there). */
export function anchorsAt(
  artboardId: string | null | undefined,
  clientX: number,
  clientY: number
): { artboard?: string; t?: number; mm?: { x: number; y: number } } {
  const id = artboardId || artboardAt(clientX, clientY);
  const node = id ? artboardNode(id) : null;
  if (!id || !node) return {};
  const out: { artboard?: string; t?: number; mm?: { x: number; y: number } } = { artboard: id };
  const kind = node.getAttribute('data-dc-kind');
  if (kind === 'video') {
    const t = playheadSeconds(id);
    if (t !== null) out.t = Math.round(t * 1000) / 1000;
  } else if (kind === 'print') {
    const rect = artboardBodyRect(node);
    const body = node.querySelector('.dc-artboard-body') as HTMLElement | null;
    const scale = body && rect.width > 0 ? body.offsetWidth / rect.width : 1;
    const mm = mmAtArtboardPx(printPropOf(id), {
      x: (clientX - rect.left) * (scale || 1),
      y: (clientY - rect.top) * (scale || 1),
    });
    if (mm) out.mm = mm;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS load — sibling stylesheet, fetched once per session via a <link> tag.
// Inlining the file at build time would cost an extra bundler config; the
// overlay is internal-only so a runtime <link> is fine.

const CSS_HREF = '/_client/comments-overlay.css';

function ensureOverlayStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cm-overlay-css')) return;
  const link = document.createElement('link');
  link.id = 'cm-overlay-css';
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  document.head.appendChild(link);
}

// ─────────────────────────────────────────────────────────────────────────────
// File derivation — same logic as canvas-shell.tsx::deriveFile(). Duplicated
// here so the overlay can fetch its own comments on mount without importing
// from canvas-shell (which would create a cycle).

function deriveFile(): string | null {
  return currentCanvasFile();
}

// ─────────────────────────────────────────────────────────────────────────────
// Position resolvers — screen coords via getBoundingClientRect. Mirrors the
// `SelectionHalos` / `HoverHalo` pattern in canvas-shell.tsx so the comments
// layer can render as a fixed-position sibling of `.dc-canvas` (above the
// halo chrome at z-index 5) instead of being portaled into `.dc-world` where
// it would lose the stacking battle.

export interface TargetRef {
  selector: string;
  index?: number;
  tag?: string;
  classes?: string;
  dom_path?: string[];
  annotationId?: string;
}

/**
 * Resolve a comment (or in-progress selection)'s live target element. Tries
 * the stored `data-cd-id` selector first — cheap, correct in the common case.
 * A tag mismatch against what was captured at creation time is the tell that
 * `data-cd-id` renumbered onto an unrelated element (DDR-019); when that
 * happens, or the selector matches nothing at all, fall back to a structural
 * match via `resolveByDomPath`.
 */
export function resolveCommentTarget(target: TargetRef): HTMLElement | null {
  if (isAnnotationId(target.annotationId)) {
    return annotationElement(target.annotationId) as HTMLElement | null;
  }
  if (!target.selector) return null;
  let el: HTMLElement | null = null;
  try {
    // index disambiguates a component repeated within one artboard (querySelector
    // alone would always grab the first match). Absent/0 → first.
    const all = document.querySelectorAll(target.selector);
    const i = target.index && target.index > 0 && target.index < all.length ? target.index : 0;
    el = (all[i] ?? all[0] ?? null) as HTMLElement | null;
  } catch {
    el = null;
  }
  if (el && target.tag && el.tagName.toLowerCase() !== target.tag.toLowerCase()) {
    el = null;
  }
  if (!el && target.dom_path?.length) {
    const artboardId = target.selector.match(/data-dc-screen="([^"]+)"/)?.[1];
    el = resolveByDomPath(document, {
      artboardId,
      tag: target.tag,
      classes: target.classes,
      dom_path: target.dom_path,
    }) as HTMLElement | null;
  }
  return el;
}

function screenRectFor(target: TargetRef): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const el = resolveCommentTarget(target);
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge-aware popup placement — picks a side (left/right, above/below the
// anchor point) that actually fits the viewport, falling back to an inward
// clamp for the rare case where no side fully fits (tiny viewport). Mirrors
// the pattern context-menu.tsx already uses for the same problem, but flips
// axes instead of only clamping, per the explicit ask: always open toward
// whichever side has room, not just "shifted back into view".
export function placeNearPoint(
  point: { x: number; y: number },
  size: { w: number; h: number }
): { x: number; y: number } {
  const margin = 8;
  const vw = typeof window !== 'undefined' ? window.innerWidth : point.x + size.w;
  const vh = typeof window !== 'undefined' ? window.innerHeight : point.y + size.h;

  let x = point.x;
  if (x + size.w + margin > vw) {
    const flipped = point.x - size.w;
    x = flipped >= margin ? flipped : Math.max(margin, vw - size.w - margin);
  }

  let y = point.y;
  if (y + size.h + margin > vh) {
    const flipped = point.y - size.h;
    y = flipped >= margin ? flipped : Math.max(margin, vh - size.h - margin);
  }

  return { x, y };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public component — mounted from canvas-shell.tsx alongside ToolPalette /
// AnnotationsLayer / SnapGuideOverlay.

export function CommentsOverlay(): React.ReactNode {
  ensureOverlayStyles();

  // Optional — CommentsOverlay is mounted inside SelectionSetProvider in the
  // standard CanvasShell tree, but stays usable if a host ever embeds it
  // outside that provider (returns null instead of throwing).
  const selSet = useSelectionSetOptional();
  const [comments, setComments] = useState<OverlayComment[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // S6.11b — bumped by `comment-focus {reply: true}`; 0 = the thread's own focus rule (the dialog)
  const [replyFocus, setReplyFocus] = useState(0);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const file = useMemo(() => deriveFile(), []);
  const [submitting, setSubmitting] = useState(false);
  // A sentence when the door refuses (what happened · what is safe · one verb) — the text stays put.
  const [notice, setNotice] = useState<string | null>(null);
  // The door's answer is the thread after the op; merge it now, the broadcast confirms it later.
  const mergeComment = useCallback((c: OverlayComment) => {
    setComments((prev) =>
      prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]
    );
  }, []);

  // Drop the legacy `#dgn-pin-layer` so we don't render duplicate pins inside
  // TSX canvases. The layer ships in every served HTML page via inspect.ts;
  // for `.html` mocks (no canvas-shell mount) it still does its job.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const legacy = document.getElementById('dgn-pin-layer') as HTMLElement | null;
    if (!legacy) return;
    const prev = legacy.style.display;
    legacy.style.display = 'none';
    return () => {
      legacy.style.display = prev;
    };
  }, []);

  // Mirror a comment into the canvas selection set so SelectionHalos paints
  // the same halo Cmd-click would. Called from both the in-iframe pin click
  // AND the inbound `comment-focus` postMessage so jumping from the shell's
  // Comments panel produces the same visual feedback as clicking the pin.
  const mirrorSelection = useCallback(
    (comment: OverlayComment | undefined) => {
      if (!selSet) return;
      if (!comment?.selector) {
        selSet.clear();
        return;
      }
      const cdMatch = comment.selector.match(/data-cd-id="([^"]+)"/);
      const cdId = cdMatch ? cdMatch[1] : undefined;
      let tag: string | undefined;
      let classes: string | undefined;
      try {
        const el = document.querySelector(comment.selector) as HTMLElement | null;
        if (el) {
          tag = el.tagName.toLowerCase();
          classes = (el.getAttribute('class') ?? '')
            .split(/\s+/)
            .filter((cls) => cls && !cls.startsWith('dgn-') && !cls.startsWith('dc-cv-'))
            .join(' ');
        }
      } catch {
        /* unresolvable selector — fall through with no fresh metadata */
      }
      selSet.replace({
        file: file ?? undefined,
        id: cdId,
        selector: comment.selector,
        tag,
        classes,
        bounds: comment.bounds ?? undefined,
      });
    },
    [selSet, file]
  );

  // Keep the latest comments list reachable from the message handler without
  // re-attaching the listener on every comments mutation.
  const commentsRef = useRef<OverlayComment[]>(comments);
  commentsRef.current = comments;

  // Phase 8 Task 3 — when a collab room is connected, the Y.Array of comments
  // is the live source of truth. observe() fires on every remote mutation
  // (added pins from another tab, resolved-from-inspector via the registry
  // bridge, etc.) and on the local seed. Both paths converge on the same
  // JSON projection — last-write-wins between Y.Array and postMessage is
  // safe because they carry identical content; the Y.Array path just
  // reaches us first (no 800 ms debounce delay).
  const collab = useCollab();
  // Who is looking — the same identity a new comment is signed with (the
  // project's git user on a desktop, the vouched member in a cloud cell).
  // Asked directly: this overlay also runs in the comment-mount bundle, where
  // the collab context is another module's and reads as null.
  const me = useViewerName();
  useEffect(() => {
    if (!collab) return;
    const arr = collab.doc.getArray<OverlayComment>('comments');
    const sync = () => {
      // toArray() snapshot the current Y.Array into a plain JS list.
      setComments(arr.toArray() as OverlayComment[]);
    };
    // Initial fill — covers the case where Y.Doc was already seeded by the
    // time this overlay mounted.
    if (arr.length > 0) sync();
    arr.observe(sync);
    return () => {
      try {
        arr.unobserve(sync);
      } catch {
        /* doc destroyed before unmount — observer already gone */
      }
    };
  }, [collab]);

  // Listen for the shell's broadcast channels. Schema matches the legacy
  // overlay so the shell-side glue in client/app.jsx (~line 1672) keeps
  // working without modification.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      const m = e.data as {
        dgn?: string;
        comments?: unknown;
        id?: string;
        reply?: unknown;
      } | null;
      if (!m || typeof m !== 'object' || !m.dgn) return;
      if (m.dgn === 'comments-set' && Array.isArray(m.comments)) {
        setComments(m.comments as OverlayComment[]);
      } else if (m.dgn === 'comment-focus') {
        const id = typeof m.id === 'string' ? m.id : null;
        setFocusedId(id);
        // S6.11b — a thread landing (invite / mention): the reply field takes the focus
        if (id && m.reply === true) setReplyFocus((n) => n + 1);
        else setReplyFocus(0);
        const target = id ? commentsRef.current.find((c) => c.id === id) : undefined;
        mirrorSelection(target);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mirrorSelection]);

  // canvas-shell's `onDropComment` dispatches `cm:open-composer` on the iframe
  // document. Open the composer pinned to that click point.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onOpen = (e: Event) => {
      const detail = (
        e as CustomEvent<{ selection?: ComposeSelection; clientX?: number; clientY?: number }>
      ).detail;
      if (!detail?.selection) return;
      const clientX = typeof detail.clientX === 'number' ? detail.clientX : 0;
      const clientY = typeof detail.clientY === 'number' ? detail.clientY : 0;
      setComposer({
        selection: detail.selection,
        clientX,
        clientY,
        anchors: anchorsAt(detail.selection.artboardId, clientX, clientY),
      });
    };
    document.addEventListener('cm:open-composer', onOpen);
    return () => document.removeEventListener('cm:open-composer', onOpen);
  }, []);

  const closeComposer = useCallback(() => {
    setComposer(null);
    if (typeof window === 'undefined') return;
    try {
      window.parent.postMessage({ dgn: 'force-clear' }, '*');
    } catch {
      /* parent detached */
    }
  }, []);

  const submitComposer = useCallback(
    (text: string) => {
      if (!composer) return;
      const sel = composer.selection;
      const payload = {
        file: sel.file,
        selector: sel.selector,
        index: sel.index,
        dom_path: sel.dom_path,
        tag: sel.tag,
        classes: sel.classes,
        bounds: sel.bounds,
        html_excerpt: sel.html,
        ...(sel.annotationId ? { annotationId: sel.annotationId } : {}),
        ...(sel.world ? { world: sel.world } : {}),
        text,
      };
      if (typeof window === 'undefined') return;
      // S9.22 — through the comment door as the session, anchored to its artboard / video moment /
      // point on paper. No shell bridge answering (an older shell): the v1 message, as before — it
      // carries no Maude 2 anchors, which an older shell could not store anyway.
      setSubmitting(true);
      void (async () => {
        const r = await shellCommentOp({ op: 'add', ...payload, ...composer.anchors });
        setSubmitting(false);
        if (r === null) {
          try {
            window.parent.postMessage({ dgn: 'comment-submit', payload }, '*');
          } catch {
            /* parent detached */
          }
          closeComposer();
          return;
        }
        if (!r.ok) {
          setNotice(r.error ?? 'That did not go through.');
          return;
        }
        setNotice(null);
        if (r.comment) mergeComment(r.comment);
        closeComposer();
      })();
    },
    [composer, closeComposer, mergeComment]
  );

  // Self-heal fetch — covers the race where the iframe loads before the shell
  // pushes `comments-set` (e.g. first hydration on cold open).
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/_comments?file=${encodeURIComponent(file)}`);
        if (!r.ok) {
          // A refused read still ends: an unread body keeps the request open (a headless
          // capture waiting for network idle never gets it — gate-b-c4f).
          await r.body?.cancel().catch(() => {});
          return;
        }
        const data = (await r.json()) as { comments?: OverlayComment[] };
        if (cancelled) return;
        if (Array.isArray(data.comments)) {
          // Only set when we haven't received a shell broadcast yet; the
          // shell is authoritative once it kicks in.
          setComments((prev) => (prev.length === 0 ? (data.comments ?? []) : prev));
        }
      } catch {
        /* offline / dev-server restart — silently no-op */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Sorted by `created` asc so sequence numbers are stable per canvas across
  // reloads. Resolved comments are hidden by default (Task 2 spec).
  // S9.22 — a pin on a video shows only at its moment (the thread you opened stays). The playhead of
  // each timed artboard is polled while any timed comment exists, in quarter-seconds so a playing
  // video re-renders four times a second at most; no player for the artboard = the pin stays.
  const timedArtboards = useMemo(
    () =>
      [
        ...new Set(
          comments.filter((c) => typeof c.t === 'number' && c.artboard).map((c) => c.artboard)
        ),
      ] as string[],
    [comments]
  );
  const [playheads, setPlayheads] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (timedArtboards.length === 0) return;
    const tick = () => {
      const next: Record<string, number | null> = {};
      for (const id of timedArtboards) {
        const s = playheadSeconds(id);
        next[id] = s === null ? null : Math.round(s * 4) / 4;
      }
      setPlayheads((prev) => (timedArtboards.every((id) => prev[id] === next[id]) ? prev : next));
    };
    tick();
    const timer = setInterval(tick, 125);
    return () => clearInterval(timer);
  }, [timedArtboards]);

  const visible = useMemo(() => {
    const list = comments.slice().sort((a, b) => a.created.localeCompare(b.created));
    return list.filter(
      (c) =>
        c.status !== 'resolved' &&
        (typeof c.t !== 'number' ||
          !c.artboard ||
          c.id === focusedId ||
          videoPinVisible(c.t, playheads[c.artboard] ?? null))
    );
  }, [comments, playheads, focusedId]);

  // Sequence index lookup — built off the FULL sorted list so a resolved-then-
  // reopened pin keeps its original number.
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    const all = comments.slice().sort((a, b) => a.created.localeCompare(b.created));
    all.forEach((c, i) => {
      m.set(c.id, i + 1);
    });
    return m;
  }, [comments]);

  const handlePinClick = useCallback(
    (id: string) => {
      setFocusedId(id);
      mirrorSelection(comments.find((c) => c.id === id));
      if (typeof window === 'undefined') return;
      try {
        window.parent.postMessage({ dgn: 'comment-click', id }, '*');
      } catch {
        /* parent detached */
      }
    },
    [comments, mirrorSelection]
  );

  // Resolve / reopen / edit-own / delete-own go through the comment door (S9.22): a Can comment
  // session may resolve and reopen any thread, and only its own words are editable or deletable —
  // the door says so, whatever this client shows. No bridge answering: the v1 patch message.
  const handlePatch = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      if (typeof window === 'undefined') return;
      const legacy = () => {
        try {
          window.parent.postMessage({ dgn: 'comment-patch', id, patch }, '*');
        } catch {
          /* parent detached */
        }
      };
      const op =
        patch.status === 'resolved'
          ? { op: 'resolve', id }
          : patch.status === 'open'
            ? { op: 'reopen', id }
            : typeof patch.text === 'string'
              ? { op: 'edit-own', id, text: patch.text }
              : null;
      if (!op) return legacy();
      void shellCommentOp(op).then((r) => {
        if (r === null) return legacy();
        if (!r.ok) return setNotice(r.error ?? 'That did not go through.');
        setNotice(null);
        if (r.comment) mergeComment(r.comment);
      });
    },
    [mergeComment]
  );

  const handleDelete = useCallback((id: string) => {
    if (typeof window === 'undefined') return;
    setFocusedId((prev) => (prev === id ? null : prev));
    void shellCommentOp({ op: 'delete-own', id }).then((r) => {
      if (r === null) {
        try {
          window.parent.postMessage({ dgn: 'comment-delete', id }, '*');
        } catch {
          /* parent detached */
        }
        return;
      }
      if (!r.ok) return setNotice(r.error ?? 'That did not go through.');
      setNotice(null);
      setComments((prev) => prev.filter((c) => c.id !== id));
    });
  }, []);

  const handleReply = useCallback(
    async (id: string, body: string): Promise<boolean> => {
      if (typeof fetch === 'undefined') return false;
      // The door first (it names no canvas: the studio finds the thread's, so a canvas-only session
      // replies); the v1 route only when no shell bridge answered.
      const viaShell = await shellCommentOp({ op: 'reply', id, body });
      if (viaShell) {
        if (!viaShell.ok) {
          setNotice(viaShell.error ?? 'That did not go through.');
          return false;
        }
        setNotice(null);
        if (viaShell.comment) mergeComment(viaShell.comment);
        return true;
      }
      try {
        const r = await fetch(`/_api/comments/${encodeURIComponent(id)}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        if (!r.ok) return false;
        const updated = (await r.json()) as OverlayComment;
        // Optimistic local merge — the shell will broadcast `comments-set`
        // shortly after as the WS fans out the change, but applying it now
        // avoids the popover flickering empty between submit + broadcast.
        setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        return true;
      } catch {
        return false;
      }
    },
    [mergeComment]
  );

  return (
    <div className="cm-layer" aria-hidden={false}>
      {visible.map((c) => {
        const n = indexById.get(c.id) ?? 0;
        return (
          <CommentPin
            key={c.id}
            comment={c}
            sequence={n}
            focused={focusedId === c.id}
            onClick={handlePinClick}
          />
        );
      })}
      {composer ? (
        <CommentComposer
          state={composer}
          busy={submitting}
          onSubmit={submitComposer}
          onCancel={closeComposer}
        />
      ) : null}
      {notice ? (
        <div className="cm-notice" role="status" data-testid="comment-notice">
          <span>{notice}</span>
          <button
            type="button"
            className="cm-notice__x"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      {(() => {
        if (!focusedId) return null;
        const focused = visible.find((c) => c.id === focusedId);
        if (!focused) return null;
        return (
          <CommentThread
            comment={focused}
            sequence={indexById.get(focused.id) ?? 0}
            onClose={() => {
              setFocusedId(null);
              // Drop the canvas halo when the thread closes — symmetric with
              // `handlePinClick` which paints it on open.
              selSet?.clear();
            }}
            onPatch={(patch) => handlePatch(focused.id, patch)}
            onDelete={() => handleDelete(focused.id)}
            onReply={(body) => handleReply(focused.id, body)}
            focusReply={replyFocus}
            mine={
              (!isReadOnlyCanvas() || canCommentCanvas()) &&
              !!(me ?? collab?.myName) &&
              (focused.author ?? '').trim() === (me ?? collab?.myName ?? '').trim()
            }
            me={(me ?? collab?.myName) || undefined}
          />
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MentionAwareTextarea + popup — Task 5
//
// Wraps a textarea and surfaces an autocomplete popup when the caret sits
// inside an `@<query>` token (no whitespace between `@` and cursor). The
// committer list is fetched once on first focus and cached for the session.
// Keyboard: ↑↓ move, ↵/Tab insert (`@firstname `), Esc dismiss.

// The people a mention can name (S9.22). Two sources, one shape (`MentionRow`: a name and, when the
// source knew it, a role word — never an address):
//   1. the shell's `people` (hub `GET /api/access/people?canvas=` — only people who can OPEN this
//      canvas, no e-mails for a non-owner), pushed on request;
//   2. git committers (`/_api/git-committers`, the canvas origin's no-e-mail projection) when no
//      hub answers — a local project, where there is no role to show.
let peopleCache: Promise<MentionRow[]> | null = null;
let peopleAt = 0;
const PEOPLE_TTL_MS = 60_000;

async function committers(): Promise<MentionRow[]> {
  try {
    const r = await fetch('/_api/git-committers');
    if (!r.ok) return [];
    const data = (await r.json()) as { committers?: unknown };
    return committerRows(data.committers);
  } catch {
    return [];
  }
}

function loadMentionRows(): Promise<MentionRow[]> {
  const fresh = peopleCache && Date.now() - peopleAt < PEOPLE_TTL_MS;
  if (!fresh) {
    peopleAt = Date.now();
    peopleCache = (async () => {
      const people = await shellPeople();
      return people ?? (await committers());
    })();
  }
  return peopleCache as Promise<MentionRow[]>;
}

/** Test seam: forget the cached people. */
export function resetMentionPeople(): void {
  peopleCache = null;
  peopleAt = 0;
}

function firstNameSlug(name: string): string {
  // `@firstname` is what we insert on accept (comments/mentions.ts handleOfName — the one rule the
  // hub also resolves a token with).
  return handleOfName(name);
}

interface MentionToken {
  start: number; // index of `@`
  end: number; // exclusive — current caret
  query: string; // chars between `@` and caret (excluding `@`)
}

function detectMentionToken(text: string, caret: number): MentionToken | null {
  if (caret <= 0 || caret > text.length) return null;
  // Walk backwards from caret; the token starts at `@` and ends at the caret.
  // Aborts on whitespace, newline, or any non-mention char so a stray `@` in
  // an email is ignored.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i] ?? '';
    if (ch === '@') {
      // Token must be word-leading: previous char is start-of-string or whitespace.
      const prev = i > 0 ? text[i - 1] : '';
      if (i === 0 || /\s/.test(prev ?? '')) {
        const query = text.slice(i + 1, caret);
        return { start: i, end: caret, query };
      }
      return null;
    }
    if (!/[\w.-]/.test(ch)) return null;
    i -= 1;
  }
  return null;
}

function MentionAwareTextarea({
  className,
  value,
  onChange,
  onKeyDown,
  placeholder,
  rows,
  disabled,
  textareaRef,
  ariaLabel,
  title,
}: {
  className: string;
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  ariaLabel?: string;
  title?: string;
}): React.ReactElement {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      internalRef.current = el;
      if (textareaRef) textareaRef.current = el;
    },
    [textareaRef]
  );

  const [committers, setCommitters] = useState<MentionRow[]>([]);
  const [token, setToken] = useState<MentionToken | null>(null);
  const [highlight, setHighlight] = useState(0);

  // Lazy-load committers on first focus.
  const onFocus = useCallback(() => {
    if (committers.length > 0) return;
    void loadMentionRows().then((list) => setCommitters(list));
  }, [committers.length]);

  const filtered = useMemo(() => {
    if (!token) return [] as MentionRow[];
    const q = token.query.toLowerCase();
    const list = !q ? committers : committers.filter((c) => c.name.toLowerCase().includes(q));
    return list.slice(0, 8);
  }, [token, committers]);

  const refreshToken = useCallback((textarea: HTMLTextAreaElement) => {
    const caret = textarea.selectionStart ?? textarea.value.length;
    const t = detectMentionToken(textarea.value, caret);
    setToken(t);
    setHighlight(0);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      refreshToken(e.target);
    },
    [onChange, refreshToken]
  );

  const insertMention = useCallback(
    (committer: MentionRow) => {
      if (!token) return;
      const ta = internalRef.current;
      if (!ta) return;
      const tag = `@${firstNameSlug(committer.name)}`;
      const next = `${value.slice(0, token.start)}${tag} ${value.slice(token.end)}`;
      onChange(next);
      setToken(null);
      // Restore caret just past the inserted token + trailing space.
      const newCaret = token.start + tag.length + 1;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
      });
    },
    [token, value, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (token && filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlight((h) => (h + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const pick = filtered[highlight] ?? filtered[0];
          if (pick) insertMention(pick);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setToken(null);
          return;
        }
      }
      onKeyDown?.(e);
    },
    [token, filtered, highlight, insertMention, onKeyDown]
  );

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      refreshToken(e.currentTarget);
    },
    [refreshToken]
  );

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={setRef}
        className={className}
        value={value}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        onSelect={handleSelect}
        onClick={handleSelect}
      />
      {/* Combobox pattern — `role="listbox"` + `role="option"` is the canonical
       * ARIA shape for a single-select autocomplete. Keyboard navigation
       * (↑ ↓ Enter Esc) lives on the parent textarea per the combobox spec,
       * so the popup itself stays inert. Same pattern applies to the composer
       * + thread popovers below (`role="dialog"` on a positioned <div>).
       * Biome's a11y rules want semantic HTML primitives, but none match
       * "non-focusable listbox under a textarea" or "anchored non-modal popover".
       * The four affected rules are scoped off for this file in biome.json. */}
      {token && filtered.length > 0 ? (
        <ul
          className="cm-mention-popup"
          role="listbox"
          aria-label="Mention suggestions"
          style={{ left: 0, top: '100%' }}
        >
          {filtered.map((c, i) => {
            const selected = i === highlight;
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={selected}
                className="cm-mention-popup__item"
                onMouseEnter={() => setHighlight(i)}
                // Use mousedown so the textarea doesn't blur before the
                // selection registers.
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  insertMention(c);
                }}
              >
                <span className="cm-mention-popup__name">@{firstNameSlug(c.name)}</span>
                {c.role ? <span className="cm-mention-popup__role">{c.role}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommentPin — single 24×24 badge anchored to top-right of its target element.
// Resolves target on every animation frame to track layout shifts (drag,
// reflow, font load). Falls back to the stored `bounds` when the target is
// gone from the DOM.

// How long a pin may stay unresolvable before it is shown as DETACHED. Long
// enough to ride out a canvas HMR remount. Detached is a view of this client's
// DOM, never a fact written back: another peer may still resolve the target.
const DETACH_GRACE_MS = 3000;

/** The pin box for a client point — the pin centres on the point. */
function pointBox(p: { x: number; y: number }): OverlayBounds {
  return { x: p.x - 12, y: p.y - 12, w: 24, h: 24 };
}

/**
 * Where a comment's pin goes this frame, and whether its target is missing.
 *
 *   - anchored (element selector or annotation id) and resolved → on the target;
 *   - anchored but unresolved → last known place (world point, else the
 *     create-time screen bounds), `missing: true`;
 *   - floating (no anchor) → its world point, else legacy screen bounds.
 */
export function locateComment(comment: OverlayComment): {
  pos: OverlayBounds | null;
  missing: boolean;
} {
  const anchored = !!comment.selector || isAnnotationId(comment.annotationId);
  if (anchored) {
    const live = screenRectFor(comment);
    if (live) return { pos: live, missing: false };
  }
  const at = isWorldPoint(comment.world) ? worldToClient(comment.world) : null;
  const pos = at ? pointBox(at) : (comment.bounds ?? null);
  return { pos, missing: anchored };
}

/** The one letter a pin wears: the author's initial ('?' when nobody signed it). */
export function pinInitial(author: string): string {
  const c = author.trim().charAt(0);
  return c && author !== 'unknown' ? c.toUpperCase() : '?';
}

function CommentPin({
  comment,
  sequence,
  focused,
  onClick,
}: {
  comment: OverlayComment;
  sequence: number;
  focused: boolean;
  onClick: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const missingSinceRef = useRef<number | null>(null);
  const [detached, setDetached] = useState(false);
  const detachedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      rafRef.current = null;
      const pin = ref.current;
      if (!pin) return;

      // Live screen-coord lookup mirrors SelectionHalos in canvas-shell.tsx.
      const { pos, missing } = locateComment(comment);
      let nowDetached = false;
      if (missing) {
        if (missingSinceRef.current == null) missingSinceRef.current = Date.now();
        nowDetached = Date.now() - missingSinceRef.current > DETACH_GRACE_MS;
      } else {
        missingSinceRef.current = null;
      }
      if (nowDetached !== detachedRef.current) {
        detachedRef.current = nowDetached;
        setDetached(nowDetached);
      }
      if (!pos) {
        pin.style.display = 'none';
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      pin.style.display = 'grid';
      // Position the pin's center at (right - 14, top - 14) — the FigJam
      // convention. 14 = half of 28 (the pin's own size, board `.k-cpin-dot`).
      const left = Math.round(pos.x + pos.w - 14);
      const top = Math.round(pos.y - 14);
      pin.style.left = `${left}px`;
      pin.style.top = `${top}px`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [comment]);

  const author = comment.author?.trim() || 'unknown';
  const label = `Comment ${sequence} by ${author}${detached ? ' (detached: its target is gone)' : ''}`;

  return (
    <button
      ref={ref}
      type="button"
      className="cm-pin"
      data-resolved={comment.status === 'resolved' ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
      data-detached={detached ? 'true' : 'false'}
      data-comment-pin={comment.id}
      aria-label={label}
      aria-expanded={focused}
      title={comment.text.slice(0, 200)}
      data-seq={sequence}
      // P8 C5 (10 co-comment-thread): the author's person tone fills the pin, and it wears their initial
      style={{ ['--cm-pin-tone' as string]: toneColor(toneFor(author)) }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(comment.id);
      }}
    >
      {pinInitial(author)}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommentComposer — DS-styled card anchored just under the clicked element
// (or at the click point if the click hit empty canvas). Edge-clamp is the
// pragmatic kind: position is computed once on open against the world layout,
// not chased on pan/zoom — the user is actively typing.

export function CommentComposer({
  state,
  busy = false,
  onSubmit,
  onCancel,
}: {
  state: ComposerState;
  busy?: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Live anchor — composer tracks the target element via rAF so pan/zoom
  // while typing keeps the card glued to its anchor. Writes directly to the
  // DOM so we don't re-render every frame. `placeNearPoint` picks whichever
  // side actually fits the viewport instead of always growing down-right.
  useEffect(() => {
    const tick = () => {
      rafRef.current = null;
      const node = cardRef.current;
      if (!node) return;
      const anchor = computeAnchor(state);
      const placed = placeNearPoint(anchor, { w: node.offsetWidth, h: node.offsetHeight });
      node.style.left = `${Math.round(placed.x)}px`;
      node.style.top = `${Math.round(placed.y)}px`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [state]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const trySubmit = useCallback(() => {
    const v = text.trim();
    if (!v || busy) return;
    onSubmit(v);
  }, [text, busy, onSubmit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        trySubmit();
      }
    },
    [onCancel, trySubmit]
  );

  // gate-b-polish3 (10 · co-comment-thread) — the header says WHERE, in words: the artboard's label, else the
  // element's name, else the canvas. Never a raw id (the v1 head showed "cd:566b4b33").
  const where = useMemo(
    () => placeWords({ artboard: state.anchors?.artboard, selector: state.selection.selector }),
    [state.anchors, state.selection]
  );

  // "at 0:12" / "14 mm from the left · 2 mm above the trim": where it will be pinned, said before it is.
  const placedChip = useMemo(() => {
    const a = state.anchors;
    if (!a?.artboard) return null;
    return whereOf(a, trimOfPrint(printPropOf(a.artboard))).chip;
  }, [state.anchors]);

  return (
    <div
      ref={cardRef}
      className="cm-composer"
      role="dialog"
      aria-label="New comment"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cm-composer__head">
        <span
          className="cm-composer__where"
          data-testid={placedChip ? 'comment-composer-place' : 'comment-composer-where'}
        >
          {where}
        </span>
        <button
          type="button"
          className="cm-thread__close"
          data-testid="comment-composer-cancel"
          aria-label="Cancel"
          title="Cancel · esc"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      {placedChip ? (
        <span className="cm-chip cm-composer__chip" data-testid="comment-composer-where">
          {placedChip}
        </span>
      ) : null}
      <div className="cm-composer__field">
        <MentionAwareTextarea
          textareaRef={textareaRef}
          className="cm-composer__textarea"
          value={text}
          placeholder="Add a comment — @ mentions someone"
          onChange={setText}
          onKeyDown={onKeyDown}
          rows={2}
          ariaLabel="Comment body"
        />
        <button
          type="button"
          className="cm-btn cm-btn--primary cm-composer__send"
          data-testid="comment-composer-send"
          aria-label="Send"
          title="Send · ⌘↵"
          disabled={!text.trim() || busy}
          onClick={trySubmit}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * gate-b-polish3 — where a comment sits, in words: its artboard's label, else the named element
 * (`data-dc-element`), else the canvas. Never a raw element id or a CSS selector.
 */
export function placeWords(o: { artboard?: string | null; selector?: string | null }): string {
  if (o.artboard) return artboardLabelOf(o.artboard);
  let el: Element | null = null;
  try {
    el = o.selector && typeof document !== 'undefined' ? document.querySelector(o.selector) : null;
  } catch {
    el = null;
  }
  const abId = el?.closest?.('[data-dc-screen]')?.getAttribute('data-dc-screen');
  if (abId) return artboardLabelOf(abId);
  const named = el?.getAttribute?.('data-dc-element');
  if (named) return named.replace(/[-_]+/g, ' ');
  return 'On the canvas';
}

// ─────────────────────────────────────────────────────────────────────────────
// CommentThread — popover anchored to the focused pin. Shows author + relative
// time + selector chip, the original body with @mentions bolded, replies, a
// reply textarea, and resolve/reopen/delete actions. Patches + deletes route
// through the shell's existing WS channel via postMessage; replies POST
// directly to `/_api/comments/<id>/reply` because that endpoint exists only on
// Bun runtime and lives in `http.ts`.

let viewerName: Promise<string | null> | null = null;
/** The viewer's display identity, asked once per document. */
function useViewerName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (typeof fetch === 'undefined') return;
    viewerName ??= fetch('/_api/git-user')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (typeof j?.name === 'string' && j.name.trim() ? j.name.trim() : null))
      .catch(() => null);
    let alive = true;
    void viewerName.then((n) => alive && setName(n));
    return () => {
      alive = false;
    };
  }, []);
  return name;
}

export function CommentThread({
  comment,
  sequence,
  onClose,
  onPatch,
  onDelete,
  onReply,
  focusReply = 0,
  mine = false,
  me,
}: {
  comment: OverlayComment;
  sequence: number;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onReply: (body: string) => Promise<boolean>;
  /** S6.11b — non-zero (bumped per request): put the focus in the reply field, not on the dialog. */
  focusReply?: number;
  /** The person looking wrote this comment — they may edit its text. */
  mine?: boolean;
  /** The person looking (S4.V4 G5: did they convert this sticky? did someone else reply?). */
  me?: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  // Editing your own comment: the text in place, saved as a patch (the same
  // channel resolve/reopen use). null = not editing.
  const [draft, setDraft] = useState<string | null>(null);
  const saveDraft = useCallback(() => {
    const v = (draft ?? '').trim();
    if (!v) return;
    if (v !== comment.text) onPatch({ text: v });
    setDraft(null);
  }, [draft, comment.text, onPatch]);

  // Live anchor — popover tracks the pin via rAF so it stays glued to its
  // target through pan / zoom (FigJam parity). Writing to the dialog style
  // directly avoids re-rendering every frame. `placeNearPoint` picks whichever
  // side actually fits the viewport instead of always growing down-right.
  useEffect(() => {
    const tick = () => {
      rafRef.current = null;
      const node = dialogRef.current;
      if (!node) return;
      const anchor = computeThreadAnchor(comment);
      const placed = placeNearPoint(anchor, { w: node.offsetWidth, h: node.offsetHeight });
      node.style.left = `${Math.round(placed.x)}px`;
      node.style.top = `${Math.round(placed.y)}px`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [comment]);

  useEffect(() => {
    // Move focus into the dialog on open. Per WCAG 2.1 the dialog should own
    // initial focus; we put it on the dialog root (focusable via tabindex)
    // so screen readers announce the header before the body. On close,
    // return focus to the pin so keyboard users land where they started.
    dialogRef.current?.focus();
    const pinId = comment.id;
    return () => {
      const pin = document.querySelector<HTMLButtonElement>(`[data-comment-pin="${pinId}"]`);
      pin?.focus();
    };
  }, [comment.id]);
  // S6.11b — a thread landing (invite / mention): straight into the reply field. Runs after the
  // dialog focus above in the same commit; a session that cannot reply has no field — nothing moves.
  useEffect(() => {
    if (focusReply > 0) replyRef.current?.focus();
  }, [focusReply, comment.id]);

  // Esc-to-close while focus is anywhere inside the popover.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const root = dialogRef.current;
      if (!root) return;
      if (root.contains(e.target as Node) || document.activeElement === root) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trySendReply = useCallback(async () => {
    const v = reply.trim();
    if (!v || sending) return;
    setSending(true);
    const ok = await onReply(v);
    setSending(false);
    if (ok) {
      setReply('');
      replyRef.current?.focus();
    }
  }, [reply, sending, onReply]);

  const onReplyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void trySendReply();
      }
    },
    [trySendReply]
  );

  const headId = `cm-thread-head-${comment.id}`;
  // Can comment sessions boot `ro=1` (no edit) but may still reply and resolve: `cm=1` says so.
  const canAct = !isReadOnlyCanvas() || canCommentCanvas();
  const where = whereOf(
    comment,
    comment.artboard ? trimOfPrint(printPropOf(comment.artboard)) : null
  );
  const whereLabel = placeWords({ artboard: comment.artboard, selector: comment.selector });

  // S4.V4 G5 (S4-S9-votes-comments §3.4) — a converted sticky's thread: the header's Undo (the converter,
  // while this app session holds the conversion — the shell answers `convert-undoable`) and the ⋯ "Turn back
  // into a sticky" (any editor). Both refuse while someone else has replied; the server judges either way.
  const from = comment.from;
  // S8.17b — a Figma writer's label (re-clamped here: the record can come from a peer).
  const imported = sanitizeImportedFrom(comment.importedFrom);
  const meName = (me ?? '').trim();
  const byYou = from ? (meName ? (from.convertedBy ?? '').trim() === meName : mine) : false;
  const foreignReply = from
    ? (comment.thread ?? []).find(
        (r) => (r.author ?? '').trim() !== (meName || (from.convertedBy ?? '').trim())
      )
    : undefined;
  const repliedLine = foreignReply
    ? `${firstName(foreignReply.author ?? '') || 'Someone'} replied — resolve the thread instead.`
    : null;
  const canTurnBack = !!from && !isReadOnlyCanvas();
  const [menuOpen, setMenuOpen] = useState(false);
  const [convertLine, setConvertLine] = useState<string | null>(null);
  const [undoable, setUndoable] = useState(false);
  useEffect(() => {
    if (!from || !byYou) {
      setUndoable(false);
      return;
    }
    let live = true;
    void shellCommentOp({ op: 'convert-undoable', commentId: comment.id }).then((r) => {
      if (live) setUndoable(!!r?.ok);
    });
    return () => {
      live = false;
    };
  }, [comment.id, from, byYou]);
  const runConvert = async (op: 'to-sticky' | 'convert-undo') => {
    setMenuOpen(false);
    setConvertLine(null);
    const r = await shellCommentOp({ op, commentId: comment.id });
    if (r?.ok) onClose();
    else setConvertLine(r?.error || 'That did not go through.');
  };

  return (
    <div
      ref={dialogRef}
      className="cm-thread"
      role="dialog"
      data-esc-owner="focus"
      aria-labelledby={headId}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cm-thread__head" id={headId}>
        <div className="cm-thread__head-row">
          {/* Plan C P18 — pin/sequence badge in the popover header (parity with
              `.design/ui/Studio.tsx` thread popover). */}
          <span className="cm-thread__seq" aria-hidden="true">
            {sequence}
          </span>
          {/* S9.22 (10 · co-comment-thread) — WHERE the thread is: the artboard it sits on, else the
              element it names. Resolve / Reopen live here, beside it. */}
          <span className="cm-thread__where" data-testid={`comment-where-${comment.id}`}>
            {whereLabel}
          </span>
          <span className="cm-thread__head-end">
            {canAct ? (
              <span className="cm-thread__actions">
                {mine && draft === null && !imported ? (
                  <button
                    type="button"
                    className="cm-btn"
                    data-testid="comment-edit"
                    onClick={() => setDraft(comment.text)}
                  >
                    Edit
                  </button>
                ) : null}
                {comment.status === 'resolved' ? (
                  <button
                    type="button"
                    className="cm-btn"
                    data-testid={`comment-reopen-${comment.id}`}
                    onClick={() => onPatch({ status: 'open' })}
                  >
                    ↺ Reopen
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cm-btn cm-btn--primary"
                    data-testid={`comment-resolve-${comment.id}`}
                    onClick={() => {
                      onPatch({ status: 'resolved' });
                      onClose();
                    }}
                  >
                    ✓ Resolve
                  </button>
                )}
                {mine ? (
                  <button
                    type="button"
                    className="cm-btn cm-btn--danger"
                    data-testid={`comment-delete-${comment.id}`}
                    onClick={() => {
                      onDelete();
                      onClose();
                    }}
                  >
                    Delete comment
                  </button>
                ) : null}
                {canTurnBack ? (
                  <span className="cm-thread__more">
                    <button
                      type="button"
                      className="cm-btn cm-btn--icon"
                      aria-label="More"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      data-testid={`comment-menu-${comment.id}`}
                      onClick={() => setMenuOpen((v) => !v)}
                    >
                      ⋯
                    </button>
                    {menuOpen ? (
                      <span className="cm-thread__menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="cm-thread__menu-item"
                          data-testid={`comment-menu-to-sticky-${comment.id}`}
                          disabled={!!repliedLine}
                          onClick={() => void runConvert('to-sticky')}
                        >
                          Turn back into a sticky
                        </button>
                        {repliedLine ? (
                          <span className="cm-thread__menu-note">{repliedLine}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            ) : null}
            <button
              type="button"
              className="cm-thread__close"
              aria-label="Close thread"
              title="Close · esc"
              onClick={onClose}
            >
              ×
            </button>
          </span>
        </div>
        {where.chip ? (
          where.kind === 'video' && typeof comment.t === 'number' && comment.artboard ? (
            <button
              type="button"
              className="cm-chip cm-chip--seek"
              data-testid={`comment-chip-${comment.id}`}
              title="Go to this moment"
              onClick={() => seekPlayhead(comment.artboard as string, comment.t as number)}
            >
              {where.chip}
            </button>
          ) : (
            <span className="cm-chip" data-testid={`comment-chip-${comment.id}`}>
              {where.chip}
            </span>
          )
        ) : null}
        {comment.from ? (
          <div className="cm-thread__from" data-testid={`comment-from-${comment.id}`}>
            {fromHeadline(comment.from)} · turned into a comment by{' '}
            {byYou ? 'You' : firstName(comment.from.convertedBy || comment.author || '')}
            {byYou && undoable && !repliedLine ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="cm-link"
                  data-testid={`comment-from-undo-${comment.id}`}
                  onClick={() => void runConvert('convert-undo')}
                >
                  Undo
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {convertLine ? (
          <div className="cm-thread__convert-line" role="alert">
            {convertLine}
          </div>
        ) : null}
      </div>

      {draft === null ? (
        <div className="cm-msg cm-msg--root">
          {imported ? (
            <ImportedMark />
          ) : (
            <Avatar
              name={comment.from ? fromWho(comment.from).name : comment.author}
              ai={comment.from ? fromWho(comment.from).ai : comment.authorKind === 'ai'}
            />
          )}
          <div className="cm-msg__main">
            <div className="cm-msg__head">
              <span
                className="cm-thread__author"
                data-testid={imported ? `comment-imported-${comment.id}` : undefined}
              >
                {imported
                  ? importedLabel(imported)
                  : (comment.from ? fromWho(comment.from).name : comment.author?.trim()) ||
                    'unknown'}
              </span>
              <span className="cm-thread__time">
                {formatRelativeTime(imported?.at ?? comment.created)}
              </span>
            </div>
            <div className="cm-thread__body">
              {imported ? comment.text : renderBodyWithMentions(comment.text)}
            </div>
          </div>
        </div>
      ) : (
        <div className="cm-thread__reply-form">
          <MentionAwareTextarea
            className="cm-thread__reply-textarea"
            value={draft}
            placeholder="Edit your comment… ⌘↵ to save"
            onChange={setDraft}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                saveDraft();
              }
            }}
            rows={3}
            ariaLabel="Edit comment"
          />
          <div className="cm-thread__reply-actions">
            <button type="button" className="cm-btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="cm-btn cm-btn--primary"
              data-testid="comment-edit-save"
              disabled={!draft.trim()}
              onClick={saveDraft}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {(comment.thread ?? []).map((r) => {
        const ri = sanitizeImportedFrom(r.importedFrom);
        return (
          <div className="cm-msg cm-thread__reply" key={r.id}>
            {ri ? <ImportedMark /> : <Avatar name={r.author} ai={r.authorKind === 'ai'} />}
            <div className="cm-msg__main">
              <div className="cm-thread__reply-head">
                <span className="cm-thread__reply-author">
                  {ri ? importedLabel(ri) : r.author?.trim() || 'unknown'}
                </span>
                <span className="cm-thread__reply-time">
                  {formatRelativeTime(ri?.at ?? r.created)}
                </span>
              </div>
              <div className="cm-thread__reply-body">
                {ri ? r.body : renderBodyWithMentions(r.body)}
              </div>
            </div>
          </div>
        );
      })}

      {/* A session that cannot comment (Can view, or an old shell that hid them from every
          read-only role) VIEWS threads; reply / resolve / delete are absent. The server decides
          either way — this only stops offering what it would refuse. */}
      {canAct && (
        <div className="cm-thread__reply-form">
          <MentionAwareTextarea
            textareaRef={replyRef}
            className="cm-thread__reply-textarea"
            value={reply}
            placeholder="Reply…"
            title="⌘↵ to send · @name to tag"
            onChange={setReply}
            onKeyDown={onReplyKeyDown}
            rows={2}
            ariaLabel="Reply"
            disabled={sending}
          />
          <div className="cm-thread__reply-actions">
            <button
              type="button"
              className="cm-btn cm-btn--primary"
              disabled={!reply.trim() || sending}
              onClick={() => void trySendReply()}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Body renderer — splits text on @-handles, wraps each in <strong>. Anything
// not matching the mention regex stays plain text (newlines preserved by CSS
// `white-space: pre-wrap`).

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** S8.17b — where a person's avatar would be, for words written in another tool: a ring, no initials. */
function ImportedMark(): React.ReactElement {
  return <span className="cm-av cm-av--imported" aria-hidden="true" />;
}

/** Initials in a circle — a person's mark in a thread; `AI` for an AI-written message. */
function Avatar({ name, ai = false }: { name?: string; ai?: boolean }): React.ReactElement {
  const parts = (name ?? '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const initials = ai
    ? 'AI'
    : parts.length === 0
      ? '?'
      : parts.length === 1
        ? (parts[0] ?? '').slice(0, 2).toUpperCase()
        : `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
  return (
    <span className={`cm-av${ai ? ' cm-av--ai' : ''}`} aria-hidden="true">
      {initials}
    </span>
  );
}

function renderBodyWithMentions(text: string): React.ReactNode {
  if (!text) return null;
  const re = /(@[\w][\w.-]*)/g;
  const parts = text.split(re);
  return parts.map((part, i) => {
    // The split positions ARE the identity here — for the same `text` input,
    // index `i` always maps to the same fragment. Compose key from index +
    // content so biome's array-index-key heuristic is satisfied AND reorder
    // resistance is intact if `text` mutates mid-render.
    const key = `${i}:${part}`;
    if (i % 2 === 1) {
      // Odd parts are the captured @handles thanks to the parenthesized split.
      return (
        <strong key={key} data-mention="true">
          {part}
        </strong>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return `${Math.max(diffSec, 0)}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86_400)}d ago`;
}

function computeThreadAnchor(comment: OverlayComment): { x: number; y: number } {
  // Resolve target's live screen rect; popover drops below the pin with small
  // breathing room. Stored bounds (capture-time screen coords) are the
  // last-resort fallback for orphaned pins.
  const rect = comment.selector ? screenRectFor(comment) : null;
  if (rect) {
    // Pin sits at (rect.right - 12, rect.top - 12). Place popover at the same
    // x for visual continuity, 16px below the top so it clears the pin.
    return { x: rect.x + rect.w - 12, y: rect.y + 16 };
  }
  if (comment.bounds) {
    return { x: comment.bounds.x + comment.bounds.w - 12, y: comment.bounds.y + 16 };
  }
  return { x: 16, y: 16 };
}

function computeAnchor(state: ComposerState): { x: number; y: number } {
  // G4 — anchor to the cursor click point first. Earlier versions anchored to
  // the selected element's bottom-left, which landed the composer flush in
  // the corner regardless of where the user clicked — surprising for the
  // common case of "I clicked the middle of an element, expecting the
  // composer to appear near my cursor". The element-rect path remains as a
  // fallback for entry points that don't carry a cursor (e.g. opening the
  // composer from a contextual toolbar button — those should set clientX/Y
  // to a sensible anchor before dispatching).
  if (state.clientX || state.clientY) {
    return { x: state.clientX, y: state.clientY + 8 };
  }
  if (state.selection.selector) {
    const rect = screenRectFor(state.selection);
    if (rect) {
      return { x: rect.x, y: rect.y + rect.h + 8 };
    }
  }
  return { x: 16, y: 16 };
}
