// client/v2/inspector/formats-ui.js — S7.13: how ⌘K reaches the Formats rows (`video.format.add`, `video.format.unlink`).
//
// The two registry actions have no parameters to take from a palette row: "Add a format" needs a size and "Make an unlinked
// copy" needs the artboard. The Formats section (sections/formats.jsx) is where both are chosen, so it registers itself here
// while a video artboard is selected: ⌘K "Add a format" opens its size list, ⌘K "Make an unlinked copy" runs on that artboard.
// With no video artboard selected there is nothing to act on, and the answer says so in a sentence instead of doing nothing.
//
// Per-viewer UI state only: nothing is stored, nothing is sent from here.

import { useSyncExternalStore } from 'react';
import { compMediaStore } from '../transcript/comp-media-store.js';

/** @type {{ canUnlink: boolean, unlink: () => void } | null} */
let env = null;
let addTick = 0;
// 07 VideoInspector: a video with no other format draws no Formats rows. A video's own rows say one is selected
// (`present`); Cmd-K "Add a format" then asks for the rows (`asked`) until another artboard is selected.
let present = 0;
let asked = false;
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
    if (!env && !present) return NO_VIDEO_WORDS;
    asked = true;
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
  /** A video artboard's own rows are showing. Returns the way to take it back; a new selection drops the ask. */
  presence() {
    present += 1;
    return () => {
      present -= 1;
      asked = false;
      notify();
    };
  },
  /** Cmd-K asked for the Formats rows on a video that has only one format. */
  asked: () => asked,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  addTick: () => addTick,
  /** Tests only. */
  reset() {
    env = null;
    addTick = 0;
    present = 0;
    asked = false;
    notify();
  },
};

/** The count of "Add a format" requests so far: a change opens the list. */
export function useAddRequests() {
  return useSyncExternalStore(formatsUi.subscribe, formatsUi.addTick, formatsUi.addTick);
}

/**
 * 07's video card (ve-select) is Size · Length · Poster · Sound · Export and nothing else. The Formats rows (and the
 * Safe zones under them) join it once the video shares its cut with another format or has an unlinked copy
 * (ve-formats) — or when Cmd-K "Add a format" asks for them on a lone video.
 */
export function videoHasFormats(selection, ctx) {
  if (formatsUi.asked()) return true;
  const el = Array.isArray(selection) ? selection[0] : selection;
  const canvas = ctx?.canvasFile ?? el?.file ?? null;
  const id =
    el?.artboardId || /^\[data-dc-screen="([^"]+)"\]$/.exec(el?.selector || '')?.[1] || null;
  const f = canvas && id ? compMediaStore.get(canvas, id)?.formats : null;
  return !!f && (f.formats?.length > 1 || f.copies?.length > 0 || !!f.unlinkedFrom);
}

/** The frame re-draws its sections when the comp's formats arrive or an "Add a format" is asked for. */
export function useFormatsVersion() {
  useSyncExternalStore(compMediaStore.subscribe, compMediaStore.version, compMediaStore.version);
  useSyncExternalStore(formatsUi.subscribe, formatsUi.addTick, formatsUi.addTick);
}
