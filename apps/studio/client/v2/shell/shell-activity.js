// client/v2/shell/shell-activity.js — 2.0.4 (task O): the shell window's one activity clock, for its server polls.
//
// The canvas's clock (editing/page-activity.ts) turns idle after 3 s and counts node changes as use; the shell
// re-renders on its own (relative times, live rows), so here only input, messages from the canvas, resize, focus
// and visibility count, and "unused" starts after a minute. `pacedInterval(fn, ms, shellActivity())` keeps the pace
// while the window is used, slows while it is only looked at, and stops while it is hidden.

import { createPageActivity, domActivityEnv } from '../../../editing/page-activity.ts';

export const SHELL_IDLE_AFTER_MS = 60_000;

let one = null;

/** The shell's activity clock (made on first use; null outside a browser). */
export function shellActivity() {
  if (one || typeof window === 'undefined' || typeof document === 'undefined') return one;
  one = createPageActivity(domActivityEnv(window, { nodes: false }), SHELL_IDLE_AFTER_MS);
  return one;
}
