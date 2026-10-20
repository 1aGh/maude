// client/v2/kinds/kind-filter-store.js — S7.24: the kind filter's one value, shared by the Canvases panel (this
// slice) and the Layers tab (the S2-owner header slot). "The Print filter came along from Combine-kampan"
// (05 · es-filter): ONE filter, not one per panel, so a person who filters Layers to Print and then looks at
// another canvas finds the filter where they left it.
//
// A tiny external store, no React in the core: the chips that show it, the panel that applies it and the ⌘K row
// that moves focus to it are one instance. It is the person's own view — in memory for the session, never
// written to the project, never synced (a peer's filter is not mine).

import { useSyncExternalStore } from 'react';
import { isFilterKind } from './kind-filter-model.js';

let kind = 'all';
const listeners = new Set();

/** The kind being filtered to — 'all' when no filter is on. */
export const getKindFilter = () => kind;

/** Set the filter. Anything that is not a kind means "all". @returns the filter now on. */
export function setKindFilter(next) {
  const k = isFilterKind(next) ? next : 'all';
  if (k === kind) return kind;
  kind = k;
  for (const l of [...listeners]) l();
  return kind;
}

/** A click on a chip: the chip already on goes back to All (the es-filter chip carries a ×), another one moves. */
export const pickKind = (next) => setKindFilter(next === kind ? 'all' : next);

export const clearKindFilter = () => setKindFilter('all');

export function subscribeKindFilter(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `[kind, setKind, pick]` for the chips and the panel. */
export function useKindFilter() {
  const k = useSyncExternalStore(subscribeKindFilter, getKindFilter, () => 'all');
  return [k, setKindFilter, pickKind];
}
