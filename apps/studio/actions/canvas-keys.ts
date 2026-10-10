// actions/canvas-keys.ts — the canvas iframe's key resolution (V2-1.3 contract §5.5 / §5.7;
// V2-2.4 step 5). Pure. Reads the slim generated keymap (keymap.gen.ts), not the whole registry.
//
// Each canvas key owner resolves the chords of the actions it handles: input-router's keydown
// branch (tools, esc, undo / redo) through `classify()`, the rest through `useCanvasKeys()`.
// During V2-2.4 every owner keeps its own listener where v1 had it, so cross-owner order — and
// v1's double-fires (V2-1.3 defects 2 and 7) — stay byte-identical; one listener for all of them is
// the Phase 4 single-owner delta.

import { canvasKeyCtx } from './ctx.ts';
import { documentIndex } from './documents.ts';
import { CANVAS_KEYMAP } from './keymap.gen.ts';
import { chordFromEvent, type KeyEventLike } from './keys.ts';
import { type KeyIndex, resolveChord } from './resolve.ts';
import type { ActionId, KeyedAction } from './types.ts';

/** The canvas-document bindings of these actions. Build once per owner. */
export function canvasKeyIndex(ids: Iterable<ActionId>): KeyIndex<KeyedAction> {
  const own = new Set(ids);
  return documentIndex(CANVAS_KEYMAP, 'canvas', (id) => own.has(id));
}

/** The action a keydown in the canvas runs, among one owner's index — or null. */
export function resolveCanvasKey(
  index: KeyIndex<KeyedAction>,
  e: KeyEventLike,
  typing: boolean
): ActionId | null {
  return (
    resolveChord(index, chordFromEvent(e), canvasKeyCtx({ typing, readOnly: false }))?.action.id ??
    null
  );
}
