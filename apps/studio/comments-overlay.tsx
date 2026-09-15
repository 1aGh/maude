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
 * direct hit is missing or looks like the wrong element (tag mismatch), and —
 * per DDR-034's deferred future-work item — `CommentPin` auto-deletes a
 * comment whose target stays unresolvable past a short grace window.
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

import { resolveByDomPath } from './dom-selection.ts';
import { isReadOnlyCanvas } from './read-only-mode.ts';
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
}

interface ComposerState {
  selection: ComposeSelection;
  clientX: number;
  clientY: number;
}

interface OverlayReply {
  id: string;
  author: string;
  body: string;
  created: string;
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
  // html_excerpt unused at overlay layer; kept off the type to keep the
  // surface tight.
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
  if (typeof window === 'undefined') return null;
  try {
    const p = window.location.pathname;
    if (p === '/_canvas-shell.html' || p === '/_canvas-shell') {
      const qs = new URLSearchParams(window.location.search);
      const canvas = qs.get('canvas') ?? '';
      const designRel = (qs.get('designRel') ?? '.design').replace(/^\/+|\/+$/g, '');
      return canvas ? `${designRel}/${canvas}` : null;
    }
    return decodeURIComponent(p).replace(/^\//, '');
  } catch {
    return null;
  }
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
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const file = useMemo(() => deriveFile(), []);

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
      const m = e.data as { dgn?: string; comments?: unknown; id?: string } | null;
      if (!m || typeof m !== 'object' || !m.dgn) return;
      if (m.dgn === 'comments-set' && Array.isArray(m.comments)) {
        setComments(m.comments as OverlayComment[]);
      } else if (m.dgn === 'comment-focus') {
        const id = typeof m.id === 'string' ? m.id : null;
        setFocusedId(id);
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
      setComposer({
        selection: detail.selection,
        clientX: typeof detail.clientX === 'number' ? detail.clientX : 0,
        clientY: typeof detail.clientY === 'number' ? detail.clientY : 0,
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
        text,
      };
      if (typeof window === 'undefined') return;
      // Shell relays into the WS `comments-add` channel and persists.
      try {
        window.parent.postMessage({ dgn: 'comment-submit', payload }, '*');
      } catch {
        /* parent detached */
      }
      closeComposer();
    },
    [composer, closeComposer]
  );

  // Self-heal fetch — covers the race where the iframe loads before the shell
  // pushes `comments-set` (e.g. first hydration on cold open).
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/_comments?file=${encodeURIComponent(file)}`);
        if (!r.ok) return;
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
  const visible = useMemo(() => {
    const list = comments.slice().sort((a, b) => a.created.localeCompare(b.created));
    return list.filter((c) => c.status !== 'resolved');
  }, [comments]);

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

  const handlePatch = useCallback((id: string, patch: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;
    try {
      window.parent.postMessage({ dgn: 'comment-patch', id, patch }, '*');
    } catch {
      /* parent detached */
    }
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (typeof window === 'undefined') return;
    try {
      window.parent.postMessage({ dgn: 'comment-delete', id }, '*');
    } catch {
      /* parent detached */
    }
    setFocusedId((prev) => (prev === id ? null : prev));
  }, []);

  const handleReply = useCallback(async (id: string, body: string): Promise<boolean> => {
    if (typeof fetch === 'undefined') return false;
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
  }, []);

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
            onOrphaned={handleDelete}
          />
        );
      })}
      {composer ? (
        <CommentComposer state={composer} onSubmit={submitComposer} onCancel={closeComposer} />
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
            mine={
              !isReadOnlyCanvas() &&
              !!(me ?? collab?.myName) &&
              (focused.author ?? '').trim() === (me ?? collab?.myName ?? '').trim()
            }
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

interface CommitterRow {
  name: string;
  email: string;
  commits: number;
}

let committerCache: Promise<CommitterRow[]> | null = null;
async function loadCommitters(): Promise<CommitterRow[]> {
  if (!committerCache) {
    committerCache = (async () => {
      try {
        const r = await fetch('/_api/git-committers');
        if (!r.ok) return [];
        const data = (await r.json()) as { committers?: CommitterRow[] };
        return Array.isArray(data.committers) ? data.committers : [];
      } catch {
        return [];
      }
    })();
  }
  return committerCache;
}

function firstNameSlug(name: string): string {
  // `@firstname` is what we insert on accept. Strip surnames + punctuation.
  const first = name.trim().split(/\s+/)[0] ?? '';
  // Keep alphanum + `.` `-` `_` (matches the parseMentions regex on the server).
  return first.replace(/[^\w.-]/g, '').toLowerCase();
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
}): React.ReactElement {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      internalRef.current = el;
      if (textareaRef) textareaRef.current = el;
    },
    [textareaRef]
  );

  const [committers, setCommitters] = useState<CommitterRow[]>([]);
  const [token, setToken] = useState<MentionToken | null>(null);
  const [highlight, setHighlight] = useState(0);

  // Lazy-load committers on first focus.
  const onFocus = useCallback(() => {
    if (committers.length > 0) return;
    void loadCommitters().then((list) => setCommitters(list));
  }, [committers.length]);

  const filtered = useMemo(() => {
    if (!token) return [] as CommitterRow[];
    const q = token.query.toLowerCase();
    const list = !q
      ? committers
      : committers.filter(
          (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
        );
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
    (committer: CommitterRow) => {
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
                key={`${c.name}-${c.email}`}
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
                <span className="cm-mention-popup__email">{c.email}</span>
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

// How long a pin is allowed to stay unresolvable (no live target AND no
// structural-fallback match) before its comment is presumed orphaned and
// auto-deleted. Long enough to ride out a canvas HMR remount; short enough
// that a genuinely deleted element's comment doesn't linger.
const ORPHAN_GRACE_MS = 3000;

function CommentPin({
  comment,
  sequence,
  focused,
  onClick,
  onOrphaned,
}: {
  comment: OverlayComment;
  sequence: number;
  focused: boolean;
  onClick: (id: string) => void;
  onOrphaned: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const unresolvedSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      rafRef.current = null;
      const pin = ref.current;
      if (!pin) return;

      // Live screen-coord lookup mirrors SelectionHalos in canvas-shell.tsx
      // (resolveCommentTarget tries the stored selector, then a structural
      // fallback). Falls back to stored bounds (a screen-coord capture at
      // create time) when neither resolves — better than vanishing entirely.
      let pos = screenRectFor(comment);
      if (pos) {
        unresolvedSinceRef.current = null;
      } else {
        if (unresolvedSinceRef.current == null) {
          unresolvedSinceRef.current = Date.now();
        } else if (Date.now() - unresolvedSinceRef.current > ORPHAN_GRACE_MS) {
          onOrphaned(comment.id);
        }
        if (comment.bounds) {
          pos = {
            x: comment.bounds.x,
            y: comment.bounds.y,
            w: comment.bounds.w,
            h: comment.bounds.h,
          };
        }
      }
      if (!pos) {
        pin.style.display = 'none';
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      pin.style.display = 'grid';
      // Position the pin's center at (right - 12, top - 12) — the FigJam
      // convention. 12 = half of 24 (the pin's own size).
      const left = Math.round(pos.x + pos.w - 12);
      const top = Math.round(pos.y - 12);
      pin.style.left = `${left}px`;
      pin.style.top = `${top}px`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [comment, onOrphaned]);

  const author = comment.author?.trim() || 'unknown';
  const label = `Comment ${sequence} by ${author}`;

  return (
    <button
      ref={ref}
      type="button"
      className="cm-pin"
      data-resolved={comment.status === 'resolved' ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
      data-comment-pin={comment.id}
      aria-label={label}
      aria-expanded={focused}
      title={comment.text.slice(0, 200)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(comment.id);
      }}
    >
      {sequence}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommentComposer — DS-styled card anchored just under the clicked element
// (or at the click point if the click hit empty canvas). Edge-clamp is the
// pragmatic kind: position is computed once on open against the world layout,
// not chased on pan/zoom — the user is actively typing.

function CommentComposer({
  state,
  onSubmit,
  onCancel,
}: {
  state: ComposerState;
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
    if (!v) return;
    onSubmit(v);
  }, [text, onSubmit]);

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

  // Compact selector hint — strip noisy structural bits so the head stays
  // tight inside the 300px card.
  const selectorChip = useMemo(() => {
    const s = state.selection.selector || '';
    if (!s) return state.selection.tag || 'canvas';
    // [data-cd-id="…"] → cd:<id> · keeps the chip readable when stable ids
    // are present.
    const cd = s.match(/data-cd-id="([^"]+)"/);
    if (cd) return `cd:${cd[1]}`;
    return s.length > 36 ? `${s.slice(0, 33)}…` : s;
  }, [state.selection]);

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
        <span>New comment</span>
        <span className="cm-composer__selector">{selectorChip}</span>
      </div>
      <MentionAwareTextarea
        textareaRef={textareaRef}
        className="cm-composer__textarea"
        value={text}
        placeholder="Type a comment. ⌘↵ to save · Esc to cancel · @name to tag"
        onChange={setText}
        onKeyDown={onKeyDown}
        rows={3}
        ariaLabel="Comment body"
      />
      <div className="cm-composer__actions">
        <button type="button" className="cm-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="cm-btn cm-btn--primary"
          disabled={!text.trim()}
          onClick={trySubmit}
        >
          Save
        </button>
      </div>
    </div>
  );
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
  mine = false,
}: {
  comment: OverlayComment;
  sequence: number;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onReply: (body: string) => Promise<boolean>;
  /** The person looking wrote this comment — they may edit its text. */
  mine?: boolean;
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
  const selectorChip = formatSelectorChip(comment.selector, '');

  return (
    <div
      ref={dialogRef}
      className="cm-thread"
      role="dialog"
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
          <span className="cm-thread__author">{comment.author?.trim() || 'unknown'}</span>
          <span className="cm-thread__time">{formatRelativeTime(comment.created)}</span>
          <button
            type="button"
            className="cm-thread__close"
            aria-label="Close thread"
            title="Close · Esc"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {selectorChip ? <code className="cm-thread__selector">{selectorChip}</code> : null}
      </div>

      {draft === null ? (
        <div className="cm-thread__body">{renderBodyWithMentions(comment.text)}</div>
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

      {(comment.thread ?? []).map((r) => (
        <div className="cm-thread__reply" key={r.id}>
          <div className="cm-thread__reply-head">
            <span className="cm-thread__reply-author">{r.author?.trim() || 'unknown'}</span>
            <span className="cm-thread__reply-time">{formatRelativeTime(r.created)}</span>
          </div>
          <div className="cm-thread__reply-body">{renderBodyWithMentions(r.body)}</div>
        </div>
      ))}

      {/* Cloud Phase 25 C2 — a read-only session VIEWS threads; reply /
          resolve / delete are absent until C3 puts comments on the cell's
          read-only allowlist (the cell refuses them today). */}
      {!isReadOnlyCanvas() && (
        <>
          <div className="cm-thread__reply-form">
            <MentionAwareTextarea
              textareaRef={replyRef}
              className="cm-thread__reply-textarea"
              value={reply}
              placeholder="Reply… ⌘↵ to send · @name to tag"
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

          <div className="cm-thread__actions">
            {mine && draft === null ? (
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
              <button type="button" className="cm-btn" onClick={() => onPatch({ status: 'open' })}>
                ↺ Reopen
              </button>
            ) : (
              <button
                type="button"
                className="cm-btn cm-btn--primary"
                onClick={() => {
                  onPatch({ status: 'resolved' });
                  onClose();
                }}
              >
                ✓ Resolve
              </button>
            )}
            <button
              type="button"
              className="cm-btn cm-btn--danger"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Body renderer — splits text on @-handles, wraps each in <strong>. Anything
// not matching the mention regex stays plain text (newlines preserved by CSS
// `white-space: pre-wrap`).

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

function formatSelectorChip(selector: string, fallback: string): string {
  if (!selector) return fallback;
  const cd = selector.match(/data-cd-id="([^"]+)"/);
  if (cd) return `cd:${cd[1]}`;
  return selector.length > 36 ? `${selector.slice(0, 33)}…` : selector;
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
