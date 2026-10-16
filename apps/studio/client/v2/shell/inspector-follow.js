// client/v2/shell/inspector-follow.js — V2-4.4b: "the Inspector appears when something is selected and goes
// away on deselect" (CONTRACT §1 View › Advanced › "Open inspector on select", on by default).
//
// Two pure decisions, so the rule is pinned without a browser; use-shell-core.jsx owns the state and calls them.
//   · open on select — only a genuine, identifiable selection, never for a viewer (inspector chrome is edit
//     chrome, Cloud Phase 25 C2), never over a main panel that is already open (Comments, Changes, Sync, or the
//     Inspector itself: don't steal), and only with the pref on. The AI chat is its own island and does not count.
//   · close on deselect — only an Inspector the SELECTION opened. One opened on purpose (⇧⌘I, View ▸ Inspector)
//     stays until you close it; closing it by hand ends the claim.

/** @param {{pref: boolean, viewer: boolean, hasId: boolean, anyMainOpen: boolean}} s */
export function shouldOpenOnSelect({ pref, viewer, hasId, anyMainOpen }) {
  return !!pref && !viewer && !!hasId && !anyMainOpen;
}

/** @param {{pref: boolean, autoOpened: boolean, hasSelection: boolean}} s */
export function shouldCloseOnDeselect({ pref, autoOpened, hasSelection }) {
  return !!pref && !!autoOpened && !hasSelection;
}
