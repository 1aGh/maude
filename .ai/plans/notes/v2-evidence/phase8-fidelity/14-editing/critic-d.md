# 14 Editing: critic-d, stage D re-check (V2-8.5)

One critic for the whole canvas (design, copy, a11y and signature lenses merged). Read-only. Inputs: the 50 re-shot stage-D pairs at full size (`.scr/pairs/14-editing/`), the stage B reports, and the stage C fix files. No `fix-*.md` exists for 14: C12 (dsedit) wrote "nothing new this round beyond C5" for 14, and the C2 inspector report (`08-artboard-kinds/fix-inspector.md`) lists the finer 14 rows as open. Dark pairs were read for `ed-ab-select`; the rest were checked against their light twin, because every remaining blocker below is content or state, not theme.

**Verdict: no artboard matches in either theme. 25 differ, 1 is unreachable (`ed-edge-tereza`).**

## Fixed since stage B (seen in the stage-D shots)

- Selection is the board's: 1.5 px outline, square handles, no halo (C5).
- HUD labels (pill, chips, hints) are in the body face, not mono.
- The dark toolbar is dark (the 1.47:1 washout is gone, seen in `ed-ab-select` dark).
- The inspector is a 264 px hug-height card with no title row.
- Code words as names are gone in most shots ("Frame", "Photo", "Button"; no "h1.dc-text-editing", no "2Q==").
- Names stay partly joined in the title ("Studio Work Services Pri...", "Product design Apps an...").

## Blockers that remain (named once, cited per id below)

| tag | blocker | lens | owner |
|---|---|---|---|
| U | Undo · Redo · zoom % island bottom-left not built (every artboard that draws it) | design | `toolbars/toolbar-css.ts`, `canvas-lib.tsx` |
| M | Context menus: no icon column, no Cut/Copy/Paste, red "Move to trash" / "Remove", text-glyph carets, Add comment / Start a vote groups | design + copy | `context-menu.tsx`, `editing/artboard-menu.tsx`, `object-menu.tsx` |
| R3 | Chrome at rest: numbered tab-order pills ("1.1", "1.3.2.1") stay over a pointer selection, magenta spacing dots over gap chips, rotate / corner dots | design + signature | `editing/tab-order.tsx`, `use-spacing-handles.tsx`, `gap-bands.tsx` |
| R5 | Inspector sections still the fixed order: Position/Size before Type; "Convert children to absolute position" button inline; no Interaction / Export / "Tokens it uses" / folded Advanced for a button; native selects | design | `client/v2/inspector/sections.js`, `sections/layout.jsx` |
| A | Artboard drag picks the root div; no guides, gap chips or X·Y pill | design | `input-router.tsx`, `artboard-handles.tsx` |
| S | State the board draws is not on screen (named per id) | design | harness or product |

## Per id (light = dark unless noted)

### ed-ab-select
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | U. Name chip icon is a globe, spec is the window glyph. Export section is 1x/PNG selects + "Export 1 file" + Copy/Export rows, spec is one "PNG · 2x" row (09 owns Export, so warning only). Artboard W/H + Clip switch are 08's call (not a blocker). |
| dark | differs | Same. Toolbar now correct. |

### ed-ab-resize
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | Ruler shows one tick "Tablet 834", spec the full scale with Laptop 1280 in magenta. Pill reads "1056 × 1051", chip "1062 × 1051", no "Laptop · 1280" (copy blocker from stage B, still there). Inspector does not follow the drag (stays "Desktop · 1440"). Warn glyph in the chip. Hint is one bordered box, spec two pills. U. |
| dark | differs | Same. |

### ed-ab-arrange
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | A. The impl selects "Frame 1080 × 1080" (object inspector with Position/Size/Layout/Fill), not the artboard. No magenta guides, no three "80" chips, no "X 3480 · Y 0" bubble. R3 (corner dots + tab-order pill). U. |
| dark | differs | Same. |

### ed-ab-tidy
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | Bar overlaps the artboard name labels. Glyphs are the heavy filled set. Inspector: "Custom", "— × —", "— · —", Background "Default" where the board says "Story 9:16 · 1080", W/H values, "Mixed". "3 artboards" vs the board's 4 (fixture). No Tidy-up preview or "One row, even gaps" tip. Export "Presets: 3 files…". U. |
| dark | differs | Same. |

### ed-ab-menu
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | M. Menu has no icons, no Copy / Paste, Add comment and Start a vote in their own groups, red "Move to trash". First row shows a focus ring on a mouse open. The artboard is not selected under the menu (no chip, no handles); the inspector card says "Press V, then click … or ⌘-click straight from Preview." (a v1 word, stage B copy blocker R2 is still there). No "Duplicate at another width" flyout, no ⌘D copy, no rename field. |
| dark | differs | Same. |

### ed-obj-enter
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | R3 (magenta dots over the chips, rotate button). Crumbs "Desk… › Fr… › Fr… › Frame" and title "Brand systems Logos, ty…" (joined text, not "Brand systems · Frame"). R5: "Convert children to absolute position" inline, "Place freely" is a button, Width field disabled "427" with no Fill. No token chips (fixture). No Layers panel. |
| dark | differs | Same. |

### ed-obj-multi
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | S. Multi-selection not formed: the shot is one root Frame. No "3 objects" bar, no Mixed values, no align bar, no "Rotate 15°" hint. Needs a re-drive through Layers or ⇧-click. |
| dark | differs | Same. |

### ed-obj-order
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | M. Object menu has no icons, no Cut / Copy / Paste, bare "Advanced ▸", red "Remove". Right-click selected the parent row ("See the work See pricing…", 683 × 46), not the button. Crumbs "Desk… › Fr… › Frame" and the joined-text title. No nudge chips, lock badge, "Logo is locked" tip or Layers lock/hide rows. R5 inline "Convert children…". |
| dark | differs | Same. |

### ed-lay-auto
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | R3: the magenta spacing dots still sit over the gap chips ("24" is unreadable at this size). No token stops menu and no ruler (12/16/24/32/48). Layout is not first. Padding is two stacked fields. Spacing seg still fill-only (a11y E2: selected option shown by a 1.19:1 fill). "Convert children…" inline. No "Services → Auto layout" tag, no hint pill. |
| dark | differs | Same. |

### ed-lay-reorder
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | No lifted card (rotated, shadowed, following the pointer). The slot is a full-row dashed band with a "3" pill, spec a card-sized slot with a "1" disc. Tag "ct designApps and … · moves to 3 of 5" is clipped by the window edge, mixes joined text, and the a11y clip warning stands. No hint pills row. Needs a re-drive: the shot is the whole page fit, not the zoomed state. |
| dark | differs | Same. |

### ed-lay-free
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | Selection is the text "SO 14/3", not the Datum frame. Distance chips: a tiny cluster ("14", "6"), not magenta "64" top + right. Inspector is Type-first for a text, spec is the Datum frame (Constraints, free-placement tip, one W · H row). Constraints are native selects. Language reads "English" on a text with Czech copy (fixture). |
| dark | differs | Same. |

### ed-text-edit
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | While typing, the resize handles and the size tag ("Calm software, made · 683 × 118") stay on; the board draws the 2 px edit ring with an accent-tint halo and no handles. Inspector is Position/Size after Type; no tie marks. Language is "English" with no Czech hint line (copy blocker from stage B, still there). Text overflows its frame while typing (siblings now sit under the headline, fixture-driven). Title is the long joined text. |
| dark | differs | Same. |

### ed-text-style
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs (cannot confirm: needs a text style in the fixture) | The board is a 3-state specimen: "Plakát" style, dot on one changed value + Reset, then Detach. The impl shows "No style" on COMBINE2026 with no dot, no Reset, no "Change Plakát in the Design system" line. R3 pills and the "330 / 64" distance chips over the heading. Title "COMBINE2026" is a joined word. |
| dark | differs | Same. |

### ed-shape
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | S. A text node ("So 14. 3. · Brno, Kraví hora", Text) is selected, not the Podklad shape. No Shape section, no four corner fields, no radius dots, no More menu with Line / Ellipse / Polygon / Crop / Export area. R3 pills + distance chip over the headline. |
| dark | differs | Same. |

### ed-pen
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | Hint is one dark bar above the toolbar, spec four light pills beside the path. The drawn path sits in the hero picture, not a close-up of a smooth curve with "Smooth" and "Sharp" tags and the "Click here to close" tag. No point inspector (Corner, X · Y, Stroke, Ends, Combine). The inspector slot shows the "Press V…" hint (v1 word). |
| dark | differs | Same. |

### ed-img
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | Crop mode is on a small thumbnail, no faded photo beyond the frame, no corner brackets. Inspector: "Photo" row with a pale thumb and "Replace…", Fit seg shows Fill pressed (Crop in crop mode), no Zoom field, no Adjust (Look · Remove background), no info line; then Position / Constraints / Size / Interaction / Export. R3 pills. No assets panel (board opens Assets). |
| dark | differs | Same. |

### ed-comp-pick
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | Picker rows ~21 px, transparent search, "maude-v2" as plain text; descriptions still leak in labels ("Tabs (this system switches views wit…", "Badge (this system marks status wit…"; stage B copy blocker). No variant chip row under the focused row, no place tag on the canvas. Centred over the toolbar, not beside the target. The Component slot is not pressed. |
| dark | differs | Same. |

### ed-comp-instance
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | Select no longer overflows (fixed). Still: tag "Button · 64 × 32" (board "◇ Tlačítko · Plné"), no variant flyout, no override dots, no "N changes from …" + Reset. Content rows read Text "Button" / Fill "None" / "Follows Button.", where the board has Text, Fill, Icon and the dots. Native selects. Instance is tiny and under the hero chip (state mis-framed). |
| dark | differs | Same. |

### ed-inspector
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | The selection is "See the work" (Button), correct kind. Sections run Position → Size → Layout → Fill → Corners → Border and stop at the viewport; the board's Effects, Type, Interaction (On click / On hover), Export (This object) and the folded Advanced with "Tokens it uses" are not in the shot or not present (R5, signature blocker from stage B). Constraints diagram and Align tile missing. "999 Bind" on Corners instead of "Round" token chip (fixture, but the Bind is not the board's). Joined-text crumbs. |
| dark | differs | Same. |

### ed-edge-ai
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | S. The AI-owns-the-footer state is not drawn: no dashed spark outline, no "AI is drawing the footer" tag, no "Footer is AI's until it's done" tip, no inspector line "AI is changing Footer…". The impl shows a collapsed AI card (with 1.1-1.4 tab-order pills on the artboard, R3) and a selected root Frame. Product side needs a signed-in AI run. |
| dark | differs | Same. |

### ed-edge-ask
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | The ⌘/ composer is a 446 px field with an accent "1 element" chip and an accent send square, not the compact pill + the separate "One step — ⌘Z undoes all of it" tip. Path pills "1.3.2.1 / 1.3.2.2 / 1.3.2.3" still sit over the cards (stage B copy + signature blocker, unchanged). No AI scope outline, no "AI is adding a link to 3 cards" tag. No Layers panel. |
| dark | differs | Same. |

### ed-edge-tereza
| theme | verdict | remaining blockers |
|---|---|---|
| light | unreachable | INDEX: needs a second synced collaborator. Product / stub work: a presence stub that paints a sky ring + name on one object, and flips the inspector to the read-only view with one "Comment" action (`editing/hold-rings.tsx`, `client/v2/inspector/view-mode.jsx`). |
| dark | unreachable | Same. |

### ed-edge-huge
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | The whole 6000 px page is fit and selected; chip "Klub · Desktop 1440 × 6000" is an accent chip with the size set at the right. No sticky name pill, no minimap sheet, no "You're looking at 1727–5636 of 6000" line. Selected is the artboard, not the section "Tým". Bottom handles still draw over the toolbar. |
| dark | differs | Same. |

### ed-edge-undo
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | The popover has one row ("Placed a component · You · 1 min ago") + Version history, sitting at the bottom-left over the canvas. No AI row ("Footer — 14 changes, one step"), no people rows, no "Tereza's changes are hers to undo", no "Would undo · 14 changes" hover tag with the dashed footer outline. Avatar is a grey "YO", not a tone-filled initial. Key shortcuts in bordered boxes. Tab-order pills ("1.2.2.1…") over the selection (R3). |
| dark | differs | Same. |

### ed-edge-paste
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | S. No paste bar ("Pasted from Figma as an image of "Hero / v3". · Make editable"), no placed picture, no Image inspector with "From Figma · Hero / v3" and the Dev Mode note. The shot shows the undo popover and the AI "Connect your Claude account?" card instead. Needs a Figma-paste stub that places an image and shows the bar. |
| dark | differs | Same. |

### ed-edge-keys
| theme | verdict | remaining blockers |
|---|---|---|
| light | differs | The focus ring is the selection ring with handles and a size chip (board: a 2.5 px `--focus-ring` + 7 px accent-tint halo, never a selection). Badges are dashed numbered pills at each child's top-left over the content ("1.1", "1.2", "1.3", "1.4" overlap), not solid round 1…6 outside the left edge with the focused one filled and children "4.1…". The Undo popover is open in the shot (noise). The a11y missing ⌘-arrow resize chord is still open. |
| dark | differs | Same. |

## Summary counts

- match: 0
- differs: 25 ids (50 theme rows)
- unreachable: 1 id (`ed-edge-tereza`, 2 theme rows)

```json
{"canvas":"14 Editing","dir":"14-editing","match":[],"match_one_theme":{},"differs":["ed-ab-select","ed-ab-resize","ed-ab-arrange","ed-ab-tidy","ed-ab-menu","ed-obj-enter","ed-obj-multi","ed-obj-order","ed-lay-auto","ed-lay-reorder","ed-lay-free","ed-text-edit","ed-text-style","ed-shape","ed-pen","ed-img","ed-comp-pick","ed-comp-instance","ed-inspector","ed-edge-ai","ed-edge-ask","ed-edge-huge","ed-edge-undo","ed-edge-paste","ed-edge-keys"],"unreachable":["ed-edge-tereza"]}
```
