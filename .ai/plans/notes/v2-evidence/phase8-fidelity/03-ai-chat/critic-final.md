# critic-final: 03 AI Chat, stage D2 (merged tip d3881fe41)

One critic, four lenses. Every reachable id judged fresh from the D2 pairs (dark read for all 24; light read for ai-quit, the only candidate match, plus ai-hero/ai-open spot checks). A differs verdict needs one theme; light flips the same tokens.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ai-hero | both | differs | design/signature: no Before/After wipe + solid ring settled on Post (1.8 s transient; the Before/After labels show only in a mid-wipe still), A4 still "AI is working" in a finished frame; extra "What AI did" fold + follow-ups with "Because..." line; consent card ("Let AI read ...") and attach chips absent; panel not full-height, no Inspector context |
| ai-open | both | differs | no suggestion strip / lead-chip glyph; empty "Ask AI..." instead of prefilled/strip state; left panel / Inspector card context absent; a11y: cmd-slash opens ask bar not panel field |
| ai-suggest | both | differs (cannot confirm) | only empty state shot; none of the 4 strips (comments, clips, shared, last ask) on screen |
| ai-scope | both | differs | menu clipped by the chat card (only "Choose artboards..." / "No canvas - just ask"; "Whole canvas" + "Post 1:1 - Combine 2026" rows hidden), folded + several-artboards cases not driven |
| ai-working | both | differs | step line raw tool wording vs board's "AI is making it greener / Background done - badge next" (decision neutral tags: tag stays "AI is working"); no drafted-green Post in frame |
| ai-done | both | differs | no solid ring + wipe on Post (Made-by-AI tag only), A4 "AI is working" left in a done frame; extra "What AI did" fold; follow-ups + why line below result; Undo / Keep going pill shape |
| ai-attach | both | differs | no "Drop to attach" overlay, no footage/PDF chips with thumbnails; image chip is a blue sliver in the field; empty state instead of attached composer |
| ai-attach-menu | both | differs | no pressed fill on paperclip; menu detached with gap; no consent card / chip-kinds inset; menu rows otherwise correct |
| ai-question | both | differs | board: answered question, 9 pt point ring on poster, follow-up chips; impl shows a different state (waiting card "Waiting for Translate the poster..." on A4, chips + why line); tags "AI is working . 1 waiting" |
| ai-long | both | differs | no day divider, sent thumbnails, Before/After result, "Jump to latest" pill, resize tooltip; feed is a wall of identical replies; follow-up strip under it; panel not full height, canvas not re-fit |
| ai-long-pinned | both | differs | pinned column overruns the window edge, covers artboards and the header icons; canvas does not re-fit (fix-c3-ai Open: needs fit-all dgn); no unpin tooltip |
| ai-two-artboards | both | differs | run-list popover ("N") not driven; run line wording not the board's; both tags "AI is working" (decided), A4 selected + Inspector open; Post/A4 chats are harness chats in one list not the board's two-row popover |
| ai-same-artboard | both | differs | waiting card layout matches but holder name is the harness prompt ("Translate the poster to English, keep the layout") and no "about a minute"; Story cut by Inspector; a11y A4 not claimed fixed |
| ai-copy | both | differs | no "Copied from Post 1:1 before ..." caption + dashed link; copy lands under original with colliding label; no Undo / Keep the copy result row; every artboard ringed + "AI is working" |
| ai-queue-rule | - | unreachable | documentation graphic (a drawn timeline rule), no app surface |
| ai-other-tab | - | unreachable | needs a second desktop shell tab with a running chat (desktop e2e lane) |
| ai-tereza | - | unreachable | needs a second person's AI on a hub project |
| ai-chat-list | both | differs | list shows only Running group + clipped Earlier header; no canvas groups / search results / row menu driven; left panel scrolled over crop; "Poster" label is harness |
| ai-panel-closed | both | differs | working artboard is A4 "AI is working" not Story "AI is making the date bigger"; done pill toast ("Done - Post 1:1 is greener ... Show") still not in frame; no breathing halo; Inspector open |
| ai-quit | both | **match** | none. Dialog 24 px padding, radius-xl, bg-2, same title/body/Cancel+Quit words, focus ring on Quit; both themes. Warning only: board's "next launch" inset (Stopped divider + half-done result) not driven |
| ai-needs-hidden | both | differs | toast still has an x and reads "AI needs you on Combine-kampan - change Combine-kampan?" (board: one-line pill "...Uniformy-2027 - replace 4 team photos?" + Open, no x); different canvas under it |
| ai-needs-tab | - | unreachable | needs a second desktop shell tab |
| ai-needs-away | - | unreachable | native OS notification + Dock badge (desktop e2e) |
| ai-permission | both | differs | card names the work ("Change Combine-kampan?") but no thumbnail strip, no "Always for this canvas", no "will change" pills / "Waiting for you" tag; shot is not Uniformy-2027 with the 4 affected artboards; left canvases panel open |
| ai-choice-fail | both | differs | failure names a generic cause ("connection to Claude was interrupted"), board names the footage file + "Pick another clip" verb; verb still "Try again" with an Advanced fold; "Trying -" ghost line; choice-card half (Which green? swatches) not in the same frame |
| ai-not-ready | both | differs | Connect modal over veil is a lead-accepted departure; but the board's "Advanced / Use an API key instead" row is missing (RESTS by DDR-123) and the four other not-ready panels (offline, setting up, used up, almost used up) are not reachable |
| ai-advanced | both | differs | v1 chrome: native selects with cut value ("Replace or move to the t..."), "default" on its own line; Model / Effort / Fast mode / AI may / agent persona / images-voice / meters absent; image-chip sliver in field; slash + Raw-log search frames not shown |
| ai-adv-edges | both | differs | only a slash prefix typed (one row visible), no menu of names; no ask-before list, Suggest-only banner, Copy+Retry hover, or terminal-continued inset driven |
| ai-history | both | differs | Version history stacked above the AI chat (board: alone at 320 px); 4 tabs (board 3; CONTRACT keeps Named); no Made-by-AI row actions ("Undo this chat" / Restore) or Compare bar, no before/after canvas |

## Root causes still open

1. Finish moment: the settled frame has only the "Made by AI" label; the board's wipe + solid ring is a 1.8 s transient, and A4 keeps a dashed ring / "AI is working" in done frames (fixture hold).
2. Harness/fixtures: run titles, holder names and progress copy are harness text, not the board's work words (working, two-artboards, same-artboard, copy, choice-fail).
3. Surfaces not driven or not built: suggestion strips, consent card, attach chips + drop overlay, run-list popover, copy caption + dashed link, Copy/Retry on hover, Made-by-AI row actions + Compare, done toast not visible in panel-closed.
4. Pinned / long layout: pinned column overruns the window and canvas does not re-fit (needs fit-all dgn, shared files); no jump pill / resize tip / day divider.
5. The scope menu is clipped by the chat card (app defect, only the last two rows visible); attach menu detached from the field.
6. Copy: failure verb "Try again" + generic cause; needs-you toast two lines with x on a different canvas; permission card has no thumbnails / "Always for this canvas".
7. v1 chrome in Advanced (native selects, cut values, missing Model / Effort / meters) and 4-tab history stacked with the chat.
8. Connect: no "Use an API key" row; other not-ready states unreachable.
