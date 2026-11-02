/**
 * @file       equal-spacing-handles.tsx — T27 (Wave 3)
 * @scope      apps/studio/equal-spacing-handles.tsx
 * @purpose    Figma Smart Selection pink-dot affordance. When 3+ elements are
 *             selected AND their bounding rects are equally distributed on an
 *             axis, render small pink dots at the midpoints between adjacent
 *             pairs, each with a gap-distance pill above. Hover-gated:
 *             dots are visible only while the cursor is within the union
 *             bbox + 40 px padding — discoverable but not noisy.
 *
 *             Drag-to-adjust the gap is a Wave 3.x follow-up; for v1 we
 *             paint the affordance only.
 */

import { useEffect, useRef, useState } from 'react';

import { resolveSelectionEl } from './dom-selection.ts';
import { detectEqualSpacing, type EqualSpacingResult } from './equal-spacing-detector.ts';
import { useSelectionSet } from './use-selection-set.tsx';

const HOVER_PADDING_PX = 40;
/** Equal-spacing tolerance in screen pixels — distribute leaves 0–1 px
 *  rounding error; 2 px is comfortably above noise without flagging
 *  intentionally-uneven sets. */
const EQUAL_TOLERANCE_PX = 2;

const STYLES = `
.dc-cv-eq-spacing-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.dc-cv-eq-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #FF24BD;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85);
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-cv-eq-pill {
  position: absolute;
  transform: translate(-50%, calc(-100% - 8px));
  font-family: var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-size: 10px;
  padding: 2px 5px;
  background: #FF24BD;
  color: #ffffff;
  border-radius: 2px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-cv-eq-spacing-layer[data-visible="true"] .dc-cv-eq-dot,
.dc-cv-eq-spacing-layer[data-visible="true"] .dc-cv-eq-pill {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .dc-cv-eq-dot, .dc-cv-eq-pill { transition-duration: 1ms; }
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-cv-eq-spacing-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-cv-eq-spacing-css';
  s.textContent = STYLES;
  document.head.appendChild(s);
}

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function resolveSelectionRects(
  sels: Array<{ id?: string; selector: string; artboardId?: string | null }>
): ScreenRect[] {
  const rects: ScreenRect[] = [];
  for (const s of sels) {
    const el = resolveSelectionEl(document, s);
    if (!el) continue;
    const b = (el as HTMLElement).getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    rects.push({ x: b.left, y: b.top, w: b.width, h: b.height });
  }
  return rects;
}

function unionBbox(rects: ScreenRect[]): ScreenRect | null {
  if (rects.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < left) left = r.x;
    if (r.y < top) top = r.y;
    if (r.x + r.w > right) right = r.x + r.w;
    if (r.y + r.h > bottom) bottom = r.y + r.h;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function pointInPaddedBox(px: number, py: number, b: ScreenRect, pad: number): boolean {
  return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;
}

export function EqualSpacingHandles() {
  ensureStyles();
  const { selected } = useSelectionSet();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);

  // Track cursor position to gate dot visibility. We hide handles whenever
  // the cursor leaves the (union bbox + padding) zone — discoverable on
  // approach, invisible while the user is doing unrelated work elsewhere.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onMove = (e: PointerEvent) => {
      const layer = layerRef.current;
      if (!layer) return;
      const dotsZone = layer.getBoundingClientRect();
      // Layer is inset:0 in screen-fixed coords. We compare against the
      // currently painted union bbox stored on a data attr each rAF tick.
      const ubStr = layer.getAttribute('data-union-bbox');
      if (!ubStr) {
        setHovered(false);
        return;
      }
      // Avoid TS-touchy split — manual parse.
      const parts = ubStr.split(',');
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const w = Number(parts[2]);
      const h = Number(parts[3]);
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      const inZone = pointInPaddedBox(e.clientX, e.clientY, { x, y, w, h }, HOVER_PADDING_PX);
      if (inZone !== hovered) setHovered(inZone);
      // Touch `dotsZone` to keep the ref-read in the dependency graph.
      void dotsZone;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, [hovered]);

  // Resolve current selection → DOM rects → equal-spacing detector → paint.
  // rAF loop so the affordance follows zoom + pan smoothly without React
  // re-renders per frame.
  useEffect(() => {
    if (selected.length < 3) {
      // Clear layer when selection drops below the affordance threshold.
      const layer = layerRef.current;
      if (layer) {
        while (layer.firstChild) layer.removeChild(layer.firstChild);
        layer.removeAttribute('data-union-bbox');
      }
      return;
    }
    let alive = true;

    const tick = () => {
      if (!alive) return;
      rafRef.current = null;
      const layer = layerRef.current;
      if (!layer) return;
      const rects = resolveSelectionRects(selected);
      if (rects.length < 3) {
        while (layer.firstChild) layer.removeChild(layer.firstChild);
        layer.removeAttribute('data-union-bbox');
        return;
      }
      // Detect on both axes; prefer the axis with the smaller relative spread
      // (the "more confidently distributed" axis). Ties = horizontal wins.
      const detX = detectEqualSpacing(rects, 'x', { tolerancePx: EQUAL_TOLERANCE_PX });
      const detY = detectEqualSpacing(rects, 'y', { tolerancePx: EQUAL_TOLERANCE_PX });
      const result = pickDetection(detX, detY);
      if (!result) {
        while (layer.firstChild) layer.removeChild(layer.firstChild);
        layer.removeAttribute('data-union-bbox');
        return;
      }

      const ub = unionBbox(rects);
      if (ub) layer.setAttribute('data-union-bbox', `${ub.x},${ub.y},${ub.w},${ub.h}`);

      paintHandles(layer, result);
    };

    const onFrame = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(tick);
    };

    // Initial paint + continuous follow on pan/zoom/scroll.
    onFrame();
    const recheck = () => onFrame();
    window.addEventListener('scroll', recheck, { passive: true, capture: true });
    window.addEventListener('resize', recheck, { passive: true });
    const observer = new MutationObserver(() => onFrame());
    observer.observe(document.body, { attributes: true, subtree: true, childList: true });

    return () => {
      alive = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', recheck, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', recheck);
      observer.disconnect();
    };
  }, [selected]);

  return (
    <div
      ref={layerRef}
      className="dc-cv-eq-spacing-layer"
      data-visible={hovered ? 'true' : 'false'}
      aria-hidden="true"
    />
  );
}

function pickDetection(
  detX: EqualSpacingResult | null,
  detY: EqualSpacingResult | null
): EqualSpacingResult | null {
  if (detX && detY) return detX.midpoints.length >= detY.midpoints.length ? detX : detY;
  return detX ?? detY;
}

function paintHandles(layer: HTMLDivElement, result: EqualSpacingResult): void {
  // Match child count to 2× midpoints (each midpoint = one dot + one pill).
  const want = result.midpoints.length * 2;
  while (layer.children.length < want) {
    const isDot = layer.children.length % 2 === 0;
    const node = document.createElement('div');
    node.className = isDot ? 'dc-cv-eq-dot' : 'dc-cv-eq-pill';
    if (!isDot) node.textContent = '';
    layer.appendChild(node);
  }
  while (layer.children.length > want) {
    layer.removeChild(layer.lastChild as Node);
  }
  const label = `${Math.round(result.gapPx)}`;
  for (let i = 0; i < result.midpoints.length; i++) {
    const m = result.midpoints[i];
    if (!m) continue;
    const dot = layer.children[i * 2] as HTMLDivElement;
    const pill = layer.children[i * 2 + 1] as HTMLDivElement;
    dot.style.left = `${m.x}px`;
    dot.style.top = `${m.y}px`;
    pill.style.left = `${m.x}px`;
    pill.style.top = `${m.y}px`;
    pill.textContent = label;
  }
}

// Re-export the picker for tests.
export { pickDetection };
