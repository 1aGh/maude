# critic-bar3: 03 AI Chat vs the "verified" bar, judged on the D5 pairs (merged tip e37e7d82a, Chrome 156)

Every id read fresh from the D5 pair, both themes for every id called verified (full-size D5 frames opened where borderline). Lead decisions honoured: neutral "AI is working" tags (DDR-054), contract over board, Connect modal without an API-key row, Always-allowed row not built (no store), Images/video/voice group not built, "before <busy chat's title>" half of the copy caption not drawn, panel-closed toast Show for scoped asks, inspector per 14, Named tab kept. Left Canvases panel left open by the harness, "Local project" vs "Saved/Syncing...", flat vs tree Canvases list, fixture chat titles and photos are POLISH/FIXTURE, not MUST.

## Per id
- ai-hero · differs · folder-consent card ("Let AI read ... folder?") + attached chips absent from the finish frame (reachable, not shot); no wipe divider (fake agent paints nothing) 
- ai-open · verified (both) · none (chip wording, empty vs prefilled field, 1 stacked pin vs 3 = polish)
- ai-suggest · verified (both) · none (the other 3 cases are side rows)
- ai-scope · verified (both) · none (nothing selected = "Whole canvas", menu rows + check match)
- ai-working · differs · stale attached footage leaks in (clip row, "Watching 1 clip... 0 done" step, tag "AI is watching footage" instead of the plain working tag); Post not drafted; Running status chip absent (fixture)
- ai-done · verified light only · dark shot caught the "Done - ..." bubble mid-fade (text near-invisible, fails AA in that frame); light is clean: Before/After chips, solid ring, "Made by AI", Undo / Keep going / follow-ups. Re-shoot dark after the fade to promote.
- ai-attach · differs · drop overlay swallows the whole panel: composer, PDF/footage chips and the "+1" drag chip not visible; scope chip hidden
- ai-attach-menu · verified (both) · none (4 rows + "Or drag files here" + ⌘V match; no hover row = polish)
- ai-question · differs · Undo / Keep going chips and "Made by AI" on a no-change answer (board: question-specific follow-ups, quiet canvas); Ask card left open over the A4; panel title truncated
- ai-long · differs · no sent-thumbnail strip, no Before/After pair + Undo/Compare row, no "What AI did" fold, composer not prefilled with the long recap prompt; plain Q/A feed (day divider + Jump to latest now present)
- ai-long-pinned · differs · chat is a Q/A fixture: no running row ("AI is cutting the recap" + Stop), no Done card with Undo/Compare, no attach rows; pin placement/header ok
- ai-two-artboards · differs · run-list popover has two Working rows but no "All chats" row and it overlaps the panel body; Post tag reads "watching footage" (leaked attachment); A4 selected, results not drafted
- ai-same-artboard · verified (both) · none ("about a minute" estimate missing, Post not drafted green, holder name = harness prompt = polish)
- ai-copy · differs · done state of the copy lacks the copy-specific controls ("Undo", "Keep the copy") and the "Ran on a copy" note; original still wears "AI is working" (first harness chat hangs), copy not selected
- ai-queue-rule · unreachable · drawn rule
- ai-other-tab · unreachable · second project tab
- ai-tereza · unreachable · second person / hub
- ai-chat-list · differs · header has no "+" (new chat) - confirmed in ChatList.jsx (header = back, "Chats", project chip only); canvas-group cover squares render empty; no Needs-you running row (fixture state)
- ai-panel-closed · differs · the working artboard's tag sits under the dock (A4) and is invisible, no halo shown; Post's "Made by AI" label collides with the "1080 x 1080" size chip (text overlap)
- ai-quit · verified (both) · none
- ai-needs-hidden · verified (both) · none (Uniformy-2027 toast + Open, Needs-you row, spark badge all present)
- ai-needs-tab · unreachable · second shell tab
- ai-needs-away · unreachable · OS notification + Dock badge
- ai-permission · differs · four ringed artboards have no "will change" chips and no single group tag "Waiting for you - Replace 4 photos?" (each carries its own plain "Waiting for you"); thumbnail strip draws four empty tiles (fixture covers)
- ai-choice-fail · verified (both) · none ("Which green?" card is a side row)
- ai-not-ready · verified (both) · none (Connect modal main frame; the four other not-ready panels are side rows)
- ai-advanced · differs · bottom half not in the shot (From the agent persona, This chat: context + limit meters, Raw log / Copy transcript / Open in terminal); frame is a New chat, not the Done chat with Undo / Keep going above Advanced; visible rows/order match the board
- ai-adv-edges · differs · slash menu clipped to a single row ("/design:export") + "More... 27 more" inside a short card (board: three rows); screenshot chip in field absent; the other three frames are side rows
- ai-history · differs · selected row's compare view not drawn: no Before/After canvas pair, no Side by side / Overlay bar, no "3 changes" chip; "Viewing ... Back to now" banner instead (list, tabs, Undo this chat, Restore ok)

## Polish list
- ai-open · chips read "Resolve 3 comments / Reply to the comments / List what changed" + "Because 3 comments are open" (matches ai-suggest's own board; ai-open board differs); field not prefilled; one stacked pin; scope chip x
- ai-suggest · lead chip has no "T" avatar; "Reply to the comments" vs "Reply to Tereza" (fixture)
- ai-scope · small superscript glyph by the chip; menu sits above the field, fully visible
- ai-done · dark bubble mid-fade (capture timing); "A darker shade" vs "A darker green" (agent follow-up fixture)
- ai-quit · centered modal vs inset illustration; veil strength
- ai-attach-menu · no hover/focus on "Choose a folder..." row
- ai-not-ready · veil much darker than the board's
- ai-choice-fail · title "Cut the hype reel to 15 s from ..." vs "Hype reel, 15 s"; scope chip Post 1:1 vs Reels 9:16 (fixture)
- ai-same-artboard · "about a minute" estimate not drawn (no source for it); holder prompt full text
- ai-advanced · "kept open" chip beside Advanced
- ai-history · Named tab kept by CONTRACT
- all · left Canvases panel left open by the harness, "Local project" vs "Saved", flat Canvases list, 17 pt vs 9 pt chip, photo/title fixtures

## Side states
- ai-hero/folder-consent · "Let AI read ... folder?" card + chips · reachable (attach a folder), not shot
- ai-hero/tereza-ai-tag · "Tereza's AI - translating to English" on A4 · unreachable (second person)
- ai-suggest/clips-selected · "Cut a 15 s video from these" strip · reachable, not shot
- ai-suggest/shared-canvas · strip after sharing · reachable, not shot
- ai-suggest/last-ask · "Same for the story" strip · reachable, not shot
- ai-scope/folded · spark + "Ask AI ⌘/" key tip · reachable, not shot
- ai-scope/one-artboard · Post 1:1 chip · reachable, not shot (this frame is nothing-selected)
- ai-scope/several-artboards · "3 artboards" chip · reachable, not shot
- ai-attach-menu/chip-kinds · photo / footage / file / folder / screenshot chips · reachable, not shot
- ai-attach-menu/folder-consent · consent card for a folder · reachable, not shot
- ai-choice-fail/which-green · "Which green?" choice card · reachable (extra-impl-ai-choice-q frame exists), main frame shows the failure
- ai-not-ready/queued-offline · "Queued - sends when this Mac is online" · unreachable in browser lane
- ai-not-ready/setting-up · "Setting up AI on this Mac" · unreachable
- ai-not-ready/allowance-used · "allowance used up until 18:40" · unreachable (usage state)
- ai-not-ready/almost-used · meter · unreachable
- ai-advanced/slash-menu · /design:cr filtered list · reachable, not shot
- ai-advanced/raw-log · tool-call log card · reachable, not shot
- ai-advanced/search-raw-log · palette search "raw" · reachable, not shot
- ai-adv-edges/ask-before-menu · full permission list with mono ids · reachable, not shot
- ai-adv-edges/suggest-only · banner + Allow changes · reachable, not shot
- ai-adv-edges/copy-retry · hover Copy/Retry + terminal-continued inset · reachable, not shot
- ai-chat-list/search-results · "dres" search with highlights · reachable, not shot
- ai-chat-list/row-menu · Open / Rename / Copy transcript / Archive / Move to trash · reachable, not shot
- ai-long/resize-tooltip · "Drag to resize - double-click for full height" · reachable, not shot
- ai-long-pinned/unpin-tooltip · "Unpin - float over the canvas" · reachable, not shot
- ai-quit/next-launch · "Stopped" divider + half-done result · reachable via relaunch, not driven
