// client/v2/shell/panel-availability.js — V2-4.9: which dock panels a shell has at all.
//
// PURE. The hook (use-palette-and-panels.jsx) and the shell parity table (shell-parity.js) both call
// this, so a panel cannot be hidden in one and offered in the other.
//
//   assistant  the desktop app only (it runs Claude Code on this Mac, DDR-123) and never for a
//              read-only session — the agent edits (Cloud Phase 25 C2)
//   sync       never — the dock's Sync panel is retired (S11.12b): Sync details lives in Menu › Diagnostics ›
//              Sync. The id stays in DOCK_PANELS so a remembered panel side still parses.
//   layers     its own panel only in "separate" mode; otherwise it lives in the Inspector
//   the rest   every shell — Inspector and Layers included: read-only means cannot CHANGE, not cannot
//              SEE (Cloud Phase 27 C1)

/**
 * @param id a dock panel id (shell/dock.jsx DOCK_PANELS)
 * @param o { viewerMode, native, layersMode }
 */
export function panelAvailable(
  id,
  { viewerMode = false, native = false, layersMode = 'separate' } = {}
) {
  if (viewerMode && id === 'assistant') return false;
  if (id === 'sync') return false;
  if (id === 'assistant') return !!native;
  if (id === 'layers') return layersMode === 'separate';
  return true;
}
