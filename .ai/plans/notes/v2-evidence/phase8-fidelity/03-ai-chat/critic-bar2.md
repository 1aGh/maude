# critic-bar2: 03 AI Chat, re-evaluated on D4 shots (merged tip 21c9714cf) against the verified bar

D4 pairs read fresh (dark for all 25 reachable ids, light for ai-hero, ai-open, ai-quit). The D4 frames are visually the same as D3; the D3 differences remain. Lead decisions honoured: contract-over-board, owning-board-wins, neutral "AI is working" tags, Connect modal without an API-key row, 08 owns the web card, undo toast wording.

## Per id
- ai-hero · differs · consent card + attach chips absent; no wipe/solid ring; A4 dashed "AI is working" in a finished frame; extra "What AI did" fold + "Because" line; Inspector open, panel not full-height
- ai-open · differs · no suggestion strip / lead chip / "Because" line, empty field instead of prefilled; left panel + comment pins absent; Inspector open
- ai-suggest · differs · only empty state shown; comments strip not on screen
- ai-scope · differs · menu OK but chip state is Post 1:1 selected (board's main case is nothing-selected "Whole canvas"); chip x floats
- ai-working · differs · panel title "New chat" not "Make it greener"; Post not green/no drafted result; Inspector open; canvas not re-fit
- ai-done · differs · no solid ring on Post; A4 dashed + "AI is working" in a done frame; extra "What AI did" + "Because" block; Inspector open
- ai-attach · differs · no footage chip with "+1"; PDF chip lacks thumbnail; image chip is a blue sliver; drop overlay shown as empty-state card, composer not attached; scope chip text wrong
- ai-attach-menu · differs · menu rows right but paperclip not pressed, "Choose a folder" row not focus-highlighted
- ai-question · differs · no point ring + "9 pt" chip; follow-ups generic, "Because" line truncated; title truncated; Post "Made by AI" / A4 "AI is working" in a quiet-canvas frame; Inspector open
- ai-long · differs · no day divider, sent thumbnails, Before/After pair, "Jump to latest"; plain Q/A feed; panel not full-height, canvas not re-fit
- ai-long-pinned · differs · shows Q/A fixture not recap run (no running row, no pin tooltip); left panel open; wrong artboards; header displaced
- ai-two-artboards · differs · run-list popover not driven (side) but main frame: panel title "New chat"/clipped prompt, Post not green, A4 selected with Inspector
- ai-same-artboard · differs · holder name is harness prompt not "Make it greener", no "about a minute", waiting tag on A4 not Post, panel title wrong
- ai-copy · differs · no "Copied from ..." caption + dashed link, no "Post 1:1 - copy" label, no Undo/Keep row; copy collides with original; all artboards "AI is working"
- ai-queue-rule · unreachable · drawn rule
- ai-other-tab · unreachable · second project tab
- ai-tereza · unreachable · second person / hub
- ai-chat-list · differs · no canvas groups with thumbnails / "N more", footer count text differs, truncated titles; search + row menu are side states
- ai-panel-closed · differs · done toast ("Done - Post 1:1 is greener. The logo stays white. Show") is wrong word/placement (reads "Undo", board "Show"), A4 "AI is working" instead of Story "making the date bigger", no halo, Post selected + Inspector
- ai-quit · verified (both themes) · none
- ai-needs-hidden · differs · toast copy/canvas wrong (Combine-kampan, "AI needs you on Combine-kampan - replace 4 team photos?" vs Uniformy-2027), no Needs-you row; dock badge ok
- ai-needs-tab · unreachable · second shell tab
- ai-needs-away · unreachable · OS notification + Dock badge
- ai-permission · differs · not the Uniformy-2027 canvas, no four ringed artboards / thumbnail strip; headline/verb "Replace 4 photos" vs impl wording, tag lacks "- Replace 4 photos?"; Inspector open
- ai-choice-fail · differs · failure half matches; main "Which green?" card is a separate board frame not in this shot; title/chip text differ (Post 1:1 vs Reels 9:16)
- ai-not-ready · differs · Connect modal accepted; the board's four other not-ready panels not in frame; panel behind veil too dim
- ai-advanced · differs · "AI may" toggle group, Always-allowed + Reset, persona, Images/video/voice group, meter bars absent or text; "Ask before" above Model
- ai-adv-edges · differs · only slash menu with one row + "More... 27 more"; no ask-before list, no Suggest-only banner, no Continued-from-terminal inset, no Copy/Retry row
- ai-history · differs · Version history stacked above chat, 4 tabs vs 3 (CONTRACT keeps Named: not a blocker), no Undo-this-chat / Restore actions, no Compare bar / Side-by-side toggle, rows truncated, no Before/After artboard pair

## Polish list
- ai-quit · centered modal vs board's inset placement over the canvas (board inset is illustration)
- ai-attach-menu · "Or drag files here" glyph differs
- ai-chat-list · "Poster" suffix and truncated titles are harness
- ai-advanced · "kept open" chip next to Advanced (impl extra, acceptable)
- ai-history · Named tab kept by CONTRACT (board shows 3 tabs)
- ai-not-ready · veil dimmer than board's

## Side states
- ai-suggest/clips-selected · "Cut a 15 s video from these" strip · reachable (select clips) but not shot
- ai-suggest/shared-canvas · strip after sharing · reachable, not shot
- ai-suggest/last-ask · "Same for the story" strip · reachable, not shot
- ai-scope/folded · spark with Ask AI key tip · reachable, not shot
- ai-scope/several-artboards · "3 artboards" chip · reachable, not shot
- ai-scope/one-artboard · Post 1:1 chip · reachable (this is the shot's chip state)
- ai-attach-menu/chip-kinds · photo / footage / file / folder / screenshot chips · reachable, not shot
- ai-attach-menu/folder-consent · "Let AI read ... folder?" card · reachable (shown in ai-hero), not in this frame
- ai-choice-fail/which-green · choice card (Club green / Lighter / Darker / Something else) · needs an AI run; extra frame only
- ai-not-ready/queued-offline · "Queued - sends when this Mac is online" · unreachable in browser lane
- ai-not-ready/setting-up · "Setting up AI on this Mac" · unreachable
- ai-not-ready/allowance-used · "allowance used up until 18:40" · unreachable (needs usage state)
- ai-not-ready/almost-used · meter · unreachable
- ai-advanced/slash-menu · /design:cr filtered list · reachable, not shot
- ai-advanced/raw-log · tool-call log card · reachable, not shot
- ai-advanced/search-raw-log · palette search "raw" · reachable, not shot
- ai-adv-edges/ask-before-menu · full permission list with mono ids · reachable, not shot
- ai-adv-edges/suggest-only · banner "Allow changes" · reachable, not shot
- ai-adv-edges/slash-with-chip · slash menu + dropped chip · reachable, impl shows a thinner version
- ai-adv-edges/copy-retry · hover row + terminal-continued inset · reachable, not shot
- ai-chat-list/search-results · "dres" search with highlights · reachable, not shot
- ai-chat-list/row-menu · Open / Rename / Copy transcript / Archive / Move to trash · reachable, not shot
- ai-two-artboards/run-list-popover · two Working rows + All chats · reachable, not shot
- ai-long/resize-tooltip · "Drag to resize - double-click for full height" + accent edge · reachable, not shot
- ai-long/jump-to-latest · pill · reachable, not shot
- ai-long-pinned/unpin-tooltip · "Unpin - float over the canvas" · reachable, not shot
- ai-history/compare · Compare bar + Side-by-side/Overlay · reachable, not shot
- ai-quit/next-launch · Stopped divider + half-done result inset · reachable via relaunch, not driven
