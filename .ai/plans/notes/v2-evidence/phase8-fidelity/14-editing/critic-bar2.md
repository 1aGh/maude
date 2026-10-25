# 14 Editing — critic-bar2 (verified bar, D4 shots on the merged tip 21c9714cf)

Judged from the D4 pairs (both themes read for every id called verified; full-size impl crops opened for select, resize, arrange, tidy). Lead decisions applied: web card per 08 (v2-p8-c5-web-card-08-owns), fixed-size card per 08, Export owned by 09, undo toast with Redo, Connect without API-key row, panel quiet by state. AI-run and second-person states are UNREACHABLE (verified in e2e).

## Per id
- ed-ab-select · verified (both) · none. Selection chrome, island, toolbar and the 08 web card read right.
- ed-ab-resize · verified (both) · none. Two hint pills, lit ruler stop, chip "Laptop · 1280 × 1036", Width follows the drag.
- ed-ab-arrange · verified (both) · none. Magenta guide, "80" chips, X · Y pill all draw; the card is 08's fixed-size card (no Position row, by decision).
- ed-ab-tidy · differs · MUST: in light the Tidy bar still sits on the artboard name labels ("Po…" cut); the multi-artboard card reads "—" where the board says "Mixed" (Preset Custom, Size — × —, Position — · —); the two themes shoot different states (6 vs 3 artboards).
- ed-ab-menu · differs · MUST: Copy / Paste group missing; extra Add comment, Start a vote, Advanced entries the board does not draw.
- ed-obj-enter · differs · MUST: no Layers panel in the shot; the selected object is a whole "Frame 427 × 111" row, not the "Brand systems" card with a dashed ancestor; no "Uses Studio site system" row, no token chips (Space / Leaf), Width "Fixed" not "Fill", no folded "7 properties".
- ed-obj-multi · differs · MUST: no Layers panel, no Align-left tooltip / "Changes go to all 3" tile; inspector draws extra Combine shapes + Export sections.
- ed-obj-order · differs · MUST: object menu has no Cut / Copy / Paste; none of the four panels (nudge chips, "Logo is locked" tip, Layers hide/lock rows, Frame selection before/after) is on screen.
- ed-lay-auto · differs · MUST: no Gap token menu (Space 4..64, Auto) or ruler, Gap reads raw value + "Bind" not a "Space 24" chip, selection is "Frame" not "Services → Auto layout", no Convert row in view.
- ed-lay-reorder · differs · MUST: no lifted card with its slot in a card-sized gap (impl card is a small overlay on the page fit), no Layers slot panel.
- ed-lay-free · differs · MUST: a Text node is selected, not "Datum"; no free-placement tip card, no distance chips, no Layers panel; inspector is the Text card.
- ed-text-edit · differs · MUST: no "Uses Alligators brand system" row, language English / Style "No style", no Czech hint line; no edit ring on the Alligators headline (Homepage heading shot).
- ed-text-style · differs · MUST: the three-state specimen (Uses Plakát / changed + Reset / Detach) is not drawn; plain Text card "No style".
- ed-shape · differs · MUST: a Text node is selected, not the Podklad shape: no Shape section (Kind, W · H, four corners with radius dot), no More menu.
- ed-pen · differs · MUST: drawn path is a 3-point polyline, no Smooth / Sharp tags or "Click here to close"; no Path point inspector (the panel stays on the empty line).
- ed-img · differs · MUST: crop mode not shown (no faded photo beyond the frame, no corner brackets); no Assets panel, no Adjust (Look / Remove background) rows, no Zoom field.
- ed-comp-pick · differs · MUST: picker lists Logo/Icon/Button… without Brand / Components / Patterns groups, variant chip row or place tag; descriptions leak into rows ("Tabs (this system switches views wh…").
- ed-comp-instance · differs · MUST: tag reads "Button · 64 × 32"; no variant flyout (Plná / Obrys), no override dots, no "2 changes from … · Reset" row, no "Uses … system" row.
- ed-inspector · differs · MUST: Button card lacks Type and Interaction (On click / On hover), Export "This object", folded Advanced with Tokens + CSS + Constraints diagram, "Uses Studio site system"; Corners "Bind" not a Round chip.
- ed-edge-huge · differs · MUST: whole page fit and selected as an artboard; no sticky name pill, no minimap sheet, no "You're looking at … of 6000" line; sections are placeholder strips.
- ed-edge-keys · differs · MUST: focus lands on a Button, not the Services row; no solid 1..6 discs outside the left edge with 4.1–4.3 children; no VoiceOver line; the Undo popover and AI panel are left open in the shot.
- ed-edge-paste · differs · MUST: no paste bar ("Pasted from Figma as an image…" · Make editable), no placed picture, no Image "From Figma" inspector; the Undo popover and AI panel are left open.
- ed-edge-ai · unreachable · needs an AI run (reached with the fake agent: all three artboards carry "AI is working" tags, chat shows the run). Verified in e2e.
- ed-edge-ask · unreachable · the drawn state is an AI run ("AI is adding a link to 3 cards", scope outline); the composer shot alone cannot show it. Verified in e2e.
- ed-edge-undo · unreachable · drawn rows are AI ("Footer — 14 changes, one step") and another person's changes. Verified in e2e.
- ed-edge-tereza · unreachable · needs a second person (reached by a second browser: ring on the Hero frame, no "Tereza is editing" line in this browser). Verified in e2e.

## Polish list
- ed-ab-select · framing is the page fit, the board is zoomed; "Local project" instead of Saved + avatar cluster (fixture).
- ed-ab-select, ed-ab-resize, ed-ab-arrange · the 08 cards read Width / Height / Fill None / Safe zones where 14 draws Preset / Size / Position / Background (08 owns).
- ed-ab-resize · warning mark beside the artboard name at 1280 (the S7.25 overflow mark, state-derived); the board draws none.
- ed-ab-arrange · the leftmost "80" chip is half under the dragged board's handle; dragged board lands left of the row, the board draws it right.
- ed-ab-tidy · "Undone — Edit layout · Redo" toast over the canvas is the harness's undo, not drawn; fixture has 3 to 6 artboards on two lines.
- ed-lay-reorder · name reads "Frame · moves to 1 of 3", the board says "Small apps" (unnamed fixture frames).
- ed-obj-multi · fixture is the Studio site headline / sub / buttons, not Alligators Titulek / Podtitulek / ZAPIŠ SE.

## Side states
- ed-ab-menu/duplicate-flyout · "Duplicate at another width" flyout (Laptop / Tablet / Mobile / Custom width) · reachable
- ed-ab-menu/copy-at-gap · ⌘D copy lands at the same gap, "Desktop 2" tag · reachable
- ed-ab-menu/rename-field · double-click the name opens the rename field · reachable
- ed-ab-tidy/tip · "One row, even gaps" tooltip + dashed preview row · reachable (drawn in the impl shot)
- ed-obj-multi/align-tooltip · "Align left" tooltip · reachable
- ed-obj-order/nudge-chips · arrow nudge 1 px / ⇧ 10 px chips · reachable
- ed-obj-order/locked-tip · "Logo is locked" tip on a locked object · reachable
- ed-obj-order/layers-hide-lock · hide / lock rows in Layers · reachable
- ed-obj-order/frame-selection · ⌥⌘G wrap before / after · reachable
- ed-lay-auto/gap-menu · open Gap token menu (Space 4..64, Auto) · reachable
- ed-lay-reorder/slot-strip · 220 ms film strip + Layers slot panel · reachable
- ed-lay-free/tip-card · free-placement tip card · reachable
- ed-text-style/changed · "Plakát · changed" + Reset · reachable (needs a styled fixture)
- ed-text-style/detached · Detach state · reachable (needs a styled fixture)
- ed-comp-instance/variant-flyout · Plná / Obrys flyout · reachable
- ed-shape/more-menu · More menu (Line / Ellipse / Polygon / Crop / Export area) · reachable
- ed-edge-keys/voiceover · VoiceOver line · unreachable (screen-reader output, checked in e2e)
- ed-edge-huge/minimap · section minimap sheet · reachable
