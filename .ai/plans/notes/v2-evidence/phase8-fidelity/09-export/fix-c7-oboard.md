# 09 Export — round 7b (p8-c7-ex10b): done / open

Checklist: `critic-bar2.md` MUST rows left open by `fix-c7-ex10.md`. Verification: fail-first tests (revert-checked where marked), tsc + biome, release rebuild, re-shoot with the round-7b harness (`_c7b-harness-g3/`: `t09` all ids + `ho`; `t09b` = the canvas / batch steps alone, `t09p` = the seeded job lists alone).

## Done

| id | what | tests |
|---|---|---|
| ex-huge | **Include** row on Whole project: "All N folders" and the loose canvases ("test, Test2, ahoj…") are two ticks; unticking one is a real spec field `exclude: { folders?: string[], loose?: boolean }` (Whole project only; each folder goes through `cleanDesignRel` — inside the design root, not runtime state, no `..`/backslash, at most 64; the ZIP's raw walk takes the same hint and re-validates it). The estimate names the ticks (`canvasCounts.folderNames`, `looseNames`). "Project ZIP instead" is accent text (the kit's ghost button, layer components, greyed it) | `p8-c7-ex10b-project-include.test.ts` (validation, resolve, ZIP walk, estimate; red before), `v2-export-batch.test.tsx` (sheet, revert-checked) |
| ex-canvas | harness: the shot was a selection export of a Frame (a click on the canvas lands on an object). Now Escape ×3, then the sheet on "This canvas" — the kind rows (Fixed size · Web page · Print · Video) and Folders / Save to are drawn | — (harness `t09`) |
| ex-batch-pick | harness: ⌘A selected the sections' frames. Now the label chips of Post, Story, A front (shift) — two fixed-size + one print, a group each. Product: picked artboards get the board's **File names** select ("Canvas — artboard" / "Artboard only", the spec's `nameTemplate`) instead of Folders | `v2-export-batch.test.tsx` (row, value, posted `nameTemplate`) |
| ex-batch | the sub line named the design root's internal folder ("ui"): a folder's sub shows a path only when it adds one; harness answers the estimate with the cloud lane so the video row's "In the cloud" note and the big-export line say the cloud words | `v2-export-sheet.test.tsx` (`sheetSub`) |
| ex-progress, ex-states, ex-history | the Exports panel rows are **named** from the job's spec ("Matchday · 2 videos · 4K", "social · 115 artboards", "Matchday · PowerPoint"), each has a 32 px **picture tile** (the canvas cover via the index; the export glyph when it has none), the header has the board's **Open the Downloads folder** button (Mac app; reveals the newest finished file), the foot is the board's two lines (running: what survives a sleeping Mac; idle: "The last 20 exports stay here. Also in Search: “Exports”."). Harness seeds jobs WITH their specs (running cloud, folder 115, this-Mac PowerPoint, done PDF; history: 114 of 115 + Retry, without sound, cloud, yesterday ×3) | `p8-c7-ex10b-exports-panel.test.tsx` (titles, tile, folder button, foot; red before, revert-checked on `specTitle`) |
| ex-handoff | the sub line lists the canvas's artboards, then the design system ("Desktop, Tablet, Mobile · Studio design system"): `GET /_api/handoff/targets` carries `subject.boards` (labels read from the source, 6 max), the sheet shows three then "…" | `handoff-v2.test.ts` (labels from source, `handoffSub`) |

## Open

- ex-batch: **Folders › One per canvas** (a real second layout: files under `<canvas>/` in the output; needs the name template / zip layout to take a path — not started) and the shared-parts hint (the harness fixture's artboard-less canvases are not index rows, so nothing names them).
- ex-print-warn: the in-sheet preflight warnings (QR 2 mm from the cut, font not embeddable) and the "2 mm to the cut" tag — headless measure not wired in the lane, not started.
- ex-history: the row menu (Show in Finder / Export again with other settings… / Copy file names / Remove from list) and the hover "More" button are not built; the done row's meta still reads "<format> · <where> · <ago>" (the board writes the format detail without the where for finished rows).
- ex-progress: "about 1 min left" needs the progress sample the cloud lane sends (the seeded rows show the percentage only); the "Today" day heading stays on a list that holds only running rows.
- ex-states: the four close-up columns (cards, cluster ring, three toasts side by side) are board composition; the product shows the panel rows and the real toasts.
- ex-offline: "Offline — kept on this Mac" top-bar status (not started).
