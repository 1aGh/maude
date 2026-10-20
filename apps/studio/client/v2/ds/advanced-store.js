// client/v2/ds/advanced-store.js — S10.19: one place the open system's Advanced state lives between its host
// (advanced-host.jsx, mounted once in the shell) and the inspector's empty place (advanced.jsx).
//
// `value` is what the host last read for the open Design system canvas —
//   { ds, label, canvases, modes, files, check, busy, note, native }
// or null when no system canvas is open. `actions` are what the panel asks for:
//   { check(), reveal(), handoff(), history(), askAi(), show(css) }

import { useSyncExternalStore } from 'react';

let snapshot = { value: null, actions: null };
const subs = new Set();
const emit = () => {
  for (const fn of subs) fn();
};

export const getAdvanced = () => snapshot.value;

/** Replace the value, or update it from the old one (`setAdvanced((v) => …)`). */
export function setAdvanced(next) {
  const value = typeof next === 'function' ? next(snapshot.value) : next;
  if (value === snapshot.value) return;
  snapshot = { ...snapshot, value };
  emit();
}

export function setAdvancedActions(actions) {
  if (actions === snapshot.actions) return;
  snapshot = { ...snapshot, actions };
  emit();
}

const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
const read = () => snapshot;

/** `{ value, actions }` for a component; it redraws when either changes. */
export const useDsAdvancedStore = () => useSyncExternalStore(subscribe, read, read);

/** Test seam. */
export function resetAdvanced() {
  snapshot = { value: null, actions: null };
  emit();
}
