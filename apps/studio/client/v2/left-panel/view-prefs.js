// client/v2/left-panel/view-prefs.js — S11.9: the two switches of the left panel's Advanced folds that
// only change what this person SEES (06 · ad-left): `canvases.show-file-names` (the second mono line under a
// canvas row) and `layers.show-tags` (the tag and id after a layer's name).
//
// A view preference is the person's own window, not the project's: it is remembered on this Mac in
// localStorage (the synchronous init source — no flash on mount, the same convention `persistUiPrefs`
// documents) and never written to the project. A tiny external store so the row that draws it, the switch
// that flips it and the ⌘K row that toggles it are one instance without threading state through the shell.
//
// Storage can throw (private window, blocked site data): every read and write is wrapped and the store keeps
// working in memory.

import { useSyncExternalStore } from 'react';

export const VIEW_PREF_KEYS = Object.freeze({
  fileNames: 'canvases.show-file-names',
  tags: 'layers.show-tags',
});

const STORAGE_PREFIX = 'maude.view.';
const mem = new Map();
const listeners = new Set();

function read(key) {
  if (mem.has(key)) return mem.get(key);
  let v = false;
  try {
    v = globalThis.localStorage?.getItem(STORAGE_PREFIX + key) === '1';
  } catch {
    v = false;
  }
  mem.set(key, v);
  return v;
}

/** Whether `key` is on (defaults to off). */
export function getViewPref(key) {
  return read(key);
}

/** Turn `key` on or off and tell everyone who draws it. */
export function setViewPref(key, on) {
  const v = !!on;
  if (read(key) === v) return;
  mem.set(key, v);
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + key, v ? '1' : '0');
  } catch {
    // memory only
  }
  for (const l of listeners) l();
}

export function toggleViewPref(key) {
  setViewPref(key, !read(key));
  return read(key);
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** `[on, setOn]` for one view preference. */
export function useViewPref(key) {
  const on = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false
  );
  return [on, (v) => setViewPref(key, typeof v === 'function' ? v(read(key)) : v)];
}

/** Tests only: forget what this page remembered (and the storage behind it). */
export function resetViewPrefsForTest() {
  mem.clear();
  try {
    for (const k of Object.values(VIEW_PREF_KEYS))
      globalThis.localStorage?.removeItem(STORAGE_PREFIX + k);
  } catch {
    // nothing stored
  }
  for (const l of listeners) l();
}
