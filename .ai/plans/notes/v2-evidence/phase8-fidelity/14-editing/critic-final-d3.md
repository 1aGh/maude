# 14 Editing — critic-final-d3 (stage D3 on the merged tip 63592219a)

One critic, four lenses merged, read-only. Read the D3 pairs (JPG q55 from this folder; full-size at the `final (D3)` path) for all 25 reachable ids in light; dark was read for ed-ab-select, ed-pen, ed-inspector and is theme-identical in content (every blocker below is content or state, not theme). Checklist: critic-final.md (D2), stage-B reports, fix-c3/c4/c5, decisions v2-p8-c5-web-card-08-owns, v2-p8-c5-panel-quiet-by-state, v2-p8-bugs3-undo-toast-action, v2-p8-connect-no-api-key-row.

**Verdict: no id matches in either theme. 25 differ, 1 unreachable.**

## Moved since D2 (seen)
- Artboard card now follows 08's web card (Width / Height / Other widths / Fill / Layout / Export) per decision `v2-p8-c5-web-card-08-owns`, so the ed-ab-select card still reads differently from board 14 and is no longer a lead-decision-neutral difference; board 14 vs 08 conflict remains recorded in fix-c5 open #1.
- Undo toast 'Undone — <label> · Redo' appears (ed-ab-tidy), Connect modal without an API-key row (ed-edge-ai), AI chat and Undo popover are quieter.
- Resize chip reads 'Laptop · 1280 × 1052' (snap word present).
- Still the same: no Layers panel in impl, no Saved/avatar cluster (the app shows 'Local project'), tab-order '1.x' pills over a pointer selection (R3), fixture content differs from the board (Homepage vs Alligators).

## Per id (light = dark unless noted)
| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ed-ab-select | light | differs | Impl card is Width/Height/Other widths/Fill/Layout/Export + 'Uses maude-v2' + Advanced; board is Preset, Size W·H, Clip content switch, Fill Background, Layout Content, Export 'PNG · 2x', Other widths last (fix-c5 claims it; the D3 shot shows the old card). Selection is not the zoomed board framing; no Saved/avatar cluster, no hint strip, no Layers panel. Selection chrome, island and toolbar match. |
| ed-ab-select | dark | differs | Same. |
| ed-ab-resize | light | differs | Ruler is two labels, no full scale with Laptop 1280 lit; chip reads 'Laptop · 1280 × 1052' but pill/ruler/inspector do not follow the drag (inspector stays Desktop · 1440, no Preset: Laptop, no Size row); hint is one box not two pills; no 'Drag the bottom edge…' tip. |
| ed-ab-resize | dark | differs | Same. |
| ed-ab-arrange | light | differs | Dragged artboard sits detached under the row (X 348 · Y 1891), no magenta guides, no three '80' chips, not snapped in the row; inspector is Size/Fill None/Safe zones, board Preset/Position/Size/Fill 'Klubová zelená' (fix-c5 open #2). |
| ed-ab-arrange | dark | differs | Same. |
| ed-ab-tidy | light | differs | Tidy bar overlaps artboard labels, 'Tidy up' plain label, no 'One row, even gaps' tip, no dashed preview row; stack is 3 overlapping artboards (fixture), inspector Custom / — × —, Presets rows, undo toast over the toolbar; board shows Story 9:16 · 1080, W/H values, 'Changes go to all 4'. |
| ed-ab-tidy | dark | differs | Same. |
| ed-ab-menu | light | differs | Menu lacks Copy/Paste group, has extra Add comment / Start a vote / Advanced groups, no 'Duplicate at another width' flyout (Laptop/Tablet/Mobile/Custom), no ⌘D copy panel, no rename field; board shows the three-panel explainer, impl is a single menu over the artboard. |
| ed-ab-menu | dark | differs | Same. |
| ed-obj-enter | light | differs | No Layers panel / Canvases-Layers-Assets tabs; Brand systems card not the selected object (a whole Frame 427 × 111 row, no dashed ancestor outline); inspector order Position/Size before Layout, 'Place freely' button inline, no token chips (Space 4 / Leaf 20 %), Width 'Fixed' not 'Fill', no 'Uses Studio site system' row, no folded Advanced '7 properties'. |
| ed-obj-enter | dark | differs | Same. |
| ed-obj-multi | light | differs | Multi-selection is formed (3 objects bar) but on the wrong fixture (Studio site headline/sub/buttons, not Alligators Titulek/Podtitulek/ZAPIŠ SE); no Layers panel, no Align-left tooltip, no 'Rotate 15°' hint, no 'Changes go to all 3' tile; inspector adds Combine shapes + Export sections the board does not show; X/Y Mixed rows present. |
| ed-obj-multi | dark | differs | Same. |
| ed-obj-order | light | differs | Object menu has no Cut/Copy/Paste entries, no 'Frame selection' group parity (impl has it), red 'Remove' is plain text; board's four panels (nudge chips, 'Logo is locked' tip, Hide/lock/pick Layers rows, Frame selection before/after) are not drawn; the shot is a full-canvas menu over a Button selection. |
| ed-obj-order | dark | differs | Same. |
| ed-lay-auto | light | differs | No token stops ruler / Gap menu (Space 4…64, Auto, 'A number, no token…'); Gap shows 'Bind' + raw 24, not a 'Space 24' chip; Padding two stacked fields, Layout below Position/Size; selection is the whole row 1328 × 111 labelled 'Frame', not 'Services → Auto layout'; no hint pills; Convert layout row absent. |
| ed-lay-auto | dark | differs | Same. |
| ed-lay-reorder | light | differs | No lifted/rotated card with a card-sized slot and '1' disc; shot is the page fit with a magenta gap-chip strip clipped at the left edge, the Frame label is cut off; hint pills row and the 220 ms strip / Layers slot panel absent. |
| ed-lay-reorder | dark | differs | Same. |
| ed-lay-free | light | differs | Selection is a text node (Title), not the Datum frame; no 'Datum' name, no free-placement tip card, constraints diagram present but no magenta 64 distance chips; board's Layers panel absent; inspector is the Text card. |
| ed-lay-free | dark | differs | Same. |
| ed-text-edit | light | differs | Inspector is Type → Position → Size with language 'English' and Style 'No style', no 'Uses Alligators brand system' row, no Czech hint line, no Ink/Colour section; shot is the page fit with the Homepage headline in a tiny frame, not the zoomed Alligators poster with the 'STAŇ SE GATOREM' edit ring. |
| ed-text-edit | dark | differs | Same. |
| ed-text-style | light | differs | Board's three-state specimen (Uses Plakát / Plakát · changed + Reset / Detach) not drawn; impl shows a plain Text card with 'No style' on the page fit; fixture has no text style, no changed-value dot, no 'Change Plakát in the Design system' link. |
| ed-text-style | dark | differs | Same. |
| ed-shape | light | differs | A text node ('So 14. 3.') is selected, not the Podklad shape: no Shape section (Kind / W·H), no four corner fields with radius dot, no More menu (Line/Ellipse/Polygon/Crop/Export area), no zoomed poster framing. |
| ed-shape | dark | differs | Same. |
| ed-pen | light | differs | Drawn path is a 3-point angular polyline on the page fit, not a close-up smooth curve with Smooth/Sharp tags and 'Click here to close'; inspector slot is the empty-state line, board shows the Path point inspector (Corner, X·Y, Stroke, Ends, Combine shapes, key list). The four hint pills are present. |
| ed-pen | dark | differs | Same. |
| ed-img | light | differs | Crop mode not shown: no close-up faded photo beyond the frame with corner brackets, no Assets panel, no Adjust (Look / Remove background) rows, no Zoom field; impl Image card is Fit/Fill/Crop/Tile + Constraints + Export on the page fit. |
| ed-img | dark | differs | Same. |
| ed-comp-pick | light | differs | Picker is centred over the Homepage page not beside the Alligators story target; rows (Brand/Components/Patterns groups, Tlačítko variant chip row, 'Tlačítko · Plná' place tag) differ — impl lists Logo/Icon/Button… with a leaked description ('Tabs (this system switches views wh…', 'Badge (this system marks status wi…'); no 'Uses the Alligators brand system' header, no place tag. |
| ed-comp-pick | dark | differs | Same. |
| ed-comp-instance | light | differs | Tag reads 'Button · 64 × 32' on the page fit, board is '◇ Tlačítko · Plná' on the zoomed story; no variant flyout (Plná / Obrys), no override dots, no '2 changes from Tlačítko · Reset' row; inspector Component/Variant/Content present but without dots and Reset. |
| ed-comp-instance | dark | differs | Same. |
| ed-inspector | light | differs | Button card shows Position, Size, Layout, Fill, Corners 'All 999 Bind', Border, Effects only — no Type, Interaction (On click/On hover), Export 'This object', folded Advanced with 'Tokens it uses' + CSS facts, Constraints diagram, no 'Uses Studio site system'; Corners 'Bind' instead of 'Round' token chip. Board's numbered 1–11 annotation column and Words/CSS table are not part of the app (fine); the card itself is the blocker. |
| ed-inspector | dark | differs | Same. |
| ed-edge-ai | light | differs | State not reached: signed-out stub — 'Connect your Claude account?' sheet over a dimmed page; no dashed AI outline on the footer, no 'AI is drawing the footer' tag, no inspector 'AI is changing the Footer' line, no 'Stop' chat row. Needs the fake-agent harness adapted to 14. |
| ed-edge-ai | dark | differs | Same. |
| ed-edge-ask | light | differs | ⌘/ composer is a wide field with 'Ask AI' chip and send square under the selection, not the compact pill + 'One step — ⌘Z undoes all of it' tip; no AI scope outline / 'AI is adding a link to 3 cards' tag; selection is one Frame with tab-order badges 1.3.1/1.3.2 (R3 chrome) not three cards; no Layers panel. |
| ed-edge-ask | dark | differs | Same. |
| ed-edge-huge | light | differs | Whole page fit and selected as an artboard; no sticky name pill, no minimap sheet (Úvod/Zápisky/Tým…), no 'You're looking at 1727–5636 of 6000' line; section 'Tým' not selected; the artboard sections are placeholder strips. |
| ed-edge-huge | dark | differs | Same. |
| ed-edge-undo | light | differs | Popover has one row ('Placed a component') + Version history; no AI row ('Footer — 14 changes, one step'), no people rows, no 'Tereza's changes are hers to undo', no 'Would undo · 14 changes' tag on the canvas; tab-order pills '1.2.1.1' sit over the headline (R3 chrome); popover opens below the canvas, avatar not tone-filled. |
| ed-edge-undo | dark | differs | Same. |
| ed-edge-paste | light | differs | No paste bar ('Pasted from Figma as an image of 'Hero / v3'' · Make editable), no placed picture, no Image inspector 'From Figma'; shot shows the Undo popover and AI chat panel left open over a selected artboard. Needs a Figma-paste stub. |
| ed-edge-paste | dark | differs | Same. |
| ed-edge-keys | light | differs | Focus is on a Button (inspector shows Button instance) not the Services row; impl badges are tab-order '1.1/1.2' pills over content, not solid 1…6 discs outside the left edge with 4.1–4.3 children; no VoiceOver line; Undo popover and AI panel are open in the shot; the right-hand key list is not part of the app (board-only). |
| ed-edge-keys | dark | differs | Same. |
| ed-edge-tereza | light | unreachable | needs a second synced collaborator; a presence stub painting a sky ring + name on one object and flipping the inspector to the read-only view (`editing/hold-rings.tsx`, `client/v2/inspector/view-mode.jsx`) would make it shootable |
| ed-edge-tereza | dark | unreachable | Same. |

```json
{"canvas":"14 Editing","dir":"14-editing","match":[],"match_one_theme":{},"differs":["ed-ab-select", "ed-ab-resize", "ed-ab-arrange", "ed-ab-tidy", "ed-ab-menu", "ed-obj-enter", "ed-obj-multi", "ed-obj-order", "ed-lay-auto", "ed-lay-reorder", "ed-lay-free", "ed-text-edit", "ed-text-style", "ed-shape", "ed-pen", "ed-img", "ed-comp-pick", "ed-comp-instance", "ed-inspector", "ed-edge-ai", "ed-edge-ask", "ed-edge-huge", "ed-edge-undo", "ed-edge-paste", "ed-edge-keys"],"unreachable":["ed-edge-tereza"]}
```
