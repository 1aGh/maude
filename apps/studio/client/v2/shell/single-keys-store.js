// client/v2/shell/single-keys-store.js — V2-4 gate (WCAG 2.1.4 "Character Key Shortcuts", a11y B8): the
// per-Mac "Single-key shortcuts" switch, Settings › General › Keyboard.
//
// PURE (no DOM, no React, no fetch), like fold-store.js: persistence is injected. Home: prefs.json
// `singleKeyShortcuts` (absent = on — the default every person starts with). Off, a chord of one
// character key (V, /, ?, ⇧0 …; actions/keys.ts › isCharacterChord) is resolved by nobody: the shell
// passes `singleKeys: false` in its KeyCtx, the canvas gets it over the bridge (`key-prefs`).

/** The prefs.json field. */
export const SINGLE_KEYS_PREF = 'singleKeyShortcuts';

/** @param {{ persist?: (patch: Record<string, boolean>) => void }} [opts] */
export function createSingleKeysStore({ persist = () => {} } = {}) {
  let on = true;
  /** Changed in this page: a late disk read must not overwrite the person's click. */
  let touched = false;
  const subs = new Set();
  const notify = () => {
    for (const fn of subs) fn();
  };
  return {
    /** Do single-character shortcuts fire? (A stable boolean — fit for `useSyncExternalStore`.) */
    get: () => on,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(next) {
      const v = !!next;
      touched = true;
      if (v === on) return false;
      on = v;
      try {
        persist({ [SINGLE_KEYS_PREF]: v });
      } catch {
        /* no prefs file (a browser tab on a viewer): the choice lives for the page */
      }
      notify();
      return true;
    },
    /** Adopt the disk value (GET /_api/ui-prefs) unless the person already chose in this page. */
    hydrate(prefs) {
      const v = prefs?.[SINGLE_KEYS_PREF];
      if (touched || typeof v !== 'boolean' || v === on) return;
      on = v;
      notify();
    },
  };
}
