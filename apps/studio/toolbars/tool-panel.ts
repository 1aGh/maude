// apps/studio/toolbars/tool-panel.ts — a slot (or a key) asks the SHELL to open one of its tool panels
// (V2-1.2 §5.5, V2-4.5c): Stickers (E), Templates (S), the Component picker (⇧I), Assets (I).
//
// The panels are drawn by the shell — they need `/_api/stickers`, the AI templates and the DS component
// list, none of which is canvas-safe (DDR-088 untouched) — so the canvas only says WHICH panel and
// WHERE it was asked from. `anchor` is the pressed button's box in this iframe's viewport (whole CSS px);
// a key press has none (null) and the shell falls back to the last `toolbar-rect`.
//
// This replaces the legacy `open-sticker-picker`, which carried neither.

import type { SlotPanel } from '../bridge/canvas-modes.ts';
import { type ToolbarRect, wholeRect } from './toolbar-rect.ts';

export interface ToolPanelOpenPayload {
  dgn: 'tool-panel-open';
  panel: SlotPanel;
  anchor: ToolbarRect | null;
}

/** The message for `panel`, anchored to `el` (a button) when it has a box. */
export function toolPanelOpenMessage(
  panel: SlotPanel,
  el?: { getBoundingClientRect(): DOMRect | ReturnType<Element['getBoundingClientRect']> } | null
): ToolPanelOpenPayload {
  let anchor: ToolbarRect | null = null;
  if (el) {
    const r = wholeRect(el.getBoundingClientRect());
    anchor = r.w > 0 && r.h > 0 ? r : null;
  }
  return { dgn: 'tool-panel-open', panel, anchor };
}

/** Post it to the shell (a no-op outside an iframe; the shell gates it to the active canvas). */
export function openToolPanel(
  panel: SlotPanel,
  el?: Parameters<typeof toolPanelOpenMessage>[1]
): void {
  try {
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage(toolPanelOpenMessage(panel, el), '*');
  } catch {
    /* detached / cross-origin teardown */
  }
}
