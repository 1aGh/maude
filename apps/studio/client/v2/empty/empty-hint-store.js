// client/v2/empty/empty-hint-store.js — S11.2: the one artboard the canvas says is empty right now, for the Layers
// tab ("No layers on Tablet yet."). The layers tree names an artboard by id only and cannot tell "nothing on it"
// from "nothing stamped"; the canvas's `artboard-empty` can, and carries the label. The host writes, the
// inspector panel reads.

import { useSyncExternalStore } from 'react';

let current = null; // { artboardId, label } | null
const subs = new Set();

export const emptyHintStore = {
  /** @param {{ artboardId: string, label: string } | null} next */
  set(next) {
    const same =
      (next === null && current === null) ||
      (next && current && next.artboardId === current.artboardId && next.label === current.label);
    if (same) return;
    current = next ? { artboardId: next.artboardId, label: next.label } : null;
    for (const fn of subs) fn();
  },
  get: () => current,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

/** The selected empty artboard (`{ artboardId, label }`) or null; re-renders when it changes. */
export function useEmptyArtboard() {
  return useSyncExternalStore(emptyHintStore.subscribe, emptyHintStore.get, emptyHintStore.get);
}
