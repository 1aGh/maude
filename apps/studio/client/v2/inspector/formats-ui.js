// client/v2/inspector/formats-ui.js — S7.13: how ⌘K reaches the Formats rows (`video.format.add`, `video.format.unlink`).
//
// The two registry actions have no parameters to take from a palette row: "Add a format" needs a size and "Make an unlinked
// copy" needs the artboard. The Formats section (sections/formats.jsx) is where both are chosen, so it registers itself here
// while a video artboard is selected: ⌘K "Add a format" opens its size list, ⌘K "Make an unlinked copy" runs on that artboard.
// With no video artboard selected there is nothing to act on, and the answer says so in a sentence instead of doing nothing.
//
// Per-viewer UI state only: nothing is stored, nothing is sent from here.

import { useSyncExternalStore } from 'react';

/** @type {{ canUnlink: boolean, unlink: () => void } | null} */
let env = null;
let addTick = 0;
const subs = new Set();
const notify = () => {
  for (const fn of subs) fn();
};

export const NO_VIDEO_WORDS = 'Select a video artboard first.';
export const NOTHING_TO_UNLINK_WORDS = 'This format already has its own cut.';

export const formatsUi = {
  /** The Formats section is showing for a video artboard. Returns the way to take it back. */
  register(next) {
    env = next;
    return () => {
      if (env === next) env = null;
    };
  },
  /** ⌘K "Add a format": open the size list. @returns {string|null} what to tell the person when it cannot */
  requestAdd() {
    if (!env) return NO_VIDEO_WORDS;
    addTick += 1;
    notify();
    return null;
  },
  /** ⌘K "Make an unlinked copy". @returns {string|null} */
  unlink() {
    if (!env) return NO_VIDEO_WORDS;
    if (!env.canUnlink) return NOTHING_TO_UNLINK_WORDS;
    env.unlink();
    return null;
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  addTick: () => addTick,
  /** Tests only. */
  reset() {
    env = null;
    addTick = 0;
    notify();
  },
};

/** The count of "Add a format" requests so far: a change opens the list. */
export function useAddRequests() {
  return useSyncExternalStore(formatsUi.subscribe, formatsUi.addTick, formatsUi.addTick);
}
