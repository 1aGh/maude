// client/v2/annotations/recent-stickers.js — S4.3: the per-person "Recent" stickers list (≤ 12).
//
// Q8 puts per-person annotation memory in `ui-prefs.ts` (`~/.config/maude/prefs.json`) with
// localStorage as the fallback in a cloud tab; that prefs key and its `annotation-prefs` relay are
// S4.8's. Until S4.8 lands this module IS the fallback half — one localStorage key, every access
// guarded (private windows and blocked site data throw) — and S4.8 swaps `loadRecent` / `rememberSticker`
// for the prefs-backed pair without touching the gallery.

import { pushRecent, RECENT_MAX } from './sticker-search.js';

export const RECENT_KEY = 'maude.annotations.recent-stickers';

const defaultStorage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The stored refs `[{pack,id}]`; anything unreadable is an empty list. */
export function loadRecent(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(RECENT_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Put `ref` first and persist; returns the new list (also when storage is unavailable). */
export function rememberSticker(ref, storage = defaultStorage()) {
  const next = pushRecent(loadRecent(storage), ref);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* blocked storage: Recent lasts for this session only */
  }
  return next;
}
