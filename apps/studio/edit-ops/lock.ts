// edit-ops/lock.ts — `object.lock` (⇧⌘L in Edit, the Layers padlock, the object menu's Lock).
//
// Lock is SHARED (V2-1.4 §5.5, S2 Q9): `data-cd-locked` on the element in the versioned TSX, the same
// for every collaborator and visible to Claude. The one op that may touch a locked target (it IS
// the lock), so a locked object can be unlocked by anyone with edit rights. Never per user: the old
// per-user Layers padlock (view.json) is read as legacy and migrated by V2-2.14.
//
// params.locked: true | false sets it; absent toggles — lock everything first, and only when every
// target is already locked, unlock them all (so a mixed selection never flip-flops).

import { applySetLocked } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import type { EditOp } from './types.ts';

export const objectLock: EditOp = {
  id: 'object.lock',
  locked: 'allow',
  apply(source, req) {
    let want: boolean;
    if (typeof req.params.locked === 'boolean') want = req.params.locked;
    else {
      const walk = walkIdElements(source, req.file);
      const els = walk.ok ? walk.elements : [];
      want = !req.targets.every((t) => els.find((e) => e.id === t.element)?.locked);
    }
    let out = source;
    for (const t of req.targets) out = applySetLocked(req.file, out, t.element, want).source;
    return { source: out };
  },
};
