// client/v2/annotations/recent-stickers.js — the per-person "Recent" stickers list (≤ 12).
//
// S4.3 kept it in one localStorage key. S4.13 (lead follow-up, Q8) moves it to the per-person
// `annotationPrefs` store S4.8 built (shell-owned, decision v2-S4.8-shell-owns-prefs): prefs.json on a Mac,
// with the store's own localStorage mirror in a cloud tab. The list is `recentStickers` there: `[{pack, id}]`,
// newest first. The old key is migrated ONCE (merged behind whatever the store already has, then removed).
// Every storage access is guarded — private windows and blocked site data throw.

import { annotationPrefsStore } from '../shell/use-annotation-prefs.js';
import { pushRecent, RECENT_MAX } from './sticker-search.js';

/** The S4.3 localStorage key, read once to migrate and then removed. */
export const RECENT_KEY = 'maude.annotations.recent-stickers';

const defaultStorage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Fold the S4.3 key into the store (once) and drop it. Returns true when there was something to move. */
export function migrateLegacyRecents(store = annotationPrefsStore, storage = defaultStorage()) {
  let raw = null;
  try {
    raw = storage?.getItem(RECENT_KEY) ?? null;
  } catch {
    return false;
  }
  if (raw === null) return false;
  try {
    const own = Array.isArray(store.get().recentStickers) ? store.get().recentStickers : [];
    const legacy = JSON.parse(raw);
    // the store's own list stays on top; the old key's refs follow, de-duplicated
    const merged = [...own];
    for (const ref of Array.isArray(legacy) ? legacy : []) {
      if (!merged.some((r) => r.pack === ref?.pack && r.id === ref?.id)) merged.push(ref);
    }
    store.set({ recentStickers: merged.slice(0, RECENT_MAX) });
  } catch {
    /* an unreadable legacy value is just dropped */
  }
  try {
    storage?.removeItem(RECENT_KEY);
  } catch {
    /* blocked storage: it stays, and is read again next time */
  }
  return true;
}

/** The stored refs `[{pack,id}]`; anything unreadable is an empty list. */
export function loadRecent(store = annotationPrefsStore, storage = defaultStorage()) {
  migrateLegacyRecents(store, storage);
  const list = store.get().recentStickers;
  return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
}

/** Put `ref` first and persist; returns the new list (also when persistence is unavailable). */
export function rememberSticker(ref, store = annotationPrefsStore, storage = defaultStorage()) {
  const next = pushRecent(loadRecent(store, storage), ref);
  store.set({ recentStickers: next });
  return next;
}
