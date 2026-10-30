# critic-bar4 — 01 Create Flow — verified-bar re-evaluation on the D6 shots (merged tip 3d58f57df)

Read-only. Every id judged fresh from the D6 pairs (light + dark opened for each id called verified) and the D6 raw impl frames (1600 x 1000) against the board `.design/ui/v2/01 Create Flow.tsx`. Lead decisions honoured: owning board wins (Home shelves = 11, empty-state "New artboard" = 05, size picker / kind chips / Artboard card order = 08, inspector cards = 14, AI chat + folded spark dot = 03), `v2-p8-c4-toast-dock-or-top` (app-state notices at the TOP), `v2-S6.16b` + `v2-S6.16-slide-left-overdrawn` (Canvases folds on Inspector arrival; the camera never slides: I1), a pick with the AI chat open is the ask scope (no Inspector), `v2-p8-c7-duplicate-width-below`, `v2-p8-c7-search-hits-stay-collapsed`, contract word "Advanced" over the board's "Show details", `v2-p8-c8-zen-toolbar-decorative`, `v2-p8-c8-repair-chip-in-ai-panel`, `v2-p8-c8-first-run-card-once`. A state that needs an AI run, a hub or a second person = UNREACHABLE.

## Per id
- cf-home-prompt · VERIFIED (light + dark) · none (shelves follow 11; chips / faces / thumbs / missing tab strip = fixture)
- cf-ai-drafting · UNREACHABLE · the mid-run frame depends on the AI run's plan: faint "Mobile — next" ghost, status "AI is drawing Tablet · Desktop done · Mobile next", Desktop finished and marked while Tablet draws (the stub run keeps Desktop's in-page "AI is working" tag + dashed holds). Everything the canvas can know matches (Tablet pill + dashed ring, Stop, Whole canvas chip, zoom-to-fit); verify the rest in e2e with a real run
- cf-ai-done · VERIFIED (light + dark) · none (finish moment = panel folded, "Done … Undo" toast above the toolbar, "Made by AI" marks, 3 artboards; the settled frame with the open chat is a side row)
- cf-select-tweak · VERIFIED (light + dark) · none (artboard selected, Canvases folded, Inspector artboard card arrives = 08's card: Width / Height / Layout / Fill / Other widths / Export; AI chat not drawn because chat-open means ask scope by decision)
- cf-sticky-comment · VERIFIED (light + dark) · none (Preview + Sticky armed, colour row, two filled stickies, Canvases kept, Comments closed; Tereza's bubble = side row)
- cf-undo-before · VERIFIED (light + dark) · none (dark hero, AI thread with Undo / Keep going, no stale toast)
- cf-undo-ai · VERIFIED (light + dark) · none ("Undone — Try a dark hero · Redo" toast with the undo glyph, hero back to light)
- cf-blank · VERIFIED (light + dark) · none (empty canvas lifted from the DS specimen, Ask AI + New artboard, pill / panel / cluster / zoom / toolbar / spark; Frame tooltip = side row)
- cf-add-artboard · VERIFIED (light + dark) · none (state AFTER the pick: new Laptop 1280 x 800 artboard drawn + selected, Inspector card with the preset control, F tool; the open preset list is 08's picker = side row; name "Laptop" vs "Artboard 4" = polish)
- cf-duplicate-width · VERIFIED (light + dark) · none (menu rows + Laptop / Tablet / Mobile / Custom width… submenu, Copy / Paste)
- cf-duplicate-done · VERIFIED (light + dark) · none (copy under the source, left edges aligned, dashed shared edge, gap pill, copy-glyph toast "Duplicated at Laptop — 1280 wide. Undo")
- cf-frames-text · VERIFIED (light + dark) · none (Layers open, in-place text edit, text card is 14's; no nested "Hero copy · frame" tags because the fixture page is flat)
- cf-big-tree · VERIFIED (light + dark) · none (opens the last canvas, Recent block "1 h ago", folders with counts, sort control; one-vs-three Recent rows = fixture; stray What's-new toast = fresh-HOME state)
- cf-panel-search · DIFFERS · (1) the search field shows TWO clear controls in light and dark: the browser's native search cancel (blue x) plus Maude's x. Extra control the board does not draw, and the native one is also present in WKWebView; hide `::-webkit-search-cancel-button` on the Canvases panel search input (only `home.css` does it today). Rest matches: flat list, one row per canvas, quoted artboard, highlight, "16 results · ⌘K searches every project" foot
- cf-search-k · VERIFIED (light + dark) · none (cover tiles, meta column, Ask AI pinned and no longer clipping the next group header, 17 results foot)
- cf-open-big · DIFFERS · (1) with the panels hidden the Share button still shows beside the panels button; the board's zen cluster is the panels button alone (CSS rule `.st-share[data-zen] > :not(…)` does not reach it, light + dark); (2) the top "Panels hidden…" notice is not centred (centre at ~40 % of the width, the board centres it): it keeps a stale right inset (~356 px) after the panels are gone. Fixed and fine: pill folded to the mark, toolbar folded to the pointer glyph, "Zoom to fit · 44 %", notice at the top
- cf-busy · UNREACHABLE · presence, two AI chats, a second person
- cf-status-words · UNREACHABLE · only the "Local project" row is reachable (matches the board row); Saved / Syncing… / Offline — kept on this Mac need a hub
- cf-render-error · DIFFERS · (1) the AI island with the "Ask AI to fix it" chip is not on the shot (chat folded, only the spark corner): the repair chip (fix-c8, `repair-offer.js`) cannot be confirmed; re-shoot with the AI panel open while the card shows. Everything else matches: dimmed last-good canvas, one verb "Go back to <time>", plain sentence, technical part folded under Advanced
- cf-offline-create · UNREACHABLE · needs a hub link going offline: the "Offline — kept on this Mac" word and the queued-prompt card ("Queued — sends when this Mac is online") are not reachable; the amber "AI is back when this Mac is online." line and the empty-state art are present

## Polish list
- all · quiet folder glyph on "+ New canvas", kind-chips row, "e2e-fixture · N canvases" header, blank / black row thumbs, "Local project" + own face "M", second "New artboard" button, inspector rail icon top right (decisions / fixture)
- cf-ai-done · red dot on the folded spark (03 defines the dot as "working"); toast "are updated" vs "are on the canvas" (run copy); camera 36 % vs 28 %
- cf-select-tweak · AI chat island not drawn (ask-scope decision); card rows are 08's (no Corners / Clip rows in the open card, Advanced "1 property"); Mobile sits behind the card (camera never slides, I1); size 1440 x 996 vs 1280 x 900 (fixture)
- cf-sticky-comment · colour row reads five dots + "+5" (15/04 owns the paper count); second sticky is yellow not green, no tilt; a selected sticky shows its own format bar; stickies small at 36 %; "Previewing … esc to edit" banner
- cf-undo-before / cf-undo-ai · camera 39 %, chat shows Undo / Keep going row and "Same on Tablet / A darker shade" chips; "Made by AI" marks stay on boards the board draws unmarked; toast label "Try a dark hero" vs "the dark hero by AI"
- cf-add-artboard · left panel stays open on Layers (session state); artboard named "Laptop", board "Artboard 4"; "Empty artboard" DS card inside the new board (05)
- cf-duplicate-width / -done · left panel on Layers, inspector open behind the menu; copy name "Desktop (1280px)" vs "Desktop — Laptop"; height 996 vs 900; "Zoom to fit · 29 %" readout; "Made by AI" mark moves below an artboard
- cf-frames-text · camera 36 % vs 56 %; flat fixture page; no frame tags
- cf-big-tree / cf-panel-search · stray "What's new" notice at the BOTTOM on a fresh HOME (app-state notices belong at the top by decision; only the fresh test HOME shows it); one Recent row vs three; folder name inline instead of a second line; tab strip not in the harness crop
- cf-search-k · query "camp" vs "letak"; Ask AI hint copy; no Tools group for this query; rows 10+ show the page glyph (no cover yet)
- cf-open-big · artboard labels plain titles vs "kind · name"; 21-artboard fixture is a 3-column stack
- cf-render-error · "Last good version" sits as a line inside the card where the board draws a pill top-left of the canvas; icon beside the title instead of above; Go back has no history glyph; card width ±4 px
- cf-ai-drafting (for e2e) · all run-plan items above

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
