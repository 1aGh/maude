// client/v2/transcript/comp-media-store.js — S7.11: the comp's words, read once and shared.
//
// `GET /_api/comp-media` (routes/video.ts) is the one derivation of a video's words, speech and beats. Three
// surfaces read it — the Text track's caption lane, the Transcript panel and the Captions inspector — so one
// store holds the answer per (canvas, artboard) and one feed (`TranscriptHost`) keeps it fresh: it asks again
// when the canvas changed (the comp announced itself again, a teammate wrote, our own write landed).
//
// Nothing here is persisted; the server's answer is the truth. A failed read keeps the last good answer and
// says `error`, so a flaky moment does not blank the panel.

import { useSyncExternalStore } from 'react';

const MAX_ENTRIES = 24;

/** @type {Map<string, { media: any | null, status: 'loading' | 'ready' | 'error', ask: number }>} */
const entries = new Map();
const subs = new Set();
let version = 0;
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

export const compMediaKey = (canvas, artboard) => `${canvas}\u0000${artboard ?? ''}`;

export const compMediaUrl = (canvas, artboard) =>
  `/_api/comp-media?canvas=${encodeURIComponent(canvas)}${artboard ? `&artboard=${encodeURIComponent(artboard)}` : ''}`;

export const compMediaStore = {
  /** The last good answer for this video, or null. */
  get(canvas, artboard) {
    return entries.get(compMediaKey(canvas, artboard))?.media ?? null;
  },
  status(canvas, artboard) {
    return entries.get(compMediaKey(canvas, artboard))?.status ?? null;
  },
  /**
   * Read it again. Resolves the answer (or the last good one when the read failed, or null).
   * A newer ask for the same video wins: an older answer arriving late is dropped.
   */
  async load(canvas, artboard, { fetchImpl = globalThis.fetch } = {}) {
    if (!canvas) return null;
    const k = compMediaKey(canvas, artboard);
    const prev = entries.get(k);
    const ask = (prev?.ask ?? 0) + 1;
    entries.set(k, { media: prev?.media ?? null, status: prev?.media ? 'ready' : 'loading', ask });
    if (!prev) notify();
    let media = null;
    let ok = false;
    try {
      const r = await fetchImpl(compMediaUrl(canvas, artboard));
      if (r.ok) {
        media = await r.json();
        ok = !!media && typeof media === 'object';
      }
    } catch {
      ok = false;
    }
    const cur = entries.get(k);
    if (!cur || cur.ask !== ask) return cur?.media ?? null;
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
    entries.set(k, { media: ok ? media : cur.media, status: ok ? 'ready' : 'error', ask });
    notify();
    return entries.get(k).media;
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  version: () => version,
  /** Tests only. */
  reset() {
    entries.clear();
    notify();
  },
};

/** The video's words, re-rendered when they change. `{ media, status }`; media is null before the first read. */
export function useCompMedia(canvas, artboard) {
  useSyncExternalStore(compMediaStore.subscribe, compMediaStore.version, compMediaStore.version);
  return {
    media: canvas ? compMediaStore.get(canvas, artboard) : null,
    status: canvas ? compMediaStore.status(canvas, artboard) : null,
  };
}
