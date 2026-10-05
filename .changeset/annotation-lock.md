---
"@1agh/maude": minor
---

Whiteboard items can now be locked in place. Select a sticky, shape, text, image, arrow or section and press **⌘⇧L** (or use the lock button in the toolbar or the right-click menu): a locked item can still be selected, but it can't be dragged, resized, rotated, nudged, erased, cut, deleted or text-edited by accident, and a marquee skips it. Unlock it the same way. Copies of a locked item start unlocked, and a locked section holding items can't be deleted. Collaborators see the lock live, and `maude design annotate` refuses to change a locked item unless the request unlocks it. The lock is a guard against accidents, not a permission: anyone can unlock, and a collaborator on an older version of Maude can still move a locked item — and its next edit clears every lock on that board.
