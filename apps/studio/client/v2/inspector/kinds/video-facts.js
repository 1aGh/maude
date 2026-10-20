// client/v2/inspector/kinds/video-facts.js — S7.21: what the Video inspector knows about a video artboard that the
// artboard element itself does not say: its length, frame rate and sound.
//
//   Length / fps   a video-comp announces them (`timeline-comps`, DDR-148); the shell bridge hands every announcement to
//                  `publishVideoComps(file, comps)` and the inspector reads `videoFactsOf(file, artboardId)`. Nothing is
//                  fetched for them, nothing is stored: they are the comp's own numbers.
//   Sound          the first music clip of the comp — `GET /_api/comp-clips` (the one clip enumerator, DDR-150; read-only,
//                  main origin). Read once per (canvas, artboard) and again when the comp announces a different length.
//
// A small external store (like the poster's, `timeline/poster.js`) so the rows redraw when an announcement lands.

import { useEffect, useSyncExternalStore } from 'react';
import { loadPoster, posterOf, usePosterVersion } from '../../timeline/poster.js';
import { posterFrame, soundName } from './artboard-kinds-model.js';

const MAX_ENTRIES = 200;
const comps = new Map(); // `${file}\u0000${artboardId}` → { fps, durationInFrames, compId }
const sounds = new Map(); // same key → { name } | { name: '' } (read, none) — absent = not read yet
const subs = new Set();
let version = 0;
const keyOf = (file, id) => `${file}\u0000${id}`;
const notify = () => {
  version++;
  for (const fn of subs) fn();
};

/** The shell heard the active canvas's comps. Each names the artboard it sits in. */
export function publishVideoComps(file, list) {
  if (!file || !Array.isArray(list)) return;
  let changed = false;
  for (const c of list) {
    const id = c?.artboardId;
    if (typeof id !== 'string' || !id) continue;
    const next = { fps: c.fps, durationInFrames: c.durationInFrames, compId: c.id };
    const k = keyOf(file, id);
    const prev = comps.get(k);
    if (prev && prev.fps === next.fps && prev.durationInFrames === next.durationInFrames) continue;
    if (comps.size >= MAX_ENTRIES) comps.delete(comps.keys().next().value);
    comps.set(k, next);
    sounds.delete(k); // the clips may have changed with the length
    changed = true;
  }
  if (changed) notify();
}

/** `{ fps, durationInFrames, compId }` of one video artboard, or null before its comp has announced itself. */
export const videoFactsOf = (file, artboardId) => comps.get(keyOf(file, artboardId)) ?? null;

/** The sound row's name; '' when the comp has no music; null until it has been read. */
export const soundOf = (file, artboardId) => sounds.get(keyOf(file, artboardId))?.name ?? null;

/** Read the comp's music clip (the first Audio layer). Never throws: a failed read leaves the row on "None yet". */
export async function loadSound(file, artboardId, fetchImpl = globalThis.fetch) {
  if (!file || !artboardId) return;
  const k = keyOf(file, artboardId);
  let name = '';
  try {
    const r = await fetchImpl(
      `/_api/comp-clips?canvas=${encodeURIComponent(file)}&artboardId=${encodeURIComponent(artboardId)}`
    );
    if (r.ok) {
      const body = await r.json();
      const audio = (body?.clips ?? []).find((c) => c?.mediaTag === 'Audio' && c?.mediaSrc);
      name = audio ? soundName(audio.mediaSrc) : '';
    }
  } catch {
    /* "None yet" stays */
  }
  if (sounds.size >= MAX_ENTRIES) sounds.delete(sounds.keys().next().value);
  sounds.set(k, { name });
  notify();
}

/** What the shell knows about this video: its comp's numbers, its stored poster, its music. Re-reads on change. */
export function useVideoFacts(file, artboardId) {
  useVideoFactsVersion();
  usePosterVersion();
  const length = file && artboardId ? videoFactsOf(file, artboardId)?.durationInFrames : null;
  useEffect(() => {
    if (!file || !artboardId) return;
    void loadPoster(file, artboardId);
    if (soundOf(file, artboardId) === null) void loadSound(file, artboardId);
    // the clips may have changed with the length: `publishVideoComps` forgot the sound, so it is read again
  }, [file, artboardId, length]);
  const comp = file && artboardId ? videoFactsOf(file, artboardId) : null;
  const stored = file && artboardId ? posterOf(file, artboardId) : null;
  return {
    fps: comp?.fps ?? null,
    durationInFrames: comp?.durationInFrames ?? null,
    poster: comp ? posterFrame(stored, comp.durationInFrames) : stored,
    sound: file && artboardId ? soundOf(file, artboardId) : null,
  };
}

/** Re-renders when any comp announcement or sound read lands. */
export function useVideoFactsVersion() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => version,
    () => version
  );
}

/** Tests only. */
export function resetVideoFacts() {
  comps.clear();
  sounds.clear();
  notify();
}
