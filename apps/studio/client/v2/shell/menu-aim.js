// client/v2/shell/menu-aim.js — #170 F34: a submenu forgives the diagonal.
//
// Moving from File toward its open submenu crosses the rows under it (Edit, View); each row's hover used to switch the
// open submenu, so the one you were reaching for closed on the way. The rule (the "safe triangle"): while a submenu is
// open and the pointer is moving INSIDE the triangle from where it just was to the submenu's two near corners, a hover
// on another row waits a moment instead of switching. Entering the submenu, or the pointer leaving the triangle,
// settles it at once. Pure: no DOM, no timers; the menu owns those.

/** How long a hover on another row waits while the pointer is aiming at the open submenu (ms). */
export const AIM_DELAY_MS = 220;

const sign = (p, a, b) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);

/** Is `p` inside (or on the edge of) the triangle `a b c`? */
export function inTriangle(p, a, b, c) {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Is the pointer heading for the open submenu?
 * @param prev    where the pointer was a moment ago ({x, y}), or null
 * @param cur     where it is now
 * @param rect    the open submenu's box ({left, right, top, bottom})
 * @param menuRight the x of the edge of the parent menu the submenu opens from (the submenu is on its right when
 *                rect.left >= menuRight - 1, else on its left)
 */
export function aimingAtSub(prev, cur, rect, menuRight) {
  if (!prev || !cur || !rect) return false;
  if (rect.right <= rect.left || rect.bottom <= rect.top) return false;
  // the submenu's NEAR edge: its left edge when it opens to the right, its right edge when it flipped to the left
  const onRight = rect.left >= menuRight - 1;
  const x = onRight ? rect.left : rect.right;
  // already past the near edge: it is in the submenu, nothing to wait for
  if (onRight ? cur.x >= x : cur.x <= x) return false;
  // moving away from the submenu is not aiming at it
  if (onRight ? cur.x < prev.x : cur.x > prev.x) return false;
  return inTriangle(cur, prev, { x, y: rect.top }, { x, y: rect.bottom });
}
