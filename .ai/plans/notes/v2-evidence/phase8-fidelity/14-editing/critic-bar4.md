# 14 Editing — critic-bar4 (verified bar, D6 shots on the merged tip 3d58f57df)

Judged fresh from the D6 pairs (both themes read for every id; full-size crops opened for obj-enter, obj-order, obj-multi, lay-reorder, lay-free, text-edit, img, comp-pick). Lead decisions applied: owning board wins (08 cards for artboards, 06 Advanced rows below 14's, 09 Export), Make editable not offered until S8.17, Connect without API-key row, Patterns group hidden, S2.14 Combine shapes on multi-select, "Remove frame" greyed row is drawn by the board. AI-run and second-person states stay UNREACHABLE (e2e). Total 26 ids: 17 verified, 5 differ, 4 unreachable.

## Per id
- ed-ab-select · verified (both) · none.
- ed-ab-resize · verified (both) · none (ruler stop, "Ignore presets" / "From the centre" pills, size chip draw).
- ed-ab-arrange · verified (both) · none (magenta guides, gap chips, X · Y pill).
- ed-ab-tidy · verified (both) · none (bar clears the name labels, one-row tip, dashed preview, Mixed card).
- ed-ab-menu · verified (both) · none (exactly the drawn set).
- ed-obj-enter · verified (both) · none (Layers, dashed ancestor, Uses row on top, Space chips, esc crumb).
- ed-obj-multi · verified (both) · none. Layers now lights all three rows (Headline, Sub, See the work); 3 objects bar and Mixed card draw.
- ed-obj-order · verified (both) · none. Both themes now open the menu on the selected "See the work" Button; the rows match the board (Cut/Copy/Paste, Duplicate, Copy/Paste properties, Select matching, Frame selection, greyed Remove frame, order, Lock, Hide, Advanced, Remove); Layers shows the hidden Headline and locked Sub.
- ed-lay-auto · differs · MUST: the "3 cards, each Fills the width." summary line the board draws under the Layout card is not shown (the child sizing is not in the inspector payload; fix-c8 open item 1). Ruler 12 16 24 32 48, "any number / every gap at once" pill and "Services → Auto layout" tag now draw.
- ed-lay-reorder · verified (both) · none. "Small apps · moves to 1 of 3" pill, slot with "1", neighbours slid, four hint pills (Let go · esc · ⌥ · Drag out), gap measures 24 draw.
- ed-lay-free · differs · MUST: the free-placement line ("Post places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner.") is not in the Datum card in either theme although the pins read Right / Top; the shot's Datum yields no line (`freeLine` returns nothing). Datum frame, Constraints and Size draw.
- ed-text-edit · differs · MUST: the one-letter-word ties (small arcs under "v", "s" in the Czech body text that the board draws while typing) are not drawn; edit mode, typed-selection highlight, Language Čeština + hint line, Style row do draw.
- ed-text-style · verified (both) · none. The "one thing changed" state is the shot (Style · Title changed dot, "differ from Title", Reset, "Update Title for every canvas…"); Uses and Detached are side rows.
- ed-shape · verified (both) · none. Shape card with Kind, W/H, four corner fields (Bind), Fill, Border, Effects; corner dots on the shape; stale AI-run outline gone.
- ed-pen · differs · MUST: no Point section (Corner Sharp / Smooth, X · Y) for the selected point — the card is the object card titled "Icon"; no Smooth / Sharp tags on points and no "Click here to close" ring; the path is a 4-point polyline, not the curved path with handles; Stroke "Ends Round / Flat" row missing. The six hint pills do draw.
- ed-img · verified (both) · none. Crop mode: faded photo beyond the frame, corner brackets, "Hráč · crop" tag, "done · esc cancel" chip, Image card with Fit Crop, Zoom 128 %, Adjust Look / Remove background.
- ed-comp-pick · verified (both) · none. Search, system label, Brand and Components groups, Button row highlighted with Primary / Ghost chips, Open Design system, ghost tag "Button · Primary" on a centre guide.
- ed-comp-instance · verified (both) · none. Instance on its frame, Component / Variant, Text override dot, "1 change from Button · Reset", "Update Button for every canvas…", Go to / Detach.
- ed-inspector · verified (both) · none. Position + Constraints, Size, Layout with Space chips, Fill, Corners, Border, Effects, Type with Style row, Interaction, Export, Advanced open (CSS, Tokens it uses, Element id, Copy CSS, Convert).
- ed-edge-huge · verified (both) · none. Sticky name pill inside the page, minimap sheet with the "You're looking at … of 8000" line, viewport window.
- ed-edge-keys · verified (both) · none. Discs 1…6 in the margin, 4.1–4.3 on the cards, thick ring with halo on Services.
- ed-edge-paste · differs · MUST: the picture now sits on the page at the paste point with the "Pasted from Figma as an image of “Hero / v3”." bar, but the artboard-growth tag "Image · new section" and the "+ 8 px" chip still show over it — a misleading label and an extra state the board does not draw.
- ed-edge-ai · unreachable · needs an AI run with a footer-only scope (e2e).
- ed-edge-ask · unreachable · AI run + scope outline (e2e).
- ed-edge-undo · unreachable · AI and other-person rows in Undo history (e2e).
- ed-edge-tereza · unreachable · second person (e2e).

## Polish list
- ed-ab-select · "Local project" instead of Saved + avatars (fixture); 08 card reads Width / Height / Fill where 14 draws Preset / Size / Position / Background (08 owns).
- ed-ab-resize · inspector hint line "Drag the bottom edge…" not shown (08 card); overflow mark beside the name state-derived.
- ed-ab-arrange · dragged board lands left of the row; leftmost gap chip half under the handle.
- ed-ab-tidy · "Undone — Edit layout · Redo" toast over the canvas (harness undo); 3 artboards not 4; card rows Presets 3 files vs PNG 4 files (fixture/08).
- ed-ab-menu · menu sits over the artboard left of the click point.
- ed-obj-enter · card 427 × 111 and Fill "Light green" vs board 400 / "Leaf" (fixture); extra Spacing / Align / Clip rows (06); inspector bottom clipped by the short viewport; small "+" chip clipped at the right panel edge.
- ed-obj-multi · Combine shapes + Export sections are extra vs the board (S2.14 / 09 own them); fixture is the Studio headline, not Alligators.
- ed-obj-order · menu is on "See the work", not "Book a call"; menu overlaps the bottom dock; board's other three panels are side states.
- ed-lay-auto · Spacing Packed / Space between row and a long object card instead of the short Layout card (14 object inspector per decision).
- ed-lay-reorder · frame tag "Services → Auto layout" at the frame's corner not drawn while the lift is held; page zoom 66 % and viewport crop differ.
- ed-lay-free · left panel is on Assets, board shows Layers with Datum highlighted; extra Layout / Direction rows.
- ed-text-edit · selection tint is olive, board is blue (browser selection over fixture colours); fixture headline and style name ("Title" for "Plakát").
- ed-text-style · fixture text "COMBINE 2026" and style "Title"; Assets tab open on the left.
- ed-shape · Width / Height with Fixed menus where the board has one W · H row; no Border colour (fixture shape has none); toolbar shows the select tool, not the shape tool.
- ed-img · Image / Photo seg at the card top (12's); fixture photo.
- ed-comp-pick · picker covers the artboard centre so the page is slid clear; ghost tag partly under the panel; Patterns group hidden by decision.
- ed-comp-instance · one override dot, board shows two; no Icon toggle (fixture button has no icon slot).
- ed-inspector · CSS block lists every authored declaration (board draws six); Effects labels SM / MD / LG are the system's; token chip names are the system's (Bg 0, Fg 0, Pill); Copy style / Paste style rows are 06's.
- ed-edge-huge · the artboard (08 card) is selected, not the Tým section with the frame card; minimap lists one section (fixture page).
- ed-edge-keys · padding row and Fill none in the Services card are fixture detail; the board's shortcut table is documentation.
- ed-edge-paste · "Make editable needs Figma Dev Mode…" note and the Make editable button are not offered until S8.17 (standing decision).

## Side states
- ed-ab-menu/duplicate-flyout · "Duplicate at another width" flyout (Laptop / Tablet / Mobile / Custom width) · reachable
- ed-ab-menu/copy-at-gap · ⌘D copy at the same gap · reachable
- ed-ab-menu/rename-field · double-click the name opens the field · reachable
- ed-ab-tidy/tip · "One row, even gaps" tooltip + dashed preview row · reachable (drawn)
- ed-obj-multi/align-tooltip · "Align left" tooltip · reachable
- ed-obj-order/nudge-chips · arrow nudge chips · reachable (side shot ed-obj-order-nudge)
- ed-obj-order/locked-tip · "Logo is locked" tip · reachable (side shot ed-obj-order-locked)
- ed-obj-order/layers-hide-lock · hide / lock rows in Layers · reachable (drawn)
- ed-obj-order/frame-selection · ⌥⌘G before / after · reachable
- ed-lay-auto/gap-menu · Gap token menu (Space 4..64, Auto) · reachable
- ed-lay-reorder/slot-strip · 220 ms film strip + Layers slot panel · reachable
- ed-text-style/uses · "Uses Plakát" state · reachable
- ed-text-style/detached · Detach state + "Use a style" · reachable
- ed-comp-instance/variant-flyout · Plná / Obrys flyout · reachable
- ed-shape/more-menu · Line / Ellipse / Polygon / Crop / Export area · reachable
- ed-edge-keys/voiceover · VoiceOver line · unreachable (screen reader, e2e)
- ed-edge-huge/section-selected · Tým section selected with the frame card · reachable
