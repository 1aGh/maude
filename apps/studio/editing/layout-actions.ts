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
import { layerParams, refsOf } from './object-ops.ts';
import { constrain, placeFreely } from './place-freely.tsx';
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

/** `object.constrain` — the Position row's pins (S2.11b); its params carry the pins and the measured box. */
export const CONSTRAIN_ACTION = 'object.constrain' as const;
export const isConstrainAction = (id: unknown): id is typeof CONSTRAIN_ACTION =>
  id === CONSTRAIN_ACTION;

const PIN_H = ['left', 'right', 'both', 'center', 'scale'] as const;
const PIN_V = ['top', 'bottom', 'both', 'center', 'scale'] as const;
export const UNMEASURED_LINE = 'The canvas could not tell where it is; try again.';

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

/**
 * Run `object.constrain` from the shell's `run-action` (the Position row's pins): `params` carries
 * `targets` (a Layers row names its own; otherwise the selection), `h`, `v` and the object's
 * `geometry` in world px. One edit-op writes all four edges; a malformed ask asks nothing.
 */
export async function runConstrainAction(
  params: unknown,
  selected: readonly Selection[],
  deps: LayoutOpsDeps = layoutOpsDeps.current
): Promise<void> {
  const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const ref = (layerParams(params).refs ?? refsOf(selected))[0];
  if (!ref) return void deps.toast?.(NEEDS_ONE_LINE, 'info');
  const g = (p.geometry && typeof p.geometry === 'object' ? p.geometry : {}) as Record<
    string,
    unknown
  >;
  const num = (k: string): number | null => {
    const v = g[k];
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1_000_000 ? v : null;
  };
  const geometry = {
    x: num('x'),
    y: num('y'),
    w: num('w'),
    h: num('h'),
    parentW: num('parentW'),
    parentH: num('parentH'),
  };
  const h = (PIN_H as readonly unknown[]).includes(p.h) ? (p.h as (typeof PIN_H)[number]) : null;
  const v = (PIN_V as readonly unknown[]).includes(p.v) ? (p.v as (typeof PIN_V)[number]) : null;
  if (!h || !v || Object.values(geometry).some((n) => n === null))
    return void deps.toast?.(UNMEASURED_LINE, 'error');
  await constrain(ref, { h, v }, geometry as Parameters<typeof constrain>[2], deps);
}
