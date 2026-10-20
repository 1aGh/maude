// client/v2/timeline/playhead.js — S7.8: what the transport remembers between key presses — each video's loop
// band (I / O) and whether the playhead was just stepped by hand (the "0:07 + 2 frames" readout). Playback
// state, not file state: nothing here is written to the comp, and a reload starts clean.
//
// A tiny subscribe store (like `timeline-store.js`) so the keys, the ruler and the Timeline read one answer.

import { useSyncExternalStore } from 'react';
import { isBand } from './transport.js';

/** How long the time keeps showing the frame after the last ← / →. */
export const STEP_READOUT_MS = 1500;
const MAX_BANDS = 200;

export function createPlaybackStore({ now = () => Date.now(), setTimer = setTimeout } = {}) {
  let bands = new Map();
  let steppedUntil = 0;
  let version = 0;
  let timer = null;
  const subs = new Set();
  const bump = () => {
    version++;
    for (const fn of subs) fn();
  };
  return {
    /** Changes whenever anything here does — the `useSyncExternalStore` snapshot. */
    version: () => version,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    /** The loop band of one video (`{ in, out }` frames) or null. */
    loopFor: (id) => bands.get(id) ?? null,
    setLoop(id, band) {
      if (typeof id !== 'string' || !id) return;
      if (!isBand(band)) {
        this.clearLoop(id);
        return;
      }
      bands.delete(id);
      bands.set(id, { in: band.in, out: band.out });
      if (bands.size > MAX_BANDS) bands.delete(bands.keys().next().value);
      bump();
    },
    clearLoop(id) {
      if (bands.delete(id)) bump();
    },

    /** The playhead was moved by hand (← / →): the time shows its frame for a moment. */
    markStep() {
      steppedUntil = now() + STEP_READOUT_MS;
      if (timer !== null) clearTimeout(timer);
      timer = setTimer(() => {
        timer = null;
        bump();
      }, STEP_READOUT_MS + 10);
      bump();
    },
    stepping: () => now() < steppedUntil,

    /** Another canvas: its videos are not these videos. */
    reset() {
      bands = new Map();
      steppedUntil = 0;
      bump();
    },
  };
}

/** The shell's one playback store. */
export const playbackStore = createPlaybackStore();

/** Re-renders when the loop band or the step readout changes. Returns the store for reading. */
export function usePlayback(store = playbackStore) {
  useSyncExternalStore(store.subscribe, store.version, store.version);
  return store;
}
