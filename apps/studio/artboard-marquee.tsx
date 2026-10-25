/**
 * @file       artboard-marquee.tsx — Task 24 sub-item (Wave 2 follow-up, G8)
 * @scope      apps/studio/artboard-marquee.tsx
 * @purpose    Drag-to-lasso multi-select for artboards. Bare-button pointerdown
 *             on empty world (NOT inside any artboard, NOT on floating chrome)
 *             starts a marquee. 4 px drag threshold suppresses click jitter.
 *             pointerup intersects the marquee AABB with every artboard's
 *             screen-coord bbox; hits become Selection entries with
 *             `artboardId` set. Modifier semantics — bare = replace, Shift
 *             = add (Alt-subtract / Shift+Alt-intersect are deferred).
 *
 *             The marquee rect itself follows DDR-046 rev 2: 1 px solid
 *             accent border + 8 % accent fill. SOLID, not dashed — solid +
 *             tinted fill = "active gesture" idiom, dashed = persistent
 *             group bbox.
 */

import { useEffect, useRef } from 'react';

import { useArtboardsContext } from './canvas-lib.tsx';
import { hoverTargetToSelection } from './dom-selection.ts';
import { DRAG_THRESHOLD_PX } from './input-router.tsx';
import { type Selection, useSelectionSet } from './use-selection-set.tsx';
import { useToolMode } from './use-tool-mode.tsx';

/**
 * The whole-artboard selection a marquee hit makes. P8 C7 (14 ed-ab-tidy): the SAME snapshot a click on the
 * artboard makes — its attrs (kind, print, bg), world size and geometry — because the inspector's multi-artboard
 * card compares them (a slim `{selector, artboardId}` read "Size — × —" where the board says a shared size or Mixed).
 */
export function artboardHit(el: Element, id: string): Selection {
  return {
    ...hoverTargetToSelection({ el, cdId: null, artboardId: id } as never),
    selector: `[data-dc-screen="${id}"]`,
    artboardId: id,
  };
}

const MARQUEE_CSS = `
.dc-cv-marquee {
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
  if (document.getElementById('dc-cv-marquee-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-cv-marquee-css';
  s.textContent = MARQUEE_CSS;
  document.head.appendChild(s);
}

export function shouldIgnoreTarget(t: EventTarget | null): boolean {
  if (!t || !(t as Element).closest) return true;
  const el = t as Element;
  // Skip if the pointerdown landed inside any artboard — that's a select-
  // or-drag gesture, not a marquee. Same hard ceiling as resolveHoverTarget.
  if (el.closest('[data-dc-screen]')) return true;
  // Skip floating chrome and existing overlays (their click handlers run).
  if (
    el.closest(
      '.dc-mm, .dc-zoom-tb, .dc-tool-palette, .dc-context-menu, .dc-cv-halo, .dc-cv-group-bbox, .cm-composer, .cm-thread, .cm-mention-popup, .cm-pin, .dc-annot-svg, .dc-annot-ctx, .dc-tp-popover, .dc-annot-resize-handle, .dc-el-resize-handle, .dc-multi-artboard-tb, .dc-elem-ctx-tb, .dc-cv-eq-spacing-layer, .ed-pen-svg'
    )
  ) {
    return true;
  }
  return false;
}

export function ArtboardMarqueeOverlay() {
  ensureMarqueeStyles();
  const selSet = useSelectionSet();
  const artboardsCtx = useArtboardsContext();
  const { tool } = useToolMode();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    crossed: boolean;
    shift: boolean;
  } | null>(null);

  useEffect(() => {
    if (tool !== 'move') return;
    if (typeof document === 'undefined') return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Bare or Shift only — Cmd/Ctrl/Alt clicks belong to other gestures
      // (Cmd-select, Alt-copy-drag) and shouldn't start a marquee.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shouldIgnoreTarget(e.target)) return;
      stateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        crossed: false,
        shift: e.shiftKey,
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
        // Per post-Wave-2 feedback, the marquee never pre-emptively clears
        // the existing selection. The set is only updated on pointerup if
        // the marquee actually captured something — empty-marquee + bare-
        // click preserve the previous selection. Esc is the only deselect.
      }
      const div = overlayRef.current;
      if (!div) return;
      const left = Math.min(s.startX, e.clientX);
      const top = Math.min(s.startY, e.clientY);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      div.style.display = 'block';
      div.style.left = `${left}px`;
      div.style.top = `${top}px`;
      div.style.width = `${w}px`;
      div.style.height = `${h}px`;
    };

    const finish = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      stateRef.current = null;
      const div = overlayRef.current;
      if (div) div.style.display = 'none';
      if (!s.crossed) {
        // Bare click on empty world without drag → clear selection
        // (post-Wave-3 user feedback). Shift-click preserves it.
        if (!s.shift) selSet.clear();
        return;
      }
      if (!artboardsCtx) return;

      // Intersect the marquee AABB with each artboard's screen-coord bbox.
      // getBoundingClientRect on the article reads the post-zoom, post-pan
      // screen position — exactly what we want, no manual world↔screen math.
      const left = Math.min(s.startX, e.clientX);
      const top = Math.min(s.startY, e.clientY);
      const right = Math.max(s.startX, e.clientX);
      const bottom = Math.max(s.startY, e.clientY);
      const hits: Selection[] = [];
      for (const r of artboardsCtx.artboards) {
        const el = document.querySelector(`[data-dc-screen="${r.id}"]`);
        if (!el) continue;
        const b = (el as HTMLElement).getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        // AABB intersection test — any overlap counts as a hit.
        if (b.right < left || b.left > right) continue;
        if (b.bottom < top || b.top > bottom) continue;
        hits.push(artboardHit(el, r.id));
      }
      if (hits.length === 0) return;
      if (s.shift) selSet.add(hits);
      else selSet.replace(hits);
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
  }, [tool, selSet, artboardsCtx]);

  return <div ref={overlayRef} className="dc-cv-marquee" aria-hidden="true" />;
}
