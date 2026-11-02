# critic-bar3 — 08 Artboard Kinds · verified bar (kg v2-michal-verified-bar), D5 merged-tip shots

Judged fresh from the D5 impl frames (`.scr/d5-g3/impl/08/`, both themes) against the spec frames (`.scr/spec/08/`). Checklist = critic-bar2.md. Lead decisions applied: owning board wins (card order 08, `v2-p8-c7-card-order-08-wins`), export slot 09/14-owned, menu structure 11-owned, toast dock/top rule, no align bar over mixed kinds, Assets is the third left-panel tab (12/CONTRACT 7), Edit tracks drawn disabled is NOT a lead decision (listed as MUST).

## Verdicts (id · verdict · remaining MUST items)
- ak-picker · verified (L+D) · none (hover-ghost is a side row)
- ak-picker-full · verified (L+D) · none (Custom size form is a side row; reached in ak-picker-custom)
- ak-web-hug · verified (L+D) · none (card order Width, Height, Layout, Fill, Other widths now matches; "+ N px" tag and "new section" frame present)
- ak-web-widths · differs · Height note on the longest of three widths: board "2185 now — the longest of the three."; ours "1300 now — grows as you add." (`webHeightNote` has one variant, no sibling-height compare). Warn row "Partneři is 960 px wide … Fit to width" is fixture (mechanism exists in warning-fix.js)
- ak-social · verified (L+D) · none (Size Custom, Fill None, Safe zones None = fixture story 304 x 540 with no zone set)
- ak-safe-zones · differs · the shot still reads Safe zones "None": no bands / tags ("Profile and progress bar", "Reply bar") on the artboard and no Show-on-canvas row. The behaviour the board draws is not on screen (reachable, built per fix-c4; harness did not apply the zone, or the pick did not land — unconfirmed)
- ak-print-letak · verified (L+D) · none (Print guides OFF = state; warn row = fixture 1 px; Export block 09-owned)
- ak-warnings · verified (L+D) · none (paper-size case: label mark + one inspector row + one verb; other two cases are side rows)
- ak-print-view · verified (L+D) · none (View > Advanced flyout with Print guides checked; items match the board's list; menu structure 11-owned)
- ak-video · verified (L+D) · none (Video card: Size, Length, Poster frame, Sound, Export MP4; timeline 07-owned)
- ak-mixed-fit · differs · (1) "N other artboards are dimmed. Show all" sits under the chip row, board puts it at the foot of the panel; (2) the list keeps every artboard of the canvas (non-matching ones greyed) + the selected artboard's expanded raw Frame subtree, board lists only the matching ones under the canvas name
- ak-mixed-filter · differs · the shot shows the unfiltered Canvases panel: All 14 pressed, no kind chip pressed, no "N of M" hit counts, no foot line ("N of M canvases have …"), canvas not dimmed. The filtered state is not on screen (reachable; D4 showed it with Print — D5 harness did not press the chip or the filter did not apply — unconfirmed)
- ak-mixed-select · verified (L+D) · none (Left not pressed because the two boards do not share a left edge = correct; Top pressed; no floating bar; Export slot 09-owned)
- ak-convert · verified (L+D) · none (check lines = fixture "Nothing to check."; stale toast in dark = harness leak)
- ak-convert-after · verified (L+D) · none (toast, "Made from", copy selected, marks painted: "Unchanged" under the post, "+ N % height" under the copy; warn rows = fixture)
- ak-advanced · differs · "Grid tracks · Edit tracks…" and "Layout · Convert to absolute…" are drawn but disabled (no print-board track editor / convert op: fix-c7cf08b "not done") — board draws both as working actions
- ak-real-print · verified (L+D) · none (flyer content = fixture)
- ak-real-web · verified (L+D) · none (page content = fixture; crop at window edge = harness)
- ak-real-about · unreachable · a note card on the board, not an app state (spec-only frame stands)

## Polish list
- ak-picker · Recent chips row absent (history, fixture); tile rhythm 115/86 vs 128/91 (crop tolerance); panel anchored centre-left, not over the Frame tool
- ak-picker-full · Print grid scrolls inside the 900 px panel (Business card / Custom half cut, Video group below the fold) — viewport; explainer card is board-only; A6 highlighted instead of Custom (selection fixture)
- ak-web-hug · Fill reads None (board White 100 %), Advanced "1 property" (board 4) — fixture; Export block extra (09-owned); growth tag half under the toolbar (camera)
- ak-web-widths · Layout + Other widths rows stay on a Mobile that already has siblings (board omits them; 08's own web-hug board keeps them, owning card order wins); "+ N px" growth tags linger on sibling boards (transient marks from an earlier add — harness leak); toast "Mobile is beside Desktop…" (one width added, board two); Advanced fold open ("kept open")
- ak-social · Export block is Export 1 file / Copy / Export… (board one "PNG · 1x" row, 09-owned); Advanced "1 property" fixture
- ak-print-letak · Print guides OFF with the hint "Follows Menu > View > Advanced > Print guides." (board ON); Export block Presets / Copy / Export… (board one Print PDF row, 09-owned); no comment bubble (fixture)
- ak-warnings · "Fix size" verb reads plain grey text, board uses the accent ghost verb (token/shade, control present)
- ak-print-view · extra checked "Layers as a panel"; only the fixture's print boards show guides (pink in board, green dashed in ours)
- ak-video · Size reads Custom (480 x 270 fixture); Sound reads "None yet" while the timeline shows a music lane (check the Audio-layer read on the fixture); Advanced fold open; poster thumbnail dark (footage absent); compact timeline head 07-owned; resize handle overlaps the label chip's size text ("480 [handle] 70")
- ak-mixed-fit / ak-mixed-filter · counts 6 / 14 (board 21 / 93, fixture); Assets tab and Advanced foot on the left panel (CONTRACT 7); layer rows read Frame / Frame (container not named after its content, c7b)
- ak-mixed-select · Fill is a small "Mixed" select with chevron (board a swatch row); Kinds row on one line; Advanced fold open ("kept open")
- ak-convert · select behind the veil reads Custom (board shows the picked A6); "Instagram safe zones turn off" line absent (the post has none, fixture); copy says "background" where the board names the colour Ink (fixture has none)
- ak-convert-after · marks scale with the camera (about 5 px text at 24 %) and sit over the next row's label — fixture camera; compact card in board (Paper, Bleed, Made from, Export) vs full print card in ours (print-letak owns it); Advanced fold open; Export block 09-owned
- ak-advanced · Theme reads "Follow chrome" (board DS default; 06 board says "Follow the app"); Body layout "Top to bottom" vs "Column"; In-code snippet scrolls horizontally (harness scrolled it to the end), the Exact size / Resolution / Colour / Guides blocks are scrolled out of the shot (they are on screen in ak-convert-after)
- ak-real-print · selection chrome (handles, label chip with warn mark) in the crop

## Side states
- ak-picker/hover-ghost · tile highlighted + dashed "FB event cover 1920 x 1005" ghost frame on the canvas · reachable (`size-ghost`, SizePicker.jsx onGhost) — not captured (no tile hovered in the frame)
- ak-picker-full/custom-size-form · Custom print size (Width, Height, Orientation, Bleed, Safe margin, Cancel / Add artboard) · reachable, frame ak-picker-custom exists in D5 impl (matches; "DL leaflet size" hint absent = fixture); no spec pair
- ak-warnings/crosses-the-cut · QR crosses the cut: dashed outline + tag + "Move inside" · reachable (ArtboardWarnOutlines built; needs a fixture layer over the trim)
- ak-warnings/video-length · "2:40 long" + "Allow longer" · reachable with a fixture video over 2 min
- ak-safe-zones/platform-menu · floating checked platform menu with footnote · reachable once a zone is picked
- ak-safe-zones/profile-grid · 3:4 crop of a 1:1 post with pale sides · reachable after the zone is picked on a 1:1 board
