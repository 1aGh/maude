# 14 Editing — critic-bar3 (verified bar, D5 shots on the merged tip e37e7d82a)

Judged fresh from the D5 pairs (both themes read for every id). Lead decisions applied: owning board wins (08 cards for artboards, 06 Advanced rows below 14's, 09 Export), S2.14 Combine shapes shows on multi-select, Make editable not offered until S8.17, Connect without API-key row, Patterns group hidden while nothing placeable backs it, panel quiet by state. AI-run and second-person states are UNREACHABLE (e2e).

## Per id
- ed-ab-select · verified (both) · none.
- ed-ab-resize · verified (both) · none (ruler stop, two hint pills, size chip all draw).
- ed-ab-arrange · verified (both) · none (magenta guides, "80" chips, X · Y pill).
- ed-ab-tidy · verified (both) · none. Both themes now shoot the same 3-board state; card reads Mixed; bar clears the name labels; dashed one-row preview draws.
- ed-ab-menu · verified (both) · none. Exactly the drawn set: Ask AI, Duplicate, Duplicate at another width, Rename, Copy, Paste, Export…, Move to trash.
- ed-obj-enter · verified (both) · none. Layers panel, dashed ancestor, "Brand systems" selected, Uses row on top, Space chips, esc crumb.
- ed-obj-multi · differs · MUST: Layers highlights only the Headline row while the canvas holds three selected objects (board: all three rows lit, "Layers shows the same selection").
- ed-obj-order · verified dark only · light: right-click menu is on "See the work" but the selection/inspector is the page Frame (1440 × 1032), so the menu does not belong to a selected object; dark selects the Button as drawn. Menu rows match the board (Cut/Copy/Paste, Copy/Paste properties, Select matching, Frame selection, order, Lock, Hide, Advanced, Remove).
- ed-lay-auto · differs · MUST: the drag-a-gap state is not on screen — no ruler (12 16 24 32 48), no "any number / every gap at once" hint pill, pill reads "Services · 1328 × 112" not "Services → Auto layout", no Convert row / "3 cards, each Fills the width" note in view.
- ed-lay-reorder · differs · MUST: no "Small apps · moves to 1 of 3" pill, no hint-pill row (Let go / esc / ⌥ / Drag out); the lifted card is a clipped slab over a page zoomed to 119 %, not a card riding in a card-sized slot gap.
- ed-lay-free · differs · MUST: a Text node is selected (Text card) not the Datum frame; no free-placement tip card ("Post places things freely…"), no Size W · H block, no Advanced row in view.
- ed-text-edit · differs · MUST: the headline is only selected (box + chips), not in edit mode with the typed-selection highlight; no Czech hint line (Language "Not set"), Style "No style" (system/fixture names are polish).
- ed-text-style · differs · MUST: the three-state specimen (Uses Plakát / one thing changed + Reset / Detached + Use a style) is not drawn; plain Text card "No style", a lingering AI-run frame outline in dark.
- ed-shape · differs · MUST: a Frame (600 × 64) is selected, no Shape section (Kind, W · H, corner radius dot), corners are four Bind fields; a stale AI-run outline/banner sits on the artboard.
- ed-pen · differs · MUST: no Path inspector for the point (empty-state "Click an object…" instead), no Smooth/Sharp tags on points, no "Click here to close", path is a 3-point polyline. Hint pills do draw.
- ed-img · differs · MUST: crop mode lacks the faded photo beyond the frame and corner brackets, the "done · esc cancel" chip is clipped at the viewport edge, the Image card has no Zoom field and no Adjust (Look / Remove background) rows.
- ed-comp-pick · differs · MUST: no place ghost / tag / snap guide on the canvas while the picker is open (board: "Tlačítko · Plné" tag + centre guide); the Artboard card, not an object, is selected behind the picker. Brand / Components groups, variant chips, clean rows now draw (Patterns hidden by decision).
- ed-comp-instance · differs · MUST: the shot is a Button dragged out below the page ("Button · new section", "+ 32 px"), not an instance on its frame; no override dots, no "2 changes from … · Reset" row, no "Update … for every canvas" link (variant flyout is a side state).
- ed-inspector · differs · MUST: Type group of the Button has no Style row ("Aa Link" in the board); all other groups draw (Position, Size, Layout with Space chips, Fill, Corners Pill chip, Border, Effects, Interaction, Export, Advanced with CSS / Tokens-it-uses chips / Element id / Copy CSS / Convert).
- ed-edge-huge · differs · MUST: the whole page is fit and the artboard selected; no sticky name pill inside the page, no "You're looking at … of 6000" line, no section (Tým) selected, minimap not shown (side).
- ed-edge-keys · verified (both) · none. Discs 1…6 in the margin, 4 solid, 4.1–4.3 on the cards, thick ring with halo on Services. The board's shortcut table and VoiceOver line are board documentation / screen-reader output (side row).
- ed-edge-paste · differs · MUST: the pasted picture is placed loose below the page ("Image · new section", + 11 px) instead of on the frame at the paste point; Image card has no "Make editable needs Figma Dev Mode…" note (Make editable itself is a standing decision, S8.17).
- ed-edge-ai · unreachable · needs an AI run (e2e).
- ed-edge-ask · unreachable · AI run + scope outline (e2e).
- ed-edge-undo · unreachable · AI and other-person rows (e2e).
- ed-edge-tereza · unreachable · second person (e2e).

## Polish list
- ed-ab-select · framing is the page fit; "Local project" instead of Saved + avatars (fixture); 08 card reads Width / Height / Fill where 14 draws Preset / Size / Position / Background (08 owns).
- ed-ab-resize · overflow warning mark beside the name at 1280 (state-derived).
- ed-ab-arrange · leftmost "80" chip half under the dragged handle; dragged board lands left of the row.
- ed-ab-tidy · "Undone — Edit layout · Redo" toast over the canvas (harness undo); 3 artboards not 4, Background "Default" not Mixed, "Changes go to all 3" sits under Position (fixture/order).
- ed-ab-menu · menu sits left of the click point over the artboard; fixture artboard.
- ed-obj-enter · card is 427 × 112 (Hug vs Fixed, Fill "Light green 100 %" vs "Leaf 30 %": fixture); extra Spacing / Align / Clip rows (06); inspector bottom clipped by the short viewport.
- ed-obj-multi · Combine shapes + Export sections are extra vs the board (S2.14 / 09 own them); fixture is the Studio headline, not Alligators.
- ed-obj-order · Frame-selection after state only; nudge and locked tips live in side shots.
- ed-inspector · CSS block lists every authored declaration (board draws six); Copy style / Paste style / Copy code / Element rows are 06's; Effects labels are the system's (SM/MD/LG); Hug 148 × 44 vs Fixed 113 × 35 fixture.
- ed-edge-keys · padding row and Fill none in the Services card are fixture detail.

## Side states
- ed-ab-menu/duplicate-flyout · "Duplicate at another width" flyout · reachable
- ed-ab-menu/copy-at-gap · ⌘D copy at the same gap · reachable
- ed-ab-menu/rename-field · double-click the name opens the field · reachable
- ed-ab-tidy/tip · "One row, even gaps" tooltip + dashed preview row · reachable (drawn)
- ed-obj-multi/align-tooltip · "Align left" tooltip · reachable
- ed-obj-order/nudge-chips · arrow nudge chips · reachable (side shot)
- ed-obj-order/locked-tip · "Logo is locked" tip · reachable (side shot)
- ed-obj-order/layers-hide-lock · hide / lock rows in Layers · reachable (partly drawn)
- ed-obj-order/frame-selection · ⌥⌘G before / after · reachable
- ed-lay-auto/gap-menu · Gap token menu (Space 4..64, Auto) · reachable
- ed-lay-reorder/slot-strip · 220 ms film strip + Layers slot panel · reachable
- ed-lay-free/tip-card · free-placement tip card · reachable
- ed-text-style/changed · "Plakát · changed" + Reset · reachable
- ed-text-style/detached · Detach state · reachable
- ed-comp-instance/variant-flyout · Plná / Obrys flyout · reachable
- ed-shape/more-menu · Line / Ellipse / Polygon / Crop / Export area · reachable
- ed-edge-keys/voiceover · VoiceOver line · unreachable (screen reader, e2e)
- ed-edge-huge/minimap · section minimap sheet · reachable
