// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import type { CSSProperties } from 'react';

/** A timed entrance: `d` is the delay in ms on the page's intro clock (see `T`). */
export const at = (d: number): CSSProperties => ({ ['--d' as string]: `${d}ms` });

/** The intro clock (ms), shared by the hero and the product shot: one source for both. */
export const T = {
  line1: 0,
  line2: 90,
  line3: 360,
  spark: 520,
  lede: 500,
  ctas: 620,
  shot: 760,
  ask: 1300,
  reply: 1800,
  working: 2100,
  cursor: 2100,
  card1: 2700,
  card2: 2820,
  card3: 2940,
  prices: 3260,
  done: 3700,
  sticky: 3900,
};
