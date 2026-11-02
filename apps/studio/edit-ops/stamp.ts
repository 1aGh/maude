// edit-ops/stamp.ts — `element.stamp` (S4.11; contract S2-S4-artboard-motion-ids.md §3, Q12).
//
// An arrow can only bind to an element by an AUTHORED id (V2-1.4 rule 3): a computed 8-hex id is
// never a durable reference. The dispatcher's step 4 already stamps every target (`ensureStamped`) before
// an op runs, so the op itself changes nothing — naming the element IS the write, and an element that is
// already named answers `ok` with no write at all. This op exists so the canvas has one way to ask for
// that, through the one dispatch route and its one refusal order (role, AI hold, stale), instead of a
// second door into the same .tsx.
//
// `locked: 'allow'`: pointing at a locked element is not editing it, and a lock only forbids changes.
//
// Not in ⌘Z: the write is bookkeeping for an arrow, so the caller never records an undo step for it —
// undoing an arrow removes the arrow, not an invisible id. The action's label says what happened.

import type { EditOp } from './types.ts';

export const elementStamp: EditOp = {
  id: 'element.stamp',
  locked: 'allow',
  apply(source, req) {
    const id = req.targets[0]?.element ?? 'element';
    return {
      source,
      action: { kind: 'edit', label: `Named “${id}” so an arrow can point at it` },
    };
  },
};
