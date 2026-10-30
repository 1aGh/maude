// client/v2/ds/truth-store.js — S10.11: one place the outside-change / conflict state lives between its host
// (truth-host.jsx, mounted once in the shell) and the inspector's empty place (truth-card.jsx).
//
// `value` is what the host last read for the open Design system canvas — `{ ds, truth, board, headNames, contrast,
// busy, note }` — or null when there is nothing to say. `actions` are the four writes the cards ask for.

import { useSyncExternalStore } from 'react';

let snapshot = { value: null, actions: null };
const subs = new Set();
const emit = () => {
  for (const fn of subs) fn();
};

export const getTruth = () => snapshot.value;
export const getTruthActions = () => snapshot.actions;

/** Replace the value, or update it from the old one (`setTruth((t) => …)`). */
export function setTruth(next) {
  const value = typeof next === 'function' ? next(snapshot.value) : next;
  if (value === snapshot.value) return;
  snapshot = { ...snapshot, value };
  emit();
}

export function setTruthActions(actions) {
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
export const useDsTruth = () => useSyncExternalStore(subscribe, read, read);

/** Test seam. */
export function resetTruth() {
  snapshot = { value: null, actions: null };
  emit();
}
