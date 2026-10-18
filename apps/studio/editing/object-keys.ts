// editing/object-keys.ts — the chords of the S2.6 object ops, resolved through the action registry
// (no chord is matched by hand): ⌥⌘G / ⌘G frame, ⇧⌘G unframe, ⌘] ] [ ⌘[ order, ⇧⌘L lock. They are
// Edit-mode bindings on an OBJECT selection; the same chords in Preview belong to annotations
// (`annotation.*`), and the two scopes never overlap (registry uniqueness per scope).

import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { chordFromEvent, type KeyEventLike } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import type { Mode, SelKind } from '../actions/types.ts';
import { OBJECT_OP_ACTIONS, type ObjectOpAction } from './object-ops.ts';

const OBJECT_KEYS = canvasKeyIndex(OBJECT_OP_ACTIONS);

export interface ObjectKeyState {
  typing: boolean;
  mode: Mode;
  /** 'object' while at least one stamped object is selected */
  selection: SelKind;
  singleKeys?: boolean;
}

/** The object op a keydown runs, or null. */
export function resolveObjectKey(e: KeyEventLike, s: ObjectKeyState): ObjectOpAction | null {
  const r = resolveChord(
    OBJECT_KEYS,
    chordFromEvent(e),
    canvasKeyCtx({
      typing: s.typing,
      readOnly: false,
      mode: s.mode,
      selection: s.selection,
      singleKeys: s.singleKeys,
    })
  );
  return (r?.action.id as ObjectOpAction | undefined) ?? null;
}
