// client/v2/timeline/advanced/advanced-store.js — S7.18: the Timeline's Advanced, as a person left it.
//
//   (open or closed is the shared Advanced fold `timeline` — remembered per Mac, covered by ⌘K "Open all Advanced
//   sections"; this store holds only what the fold shows)
//   mode      the ruler's numbers: `timecode` (m:ss, today's) or `frames` (the frame numbers)
//   kf        the keyframe whose curve the panel shows (`{ component, index }`), or null
//   tracks    the empty tracks a person asked for with "+ track", per video (Video 2 · Music 2) — a view, never bytes
//             (C35: a comp's tracks are DERIVED from what it says; an asked-for empty one is only drawn)
//
// A per-viewer convenience: it lives in this browser (localStorage, every access guarded) and never reaches a
// peer, a file or the AI. A tiny subscribe seam so the foot, the ruler and the markers read one answer.

import { useSyncExternalStore } from 'react';

const KEY = 'maude.timeline.advanced';
const MAX_KEYS = 100;
/** The tracks "+ track" can add; the four fixed ones are always there. */
export const ADDABLE_TRACKS = Object.freeze(['video2', 'music2']);
export const MODES = Object.freeze(['timecode', 'frames']);

const browser = {
  read() {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  },
  write(text) {
    try {
      globalThis.localStorage?.setItem(KEY, text);
    } catch {
      /* private window, blocked storage: it just does not remember */
    }
  },
};

function restore(text) {
  const out = { mode: 'timecode', tracks: {} };
  if (!text) return out;
  try {
    const j = JSON.parse(text);
    if (MODES.includes(j?.mode)) out.mode = j.mode;
    if (j?.tracks && typeof j.tracks === 'object' && !Array.isArray(j.tracks))
      for (const [k, v] of Object.entries(j.tracks).slice(0, MAX_KEYS))
        if (Array.isArray(v)) out.tracks[k] = v.filter((t) => ADDABLE_TRACKS.includes(t));
  } catch {
    /* a malformed value reads as the default */
  }
  return out;
}

/** @param {{ read: () => string|null, write: (t: string) => void }} [io] */
export function createAdvancedStore(io = browser) {
  let s = { ...restore(io.read()), kf: null };
  let snap = null;
  const subs = new Set();
  const set = (next) => {
    s = next;
    snap = null;
    io.write(JSON.stringify({ mode: s.mode, tracks: s.tracks }));
    for (const fn of subs) fn();
  };
  return {
    get() {
      if (!snap) snap = { mode: s.mode, kf: s.kf, tracks: s.tracks };
      return snap;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    setMode(mode) {
      if (MODES.includes(mode) && mode !== s.mode) set({ ...s, mode });
    },
    /** Pick the keyframe whose curve shows (`null` lets go). */
    selectKeyframe(kf) {
      const next = kf && typeof kf.component === 'string' && Number.isInteger(kf.index) ? kf : null;
      const same =
        (next === null && s.kf === null) ||
        (next && s.kf && s.kf.component === next.component && s.kf.index === next.index);
      if (same) return;
      set({ ...s, kf: next });
    },
    /** The empty tracks asked for on one video. */
    tracksFor(key) {
      return s.tracks[key] ?? [];
    },
    /** "+ track": Video 2 or Music 2 on this video (already there: nothing changes). Returns whether it added. */
    addTrack(key, track) {
      if (!key || !ADDABLE_TRACKS.includes(track)) return false;
      const have = s.tracks[key] ?? [];
      if (have.includes(track)) return false;
      const tracks = { ...s.tracks, [key]: [...have, track] };
      const keys = Object.keys(tracks);
      if (keys.length > MAX_KEYS) delete tracks[keys[0]];
      set({ ...s, tracks });
      return true;
    },
    /** Take an asked-for empty track away again. */
    removeTrack(key, track) {
      const have = s.tracks[key] ?? [];
      if (!have.includes(track)) return;
      set({ ...s, tracks: { ...s.tracks, [key]: have.filter((t) => t !== track) } });
    },
  };
}

export const advancedStore = createAdvancedStore();

/** The key one video's asked-for tracks are filed under. */
export const trackKey = (file, artboardId) => `${file ?? ''}\u0000${artboardId ?? ''}`;

export function useAdvanced() {
  return useSyncExternalStore(advancedStore.subscribe, advancedStore.get, advancedStore.get);
}
