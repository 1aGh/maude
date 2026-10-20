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

// S6.16b (01 cf-select-tweak, "the view makes room"): when the Inspector arrives WITH a selection, the Canvases
// panel folds to its corner icon; when the selection clears it comes back. The panel only — an inset change
// never moves the view (I1, bridge/canvas-mode-store.ts), so "the canvas slides left" is NOT built.
//
// A claim, like the Inspector's own: only a fold THIS rule made is undone by it. Not folded when there was
// nothing to fold (already shut — the person's choice), nor under "Pin panels to the side" (docked columns
// already give the canvas its own room). Opened by hand while the Inspector is up, or pinned meanwhile: the
// claim ends and the panel is left where the person put it.
export function createCanvasesFold() {
  let folded = false;
  return {
    /** The Inspector just arrived with a selection → `true` = fold Canvases now. */
    arrive({ canvasesOpen, pinned }) {
      if (folded || !canvasesOpen || pinned) return false;
      folded = true;
      return true;
    },
    /** The person opened Canvases themselves: the claim ends. */
    release() {
      folded = false;
    },
    /** The selection state changed → `true` = bring Canvases back now. */
    clear({ hasSelection, canvasesOpen, pinned }) {
      if (!folded || hasSelection) return false;
      folded = false;
      return !canvasesOpen && !pinned;
    },
    folded: () => folded,
  };
}
