/**
 * @file       artboard-growth-tag.tsx — S7.21 (08 ak-web-hug).
 * @scope      apps/studio/artboard-growth-tag.tsx
 * @purpose    "+ 373 px" beside a web page that just grew: add a section and the page gets longer, and the tag says
 *             by how much, for a few seconds, then goes. It is a mark on the canvas, never part of the design:
 *             it carries `.dc-artboard-guides` (the one class every exporter hides — exporters/capture-chrome.ts —
 *             and Present never paints), sits OUTSIDE `.dc-artboard`, and is aria-hidden / pointer-events none.
 *
 *             Only a web page that hugs its content grows (a fixed height is the number you set), and only a
 *             growth shows: the first measurement is the baseline, shrinking clears the tag, and a nudge under
 *             `GROWTH_MIN` px is layout noise, not an edit.
 */

import { useEffect, useRef, useState } from 'react';

/** Smaller than this is a re-measure, not a section being added. */
export const GROWTH_MIN = 8;
/** How long the tag stays up after the page grew. */
export const GROWTH_MS = 6000;

/**
 * What a new measurement means for the tag: a number of px (grew by that much), 'clear' (it shrank) or null
 * (nothing to say).
 */
export function growthStep(prev: number | null, next: number): number | 'clear' | null {
  if (prev === null || !(next > 0)) return null;
  const d = Math.round(next - prev);
  if (d >= GROWTH_MIN) return d;
  if (d < 0) return 'clear';
  return null;
}

/** The tag's words, "+ 373 px". */
export const growthWords = (delta: number): string => `+ ${Math.round(delta)} px`;

/** How much the page grew in its last edit, while the tag is up. Null otherwise. */
export function useGrowthDelta(active: boolean, height: number): number | null {
  const prev = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      prev.current = null;
      setDelta(null);
      return;
    }
    const step = growthStep(prev.current, height);
    if (height > 0) prev.current = height;
    if (step === null) return;
    if (timer.current) clearTimeout(timer.current);
    if (step === 'clear') {
      setDelta(null);
      return;
    }
    setDelta(step);
    timer.current = setTimeout(() => setDelta(null), GROWTH_MS);
  }, [active, height]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return delta;
}

const TAG_BG = 'oklch(95% 0.03 250)';
const TAG_FG = 'oklch(38% 0.12 250)';
const TAG_EDGE = 'oklch(70% 0.1 250)';

/** The mark, in world coordinates, to the right of the page's bottom edge. */
export function ArtboardGrowthTag({
  x,
  bottom,
  delta,
}: {
  x: number;
  bottom: number;
  delta: number | null;
}) {
  if (delta === null) return null;
  return (
    <div
      className="dc-artboard-guides dc-artboard-growth"
      data-testid="artboard-growth-tag"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x + 12,
        top: bottom - 28,
        padding: '3px 8px',
        borderRadius: 6,
        border: `1px solid ${TAG_EDGE}`,
        background: TAG_BG,
        color: TAG_FG,
        font: '600 12px/16px system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        // screen-sized at any zoom: 12 world px is 3 px at the 28 % a long page is seen at
        transformOrigin: '0 0',
        transform: 'scale(calc(1 / var(--dc-zoom, 1)))',
      }}
    >
      {growthWords(delta)}
    </div>
  );
}
ArtboardGrowthTag.displayName = 'ArtboardGrowthTag';
