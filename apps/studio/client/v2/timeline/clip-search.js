// client/v2/timeline/clip-search.js — S7.16: ⌘K finds a clip by name (07 · ve-long). Provider id `timeline.clips`.
//
// The Timeline publishes the clips of the video it follows (`bindClips`); Search ⌘K draws one row per clip in a "Clips"
// group, and a row selects the clip and puts the playhead on it. Nothing here asks a server: the clips are the ones the
// Timeline already parsed, so a 40-clip match is found by the same words the timeline shows. A person with no video
// open sees no Clips group at all.
//
// The shell merges `clipSearchRows()` into the palette's rows beside the registry, Settings and the Design system
// (hooks/use-palette-and-panels.jsx) and re-reads them when `useClipRowsVersion` moves.

import { useSyncExternalStore } from 'react';
import { mss } from './ruler.js';

/** The provider's id (S7.16): what the registry and the tests name. */
export const CLIP_PROVIDER_ID = 'timeline.clips';
/** The Search group the rows sit in (search-model.js GROUPS). */
export const CLIPS_GROUP = 'clips';
/** A video with more clips than this is searched by its first ones — a runaway comp must not flood ⌘K. */
export const MAX_CLIP_ROWS = 400;

let current = null; // { clips, go, fps }
let version = 0;
const subs = new Set();
const notify = () => {
  version++;
  for (const fn of subs) fn();
};

/**
 * The Timeline says which clips ⌘K may find.
 * @param {null | { clips: { id: string, name: string, from: number, frames: number, src?: string|null }[],
 *                  go: (clip: object) => void, fps: number }} next  null = no video followed
 */
export function bindClips(next) {
  const same =
    (next === null && current === null) ||
    (next &&
      current &&
      JSON.stringify(next.clips) === JSON.stringify(current.clips) &&
      next.fps === current.fps);
  current = next;
  if (!same) notify();
}

const fileStem = (src) =>
  String(src ?? '')
    .replace(/[?#].*$/, '')
    .split('/')
    .pop()
    ?.replace(/\.[A-Za-z0-9]{1,5}$/, '') || '';

/** Search rows (search-model.js row shape), one per clip of the followed video. `[]` with no video. */
export function clipSearchRows() {
  if (!current?.clips?.length) return [];
  const fps = Math.max(1, Math.round(current.fps) || 30);
  return current.clips.slice(0, MAX_CLIP_ROWS).map((c) => {
    const stem = fileStem(c.src);
    return {
      group: CLIPS_GROUP,
      id: `clip:${c.id}`,
      name: c.name,
      meta: `Clip · ${mss(Math.max(0, c.frames) / fps)} · at ${mss(Math.max(0, c.from) / fps)}`,
      keys: '',
      where: '',
      advanced: false,
      icon: 'video',
      disabled: false,
      keywords:
        stem && stem.toLowerCase() !== String(c.name).toLowerCase() ? [stem, 'clip'] : ['clip'],
      searchRow: true,
      onlyWhenSearched: true,
      runnable: () => true,
      run: () => current?.go(c),
    };
  });
}

/** Re-renders (and re-reads the rows) when the followed video's clips change. */
export function useClipRowsVersion() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => version,
    () => version
  );
}
