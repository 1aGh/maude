// client/v2/present/present-zoom-store.js — S3.2b: the presented canvas's zoom, as the shell last heard it.
//
// The canvas posts `viewport-zoom {zoom}` while Present the canvas runs (present/present-zoom.ts); the lane
// (use-canvas-mode-lane.js) writes it here and the pill reads it. Leaving Present clears it, so the next
// Present does not flash the last one's number.

import { useSyncExternalStore } from 'react';

let zoom = null;
const subs = new Set();

export const presentZoomStore = {
  get: () => zoom,
  /** @param z a finite zoom > 0, or null (cleared) */
  set(z) {
    const next = typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : null;
    if (next === zoom) return;
    zoom = next;
    for (const fn of subs) fn();
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

export function usePresentZoomValue() {
  return useSyncExternalStore(presentZoomStore.subscribe, presentZoomStore.get, presentZoomStore.get);
}
