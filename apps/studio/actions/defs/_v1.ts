// actions/defs/_v1.ts — helpers for the V2-2.4 pure swap: today's (v1) key bindings registered
// under their v2 ids with v1's predicates copied as they are (V2-1.3 contract §8 step 2).
//
// v1's listeners matched loosely (`e.key === 'k'` with any ⇧; `e.key === 'Escape'` with any
// modifier), so one v1 branch can be several canonical chords. `mods()` spells them out; the
// extra chords are `alias` bindings (never shown as the primary key) and die with the v1 binding
// in Phase 4 (rule 13). ⌥ variants of ASCII keys are deliberately NOT registered: on macOS ⌥
// changes `e.key` ('k' → '˚'), so v1 never matched them there.

import { k } from '../keys.ts';
import type { Focus, KeyBinding, Layer, Pred } from '../types.ts';

/** One binding from a human chord spelling. */
export function kb(
  spec: string,
  layer: Layer,
  extra: Omit<KeyBinding, 'chord' | 'layer'> = {}
): KeyBinding {
  return { chord: k(spec), layer, ...extra };
}

/** Every combination of `extra` modifier glyphs added to `base` (base first, then aliases). */
export function mods(
  base: string,
  extra: string,
  layer: Layer,
  rest: Omit<KeyBinding, 'chord' | 'layer'> = {}
): KeyBinding[] {
  const glyphs = [...extra];
  const out: KeyBinding[] = [];
  for (let mask = 0; mask < 1 << glyphs.length; mask++) {
    const add = glyphs.filter((_, i) => mask & (1 << i)).join('');
    const b = kb(add + base, layer, rest);
    out.push(mask === 0 ? b : { ...b, alias: true });
  }
  return out;
}

/** The shell document's foci (§5.3 during V2-2.4: the shell never computes 'canvas' — a key pressed
 *  while the canvas iframe has focus is delivered inside the iframe, not to the shell). */
export const SHELL_FOCI: Focus[] = ['chrome', 'timeline', 'text'];

/** v1 `use-keyboard-shortcuts` after its `if (inEditable) return` (a range slider counts as
 *  typing there) and its `if (inCanvasIframe) return`: T H S N ? F1. */
export const SHELL_NOT_TYPING: Pred = { focus: ['chrome', 'timeline'], notFacts: ['rangeFocused'] };

/** v1 timeline transport: timeline open with a comp, focus not typing — a `<select>` counts as
 *  typing there, a range slider does not (the "spacebar stopped working" fix). */
export const TRANSPORT: Pred = { notFacts: ['selectFocused'] };

/** Inside the canvas iframe, not in a text field (v1 `isEditableTarget` false). */
export const IN_CANVAS: Pred = { focus: ['canvas'] };

/** Inside the canvas iframe, text field or not (v1 listeners that never checked). */
export const IN_CANVAS_ANY: Pred = { focus: ['canvas', 'text'] };
