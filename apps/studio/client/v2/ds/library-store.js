// client/v2/ds/library-store.js — S10.18c: one place the open linked system's card lives between its host
// (library-host.jsx, mounted once in the shell) and the inspector's empty place (library-card.jsx, drawn from
// Design system › Advanced's panel).
//
// `value` is `{ model, busy, note, banner }` for the open Design system canvas when that system is a linked team
// library, else null. `actions` are what the card asks for: `{ update(), unlink(), open() }`.

import { useSyncExternalStore } from 'react';

let snapshot = { value: null, actions: null };
const subs = new Set();
const emit = () => {
  for (const fn of subs) fn();
};

export const getLibrary = () => snapshot.value;

/** Replace the value, or update it from the old one (`setLibrary((v) => …)`). */
export function setLibrary(next) {
  const value = typeof next === 'function' ? next(snapshot.value) : next;
  if (value === snapshot.value) return;
  snapshot = { ...snapshot, value };
  emit();
}

export function setLibraryActions(actions) {
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
export const useDsLibraryStore = () => useSyncExternalStore(subscribe, read, read);

/** Test seam. */
export function resetLibrary() {
  snapshot = { value: null, actions: null };
  emit();
}
