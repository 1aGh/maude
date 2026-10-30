# critic-d: 03 AI Chat, stage D re-check (V2-8.5)

One critic, four lenses (design, copy, a11y, signature), on tip 6d19daa9a. Read: every re-shot pair, dark full size; light read for ai-quit and ai-panel-closed, the other light pairs were checked through the stage-B statement that no theme-only drift exists and the INDEX note that the light pairs flip the same tokens (so a light verdict = the dark verdict unless named). Fixture/harness rows (INDEX C1-C5, H) are not counted.

Fixed since stage B and seen in the shots: 14 px bubbles right/left, no role label or tool card in the feed, one-row composer with chip inside, field stays during a turn, header (vermilion spark, no dot, count chip), hugging island, quit dialog padding, folded spark vermilion + dot, one chat-list header + 22 px disc, connect sheet floats, permission card neutral with help glyph, Made-by-AI tag on Post.

## Verdicts

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ai-hero | both | differs | design/signature: no Before/After wipe and no solid ring on Post (blue selection only, `artboard-activity-overlay.tsx:156-160`); result block carries an extra "What AI did" fold and the follow-ups sit below the result with a "Because ..." line and generic words; consent card + attach chips absent (Consent sits above the field); chip reads `post` (copy) |
| ai-open | both | differs | design: no suggestion strip / lead-chip glyph (comments not in fixture, cannot confirm); no Inspector card beside the panel; copy: chip `post`, not "Post 1:1"; a11y: cmd-slash opens the ask bar, not the panel field |
| ai-suggest | both | differs (cannot confirm) | only the empty state is shot; none of the 4 strips (comments, clips, shared, last ask) is on screen; copy blocker (generic last-ask chips + why, `suggest-why.js:141-167`) unchanged |
| ai-scope | both | differs | design: menu has 2 rows (`post`, "No canvas - just ask"), no "Whole canvas", no "Choose artboards..." (needs a `.meta.json` sidecar, fix-aichat); copy: labels are ids; chip x sits outside; folded corner / several-artboards chips not driven; a11y A1 (menu focus is a 1.1:1 fill) not claimed fixed |
| ai-working | both | differs | v1 banner "AI is editing this canvas - your changes may conflict" (`apps/studio/ai-banner.tsx`, not in the board) on top of the shell; canvas tag says "AI is working" (decided, v2-lead-neutral-ai-ring-tags); step reads the raw tool title (H); a11y A2 fixed (field stays) |
| ai-done | both | differs | no Before/After wipe + solid ring on Post (only the "Made by AI" tag); extra "What AI did" fold; follow-ups below the result with why line, generic words; Undo / Keep going are still the pill shape |
| ai-attach | both | differs | image chip still a sliver (impl shows a thin strip in the field, no 40x40 thumbnail, fix-aichat says fixture is a stripe, so cannot confirm); no drop overlay, no footage / PDF chips; chip `post` |
| ai-attach-menu | both | differs | paperclip has no pressed fill; menu sits slightly off the field with a gap; "Or drag files here" glyph; a11y A1 (focus on menu rows has no visible indicator, no row shown focused) not fixed; chip `post` |
| ai-question | both | differs | needs-you rings + "Waiting for you" tags still on 4 artboards (Web, Post, Story, teaser) for a bare question; no point ring ("9 pt") and no answer-in-words + follow-up chips; choice card still ringed in accent |
| ai-long | both | differs | no day divider, sent thumbs, Before/After pair in a result, "Jump to latest" pill, resize tooltip / accent edge line; follow-up strip with why line under the feed; panel is a plain column, board's 420 big shape with bubbles + result card not reached |
| ai-long-pinned | both | differs | pinned column runs past the right edge of the window and covers the Post artboard (Share cluster and settings icon still over its header); no re-fit of the canvas, 288 px not 420; left panel list is back (A5 half fixed) |
| ai-two-artboards | both | differs | "N" run-list popover not driven (count chip opens nothing); both canvas tags "AI is working" (decided); v1 banner (see ai-working); chip `poster` |
| ai-same-artboard | both | differs | waiting card matches (bg-2, clock, x, Run on a copy), but the holder name is "Translate it hang" (harness prompt), working line gone (fixed); v1 banner; a11y A4: "Waiting" is not announced (live region still empty) |
| ai-copy | both | differs | no "Copied from Post 1:1 before ..." caption and no dashed link from the original; the copy lands on a different row and its label collides; v1 banner; the frame is mid-run (no result with Undo / Keep the copy) |
| ai-chat-list | both | differs | copy: titles still leak the attachment header ("Make it greener hang [maude-...", `acp/transcript.ts:318-323`); list shows only the Running group (Earlier / canvas groups / row menu not driven) |
| ai-panel-closed | both | differs | spark is vermilion with a dot now, but the board's "Done - Post 1:1 is greener ... Show" pill toast is not in the frame (cannot confirm the pill is built); no breathing halo; Post shows "Made by AI" but A4 shows the generic tag |
| ai-quit | both | **match** | none remaining (dialog: 24 px padding, radius-xl, bg-2, title / body / Cancel + Quit as the board; body is 12 px). Warnings only: the "next launch" half (Stopped divider + half-done result) is not driven; "1 chat stops where they are" grammar; no focus trap |
| ai-needs-hidden | both | differs | toast is still a two-line card with x and file/verb copy ("edit Combine-kampan.tsx?") instead of the one-line pill; "Waiting for you" tags on 4 artboards; folded spark badge matches |
| ai-permission | both | differs | card is neutral with help glyph (fixed), but title/verb come from the tool ("Edit Combine-kampan.tsx?" / "Edit"), no thumbnail strip (tiles absent in the shot), no "Always for this canvas", rings + tags on 4 artboards, no "will change" pills |
| ai-choice-fail | both | differs | failure card has the generic cause ("the connection to Claude was interrupted") and "Try again" with an Advanced fold, board: footage-specific detail + one fixing verb; choice rows not in this crop; no swatches seen |
| ai-not-ready | both | differs | the connect sheet is cut off at the bottom of the window in the shot (title visible, text and Cancel / Connect not), and the panel is clipped; strip + chip hidden OK; offline / setting up / used up / almost used up panels not reachable |
| ai-advanced | both | differs | selects are native with a chevron and the value is cut ("Replace or move to the t..."), "default" on its own line; fold not scrolling to Raw log in the crop; image-chip sliver still in the field; Model / Effort / meters absent (H) |
| ai-adv-edges | both | differs | slash menu: names are accent mono with inline descriptions, an extra "More... 27 more" row, panel is not empty; no Copy + Retry on hover, no mode list, no Suggest-only banner (not driven); a11y A3 (no combobox wiring) not claimed fixed |
| ai-history | both | differs | Version history shows 4 tabs (board 3; CONTRACT keeps Named, board is stale) but the panel and the AI chat stack in the right column instead of Version history alone at 320 px; no Made-by-AI row actions or Compare bar (H); a11y A6 tab contrast not claimed fixed |
| ai-queue-rule | - | unreachable | a documentation graphic, no app surface (nothing to build) |
| ai-other-tab | - | unreachable | needs a desktop-shell e2e with two project tabs and a tab mark driven from the other tab's run registry |
| ai-tereza | - | unreachable | needs a two-peer hub project (second person's AI, avatar in tag, "On this canvas" split) |
| ai-needs-tab | - | unreachable | same as ai-other-tab with a needs-you run in the other tab |
| ai-needs-away | - | unreachable | native: OS notification + Dock badge (desktop e2e) |

## Root causes still open

1. Done finish: `markDone` has no caller and the sweep is a 2 px line, so no Before/After wipe + solid ring (hero, done, copy, history) - `artboard-activity-overlay.tsx:156-160`, `runs-store.js:94`.
2. Needs-you rings and "Waiting for you" tags still cover every artboard for a question / permission (`runs-model.js` `ringsFor`; the fix is claimed but the shots still show 4 tags), no point ring.
3. Copy built from the tool call, not the work: file-name titles, `Edit`, one fixed failure cause + "Try again" (`needs-you.js:23-31,96-102,214-226`).
4. Artboard names come only from `.meta.json` (chip `post`, menu without Choose artboards... ) and chat titles leak the attachment header (`use-ai-scope.js`, `acp/transcript.ts:318-323`).
5. Pinned / full-height layout: pinned column overflows the window, no 420 width, no canvas re-fit, no jump pill / resize tip / day divider.
6. v1 chrome left around the panel: the "AI is editing this canvas" banner (`apps/studio/ai-banner.tsx`), native selects in Advanced, slash menu accent names, 4-tab history stacked with the chat.
7. Not driven / no fixture: suggestion strips (need open comments), consent card, attach chips, run-list popover, copy caption, Retry on hover - several need harness additions, a few are product gaps (copy caption, Retry).
8. A11y not touched: menu-row focus fill (A1), slash combobox wiring (A3), Waiting live text (A4), connect sheet focus (ai-not-ready), history tab contrast (A6).
