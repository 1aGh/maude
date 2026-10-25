# fix-c6-bugs4 — P8 round 6, bug sweep 4 (10 · 09 · 13 · 08)

## Done (tests `p8-c6-bugs4.test.ts`, `p8-c6-bugs4-offline.test.tsx`)

| id | cause | fix |
|---|---|---|
| 10 co-sync-offline | `useOfflineFoot`'s first effect after a relaunch (kind not known, queue not read, pending 0) wiped the stored `maude-offline-since`, so a day offline read "since 01:36"; `whenWords` also rendered an unpadded hour ("0:19") | a stored "since" waits for the queue to be read (20 s settle) before an empty queue counts as drained; two-digit 24-hour clock (CONTRACT §4) |
| 10 co-comment-thread | no configured `user.name` → the comment was stored with `author: ''` → "unknown" + a "?" pin | `comments/local-author.ts`: configured name → OS account → "You"; used by `commentsAdd`, `commentsAddReply` and the comments op actor |
| 09 ex-social | the render worker's runtime harvest (`bin/_thumbs-playwright.mjs`) measured the bordered artboard frame (`offsetWidth` 436 × 544 in dark) and the estimate's board took that over the JSX size | the harvest measures `.dc-artboard-body` (as canvas-lib's `__maudeCanvasRects` does); the empty dark tile was a 1.1 s shot (the tile fills ~0.8 s) |
| 13 ds-truth-outside | not a product defect: the probe's regex took the first system of `ds status` (maude); `ds status maude-v2` reports `outside`, and the inspector card draws once the inspector is open | harness only (`s13.mjs` opens the inspector and waits for the poll) |
| 08 ak-convert-after | `sourceWord` only knew catalogue social sizes (a post drawn at 432 × 540 was an "artboard") | an artboard labelled "post" is a post. Dark selection landed on the A6 copy in the re-shoot (the earlier dark frame was a timing miss) |

## Open

- 08 ak-convert-after: the "+ 13 % height · Ink fill" chip beside the A6 copy and the "Unchanged" mark under the post. Both are a transient canvas overlay after a conversion (`plan.extraPct` and the source word are known to the dialog). It needs a new shell → canvas `dgn` message, and the dgn protocol is a shared file: patch request below.
- 10 co-sync-offline: the board's "Invites send when this Mac is online." tooltip and the queued-comment / per-row "not sent" tags (need per-canvas pending data) — unchanged.

## Patch requests

`bridge/dgn-protocol.ts`: add the parent-only message `convert-marks` `{ from, to, extraPct, fill }` (shell → canvas, honoured only from the parent like `select-by-id`). `canvas-shell.tsx` then draws a check "Unchanged" under `[data-dc-screen=from]` and a "+N % height · <fill> fill" bracket at the right edge of `[data-dc-screen=to]` for a few seconds (the board's `ak-pair--under` / `ak-grow--fill`), and `ConvertDialog` `onDone` posts it. Not started.
