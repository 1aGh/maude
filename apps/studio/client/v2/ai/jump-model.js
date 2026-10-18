// client/v2/ai/jump-model.js — S5.9 (03 AI Chat `ai-long`): "Jump to latest · N new" and the panel's
// full-height state, as pure functions.
//
// A long chat scrolls. While you read earlier turns the chat keeps growing; the pill says how many
// messages arrived since you left the bottom, and one click brings you back. At the bottom it is gone.

/** How far from the bottom (px) still counts as "at the latest". */
export const BOTTOM_SLACK = 48;
/** The pill appears once you are at least this far up (px) — a nudge of a line is not "reading earlier". */
export const AWAY_AFTER = 96;
/** A chat this many messages long gets the whole window's height on its own. */
export const LONG_AFTER = 8;

export function distanceFromBottom(el) {
  return Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
}

/**
 * Tracks the scroll position against the message count.
 *   update({ distance, total }) → { visible, newCount }
 * `visible` = scrolled up past AWAY_AFTER; `newCount` = messages that arrived since the viewport left
 * the bottom (0 on arrival back). The baseline is the count at the moment you left the bottom.
 */
export function createJumpTracker() {
  let baseline = null; // null = at the bottom
  return {
    update({ distance, total }) {
      if (distance <= BOTTOM_SLACK) {
        baseline = null;
        return { visible: false, newCount: 0 };
      }
      if (baseline === null) baseline = total;
      return {
        visible: distance > AWAY_AFTER,
        newCount: Math.max(0, total - baseline),
      };
    },
  };
}

/** "Jump to latest" · "Jump to latest · 2 new". */
export function jumpLabel(newCount) {
  return newCount > 0
    ? { text: 'Jump to latest', count: `${newCount} new` }
    : { text: 'Jump to latest', count: '' };
}

/**
 * The panel's height state. `override` is what the person chose by double-clicking the edge
 * (`'full'` | `'compact'` | null = let the chat decide). Long chats get the full height on their own.
 */
export function isFullHeight({ override = null, total = 0 } = {}) {
  if (override === 'full') return true;
  if (override === 'compact') return false;
  return total >= LONG_AFTER;
}

/** Double-click on the edge: flips whatever is showing now. */
export function toggleOverride(showingFull) {
  return showingFull ? 'compact' : 'full';
}
