// apps/studio/toolbars/shell-panels.ts — which of the shell's tool panels is open (V2-8.5 c7, `shell-panels` dgn).
//
// The Stickers gallery and the Assets panel are the SHELL's (they need routes the canvas may not call), so the dock's
// panel-only slots (Stickers · E, Image · I, Components · ⇧I) cannot know on their own that the panel they opened is still up. The
// shell says so — `{dgn:'shell-panels', v:1, open}` — and the slots press while it is theirs: board 15 an-stk-gallery
// draws E lit under the gallery, board 04 md-edit-image the Image slot lit beside the Assets panel.
//
// A tiny external store: the canvas-shell handler writes it, the palette reads it with useSyncExternalStore.

import type { SlotPanel } from '../bridge/canvas-modes.ts';

export type ShellPanelOpen = 'stickers' | 'assets' | 'components' | null;

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

// P8 c10 (15 an-stk-drop): a gallery sticker is selected in the annotation layer. After a drop the board keeps
// Stickers (E) pressed with the placed sticker selected, so the slot follows the selection, not only the panel.
let stickerSelected = false;

export function getStickerSelected(): boolean {
  return stickerSelected;
}

export function setStickerSelected(next: boolean): void {
  if (next === stickerSelected) return;
  stickerSelected = next;
  for (const f of [...subs]) f();
}

/** Is `panel` (a slot's panel) the one the shell has open? Stickers, Assets and the Component picker are reported. */
export function isShellPanelOpen(
  panel: SlotPanel | undefined,
  open: ShellPanelOpen,
  stickerSel = false
): boolean {
  return !!panel && ((open !== null && panel === open) || (panel === 'stickers' && stickerSel));
}
