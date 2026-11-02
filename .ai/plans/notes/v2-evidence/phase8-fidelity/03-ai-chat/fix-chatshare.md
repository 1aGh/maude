# P8 stage C round 2 — C6 ai-chat (rest) + C7 share-collab (rest) — `p8-c2-chatshare`

Branch `p8-c2-chatshare` (from feat/maude-v2 3fd7b1658). Stopped on the token/turn budget with code + tests only:
**stage D re-shoots were NOT done**, so no artboard is marked matching. Verified: tsc clean, biome clean (warnings pre-existing),
release rebuild + `check-client-boots-source.mjs` OK + `opening-card-clears.mjs` PASS; dist reverted.
Tests: `apps/studio/test/p8-c2-chatshare.test.tsx` (new), `v2-ai-runs-model.test.ts` (+1), hub `access-api.test.mjs` (+1 assertion).

## Done this round (per artboard id)
| id | what changed | state |
|---|---|---|
| ai-permission, ai-question, ai-needs-hidden | `ringsFor`: a needs-you run on a WHOLE-canvas scope rings only the artboards it has touched (none for a bare question), not every artboard. `runs-model.js` | fixed (canvas side) |
| ai-permission | neutral `.ai-nc` card (no accent inset ring, accent only on focus), help glyph instead of the spark, "what will change" strip: 28x22 tiles + names, 4 max + "+N" (`WillChange.jsx`, `willChangeFor`, names from the project index). Tiles are neutral artboard shapes: the index has NO per-artboard picture (only a canvas cover), so there is no thumbnail to draw | partly fixed — tiles without pictures |
| ai-choice-fail | help glyph; 18 px colour disc in front of a row when the option names a literal hex (`swatchOf`), the "Something else…" row gets the neutral pen disc. Hint line + picked ring were already there | partly (an option with no hex has no disc: choices carry no colour data) |
| ai-not-ready | connect sheet floats over the panel as its own card (radius-xl, 24 px padding, absolute at top 76), feed and field dim to 60 %, the suggestion strip hides via `.ai-island:has(...)` (the old `.chat-thread:has` never matched: the strip is outside the thread) | fixed |
| ai-chat-list | one header: the chat header steps aside while the list is open (the list has its own `ai-cl-hd`); state is the 22 px `RunIcon` disc (idle = quiet spark) instead of an 8 px dot | fixed |
| ai-needs-hidden, ai-panel-closed | needs-you / done toasts are the kit one-line island pill: glyph (help / spark) · text · accent action, no ×, no card (`notifications.tsx` `NoticeCard`, `icon`) | fixed |
| co-sync-back | back-online toast: `placement: 'top'` + `icon: 'sync'` now honoured by the host (patch request from wave 1 implemented: Sonner per-toast `position: 'top-center'`) | fixed |
| co-comment-thread | Comments panel: close button (`onClose` -> `togglePanel('comments')`), tone-filled faces with one letter (`Person`), AI = spark, "Open 4" count spacing, reply field says `Reply…` (the send hint moved to `title`) | fixed |
| co-share-sheet | hub `peopleFor` invitation rows carry `invitedAt` -> "Invited 2 days ago" (patch request implemented, `apps/hub/src/routes-v2/access.mjs`) | fixed |

## Board-side (CONTRACT over board) — NOT done, named
- 10 `CommentsPanel` and 04 `CommentsPanel` draw the panel on the LEFT with three filters; CONTRACT §6 says RIGHT with `Open · Mine · Resolved · All`.
  The app already follows CONTRACT; the BOARDS need `counts` of four + the panel in the right slot. Not edited (two boards, one owner each).

## Still open (not started)
- ai: Always-for-this-canvas box (fake agent offers no `allow_always`: harness), point ring + Before/After pills (`artboard-activity-overlay.tsx`, C5), width pinned 420 / left-panel collapse / Share overlap, suggestion strip (needs open comments), scope chip "Choose artboards…" (needs a `.meta.json` fixture), ⌘/ per board, run-list popover, advanced selects, slash-menu mono names, assistant hover Retry, day divider / sent thumbs / jump pill / resize tooltip, copy caption + dashed link, problem card Advanced fold (kept: it is a documented, tested affordance — s5-17b — the board draws title · detail · one verb; needs a decision).
- share: co-follow / co-bring / co-spotlight / co-twelve (second-peer stub `apps/studio/test/fixtures/presence-peers.mjs` NOT built — plan in fix-share.md), co-comment-video (timeline markers, "N comments on this video", glyphs in the thread header), "Tereza changed this", conflict card placement on the canvas + "2 versions" mark at the sticky, owner request block restyle, "Make owner".
- Stage D: pairs + INDEX "after" column for 03 and 10.

## Shared-file commits
`client/hooks/use-palette-and-panels.jsx` (one prop, in the comments commit), `notifications.tsx` (own commit 9e4adceef). No app.jsx, no dist.
