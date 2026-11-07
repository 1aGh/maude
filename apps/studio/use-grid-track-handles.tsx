/**
 * @file       use-grid-track-handles.tsx — feature-3-web-artboards T5
 *             (absorbed feature-grid-track-editor stub).
 * @scope      apps/studio/use-grid-track-handles.tsx
 * @purpose    On-canvas CSS-Grid gutter drag-resize — the grid sibling of
 *             `use-spacing-handles.tsx`'s padding/gap overlay, same shape:
 *             live preview via direct inline-style writes, commit rides the
 *             SAME `resize-request` lane (`grid-template-columns`/`-rows`
 *             added to the shell's `resizeElement` allowed-prop list — no
 *             new write surface, mirroring how `padding-*`/`gap` were added
 *             there for Stage J). A component-instance drag threads the
 *             Stage H3 occurrence index the same way (`globalCdOccurrence`).
 *
 *             Gated on computed `display: grid`/`inline-grid` (CLAUDE.md
 *             gotcha: "gate all of it on computed display" — a container
 *             that was converted to absolute, or never was a grid, is not an
 *             editing target). Only tracks AUTHORED inline via
 *             `grid-template-columns`/`-rows` (parseable by
 *             `grid-track-handles.ts`'s `parseTrackList`) get drag handles —
 *             `repeat()`/`minmax()`/a stylesheet-authored grid have no
 *             drag surface here (same constraint every curated knob already
 *             has: these on-canvas tools edit inline-style-authored values
 *             only); the Inspector's Grid section still shows the raw value
 *             for those cases.
 */

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { globalCdOccurrence, resolveSelectionEl } from './dom-selection.ts';
import { isElementDragActive } from './drag-state.ts';
import { frameCaf, frameRaf } from './frame-clock.ts';
import {
  computeGutterLines,
  computeTrackDrag,
  GRID_KEYWORD_UNITS,
  type GridTrack,
  type GutterLine,
  gutterTrackIndices,
  parseTrackList,
  serializeTrackList,
} from './grid-track-handles.ts';
import { worldZoomFor } from './use-element-resize.tsx';
import { useSelectionSet } from './use-selection-set.tsx';
import { useToolMode } from './use-tool-mode.tsx';

const GRID_HANDLE_CSS = `
.dc-grid-gutter-handle {
  position: fixed;
  transform: translate(-50%, -50%);
  /* Same layering rationale as the spacing handles (z-index 4) — below the
     Stage-D resize handles (6), which win any frame-edge hit-test tie. */
  z-index: 4;
  pointer-events: auto;
  touch-action: none;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--maude-hud-accent, oklch(0.680 0.180 268));
  border: 1px solid var(--maude-hud-accent-fg, oklch(0.180 0.030 268));
  opacity: 0.55;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-grid-gutter-handle:hover,
.dc-grid-gutter-handle[data-dragging="true"] { opacity: 1; }
.dc-grid-gutter-handle[data-axis="x"] { cursor: ew-resize; }
.dc-grid-gutter-handle[data-axis="y"] { cursor: ns-resize; }
@media (prefers-reduced-motion: reduce) {
  .dc-grid-gutter-handle { transition-duration: 1ms; }
}
`.trim();

function ensureGridHandleStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-grid-gutter-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-grid-gutter-css';
  s.textContent = GRID_HANDLE_CSS;
  document.head.appendChild(s);
}

function computedPx(cs: CSSStyleDeclaration, prop: string): number {
  return Number.parseFloat(cs.getPropertyValue(prop)) || 0;
}

/** Parse a browser-RESOLVED `grid-template-columns`/`-rows` computed value
 *  ("100px 200px 100px") into a plain px array. Never contains keywords or
 *  `fr` — the browser already ran the grid-sizing algorithm. */
function resolvedTrackSizes(computedValue: string): number[] {
  const s = computedValue.trim();
  if (!s || s === 'none') return [];
  return s.split(/\s+/).map((tok) => Number.parseFloat(tok) || 0);
}

interface AxisState {
  container: 'col' | 'row';
  authored: GridTrack[];
  resolvedPx: number[];
  gutters: GutterLine[];
}

interface GridDrag {
  pointerId: number;
  axis: 'x' | 'y';
  container: 'col' | 'row';
  gutterIndex: number;
  el: HTMLElement;
  cdId: string;
  idIndex: number;
  startClientX: number;
  startClientY: number;
  zoom: number;
  /** Snapshot of the AUTHORED track list for this axis at drag-start. */
  tracks: GridTrack[];
  /** Snapshot of each touched track's resolved px at drag-start. */
  resolvedAtStart: number[];
  touched: number[];
  prop: 'grid-template-columns' | 'grid-template-rows';
  before: string;
}

export function GridTrackHandlesOverlay(): ReactNode {
  ensureGridHandleStyles();
  const { selected } = useSelectionSet();
  const { tool } = useToolMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<GridDrag | null>(null);
  const lastCommitRef = useRef<{ el: HTMLElement; prop: string; before: string } | null>(null);
  // Latest per-axis geometry, read by the pointerdown handler (it fires
  // between rAF ticks, so it needs the most recent computed snapshot rather
  // than recomputing getComputedStyle itself).
  const axesRef = useRef<{ col: AxisState | null; row: AxisState | null }>({
    col: null,
    row: null,
  });

  const one = selected.length === 1 ? selected[0] : null;
  const cdId = one && typeof one.id === 'string' ? one.id : null;
  const active = tool === 'move' && !!cdId;

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const hideAll = () => {
      for (const child of Array.from(c.children)) (child as HTMLElement).style.display = 'none';
      axesRef.current = { col: null, row: null };
    };
    if (!active || !one) {
      hideAll();
      return;
    }
    const tick = () => {
      rafRef.current = null;
      const reschedule = () => {
        rafRef.current = frameRaf(tick);
      };
      const bail = () => {
        hideAll();
        reschedule();
      };
      if (isElementDragActive()) {
        bail();
        return;
      }
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      if (!el) {
        bail();
        return;
      }
      const cs = getComputedStyle(el);
      const isGrid = cs.display === 'grid' || cs.display === 'inline-grid';
      if (!isGrid) {
        bail();
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) {
        bail();
        return;
      }
      const zoom = worldZoomFor(el);
      const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      const colGap = computedPx(cs, 'column-gap') * zoom;
      const rowGap = computedPx(cs, 'row-gap') * zoom;

      const buildAxis = (
        container: 'col' | 'row',
        prop: string,
        gapPx: number
      ): AxisState | null => {
        const authored = parseTrackList(el.style.getPropertyValue(prop));
        if (authored.length < 2) return null;
        const resolvedPx = resolvedTrackSizes(cs.getPropertyValue(prop)).map((px) => px * zoom);
        if (resolvedPx.length !== authored.length) return null; // repeat()/mismatch guard
        const gutters = computeGutterLines(rect, resolvedPx, gapPx, container).filter((_, i) => {
          const before = authored[i] as GridTrack;
          const after = authored[i + 1] as GridTrack;
          return !GRID_KEYWORD_UNITS.has(before.unit) || !GRID_KEYWORD_UNITS.has(after.unit);
        });
        if (gutters.length === 0) return null;
        return { container, authored, resolvedPx, gutters };
      };

      const col = buildAxis('col', 'grid-template-columns', colGap);
      const row = buildAxis('row', 'grid-template-rows', rowGap);
      axesRef.current = { col, row };

      const allGutters = [...(col?.gutters ?? []), ...(row?.gutters ?? [])];
      const TOTAL = allGutters.length;
      while (c.children.length < TOTAL) c.appendChild(document.createElement('div'));
      while (c.children.length > TOTAL) c.lastChild && c.removeChild(c.lastChild);
      let i = 0;
      for (const [container, axisState] of [
        ['col', col],
        ['row', row],
      ] as const) {
        const kind = container === 'col' ? 'column' : 'row';
        for (const g of axisState?.gutters ?? []) {
          const h = c.children[i] as HTMLElement;
          h.className = 'dc-grid-gutter-handle';
          h.dataset.container = container;
          h.dataset.gutterIndex = String(g.index);
          h.dataset.axis = g.axis;
          h.title = `grid ${kind} gutter · drag to resize · shift = resize both neighbors`;
          h.style.display = 'block';
          h.style.left = `${Math.round(g.x)}px`;
          h.style.top = `${Math.round(g.y)}px`;
          i++;
        }
      }
      rafRef.current = frameRaf(tick);
    };
    rafRef.current = frameRaf(tick);
    return () => {
      if (rafRef.current != null) frameCaf(rafRef.current);
    };
  }, [active, one]);

  const commit = useCallback((d: GridDrag, serialized: string) => {
    lastCommitRef.current = { el: d.el, prop: d.prop, before: d.before };
    try {
      window.parent.postMessage(
        {
          dgn: 'resize-request',
          id: d.cdId,
          patch: { [d.prop]: serialized },
          before: { [d.prop]: d.before },
          idIndex: d.idIndex,
        },
        '*'
      );
    } catch {
      /* detached / cross-origin teardown */
    }
  }, []);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.classList.contains('dc-grid-gutter-handle')) return;
      if (!one || typeof one.id !== 'string') return;
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      if (!el) return;
      const container = t.dataset.container as 'col' | 'row';
      const axisState = axesRef.current[container];
      if (!axisState) return;
      const gutterIndex = Number(t.dataset.gutterIndex);
      if (!Number.isFinite(gutterIndex)) return;
      e.preventDefault();
      e.stopPropagation();
      const zoom = worldZoomFor(el);
      const prop: GridDrag['prop'] =
        container === 'col' ? 'grid-template-columns' : 'grid-template-rows';
      dragRef.current = {
        pointerId: e.pointerId,
        axis: (t.dataset.axis as 'x' | 'y') ?? 'x',
        container,
        gutterIndex,
        el,
        cdId: one.id,
        idIndex: globalCdOccurrence(document, one.id, el),
        startClientX: e.clientX,
        startClientY: e.clientY,
        zoom: zoom > 0 ? zoom : 1,
        tracks: axisState.authored,
        resolvedAtStart: axisState.resolvedPx,
        touched: gutterTrackIndices(gutterIndex, false),
        prop,
        before: serializeTrackList(axisState.authored),
      };
      t.dataset.dragging = 'true';
      try {
        t.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events may reject capture */
      }
    };

    const previewFor = (d: GridDrag, e: PointerEvent): GridTrack[] => {
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      const touched = gutterTrackIndices(d.gutterIndex, e.shiftKey).filter(
        (idx) => idx < d.tracks.length
      );
      const next = d.tracks.map((tr) => ({ ...tr }));
      for (const idx of touched) {
        const tr = d.tracks[idx];
        const resolvedPx = d.resolvedAtStart[idx];
        if (!tr || !Number.isFinite(resolvedPx) || GRID_KEYWORD_UNITS.has(tr.unit)) continue;
        const newValue = computeTrackDrag(tr, resolvedPx as number, dx, dy, d.zoom, d.axis);
        next[idx] = { value: newValue, unit: tr.unit };
      }
      return next;
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.preventDefault();
      const next = previewFor(d, e);
      d.el.style.setProperty(d.prop, serializeTrackList(next));
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      const handle = containerRef.current?.querySelector<HTMLElement>(
        '.dc-grid-gutter-handle[data-dragging="true"]'
      );
      if (handle) delete handle.dataset.dragging;
      const next = previewFor(d, e);
      const serialized = serializeTrackList(next);
      if (serialized === d.before) return; // no-op guard
      commit(d, serialized);
    };

    const onFail = (e: MessageEvent) => {
      const m = e.data as { dgn?: string } | null;
      if (m?.dgn !== 'resize-failed') return;
      if (e.source !== window.parent) return; // only the parent shell (DDR-054)
      const last = lastCommitRef.current;
      if (!last) return;
      last.el.style.setProperty(last.prop, last.before);
      lastCommitRef.current = null;
    };

    c.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('message', onFail);
    return () => {
      c.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('message', onFail);
    };
  }, [one, commit]);

  return <div ref={containerRef} aria-hidden="true" />;
}
