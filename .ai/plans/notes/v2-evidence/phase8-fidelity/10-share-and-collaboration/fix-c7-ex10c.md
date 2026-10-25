# 10 Share and collaboration — round 7c (p8-c7-ex10c): done / open

Checklist: `critic-bar2.md` MUST rows left open by `fix-c7-ex10.md` / `fix-c7-oboard.md`. Verification: fail-first tests (revert-checked: source files put back to the feat tip, the new tests went red, files restored and `git diff` clean), tsc + biome, release rebuild, re-shoot with `_c7c-harness-g4` (scenarios `s10 s10cm s10c s10d s10e s10m` as before + `s10v` and `s10k`).

## Done

| id | what | tests |
|---|---|---|
| co-ask-edit | the tip sits beside the pointer (80 right / 18 down, clamped to the window), like the board's callout. dgn `view-only-gesture` carries optional `x`/`y` (whole numbers 0..16384, numbers only, no text; commit `318c7a712`, its own commit); `view-only-gesture.tsx` posts the pointer where the drag passed 8 px; `use-canvas-bridge.jsx` moves it by the frame's corner; `AccessLayer` anchors `.v2ac-tip--at` there, and falls back to the cluster anchor when no position came | `dgn-protocol-parse.test.ts`, `v2-access-host.test.tsx` (post shape, tracker, `tipStyle`, host) |
| co-conflict | the card is on the canvas at about half the window's height (not a banner under the pill row), no ×: Escape puts it away (the "2 versions" mark stays); the stage is click-through between its cards; Version history 64 px away from the pair. Harness folds the Canvases panel as the board has it (`s10k`) | `v2-sync-states.test.tsx` (no `.sy-close`, Escape, `vh` top) |
| co-trashed | the ghost row is two lines (name, then "In the trash · open here"), 42 px tall, selected when it is the open tab (`current`) | `v2-canvases-row-slots.test.tsx` |
| co-comment-video | markers on the timeline strip: each timed thread of the video (`c.t` seconds + the video's artboard id) is its author's face on their tone, 20 px, at its second, on a row of its own above the ruler; a click puts the playhead there; the header says "2 comments on this video" (`1 comment …`). `app.jsx` now hands the timeline the timed pins too (one line, own commit) | `p8-c7-ex10c-timeline-comments.test.tsx` |

## Open

- **co-trashed — the Edit cluster kept.** The brief asks to keep it; decision `v2-lead-trashed-while-open-stops-writes` says the tab goes to Viewing with no toolbar (writes stop, the server answers 409 in-trash). Two options: (a) keep today (Viewing, no edit dock — safe, differs from the board) or (b) keep the Edit cluster and dock drawn but every write refused with the trash words. Not changed — a product decision, not mine.
- **co-comment-video — Preview.** The timeline is an Edit surface (the island follows the SELECTED video artboard; Preview selects nothing and shows no island), so the strip is shot in Edit with the playhead on the first marker; the board shows it with the Comment tool in Preview, the thread card and the pin on the picture. A read-only strip in Preview would be 04/07's call. The marker at the playhead has no accent ring yet.
- co-share-advanced: "Opens the folder on this Mac only." (not in this scope, unchanged).
