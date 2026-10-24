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

/** P8 C3 (03 ai-long-pinned): the AI chat pinned to the side is a 420 px column (floating it is 340, 420 when long). */
export const AI_PINNED_W = 420;

/**
 * The right dock slot's width. The Inspector is a 264 card (14 `.k-insp`), Version history the 372 island of 11
 * `.pn-vh`; the AI chat docked here (pinned layout) is the 420 column of 03 `ai-long-pinned` unless the person
 * dragged it wider; anything else is the user's panel width.
 */
export function rightPanelWidth({ active, base, aiPinned = false }) {
  const own = rightMainWidth({ active, base });
  // P8 c5 (03 ai-long-pinned): the pinned chat shares the slot with whatever panel is open (the Inspector opens by
  // itself on a selection) — the slot takes the wider of the two, else the 420 column overran the window edge.
  return aiPinned ? Math.max(own, AI_PINNED_W) : own;
}

/** The open panel's OWN width (the slot is wider when the pinned chat shares it). */
export function rightMainWidth({ active, base }) {
  if (active === 'inspector') return 264;
  if (active === 'changes') return 372;
  return base;
}
/** The one-line hint shown when panels are hidden (CONTRACT §4 voice). */
export const PANELS_HIDDEN_HINT = 'Panels hidden. Press ⌘\\ to bring them back.';
export const PANELS_HINT_ID = 'panels-hidden';

//   folded  V2-4.3b — Preview folds the Canvases / AI chat panels to their corner icons (V2-1.2 §5.4,
//           "Shell: Canvases / AI chat panels"). The mode's fold, not the person's: leaving Preview
//           unfolds, and the ⌘\ choice underneath is kept. `hidden` in the snapshot is what the layout
//           shows (⌘\ OR the fold), so every consumer folds through the one mechanism; `userHidden` is
//           the ⌘\ half alone.

/**
 * P8 C5 (04 R4: md-preview-follow, md-comment, md-draw, md-inspect, md-edge-ai) — a panel opening while the panels
 * are not showing. Under ⌘\ (the person's hide) any opening brings every panel back, as before. Under Preview's
 * fold alone it does NOT: the fold is the mode's, and only leaving Preview or a corner icon (its own `onShow`)
 * ends it — a link follow, a canvas open, the Comment tool, a ⌘-click or an AI prompt left the Canvases panel
 * back over the design. Preview folds the Canvases and AI chat panels only, so a RIGHT panel opened during the
 * fold (Inspect on ⌘-click, Comments) shows by itself (`rightInFold`), without the others.
 *
 * `prev` / `next`: `{ l, r, ai }` = left panel id, right panel id, AI chat open.
 */
export function panelOpenDecision({ prev, next, userHidden, folded, rightInFold = false }) {
  const opened =
    (!!next.l && next.l !== prev.l) || (!!next.r && next.r !== prev.r) || (!!next.ai && !prev.ai);
  if (userHidden) return { show: opened, rightInFold: false };
  if (!folded) return { show: false, rightInFold: false };
  if (!next.r) return { show: false, rightInFold: false };
  return { show: false, rightInFold: rightInFold || next.r !== prev.r };
}

export function createPanelLayout({ persist = () => {}, say = () => {}, unsay = () => {} } = {}) {
  let user = { hidden: false, pinned: false, folded: false };
  const view = () =>
    Object.freeze({
      hidden: user.hidden || user.folded,
      pinned: user.pinned,
      folded: user.folded,
      userHidden: user.hidden,
    });
  let snap = view();
  const subs = new Set();
  const set = (patch) => {
    const next = { ...user, ...patch };
    if (next.hidden === user.hidden && next.pinned === user.pinned && next.folded === user.folded)
      return;
    user = next;
    snap = view();
    for (const fn of subs) fn();
  };
  const store = {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** ⌘\ — hides every panel, or brings them back (in Preview too: showing them unfolds). */
    toggleHidden() {
      if (snap.hidden) store.show();
      else store.hide();
    },
    hide() {
      if (user.hidden) return;
      set({ hidden: true });
      say({ id: PANELS_HINT_ID, title: PANELS_HIDDEN_HINT, kind: 'info' });
    },
    show() {
      if (!snap.hidden) return;
      const wasUser = user.hidden;
      set({ hidden: false, folded: false });
      if (wasUser) unsay(PANELS_HINT_ID);
    },
    /** The mode's fold (Preview). No hint: the mode switch says where you are. */
    setFolded(on) {
      set({ folded: !!on });
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
