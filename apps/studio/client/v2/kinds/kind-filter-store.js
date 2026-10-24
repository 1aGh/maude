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
// V2-8.5 C4 (08 ak-mixed-filter): the filter is ONE value, but only a pick made in Layers DIMS the open canvas — the
// Canvases chips narrow the list and leave the canvas as it is. `source` = where the value last came from.
let source = 'layers';
const listeners = new Set();

/** The kind being filtered to — 'all' when no filter is on. */
export const getKindFilter = () => kind;

/** The kind the open canvas dims to: the Layers pick's, never the Canvases chip's. */
export const getDimKind = () => (source === 'layers' ? kind : 'all');

/** Set the filter. Anything that is not a kind means "all". `from` = the panel that asked ('layers' | 'canvases'). */
export function setKindFilter(next, from = 'layers') {
  const k = isFilterKind(next) ? next : 'all';
  if (k === kind) return kind;
  kind = k;
  source = from === 'canvases' ? 'canvases' : 'layers';
  for (const l of [...listeners]) l();
  return kind;
}

/** A click on a chip: the chip already on goes back to All (the es-filter chip carries a ×), another one moves. */
export const pickKind = (next, from = 'layers') => setKindFilter(next === kind ? 'all' : next, from);

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

// ── S7.24b: ⌘K "Filter layers by kind" → the cursor goes to the Layers chips ─────────────────────────────────
// The chips may not be mounted when the request comes (the Layers tab is not showing yet), so the request is
// remembered until they mount and take it — the same shape as the select-by-selector request.

export const FOCUS_LAYERS_KIND_EVENT = 'maude:focus-layers-kind';
let pendingFocus = false;

export function requestFocusLayersKind(target = globalThis.window) {
  pendingFocus = true;
  target?.dispatchEvent?.(new CustomEvent(FOCUS_LAYERS_KIND_EVENT));
}

/** The chips took the request. @returns whether one was waiting. */
export function takeFocusLayersKindRequest() {
  const was = pendingFocus;
  pendingFocus = false;
  return was;
}
