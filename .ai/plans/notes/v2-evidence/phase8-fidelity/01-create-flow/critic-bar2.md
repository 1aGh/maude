# critic-bar2 — 01 Create Flow — verified-bar re-evaluation on the D4 shots (merged tip 21c9714cf)

Read-only. Judged from the committed D4 pairs (both themes read for every id called verified), full-size crops where borderline. Lead decisions applied: owning board wins (03 owns the AI panel incl. paperclip, Undo / Keep going row; 05 owns second "New artboard"; 08 owns the size picker), `v2-p8-c4-new-row-keeps-hooks` (quiet folder glyph on the "+ New canvas" row), chips rule (mixed project), contract over board.

## Per id
- cf-home-prompt · VERIFIED (light + dark) · none
- cf-blank · VERIFIED (light + dark) · none (chips, folder glyph, 2nd "New artboard", "Local project", 11-canvas fixture header, blank thumbs = decisions / fixture / polish)
- cf-ai-done · VERIFIED (light + dark) · none (settled frame: folded panel, "Made by AI" labels, result toast + Undo, AI corner icon; toast says "are updated" where board says "are on the canvas" = run copy)
- cf-undo-ai · VERIFIED (light + dark) · none ("Undone — Try a dark hero · Redo" toast, Desktop back to light)
- cf-undo-before · VERIFIED light only · dark: the previous run's "Done — … are updated · Undo" toast still up where the board draws none (extra element)
- cf-ai-drafting · DIFFERS · stacked, overlapping in-page "AI is working" tags (three per artboard) hide the heading text where the board draws one rim + one pill; first frame frames only Desktop at 64 % (no Tablet drafting / Mobile ghost in view); status line "AI is working · Edit the canvas" instead of "AI is drawing Tablet · Desktop done · Mobile next"
- cf-select-tweak · DIFFERS · selection lands on the heading with the docked full-height Type column; the Desktop artboard card (Preset / Size / Fill / Corners / Clip / Export) the board draws never shows; AI island with "Make it calmer / Tighter spacing" chips absent, panel not folded
- cf-sticky-comment · DIFFERS · no all-artboards view with the sticky row; toolbar lacks the colour dots row; stickies are pale / unrotated with a format bar; Comments panel is the empty state
- cf-add-artboard · DIFFERS · size picker covers the drawn selection; no "Artboard 4" selection tag, no Preset card; stale "Duplicate…" toast under the picker (extra)
- cf-duplicate-width · DIFFERS · context menu lacks Copy / Paste rows; artboard inspector is the docked column, not the card
- cf-duplicate-done · DIFFERS · copy lands right of Mobile, not under Desktop with the gap pill and dashed shared edge; toast has a green tick (board neutral)
- cf-frames-text · DIFFERS · Layers tree not open; Type inspector is the v1 docked column (Style / Font / Size · weight / … Interaction) not the Font · Size · Weight · Colour · Align card
- cf-big-tree · DIFFERS · project opens "No canvas open — Start quick setup" where the board has a canvas open; no Recent block; stray What's-new toast
- cf-panel-search · DIFFERS · board is a flat result list (picture + second line + "3 results" foot); impl keeps the tree with nested matches; "No canvas open" behind
- cf-search-k · DIFFERS · rows have no 28 px pictures (file glyph, meta glued to the name); the Ask AI row is not in view among 29 results; palette wider than board
- cf-open-big · DIFFERS · ⌘0 read-out "44 %" not "Zoom to fit · 10 %"; panels not hidden and no "Panels hidden. Press ⌘\ to bring them back." toast; labels plain titles
- cf-render-error · DIFFERS · primary is "Ask AI to fix it", not "Go back to 14:05"; no dimmed last-good version, no "Last good version · …" pill; body shows the technical line (belongs under Show details)
- cf-status-words · UNREACHABLE · only "Local project" reachable (matches); Saved / Syncing… / Offline — kept on this Mac need a hub-linked project
- cf-offline-create · UNREACHABLE · "Offline — kept on this Mac" + queued prompt card need a hub link going offline (the amber "AI is back when this Mac is online" note itself is present)
- cf-busy · UNREACHABLE · presence, two AI chats, second person

## Polish list
- cf-blank / all panel shots · quiet folder glyph at the end of "+ New canvas" (lead call, hooks kept)
- cf-blank / all panel shots · kind chips row + "e2e-fixture · 11 canvases" header + blank / black row thumbs (mixed fixture, chips rule)
- all · "Local project" + own face "Y" where the board draws faces + "Saved" (local fixture)
- all · second "New artboard" button beside Ask AI (05 ruling)
- cf-ai-done · camera 36 % vs 28 %; toast wording "are updated"
- cf-undo-before, cf-undo-ai · camera 38–39 % with Mobile cut at the window edge; suggestion chips "Same on Tablet / A darker shade" vs "Try it on Tablet / Lighter dark"; chat header title is the thread's first ask
- cf-undo-before · Desktop dark hero is plain black page (fixture content)
- cf-ai-drafting · fixture page content (bare heading) vs designed hero
- cf-home-prompt · tab strip not in the harness crop; faces / thumbs = fixture

## Side states
- cf-blank/frame-tooltip · hover tooltip "Frame F" on the toolbar · reachable (hover), not shown in the shot
- cf-big-tree/row-tooltip · hover tooltip on a canvas row · reachable
- cf-sticky-comment/compose-popover · Tereza's bubble · unreachable (needs a peer)
- cf-ai-done/panel-open · the chat open with result row before it folds · reachable (impl frame 1)
- cf-status-words/saved, /syncing, /offline · other status words · unreachable (hub)
