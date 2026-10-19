// client/v2/shell/annotation-prefs-store.js — S4.8 (Q8): what the annotation tools remember per person.
//
// The sticky colour, the Marker's ink / thickness / tip and the Highlighter's hue / nib — and (S4.13) the
// Recent stickers, which only the shell reads (tool-prefs.ts `recentStickers`). PURE (no DOM,
// no React, no fetch), like single-keys-store.js: persistence is injected. Home: prefs.json
// `annotationPrefs` (`~/.config/maude/prefs.json`, per Mac); a cloud tab has no prefs file, so the same
// values are mirrored to `localStorage` (guarded — private windows and blocked site data throw) and
// read back from it when the disk has none.
//
// The canvas origin has no prefs route (DDR-054), so the canvas never reads or writes either place:
// it sends `annotation-prefs-set` and hears `annotation-prefs` (use-annotation-prefs.js is the lane).
// A field that is not a member of its palette is dropped here, whoever sent it (tool-prefs.ts).

import { sanitizeShellPrefs } from '../../../annotations/ui/tool-prefs.ts';

/** The prefs.json field. */
export const ANNOTATION_PREFS_KEY = 'annotationPrefs';
/** The localStorage fallback. */
export const ANNOTATION_PREFS_LOCAL = 'maude.annotations.tool-prefs';

const defaultStorage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Equal as values: the Recent list is an array, so `!==` would call every write a change. */
const same = (a, b) =>
  a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));

function readLocal(storage) {
  try {
    const raw = storage?.getItem(ANNOTATION_PREFS_LOCAL);
    return raw ? sanitizeShellPrefs(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ persist?: (patch: Record<string, unknown>) => void, storage?: Storage | null }} [opts]
 */
export function createAnnotationPrefsStore({
  persist = () => {},
  storage = defaultStorage(),
} = {}) {
  /** @type {Record<string, unknown>} */
  let prefs = readLocal(storage);
  /** Fields changed in this page: a late disk read must not overwrite the person's click. */
  const touched = new Set();
  const subs = new Set();
  const notify = () => {
    for (const fn of subs) fn(prefs);
  };
  return {
    /** The remembered fields (a stable object between changes). */
    get: () => prefs,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /**
     * A change a canvas made (or the person made in the shell): validated, merged, written to prefs.json
     * and the local mirror. Returns the clean fields that actually changed, `{}` when none did.
     */
    set(patch) {
      const clean = sanitizeShellPrefs(patch);
      const changed = {};
      for (const k of Object.keys(clean)) {
        touched.add(k);
        if (!same(prefs[k], clean[k])) changed[k] = clean[k];
      }
      if (Object.keys(changed).length === 0) return changed;
      prefs = { ...prefs, ...changed };
      try {
        persist({ [ANNOTATION_PREFS_KEY]: changed });
      } catch {
        /* no prefs file (a browser tab on a viewer): the choice lives in the mirror and the page */
      }
      try {
        storage?.setItem(ANNOTATION_PREFS_LOCAL, JSON.stringify(prefs));
      } catch {
        /* blocked storage: the choice lasts for this page */
      }
      notify();
      return changed;
    },
    /** Adopt the disk value (GET /_api/ui-prefs) for every field not already changed in this page. */
    hydrate(diskPrefs) {
      const disk = sanitizeShellPrefs(diskPrefs?.[ANNOTATION_PREFS_KEY]);
      let next = null;
      for (const k of Object.keys(disk)) {
        if (touched.has(k) || same(prefs[k], disk[k])) continue;
        next ??= { ...prefs };
        next[k] = disk[k];
      }
      if (!next) return false;
      prefs = next;
      notify();
      return true;
    },
  };
}
