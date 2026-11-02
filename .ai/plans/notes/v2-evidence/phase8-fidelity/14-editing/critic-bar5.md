# 14 Editing — critic-bar5 (verified bar, D7 shots on the merged tip 0e926b7dc)

Judged fresh from the D7 pairs (both themes read for every id; full-size / raw frames opened for lay-free, text-edit, pen, edge-paste, obj-multi). Lead decisions applied: owning board wins (08 cards for artboards, 06 Advanced rows below 14's, 09 Export), Make editable not offered until S8.17, Connect without API-key row, Patterns group hidden, S2.14 Combine shapes on multi-select, "Remove frame" greyed row drawn by the board, inspector per 14 / web card per 08. AI-run and second-person states stay UNREACHABLE (e2e). Total 26 ids: 22 verified, 0 differ, 4 unreachable.

## Per id
- ed-ab-select · verified (both) · none.
- ed-ab-resize · verified (both) · none.
- ed-ab-arrange · verified (both) · none.
- ed-ab-tidy · verified (both) · none.
- ed-ab-menu · verified (both) · none.
- ed-obj-enter · verified (both) · none.
- ed-obj-multi · verified (both) · none.
- ed-obj-order · verified (both) · none.
- ed-lay-auto · verified (both) · none. The Layout card now ends on "3 frames, each Fills the width." (prior MUST closed); ruler, "any number / every gap at once" pill, "Services → Auto layout" tag draw.
- ed-lay-reorder · verified (both) · none.
- ed-lay-free · verified (both) · none. The free-placement line now draws ("Post 1:1 · Combine 2026 places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner."), pins Right / Top (prior MUST closed).
- ed-text-edit · verified (both) · none. One-letter-word ties now draw as small arcs under "v", "s", "i" of the Czech body line while the headline is typed (prior MUST closed); Language Čeština + hint line, Style row, edit highlight draw.
- ed-text-style · verified (both) · none ("one thing changed" state is the shot; Uses / Detached are side rows).
- ed-shape · verified (both) · none.
- ed-pen · verified (both) · none. Prior MUSTs closed: Point card (Corner Smooth / Sharp, X · Y) for the picked point, Stroke + Ends Round / Flat, curved path with handles, Smooth / Sharp tags, the card titled "Path · Pen · 4 points", six hint pills incl. "remove the point" and "done". The "Click here to close" drawing frame is a side state (below).
- ed-img · verified (both) · none.
- ed-comp-pick · verified (both) · none.
- ed-comp-instance · verified (both) · none.
- ed-inspector · verified (both) · none.
- ed-edge-huge · verified (both) · none.
- ed-edge-keys · verified (both) · none.
- ed-edge-paste · verified (both) · none. The picture now sits on the page at the paste point with the "Pasted from Figma as an image of “Hero / v3”." bar; the stale "Image · new section" tag and "+ 8 px" chip are gone (prior MUST closed). "Make editable" button and the Dev Mode note are not offered until S8.17 (standing decision).
- ed-edge-ai · unreachable · footer-only AI scope + "AI is drawing the footer" tooltip need a real AI run; stub run outlines all three artboards (e2e).
- ed-edge-ask · unreachable · AI run + scope outline "AI is adding a link to 3 cards" (e2e).
- ed-edge-undo · unreachable · Undo history rows from AI / another person (e2e).
- ed-edge-tereza · unreachable · second person's ring and read-only card (e2e).

## Polish list
- ed-ab-select · "Local project" instead of Saved + avatars (fixture); 08 card reads Width / Height / Fill where 14 draws Preset / Size / Position / Background (08 owns).
- ed-ab-resize · inspector hint line "Drag the bottom edge…" not shown (08 card); overflow mark beside the name is state-derived.
- ed-ab-arrange · dragged board lands left of the row (X −1160 vs 2480); leftmost gap chip half under the handle.
- ed-ab-tidy · "Undone — Edit layout · Redo" toast over the canvas (harness undo); 3 artboards not 4; card rows Presets 3 files vs PNG 4 files (fixture / 08).
- ed-ab-menu · menu sits over the artboard left of the click point.
- ed-obj-enter · card 427 × 112 and Fill "Light green" vs board 400 / "Leaf" (fixture); extra Spacing / Align / Clip rows (06); Height reads Fixed where the board says Hug.
- ed-obj-multi · Combine shapes + Export sections extra vs the board (S2.14 / 09 own them); X reads 56 and Y Mixed where the board says X Mixed (fixture); "Mixed" label sits beside the field, not in it.
- ed-obj-order · menu is on "See the work", not "Book a call"; menu overlaps the bottom dock; the board's other panels are side states.
- ed-lay-auto · Spacing Packed / Space between row and a long object card instead of the short Layout card (14 object inspector per decision).
- ed-lay-reorder · frame tag position and page zoom / viewport crop differ; hint pills sit over the footer.
- ed-lay-free · left panel on Assets, board shows Layers with Datum highlighted; extra Layout / Direction rows; line names the artboard ("Post 1:1 · Combine 2026") where the board says "Post".
- ed-text-edit · selection tint is olive, board is blue; Style shows "Title · changed" with Reset (fixture state) where the board shows "Plakát"; magenta "330" measure label overlaps its blue twin; fixture headline.
- ed-text-style · fixture text "COMBINE 2026" and style "Title"; Assets tab open on the left.
- ed-shape · Width / Height with Fixed menus where the board has one W · H row; no Border colour (fixture shape has none); toolbar shows select tool, not the shape tool.
- ed-pen · board's single frame draws a finished path AND a new one being drawn; the app shows one at a time. Board's thick yellow stroke vs the Pen's default accent 4 px is fixture. Extra Position / Constraints / Fill rows (14 object inspector). Path sits over the headline (fixture).
- ed-img · Image / Photo seg at the card top (12's); fixture photo.
- ed-comp-pick · picker covers the artboard centre so the page is slid clear; Patterns group hidden by decision; component list is the maude-v2 system's.
- ed-comp-instance · one override dot, board shows two; no Icon toggle (fixture button has no icon slot).
- ed-inspector · CSS block lists every authored declaration (board draws six); Effects labels SM / MD / LG are the system's; token chip names are the system's; Copy style / Paste style rows are 06's; Export block per 09.
- ed-edge-huge · the artboard (08 card) is selected, not the Tým section with the frame card; minimap lists one section (fixture page).
- ed-edge-keys · padding row / Fill none in the Services card are fixture detail; the board's shortcut table is documentation.
- ed-edge-paste · picture overhangs the artboard edge (paste point on a wider fixture page); zoom-to-fit 31 % vs 44 %; "Make editable" not offered until S8.17.

## Side states
- ed-ab-menu/duplicate-flyout · "Duplicate at another width" flyout (Laptop / Tablet / Mobile / Custom width) · reachable
- ed-ab-menu/copy-at-gap · ⌘D copy at the same gap · reachable
- ed-ab-menu/rename-field · double-click the name opens the field · reachable
- ed-ab-tidy/tip · "One row, even gaps" tooltip + dashed preview row · reachable (tooltip drawn in the shot)
- ed-obj-multi/align-tooltip · "Align left" tooltip · reachable
- ed-obj-order/nudge-chips · arrow nudge chips · reachable (side shot ed-obj-order-nudge)
- ed-obj-order/locked-tip · "Logo is locked" tip · reachable (side shot ed-obj-order-locked)
- ed-obj-order/layers-hide-lock · hide / lock rows in Layers · reachable (drawn)
- ed-obj-order/frame-selection · ⌥⌘G before / after · reachable
- ed-lay-auto/gap-menu · Gap token menu (Space 4..64, Auto) · reachable
- ed-lay-auto/convert · Convert layout to absolute row · reachable
- ed-lay-reorder/slot-strip · 220 ms film strip + Layers slot panel · reachable
- ed-text-style/uses · "Uses Plakát" state · reachable
- ed-text-style/detached · Detach state + "Use a style" · reachable
- ed-comp-instance/variant-flyout · Plná / Obrys flyout · reachable
- ed-shape/more-menu · Line / Ellipse / Polygon / Crop / Export area · reachable
- ed-pen/draw · new path being drawn with the "Click here to close" ring + chip · reachable (side shot ed-pen-draw, not re-shot in D7)
- ed-edge-huge/section-selected · Tým section selected with the frame card and "You're looking at …" line · reachable
- ed-edge-keys/voiceover · VoiceOver line · unreachable (screen reader, e2e)
- ed-edge-paste/make-editable · Make editable button + Dev Mode note · unreachable until S8.17 (standing decision)
