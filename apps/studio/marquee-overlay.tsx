/**
 * @file       marquee-overlay.tsx — T26 (Wave 3)
 * @scope      apps/studio/marquee-overlay.tsx
 * @purpose    Element-level marquee selection. Drag from empty padding inside
 *             an artboard body (NOT on top of a `[data-cd-id]` element) to
 *             lasso multiple stamped elements. Aseprite modifier vocabulary:
 *             bare = replace, Shift = add, Alt = subtract, Shift+Alt =
 *             intersect. Modifier state re-read at pointerup so the user can
 *             flip mid-drag.
 *
 *             Co-exists with `artboard-marquee.tsx` — that overlay triggers
 *             when pointerdown lands OUTSIDE any artboard (empty world);
 *             this overlay triggers when pointerdown lands INSIDE an artboard
 *             body on padding (no cd-id under cursor). The two are mutually
 *             exclusive by start position.
 *
 *             Renders the marquee rect per DDR-046 rev 2:
 *                 1 px solid accent + 8 % accent fill
 *             (same idiom as artboard marquee — active gesture is solid +
 *             tinted; dashed reserved for persistent group bbox.)
 */

import { useEffect, useRef } from 'react';

import { scopedCdSelector, selectorIndex } from './dom-selection.ts';
import { DRAG_THRESHOLD_PX } from './input-router.tsx';
import { type Selection, useSelectionSet } from './use-selection-set.tsx';
import { useToolMode } from './use-tool-mode.tsx';

const ELEM_MARQUEE_CSS = `
.dc-cv-elem-marquee {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  border: 1px solid var(--maude-hud-accent, #0d99ff);
  background: color-mix(in oklab, var(--maude-hud-accent, #0d99ff) 8%, transparent);
  display: none;
}
`.trim();

function ensureMarqueeStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-cv-elem-marquee-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-cv-elem-marquee-css';
  s.textContent = ELEM_MARQUEE_CSS;
  document.head.appendChild(s);
}

// Skip the same chrome / overlay surfaces as artboard-marquee — the user is
// interacting with floating UI, not the world.
export function isChromeTarget(t: EventTarget | null): boolean {
  if (!t || !(t as Element).closest) return true;
  const el = t as Element;
  if (
    el.closest(
      '.dc-mm, .dc-zoom-tb, .dc-tool-palette, .dc-context-menu, .dc-cv-halo, .dc-cv-group-bbox, .cm-composer, .cm-thread, .cm-mention-popup, .cm-pin, .dc-annot-svg, .dc-annot-ctx, .dc-tp-popover, .dc-annot-resize-handle, .dc-el-resize-handle, .dc-multi-artboard-tb, .dc-elem-ctx-tb, .dc-cv-eq-spacing-layer, .ed-pen-svg'
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Walk from `hit` upward and decide if the pointerdown landed on "empty body
 * padding" (no `[data-cd-id]` encountered before reaching `.dc-artboard-body`).
 * Returns the body element when yes; null when the pointerdown should not
 * start an element marquee.
 */
function resolveBodyOrNull(hit: Element): Element | null {
  let cur: Element | null = hit;
  while (cur) {
    if (cur.hasAttribute?.('data-cd-id')) return null; // on user content
    if ((cur as HTMLElement).classList?.contains('dc-artboard-body')) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Mode resolved from the current modifier state. Re-read at pointerup so a
 * user can flip mid-drag — e.g. start without modifiers, press Shift before
 * releasing, the gesture commits as `add` instead of `replace`.
 */
type Mode = 'replace' | 'add' | 'subtract' | 'intersect';

function modeOf(e: { shiftKey: boolean; altKey: boolean }): Mode {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return 'replace';
}

/**
 * Build a minimal `Selection` from a `[data-cd-id]` element — just the fields
 * downstream consumers actually read for bulk marquee hits. The rich shape
 * (html, dom_path, text) is only enriched when a single click sets focus
 * through `hoverTargetToSelection`.
 */
function elementToSelection(el: Element, bodyAncestor: Element): Selection | null {
  const cdId = el.getAttribute('data-cd-id');
  if (!cdId) return null;
  const artboardEl = bodyAncestor.closest('[data-dc-screen]');
  const artboardId = artboardEl?.getAttribute('data-dc-screen') ?? null;
  const rect = (el as HTMLElement).getBoundingClientRect();
  const marqueeSelector = scopedCdSelector(cdId, artboardId);
  return {
    id: cdId,
    selector: marqueeSelector,
    artboardId,
    index: selectorIndex(document, marqueeSelector, el),
    tag: el.tagName.toLowerCase(),
    classes: (el.getAttribute('class') ?? '')
      .trim()
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('dgn-') && !c.startsWith('dc-cv-'))
      .join(' '),
    bounds: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
  };
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): boolean {
  if (a.right < b.left || a.left > b.right) return false;
  if (a.bottom < b.top || a.top > b.bottom) return false;
  return true;
}

export function ElementMarqueeOverlay() {
  ensureMarqueeStyles();
  const selSet = useSelectionSet();
  const { tool } = useToolMode();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    crossed: boolean;
    bodyEl: Element;
    /** Snapshot of `selSet.selected` at gesture start — needed for subtract /
     *  intersect / add to compute deltas against the original set. */
    startSet: Selection[];
  } | null>(null);

  useEffect(() => {
    if (tool !== 'move') return;
    if (typeof document === 'undefined') return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Cmd / Ctrl reserved for single-element select (Cmd-click). Never start
      // an element marquee when those are held — that gesture means "select
      // the single element under cursor."
      if (e.metaKey || e.ctrlKey) return;
      const target = e.target as Element | null;
      if (!target || isChromeTarget(target)) return;
      const bodyEl = resolveBodyOrNull(target);
      if (!bodyEl) return; // either over user content or outside any artboard
      stateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        crossed: false,
        bodyEl,
        startSet: selSet.selected.slice(),
      };
    };

    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (!s.crossed) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        s.crossed = true;
      }
      const div = overlayRef.current;
      if (!div) return;
      const left = Math.min(s.startX, e.clientX);
      const top = Math.min(s.startY, e.clientY);
      div.style.display = 'block';
      div.style.left = `${left}px`;
      div.style.top = `${top}px`;
      div.style.width = `${Math.abs(dx)}px`;
      div.style.height = `${Math.abs(dy)}px`;
    };

    const finish = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      stateRef.current = null;
      const div = overlayRef.current;
      if (div) div.style.display = 'none';
      if (!s.crossed) return;

      const left = Math.min(s.startX, e.clientX);
      const top = Math.min(s.startY, e.clientY);
      const right = Math.max(s.startX, e.clientX);
      const bottom = Math.max(s.startY, e.clientY);
      const marqueeBox = { left, top, right, bottom };

      // Intersect against every stamped element inside the originating
      // artboard body. Scoping to the start body is intentional — drags
      // that extend across artboards still only capture from the artboard
      // the gesture started in. Cross-artboard marquee is an unimplemented
      // affordance (no peer tool ships it; users rely on multi-artboard
      // distribute + per-artboard marquees).
      const stamped = s.bodyEl.querySelectorAll('[data-cd-id]');
      const hits: Selection[] = [];
      for (const el of stamped) {
        const b = (el as HTMLElement).getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (!rectsIntersect(marqueeBox, b)) continue;
        const sel = elementToSelection(el, s.bodyEl);
        if (sel) hits.push(sel);
      }

      const mode = modeOf(e);
      applyMarqueeMode(selSet, mode, s.startSet, hits);
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
    };
  }, [tool, selSet]);

  return <div ref={overlayRef} className="dc-cv-elem-marquee" aria-hidden="true" />;
}

/**
 * Apply marquee hits to `selSet` per Aseprite modifier semantics. Pulled out
 * of the hook for unit-test reachability.
 */
export function applyMarqueeMode(
  selSet: {
    replace: (s: Selection | Selection[]) => void;
    add: (s: Selection | Selection[]) => void;
  },
  mode: Mode,
  startSet: Selection[],
  hits: Selection[]
): void {
  if (mode === 'replace') {
    if (hits.length === 0) return; // empty marquee preserves selection
    selSet.replace(hits);
    return;
  }
  if (mode === 'add') {
    if (hits.length === 0) return;
    selSet.add(hits);
    return;
  }
  if (mode === 'subtract') {
    const keyOf = (x: Selection) => (x.id ? `id:${x.id}` : `sel:${x.selector}`);
    const removeKeys = new Set(hits.map(keyOf));
    const next = startSet.filter((x) => !removeKeys.has(keyOf(x)));
    selSet.replace(next);
    return;
  }
  // intersect
  const keyOf = (x: Selection) => (x.id ? `id:${x.id}` : `sel:${x.selector}`);
  const hitKeys = new Set(hits.map(keyOf));
  const next = startSet.filter((x) => hitKeys.has(keyOf(x)));
  selSet.replace(next);
}

export type { Mode };
// Re-export for tests.
export { modeOf };
