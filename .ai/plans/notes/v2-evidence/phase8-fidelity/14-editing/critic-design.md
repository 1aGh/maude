# 14 Editing: design-critic, stage B (V2-8.5)

Lens: layout, spacing, sizes, type, colour and tokens, material, iconography, and every state the board draws (selection, handles, size pill, tool hints, inspector sections).
Inputs: `.design/ui/v2/14 Editing.tsx` + `.css`, `_kit.css`, DS `maude-v2` (`colors_and_type.css`, `preview/_components.css`), INDEX.md, and all 52 full-size pairs. Every light pair was read at full size, with crops. Dark pairs were read side by side at half size, with crops where something differed. No dark pair differs from its light pair except for the toolbar (X4). The work was read-only: no server was booted. Pixel colours were sampled with `magick`.

**Fixture rule.** These are not findings: the fixture has no designer layer names, no text styles and no token-bound values ("Bind", rgb(), "No style" and SM/MD/LG come from the `maude-v2` system); the artboards are fixed-width (no reflow); the AI path is signed out; there is no second peer and no Figma clipboard. Product fallbacks that print code words *are* findings (R4).

Severity: **B** = blocker (visibly different from the board, or a missing state). **W** = warning (close, sub-pixel, code-read only, or not captured in this lane).

---

## Cross-cutting fixes already in progress (named once, counted once)

| # | what | owner | sev |
|---|---|---|---|
| X1 | **v1 tokens.** The HUD accent is still v1 h268: light (58,90,215) vs spec (0,116,195). `canvas-hud-tokens.gen.ts` mixes v1 `--maude-hud-accent` (l.13, 33) with v2 `--maude-hud-accent-tint` (l.17, 37). Every chip, handle, tag, slot, pill, pressed tool, the "Uses …" line and the selected row is affected. | `apps/studio/canvas-hud-tokens.gen.ts:13,33`; shell `client/styles/1-tokens-maude.css` | B |
| X2 | **v1 kit in the inspector.** Native `<select>` (Width preset, Fixed/Fill, Content, constraints, Variant, Font), outlined buttons, mono numeric fields with a bordered lead cell. Spec: `.k-in-select`, `.ed-n` (bg-3 fill, no border, body font, type-sm). | `client/inspector-controls.jsx:509` (`st-cp-nsel`); `client/styles/3-shell-maude.css:2837-2871` (`.st-cp-numlead` / `.st-cp-numin`, `--font-mono`, type-xs) | B |
| X3 | **Docked inspector.** It runs full height with an "Inspector ×" title row. Spec: a 264–280 px floating card per board (`.k-insp` / `.ed-insp`), no title row, hugging its content. When AI opens, it stacks over the AI panel. | `client/inspector/inspector-panel.jsx:615-634` | B |
| X4 | **In-canvas HUD chrome: the Edit toolbar.** It keeps v1 geometry "on purpose": 32 px buttons, 4 px padding, radius 14, an active **underbar**, the divider after Hand instead of before More, and `backdrop-filter: none`. The 88 % island bg therefore **peeks through** a dark artboard in light (`ed-shape`). In **dark** it renders light grey (222,225,226) with pale icons, which is near-invisible: the iframe resolves `--island-bg` from the user's light-pinned design system, not the app theme. Glyphs differ: Shape is a square (spec is two shapes), Pen is a pen-nib, T is thin. The Undo · Redo · zoom % island bottom-left is not built ("ZoomUndo later"). Spec: `.dock` with 40 px buttons, padding `--space-2`, `--radius-xl`, pressed `--accent-muted` / `--accent-text`, no underbar (`_components.css:34-41,99-103`). | `apps/studio/toolbars/toolbar-css.ts:8-98`; `canvas-lib.tsx:4474` | B |

## Root causes of this canvas (counted once each)

| # | root cause | spec | impl | owner | sev |
|---|---|---|---|---|---|
| R1 | **Mono font across the HUD**: size pill, preset ruler, hints, guide/gap chips, align bar, reorder tag + slot number, tab badges, pen chips, inspector numbers. The DS says mono is "Advanced + code only". | `--font-body`, type-xs, semibold, tabular-nums (`.ed-chip`, `.ed-bubble`, `.ed-hint`, `.ed-bar-n`) | `--maude-chrome-font-mono` 10–12 px | `editing/preset-ruler.tsx:57,103,116`; `size-ghost.tsx:166`; `artboard-guides.tsx:158,163`; `align-bar.tsx:60,85`; `reorder-slot.tsx:275,287`; `tab-order.tsx:163`; `pen/overlay.tsx:24` | B |
| R2 | **Selection anatomy.** A 2 px border, a 4 px 18 % halo ring and four filled corner ticks sit under accent-filled resize handles (radius 3, white border, edges as 14×6 bars). At small zoom they merge into blobs (`ed-obj-enter`, `ed-lay-auto`). | 1.5 px `--accent` outline, no halo; eight 8×8 **`--bg-2` squares with a 1.5 px inset accent**, no radius, edges also 8×8 (`14 Editing.css:166,176-185`) | halo + ticks + filled handles | `apps/studio/canvas-shell.tsx:208-224`; `use-element-resize.tsx:41-58`; `editing/artboard-handles.tsx:155-168` | B |
| R3 | **Chrome on every selection at rest.** Corner-radius dots, a 22 px round rotate button with a shadow, v1 magenta spacing dots painted **over** the gap chips, and tab-order badges that stay after a pointer selection. | rotate only on corner hover (`ed-obj-multi`); radius dots only on shapes (`ed-shape`); gap bands while you edit a layout; badges only in keyboard mode (`ed-edge-keys`) | all at once | `editing/corner-dots.tsx`; `rotate-handle.tsx:54-58`; `use-spacing-handles.tsx` + `gap-bands.tsx`; `tab-order.tsx:159-173` | B |
| R4 | **Code words and raw text as names.** Tag fallbacks give "div · 1080 × 1080" and crumbs "Desktop › div › div › div". The inspector title shows the layers label: **"h1.dc-text-editing"**, "button". textContent is joined without spaces ("COMBINE2026", "Product designApps and …"). A data-URI image is named **"2Q=="**. | the kind word (Frame, Text, Button, Photo) when the designer gave no name | tag / class / base64 tail | `editing/crumbs.ts:47,53`; `client/v2/inspector/model.js:49-54`; `editing/reorder-slot.tsx:54`; `client/v2/inspector/kinds/image.jsx:55` | B |
| R5 | **Inspector sections are neither kind-gated nor ordered by kind.** Every kind gets one fixed order: Position → Size → Layout → Fill → Corners → Border → Effects → Type → Interaction. Text gets Corners/Border/Effects with **Type last**. An image in crop mode gets Position/Constraints/Size/Corners/Border/Effects/Interaction. An artboard multi-selection gets Interaction. An instance gets Position/Size/Layout under Content. | text: Type first (style first), Fill, Advanced (`ed-text-edit`); crop: Image, Adjust, Advanced (`ed-img`); instance: Component, Content, Main component, Advanced (`ed-comp-instance`); Border on boxes only (board header) | fixed list | `client/v2/inspector/sections.js:33-100` | B |
| R6 | **Object name tag** sits above, weight 500, padding 1/6, radius 3. | below (`top: 100% + 6px`), 20 px high, `--radius-xs`, semibold, size at 0.86 (`.ed-sel-tag`, `.ed-tag-q`) | above, medium | `editing/selection.tsx:166-178` | B |
| R7 | **Context menus (artboard and object).** No icon column. The danger row is red. The first row shows a focus ring when the menu is opened with the mouse. The caret is a text "▸". | `.k-menu` + `.k-mi-ic` 16 px icons in `--fg-2`, a kit chevron, plain Move to trash with a trash icon, focus only from the keyboard | — | `apps/studio/context-menu.tsx:203-271,562`; rows `editing/artboard-menu.tsx`, `editing/object-menu.tsx` | B |
| R8 | **Inspector head.** The crumbs wrap (`flex-wrap: wrap`) and push `esc` onto its own line, and the last crumb is not semibold. The kind chip sits next to the title instead of right-aligned. "Uses …" is a `--radius-md` box with an external-link icon. | `.ed-crumbs` nowrap + ellipsis, last crumb `--fg-0` semibold; the kind pill on the right; "Uses … system ›" pill with the system icon in a `--bg-2` circle + chevron | — | `client/v2/inspector/inspector.css:16-23,93-106`; `frame.jsx:206-212` | W |

---

## Per artboard (theme "both" = the same in light and dark; the dark-only toolbar is X4)

### ed-ab-select
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Artboard inspector rows | Preset · Size **W/H fields** · Height · **Clip content** switch | "Width" preset select; no W/H fields, no Clip switch | `client/v2/inspector/kinds/artboard-web.jsx` / `artboard-rows.jsx` | B |
| both | Name chip icon | the kind icon (window) | globe | artboard label, `canvas-lib.tsx` label icon | W |
| both | Export section | one row "PNG · 2x" + Other widths "Add a width" button | 1x/PNG selects, an "Export 1 file" button, Copy as PNG, Export… rows | `client/v2/inspector/sections/export-slot.jsx` | W |

### ed-ab-resize
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Preset ruler | the whole scale (Tablet 834 · **Laptop 1280** · Desktop 1440), on-tick + label in `--ed-guide` magenta | one tick text "Tablet 834"; on-tick in accent | `editing/preset-ruler.tsx:51-88` | B |
| both | Size pill disagrees with the chip | "Laptop · 1280 × 1573" | pill "1057 × 1050", chip "1063 × 1050", no preset word | `preset-ruler.tsx` bubbleText vs `artboard-handles.tsx` `data-ed-size` | B |
| both | Inspector doesn't follow the drag | Preset → Laptop · 1280, W field focused, "Drag the bottom edge to fix the height" line | stays "Desktop · 1440" | `kinds/artboard-web.jsx` | B |
| both | Hint material | separate `.ed-hint` pills: radius-pill, `--shadow-sm` + inset `--island-edge`, `Kbd` glyphs | one bordered box, radius 4, mono | `preset-ruler.tsx:108-123` | W |
| both | Extra marks | none | ⚠ glyph in the chip; a horizontal accent connector from the edge to the pill | `artboard-handles.tsx`, `preset-ruler.tsx` | W |
| both | Ghost outline | dashed `--fg-3` at the old size | dashed accent at 0.6 | `preset-ruler.tsx:42-49` | W |

### ed-ab-arrange
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Dragging the artboard body picks its **root div** ("div · 1080 × 1080", object inspector) instead of moving the artboard. No guides, gap chips or X·Y pill appear. | the artboard moves; magenta guides, three "80" chips, an "X 3480 · Y 0" bubble; artboard inspector with Position | object selection | artboard drag hit-test (`input-router.tsx` / `artboard-handles.tsx`) | B |
| both | Guide chip geometry (from the code) | 18 px, `--radius-xs`, padding 0 5 | 14/16 px line, radius 3–4 | `editing/artboard-guides.tsx:157-163` | W |

### ed-ab-tidy
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The bar overlaps the artboard name labels (placed from the bodies' top) | above the labels, with a gap | over "Story 9:16 · …" | `editing/align-bar.tsx:254-272` | B |
| both | Align/distribute glyphs are filled and heavy | DS line icons (`Icon`) | `fill="currentColor"` + stroke 1 | `align-bar.tsx:211-221` | B |
| both | Multi-artboard inspector values | Preset select "Story 9:16 · 1080"; W 1080 H 1920; X Mixed Y Mixed; Background swatches + "Mixed" | "Custom" as text; "— × —", "— · —"; "Default"; plus an **Interaction** section | `client/v2/inspector/kinds/multi-artboard.jsx` (+ R5) | B |
| both | Tidy up button | icon + label; the highlighted state is an inset accent ring | text only | `align-bar.tsx:73` | W |
| both | Export row | "PNG · 4 files · 2x" | "Presets: 3 files…" | `export-slot.jsx` | W |

The hover preview ("One row, even gaps" tooltip + dashed outlines) was not captured (`tidy-preview.tsx` exists).

### ed-ab-menu
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Menu rows | icons; Copy / Paste group; no Add comment / Start a vote | no icons; no Copy/Paste; Add comment and Start a vote… each in its own divider group (R7) | `editing/artboard-menu.tsx` | B |
| both | Right-click doesn't select the artboard | the artboard selected under the menu (chip + handles) | no selection; the inspector shows "Press V …" | `artboard-menu.tsx` / `context-menu.tsx` open path | B |

The "Duplicate at another width" flyout, the ⌘D copy with its "120" chip and the rename field were not captured.

### ed-obj-enter
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Layout › Advanced sits inline in the Layout section | folded at the foot ("Advanced · 7 properties") | a "Convert children to absolute position" button + 3 lines inside Layout | `client/v2/inspector/sections/layout.jsx` | B |
| both | Place freely | a switch row + one tip card | a button + two explanatory lines + a Rotation row | `sections/position.jsx` | W |
| both | Align control | compact 3×3 tile, 7 px dots, `--bg-3` (`.ed-ag`) | a ~66 px bordered 3×3 grid | `sections/layout.jsx` | W |
| both | Width field | value "400", Fill select with an icon | greyed disabled field "427" | `sections/size.jsx` | W |

R2, R3, R4 and R6 are all visible here. The Layers tab was not opened in the frame.

### ed-obj-multi
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Multi-select not captured: ⇧-click landed on the root frame | "3 objects" bar, Mixed values, align bar, Rotate hint | single root-div inspector | re-drive through Layers; bar = `align-bar.tsx` (findings as in ed-ab-tidy) | W |

### ed-obj-order
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Object menu | icons; Cut/Copy/Paste; Advanced note "Copy CSS · element id" | no icons, no Cut/Copy/Paste, bare Advanced, red Remove (R7) | `editing/object-menu.tsx` | B |
| both | Right-click selected the parent row ("div 683 × 46"), not the button | Book a call selected | parent | object hit-test on contextmenu | W |

Nudge chips, the lock badge, the "Logo is locked" tip and the Layers lock/hide rows were not captured.

### ed-lay-auto
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Gap chips "24" are illegible: the v1 magenta spacing dot is painted over each chip | a magenta band + white "24" chip (`.ed-band`, `.ed-chip`) | dot on top of the chip | `editing/gap-bands.tsx` + `use-spacing-handles.tsx` | B |
| both | Padding bands | a band along each padded edge | gap bands only | `gap-bands.tsx` | W |
| both | Section order | Layout first ("Layout · Auto"), then Size, then Advanced | Position, Size, Layout | `sections.js` (R5) | W |
| both | Padding row | one row: token chip + per-side icon | H and V fields stacked, expand icon on its own line | `sections/layout.jsx` | W |

The token stops menu and the ruler (12/16/24/32/48) were not captured (`token-ruler.tsx`).

### ed-lay-reorder
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No lift | the card rotated −2°, scaled 1.03, `--shadow-lg` + 1.5 px accent, following the pointer | a flat selection box drawn left of the artboard, out to the window edge; the row's cards vanish | `editing/reorder-slot.tsx` | B |
| both | Slot size | a dashed slot the size of the card, with a 24 px round "1" (`.ed-slot-n`) | a full-row dashed band with a "3" pill | `reorder-slot.tsx:255-277` | B |
| both | Tag clipped by the window edge; text is concatenated textContent + mono | "Small apps · moves to 1 of 3", fully visible | "…ct designApps and … · moves to 3 of 5" | `reorder-slot.tsx:47-54,279-289` | B |

### ed-lay-free
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Distance chips to the pinned corner | magenta "64" top + right | a stray "4" chip only | `editing/artboard-guides.tsx` / `nudge.tsx` | B |
| both | Constraint diagram | `.ed-cons`: 56 px `--bg-3` tile, 18 px outlined inner box, 2 px pins | grey tile, filled dark inner square, heavy pins | `sections/position.jsx:43-57` | W |
| both | Free-placement tip | "Post places things freely — no auto layout …" card | missing | `sections/position.jsx` | W |
| both | Size | one "W · H" row | Width/Height rows + Fixed selects + Clip content | `sections/size.jsx` | W |

INDEX said the badge is Left/Top, but the impl is in fact Right/Top, matching the spec.

### ed-text-edit
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Editing chrome | edit ring: 2 px accent + 6 px `--accent-tint`, no handles (`.ed-sel--edit`) | resize handles, rotate button and halo stay on while typing | `editing/text-in-place.tsx` | B |
| both | Language row and one-letter tie marks | "Language Čeština" + tip; tie arcs under "v", "s" | missing | `client/v2/inspector/kinds/text.jsx` | B |
| both | Siblings reflowed while editing ("What we do" now under the cards); may be a leftover from the reorder run | layout unchanged | moved | verify; `text-in-place.tsx` | W |

The title "h1.dc-text-editing" is R4; Type at the foot is R5.

### ed-text-style
No own finding. Style, override dot, Reset and Detach need a text style in the system, which the fixture lacks (not a finding). Visible here: R4 ("COMBINE2026 · 530 × 251") and R5 (Type below six box sections).

### ed-shape
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Shape state not captured: a text was selected (the fixture has no shape behind the date) and More was not opened | Kind row, four corner fields, radius dots, More menu | text inspector | re-drive with a drawn rectangle (`kinds/shape.jsx`, `corner-dots.tsx`) | W |

### ed-pen
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Hint material | four separate `.ed-hint` pills (`--bg-2`, `--fg-1`, radius-pill, `--shadow-sm`) beside the drawing | one dark `--maude-hud-bg` bar, radius 6, over the toolbar | `editing/pen/overlay.tsx:28-33` | B |
| both | Close target | magenta `--ed-guide` 2 px ring + "Click here to close" tag | accent 1.5 px ring, no tag | `pen/overlay.tsx:19` | W |

The point inspector (Corner, X·Y, Stroke, Ends, Combine) was not captured.

### ed-img
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Image row | 40 px thumb + "combine-2025-sprint… · 4032 × 3024" | broken-image thumb + "2Q==" (R4) | `kinds/image.jsx:55` | B |
| both | Zoom, Adjust (Look · Remove background), info line | present | missing | `kinds/image.jsx` | B |
| both | Fit segment in crop mode | Crop pressed | Fill pressed | `kinds/image.jsx` | W |
| both | Crop frame | corner brackets + photo-corner handles, the photo faded beyond the frame | standard resize handles + halo cover the brackets; no faded outside visible | `editing/crop-mode.tsx:141-176` vs `use-element-resize.tsx` | W |
| both | A distance chip "'20" collides with the crop tag | none | overlap | `artboard-guides.tsx` | W |

### ed-comp-pick
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Row and field material | 28 px rows (`.k-mi`), filled search field, system line = icon + semibold name, focused row `--accent-muted` | ~21 px rows (padding 4/8), transparent search, plain "maude-v2", hover `--bg-3` | `client/v2/inspector/component-picker.css:10-82` | B |
| both | Variant chip row under the focused component + the place label on the canvas | "Plné · Obrys" row; "◇ Tlačítko · Plné" tag | missing | `component-picker.jsx` | B |
| both | Component slot not pressed while the picker is open | Component pressed | Select pressed | `tool-palette.tsx` | W |
| both | Row labels carry DS descriptions | "Tabs" | "Tabs (this system switches views with…" | `component-picker.jsx` label source | W |
| both | Anchoring | beside the target artboard | centred above the toolbar, covering Tablet | `component-picker.jsx` | W |

### ed-comp-instance
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Component select overflows the inspector's right edge | 140 px `.k-in-select` | clipped past the panel | `kinds/instance.jsx:117-129` (the span wrapper) | B |
| both | Tag | "◇ Tlačítko · Plné" (component icon + variant) | "Button · 64 × 32" | `editing/selection.tsx` nameTag | W |
| both | Main component (Go to · Detach) + override dots not in view (no overrides were made, so the fixture is partly the cause) | visible | below Position/Size/Layout (R5) | `kinds/instance.jsx:302+` | W |

### ed-inspector
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Interaction (On click / On hover), Export ("This object"), "Tokens it uses" chips and the Advanced fold at the foot | all eleven sections | no Interaction or Export for a button; no token chip row | `sections.js` + `sections/interaction.jsx`, `export-slot.jsx`, `advanced.jsx` | B |
| both | Layout for a button | Direction, Gap, Spacing, Padding, Align | Direction + Padding only | `sections/layout.jsx` | W |

R8 head; numbered callouts are specimen; SM/MD/LG = fixture system.

### ed-edge-ai
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Not reachable in this lane (signed out). Reaching it needs a signed-in run so the AI hold paints its dashed spark outline + "AI is drawing the footer" tag and the inspector line. The code exists (`hold-rings.tsx`, `ai-scope-outline.tsx`). | AI hold on Footer | connect card | `editing/hold-rings.tsx` | W |

The tab badges at rest are R3.

### ed-edge-ask
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | ⌘/ composer | a compact pill under the selection (avatar, prompt, ⌘/ key) + a separate tip pill "One step — ⌘Z undoes all of it" | a 446 px field with an accent "1 element" chip and an accent send square | `editing/ask-bubble.tsx` | B |
| both | AI run outline + "AI is adding a link to 3 cards" tag | drawn | signed out | `ai-scope-outline.tsx` | W |

### ed-edge-tereza
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Not reachable locally. It needs a second live peer holding the same object: a sky ring 3 px + tag, and the inspector in view mode with Comment. The code exists. | sky ring + read-only inspector | — | `editing/hold-rings.tsx`, `client/v2/inspector/view-mode.jsx` | W |

### ed-edge-huge
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Name chip on a tall, narrow artboard: the size text rides above the baseline, the chip covers the handles, and the bottom handles paint **over the toolbar** | `.ed-sticky-name` `--bg-2` pill, name + quiet size; HUD below the dock | accent chip, misaligned; handles above the dock | `editing/sticky-name.tsx`, `artboard-handles.tsx:156-158` (z-index 6) | B |
| both | Minimap + "You're looking at …" | shown while zoomed in | not shown (the whole page was in view) | `editing/minimap-context.tsx:26` (re-drive zoomed in) | W |

### ed-edge-undo
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Row avatar | tone-filled single initial ("M") | grey "YO" | people colours (C7) | W |
| both | Shortcut hints | plain `--fg-2` text | bordered key boxes | undo history popover | W |

The structure matches. The "Would undo · 14 changes" hover tag and the AI rows were not captured (signed out; `undo-preview.tsx`).

### ed-edge-paste
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Not reachable here (no real Figma clipboard + connection). From the code, the bar differs from the spec. | `.island` (`--bg-2`, island edge, shadow) + kit `btn--primary` | `--bg-3`, radius 10, a `--maude-hud-accent` button | `editing/paste-bar.tsx:128-141` | W |

### ed-edge-keys
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The focus ring is the selection ring | 2.5 px `--focus-ring` + 7 px `--accent-tint` halo, distinct from selection (`.ed-sel--focus`) | the normal selection halo + handles | `editing/focus-model.tsx` | B |
| both | Badges | solid round 1…6 outside the frame's left edge, the focused one filled accent, children dashed "4.1…" inside | dashed mono pills inside the artboard's top-left, over the content | `editing/tab-order.tsx:159-173` | B |

The shortcut table and the VoiceOver caption are specimen, not findings.

---

## Totals

Cross-cutting: 4 B. Root causes: 7 B, 1 W. Per artboard: 30 B, 38 W.
**Blockers 41 · Warnings 39.** No artboard × theme is clean in this lens: every frame carries X1/X4, and the selection ones carry R2.

```json
{"canvas":"14 Editing","critic":"design-critic","blockers":41,"warnings":39,"verified_ids":[]}
```
