// One ⌘Z across both planes for design-system gestures (S10 Q1, decision
// `v2-S10-undo-hook-across-planes`).
//
// A publish (pick, Cancel, a canvas update …) is ONE kernel action for its Plane-A changes — the
// metas, the DS canvas's `dsPending`, the TSX `data-ds-rev` strips — and the `head.json` log entry
// it writes records that action's id. Revisions are content-addressed and immutable, so undoing the
// Plane-B half needs ids, not blobs: when the kernel accepts an undo (or redo) of that action, this
// hook moves `head` / `base` back to the entry's `was` pointers, re-materialises the working files
// from that revision and logs a `restore` entry carrying the undo action's id — which is exactly
// what a later redo names, so redo is the same revert, run on the restore entry.
//
// The hook runs only after an ACCEPTED, delivered undo (routes/project-undo.ts): a refused one
// (`forbidden` — someone else's action; `undo-conflict` — changed since) moves nothing here. It
// never reverts head.json over a later publish (`ds-head-moved`) or over unreviewed outside edits
// (`ds-outside-unreviewed`); those come back as `skipped` rows beside the kernel's own.

import { registerUndoHook, type UndoHook } from '../routes/project-undo.ts';
import type { DsEngine } from './engine.ts';

export const DS_UNDO_HOOK = 'ds';

export function dsUndoHook(engine: Pick<DsEngine, 'revertActions'>): UndoHook {
  return async (e) => {
    const { skipped } = await engine.revertActions(e.undoes, e.actionId, e.redo);
    return skipped.length ? { skipped } : undefined;
  };
}

/** Wire the hook (the studio's boot, S10.3's `routes/ds.ts`). Returns the unregister. */
export function registerDsUndoHook(engine: Pick<DsEngine, 'revertActions'>): () => void {
  return registerUndoHook(DS_UNDO_HOOK, dsUndoHook(engine));
}
