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

// ── the hover-focus hold (r1 #11) ──────────────────────────────────────────────────────────────
// The canvas takes the keyboard when the pointer ENTERS it (canvas-lib "auto-focus on pointer enter"). The shell's tool
// panels (the F size picker, Stickers, Assets, the Component picker) are drawn OVER the canvas and close when the shell
// window blurs — their only way to hear a click in the iframe. So the pointer travelling from the toolbar up into the
// panel crossed the canvas, the canvas took focus, the shell blurred and the panel closed under the pointer ("closes as
// soon as I move the mouse into it"). Once the canvas asks for a panel it stops taking focus by hover until the next
// press inside the canvas — a press is still a click in the iframe and still closes the panel the way it always did.

let held = false;
let listening = false;

/** The canvas asked the shell for a panel: hover alone no longer pulls the keyboard into the canvas. */
export function holdHoverFocus(doc: Document | undefined = globalThis.document): void {
  held = true;
  if (listening || !doc) return;
  listening = true;
  doc.addEventListener(
    'pointerdown',
    () => {
      held = false;
    },
    true
  );
}

/** Is hover-focus on hold (a shell panel was asked for and no press in the canvas has happened since)? */
export function hoverFocusHeld(): boolean {
  return held;
}

/** Tests: forget the hold. */
export function resetHoverFocusHold(): void {
  held = false;
}

/** Post it to the shell (a no-op outside an iframe; the shell gates it to the active canvas). */
export function openToolPanel(
  panel: SlotPanel,
  el?: Parameters<typeof toolPanelOpenMessage>[1]
): void {
  try {
    if (typeof window === 'undefined' || window.parent === window) return;
    holdHoverFocus();
    window.parent.postMessage(toolPanelOpenMessage(panel, el), '*');
  } catch {
    /* detached / cross-origin teardown */
  }
}

/**
 * The panel arming `now` opens when the tool was `was` (S4.19, canvas 15 `an-templates`): Section (S) opens the
 * Templates panel above the toolbar, whichever way it was armed (key, button, tool-set). Only the CHANGE asks, so
 * a boot on Section, a re-arm of Section and every other tool are quiet.
 */
export function panelOnArm(was: string, now: string): SlotPanel | null {
  return now === 'section' && was !== 'section' ? 'templates' : null;
}
