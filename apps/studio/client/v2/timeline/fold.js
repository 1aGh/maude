// client/v2/timeline/fold.js — S7.16: fold the tracks you do not need (07 · ve-long: "Text · 18", "Graphics · 6").
//
// A folded track draws its name and how many things are on it, on one line, and no rows — a 4-minute match with 18
// titles gets its height back. The tracks stay (C35: they are DERIVED from the comp, never stored); fold only says
// which of them one person has put away. A per-viewer convenience like "+ track": it lives in this browser
// (localStorage, every access guarded) and never reaches a peer, a file or the AI. Keyed by video.
//
// `timeline.fold-track` runs `foldAtFollowed`; the track-name button in the Timeline calls `trackFold.toggle`.

import { useSyncExternalStore } from 'react';
import { trackKey } from './advanced/advanced-store.js';
import { followedVideo } from './advanced/video-cap.js';

const KEY = 'maude.timeline.fold';
const MAX_KEYS = 100;
/** The tracks that can be folded: every drawn one except the Video storyline. */
export const FOLDABLE = Object.freeze(['text', 'gfx', 'video2', 'music', 'music2']);

export const FOLD_WORDS = Object.freeze({
  /** "Text · 18" — the folded track's one line. */
  line: (label, count) => `${label} · ${count}`,
  fold: (label) => `Fold ${label}`,
  unfold: (label) => `Show ${label}`,
  folded: (label) => `${label} folded.`,
  shown: (label) => `${label} shown.`,
  none: 'Select a video first.',
  nothing: 'Nothing to fold on this video.',
  allFolded: 'Tracks folded.',
  allShown: 'Tracks shown.',
});

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
  const out = {};
  if (!text) return out;
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && !Array.isArray(j))
      for (const [k, v] of Object.entries(j).slice(0, MAX_KEYS))
        if (Array.isArray(v)) out[k] = v.filter((t) => FOLDABLE.includes(t));
  } catch {
    /* a malformed value reads as nothing folded */
  }
  return out;
}

/** @param {{ read: () => string|null, write: (t: string) => void }} [io] */
export function createFoldStore(io = browser) {
  let s = restore(io.read());
  let version = 0;
  const subs = new Set();
  const commit = (next) => {
    s = next;
    version++;
    io.write(JSON.stringify(s));
    for (const fn of subs) fn();
  };
  const store = {
    version: () => version,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    isFolded: (key, track) => (s[key] ?? []).includes(track),
    /** Fold (`on`) or show one track; returns whether anything changed. */
    set(key, track, on) {
      if (!key || !FOLDABLE.includes(track)) return false;
      const have = s[key] ?? [];
      if (have.includes(track) === on) return false;
      const next = { ...s, [key]: on ? [...have, track] : have.filter((t) => t !== track) };
      if (!next[key].length) delete next[key];
      const keys = Object.keys(next);
      if (keys.length > MAX_KEYS) delete next[keys[0]];
      commit(next);
      return true;
    },
    toggle: (key, track) => store.set(key, track, !store.isFolded(key, track)),
  };
  return store;
}

export const trackFold = createFoldStore();

/**
 * `timeline.fold-track`: fold (or show) the named track of the followed video; with no name, the busy ones — every
 * foldable track with more than one thing on it — together.
 * `at` = the followed video: `{ file, artboardId, counts?: { [trackId]: n }, labels?: { [trackId]: 'Text' } }`.
 * @returns {string} the words for the toast
 */
export function foldAtFollowed(params = {}, store = trackFold, at = followedVideo()) {
  if (!at?.file || !at.artboardId) return FOLD_WORDS.none;
  const key = trackKey(at.file, at.artboardId);
  const label = (id) => at.labels?.[id] ?? id;
  const track = params?.track;
  if (track) {
    if (!FOLDABLE.includes(track)) return FOLD_WORDS.nothing;
    const on = typeof params.folded === 'boolean' ? params.folded : !store.isFolded(key, track);
    store.set(key, track, on);
    return on ? FOLD_WORDS.folded(label(track)) : FOLD_WORDS.shown(label(track));
  }
  const counts = at.counts ?? {};
  const busy = FOLDABLE.filter((id) => (counts[id] ?? 0) > 1);
  if (!busy.length) return FOLD_WORDS.nothing;
  const allFolded = busy.every((id) => store.isFolded(key, id));
  for (const id of busy) store.set(key, id, !allFolded);
  return allFolded ? FOLD_WORDS.allShown : FOLD_WORDS.allFolded;
}

/** Re-render when anything is folded or shown. */
export function useFoldVersion() {
  return useSyncExternalStore(trackFold.subscribe, trackFold.version, trackFold.version);
}
