# critic-bar5: 03 AI Chat vs the "verified" bar, judged on the D7 pairs (merged tip 98ed9c011, Chrome on the Mac mini)

Every id read fresh from the D7 impl frames (`.scr/d7/03-ai-chat`) against the spec frame, BOTH themes. critic-bar4 used only as a checklist. Lead decisions honoured: neutral "AI is working" tags (DDR-054), group tag "Waiting for you · N artboards", contract over board, Connect modal without an API-key row, "Always allowed on this canvas / Reset" and "Images, video and voice" not built, finish moment (ring + Before/After wipe) is one 1.8 s moment and settles into the "Made by AI" label, panel-closed toast Show for scoped asks, answered-turn strip wording, Named tab kept, inspector per 14, Advanced "kept open" pin per 06, "Syncing/Saved" vs "Local project" = fixture, left Canvases panel open = harness, empty chat-list / permission thumbnail tiles = thumbnail service (fixture).

## Per id
- ai-hero · verified (both) · none. Folder-consent card, folder + PDF + photo chips, Done reply, follow-ups all present; ring + wipe is the finish-moment side row; "Tereza's AI" tag is the second-person side row (own run reads "AI is working").
- ai-open · verified (both) · none
- ai-suggest · verified (both) · none (main = "3 comments are open" frame; the other three strips are side rows)
- ai-scope · verified (both) · none (nothing-selected frame + menu rows + check match)
- ai-working · verified (both) · none
- ai-done · verified (dark) · light shot: the settled "Made by AI" label under Post 1:1 is missing (dark has it; hero-light / panel-closed-light prove the product draws it). Greener headline shows, so the run did land. Capture gap or a real race of the label vs theme: re-shoot light, or prove the label settles in light.
- ai-attach · verified (both) · none (drop veil leaves composer + chips visible)
- ai-attach-menu · verified (both) · none
- ai-question · differs · the spark ring on the date line + "9 pt" chip (board's whole point: "AI points at the spot it means") is not in either frame; product has `editing/ai-point-ring.tsx` and c7 claimed it, but the D7 frame shows Post 1:1 selected and no ring. Needs a frame with the element picked and the ring up (or a fix if the ring never fires on an answer). The answer strip ("Make that change / Check the other artboards too") and closed Ask card are right now; the dark/light AA fail of bar4 is gone.
- ai-long · differs · (1) the canvas inspector toggle (top-right float, 1406,86) sits on top of the tall panel's header and hides the "Hide the AI chat panel" chevron, both themes (pinned and chat-list panels are clear); (2) dark shot has no "What AI did · 6 steps · 41 s" fold under Undo / Compare (light has it). Before/After pair, sent-thumbnail strip, day divider, Jump to latest, prefilled long prompt + footage chip are all there now.
- ai-long-pinned · differs · the six-thumbnail strip under "Six shots picked ..." is not built (c10 named it open); header, pin pressed state, running row, Done card with Undo / Compare, attach rows, "What AI did" fold all match.
- ai-two-artboards · verified (both) · none
- ai-same-artboard · verified (both) · none
- ai-copy · verified (both) · none ("Post 1:1 · copy" chip, Undo / Keep the copy, "Ran on a copy" note, "Copied from Post 1:1" caption + dashed link)
- ai-queue-rule · unreachable · drawn rule
- ai-other-tab · unreachable · second project tab
- ai-tereza · unreachable · second person / hub
- ai-chat-list · verified (both) · none (header "+", Running / Earlier by canvas, "N more", footer count, canvas covers drawn as boxes)
- ai-panel-closed · verified (both) · none (spark with busy dot, toast + Show, "Made by AI" clear of the size chip)
- ai-quit · verified (both) · none
- ai-needs-hidden · verified (both) · none
- ai-needs-tab · unreachable · second shell tab
- ai-needs-away · unreachable · OS notification + Dock badge
- ai-permission · verified (both) · none ("will change" chips, one dashed group box, tag "Waiting for you · 4 artboards", question card with Always for this canvas)
- ai-choice-fail · verified (both) · none (failure card + Pick another clip is the main frame; "Which green?" card is a side row)
- ai-not-ready · verified (both) · none (Connect modal per lead decision)
- ai-advanced · verified (both) · none (Done chat + Advanced open: model/effort/fast/ask-before/show/suggestions, AI may, persona, context + limit meters, Raw log / Copy transcript / Open in terminal)
- ai-adv-edges · verified (both) · none (main = slash-menu frame, 4 rows + "More... 27 more"; the other three frames are side rows)
- ai-history · verified (both) · none ("Undo this chat" now beside Restore this version, Stop comparing / Restore only ..., Compare pair, Side by side / Overlay, change list)

## Polish list
- ai-hero · "✦ 1" run count + pin-to-side icon in the header although the board's kit header draws only + and the chevron (pin is always present, count shows while a run is live); chips order PDF then folder (board folder then PDF); composer text cut differently
- ai-open · chips "Resolve 3 comments / Reply to the comments / List what changed" vs the board's second chip set; pin icon in header; one stacked pin on Post 1:1; field not prefilled
- ai-suggest · lead chip has a comment icon, not the "T" avatar; "Reply to the comments" vs "Reply to Tereza" (fixture)
- ai-scope · tiny superscript glyph by the chip
- ai-working · "Syncing..." status word absent; Post not drafted green
- ai-done · "Same on Web / A darker shade" vs "Same on Story 9:16 / A darker green" (agent follow-up fixture)
- ai-attach · "+1" OS drag image; veil is a short strip without the drop icon (panel is short; composer stays visible); a hint-text "A" peeks left of the veil; scope chip "Whole canvas" vs "16:9 · teaser"; prefilled field text
- ai-attach-menu · no hover row on "Choose a folder..."
- ai-question · A4 under the dock/toolbar with an extra "AI is working" tag from the harness's hung next ask; chat title "Is the A4 poster readabl..." vs "Is the poster readable?"
- ai-long · board's second divider "Today, 09:12" reads a clock time of the shot; "Jump to latest" without the "2 new" count
- ai-long-pinned · the second divider; left Canvases panel open; top-right chrome overlays the pinned column instead of shifting left of it
- ai-same-artboard · "about a minute" estimate not drawn
- ai-copy · "Ran on a copy" note sits under the reply (board: above); follow-up chips fixture
- ai-chat-list · cover squares empty (thumbnail service), counts and the second Needs-you row fixture; inspector toggle floats over the panel's top-right corner (clear of every control)
- ai-panel-closed · working artboard's "AI is working" tag sits on the toolbar edge (harness fit puts A4 under the dock); working artboard is A4 not Story
- ai-quit · centered modal vs inset illustration; veil strength; a stray "/" in the composer behind the veil
- ai-permission · thumbnail strip tiles empty; group tag and two "will change" chips clipped by the viewport foot / under the dock (harness fit at 90 %); canvas arrangement vs the board's two clean rows
- ai-choice-fail · title "Cut the hype reel to 15 s from ..." vs "Hype reel, 15 s"; scope chip Post 1:1 vs Reels 9:16
- ai-not-ready · veil darker than the board's; no "Advanced / Use an API key instead" row (lead decision)
- ai-advanced · "kept open" chip beside Advanced (06 pin); "Folders AI may read" None vs 1 (fixture); "Always allowed ... Reset" and "Images, video and voice" groups not built (lead decision); session id / reset time fixture
- ai-adv-edges · slash rows inline name + description vs two columns; typed "/" vs "/des"; pasted-screenshot chip not in the field
- ai-history · "A / B" row labels vs "Before / After"; Named tab kept; change list under the compare; buttons stacked vs inline; fixture change text (text colour only)
- all · left Canvases panel open, "Local project" vs "Saved", flat Canvases list, 17 pt vs 9 pt, photo/title fixtures

## Side states
- ai-hero/finish-moment · solid ring + Before/After wipe on Post 1:1 · reachable, timing-gated (light shot caught the Before/After pills mid-moment)
- ai-hero/tereza-ai-tag · "Tereza's AI - translating to English" on A4 · unreachable (second person)
- ai-suggest/clips-selected · "Cut a 15 s video from these" strip · reachable, not shot
- ai-suggest/shared-canvas · strip after sharing · reachable, not shot
- ai-suggest/last-ask · "Same for the story" strip · reachable, not shot
- ai-scope/folded · spark + "Ask AI Cmd+/" key tip · reachable, not shot
- ai-scope/one-artboard · Post 1:1 chip · reachable, not shot
- ai-scope/several-artboards · "3 artboards" chip · reachable, not shot
- ai-done/finish-moment · ring + Before/After wipe before the label settles (1.8 s) · reachable, timing-gated, not shot
- ai-attach-menu/chip-kinds · photo / footage / file / folder / screenshot chips · reachable (hero + attach frames show photo, footage, PDF, folder)
- ai-attach-menu/folder-consent · consent card for a folder · reachable, shot (ai-hero)
- ai-choice-fail/which-green · "Which green?" choice card · reachable, shot (ai-choice-q); rows lack the sub-lines and colour dots (agent text, polish)
- ai-not-ready/queued-offline · "Queued - sends when this Mac is online" · unreachable in browser lane
- ai-not-ready/setting-up · "Setting up AI on this Mac" · unreachable
- ai-not-ready/allowance-used · allowance used up until 18:40 · unreachable (usage state)
- ai-not-ready/almost-used · 90 % meter + drawing row · unreachable
- ai-advanced/slash-menu · /design:cr filtered list · reachable, shot (ai-adv-edges)
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
