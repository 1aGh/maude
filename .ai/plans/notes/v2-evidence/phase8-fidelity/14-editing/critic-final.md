# 14 Editing — critic-final (stage D2 on the merged tip d3881fe41)

One critic, four lenses merged, read-only. Read the full-size D2 pairs for ed-ab-select, -resize, -arrange, -tidy, -menu, ed-text-edit, ed-pen, ed-edge-keys, ed-lay-auto (light) in this round; the remaining ids are judged against the stage-B blockers, critic-d, fix-c3-inspect / fix-c4-annot and the INDEX D2 notes (each of them lists items still open, so none can be `match`). Dark pairs share the light blockers (content/state, not theme); the toolbar/selection chrome is correct in dark per stage D.

**Verdict: no id matches in either theme. 25 differ, 1 unreachable.**

## Fixed since stage D (seen)
- Undo / Redo / zoom island is built (was blocker U).
- Context menus now carry icons.
- Page root is the artboard; Layers no longer lists it; Convert in the folded Advanced; names are words; empty inspector line is the v2 one.
- Spacing grips hidden at rest; text edit draws only ring + halo; pen hints are light pills; keyboard focus ring replaces selection chrome.

## Per id (light = dark unless noted)

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ed-ab-select | light | differs | Artboard card is Width / Height / Other widths / Export 1x PNG + 'Uses maude-v2' row; board: Preset, W·H Size, Clip content switch, Fill Background, Layout Content, Export 'PNG · 2x', folded Advanced '6 properties'. No Saved/avatar cluster; hint strip not drawn (note strip). Selection chrome, island and toolbar now match. |
| ed-ab-select | dark | differs | Same. |
| ed-ab-resize | light | differs | Ruler is two labels, not the full scale with Laptop 1280 lit; pill/chip read '1116 × 1052' with a warn glyph, no 'Laptop · 1280' snap; inspector does not follow the drag (Desktop · 1440, no Preset: Laptop); hint is one box vs two pills; 'Drag the bottom edge…' tip absent. |
| ed-ab-resize | dark | differs | Same. |
| ed-ab-arrange | light | differs | The dragged artboard sits detached under the row (X 348 · Y 1891) with no magenta guides / three '80' chips; board shows it snapped in the row with 'X 3480 · Y 0'. Inspector: Size/W·H/Fill 'None'/Safe zones vs board Preset/Position/Size/Fill 'Klubová zelená'. |
| ed-ab-arrange | dark | differs | Same. |
| ed-ab-tidy | light | differs | Tidy bar overlaps the artboard labels, 'Tidy up' is a plain label, no 'One row, even gaps' tip, no dashed preview row; stack is 3 artboards overlapping (fixture), inspector 'Custom / — × —', Presets 'Mixed' rows vs board 'Story 9:16 · 1080', W/H values, 'Changes go to all 4'. |
| ed-ab-tidy | dark | differs | Same. |
| ed-ab-menu | light | differs | Menu has no Copy / Paste group, Add comment + Start a vote + 'Advanced ›' extra groups, no 'Duplicate at another width' flyout (Laptop/Tablet/Mobile/Custom width), no ⌘D copy panel, no rename field panel; menu draws over the artboard, chip overlapped. Icons now present. |
| ed-ab-menu | dark | differs | Same. |
| ed-obj-enter | light | differs | Prior blockers (Layers panel, token chips, 'Fill' width, R5 section order) not closed by any fix file; Convert moved into Advanced and page-root fixed, but sections still Position/Size before Type and no token chips. (cannot confirm closed from shot detail; fixture) |
| ed-obj-enter | dark | differs | Same. |
| ed-obj-multi | light | differs | Multi-selection state not formed in the earlier round; harness re-drive uses ⌘⇧-click, but no '3 objects' bar / Mixed / align bar evidence in a fix file (cannot confirm). |
| ed-obj-multi | dark | differs | Same. |
| ed-obj-order | light | differs | Object menu: no Cut/Copy/Paste, bare 'Advanced ›', red 'Remove'; nudge chips, lock badge, 'Logo is locked' tip, Layers lock/hide rows not built. |
| ed-obj-order | dark | differs | Same. |
| ed-lay-auto | light | differs | No token stops ruler / Gap menu (Space 4…64, Auto, 'A number, no token…'); Gap is 'Bind' + raw 24 not a 'Space 24' chip; Padding two stacked fields; Layout is below Position/Size (board Layout first); Align is a 3x3 dot grid ok; no 'Services → Auto layout' tag, no hint pill; Convert row not shown. Selection is the whole row 1328×111, not the Services frame. |
| ed-lay-auto | dark | differs | Same. |
| ed-lay-reorder | light | differs | No lifted/rotated card with a card-sized slot and '1' disc; hint pills row absent; shot is the page fit not the zoomed state (cannot confirm closed). |
| ed-lay-reorder | dark | differs | Same. |
| ed-lay-free | light | differs | Selection is a text node not the Datum frame; no magenta 64 distance chips, no Constraints diagram / free-placement tip card (fix-c3 open #6). |
| ed-lay-free | dark | differs | Same. |
| ed-text-edit | light | differs | Edit ring + halo now drawn with no handles (fixed). Remaining: Inspector is Type → Position → Size with 'English' language and no Czech hint line, no 'Uses <brand> system' style Plakát, Font/Size row values ('650' overlap garbled in weight cell), text overflows frame. Breadcrumb title joined. |
| ed-text-edit | dark | differs | Same. |
| ed-text-style | light | differs | Board's 3-state specimen (Plakát style, changed-value dot + Reset, Detach) not drawn: fixture has no text style ('No style', no dot/Reset/'Change Plakát in the Design system'). Cannot confirm. |
| ed-text-style | dark | differs | Same. |
| ed-shape | light | differs | A text node is selected, not the Podklad shape: no Shape section, four corner fields, radius dots, More menu (Line/Ellipse/Polygon/Crop/Export area). |
| ed-shape | dark | differs | Same. |
| ed-pen | light | differs | Hint pills are now four light pills (fixed). Remaining: drawn path is a 3-point angular polyline in the hero picture, not a close-up smooth curve with Smooth/Sharp tags and 'Click here to close'; no point inspector (Corner, X·Y, Stroke, Ends, Combine shapes, key list) — the inspector slot shows the empty-state line. |
| ed-pen | dark | differs | Same. |
| ed-img | light | differs | Crop mode close-up, faded photo beyond frame, corner brackets, Adjust (Look/Remove background), Zoom field, assets panel not built / not on screen (no fix file closes them). |
| ed-img | dark | differs | Same. |
| ed-comp-pick | light | differs | Picker rows / variant chip row / place tag / description leak ('Tabs (this system …') not closed by any fix file; centred over the toolbar not beside the target. |
| ed-comp-pick | dark | differs | Same. |
| ed-comp-instance | light | differs | Tag 'Button · 64 × 32' vs board '◇ Tlačítko · Plné', no variant flyout, no override dots, no 'N changes from …' + Reset (fix-c3 open #6). |
| ed-comp-instance | dark | differs | Same. |
| ed-inspector | light | differs | Button card sections not the board's full set (Effects, Type, Interaction On click/On hover, Export 'This object', folded Advanced with 'Tokens it uses', Constraints diagram, Align tile); 'Bind' on Corners instead of 'Round' token chip. (Convert now in Advanced, titles are words.) |
| ed-inspector | dark | differs | Same. |
| ed-edge-ai | light | differs | S: AI-owns-the-footer state not drawn (dashed spark outline, 'AI is drawing the footer' tag, tip, inspector line); needs a signed-in AI run / stub. |
| ed-edge-ai | dark | differs | Same. |
| ed-edge-ask | light | differs | ⌘/ composer is a 446 px field with accent chip + send square, not the compact pill + 'One step — ⌘Z undoes all of it' tip; no AI scope outline / 'AI is adding a link to 3 cards' tag. |
| ed-edge-ask | dark | differs | Same. |
| ed-edge-huge | light | differs | Whole 6000 px page fit and selected as an artboard, no sticky name pill, minimap sheet or '1727–5636 of 6000' line; section 'Tým' not selected. |
| ed-edge-huge | dark | differs | Same. |
| ed-edge-undo | light | differs | Popover has two rows ('Moved See work later', 'Placed a component') + Version history; no AI row ('Footer — 14 changes, one step'), no people rows, no 'Tereza's changes are hers to undo', no 'Would undo · 14 changes' hover tag; avatar grey 'YO' not tone-filled; popover opens left of the island below the canvas. |
| ed-edge-undo | dark | differs | Same. |
| ed-edge-paste | light | differs | S: no paste bar ('Pasted from Figma as an image…· Make editable'), no placed picture, no Image inspector 'From Figma'; needs a Figma-paste stub. |
| ed-edge-paste | dark | differs | Same. |
| ed-edge-keys | light | differs | Focus ring now replaces selection chrome (fixed in code) but impl badges are dashed '1.1 / 1.2 / 1.3 / 1.4' pills over the content, not solid 1…6 discs outside the left edge with 4.1–4.3 children; the whole artboard is ringed not the Services row; Undo popover open in shot; ⌘-arrow resize chord (a11y) open. |
| ed-edge-keys | dark | differs | Same. |
| ed-edge-tereza | light | unreachable | needs a second synced collaborator; a presence stub painting a sky ring + name on one object and flipping the inspector to the read-only view (`editing/hold-rings.tsx`, `client/v2/inspector/view-mode.jsx`) would make it shootable |
| ed-edge-tereza | dark | unreachable | Same. |

```json
{"canvas":"14 Editing","dir":"14-editing","match":[],"match_one_theme":{},"differs":["ed-ab-select", "ed-ab-resize", "ed-ab-arrange", "ed-ab-tidy", "ed-ab-menu", "ed-obj-enter", "ed-obj-multi", "ed-obj-order", "ed-lay-auto", "ed-lay-reorder", "ed-lay-free", "ed-text-edit", "ed-text-style", "ed-shape", "ed-pen", "ed-img", "ed-comp-pick", "ed-comp-instance", "ed-inspector", "ed-edge-ai", "ed-edge-ask", "ed-edge-huge", "ed-edge-undo", "ed-edge-paste", "ed-edge-keys"],"unreachable":["ed-edge-tereza"]}
```
