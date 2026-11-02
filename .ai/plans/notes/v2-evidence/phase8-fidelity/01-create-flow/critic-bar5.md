# critic-bar5 — 01 Create Flow — verified-bar re-evaluation on the D7 shots (merged tip 98ed9c011)

Read-only. Every id judged fresh from the D7 pairs (`<id>-light.jpg` + `<id>-dark.jpg`, both opened for every id called verified), the D7 raw impl frames (1600 x 1000, cropped where borderline: panel-search clear control, open-big top bar, render-error card + AI panel) and the board `.design/ui/v2/01 Create Flow.tsx`. critic-bar4 was the checklist. Lead decisions honoured: owning board wins (Home shelves = 11, empty-state "New artboard" = 05, size picker / kind chips / Artboard card order = 08, inspector cards = 14, AI chat + folded spark dot = 03), `v2-p8-c4-toast-dock-or-top`, `v2-S6.16b` + `v2-S6.16-slide-left-overdrawn` (the camera never slides: I1), a pick with the AI chat open is the ask scope (no Inspector), `v2-p8-c7-duplicate-width-below`, `v2-p8-c7-search-hits-stay-collapsed`, "Advanced" over the board's "Show details", `v2-p8-c8-zen-toolbar-decorative`, `v2-p8-c8-repair-chip-in-ai-panel`, `v2-p8-c8-first-run-card-once`. A state that needs an AI run, a hub or a second person = UNREACHABLE.

Round 9/10 fixes confirmed on the D7 frames: the panel search now shows ONE clear x (light + dark), the panels-hidden notice is centred on the window, the zen cluster is the panels button alone (no Share), and the render-error shot now has the AI panel open with the "Ask AI to fix it" chip + reason line.

## Per id
- cf-home-prompt · VERIFIED (light + dark) · none (shelves follow 11; chips / faces / thumbs / missing tab strip = fixture)
- cf-ai-drafting · UNREACHABLE · the mid-run frame depends on the AI run's plan (faint "Mobile — next" ghost, status progress words, Desktop marked while Tablet draws); the canvas-side parts match (Tablet pill + ring, Stop, Whole canvas chip, zoom-to-fit). Verify in e2e with a real run
- cf-ai-done · VERIFIED (light + dark) · none (panel folded, "Done … Undo" toast above the toolbar, "Made by AI" marks, 3 artboards; settled frame with the open chat = side row)
- cf-select-tweak · VERIFIED (light + dark) · none (Desktop selected, Canvases folded, Inspector artboard card = 08's card; AI chat not drawn = ask-scope decision)
- cf-sticky-comment · VERIFIED (light + dark) · none (Preview + Sticky armed, colour row, two filled stickies, Canvases kept; Tereza's bubble = side row)
- cf-undo-before · VERIFIED (light + dark) · none (dark hero, AI thread with Undo / Keep going, no stale toast in either theme)
- cf-undo-ai · VERIFIED (light + dark) · none ("Undone — Try a dark hero · Redo" toast with the undo glyph, hero back to light)
- cf-blank · VERIFIED (light + dark) · none (empty canvas from the DS specimen, Ask AI + New artboard (05), pill / panel / cluster / zoom / toolbar / spark; Frame tooltip = side row)
- cf-add-artboard · VERIFIED (light + dark) · none (state AFTER the pick: new Laptop 1280 x 800 board drawn + selected, Inspector card with the preset control, F tool; open preset list = 08's picker = side row)
- cf-duplicate-width · VERIFIED (light + dark) · none (menu rows + Laptop / Tablet / Mobile / Custom width… submenu, Copy / Paste)
- cf-duplicate-done · VERIFIED (light + dark) · none (copy under the source, left edges aligned, dashed shared edge, gap pill, copy-glyph toast "Duplicated at Laptop — 1280 wide. Undo")
- cf-frames-text · VERIFIED (light + dark) · none (Layers open, in-place text edit, text card = 14's; no nested "Hero copy · frame" tags because the fixture page is flat)
- cf-big-tree · VERIFIED (light + dark) · none (opens the last canvas, Recent block "1 h ago", folders with counts, sort control)
- cf-panel-search · VERIFIED (light + dark) · none (single clear x now; flat list, one row per canvas, quoted artboard, highlight, "16 results · ⌘K searches every project" foot)
- cf-search-k · VERIFIED (light + dark) · none (cover tiles, meta column, Ask AI pinned, results foot)
- cf-open-big · VERIFIED (light + dark) · none (pill folded to the mark, toolbar folded to the pointer glyph, cluster = panels button alone, "Zoom to fit · 44 %", centred "Panels hidden. Press ⌘\ to bring them back." at the top)
- cf-busy · UNREACHABLE · presence, two AI chats, a second person
- cf-status-words · UNREACHABLE · only the "Local project" row is reachable (matches the board row); Saved / Syncing… / Offline — kept on this Mac need a hub
- cf-render-error · VERIFIED (light + dark) · none (dimmed last-good canvas, one verb "Go back to <time>", plain sentence, technical part folded under Advanced, and the AI panel now shows the "Ask AI to fix it" chip with its reason)
- cf-offline-create · UNREACHABLE · needs a hub link going offline: the "Offline — kept on this Mac" word and the queued-prompt card ("Queued — sends when this Mac is online") are not reachable; the amber "AI is back when this Mac is online." line and empty-state art are present

## Polish list
- all · quiet folder glyph on "+ New canvas", kind-chips row, "e2e-fixture · N canvases" header, blank / black row thumbs, "Local project" + own face "M", second "New artboard" button, inspector rail icon top right (decisions / fixture)
- cf-ai-done · red dot on the folded spark (03 defines the dot as "working"); toast "are updated" vs "are on the canvas"; camera 36 % vs 28 %
- cf-select-tweak · AI chat island not drawn (ask-scope decision); card rows are 08's (no Corners / Clip rows in the open card, Advanced "1 property"); Mobile sits behind the card (I1); size 1440 x 996 vs 1280 x 900 (fixture)
- cf-sticky-comment · colour row reads five dots + "+5" (15/04 owns the paper count); second sticky yellow not green, no tilt; selected sticky shows its own format bar; stickies small at 36 %; "Previewing … esc to edit" banner
- cf-undo-before / cf-undo-ai · camera 39 %; chat shows Undo / Keep going and "Same on Tablet / A darker shade" chips (AI-written suggestions); "Made by AI" marks on boards the board draws unmarked; toast label "Try a dark hero" vs "the dark hero by AI"
- cf-add-artboard · left panel stays on Layers (session state); artboard named "Laptop", board "Artboard 4"; "Empty artboard" DS card inside the new board (05)
- cf-duplicate-width / -done · left panel on Layers, inspector open behind the menu; copy name "Desktop (1280px)" vs "Desktop — Laptop"; height 996 vs 900; "Zoom to fit · 29 %" readout; "Made by AI" mark moves below an artboard
- cf-frames-text · camera 36 % vs 56 %; flat fixture page; no frame tags
- cf-big-tree / cf-panel-search · "What's new" notice at the BOTTOM on a fresh test HOME; one Recent row vs three; each search row carries a folder tag pill; folder name inline instead of a second line; tab strip not in the harness crop
- cf-search-k · query "camp" vs "letak"; Ask AI hint copy; no Tools group for this query; rows 10+ show the page glyph (no cover yet)
- cf-open-big · panels button reads pressed (blue tint) where the board's is neutral; artboard labels plain titles vs "kind · name"; 21-artboard fixture is a 3-column stack
- cf-render-error · "Last good version" sits as a line inside the card where the board draws a pill top-left of the canvas; icon beside the title instead of above; Go back has no history glyph; card width ±4 px; empty-chat placeholder copy in the AI panel vs "New chat" header
- cf-home-prompt · "Recent projects" shelf is "Projects" + "Shared with you" (Home shelves follow 11)
- cf-ai-drafting (for e2e) · all run-plan items (ghost "Mobile — next", status words, Desktop marked while Tablet draws, extra in-page tag)

## Side states
- cf-blank/frame-tooltip · hover tooltip "Frame F" on the toolbar · reachable (hover), not shot
- cf-home-prompt/target-menu · project chip menu (Studio site / Alligators brand / a new project) · reachable, shot (.target)
- cf-ai-drafting/typed · prompt typed on Home before send · reachable, shot (.typed)
- cf-ai-done/panel-open · chat open with Done row, Undo / Keep going, chips · reachable, shot (settled frame)
- cf-add-artboard/size-picker · the F preset list (08: Web / Social / Print / Video groups) · reachable, shot (.picker)
- cf-duplicate-width/submenu · Duplicate at another width submenu · reachable, shot (.menu)
- cf-big-tree/row-tooltip · full-name tooltip on a long canvas name · reachable (hover), not shot
- cf-sticky-comment/compose-popover · Tereza's comment bubble on "See the work" · unreachable (needs a peer)
- cf-sticky-comment/c-pin · a C-pinned comment on the artboard · reachable, shot (.compose)
- cf-search-k/tools-group · "Tools and settings" rows with "Menu › View › Advanced" locations · reachable (other query), not shot
- cf-render-error/advanced-open · technical part under Advanced · reachable, not shot
- cf-status-words/local · "Local project" word · reachable, shot (matches)
- cf-status-words/saved, /syncing, /offline · other status words · unreachable (hub)
- cf-offline-create/queued-prompt · queued prompt row in the chat · unreachable (offline hub)
