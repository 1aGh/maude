// Where the element bar (annotations-context-toolbar.tsx) sits vertically: above the selection when there is
// headroom, else below it. Headroom is measured from the edge of the VISIBLE canvas, so it counts the top
// inset the shell's islands cover (`occluded-insets`, V2-1.2 §5.6) — the Preview bar must never sit over the
// bar's buttons (p8-fix-a F21). Leaf module: no React, no DOM.

/** The least gap kept between the bar and the edge of the visible canvas. */
const EDGE = 8;

export function barTopFor(
  sel: { y: number; h: number },
  barH: number,
  margin: number,
  topInset: number
): number {
  const inset = Number.isFinite(topInset) && topInset > 0 ? topInset : 0;
  const above = sel.y - barH - margin;
  return above < EDGE + inset ? sel.y + sel.h + margin : above;
}
