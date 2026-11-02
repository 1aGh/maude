# critic-bar4 — 08 Artboard Kinds · verified bar (kg v2-michal-verified-bar), D6 merged-tip shots

Judged fresh from the committed D6 pairs (`<id>-<theme>.jpg`, both themes) plus the D6 full-size impl frames (`.scr/d6-g3/impl/08/`) for the borderline ids (safe-zones, print-letak, mixed-fit, mixed-filter, video, convert-after). Checklist = critic-bar3.md + `fix-c8-misc2.md`. Lead decisions applied: owning board wins (card order 08, `v2-p8-c7-card-order-08-wins`), export slot 09/14-owned, menu structure 11-owned, toast dock/top rule, no align bar over mixed kinds, Assets is the third left-panel tab (CONTRACT 7), kind filter dims the canvas only from Layers (`v2-p8-c4-dim-is-layers-only`), web Height note compares the longest sibling (`v2-p8-c8-web-longest-sibling-compare`), kind filter narrows the Layers list (`v2-p8-c8-kind-filter-narrows-layers-list`).

## Verdicts (id · verdict · remaining MUST items)
- ak-picker · verified (L+D) · none
- ak-picker-full · verified (L+D) · none (Video group below the fold of the 900 px panel = viewport/scroll, not overflow)
- ak-web-hug · verified (L+D) · none (card order Width, Height, Layout, Fill, Other widths; "+ 108 px" tag and "Rozpis zápasů · new section" frame present)
- ak-web-widths · verified (L+D) · none (Height note now "1136 now — the longest of the three."; toast and warn row = fixture)
- ak-social · verified (L+D) · none (fixture board is Custom 304 x 540, no zone set; the zone state of the same card is ak-safe-zones)
- ak-safe-zones · verified (L+D) · none (Instagram Reels picked: bands "Profile and progress bar" / "Buttons" / "Under the caption" / "Caption and audio" on the artboard, "Show on canvas" row on; the floating platform menu and the profile grid are side rows)
- ak-print-letak · verified (L+D) · none (Print guides OFF = global menu state; warn row = fixture 1 px; Export block 09-owned)
- ak-warnings · verified (L+D) · none (label mark + one inspector row + one verb; the other two board cases are side rows)
- ak-print-view · verified (L+D) · none (View › Advanced flyout, Print guides checked; menu structure 11-owned)
- ak-video · differs · (1) Sound row reads "None yet" while the timeline of the same artboard shows a "music" Audio lane with a waveform (fixture `<Audio src="assets/music.mp3">`); board reads the track name ("Hype instrumental"). The row must read the comp's Audio layer; likely `loadSound` ran before the comp was ready and cached an empty name (`soundOf !== null` guard in `useVideoFacts` never re-reads) — confirm in `video-facts.js`
- ak-mixed-fit · verified (L+D) · none (Layers names only the 2 Print artboards; "4 other artboards are dimmed. Show all" is the foot of the panel; the canvas dims the rest)
- ak-mixed-filter · verified (L+D) · none (Canvases chip Print on: "2 of 6", "2 of 2" hit counts, foot "3 of 14 canvases have print. A canvas counts once under each kind it has."; canvas not dimmed per `v2-p8-c4-dim-is-layers-only`)
- ak-mixed-select · verified (L+D) · none
- ak-convert · verified (L+D) · none (check lines = fixture "Nothing to check."; the stale "Mobile is beside Desktop" toast in dark is a harness leak)
- ak-convert-after · verified (L+D) · none (toast "The A6 copy is beside the post. The post is unchanged." + Undo, "Made from", copy selected, marks painted)
- ak-advanced · differs · "Grid tracks · Edit tracks…" is hard `disabled` on every print board (no print-board track editor; DDR-186's editor is element-level); "Layout · Convert to absolute…" is disabled while no body layout is read (it is wired to `layout.convert-to-absolute` otherwise). The board draws both as working actions and no lead decision overrules it (fix-c8-misc2 "decided, no op" is the builder's, not the lead's)
- ak-real-print · verified (L+D) · none (flyer content = fixture)
- ak-real-web · verified (L+D) · none (page content = fixture)
- ak-real-about · unreachable · a note card on the board, not an app state (spec-only frame stands)

## Polish list
- ak-picker · Recent chips row absent (history, fixture); tile rhythm 115/86 vs 128/91; panel anchored centre-left, not over the Frame tool
- ak-picker-full · explainer card is board-only; A6 highlighted instead of Custom (selection fixture); Print grid scrolls inside the panel
- ak-web-hug · Fill reads None (board White 100 %), Advanced "1 property" (board 4) — fixture; Export block extra (09-owned)
- ak-web-widths · Layout + Other widths rows stay on a Mobile that already has siblings (board omits; 08's own web-hug board keeps them, owning card order wins); "+ N px" tags linger on sibling boards (harness leak); toast "Mobile is beside Desktop…" (one width added, board two); Fill None vs White 100 % (fixture)
- ak-social · Size Custom / Safe zones None (fixture story 304 x 540); Export block Export 1 file / Copy / Export… (09-owned); Advanced "1 property"
- ak-safe-zones · fixture photo instead of the Alligators post; the artboard is at 48 % so band tags are small; one artboard instead of three overlays
- ak-print-letak · Print guides OFF with hint "Follows Menu › View › Advanced › Print guides." (board ON, guides on canvas); Export Presets / Copy / Export… (board one Print PDF row, 09-owned); no comment bubble (fixture); "Fix size" verb reads plain grey text, board uses the accent ghost verb
- ak-warnings · same selection as ak-print-letak; "Fix size" grey vs accent ghost
- ak-print-view · extra checked "Layers as a panel"; extra View rows (Preview, Present from the start, Experts) = 11-owned; fixture print boards show green dashed guides (board pink)
- ak-video · Size reads Custom (480 x 270 fixture); poster thumbnail dark (footage absent); Advanced fold open ("kept open"); resize handle overlaps the label chip's size text ("480 [handle] 70"); compact timeline head / lanes 07-owned
- ak-mixed-fit / ak-mixed-filter · counts 2 of 6 / 14 (board 21 / 93, fixture); header "6 artboards" stays the canvas total while the list narrows; Assets tab and Advanced foot on the left panel (CONTRACT 7); a safe-zone band left on the story board (harness leak)
- ak-mixed-select · Fill is a small "Mixed" select (board a swatch row); Kinds row on one line; Export Presets / Copy / Export… rows (09-owned); Advanced fold open with the "Select one thing…" note
- ak-convert · select behind the veil reads Custom (board picked A6); "Instagram safe zones turn off" line absent (fixture); copy says "background" where the board names the colour Ink (fixture has none)
- ak-convert-after · marks scale with the camera (about 5 px text at 24 %) and sit over the next row's label — fixture camera; compact card in board vs full print card in ours (print-letak owns it); Advanced fold open; Export block 09-owned
- ak-advanced · Theme reads "Follow chrome" (board DS default; 06 says "Follow the app"); Body layout "Top to bottom" vs "Column"; In-code snippet scrolls horizontally; the Exact size / Resolution / Colour / Guides blocks are scrolled out of the shot (they are on screen in ak-convert-after)
- ak-real-print / ak-real-web · selection chrome (handles, label chip with warn mark) in the crop; crop at window edge

## Side states
- ak-picker/hover-ghost · tile highlighted + dashed "FB event cover 1920 x 1005" ghost frame on the canvas · reachable (`size-ghost`, SizePicker.jsx onGhost); not captured
- ak-picker-full/custom-size-form · Custom print size (Width, Height, Orientation, Bleed, Safe margin, Cancel / Add artboard) · reachable; frame `ak-picker-custom` exists (impl only, no spec pair)
- ak-safe-zones/platform-menu · floating checked platform menu with footnote · reachable; the menu is cut off at the card foot when the card has little under the row (fix-c8-misc2 open)
- ak-safe-zones/profile-grid · 3:4 crop of a 1:1 post with pale sides · reachable after the zone is picked on a 1:1 board
- ak-warnings/crosses-the-cut · QR crosses the cut: dashed outline + tag + "Move inside" · reachable (ArtboardWarnOutlines; needs a fixture layer over the trim)
- ak-warnings/video-length · "2:40 long" + "Allow longer" · reachable with a fixture video over 2 min
- ak-convert/check-lines · three check lines ("Folka týmu is 840 px wide", "Two layers sit where the paper is cut", "Instagram safe zones turn off") · reachable (fixture post with a wide layer and a zone)
- ak-web-widths/warn-row · "Partneři is 960 px wide — wider than Mobile · Fit to width" · reachable (mechanism in warning-fix.js; fixture layer)
