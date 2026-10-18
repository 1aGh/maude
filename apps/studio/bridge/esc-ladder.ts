// bridge/esc-ladder.ts — S3.12: what ONE esc press does on a canvas, as data (V2-1.2 §5.4 transitions,
// 04 md-esc: "esc always steps back one place … never two at once").
//
// PURE. The canvas's key handler used to run every rung on a single press (cancel the stroke, reset the
// tool, close the menu, clear the selection) and THEN ask the shell to step the mode back when the tool was
// already at rest — so Inspect's "clears the selection, second esc: back to Edit" took both at once. The
// ladder runs the FIRST rung that applies and stops:
//
//   owner      something in the document owns esc right now — a context menu, a thread popover, a picker —
//              and closes itself. The router steps aside (no preventDefault), so nothing else moves.
//   stroke     a half-drawn mark: set down where it is.
//   selection  Edit: one level up, then deselect (`object.step-out`). Preview/Viewing: the inspect/annotation
//              selection is cleared.
//   tool       an armed tool → the mode's resting tool (Select / Hand). A sticky lock is cleared with it.
//   then the terminal: `back` (Preview → baseMode, Present → returnTo; the shell is asked) or `stay`.
//
// The order differs by mode exactly as the contract's table does: Edit deselects BEFORE it leaves a tool;
// Preview leaves the tool, THEN clears the inspect selection, THEN goes back.

import { type CanvasModeV2, escStep } from './canvas-modes.ts';

export type EscRung = 'owner' | 'stroke' | 'selection' | 'tool';
export type EscOutcome = EscRung | 'back' | 'stay';

/** The rungs after `owner`, in the order a press tries them. */
export const ESC_LADDER: Readonly<Record<CanvasModeV2, readonly Exclude<EscRung, 'owner'>[]>> =
  Object.freeze({
    edit: ['stroke', 'selection', 'tool'],
    preview: ['stroke', 'tool', 'selection'],
    viewing: ['stroke', 'tool', 'selection'],
    // Present has no tools and no selection: a press leaves it (the shell returns to `returnTo`).
    present: [],
  });

/** What the terminal is when no rung applies: only Preview and Present have somewhere to go back to. */
export const ESC_TERMINAL: Readonly<Record<CanvasModeV2, 'back' | 'stay'>> = Object.freeze({
  edit: 'stay',
  preview: 'back',
  viewing: 'stay',
  present: 'back',
});

/** The attribute an element carries while it OWNS esc (it closes itself on the press). `data-esc-owner=""`
 *  owns it always (a context menu: its own document listener); `="focus"` only while focus is inside it (a
 *  thread popover closes on esc only then — with focus elsewhere the press is the canvas's). */
export const ESC_OWNER_ATTR = 'data-esc-owner';

/** Is something in `doc` owning esc right now? */
export function escOwnerOpen(
  doc: Pick<Document, 'querySelectorAll' | 'activeElement'> | null | undefined
): boolean {
  const owners = doc?.querySelectorAll?.(`[${ESC_OWNER_ATTR}]`);
  if (!owners) return false;
  for (const el of Array.from(owners)) {
    if (el.getAttribute(ESC_OWNER_ATTR) !== 'focus') return true;
    const active = doc?.activeElement ?? null;
    if (active && (el === active || el.contains(active))) return true;
  }
  return false;
}

/**
 * Each handler runs the rung IF it applies and says so. `tool` is only asked when the armed tool is not the
 * mode's resting tool (`escStep`), so a handler never has to know the table.
 */
export interface EscHandlers {
  stroke?: () => boolean;
  selection?: () => boolean;
  tool?: () => boolean;
}

/**
 * One esc press. `owner` first (nothing runs), then the mode's rungs in order — the first handler that
 * reports it acted ends the press. Nothing applied → the mode's terminal (`back` asks the shell).
 */
export function runEscRung(
  mode: CanvasModeV2,
  tool: string,
  handlers: EscHandlers,
  ownerOpen = false
): EscOutcome {
  if (ownerOpen) return 'owner';
  for (const rung of ESC_LADDER[mode]) {
    if (rung === 'tool' && escStep(mode, tool) !== 'rest') continue;
    if (handlers[rung]?.()) return rung;
  }
  return ESC_TERMINAL[mode];
}
