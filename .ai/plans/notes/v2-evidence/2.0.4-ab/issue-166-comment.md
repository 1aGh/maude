2.0.4 status of this issue:

- **Two Macs apart after a trash race, no conflict shown** — fixed. A queued trash the project later refuses is now held as a conflict on that Mac (both versions kept, "Not saved · Compare"), and the trash goes out once (24276e32e).
- **A held conflict disappearing after a restart** — fixed. The open conflict is kept on disk, so the notice and Compare come back after a relaunch, update or rested tab (133f63e08). Race rig with restarts: 20/20, both directions.
- **The canvas's creator seeing a false conflict after a restart** — fixed. The Mac that made a canvas now records the version the project accepted, so its offline edits are proposed normally (ca7e97da2).
- **Restore on an emptied synced canvas** — fixed. A restore (Trash or Version history) now sends this Mac's unsaved change up first, then puts the artboards back; a change the project refused makes the restore say so instead of answering ok. Rig: 0–4/10 → 10/10 in both directions.
- **A text edit inside an artboard someone else trashed** — not lost. Either the edit was saved first and the Trash item holds the edited artboard, or it is held as a conflict on the editor's Mac. In 18 online races none was lost.
- **Move to cloud signing in twice, dry-run cost, ⌘Z read abort/cap, pre-1.9.0 hub leg** — fixed or added in 2.0.4 (the saveMode and cloud-tab items were already fixed in 2.0.0; the attach-offline item no longer applies).
- **Deferred:** the desktop end-to-end runs of the restart step and the updated multiplayer lane need a debug app build; they run after the release merge.
