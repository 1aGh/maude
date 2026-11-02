### 4. Snapshots: the hooks keep them

There is nothing to copy before you edit. The design plugin's hooks save the bytes of each file before every write, in the run folder (`$RUN/snap/` for the step, `$RUN/base/` for the file as the run first met it). The run is one undo step, and everything it changes becomes one version in Version history. Details: [Snapshot protocol](../../skills/design/_guide-07-snapshot-protocol.md).

- Edit the file in place with the Edit tool. Do not write `.bak` copies, and never copy an old file over the canvas: that skips the check and the new version.
- If a write breaks the canvas (it no longer parses or draws), the hooks put the file back at that edit and tell you why. Fix the cause and write again; do not work around it.
- A write the hooks cannot snapshot (a file over 4 MB) has no step to undo. Tell the person before you make it.
- A pre-v2 project may still hold old snapshots in `.design/_history/<slug>/`. That folder is read only. `/design:rollback` can show them.
