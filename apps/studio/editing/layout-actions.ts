// editing/layout-actions.ts — the registry actions S2.11 runs in the canvas (ed-lay-*): Place freely,
// move earlier / later, and Convert children to absolute position.
//
//   object.place-freely      ⌘K · the Position row · dragging out of the frame — one edit-op
//   object.reorder-earlier   ← in an auto layout (↑ in a column) — one edit-op
//   object.reorder-later     → in an auto layout (↓ in a column) — one edit-op
//   layout.convert-to-absolute   ⌘K · Layout › Advanced — v1's subtree convert (confirm + one batch)
//
// Each is also what a Layers row asks for through `run-action` with `params.targets`.

import { resolveSelectionEl } from '../dom-selection.ts';
import type { ElementRef } from '../edit-ops/types.ts';
import type { Selection } from '../use-selection-set.tsx';
import { runArranged } from './arrange.ts';
import { refsOf } from './object-ops.ts';
import { placeFreely } from './place-freely.tsx';
import { type LayoutOpsDeps, layoutOpsDeps } from './reorder-slot.tsx';

export const LAYOUT_ACTIONS = [
  'object.place-freely',
  'object.reorder-earlier',
  'object.reorder-later',
  'layout.convert-to-absolute',
] as const;
export type LayoutAction = (typeof LAYOUT_ACTIONS)[number];

export const isLayoutAction = (id: unknown): id is LayoutAction =>
  typeof id === 'string' && (LAYOUT_ACTIONS as readonly string[]).includes(id);

export const NEEDS_ONE_LINE = 'Select one object first.';
export const NEEDS_FRAME_LINE = 'Select a frame first.';
export const NOT_IN_LAYOUT_LINE = 'It is not in an auto layout.';

/**
 * The arrow that reorders: ← → in a row, ↑ ↓ in a column (row-reverse / column-reverse flip them);
 * only a bare arrow, only for an object that sits in a flex layout (`position` static / relative).
 */
export function reorderKeyAction(
  key: string,
  mods: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean },
  parent: { display: string; flexDirection: string } | null,
  position: string
): 'object.reorder-earlier' | 'object.reorder-later' | null {
  if (mods.meta || mods.ctrl || mods.alt || mods.shift) return null;
  if (!parent || (parent.display !== 'flex' && parent.display !== 'inline-flex')) return null;
  if (position === 'absolute' || position === 'fixed') return null;
  const dir = parent.flexDirection || 'row';
  const column = dir.startsWith('column');
  const reversed = dir.endsWith('reverse');
  const back = column ? 'ArrowUp' : 'ArrowLeft';
  const fwd = column ? 'ArrowDown' : 'ArrowRight';
  if (key !== back && key !== fwd) return null;
  const earlier = (key === back) !== reversed;
  return earlier ? 'object.reorder-earlier' : 'object.reorder-later';
}

const LABEL: Record<'object.reorder-earlier' | 'object.reorder-later', string> = {
  'object.reorder-earlier': 'Move earlier',
  'object.reorder-later': 'Move later',
};

const oneElement = (selected: readonly Selection[], doc: Document): HTMLElement | null => {
  const one = selected.length === 1 ? selected[0] : null;
  return one?.id ? (resolveSelectionEl(doc, one) as HTMLElement | null) : null;
};

/** Run one of the four. `refs` come from a Layers row; otherwise the selection is the target. */
export async function runLayoutAction(
  id: LayoutAction,
  selected: readonly Selection[],
  refs?: ElementRef[],
  deps: LayoutOpsDeps = layoutOpsDeps.current,
  doc: Document = document
): Promise<void> {
  if (id === 'object.reorder-earlier' || id === 'object.reorder-later') {
    const targets = refs ?? refsOf(selected);
    if (targets.length === 0) return void deps.toast?.(NEEDS_ONE_LINE, 'info');
    await runArranged(id, LABEL[id], targets, {}, deps);
    return;
  }
  const el = refs?.[0]
    ? (doc.querySelector(
        `[data-dc-screen="${CSS.escape(refs[0].artboard)}"] [data-cd-id="${CSS.escape(refs[0].element)}"]`
      ) as HTMLElement | null)
    : oneElement(selected, doc);
  if (!el) return void deps.toast?.(NEEDS_ONE_LINE, 'info');
  if (id === 'object.place-freely') {
    await placeFreely(el, deps);
    return;
  }
  // layout.convert-to-absolute — v1's convert owns the confirm, the walk and the single batch
  const convert = (
    window as unknown as { __maudeConvertToAbsolute?: (el: HTMLElement) => Promise<void> }
  ).__maudeConvertToAbsolute;
  if (!convert || el.children.length === 0) {
    deps.toast?.(NEEDS_FRAME_LINE, 'info');
    return;
  }
  await convert(el);
}
