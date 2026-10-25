# Phase 8 fidelity — 14 Editing (stage A evidence)

Branch p8-fid-g5 from feat/maude-v2 6d780ab1b. SPEC = the board artboard rendered 1:1 from a scratch copy of `.design/ui/v2/14 Editing.tsx` through the capture origin (app theme light / dark; the designs inside an artboard stay theme-pinned, as designed). IMPL = the release-built v2 app (Playwright Chromium 1440×900 with a `window.__TAURI__` stub, throwaway HOME/XDG, `claude` stubbed signed-out, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`) driven into the artboard's state; theme set through prefs.json `theme`. Pairs: spec left, impl right, label strip `<id> · <theme>`; the artboard is padded (grey) to the taller side so nothing is rescaled in the full-size copy.

Full-size pairs: see `full-size-path.txt`. Committed copies here are JPEG q55, max 1100 px wide (an artboard larger than 1440 px wide is therefore small — read the full-size one).

**26 artboards · 52 pairs (26 × light + dark where drawn) · impl reachable: 5 yes, 18 partially, 3 no.**

Reading the impl side: most artboards are a 1440×900 window plus an 80 px note strip (the spec is 1440×980 — the grey band under the impl is that strip, not a defect). Close-up artboards (a sheet, a menu, several panes side by side) depict a region; the impl is the whole window with that region on it — the "how reached" column says where to look.

## Method notes for this canvas

- IMPL fixture: a scratch project with `maude-v2` as its system and plain-code canvases: Homepage (Desktop 1440 / Tablet / Mobile — nav, hero, three service cards, footer), Combine-kampaň (four 1:1 posts, two 9:16 stories, a data-URI photo) and a 6-section 6000 px club page. Objects carry `data-cd-id`s but no designer layer names, no text styles and no token-bound values, so token chips ("Space 24", "Round"), named layers ("Services › Brand systems") and style overrides cannot match the board — they show as `div`, raw numbers + "Bind", "No style".
- Driven with Playwright mouse/keyboard (the canvas is a cross-origin iframe; frame locators + `__maudeCanvasRects`). Frames are the whole 1440×900 window, not crops; close-up artboards (`ed-ab-menu`, `ed-obj-order`, `ed-lay-reorder`, `ed-text-style`, `ed-pen`, `ed-inspector`, `ed-edge-keys`) depict a region, so the impl frame shows the same state at a different scale/framing.
- AI states (`ed-edge-ai`, `ed-edge-ask` second half, `ed-edge-undo` AI rows) are the signed-out path: `claude` is stubbed, the panel shows "Connect your Claude account?".
- **Dark.** Dark pairs spot-checked: `ed-comp-pick`, `ed-edge-ai`, `ed-edge-ask`. Same differences as light. Dark-only: in the impl the bottom toolbar looks dimmed/translucent in `ed-comp-pick` and `ed-edge-ai` (spec toolbar is solid); the spec dark chrome shows a dark artboard backdrop while the user's design stays light (theme-pinned) — impl does the same.


| id | theme | state (as the board draws it) | how reached | impl reachable? | first-glance differences |
| --- | --- | --- | --- | --- | --- |
| `ed-ab-select` | light | Select an artboard (name chip with size, eight handles, artboard inspector) | open canvas, click the artboard name; left panel folded, inspector on | yes | Same anatomy: azure name chip with size, handles, inspector "Desktop · Web page" with Preset, Size, Height (Fits content/Fixed), Clip, Fill, Layout, Export, Other widths. Impl has no "Preset" dropdown label row exactly as spec (it reads "Width: Desktop · 1440"); impl has a floating "Export 1 file" button block the board does not draw. Artboard height differs only because the fixture is shorter. Spec window chrome (traffic lights, tab strip, avatars T/J, "Saved") is board decoration; impl shows project pill + "Local project". |
| `ed-ab-select` | dark | Select an artboard (name chip with size, eight handles, artboard inspector) | open canvas, click the artboard name; left panel folded, inspector on | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-ab-resize` | light | Resize — drag an edge, it clicks onto presets; ruler lights Laptop 1280 | drag the selected artboard's right edge inward | yes | Impl shows the preset ruler label ("Tablet 834"), a vertical guide, a size pill and the hint chips "⌘ ignores presets · ⌥ from the centre". The pill value looks wrong for the drag (reads like "1857 × 1858" while the artboard shrank) — verify at full size. Spec pill is azure with "Laptop · 1280 × 1573" and the ruler is a drawn scale with the preset magenta; impl ruler is a single text label. |
| `ed-ab-resize` | dark | Resize — drag an edge, it clicks onto presets; ruler lights Laptop 1280 | drag the selected artboard's right edge inward | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-ab-arrange` | light | Move one — smart guides, magenta equal-gap chips, position pill | drag the fourth post toward the row (Combine-kampaň) | partially — drag works; guides/gap chips are not visible in the frame | Impl frame shows the moved artboard selected with handles and a size chip but no magenta guide lines or "80" gap chips and no position pill; may need the drag to be within snapping range of siblings. Spec shows three gap chips and the "X 3480 · Y 0" pill next to the pointer. |
| `ed-ab-arrange` | dark | Move one — smart guides, magenta equal-gap chips, position pill | drag the fourth post toward the row (Combine-kampaň) | partially — drag works; guides/gap chips are not visible in the frame | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-ab-tidy` | light | Several at once — floating bar with align, distribute, Tidy up; dashed preview of one even row | marquee over the artboards | partially — the bar appears; the dashed preview is not shown | Impl bar: "3 artboards · align icons · Tidy up" above the selection (spec "4 artboards …" plus a tooltip "One row, even gaps"). Dashed outlines of the tidy preview are missing in the frame (hover on Tidy up not done). Inspector for the multi-selection (Mixed values, "4 artboards") not open in the frame. Selection marquee count is 3 vs 4 because the fixture has 6 artboards in two rows. |
| `ed-ab-tidy` | dark | Several at once — floating bar with align, distribute, Tidy up; dashed preview of one even row | marquee over the artboards | partially — the bar appears; the dashed preview is not shown | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-ab-menu` | light | The artboard's own menu; Duplicate at another width submenu; ⌘D copy; double-click rename | right-click the artboard name | partially — menu opens; the submenu, ⌘D result and rename field are not shown | Menu in impl: Ask AI about "Desktop", Duplicate, Duplicate at another width ▸, Rename, Add comment, Start a vote…, Export…, Advanced ▸, Move to trash. Spec menu also has Copy, Paste and an Export… shortcut; it does not list Add comment / Start a vote. The spec's two other panels (copy lands at the same gap with a "120" chip; in-place rename with a long-name tooltip) are not reached in one frame. |
| `ed-ab-menu` | dark | The artboard's own menu; Duplicate at another width submenu; ⌘D copy; double-click rename | right-click the artboard name | partially — menu opens; the submenu, ⌘D result and rename field are not shown | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-obj-enter` | light | Double-click goes inside a frame; dashed outline; inspector names the path; Layers shows the selection | select Services, double-click into Brand systems | partially — entering works; names and Layers sync differ | Impl breadcrumb reads "Desktop › div › div › div › div" and the inspector title is "div · Frame" — generic tag names where the spec says "Services › Brand systems". Layers panel is closed in the frame (spec has it open and highlighted). Position/Size/Layout/Fill/Corners sections are present ("Set by Services · 2 of 3" line exists). IMPL fixture is a plain-code Homepage / Combine-kampaň (no named layers, no system styling), so object names and token chips are not the board's Studio site copy. |
| `ed-obj-enter` | dark | Double-click goes inside a frame; dashed outline; inspector names the path; Layers shows the selection | select Services, double-click into Brand systems | partially — entering works; names and Layers sync differ | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-obj-multi` | light | Multi-select — inspector shows shared values and "Mixed"; align bar | ⇧-click headline, sub and button | partially — shift-click did not produce a multi-selection in this run (the artboard frame ended up selected) | Impl frame shows the root frame selected (1440 × 1050) and the single-object inspector, no "3 objects" bar, no Mixed values, no align bar. Could be a driving problem (the click path inside nested frames); re-check in stage B with the Layers panel. |
| `ed-obj-multi` | dark | Multi-select — inspector shows shared values and "Mixed"; align bar | ⇧-click headline, sub and button | partially — shift-click did not produce a multi-selection in this run (the artboard frame ended up selected) | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-obj-order` | light | Nudge/frame/order/lock/hide: the object menu, a locked object tip, Layers lock/hide | right-click the button | partially — object menu only | Impl menu: Ask AI, Duplicate, Copy/Paste properties, Select matching, Frame selection ⌥⌘G, Remove frame, Bring to front/forward, Send backward/back, Lock ⇧⌘L, Hide, Advanced, Remove. Spec menu also has Cut/Copy/Paste. The nudge chips (distances, "Y 434"), the locked-object tip ("Logo is locked — unlock") and Layers lock/hide rows are not reached. |
| `ed-obj-order` | dark | Nudge/frame/order/lock/hide: the object menu, a locked object tip, Layers lock/hide | right-click the button | partially — object menu only | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-lay-auto` | light | Auto layout — gap and padding are tokens; drag a gap, it clicks through Space stops | select the Services row; inspector Layout | partially — layout inspector reached; no token popup or ruler | Impl inspector: Layout Direction, Gap 24 (with "Bind"), Spacing Packed/Space between, Padding H/V, Align grid, "Convert children to absolute position". Values are plain numbers with "Bind" — the spec shows "Space 24" token chips and a stops menu (Space 4 … 64) plus a ruler with 12/16/24/32/48. IMPL fixture is a plain-code Homepage / Combine-kampaň (no named layers, no system styling), so object names and token chips are not the board's Studio site copy. |
| `ed-lay-auto` | dark | Auto layout — gap and padding are tokens; drag a gap, it clicks through Space stops | select the Services row; inspector Layout | partially — layout inspector reached; no token popup or ruler | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-lay-reorder` | light | Drag to reorder — the lifted card follows, an empty slot opens; Layers shows the same slot | drag Small apps toward the front of Services | partially — drag shows a slot marker and a "moves to 3 of 5" pill; lift not clear | Impl shows the slot marker "3" and a pill "… moves 3 of 5" that is clipped by the left window edge; the lifted card is not visible at the frame scale. No frame-by-frame reflow strip (spec close-ups) — those are specimen content. Gaps are measured (magenta 24 chips). |
| `ed-lay-reorder` | dark | Drag to reorder — the lifted card follows, an empty slot opens; Layers shows the same slot | drag Small apps toward the front of Services | partially — drag shows a slot marker and a "moves to 3 of 5" pill; lift not clear | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-lay-free` | light | Free placement with constraints (Right/Top keeps 64 from the corner) | select the date badge on a post | yes | Inspector has Position + Constraints (Left/Top pickers, a pin diagram) like the spec. Impl badge is Left/Top by default (fixture), spec shows Right/Top and a Layers tree on the left. Magenta 64 distance chips are shown in the spec only. |
| `ed-lay-free` | dark | Free placement with constraints (Right/Top keeps 64 from the corner) | select the date badge on a post | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-text-edit` | light | Edit text in place; style first; Language Čeština with one-letter ties drawn | double-click the headline and type | partially — inline editing works; type inspector and Czech ties differ | Impl inline editor is active (text typed). The inspector title reads "h1.dc-text-editing · Text" — an internal class name leaks into the layer name. Type section shows Style "No style", Font, Size·weight with Bind; no Language row, no tie arcs, no style-first ordering ("Plakát" style). |
| `ed-text-edit` | dark | Edit text in place; style first; Language Čeština with one-letter ties drawn | double-click the headline and type | partially — inline editing works; type inspector and Czech ties differ | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-text-style` | light | A style, an override dot + Reset, a detach (three close-ups) | select the title | partially — a text inspector is shown; no styles exist to override | Impl Type section: "Style: No style … This text follows no style. Use a style". The dotted-override / "Reset" / "Update … for every canvas" / Detach states need a text style in the system; none exists in the converted fixture system. |
| `ed-text-style` | dark | A style, an override dot + Reset, a detach (three close-ups) | select the title | partially — a text inspector is shown; no styles exist to override | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-shape` | light | Shape — kind, each corner, fill, border, effects; More menu (Line, Ellipse, Polygon, Crop, Export area) | select the shape behind the date | partially — a text element was selected instead of the shape; More menu not opened | Impl inspector shows Corners "All 0" with a link toggle, Border, Effects (Flat/SM/MD/LG) and Opacity — structure close to the spec, but no Kind row (Rectangle/Ellipse…) and four separate corner fields are not shown. IMPL fixture is a plain-code Homepage / Combine-kampaň (no named layers, no system styling), so object names and token chips are not the board's Studio site copy. |
| `ed-shape` | dark | Shape — kind, each corner, fill, border, effects; More menu (Line, Ellipse, Polygon, Crop, Export area) | select the shape behind the date | partially — a text element was selected instead of the shape; More menu not opened | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-pen` | light | Pen — draw, then points, handles, bend | press P, click three points | partially — drawing works; point/handle editing not reached | Impl shows a drawn polyline over the hero image and the bottom hint bar ("Click — a sharp point · Drag — a smooth one · ⇧ 45° steps · ↵ or esc — finish, open"). Spec also shows the finished path with Smooth/Sharp tags, a point inspector (Corner type, X/Y, Stroke Ends Round/Flat, Combine shapes) and a hints card. The hint bar is much wider/darker than the spec's pills. |
| `ed-pen` | dark | Pen — draw, then points, handles, bend | press P, click three points | partially — drawing works; point/handle editing not reached | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-img` | light | Image — place, then crop mode (the whole photo faded beyond the frame; ↵ done) | select the photo, double-click | partially — crop mode reached; faded full photo not drawn | Impl shows crop handles and the hint "↵ done · esc cancel" under the image; the inspector has Image · Replace…, Fit (Fill/Fit/Crop/Tile). No Zoom field, Adjust or "Remove background" rows (spec), and the faded outside-the-frame photo is not visible. |
| `ed-img` | dark | Image — place, then crop mode (the whole photo faded beyond the frame; ↵ done) | select the photo, double-click | partially — crop mode reached; faded full photo not drawn | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-comp-pick` | light | Component ⇧I — list from the Design system (Brand / Components / Patterns), variant chips, "Open Design system" | press ⇧I | yes | Picker opens with search, system name, Brand (Logo, Icon), Components (Button … Tooltip) and "Open Design system". Spec adds a Patterns group, an inline variant chip row (Plné · Obrys) under the focused component and a place label on the canvas ("Tlačítko · Plné"). Impl picker is anchored over the Tablet artboard and clips it; row labels are long ("Tabs (this system switches views with…"). |
| `ed-comp-pick` | dark | Component ⇧I — list from the Design system (Brand / Components / Patterns), variant chips, "Open Design system" | press ⇧I | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-comp-instance` | light | An instance — override text/colour, swap variant, detach | place a Button from ⇧I, select it | yes | Impl inspector: "Button · Instance", Component, Variant, "Your text and colour come along", Content Text, "Follows Button". Overrides (dots), "2 changes from Button · Reset", "Update Button for every canvas" and Go to / Detach are not shown (no overrides made). |
| `ed-comp-instance` | dark | An instance — override text/colour, swap variant, detach | place a Button from ⇧I, select it | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-inspector` | light | The inspector for one button — eleven sections with token chips (Position, Size, Layout, Fill, Corners, Border, Effects, Type, Interaction, Export, Advanced) | select the button; inspector open | partially — most sections present; Interaction, Export and token chips are not | Impl has Position, Size (Fixed), Layout, Fill, Corners (999 + Bind), Border, Effects, Type… but no Interaction (On click / On hover) and no Export section for an object, and no "Tokens it uses" chip row; values show as raw numbers + "Bind". The spec close-up is 1860 px tall with numbered callouts; impl is a normal-height panel that scrolls. |
| `ed-inspector` | dark | The inspector for one button — eleven sections with token chips (Position, Size, Layout, Fill, Corners, Border, Effects, Type, Interaction, Export, Advanced) | select the button; inspector open | partially — most sections present; Interaction, Export and token chips are not | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-edge-ai` | light | AI edits the footer while you edit the headline; "AI is drawing the footer" tag; tip "Footer is AI's until it's done" | AI panel, send a request | no — AI signed out; the panel shows "Connect your Claude account?" | No AI-owned region, no tag, no tip. The panel itself shows the connect card (Claude Pro or Max) and suggestion chips ("Same on the other artboards", "Try a variation", "Explain what changed") and a "+ desktop" scope chip. |
| `ed-edge-ai` | dark | AI edits the footer while you edit the headline; "AI is drawing the footer" tag; tip "Footer is AI's until it's done" | AI panel, send a request | no — AI signed out; the panel shows "Connect your Claude account?" | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-edge-ask` | light | ⌘/ on a selection: AI works in place inside those three cards; one undo step | select the Services row, press ⌘/ | partially — the inline "Ask AI…" composer appears with a "1 element" chip; no AI run | Impl: composer anchored under the row with scope chip; the selected children show numbered path pills ("1.3.2.1 …") that the board does not draw. Spec: the three cards outlined with a tag "AI is adding a link to 3 cards" and a tip row ("Add a Read more link…", "⌘Z undoes all of it"); Layers panel open. |
| `ed-edge-ask` | dark | ⌘/ on a selection: AI works in place inside those three cards; one undo step | select the Services row, press ⌘/ | partially — the inline "Ask AI…" composer appears with a "1 element" chip; no AI run | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-edge-tereza` | light | Tereza is editing the same button — sky ring + name, fields read-only, one action: Comment | — | no — needs a second collaborator | No presence ring or "Tereza is editing" inspector note. |
| `ed-edge-tereza` | dark | Tereza is editing the same button — sky ring + name, fields read-only, one action: Comment | — | no — needs a second collaborator | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-edge-huge` | light | A 6000 px page: name sticks to the top, minimap, "You're looking at 1727–5636 of 6000", ⌘0 fits | open the long page, select, zoom in | partially — page selected and fits; minimap and "looking at" line not shown | Impl shows the whole page fit in the window with the chip "Klub · Desktop 1440 × 6000"; inspector says "6000 now — grows as you add". No minimap sheet, no sticky name while scrolled. |
| `ed-edge-huge` | dark | A 6000 px page: name sticks to the top, minimap, "You're looking at 1727–5636 of 6000", ⌘0 fits | open the long page, select, zoom in | partially — page selected and fits; minimap and "looking at" line not shown | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-edge-undo` | light | Undo across AI and you — Undo history list, "Would undo 14 changes" tag | Menu/⌘K › Undo history | partially — popover opens with few rows | Impl popover "Undo history · newest first": "Placed a component · You · 1 min ago ⌘Z" and "Version history ⌥⌘H". The spec lists AI steps ("Footer — 14 changes, one step"), people's steps, and the hover tag over the canvas — no AI rows here (signed out), no tag, popover sits at the bottom-left rather than the left rail. |
| `ed-edge-undo` | dark | Undo across AI and you — Undo history list, "Would undo 14 changes" tag | Menu/⌘K › Undo history | partially — popover opens with few rows | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-edge-paste` | light | Pasted from Figma — bar "Pasted from Figma as an image of Hero / v3 · Make editable" | synthetic Figma clipboard paste on the artboard | no — the synthetic paste produced no bar (the picture is fetched through the Figma connection) | No paste bar, no placed picture; Make editable needs Dev Mode. Real clipboard from Figma not available in this lane. |
| `ed-edge-paste` | dark | Pasted from Figma — bar "Pasted from Figma as an image of Hero / v3 · Make editable" | synthetic Figma clipboard paste on the artboard | no — the synthetic paste produced no bar (the picture is fetched through the Figma connection) | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `ed-edge-keys` | light | Keyboard only: Tab walks objects, ↵ goes inside, esc out; focus ring | select artboard, ↵, Tab ×4 | partially — numbered focus pills show; no VoiceOver caption | Impl shows numbered markers (1.1, 1.2, 1.3, 1.4) on the artboard's children and an inspector; spec draws numbered rings and an adjoining shortcut table plus the VoiceOver sentence (documentation specimen). Focus ring thickness/halo not verifiable at this scale. |
| `ed-edge-keys` | dark | Keyboard only: Tab walks objects, ↵ goes inside, esc out; focus ring | select artboard, ↵, Tab ×4 | partially — numbered focus pills show; no VoiceOver caption | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |

## After (stage D, 6d19daa9a) — IMPL re-shot on the stage-C-round-2 tip

Re-shot 50 of 52 pairs; 2 unreachable. SPEC side: `.design/ui/v2/14 Editing.*` is unchanged since the stage-A shot, so the stage-A spec PNGs are reused. The committed JPEG pairs in this folder are overwritten with the stage-D pairs (same format and size as stage A); the stage-A IMPL frames are in the first section of this file (their pairs are in git history, commit 902d112ac).

- Shot with the stage-A harness (scenarios s14a/b/c on the Studio site and Alligators fixtures), same fixtures and driving as stage A, on the stage-C-round-2 tip. Harness fix only: the What’s-new toast dismiss (the toast’s first button is now "See all (3)" and opened the panel) — no product code changed.
- `ed-edge-tereza` stays unreachable: another person’s presence needs a second synced collaborator, none in a local lane.

| id | theme | after (stage D) | spec |
| --- | --- | --- | --- |
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-menu` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-menu` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-ai` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-ai` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-tereza` | dark | unreachable — Another person's presence (sky ring + name on an object, fields read-only) needs a second synced collaborator; none locally. | spec reused (board unchanged since stage A) |
| `ed-edge-tereza` | light | unreachable — Another person's presence (sky ring + name on an object, fields read-only) needs a second synced collaborator; none locally. | spec reused (board unchanged since stage A) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-img` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-img` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-pen` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-shape` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since stage A) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged since stage A) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged since stage A) |

## Round 3 re-shoot (p8-c3-modes)

IMPL re-shot after the round-3 modes / menus fixes; the committed <id>-<theme>.jpg pairs are overwritten for: ed-ab-menu. No match is judged here. Shot on the 04 fixture (Homepage, Desktop artboard) with the left panel folded; the SPEC image is the stage-A one.
## After (round 3, c3-inspect) — IMPL re-shot on the page-is-the-artboard tip

Re-shot 50 of 52 pairs (light + dark) with the g5 harness (`_d-harness-g5/`, round-3 notes in its README); `ed-edge-tereza` stays unreachable (stage-D pair kept). Spec side unchanged (board unchanged). What changed on screen: a click on the page selects the artboard (card: Preset · Size · Fill · Corners · Clip · Export), a click on an object selects the top object below the page, the inspector arrives with an artboard selection, an artboard drag from the page shows the lifted board + X·Y pill, crumbs fold to `Desktop › … › object`, Convert layout to absolute is in the folded Advanced, the empty inspector line is in v2 words. Harness drives changed (`s14a/b/c`: the page is no longer a rung of the double-click ladder; ⌘⇧-click for several objects; a bare right-click for the object menu). Details and open rows: `fix-c3-inspect.md`.

| id | theme | after (round 3) |
| --- | --- | --- |
| `ed-ab-select` | dark | re-shot |
| `ed-ab-select` | light | re-shot |
| `ed-ab-resize` | dark | re-shot |
| `ed-ab-resize` | light | re-shot |
| `ed-ab-arrange` | dark | re-shot |
| `ed-ab-arrange` | light | re-shot |
| `ed-ab-tidy` | dark | re-shot |
| `ed-ab-tidy` | light | re-shot |
| `ed-ab-menu` | dark | re-shot |
| `ed-ab-menu` | light | re-shot |
| `ed-obj-enter` | dark | re-shot |
| `ed-obj-enter` | light | re-shot |
| `ed-obj-multi` | dark | re-shot |
| `ed-obj-multi` | light | re-shot |
| `ed-obj-order` | dark | re-shot |
| `ed-obj-order` | light | re-shot |
| `ed-lay-auto` | dark | re-shot |
| `ed-lay-auto` | light | re-shot |
| `ed-lay-reorder` | dark | re-shot |
| `ed-lay-reorder` | light | re-shot |
| `ed-lay-free` | dark | re-shot |
| `ed-lay-free` | light | re-shot |
| `ed-text-edit` | dark | re-shot |
| `ed-text-edit` | light | re-shot |
| `ed-text-style` | dark | re-shot |
| `ed-text-style` | light | re-shot |
| `ed-shape` | dark | re-shot |
| `ed-shape` | light | re-shot |
| `ed-pen` | dark | re-shot |
| `ed-pen` | light | re-shot |
| `ed-img` | dark | re-shot |
| `ed-img` | light | re-shot |
| `ed-comp-pick` | dark | re-shot |
| `ed-comp-pick` | light | re-shot |
| `ed-comp-instance` | dark | re-shot |
| `ed-comp-instance` | light | re-shot |
| `ed-inspector` | dark | re-shot |
| `ed-inspector` | light | re-shot |
| `ed-edge-ai` | dark | re-shot |
| `ed-edge-ai` | light | re-shot |
| `ed-edge-ask` | dark | re-shot |
| `ed-edge-ask` | light | re-shot |
| `ed-edge-huge` | dark | re-shot |
| `ed-edge-huge` | light | re-shot |
| `ed-edge-undo` | dark | re-shot |
| `ed-edge-undo` | light | re-shot |
| `ed-edge-paste` | dark | re-shot |
| `ed-edge-paste` | light | re-shot |
| `ed-edge-keys` | dark | re-shot |
| `ed-edge-keys` | light | re-shot |
| `ed-edge-tereza` | dark / light | unreachable (needs a second synced collaborator) |

## After (round 4, c4-annot) — IMPL re-shot on the p8-c4-annot tip, both themes

Changed since round 3 (see `15-annotations/fix-c4-annot.md`): the gap / padding grips are not drawn at rest (the band chip is the grip), typing in place draws only the edit ring + halo (ed-text-edit), the keyboard focus ring replaces the selection chrome (ed-edge-keys), the pen hints are light pills (ed-pen), Layers drops the page-root row. `ed-ab-menu` keeps the round-3 (c3-modes) pair; `ed-edge-tereza` is still unreachable.

Re-shot with the committed stage-D harness `_d-harness-g5` (ids): `ed-ab-arrange`, `ed-ab-menu`, `ed-ab-resize`, `ed-ab-select`, `ed-ab-tidy`, `ed-comp-instance`, `ed-comp-pick`, `ed-edge-ai`, `ed-edge-ask`, `ed-edge-huge`, `ed-edge-huge-fit`, `ed-edge-keys`, `ed-edge-paste`, `ed-edge-undo`, `ed-img`, `ed-inspector`, `ed-lay-auto`, `ed-lay-free`, `ed-lay-reorder`, `ed-obj-enter`, `ed-obj-multi`, `ed-obj-order`, `ed-pen`, `ed-shape`, `ed-text-edit`, `ed-text-style`. The "after" pairs above are overwritten in place (`<id>-<theme>.jpg`); the full-size path is in `full-size-path.txt` ("round 4:").

## FINAL (stage D2, d3881fe41) — IMPL re-shot on the merged tip (all stage C rounds 1–4)

Re-shot 50 of 52 pairs; 2 unreachable. Supersedes the per-round "after" sections above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) now shows the merged product. The SPEC side is unchanged — the board `.design/ui/v2/14 Editing.*` has no commit after the stage-A shot, so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D2):").

- Frames driven: scenarios s14a/b/c on the Studio site and Alligators fixtures with the round-3 drill counts (the page is the artboard, ⌘⇧-click for several objects), same as `_d-harness-g5`. Also shot (no spec pair): `ed-edge-huge-fit`.
- `ed-edge-tereza` stays unreachable: another person’s presence needs a second synced collaborator, none in a local lane.

| id | theme | FINAL (D2) | spec |
| --- | --- | --- | --- |
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | dark | unreachable — Another person's presence (sky ring + name on an object, fields read-only) needs a second synced collaborator; none locally. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | light | unreachable — Another person's presence (sky ring + name on an object, fields read-only) needs a second synced collaborator; none locally. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## After (round 5, c5-inspector) - IMPL re-shot on the p8-c5-inspector tip, both themes
Re-shot: ed-ab-select, ed-ab-resize (the harness now drags the edge onto the Laptop 1280 preset, so the shot shows the lit ruler stop and "Laptop - 1280 x 1052"), ed-ab-menu, ed-obj-enter / -multi / -order, ed-lay-auto / -reorder, ed-text-edit, ed-inspector, ed-comp-pick, ed-pen. Changed in the product: the web page's artboard card is the board's (Preset, Size W-H, Height, Clip content, Fill > Background, Layout > Content, Export, Other widths last, no "Uses" line); the Advanced tokens group reads "Tokens it uses". Still open: the inspector does not follow a live resize, the digital card, Padding on one row, Instance Variant flyout (see `fix-c5-inspector.md`).

## FINAL (D3, 63592219a) — IMPL re-shot on the merged tip (stage C rounds 1–5 + bugs3)

Re-shot 50 of 52 pairs; 2 unreachable. Supersedes every earlier "after" / "FINAL" section above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) now shows the merged product. The SPEC side is unchanged — the board `.design/ui/v2/14 Editing.*` has no commit after the stage-A shot, so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D3):").

- Harness: `_d3-harness-g5/`. D3 changes: ed-comp-pick / ed-comp-instance select the artboard (label chip) before ⇧I and place the Button with the picker’s Enter (a click on empty canvas selects nothing, a row click only arms the ghost), the label press is by coordinates. The fixtures are the Studio site / Alligators brand ones, drill counts from round 3.
- Also shot (no spec pair): `ed-edge-huge-fit`.
- `ed-edge-tereza` stays unreachable: another person’s presence needs a second synced collaborator. `ed-edge-ai` is shot, but the AI is the stubbed signed-out one here (the "Connect your Claude account?" sheet shows, no run in progress) — the fake-agent harness (`_c3-ai-harness`) was not adapted to 14, so "AI is drawing the footer" is not reached.

| id | theme | FINAL (D3) | spec |
| --- | --- | --- | --- |
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | dark | unreachable — Another person's presence (sky ring + name on an object, fields read-only) needs a second synced collaborator; none locally. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | light | unreachable — Another person's presence (sky ring + name on an object, fields read-only) needs a second synced collaborator; none locally. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## After (round 6, c6-objinsp) - IMPL re-shot on the p8-c6-objinsp tip, both themes
Re-shot: ed-obj-enter, ed-lay-auto, ed-text-edit, ed-inspector, ed-comp-instance (the other ids keep their round-5 / D3 pairs). Changed in the product: an object a layout places reads "In <frame> - Set by <frame> - n of m" with a Place freely switch (no X / Y of its own); a frame that runs an auto layout and that nothing places leads with Layout then Size; Padding is one row (one chip when the four sides are alike, "H chip V chip" when they differ; the per-side icon is the Layout header's); token chips carry 14's token glyph and never wrap; the Size / weight pair no longer overlaps; a status sentence draws in its own soft box. Harness: the Homepage fixture is a bound project (space / radius tokens) with a real Book a call button pinned right / top; the Alligators title is lang="cs"; ed-text-edit is shot on the Alligators "Zapis se" post; ed-inspector in a tall window with Advanced opened. Still open: see `fix-c6-objinsp.md`.

| id | theme | status | spec |
|---|---|---|---|
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## After (round 6, c6-drag) — IMPL re-shot on the p8-c6-drag tip, both themes
Re-shot: ed-ab-select, ed-ab-resize, ed-ab-arrange, ed-ab-tidy, ed-lay-reorder, ed-edge-ask, ed-edge-undo (the other pairs are D3's, untouched). Changed in the product: the inspector follows an artboard edge drag (Width reads "Laptop · 1280" as the edge clicks onto the preset; new canvas → shell message `artboard-live-size`), the two resize hints are two pills, the reorder card is lifted (tilted, accent ring, deep shadow) with a card-sized slot, the Tidy-up bar clears the artboard name labels, no "Δ0" snap pill, and the tab-order pills / focus ring follow Tab and F6 only (a tool letter, Esc, a chord or an arrow no longer paints `1.2.1.1` over a pointer selection). Changed in the harness (`_d6-harness-g5/`): the drag states are now actually on screen — arrange lands exactly in the row (guide, three "80" chips, X · Y pill), Tidy up is hovered (dashed one-row preview + "One row, even gaps"), reorder zooms on Services and lifts a card. See `fix-c6-drag.md` for done / open.

| id | theme | round 6 | spec |
| --- | --- | --- | --- |
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## FINAL (D4, 21c9714cf) — IMPL re-shot on the merged tip (stage C rounds 1–6)

Re-shot 52 of 52 pairs; 0 unreachable. Supersedes every earlier "after" / "FINAL" / "Round" section above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) now shows the merged product. The SPEC side is unchanged (no commit to the board `.design/ui/v2/14 Editing.*` since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D4):").

- Harness: `_d4-harness-g5/` (see the 13 INDEX), plus `s14ai.mjs` (+ `h/fake-acp/g14-agent.mjs`) and `s14t.mjs` for the two newly reached states. 14 ids come from `s14a`/`s14b`/`s14c` (round-6 drag + objinsp versions).
- Also shot (no spec pair): `ed-edge-huge-fit`, `ed-edge-ai.chat`.

| id | theme | FINAL (D4) | spec |
| --- | --- | --- | --- |
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | dark | re-shot — NEWLY REACHED — signed-in AI through the fake agent edited through the design hook (`s14ai.mjs`, `h/fake-acp/g14-agent.mjs`): artboards carry "AI is working" tags and the chat shows the run with Stop (`ed-edge-ai.chat`, full-size only); the pair shows it with the headline selected. NOTE for the critic: the hold covers ALL THREE artboards of the canvas, not one footer element (the run holds whole artboards; no per-element ring drew for the footer edit), and the chat message list is squeezed to a sliver under a tall Inspector. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | light | re-shot — NEWLY REACHED — signed-in AI through the fake agent edited through the design hook (`s14ai.mjs`, `h/fake-acp/g14-agent.mjs`): artboards carry "AI is working" tags and the chat shows the run with Stop (`ed-edge-ai.chat`, full-size only); the pair shows it with the headline selected. NOTE for the critic: the hold covers ALL THREE artboards of the canvas, not one footer element (the run holds whole artboards; no per-element ring drew for the footer edit), and the chat message list is squeezed to a sliver under a tall Inspector. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | dark | re-shot — NEWLY REACHED — a second browser named Tereza (its `/_api/git-user` answered "Tereza") on the same studio selects See pricing (`s14t.mjs`); this browser sees her avatar "T" and a purple ring + "Tereza" tag. NOTE for the critic: the ring lands on the Hero FRAME, not the button, and this browser's inspector shows no "Tereza is editing See pricing" line even with the same button selected here. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | light | re-shot — NEWLY REACHED — a second browser named Tereza (its `/_api/git-user` answered "Tereza") on the same studio selects See pricing (`s14t.mjs`); this browser sees her avatar "T" and a purple ring + "Tereza" tag. NOTE for the critic: the ring lands on the Hero FRAME, not the button, and this browser's inspector shows no "Tereza is editing See pricing" line even with the same button selected here. | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## After (round 7, c7-edit2) - IMPL re-shot on the p8-c7-edit2 tip, both themes
Re-shot: every 14 id except ed-edge-tereza (needs a second browser; kept from D4). Harness (`_c7e2-harness-g5/`): Layers open beside the object (obj-enter / -multi / -order / lay-*), the Desktop board framed at ~60 %, ed-inspector = "Book a call" on an 1800 px page (the whole card incl. folded Advanced, Interaction "Open cal.com/studio" / "Lift to Floating"), ed-text-edit on the Alligators post, ed-img with Assets, edge-paste / edge-keys before the AI + Undo steps (no popover or panel left open). Product: the object inspector's "Uses <system>" row sits right under the name (an artboard keeps it at the foot, 13); several artboards caught by a marquee carry size/attrs/geometry so the card reads "Preset Mixed - Size 1080 x Mixed - Position Mixed - Mixed" and both themes shoot the same 3-board state; the component picker drops a system's own description after a row's name; the Tidy bar clears the name labels in both themes.

| id | theme | status | spec |
|---|---|---|---|
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## After (stage D, round 7 · p8-c7-edit3)

Re-shot, both themes: ed-inspector, ed-edge-keys, ed-edge-paste, ed-obj-order (the other 14 ids keep their round-7 edit2 pairs). Harness `_c7e3-harness-g5/` (flat fixture; s14e keys + paste; s14f obj-order; s14g inspector). Changed in the product: an object's Advanced fold reads CSS · Tokens it uses (chips) · Element id · Copy CSS · Convert layout (06's rows below, the v1 editor last); Tab walks the sections under the page (the page root is the artboard) with discs 1…6 in the page margin; a Figma-pasted picture opens on its Image card named by its frame. Side shots (not pairs): `side/ed-obj-order-nudge-{light,dark}.jpg`, `side/ed-obj-order-locked-{light,dark}.jpg`.

| id | theme | status | spec |
| --- | --- | --- | --- |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## FINAL (D5, e37e7d82a) — IMPL re-shot on the merged tip (stage C rounds 1–7)

Re-shot 52 of 52 pairs; 0 unreachable. Supersedes every earlier "after" / "FINAL" / "Round" section above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) shows the merged product at e37e7d82a. The SPEC side is unchanged (no commit to the board since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D5):").

Shot on the Mac mini (`scripts/remote-lane.sh`) with its installed Google Chrome (no Playwright browser there; `SHOT_CHANNEL=chrome`), harness `_d5-harness-g5/` = the newest layers per canvas flattened (see its README).
- Scenarios: `s14a`/`s14b`/`s14c` (studio + Alligators fixtures), then `s14e` (ed-edge-keys, ed-edge-paste), `s14f` (ed-obj-order + side shots), `s14g` (ed-inspector, Advanced open), `s14ai` (ed-edge-ai through the fake agent), `s14t` (ed-edge-tereza, a second browser) — later runs win. The fixture Homepage is the flat one of round 7 (edit3).
- Also shot (no spec pair): `ed-edge-huge-fit`, `ed-edge-ai.chat`, `ed-obj-order-nudge`, `ed-obj-order-locked`.

| id | theme | FINAL (D5) | spec |
| --- | --- | --- | --- |
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## After (round 8, p8-c8-edit) — IMPL re-shot on the p8-c8-edit tip, both themes
Re-shot: ed-lay-auto, ed-lay-reorder, ed-obj-multi, ed-obj-order, ed-comp-pick, ed-comp-instance, ed-edge-paste, ed-edge-keys, ed-edge-huge, ed-text-edit, ed-lay-free, ed-shape, ed-text-style, ed-img, ed-pen, ed-inspector (the other ids keep their D5 pairs). Harness: `_c8e-harness-g5` (mid-gesture states driven: gap held, card lifted, picker row highlighted, text in edit mode, crop mode, pen path in point editing; the Alligators fixture has a real Shape, a Datum frame, literal edit-in-place text and an asset photo). Product and open rows: `fix-c8-edit.md`.

| id | theme | state | spec |
| --- | --- | --- | --- |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged) |
| `ed-shape` | light | re-shot | spec reused (board unchanged) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged) |
| `ed-img` | dark | re-shot | spec reused (board unchanged) |
| `ed-img` | light | re-shot | spec reused (board unchanged) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged) |
| `ed-pen` | light | re-shot | spec reused (board unchanged) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged) |

## FINAL (D6, 3d58f57df) — IMPL re-shot on the merged tip (stage C rounds 1–8)

Re-shot 52 of 52 pairs; 0 unreachable. Supersedes every earlier "after" / "FINAL" / "Round" section above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) shows the merged product at 3d58f57df. The SPEC side is unchanged (no commit to the board since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D6):").

Shot on the Mac mini (`scripts/remote-lane.sh`) with its installed Google Chrome (no Playwright browser there; `SHOT_CHANNEL=chrome`), harness `_d6f-harness-g5/` = the newest layers per canvas flattened (see its README).
- Scenarios: `s14a`/`s14b`/`s14c` (studio + Alligators fixtures), then `s14e` (ed-edge-keys, ed-edge-paste), `s14f` (ed-obj-order + side shots), `s14g` (ed-inspector, Advanced open), `s14ai` (ed-edge-ai through the fake agent), `s14t` (ed-edge-tereza, a second browser) — later runs win; then the round-8 scripts `s14h` (studio: lay-auto, lay-reorder, obj-order, comp-pick, comp-instance), `s14i` (Alligators: text-edit, img, pen, lay-free, shape, text-style), `s14j` (edge-huge), `s14e` + `s14g` again. In the full chain the ed-comp-instance step of `s14h` timed out in both themes (the Text field never appeared after the picker); it was re-run alone (`chain.sh 14h`, `ONLY=comp-instance`) and that shot is the one kept. The fixture Homepage is the flat one of round 7 (edit3); Alligators is the round-8 fixture (assets, Datum frame over a real Shape).
- Also shot (no spec pair): `ed-edge-huge-fit`, `ed-edge-ai.chat`, `ed-obj-order-nudge`, `ed-obj-order-locked`.

| id | theme | FINAL (D6) | spec |
| --- | --- | --- | --- |
| `ed-ab-arrange` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-arrange` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-menu` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-resize` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-select` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-ab-tidy` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-instance` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-comp-pick` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ai` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-ask` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-huge` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-keys` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-paste` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-tereza` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-edge-undo` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-img` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-inspector` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-auto` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-free` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-lay-reorder` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-multi` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-obj-order` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-pen` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-shape` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-edit` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `ed-text-style` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
