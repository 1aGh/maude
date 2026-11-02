// client/v2/timeline/poster.js — S7.8: a video's poster frame, read and written (`video.poster.set`).
//
// The poster is the picture a video artboard rests on and the frame an export carries; it lives in the
// versioned canvas meta as `artboardMeta[id].poster` (a comp frame; absent = 35 % of the length). Reading is
// `GET /_api/canvas-meta?file=` (every role that can read the canvas); writing is the one meta route,
// `PATCH /_api/present-meta { file, poster: { [id]: frame } }` — Can edit and up, refused below that by the
// server whatever the UI shows. A small store (like `export-sizes.js`) so the ruler's flag and the ⌘K row
// read one answer; and the playhead the action sets it AT is read through `bindPosterSource`, which the
// timeline host keeps current.

import { useSyncExternalStore } from 'react';
import { mss } from './ruler.js';

export const POSTER_WORDS = Object.freeze({
  set: (frame, fps) => `Poster frame set to ${mss(frame / (fps || 30))}.`,
  readOnly: 'Your role can’t change the poster frame.',
  failed: 'Not saved — the poster frame stays as it was.',
  none: 'Select a video first.',
});

const entries = new Map(); // `${file}\u0000${id}` → frame | null
const subs = new Set();
let version = 0;
const keyOf = (file, id) => `${file}\u0000${id}`;
const notify = () => {
  version++;
  for (const fn of subs) fn();
};

/** The stored poster of one video (a frame), or null = the default. */
export const posterOf = (file, id) => entries.get(keyOf(file, id)) ?? null;

/** Read what the canvas's meta says about this video's poster. */
export async function loadPoster(file, id, fetchImpl = globalThis.fetch) {
  if (!file || !id) return;
  try {
    const r = await fetchImpl(`/_api/canvas-meta?file=${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(String(r.status));
    const meta = await r.json();
    const p = meta?.artboardMeta?.[id]?.poster;
    entries.set(keyOf(file, id), Number.isInteger(p) && p >= 0 ? p : null);
  } catch {
    // the default stays on screen
  }
  notify();
}

/** Store `frame` (null = back to the default). Resolves `{ ok, message }` — the words are the toast's. */
export async function savePoster(file, id, frame, fps, fetchImpl = globalThis.fetch) {
  const before = posterOf(file, id);
  entries.set(keyOf(file, id), frame);
  notify();
  try {
    const r = await fetchImpl('/_api/present-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, poster: { [id]: frame } }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    const kept = body?.poster?.[id];
    entries.set(keyOf(file, id), Number.isInteger(kept) ? kept : null);
    notify();
    return {
      ok: true,
      message: frame === null ? 'Poster frame reset.' : POSTER_WORDS.set(frame, fps),
    };
  } catch (e) {
    entries.set(keyOf(file, id), before);
    notify();
    return {
      ok: false,
      message: /403/.test(String(e?.message)) ? POSTER_WORDS.readOnly : POSTER_WORDS.failed,
    };
  }
}

// ── the playhead the action reads ───────────────────────────────────────────────────────────────────
let source = () => null;
/** The timeline host says where the playhead is: `() => ({ file, artboardId, frame, fps } | null)`. */
export function bindPosterSource(fn) {
  source = typeof fn === 'function' ? fn : () => null;
}

/** `video.poster.set`: the followed video's poster becomes the frame under the playhead. Resolves the toast's words. */
export async function setPosterAtPlayhead(fetchImpl = globalThis.fetch) {
  const at = source();
  if (!at?.file || !at.artboardId) return POSTER_WORDS.none;
  const done = await savePoster(
    at.file,
    at.artboardId,
    Math.max(0, Math.round(at.frame)),
    at.fps,
    fetchImpl
  );
  return done.message;
}

/** Re-renders when any poster changes. */
export function usePosterVersion() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => version,
    () => version
  );
}
