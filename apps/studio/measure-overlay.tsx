/**
 * @file       measure-overlay.tsx — Task L7 (feature-element-editing-robustness)
 * @scope      apps/studio/measure-overlay.tsx
 * @purpose    Alt-hover distance measurement (Figma parity): with exactly one
 *             element selected, holding Alt and hovering a DIFFERENT stamped
 *             element paints a red guide line + pixel-distance pill between
 *             the two boxes' facing edges, on whichever axis(es) actually
 *             have a gap. Read-only — never writes anything, no undo, no
 *             write-surface implications.
 *
 *             Mirrors `equal-spacing-handles.tsx`'s fixed-rAF-follow scaffold
 *             (persistent DOM children, no React re-render per frame) and
 *             reuses its pairwise-gap sibling `computePairGap`
 *             (equal-spacing-detector.ts) for the math.
 *
 *             Alt-tracking mirrors `use-cursor-modifiers.tsx`'s
 *             `reduceModifiers` reducer, but keeps the result in React state
 *             (gating hover RESOLUTION, a real cost) rather than a DOM
 *             attribute (that hook only drives CSS cursor swaps).
 *
 *             Distances are printed in WORLD px (screen delta ÷ the world's
 *             zoom) so the number stays correct at any zoom level — the
 *             Stage-A host-scroll-0 invariant is what makes a screen-rect
 *             delta ÷ zoom equivalent to a true world-space measurement.
 */

import { useEffect, useRef, useState } from 'react';
import { modeShows } from './bridge/mode-shows.ts';
import { useArtboardsContext } from './canvas-lib.tsx';
import { resolveSelectionEl } from './dom-selection.ts';
import { computePairGap } from './equal-spacing-detector.ts';
import { resolveHoverTarget } from './input-router.tsx';
import { type ModifierState, reduceModifiers } from './use-cursor-modifiers.tsx';
import { useGovernedMode } from './use-governed-mode.ts';
import { useSelectionSet } from './use-selection-set.tsx';

const MEASURE_CSS = `
.dc-cv-measure-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 7;
}
.dc-cv-measure-line {
  position: absolute;
  background: #FF3B30;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-cv-measure-line[data-axis="x"] { height: 1px; }
.dc-cv-measure-line[data-axis="y"] { width: 1px; }
.dc-cv-measure-line[data-on="true"] { opacity: 1; }
.dc-cv-measure-pill {
  position: absolute;
  transform: translate(-50%, -50%);
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 10px;
  padding: 2px 5px;
  background: #FF3B30;
  color: #ffffff;
  border-radius: 2px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-cv-measure-pill[data-on="true"] { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .dc-cv-measure-line, .dc-cv-measure-pill { transition-duration: 1ms; }
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-cv-measure-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-cv-measure-css';
  s.textContent = MEASURE_CSS;
  document.head.appendChild(s);
}

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOf(el: Element): ScreenRect | null {
  const b = (el as HTMLElement).getBoundingClientRect();
  if (b.width === 0 && b.height === 0) return null;
  return { x: b.left, y: b.top, w: b.width, h: b.height };
}

/** Persistent line+pill pair for one axis — created once, toggled via
 *  `data-on` (opacity transition) rather than added/removed each frame. */
function ensureAxisNodes(layer: HTMLDivElement, axis: 'x' | 'y'): [HTMLDivElement, HTMLDivElement] {
  let line = layer.querySelector<HTMLDivElement>(`.dc-cv-measure-line[data-axis="${axis}"]`);
  let pill = layer.querySelector<HTMLDivElement>(`.dc-cv-measure-pill[data-axis="${axis}"]`);
  if (!line) {
    line = document.createElement('div');
    line.className = 'dc-cv-measure-line';
    line.dataset.axis = axis;
    layer.appendChild(line);
  }
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'dc-cv-measure-pill';
    pill.dataset.axis = axis;
    layer.appendChild(pill);
  }
  return [line, pill];
}

function hideAxis(layer: HTMLDivElement, axis: 'x' | 'y'): void {
  const [line, pill] = ensureAxisNodes(layer, axis);
  line.dataset.on = 'false';
  pill.dataset.on = 'false';
}

function paintAxis(
  layer: HTMLDivElement,
  axis: 'x' | 'y',
  a: ScreenRect,
  b: ScreenRect,
  zoom: number
): void {
  const g = computePairGap(a, b, axis);
  const [line, pill] = ensureAxisNodes(layer, axis);
  if (!g) {
    line.dataset.on = 'false';
    pill.dataset.on = 'false';
    return;
  }
  const worldGap = Math.round(g.gap / (zoom || 1));
  if (axis === 'x') {
    line.style.left = `${Math.round(g.from)}px`;
    line.style.top = `${Math.round(g.cross)}px`;
    line.style.width = `${Math.round(g.gap)}px`;
    pill.style.left = `${Math.round(g.from + g.gap / 2)}px`;
    pill.style.top = `${Math.round(g.cross)}px`;
  } else {
    line.style.left = `${Math.round(g.cross)}px`;
    line.style.top = `${Math.round(g.from)}px`;
    line.style.height = `${Math.round(g.gap)}px`;
    pill.style.left = `${Math.round(g.cross)}px`;
    pill.style.top = `${Math.round(g.from + g.gap / 2)}px`;
  }
  pill.textContent = `${worldGap}`;
  line.dataset.on = 'true';
  pill.dataset.on = 'true';
}

export function MeasureOverlay() {
  ensureStyles();
  // S3.11 — measure is on in Edit, Preview and Viewing and off in Present (bridge/mode-shows.ts), so the
  // Alt-hover tracking below never runs while presenting.
  const mode = useGovernedMode();
  const shown = modeShows(mode, 'measure');
  const { selected } = useSelectionSet();
  const world = useArtboardsContext();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [alt, setAlt] = useState(false);
  const [hoverEl, setHoverEl] = useState<Element | null>(null);

  // Alt + hover tracking, gated together: hover RESOLUTION (a real per-move
  // cost — resolveHoverTarget walks the DOM) only runs while Alt is held.
  useEffect(() => {
    if (typeof document === 'undefined' || !shown) return;
    let mods: ModifierState = { alt: false, shift: false, meta: false };
    const onKeyChange = (e: KeyboardEvent) => {
      const next = reduceModifiers(mods, e);
      if (next === mods) return;
      mods = next;
      setAlt(mods.alt);
      if (!mods.alt) setHoverEl(null);
    };
    const onPointer = (e: PointerEvent) => {
      const next = reduceModifiers(mods, e);
      if (next !== mods) {
        mods = next;
        setAlt(mods.alt);
      }
      if (!mods.alt) {
        setHoverEl(null);
        return;
      }
      const t = resolveHoverTarget(document, e.clientX, e.clientY, { deep: true });
      setHoverEl(t?.el ?? null);
    };
    const onBlur = () => {
      mods = { alt: false, shift: false, meta: false };
      setAlt(false);
      setHoverEl(null);
    };
    document.addEventListener('keydown', onKeyChange, true);
    document.addEventListener('keyup', onKeyChange, true);
    document.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyChange, true);
      document.removeEventListener('keyup', onKeyChange, true);
      document.removeEventListener('pointermove', onPointer);
      window.removeEventListener('blur', onBlur);
    };
  }, [shown]);

  const one = selected.length === 1 ? selected[0] : null;
  const zoom = world?.viewport?.zoom || 1;
  const active = shown && alt && !!one && !!hoverEl;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const hideBoth = () => {
      hideAxis(layer, 'x');
      hideAxis(layer, 'y');
    };
    if (!active || !one || !hoverEl) {
      hideBoth();
      return;
    }
    let alive = true;
    let rafId: number | null = null;
    const tick = () => {
      rafId = null;
      if (!alive) return;
      const selEl = resolveSelectionEl(document, one);
      const a = selEl && selEl !== hoverEl && hoverEl.isConnected ? rectOf(selEl) : null;
      const b = a ? rectOf(hoverEl) : null;
      if (a && b) {
        paintAxis(layer, 'x', a, b, zoom);
        paintAxis(layer, 'y', a, b, zoom);
      } else {
        hideBoth();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [active, one, hoverEl, zoom]);

  return <div ref={layerRef} className="dc-cv-measure-layer" aria-hidden="true" />;
}
