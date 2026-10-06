/**
 * @file       text-caret.ts — shared custom blinking caret for every editable
 *             text surface (artboard inline edit + the four annotation editors)
 * @purpose    Native caret BLINK is unreliable in WebKit under the transformed
 *             `.dc-world` (a compositing trigger on/near the editable freezes
 *             the blink to a static line — see CARET_FIX_STYLE in
 *             annotations-layer.tsx for the translateZ(0) post-mortem), and
 *             blink is temporal, so no automated tool can assert it. This
 *             module replaces the native caret with a CSS-animated
 *             `[data-maude-caret]` element: engine-independent, identical on
 *             every surface, and harness-assertable (presence + animationName
 *             + position). The native caret is hidden via
 *             `caret-color: transparent` while mounted.
 *
 * Positioning model: the caret element is appended to the document BODY with
 * `position: fixed` and placed from the live selection's client rects —
 * viewport coords, already post-transform, so the world's pan/zoom needs no
 * special-casing. Positioning is driven THREE ways, deliberately redundant:
 * a synchronous first paint on mount, the discrete event set (selectionchange
 * / input / keyup / focus / blur / scroll), and a rAF loop for pan/zoom
 * (which fires no DOM event). rAF alone is NOT enough — WKWebView pauses rAF
 * for occluded windows (measured in the desktop-e2e harness), which would
 * leave the caret invisible. Style is only touched on an actual rect change,
 * and a change restarts the blink cycle exactly like a native caret (solid
 * while typing/moving).
 */

/**
 * Place a collapsed caret inside a contentEditable at a viewport point —
 * `caretRangeFromPoint` (WebKit/Chromium), `caretPositionFromPoint`
 * (standard) fallback — THE unified entry-placement chain for the artboard
 * inline editor and every annotation editor. A point that resolves outside
 * the editable (click on padding / another element) is a miss. Without a
 * point, or on a miss with `fallbackToSelectAll`, selects the whole content
 * (the right default for keyboard entry, where select-all-then-retype is the
 * rename convention). Returns true when a caret/selection was applied.
 */
export function placeCaretAt(
  editable: HTMLElement,
  win: Window,
  point?: { x: number; y: number },
  fallbackToSelectAll = true
): boolean {
  const doc = editable.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  try {
    let range: Range | null = null;
    if (point) {
      if (typeof doc.caretRangeFromPoint === 'function') {
        range = doc.caretRangeFromPoint(point.x, point.y);
      } else if (typeof doc.caretPositionFromPoint === 'function') {
        const pos = doc.caretPositionFromPoint(point.x, point.y);
        if (pos) {
          range = doc.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (range && !editable.contains(range.startContainer)) range = null;
    }
    if (!range) {
      if (!fallbackToSelectAll) return false;
      range = doc.createRange();
      range.selectNodeContents(editable);
    }
    const sel = win.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    /* selection API unavailable */
    return false;
  }
}

/**
 * Collapse an ENTRY select-all to the end of the content, if that is what the
 * selection still is. issue-106: keyboard entry into a text surface (select the
 * stroke, press Enter) leaves `placeCaretAt`'s select-all fallback in place, so
 * the first keystroke replaces the whole body — which is exactly what the
 * retype/rename convention wants for a typed CHARACTER, but never for
 * Shift+Enter, whose entire documented meaning is "add a new line". Without
 * this, Shift+Enter deleted the note and left a blank line in its place.
 *
 * Deliberately narrow: only a selection whose boundaries are still BOTH ends of
 * the editable is collapsed. A user's own drag-selection or a partial range is
 * left alone, so ordinary "replace the selected words" editing keeps native
 * semantics. Returns true when it collapsed something.
 */
export function collapseEntrySelectAll(editable: HTMLElement, win: Window): boolean {
  try {
    const sel = win.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const cur = sel.getRangeAt(0);
    const all = editable.ownerDocument.createRange();
    all.selectNodeContents(editable);
    // Range.START_TO_START / END_TO_END via the instance so no global lookup is
    // needed (the editable may live in another document/realm).
    if (cur.compareBoundaryPoints(cur.START_TO_START, all) !== 0) return false;
    if (cur.compareBoundaryPoints(cur.END_TO_END, all) !== 0) return false;
    all.collapse(false); // to the end
    sel.removeAllRanges();
    sel.addRange(all);
    return true;
  } catch {
    /* selection API unavailable */
    return false;
  }
}

const STYLE_ID = 'maude-caret-css';

const CARET_CSS = `
[data-maude-caret] {
  animation: maude-caret-blink 1s steps(1, end) infinite;
}
@keyframes maude-caret-blink {
  0%, 49.9% { opacity: 1; }
  50%, 99.9% { opacity: 0; }
  100% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  /* No blink, but the caret stays visible — position is still the signal. */
  [data-maude-caret] { animation: none; }
}
`;

function ensureCaretStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CARET_CSS;
  doc.head.appendChild(style);
}

interface CaretRect {
  x: number;
  y: number;
  h: number;
}

/** Resolve where the caret should paint, in viewport coords — or null when it
 * should hide (no collapsed selection inside the editable / editable not
 * focused / a range selection is active, where the native highlight is the
 * affordance). */
function caretRectFor(editable: HTMLElement, win: Window): CaretRect | 'native' | null {
  const doc = editable.ownerDocument;
  const active = doc.activeElement;
  if (active !== editable && !editable.contains(active)) return null;
  const sel = win.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || !editable.contains(node)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  // A collapsed range usually has one zero-width client rect; WebKit sometimes
  // returns none (empty text node / line start) — getBoundingClientRect is the
  // second try before falling back to the editable's own box metrics.
  let r: DOMRect | null = range.getClientRects()[0] ?? null;
  if (!r || (r.height === 0 && r.y === 0 && r.x === 0)) {
    const br = range.getBoundingClientRect();
    if (br && br.height > 0) r = br;
  }
  if (r && r.height > 0) return { x: r.left, y: r.top, h: r.height };
  // A caret on a line with no text box yet — Shift+Enter's "\n" puts it at
  // the start of an empty last line — has no client rect in Chromium or
  // WebKit. Guessing a position from the editable's box painted it back at
  // the top-left of line ONE (the "Shift+Enter throws the cursor somewhere
  // weird" report). Only the engine knows where that caret is, so hand the
  // caret back to it: the native caret shows until a rect exists again.
  if ((editable.textContent ?? '').replace(/\u200b/g, '') !== '') return 'native';
  // Empty editable — no rect exists anywhere. Derive a caret box from the
  // editable's padding box + line metrics. (The annotation editors avoid this
  // path by mounting with a zero-width-space JUMP_SENTINEL, but the artboard
  // editor can reach it by deleting all text.)
  const er = editable.getBoundingClientRect();
  const cs = win.getComputedStyle(editable);
  const fs = Number.parseFloat(cs.fontSize) || 14;
  const lh = cs.lineHeight === 'normal' ? fs * 1.25 : Number.parseFloat(cs.lineHeight) || fs * 1.25;
  const padL = Number.parseFloat(cs.paddingLeft) || 0;
  const padT = Number.parseFloat(cs.paddingTop) || 0;
  return { x: er.left + padL, y: er.top + padT, h: lh };
}

/**
 * Mount the custom blinking caret onto a contentEditable. Returns a disposer
 * that removes the caret element and restores the editable's own caret-color.
 * One mount per editing session — enter-edit mounts, teardown disposes.
 */
export function mountCaret(editable: HTMLElement, win: Window): () => void {
  const doc = editable.ownerDocument;
  if (!doc.body) return () => {};
  ensureCaretStyles(doc);

  const caret = doc.createElement('span');
  caret.setAttribute('data-maude-caret', '1');
  caret.setAttribute('aria-hidden', 'true');
  Object.assign(caret.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '2px',
    height: '16px',
    background: 'var(--maude-hud-accent, #4a63e7)',
    borderRadius: '1px',
    pointerEvents: 'none',
    zIndex: '9999',
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  doc.body.appendChild(caret);

  const prevCaretColor = editable.style.caretColor;
  editable.style.caretColor = 'transparent';

  let shown = false;
  let last: CaretRect = { x: -1, y: -1, h: -1 };

  const restartBlink = (): void => {
    // Re-trigger the stylesheet animation from 0% so the caret is solid right
    // after a move/keystroke — the native caret's exact behavior.
    caret.style.animation = 'none';
    void caret.offsetWidth; // reflow flushes the 'none'
    caret.style.animation = '';
  };

  const position = (): void => {
    const rc = caretRectFor(editable, win);
    // The engine's own caret, while ours can't be placed (see caretRectFor).
    editable.style.caretColor = rc === 'native' ? prevCaretColor || 'auto' : 'transparent';
    if (!rc || rc === 'native') {
      if (shown) {
        caret.style.display = 'none';
        shown = false;
      }
    } else {
      if (rc.x !== last.x || rc.y !== last.y || rc.h !== last.h) {
        caret.style.left = `${rc.x - 0.5}px`;
        caret.style.top = `${rc.y}px`;
        caret.style.height = `${Math.max(8, rc.h)}px`;
        last = rc;
        restartBlink();
      }
      if (!shown) {
        caret.style.display = 'block';
        shown = true;
      }
    }
  };

  // Synchronous first paint + discrete events carry the caret even when rAF
  // is throttled (WKWebView pauses rAF for occluded windows — measured in the
  // desktop-e2e harness); the rAF loop on top tracks pan/zoom, which fires no
  // DOM event at all.
  const onUpdate = (): void => position();
  doc.addEventListener('selectionchange', onUpdate);
  editable.addEventListener('input', onUpdate);
  editable.addEventListener('keyup', onUpdate);
  editable.addEventListener('focus', onUpdate);
  editable.addEventListener('blur', onUpdate);
  win.addEventListener('scroll', onUpdate, true);
  let raf = 0;
  const tick = (): void => {
    position();
    raf = win.requestAnimationFrame(tick);
  };
  position();
  raf = win.requestAnimationFrame(tick);

  return () => {
    win.cancelAnimationFrame(raf);
    doc.removeEventListener('selectionchange', onUpdate);
    editable.removeEventListener('input', onUpdate);
    editable.removeEventListener('keyup', onUpdate);
    editable.removeEventListener('focus', onUpdate);
    editable.removeEventListener('blur', onUpdate);
    win.removeEventListener('scroll', onUpdate, true);
    caret.remove();
    editable.style.caretColor = prevCaretColor;
  };
}
