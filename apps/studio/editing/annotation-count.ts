// apps/studio/editing/annotation-count.ts — #227: how many annotations the canvas's board holds.
//
// The annotation layer is the only code that knows the board (hidden with ⇧P, folded into the far-zoom
// mosaic or panned out of view, an annotation is still on the canvas — so the DOM is not the answer). It
// writes the number here; the empty-state reporter (empty-report.ts) reads it and sends it with the
// artboard count, so "Your canvas is ready." never sits over a canvas somebody has already drawn on.

let count = 0;
const subs = new Set<() => void>();

export function setAnnotationCount(n: number): void {
  const next = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  if (next === count) return;
  count = next;
  for (const fn of subs) fn();
}

export const annotationCount = (): number => count;

export function onAnnotationCount(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
