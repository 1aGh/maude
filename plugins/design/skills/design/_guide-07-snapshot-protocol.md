## Snapshot protocol

You do not copy the canvas before an edit. Two things keep every change reversible, and neither needs a step from you.

**1. The hooks keep the bytes of the run.** The design plugin's hooks save what each file was before every write, in the run folder (`.design/_runs/<run>/snap/` for the step, `base/` for the file as the run first met it). The run is one undo step. If a write breaks the canvas (it no longer parses or draws), the hooks put the file back at that edit and tell you why. The run folder is runtime state: never versioned, never synced, pruned after a week.

**2. Version history keeps every change for good.** Everything you or anyone else changes becomes a version the person sees in Version history. Going back adds a version and removes none: see [Versions and the Trash](./_guide-versions-and-trash.md), `/design:history` and `/design:rollback`.

Rules:

- Edit the file in place with the Edit tool. Do not write `.bak` copies, and do not copy an old file over a canvas: that skips the check and the new version.
- A write the hooks cannot snapshot (a file over 4 MB) has no step to undo. Say so before you make it.
- A pre-v2 project may still hold snapshots in `.design/_history/<slug>/`. They are read only. `/design:rollback` can show them and, with the person's yes, copy one back.
