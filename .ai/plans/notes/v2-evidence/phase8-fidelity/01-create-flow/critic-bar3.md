# critic-bar3 — 01 Create Flow — verified-bar re-evaluation on the D5 shots (merged tip e37e7d82a)

Read-only. Judged from the D5 raw frames (impl-raw/01, 1600 x 1000, light + dark opened for every id called verified) against the spec-raw frames and the board `.design/ui/v2/01 Create Flow.tsx`. Lead decisions honoured: owning board wins (Home shelves = 11, empty-state "New artboard" = 05, size picker / kind chips = 08, AI chat + folded spark "dot = working" = 03, inspector card = 14, menu = 14), `v2-p8-c4-toast-dock-or-top` (app-state notices sit at the top), `v2-p8-c4-new-row-keeps-hooks`, `v2-p8-c7-duplicate-width-below`, `v2-p8-c7-search-hits-stay-collapsed`, contract over board ("Advanced" is the CONTRACT disclosure word, board's "Show details" loses).

## Per id
- cf-home-prompt · VERIFIED (light + dark) · none (shelves follow 11; chips, faces, thumbs = fixture)
- cf-ai-drafting · DIFFERS · (1) no faint "Mobile — next" ghost (product: canvas does not know the run plan, fix-c7-cf08b); (2) status row reads "AI is working · Edit the canvas · 0:11", board "AI is drawing Tablet · Desktop done · Mobile next"; (3) Desktop never gets its "Made by AI" mark while Tablet is drawn and still wears an in-page "AI is working" tag + dashed holds (board: only the Tablet pill + rim). Items 1-3 are run-plan dependent, a real run may close 2-3 (e2e)
- cf-ai-done · VERIFIED (light + dark) · none (finish moment: panel folded, "Done … Undo" toast, Made by AI marks; settled frame = side row; the board's red dot on the folded spark is polish because 03 owns the spark and defines the dot as "working"; toast "are updated" vs "are on the canvas" = run copy)
- cf-select-tweak · DIFFERS · (1) the artboard card (Preset / Size / Fill / Corners / Clip / Export) is not on screen after the pick — the harness leaves the AI chat open, and a pick with chat open is the ask scope by decision (no Inspector), so the shot does not show "the inspector arrives"; fold the chat before the click or re-shoot; (2) Canvases panel does not fold and the view does not slide left; (3) chat chips "Make it calmer / Tighter spacing / Add a pricing teaser" absent (run suggestions, polish if (1) is fixed)
- cf-sticky-comment · DIFFERS · (1) Comments panel is open (empty state) where the board draws none; (2) no placed stickies drawn as the board does (two notes with text "Shorter headline?" / "Services as three cards", note colour, slight rotation, size) — the shot has one tiny pale unlabelled note with the format bar; (3) the colour row shows "+5" overflow where the board draws five dots; (4) left panel folded where the board keeps Canvases. Tereza's comment bubble = side state (needs a peer)
- cf-undo-before · VERIFIED (light + dark) · none (dark stale toast is gone; "Made by AI" marks on a fresh-looking canvas = polish, the thread / Undo / Keep going row = 03)
- cf-undo-ai · VERIFIED (light + dark) · none ("Undone — Try a dark hero · Redo" toast vs board "the dark hero by AI" = run label, polish)
- cf-blank · VERIFIED (light + dark) · none (Frame F tooltip = side row; chips row, folder glyph on "+ New canvas", second "New artboard", 11-canvas fixture = decisions / fixture)
- cf-add-artboard · DIFFERS · state AFTER the pick: the new artboard ("Laptop 1280 x 800", dashed empty-artboard card) is drawn and selected, but the Inspector artboard card with the Preset control the board draws (named "Artboard 4", Preset = Laptop, list open) is not on screen — same chat-open cause as select-tweak (ask scope); the picker itself is 08's and is kept as a side row
- cf-duplicate-width · VERIFIED (light + dark) · none (menu rows + submenu Laptop 1280 / Tablet 834 / Mobile 390 / Custom width… match incl. Copy / Paste; inspector + chat open and Layers tab active are session state the board does not draw = polish)
- cf-duplicate-done · VERIFIED (light + dark) · none (copy lands under the source, left edges aligned, dashed shared edge, gap pill, copy-glyph toast; name "Desktop (1280px)" vs "Desktop — Laptop" = polish)
- cf-frames-text · VERIFIED (light + dark) · none (Layers open, in-place text edit, text inspector is 14's card; flat fixture page has no nested "Hero copy · frame" / "Services · frame" tags = fixture; 36 % vs 56 % crop)
- cf-big-tree · VERIFIED (light + dark) · none (opens the last canvas, Recent block with "1 h ago", folders with counts, sort control; one Recent row vs three = fixture; stray What's-new toast = fresh-HOME state, polish)
- cf-panel-search · VERIFIED (light + dark) · none (flat list, one row per canvas, matching artboard quoted, highlight, "16 results · ⌘K searches every project" foot; folder name inline instead of a second line = polish)
- cf-search-k · DIFFERS · pinned "Ask AI" row clips the next section header: a half-cut "Tools and settings · not shown" sliver sits under the Ask AI row (visible layout defect, light + dark); the Tools group itself is below the fold of 17 results (reachable by scroll, not shown). Cover tiles, meta column, Ask AI pinned are fine
- cf-open-big · DIFFERS · (1) ⌘\ hides the side panels only — the project pill, the share cluster and the toolbar stay full where the board folds them (pill folded, cluster zen, toolbar folded, only spark / panel icons / pointer left); (2) "Panels hidden. Press ⌘\ to bring them back." is an app-state notice and the board puts it at the TOP (`v2-p8-c4-toast-dock-or-top`), the impl docks it bottom-left above the toolbar. Fixed now: "Zoom to fit · 44 %" readout, the toast text
- cf-busy · UNREACHABLE · presence, two AI chats, a second person
- cf-status-words · UNREACHABLE · only "Local project" is reachable (matches the board row); Saved / Syncing… / Offline — kept on this Mac need a hub link
- cf-offline-create · UNREACHABLE · "Offline — kept on this Mac" word and the queued-prompt card ("Queued — sends when this Mac is online") need a hub link going offline; the amber "AI is back when this Mac is online." line and the empty-state art are present
- cf-render-error · DIFFERS · the card carries TWO verbs — "Go back to 14:15" plus "Ask AI to fix it" — where the board says "one verb" and keeps the AI repair as a chip in the AI panel (the AI island with the "Ask AI to fix it" chip is not shown). Everything else matches: dimmed last-good version, "Last good version · date", plain sentence (technical part folded under Advanced = CONTRACT word)

## Polish list
- all · quiet folder glyph on "+ New canvas", kind-chips row, "e2e-fixture · N canvases" header, blank / black row thumbs, "Local project" + own face "Y", second "New artboard" button (lead decisions / fixture)
- all · inspector rail icon (sliders) top right and the folded spark corner where the board draws only the spark / panel icons (shell islands, 4.4b)
- cf-ai-done · red unread dot on the folded spark (03 defines the dot as "working"); toast wording "are updated"; camera 36 % vs 28 %
- cf-undo-before / cf-undo-ai · camera 39 %, Mobile cut at the window edge; suggestion chips "Same on Tablet / A darker shade" vs "Try it on Tablet / Lighter dark"; "Made by AI" marks stay on boards the board draws unmarked; toast label "Try a dark hero" vs "the dark hero by AI"
- cf-duplicate-width / -done · left panel on the Layers tab, inspector + chat open behind the menu; copy name "Desktop (1280px)"; height 996 vs 900 / 800; zoom 27 % vs 28 %
- cf-panel-search · duplicate clear control in the search field (the browser's native cancel ✕ plus Maude's ×; hide `-webkit-search-cancel-button`); folder path inline, not under the name; 28 px pictures blank (fixture)
- cf-big-tree · stray "What's new" toast on a fresh HOME; one Recent row vs three; tab strip not in the harness crop
- cf-frames-text · 36 % vs 56 % camera; flat fixture page; chat island open behind the card
- cf-search-k · query "camp" vs "letak"; Ask AI hint copy "find "camp" by what it looks like" vs "describe what you want on the canvas"
- cf-open-big · artboard labels plain titles vs "kind · name" labels; 21-artboard fixture is a 3-column stack
- cf-blank · none beyond the global list
- cf-render-error · icon beside the title instead of above it; card width ±4 px

## Side states
- cf-blank/frame-tooltip · hover tooltip "Frame F" on the toolbar · reachable (hover), not shot
- cf-home-prompt/target-menu · project chip menu (Studio site ✓ / Alligators brand / a new project) · reachable, shot (cf-home-prompt.target)
- cf-ai-done/panel-open · the chat open with the Done row, Undo / Keep going and chips, before it folds · reachable, shot (settled frame)
- cf-ai-drafting/typed · prompt typed on Home before send · reachable, shot (.typed)
- cf-add-artboard/size-picker · the F size picker (08-owned: App / Web page / Social / Print / Video tiles) · reachable, shot (.picker)
- cf-big-tree/row-tooltip · full-name tooltip on a long canvas name · reachable (hover), not shot
- cf-sticky-comment/compose-popover · Tereza's comment bubble on "See the work" · unreachable (needs a peer)
- cf-sticky-comment/c-pin · a C-pinned comment on the artboard · reachable, not shot
- cf-search-k/tools-group · "Tools and settings" rows with "Menu › View › Advanced" locations below the canvases · reachable (scroll / different query), not shot
- cf-render-error/advanced-open · the technical part under Advanced · reachable, not shot
- cf-status-words/saved, /syncing, /offline · other status words · unreachable (hub)
- cf-offline-create/queued-prompt · the queued prompt row in the chat · unreachable (offline hub)
