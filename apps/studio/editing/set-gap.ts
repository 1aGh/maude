// editing/set-gap.ts — the canvas half of `layout.set-gap` (S2.11c, ed-lay-auto: ⌥ "every gap").
//
// ⌥ held on a gap drag changes every gap of the same size in the frame. That is ONE edit-op over all
// the frames (edit-ops/set-gap.ts), so one write and one undo step, not one per frame. The value is
// the system's space token when the drag landed on a stop, else the number (⌘ any number).

import type { EditOpResult } from '../edit-ops/types.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement } from './object-actions.ts';
import type { LayoutOpsDeps } from './reorder-slot.tsx';
import { spaceTokenFor } from './token-ruler.tsx';

export const SET_GAP_LABEL = 'Change every gap';
export const NO_FRAMES_LINE = 'The canvas could not tell which frames to change; try again.';

/** The frames inside `root` that are auto layouts with a gap of `px` (±½ px), as the browser lays them out. */
export function framesWithGap(root: HTMLElement, px: number, win: Window = window): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-cd-id]')).filter((node) => {
    const cs = win.getComputedStyle(node);
    if (cs.display !== 'flex' && cs.display !== 'inline-flex') return false;
    const gap = Number.parseFloat(cs.getPropertyValue('gap')) || 0;
    return Math.abs(gap - px) < 0.5;
  });
}

/**
 * One `layout.set-gap` over `frames` with the gap `px`. Resolves to the result, or null when nothing
 * was asked (no frame the canvas can name). A refusal is the toast's line and changes nothing.
 */
export async function runSetGap(
  frames: readonly HTMLElement[],
  px: number,
  deps: LayoutOpsDeps = {},
  doc: Document = document
): Promise<EditOpResult | null> {
  const targets = frames.map(refOfElement).filter((r): r is NonNullable<typeof r> => !!r);
  if (!targets.length) {
    deps.toast?.(NO_FRAMES_LINE, 'error');
    return null;
  }
  const token = spaceTokenFor(px, doc);
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  const result = await run({
    op: 'layout.set-gap',
    targets,
    params: { gap: token ? { token } : { px } },
  });
  if (!result.ok) deps.toast?.(result.message || 'That did not go through.', 'error');
  else if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, SET_GAP_LABEL);
    if (rec) deps.record?.(rec);
  }
  return result;
}
