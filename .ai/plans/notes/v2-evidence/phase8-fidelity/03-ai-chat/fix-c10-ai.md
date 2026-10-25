# P8 stage C round 10 — AI chat (`p8-c10-ai`) — 03

Branch `p8-c10-ai` (from feat/maude-v2 55850113d). Checklist: `critic-bar4.md` MUST rows. Harness: `_c10-ai-harness/` (flattened `_d6-harness-g2` + this round's edits; ids shot by it are re-shot into `.scr/d6/03-ai-chat/`).

## Done
| MUST row | what changed | state |
|---|---|---|
| ai-long / ai-long-pinned: result card (Before/After, Undo/Compare) + "What AI did" fold only on the LATEST run | `v2/ai/TurnResult.jsx`: an earlier reply draws its own `ResultCard` (run found by time: `run-model.js turnRunFor`, closest run to its ask; steps from the reply's own tool calls; no "Keep going"/follow-up chips). `RunSurface` no longer draws the tail card for a run of an EARLIER turn (`runIsFromEarlierTurn`). A reply whose run changed the canvas no longer claims "The canvas didn't change." | fixed |
| ai-long: Before/After never drew on the real list | `VersionRow.runId` (rows.ts) — the versions API had no run id on a row, so `beforeAfterOf` never matched (unit tests fed it fabricated rows). Undo rows are skipped by `kind` too | fixed (product bug) |
| ai-long / ai-long-pinned: sent-thumbnail strip + attach rows | `v2/ai/SentStrip.jsx` + `sent-attachments.js`: what an ask was sent with is drawn ABOVE its bubble (56 px photo tiles, PDF / footage / folder cards). Live: the adapter records the chips that rode (`recordSent`); after a reload: `acp/transcript.ts parseAttachmentBlock` returns `attachments` and strips the raw `[maude-attachments …]` lines that were showing in a reloaded bubble | fixed (product bug) |
| ai-long: composer prefilled | harness types the recap prompt + attaches footage; `Suggest.jsx` steps aside while the field has a draft (board has no chips there) | fixed |
| ai-hero: folder-consent card + folder/PDF chips | harness (`s03e`): the next ask is half written while the finish plays — photo, PDF, folder (stub `pick_attach_folder`) → "Let AI read …?" card + chips | harness |
| ai-advanced: Done chat, lower half | harness (`s03z`): Done chat + Advanced open on a taller page (1500 px) cropped to the panel; fake agent emits `usage_update` (context 38 %, 5-hour limit 64 %) so the meters read; persona row, Raw log / Copy transcript / Open in terminal in frame | harness |
| ai-copy: scope chip "Post 1:1 · copy" | `scope.js shortArtboardName` keeps a copy's `· copy` tail | fixed |
| ai-question: Ask card closed | already fixed on feat (p8-c9-bugs); re-shot | re-shot |

## Open (named)
- ai-long-pinned: footage card on the hung recap ask — an attached clip starts the AI-cut "watching footage" card and ringing every artboard (a different surface), so the harness does not attach it there; the six-thumb strip in the "Six shots picked" reply is not built.
- ai-long: board's second divider ("Today, 09:12") reads a clock time of the shot.
- Result card thumbnails are the artboard crop of the thumbnail service (portrait for a square Post), board draws small mini frames.

## Decisions
- `decision:maude/v2-p8-c10-ai-turn-result-under-reply` — an earlier turn's result card sits under its own reply, matched by time (the run created closest to the ask), and the feed's tail card only shows for the last ask's run. Rejected: matching by prompt label (a repeated prompt collides; no value outside this harness), keeping the tail card for the latest run whatever turn it belongs to (it hung the old turn's Undo at the foot of a newer, unrelated reply).
- `decision:maude/v2-p8-c10-ai-sent-chips-from-prompt` — the sent chips are parsed back from the attachments block of the prompt in the transcript (kind, name, meta, path) rather than a new field written next to each ask. Rejected: a second per-ask record in `_chat/` (a versioned-format change for something the prompt already carries).
- `decision:maude/v2-p8-c10-ai-row-runid` — the versions row names its run (`runId`, AI rows only). Rejected: a second fetch of the run → version mapping in the chat (one more route for what the list has).
