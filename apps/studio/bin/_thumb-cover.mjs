// _thumb-cover.mjs — which artboard is a canvas's cover (C31, W5). Pure: the thumbnail renderer
// (`_thumbs-playwright.mjs`) imports it, and the tests import it without starting a browser.

/** An artboard worth being a cover: not a sliver (a header strip, a divider) — a cover is shown at ~16:10. */
export const MIN_COVER_SIDE = 80;
export const MAX_COVER_ASPECT = 5;
export const coverWorthy = (r) =>
  (r.w ?? 0) >= MIN_COVER_SIDE &&
  (r.h ?? 0) >= MIN_COVER_SIDE &&
  Math.max(r.w / r.h, r.h / r.w) <= MAX_COVER_ASPECT;

/** The first of `rects` row by row, left to right. */
export function topLeft(rects) {
  if (!rects.length) return null;
  const minY = Math.min(...rects.map((r) => r.y));
  const minH = Math.min(...rects.map((r) => r.h ?? 0).filter((h) => h > 0), 1);
  const top = rects.filter((r) => r.y < minY + minH / 2);
  return top.sort((a, b) => a.x - b.x)[0]?.id ?? rects[0].id;
}

/**
 * C31: the first artboard in "Order and notes…" when set (that always wins), else the top-left one among
 * those worth a cover (W5: a 480 x 42 header slice or a 3320 x 200 strip is not one — the phone below it
 * is). null when none is: the caller then shows the board, or falls back to `pickAny`.
 */
export function pickCover(rects, order) {
  if (Array.isArray(order)) for (const id of order) if (rects.some((r) => r.id === id)) return id;
  return topLeft(rects.filter(coverWorthy));
}

/** No artboard is worth a cover and there is no board: the biggest one beats a blank card. */
export function pickAny(rects) {
  const big = [...rects].sort((a, b) => (b.w ?? 0) * (b.h ?? 0) - (a.w ?? 0) * (a.h ?? 0))[0];
  return big?.id ?? null;
}
