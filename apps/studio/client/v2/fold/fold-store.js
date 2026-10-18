// client/v2/fold/fold-store.js — V2-4.10: which "› Advanced" folds are open, remembered per panel per Mac.
//
// PURE (no DOM, no React, no fetch): persistence is injected, so a test re-creates the store over a
// fake prefs object and a browser tab without a prefs file still works — the state then simply lives
// for the page (the in-memory fallback).
//
// The home is prefs.json `fold` (V2-2.7: `fold: Record<id, boolean>`, merged key by key by the server's
// `writeUiPrefs`, so one panel's write never wipes another's). It is per Mac, not per project: the
// same ids are read in every project window on this Mac. An id is the panel's key — `left.canvases`,
// `settings`, `diagnostics`, `help`, `inspector` (the Inspector's Advanced arrives with S2; its key is
// reserved so "Open all" already covers it). Server-side an id is `[A-Za-z0-9._:/-]{1,128}`.

/** The panels that carry an Advanced fold. "Open / Close all" and "Reset" act on these plus any other id seen. */
export const FOLD_PANELS = Object.freeze([
  'left.canvases',
  'settings',
  'diagnostics',
  'help',
  'inspector',
  'ai.chat',
  'history', // S1.14 — Version history › Advanced (the git body)
]);

/**
 * A fold with no remembered choice. Everything starts folded (the one quiet row) except the "?" sheet's:
 * its Advanced fold holds the keys that moved, which the sheet has always shown at first look.
 */
export const FOLD_DEFAULTS = Object.freeze({ help: true });

const VALID_ID = /^[A-Za-z0-9._:/-]{1,128}$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * @param {{ persist?: (patch: { fold: Record<string, boolean> }) => void }} [opts]
 *   `persist` is handed ONLY the keys that changed (the server merges by key).
 */
export function createFoldStore({ persist = () => {} } = {}) {
  /** id → explicit open/closed. An id not in here is at its default. */
  const explicit = new Map();
  /** ids changed in this page: a late-arriving disk read must not overwrite them. */
  const touched = new Set();
  const subs = new Set();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const defaultOf = (id) => FOLD_DEFAULTS[id] === true;
  const shown = (id) => (explicit.has(id) ? explicit.get(id) : defaultOf(id));
  const known = () => [...new Set([...FOLD_PANELS, ...explicit.keys()])];

  /** Apply `{id: open}` in one write; returns true when anything was written. */
  const write = (changes) => {
    const patch = {};
    for (const [id, open] of Object.entries(changes)) {
      if (!VALID_ID.test(id) || UNSAFE.has(id)) continue;
      touched.add(id);
      const was = shown(id);
      const remembered = explicit.has(id);
      explicit.set(id, open);
      // A choice equal to what is shown is still written once (it pins the answer), never twice.
      if (was !== open || !remembered) patch[id] = open;
    }
    if (Object.keys(patch).length === 0) return false;
    try {
      persist({ fold: patch });
    } catch {
      /* no prefs file (a browser tab on a viewer): the choice lives for the page */
    }
    notify();
    return true;
  };

  const store = {
    /** Is the fold of `id` open? (A stable boolean — fit for `useSyncExternalStore`.) */
    get(id) {
      return shown(id);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(id, open) {
      return write({ [id]: !!open });
    },
    toggle(id) {
      return write({ [id]: !shown(id) });
    },
    /** ⌘K "Open all Advanced sections": every panel's fold, once — each then remembers its own. */
    openAll() {
      return write(Object.fromEntries(known().map((id) => [id, true])));
    },
    /** ⌘K "Close all Advanced sections". */
    closeAll() {
      return write(Object.fromEntries(known().map((id) => [id, false])));
    },
    /** Settings › Advanced › Reset: every fold back to how a fresh Mac shows it. */
    reset() {
      return write(Object.fromEntries(known().map((id) => [id, defaultOf(id)])));
    },
    /** Which folds are open right now. */
    openIds() {
      return known().filter(shown);
    },
    /**
     * Apply the on-disk prefs (GET /_api/ui-prefs) without writing them back. Only well-typed
     * entries count; an id changed in this page keeps the page's value.
     */
    hydrate(prefs) {
      const fold = prefs?.fold;
      if (!fold || typeof fold !== 'object' || Array.isArray(fold)) return;
      let changed = false;
      for (const id of Object.keys(fold)) {
        if (UNSAFE.has(id) || !VALID_ID.test(id) || typeof fold[id] !== 'boolean') continue;
        if (touched.has(id)) continue;
        if (explicit.get(id) !== fold[id]) {
          explicit.set(id, fold[id]);
          changed = true;
        }
      }
      if (changed) notify();
    },
  };
  return store;
}
