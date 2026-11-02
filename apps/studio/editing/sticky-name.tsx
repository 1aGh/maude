// editing/sticky-name.tsx — S2.8 (artboard ed-edge-huge, "A 6000 px page"): "Its name sticks to the top of the window."
//
// A page six screens tall scrolls its own name away. While you are inside it, the name rides at the window's top
// ("Domů · Desktop  1440 × 6000") and goes up with the page's bottom edge when you reach the end. When the page's
// own label is on screen the chip is not drawn — the real label is there. Pure plan, one small view.

import { type ReactNode, useEffect, useState } from 'react';

import { sizeText, stickyNameTop } from './artboard-resize.ts';
import { type LongPage, measureLongPages, pageInView } from './long-page.ts';

export interface StickyChip {
  id: string;
  name: string;
  size: string;
  left: number;
  top: number;
}

export const CHIP_HEIGHT = 22;
const INSET = 8;

/** The chips to draw: one for the long page the window is inside, only once its own label has scrolled away. */
export function planStickyChips(pages: readonly LongPage[]): StickyChip[] {
  const p = pageInView(pages);
  if (!p) return [];
  // the real label is on screen: nothing to add
  if (p.label.top >= INSET) return [];
  const top = stickyNameTop(p.label.top, p.body.bottom, CHIP_HEIGHT, INSET);
  if (top === null) return [];
  return [
    {
      id: p.id,
      name: p.name,
      size: sizeText(p.w, p.h),
      // follow the page's left edge, but never off the window's left
      left: Math.min(Math.max(p.label.left, INSET), Math.max(INSET, p.body.right - 120)),
      top,
    },
  ];
}

const CSS_TEXT = `
.ed-sticky-name {
  position: fixed;
  z-index: 9;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
  height: ${CHIP_HEIGHT}px;
  padding: 0 var(--space-2, 8px);
  border-radius: 3px;
  background: var(--maude-chrome-bg-2);
  color: var(--maude-chrome-fg-0);
  border: 1px solid var(--maude-chrome-border);
  font: 500 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  white-space: nowrap;
}
.ed-sticky-name > span {
  margin-left: 4px;
  color: var(--maude-chrome-fg-1);
  font-variant-numeric: tabular-nums;
}
`;

const same = (a: StickyChip[], b: StickyChip[]) =>
  a.length === b.length &&
  a.every((c, i) => {
    const o = b[i] as StickyChip;
    return (
      c.id === o.id &&
      c.name === o.name &&
      c.size === o.size &&
      c.left === o.left &&
      c.top === o.top
    );
  });

/** Polls the canvas ~10×/s (a scroll is a pan — the DOM does not tell us) and draws the chip when there is one. */
export function StickyName({ pollMs = 100 }: { pollMs?: number }): ReactNode {
  const [chips, setChips] = useState<StickyChip[]>([]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const run = () => {
      if (document.hidden) return;
      const next = planStickyChips(measureLongPages(document));
      setChips((prev) => (same(prev, next) ? prev : next));
    };
    run();
    const t = setInterval(run, pollMs);
    return () => clearInterval(t);
  }, [pollMs]);
  if (!chips.length) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      {chips.map((c) => (
        <span
          key={c.id}
          className="ed-sticky-name"
          data-testid="ed-sticky-name"
          aria-hidden="true"
          style={{ left: c.left, top: c.top }}
        >
          {c.name}
          <span>{c.size}</span>
        </span>
      ))}
    </>
  );
}
