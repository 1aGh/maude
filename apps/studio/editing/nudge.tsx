// editing/nudge.tsx — what the arrow keys say while they nudge (S2.6, artboard ed-obj-order).
//
// The move itself is v1's and stays in `use-keyboard-discipline.tsx` (↓ 1 px, ⇧↓ 10 px, in world
// units, one undo per burst; a single out-of-flow object or an artboard). This file only READS the
// result: a position tag next to the selection ("Y 434", "X 120") that appears while the arrows are
// pressed and fades after a moment, and — while ⌥ is held — the distances from the selection to the
// edges of the frame it sits in, drawn as thin guides with their numbers (magenta, like the guides
// of a drag). It never writes and never takes a key.

import { useEffect, useRef, useState } from 'react';

import { resolveSelectionEl } from '../dom-selection.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { stampedParent } from './selection.tsx';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Distances {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The distance from `inner` to each edge of `outer`, in world units (`scale` = screen px per unit). */
export function distancesToParent(inner: Box, outer: Box, scale: number): Distances {
  const k = scale > 0 ? scale : 1;
  const d = (n: number) => Math.round(n / k);
  return {
    top: d(inner.top - outer.top),
    right: d(outer.right - inner.right),
    bottom: d(outer.bottom - inner.bottom),
    left: d(inner.left - outer.left),
  };
}

/** The tag a nudge shows: vertical arrows read Y, horizontal read X, in world px, rounded. */
export function nudgeTag(key: string, x: number, y: number): string | null {
  if (key === 'ArrowUp' || key === 'ArrowDown') return `Y ${Math.round(y)}`;
  if (key === 'ArrowLeft' || key === 'ArrowRight') return `X ${Math.round(x)}`;
  return null;
}

const CSS_TEXT = `
.ed-nudge-tag {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font: 500 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: opacity var(--dur-fast, 120ms) var(--ease-out, ease-out);
}
.ed-gap-line {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  background: var(--maude-hud-guide, var(--maude-hud-accent));
}
.ed-gap-chip {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--maude-hud-guide, var(--maude-hud-accent));
  color: var(--maude-hud-accent-fg);
  font: 500 10px/14px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .ed-nudge-tag { transition-duration: 1ms; }
}
`;

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const TAG_MS = 1200;

interface Readout {
  tag: string;
  left: number;
  top: number;
}
interface GapView {
  d: Distances;
  inner: Box;
  outer: Box;
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function oneElement(selected: readonly Selection[]): { el: Element; sel: Selection } | null {
  if (selected.length !== 1 || typeof document === 'undefined') return null;
  const sel = selected[0] as Selection;
  if (!sel.id) return null;
  const el = resolveSelectionEl(document, sel);
  return el ? { el, sel } : null;
}

export function NudgeReadout({ readOnly = false }: { readOnly?: boolean }) {
  const { selected } = useSelectionSet();
  const [tag, setTag] = useState<Readout | null>(null);
  const [gaps, setGaps] = useState<GapView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selRef = useRef(selected);
  selRef.current = selected;

  useEffect(() => {
    if (typeof document === 'undefined' || readOnly) return;
    const showGaps = () => {
      const one = oneElement(selRef.current);
      if (!one) return setGaps(null);
      const parent = stampedParent(one.el) ?? one.el.closest('.dc-artboard-body');
      if (!parent) return setGaps(null);
      const inner = boxOf(one.el);
      const outer = boxOf(parent);
      const w = (one.el as HTMLElement).offsetWidth;
      const scale = w > 0 ? (inner.right - inner.left) / w : 1;
      setGaps({ d: distancesToParent(inner, outer, scale), inner, outer });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') return showGaps();
      if (!ARROWS.has(e.key)) return;
      // after v1's handler has run (it previews inline in the same task)
      requestAnimationFrame(() => {
        const one = oneElement(selRef.current);
        if (!one || !(one.el instanceof HTMLElement)) return;
        const t = nudgeTag(e.key, one.el.offsetLeft, one.el.offsetTop);
        if (!t) return;
        const r = one.el.getBoundingClientRect();
        setTag({ tag: t, left: r.right + 6, top: r.top });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setTag(null), TAG_MS);
        if (e.altKey) showGaps();
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setGaps(null);
    };
    const onBlur = () => setGaps(null);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [readOnly]);

  if (readOnly || (!tag && !gaps)) return null;
  const g = gaps;
  const midX = g ? (g.inner.left + g.inner.right) / 2 : 0;
  const midY = g ? (g.inner.top + g.inner.bottom) / 2 : 0;
  return (
    <>
      <style>{CSS_TEXT}</style>
      {tag ? (
        <span
          className="ed-nudge-tag"
          data-testid="edit-nudge-tag"
          aria-hidden="true"
          style={{ left: tag.left, top: tag.top }}
        >
          {tag.tag}
        </span>
      ) : null}
      {g ? (
        <div data-testid="edit-nudge-gaps" aria-hidden="true">
          {(
            [
              ['top', midX, g.outer.top, 1, g.inner.top - g.outer.top, g.d.top],
              ['bottom', midX, g.inner.bottom, 1, g.outer.bottom - g.inner.bottom, g.d.bottom],
              ['left', g.outer.left, midY, g.inner.left - g.outer.left, 1, g.d.left],
              ['right', g.inner.right, midY, g.outer.right - g.inner.right, 1, g.d.right],
            ] as const
          ).map(([side, x, y, w, h, n]) => (
            <span key={side}>
              <span
                className="ed-gap-line"
                style={{ left: x, top: y, width: Math.max(1, w), height: Math.max(1, h) }}
              />
              <span
                className="ed-gap-chip"
                data-testid={`edit-gap-${side}`}
                style={{
                  left: x + (side === 'left' || side === 'right' ? w / 2 : 4),
                  top: y + (side === 'top' || side === 'bottom' ? h / 2 : 4),
                }}
              >
                {n}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
