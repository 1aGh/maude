# P8 stage C round 8 — AI chat (`p8-c8-ai`) — 03

Branch `p8-c8-ai` (from feat/maude-v2 fcc24f4dd). Checklist: `critic-bar3.md` MUST rows. Harness: `_c8-ai-harness/` (flattened `_d5-harness-g2` + this round's edits).
Verified: AI battery + 6 new test files green, red-checked (fixes put back to the feat/maude-v2 version: every new test goes red), biome clean on touched files, tsc has no error in touched files (the `actions/defs/edit.ts` `order` errors are on the base tip).

## Done
| MUST row | what changed | state |
|---|---|---|
| ai-chat-list: header "+" | `ChatList` `onNewChat` → `ai-chat-list-new` (st-iconbtn, after the project chip); ChatPanel starts a chat and closes the list | fixed |
| ai-permission: will-change chips + one group tag | `artboard-activity-overlay.tsx`: a needs-you artboard wears "will change" (`.dc-ai-will`); two or more of YOUR waiting artboards share one dashed box + one tag "Waiting for you · N artboards" (`ai-ring-group`), their own tags go quiet. Fixed words only (DDR-054: the question text never reaches the canvas) | fixed |
| ai-two-artboards: "All chats" row + overlap | run list ends with "All chats  N" (`ai-runs-all`, opens the chat list); the list is `position: fixed` from the ✦ N rectangle and opens UP over the canvas when there is room (the dock slot clips anything hung outside it) | fixed |
| ai-copy | harness: chat 1 finishes by itself (`ms`), the copy run edits only the copy's block (it was denied out-of-scope, so no Undo / Keep the copy / "Ran on a copy"), the copy is picked, shot after it settles. Product already drew the controls | harness |
| ai-working / ai-two-artboards leak | harness: the attach step removes its chips before the asks | harness |
| ai-panel-closed: tag under the dock | `tagPlacement` gains `inside` (tag at the artboard's foot) when the below slot would sit in the dock strip | fixed |
| ai-panel-closed: Made by AI vs size chip | a SELECTED artboard (`data-ed-selected`) needs 440 px for an "above" tag, else it goes below | fixed |
| ai-adv-edges: slash menu clipped | `CommandPopover` is fixed from the composer's rectangle (3 design rows + More… all show) | fixed |
| ai-attach: drop veil over composer + chips | `DropOverlay` leaves the composer's height free (bottom = composer top + 8) | fixed |
| ai-question: follow-ups on a no-change answer | `answered` flag (result-shown.js, RunSurface) → strip "Make that change · Check the other artboards too", no "Because you last asked" line | fixed |
| ai-history Compare | harness picks the row and presses Compare (Before/After pair, Side by side / Overlay bar) against a version that differs | harness |
| ai-long-pinned running row | harness: the last ask hangs ("AI is cutting …" + Stop) | harness |

## Open (named)
- ai-hero folder-consent card + folder/PDF chips: the harness attempt (stub `pick_attach_folder`, menu row "Choose a folder…") did not reach the consent card (row not found); not shot.
- ai-long: sent-thumbnail strip, Before/After pair, "What AI did" fold, prefilled long prompt; ai-long-pinned Done card + attach rows (the result card shows only for a chat's latest run).
- ai-advanced lower half (persona, context + limit meters, raw log) in a Done chat; "+1" drag chip (an OS drag image).
- Scope chip of the copy chat reads "Post 1:1" (board: "Post 1:1 · copy"); copy artboard label is the long fixture name.
- Chat-list canvas-group cover squares: the covers need the thumbnail service to have rendered them (`askForCovers`, background priority); shot may still draw empty boxes.

## Decisions
- `decision:maude/v2-p8-c8-ai-group-ring-neutral` — the group tag says "Waiting for you · N artboards" (not the board's "Replace 4 photos?"): the question title is agent text and DDR-054 keeps it off the canvas. Rejected: posting the title through `ai-runs`.
- `decision:maude/v2-p8-c8-ai-popovers-fixed` — the run list and the slash menu are `position: fixed` from their anchor's rectangle: the dock slot's overflow clips anything absolute above a short chat. Rejected: unclipping the dock slot (rounded corners + panel shadow depend on it).
- `decision:maude/v2-p8-c8-ai-answer-strip` — an answered, change-free turn gets its own strip ("Make that change · Check the other artboards too"); the board's chips are agent-written and nothing of the answer is parsed. Rejected: reusing the change follow-ups ("Same on the other artboards" follows nothing).
