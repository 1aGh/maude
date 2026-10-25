// apps/studio/toolbars/shell-panels.ts — which of the shell's tool panels is open (V2-8.5 c7, `shell-panels` dgn).
//
// The Stickers gallery and the Assets panel are the SHELL's (they need routes the canvas may not call), so the dock's
// panel-only slots (Stickers · E, Image · I) cannot know on their own that the panel they opened is still up. The
// shell says so — `{dgn:'shell-panels', v:1, open}` — and the slots press while it is theirs: board 15 an-stk-gallery
// draws E lit under the gallery, board 04 md-edit-image the Image slot lit beside the Assets panel.
//
// A tiny external store: the canvas-shell handler writes it, the palette reads it with useSyncExternalStore.

import type { SlotPanel } from '../bridge/canvas-modes.ts';

export type ShellPanelOpen = 'stickers' | 'assets' | null;

let current: ShellPanelOpen = null;
const subs = new Set<() => void>();

export function getShellPanelOpen(): ShellPanelOpen {
  return current;
}

export function setShellPanelOpen(next: ShellPanelOpen): void {
  if (next === current) return;
  current = next;
  for (const f of [...subs]) f();
}

export function subscribeShellPanel(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Is `panel` (a slot's panel) the one the shell has open? Only Stickers and Assets are reported. */
export function isShellPanelOpen(panel: SlotPanel | undefined, open: ShellPanelOpen): boolean {
  return !!panel && open !== null && panel === open;
}
