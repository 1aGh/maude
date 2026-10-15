// client/v2/shell/panel-layout.js — V2-4.1: the shell's panel LAYOUT state, separate from which panel is
// open in which slot (that stays in use-shell-core, unchanged).
//
//   hidden  ⌘\ "Hide panels / Show panels" — every island steps aside, the corner icons stay as the way
//           back. Session-only: a window opens with its panels showing.
//   pinned  View › Advanced › "Pin panels to the side" — a per-Mac pref (prefs.json `pin.on`, the v2 home
//           the prefs migration already names). Off = panels float over the canvas (the default); on =
//           today's docked columns, the canvas shrinks and the occluded insets compute to 0 by themselves.
//
// A tiny external store (useSyncExternalStore-shaped) instead of React state threaded through
// use-shell-core's store: the ⌘\ key handler, the View menu and the layout block all reach the same
// instance without new plumbing. Pure — the singleton in use-panel-layout.js injects persistence and
// the notice.

/** The one-line hint shown when panels are hidden (CONTRACT §4 voice). */
export const PANELS_HIDDEN_HINT = 'Panels hidden. Press ⌘\\ to bring them back.';
export const PANELS_HINT_ID = 'panels-hidden';

export function createPanelLayout({ persist = () => {}, say = () => {}, unsay = () => {} } = {}) {
  let snap = Object.freeze({ hidden: false, pinned: false });
  const subs = new Set();
  const set = (patch) => {
    const next = { ...snap, ...patch };
    if (next.hidden === snap.hidden && next.pinned === snap.pinned) return;
    snap = Object.freeze(next);
    for (const fn of subs) fn();
  };
  const store = {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** ⌘\ — hides every panel, or brings them back. */
    toggleHidden() {
      if (snap.hidden) store.show();
      else store.hide();
    },
    hide() {
      if (snap.hidden) return;
      set({ hidden: true });
      say({ id: PANELS_HINT_ID, title: PANELS_HIDDEN_HINT, kind: 'info' });
    },
    show() {
      if (!snap.hidden) return;
      set({ hidden: false });
      unsay(PANELS_HINT_ID);
    },
    /** The View › Advanced toggle. Persists to prefs.json `pin.on`. */
    setPinned(on) {
      const v = !!on;
      if (v === snap.pinned) return;
      set({ pinned: v });
      persist({ pin: { on: v } });
    },
    togglePinned() {
      store.setPinned(!snap.pinned);
    },
    /** Apply the on-disk prefs (GET /_api/ui-prefs) without writing them back. */
    hydrate(prefs) {
      const on = prefs?.pin?.on;
      if (typeof on === 'boolean') set({ pinned: on });
    },
  };
  return store;
}
