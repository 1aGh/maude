/**
 * @file       use-spacing-handles.tsx — Stage J (feature-element-editing-robustness)
 * @scope      apps/studio/use-spacing-handles.tsx
 * @purpose    On-canvas padding + gap drag. 4 small padding-edge handles (always,
 *             for the single selected element) + one dot per flex gap (only when
 *             the element is a flex/inline-flex container with ≥2 children).
 *             Live preview via direct inline-style writes (mirrors
 *             `use-element-resize.tsx`'s `applyPreview`); commit rides the SAME
 *             `resize-request` lane the element-resize overlay already uses —
 *             `padding-top/right/bottom/left`/`gap` were added to the shell's
 *             `resizeElement` allowed-prop list, so this needed no new write
 *             surface. A component-instance drag threads the Stage H3 occurrence
 *             index the same way (`globalCdOccurrence`) so it stays local.
 *
 *             CSS-Grid gap editing is out of v1 scope — grid tracks are a
 *             separate follow-up plan (`feature-grid-track-editor.md`, Stage M3).
 */

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { globalCdOccurrence, resolveSelectionEl } from './dom-selection.ts';
import { isElementDragActive } from './drag-state.ts';
import { layoutOpsDeps } from './editing/reorder-slot.tsx';
import { framesWithGap, runSetGap } from './editing/set-gap.ts';
import {
  gapValue,
  rulerWindow,
  spaceStops,
  spaceTokenFor,
  tokenRuler,
} from './editing/token-ruler.tsx';
import {
  computeGapDrag,
  computeGapMidpoints,
  computePaddingDrag,
  computePaddingLines,
  flexMainAxis,
  type PaddingSide,
  paddingSideSet,
} from './spacing-handles.ts';
import { worldZoomFor } from './use-element-resize.tsx';
import { useSelectionSet } from './use-selection-set.tsx';
import { useToolMode } from './use-tool-mode.tsx';

const SPACING_CSS = `
.dc-spacing-handle {
  position: fixed;
  transform: translate(-50%, -50%);
  /* Below the Stage-D resize handles (z-index 6) — at 0 padding a spacing
     handle sits exactly on the border, where a resize mid-edge handle also
     lives; the resize handle should win that hit-test tie. */
  z-index: 4;
  pointer-events: auto;
  touch-action: none;
  /* INV-2 — the idle-to-hover/dragging opacity bump (0.55/0.7 to 1, below) had
     no transition, so the reduced-motion collapse further down was dead code
     (nothing to collapse). Kept as a plain opacity transition, not a reveal/
     unmount fade — this component still hard-toggles display to show/hide
     the whole handle set (unlike the resize overlay's fade), so a handle is
     grabbable the instant it appears, no half-visible window. */
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-spacing-handle--padding {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--maude-hud-accent, oklch(0.680 0.180 268));
  border: 1px solid var(--maude-hud-accent-fg, oklch(0.180 0.030 268));
  opacity: 0.55;
}
.dc-spacing-handle--padding:hover,
.dc-spacing-handle--padding[data-dragging="true"] { opacity: 1; }
.dc-spacing-handle--padding[data-side="top"],
.dc-spacing-handle--padding[data-side="bottom"] { cursor: ns-resize; }
.dc-spacing-handle--padding[data-side="left"],
.dc-spacing-handle--padding[data-side="right"] { cursor: ew-resize; }
.dc-spacing-handle--gap {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #FF24BD;
  border: 1px solid rgba(255, 255, 255, 0.85);
  opacity: 0.7;
}
.dc-spacing-handle--gap:hover,
.dc-spacing-handle--gap[data-dragging="true"] { opacity: 1; }
.dc-spacing-handle--gap[data-axis="x"] { cursor: ew-resize; }
.dc-spacing-handle--gap[data-axis="y"] { cursor: ns-resize; }
@media (prefers-reduced-motion: reduce) {
  .dc-spacing-handle { transition-duration: 1ms; }
}
`.trim();

function ensureSpacingStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-spacing-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-spacing-css';
  s.textContent = SPACING_CSS;
  document.head.appendChild(s);
}

function computedPx(cs: CSSStyleDeclaration, prop: string): number {
  return Number.parseFloat(cs.getPropertyValue(prop)) || 0;
}

interface SpacingDrag {
  pointerId: number;
  kind: 'padding' | 'gap';
  side: PaddingSide | null;
  axis: 'x' | 'y';
  el: HTMLElement;
  cdId: string;
  idIndex: number;
  startClientX: number;
  startClientY: number;
  zoom: number;
  startValue: number;
  /** The single CSS property this drag writes — `padding-<side>` or `gap`. */
  prop: string;
  /** Inline value BEFORE the drag (`el.style.getPropertyValue(prop)` or null). */
  before: string | null;
  /** All 4 padding sides' inline values BEFORE the drag — for the Alt (pair) /
   *  Alt+Shift (all) box-model modifiers (`paddingSideSet`), which can touch
   *  sides OTHER than the one grabbed. Undefined for a gap drag. */
  paddingBefore?: Record<PaddingSide, string | null>;
  /** S2.11 — the design system's space stops (px, ascending); a gap drag clicks onto them. Empty = free. */
  stops: number[];
  /** S2.11 — which gap (0 = between the first two children) is held; the bands light that one. */
  gapIndex: number;
}

/** One touched property's before/after — the shape `resizeElement`'s multi-prop
 *  `patch`/`before` objects already accept (Stage D3/L8 established this). */
interface PropEntry {
  prop: string;
  before: string | null;
}

export function SpacingHandlesOverlay(): ReactNode {
  ensureSpacingStyles();
  const { selected } = useSelectionSet();
  const { tool } = useToolMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<SpacingDrag | null>(null);
  const lastCommitRef = useRef<{ el: HTMLElement; entries: PropEntry[] } | null>(null);

  const one = selected.length === 1 ? selected[0] : null;
  const cdId = one && typeof one.id === 'string' ? one.id : null;
  const active = tool === 'move' && !!cdId;

  // rAF loop — recompute + repaint every frame (pan/zoom/layout AND a live drag,
  // since a gap drag reflows sibling children — re-deriving from the DOM each
  // frame is simpler and more correct than hand-propagating the effect to every
  // other gap handle).
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const hideAll = () => {
      for (const child of Array.from(c.children)) (child as HTMLElement).style.display = 'none';
    };
    if (!active || !one) {
      hideAll();
      return;
    }
    const tick = () => {
      rafRef.current = null;
      // Dogfood 2026-07-07 — a live ReorderDrag is the canvas's most DOM-churn-
      // heavy gesture; skip this overlay's own getBoundingClientRect/
      // getComputedStyle work while one is in flight (its handles are
      // irrelevant mid-drag anyway — the drag has its own live-preview chrome).
      if (isElementDragActive()) {
        hideAll();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      if (!el) {
        hideAll();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) {
        hideAll();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const cs = getComputedStyle(el);
      // Dogfood fix — engine-split-aware zoom read (see worldZoomFor's own
      // doc comment in use-element-resize: the Chromium camera writes the CSS
      // `zoom` property, not a transform matrix).
      const zoom = worldZoomFor(el);
      const padding = {
        top: computedPx(cs, 'padding-top'),
        right: computedPx(cs, 'padding-right'),
        bottom: computedPx(cs, 'padding-bottom'),
        left: computedPx(cs, 'padding-left'),
      };
      const lines = computePaddingLines(
        { x: r.left, y: r.top, w: r.width, h: r.height },
        padding,
        zoom
      );
      const isFlex = cs.display === 'flex' || cs.display === 'inline-flex';
      const axis = flexMainAxis(cs.flexDirection);
      const gapPoints = isFlex
        ? computeGapMidpoints(
            Array.from(el.children).map((child) => {
              const cr = (child as HTMLElement).getBoundingClientRect();
              return { x: cr.left, y: cr.top, w: cr.width, h: cr.height };
            }),
            axis
          )
        : [];
      const TOTAL = lines.length + gapPoints.length;
      while (c.children.length < TOTAL) c.appendChild(document.createElement('div'));
      while (c.children.length > TOTAL) c.lastChild && c.removeChild(c.lastChild);
      let i = 0;
      for (const line of lines) {
        const h = c.children[i] as HTMLElement;
        h.className = 'dc-spacing-handle dc-spacing-handle--padding';
        h.dataset.side = line.side;
        h.dataset.prop = `padding-${line.side}`;
        h.dataset.axis = line.axis;
        h.title = `padding-${line.side} · drag to scrub · alt = symmetric pair · alt+shift = all sides`;
        h.style.display = 'block';
        h.style.left = `${Math.round(line.x)}px`;
        h.style.top = `${Math.round(line.y)}px`;
        i++;
      }
      for (const pt of gapPoints) {
        const h = c.children[i] as HTMLElement;
        h.className = 'dc-spacing-handle dc-spacing-handle--gap';
        h.dataset.side = '';
        h.dataset.prop = 'gap';
        h.title = 'gap · drag to scrub';
        h.dataset.axis = axis;
        h.style.display = 'block';
        h.style.left = `${Math.round(pt.x)}px`;
        h.style.top = `${Math.round(pt.y)}px`;
        i++;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, one]);

  /** Commit one or more touched properties in a SINGLE `resize-request` — a
   *  plain drag has one entry; an Alt (pair) / Alt+Shift (all sides) padding
   *  drag has 2 or 4, all set to the SAME value (mirrors the CSS panel's own
   *  `side()` scrub semantics — every touched side becomes the dragged value,
   *  not each grown independently). */
  const commit = useCallback((d: SpacingDrag, entries: PropEntry[], after: string) => {
    if (!entries.length) return;
    lastCommitRef.current = { el: d.el, entries };
    const patch: Record<string, string> = {};
    const before: Record<string, string | null> = {};
    for (const e of entries) {
      patch[e.prop] = after;
      before[e.prop] = e.before;
    }
    try {
      window.parent.postMessage(
        { dgn: 'resize-request', id: d.cdId, patch, before, idIndex: d.idIndex },
        '*'
      );
    } catch {
      /* detached / cross-origin teardown */
    }
  }, []);

  /**
   * ⌥ — every gap that was the size of the held one, in this frame and the frames inside it, becomes
   * the new value: ONE `layout.set-gap` edit-op (one write, one undo step; S2.11c). A refusal puts the
   * held frame's preview back.
   */
  const commitEveryGap = useCallback(async (d: SpacingDrag, value: number) => {
    const frames = [d.el, ...framesWithGap(d.el, d.startValue)];
    const result = await runSetGap(frames, value, layoutOpsDeps.current);
    if (result && !result.ok) {
      if (d.before == null) d.el.style.removeProperty(d.prop);
      else d.el.style.setProperty(d.prop, d.before);
    }
  }, []);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.classList.contains('dc-spacing-handle')) return;
      if (!one || typeof one.id !== 'string') return;
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const prop = t.dataset.prop || '';
      const isGap = prop === 'gap';
      const cs = getComputedStyle(el);
      // Dogfood fix — engine-split-aware zoom read (see worldZoomFor's own
      // doc comment in use-element-resize: the Chromium camera writes the CSS
      // `zoom` property, not a transform matrix).
      const zoom = worldZoomFor(el);
      const drag: SpacingDrag = {
        pointerId: e.pointerId,
        kind: isGap ? 'gap' : 'padding',
        side: isGap ? null : ((t.dataset.side as PaddingSide) ?? null),
        axis: (t.dataset.axis as 'x' | 'y') ?? 'x',
        el,
        cdId: one.id,
        idIndex: globalCdOccurrence(document, one.id, el),
        startClientX: e.clientX,
        startClientY: e.clientY,
        zoom: zoom > 0 ? zoom : 1,
        startValue: computedPx(cs, prop),
        stops: isGap ? spaceStops(document) : [],
        gapIndex: isGap ? Array.from(c.querySelectorAll('.dc-spacing-handle--gap')).indexOf(t) : -1,
        prop,
        before: el.style.getPropertyValue(prop) || null,
        // Alt (pair) / Alt+Shift (all sides) can touch sides OTHER than the one
        // grabbed — capture every side's PRE-drag inline value up front so a
        // late modifier press still gets the correct undo `before`.
        paddingBefore: isGap
          ? undefined
          : {
              top: el.style.getPropertyValue('padding-top') || null,
              right: el.style.getPropertyValue('padding-right') || null,
              bottom: el.style.getPropertyValue('padding-bottom') || null,
              left: el.style.getPropertyValue('padding-left') || null,
            },
      };
      dragRef.current = drag;
      t.dataset.dragging = 'true';
      try {
        t.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events may reject capture */
      }
    };

    // Alt (pair) / Alt+Shift (all sides) — the CSS panel's own box-model scrub
    // grammar, matched exactly (`paddingSideSet`). Gap has no "opposite side"
    // concept, so modifiers only ever apply to a padding drag.
    const touchedEntries = (d: SpacingDrag, ev: PointerEvent): PropEntry[] => {
      if (d.kind === 'gap' || !d.paddingBefore) return [{ prop: d.prop, before: d.before }];
      const sides = paddingSideSet(d.side ?? 'top', ev.altKey, ev.shiftKey);
      return sides.map((s) => ({ prop: `padding-${s}`, before: d.paddingBefore?.[s] ?? null }));
    };

    // S2.11 — a gap clicks onto the system's space stops (⌘ = any number); padding stays free.
    const valueFor = (d: SpacingDrag, ev: PointerEvent, dx: number, dy: number): number => {
      if (d.kind !== 'gap')
        return computePaddingDrag(d.side ?? 'top', d.startValue, dx, dy, d.zoom);
      const raw = computeGapDrag(d.axis, d.startValue, dx, dy, d.zoom);
      return gapValue(raw, d.stops, ev.metaKey || ev.ctrlKey);
    };
    const showRuler = (d: SpacingDrag, ev: PointerEvent, value: number) => {
      if (!d.stops.length) return;
      const free = ev.metaKey || ev.ctrlKey;
      tokenRuler.show({
        x: ev.clientX,
        y: ev.clientY,
        stops: rulerWindow(d.stops, value),
        on: free ? null : value,
        value,
        free,
        all: ev.altKey,
        gapIndex: d.gapIndex,
      });
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      const next = valueFor(d, e, dx, dy);
      for (const entry of touchedEntries(d, e)) d.el.style.setProperty(entry.prop, `${next}px`);
      if (d.kind === 'gap') showRuler(d, e, next);
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      const handle = containerRef.current?.querySelector<HTMLElement>(
        `.dc-spacing-handle[data-prop="${d.prop}"][data-dragging="true"]`
      );
      if (handle) delete handle.dataset.dragging;
      tokenRuler.hide();
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      const next = valueFor(d, e, dx, dy);
      const entries = touchedEntries(d, e);
      // S2.24 G4 — a gap that clicked onto a stop of the system's scale is written as the stop (`var(--space-6)`),
      // like the ⌥ drag does; ⌘ (any number), padding and a system without that stop write the number.
      const token =
        d.kind === 'gap' && !(e.metaKey || e.ctrlKey) ? spaceTokenFor(next, document) : null;
      const after = token ? `var(${token})` : `${next}px`;
      const changed = entries.some(
        (entry) => `${next}px` !== (entry.before ?? `${d.startValue}px`) && after !== entry.before
      );
      if (!changed) return; // no-op guard
      // ⌥ on a gap: one multi-frame op carries the held frame too (no second write for it)
      if (d.kind === 'gap' && e.altKey) void commitEveryGap(d, next);
      else commit(d, entries, after);
    };

    // Restore the pre-drag inline value(s) if the shell reports the write
    // failed (shares `resize-failed` with the element-resize overlay — both
    // restore from their OWN lastCommitRef, so they don't collide).
    const onFail = (e: MessageEvent) => {
      const m = e.data as { dgn?: string } | null;
      if (m?.dgn !== 'resize-failed') return;
      if (e.source !== window.parent) return; // only the parent shell (DDR-054)
      const last = lastCommitRef.current;
      if (!last) return;
      for (const entry of last.entries) {
        if (entry.before == null) last.el.style.removeProperty(entry.prop);
        else last.el.style.setProperty(entry.prop, entry.before);
      }
      lastCommitRef.current = null;
    };

    c.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('message', onFail);
    return () => {
      tokenRuler.hide();
      c.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('message', onFail);
    };
  }, [one, commit, commitEveryGap]);

  return <div ref={containerRef} aria-hidden="true" />;
}
