# design-critic — 08 Artboard Kinds · V2-8.5 stage B fidelity

_2026-10-22 · board `.design/ui/v2/08 Artboard Kinds.tsx` (+ `.css`, `_kit.*`) · pairs `08-artboard-kinds/` + full-size `.scr/{spec,impl}/08/` · lens: layout, spacing, sizes, type, colour/tokens, material, iconography, drawn states_

**How to read this.** `L·D` means the difference shows in both themes. The spec's dark half is a host re-theme of the board, not a designed dark state (see INDEX), so I judged dark impl against the app's dark tokens. Dark only adds one finding of its own (the dim wash in ak-mixed-filter). Each finding is **counted once**, at the first artboard where it shows. Later artboards cite the root cause (`↻ RC-n`) and are not counted again. `(fixture)` rows are not findings. `unverified` means the capture didn't reach the state. Those rows aren't counted, but each says what would reach the state.

## ak-picker · F size picker

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-picker L·D | App and Social group icons | `laptop` / `image` (kit Icon) | both `DigitalIcon` (phone) | `client/v2/kinds/SizePicker.jsx:40-46` (GROUP_ICON) | **blocker** |
| ak-picker L·D | Video glyph: group head + "has a timeline" mark in the tiles | `video` (rect + play) head; `play` triangle in the shape | `VideoIcon` (camera) in both | `SizePicker.jsx:101`; `canvases/canvas-icons.jsx` VideoIcon | **blocker** |
| ak-picker L·D | Chevron direction on the "Grows as you add" badge and on "Fewer" | kit `chevron` (points down) | `ChevronIcon open` (points up) | `SizePicker.jsx:505, 518` | warning |
| ak-picker L·D | Search field on open | resting `bg-3`, no ring | auto-focused accent ring | `size-picker.css:30-35` + autofocus `SizePicker.jsx` | warning |
| ak-picker L·D | Vertical rhythm | group heads 128 px apart, tiles 91 px | 115 px, tiles 86 px (button `font: inherit` line-height) | `size-picker.css:168-180` | warning |
| ak-picker L·D | Placement | left 518, sitting above the toolbar | centred (x 493–948) | `SizePickerHost.jsx` / `placePanel` | warning |
| ak-picker L·D | Active tool in the dock | `accent-muted` filled square | tint + accent underbar (DDR-046) | `toolbars/toolbar-css.ts:73-86` | warning |
| ak-picker L·D | Recent row missing | FB event cover · Post 4:5 · A6 | hidden while there's no history | `SizePicker.jsx` `view.recent.length > 0` | (fixture) |
| ak-picker L·D | Ghost frame + highlighted tile | dashed ghost, FB tile highlighted | not hovered, so not drawn | — | unverified (drawn in ak-picker-full) |

## ak-picker-full · all sizes + custom print size

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-picker-full L·D | Ghost label type and icon | body `type-xs` semibold + kind Icon 11 | mono 600 11 px, no icon | `apps/studio/editing/size-ghost.tsx:162-168, 289` | **blocker** |
| ak-picker-full L·D | Custom size… | picker stays open (Custom tile highlighted) with a **separate island** beside it | the form **replaces** the picker body; the ak-picker-custom capture shows the panel closed | `SizePicker.jsx` (`custom ? <CustomPrint/> : …`) | **blocker** |
| ak-picker-full L·D | Ghost material | `--accent-tint` fill, `radius-xs` | accent 10 % mix, square corners | `size-ghost.tsx:157-161` | warning |
| ak-picker-full L·D | Highlighted tile (A2) | accent-muted + 1.5 px accent inset | same | `size-picker.css:181-186` | ✓ |
| ak-picker-full L·D | Legend card | explainer | — | board-only | not a finding |

## ak-web-hug · web page grows

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-web-hug L·D | **Inspector shell (RC-1)** | floating island, 264 px, top 68 / right 16, flat rows, Advanced fold | full-height docked `st-rpanel`: Inspector \| Photo tabs, close ✕, section heads (Artboard/Fill/Layout/Export), "Uses project" pill | `client/inspector/inspector-panel.jsx:603-633`; `v2/inspector/frame.jsx:206-215` | **blocker** |
| ak-web-hug L·D | Row labels | `type-sm`, `fg-1`, label/control space-between, 30 px rows | `type-xs`, `fg-2`, 76 px grid column, 28 px rows | `v2/inspector/sections/sections.css:7-21` | **blocker** |
| ak-web-hug L·D | Select control | `.select`: no border, 0.5 px subtle inset, `radius-md`, `type-sm`, kit chevron | native `<select>`: OS arrows, 1 px `border-default`, `radius-xs`, `type-xs`, 26 px | `inspector-controls.jsx:507-526`; `styles/3-shell-maude.css:4391-4407` | **blocker** |
| ak-web-hug L·D | Segmented (Height Fits content \| Fixed) | active: `bg-2` + `shadow-sm` + 1 px accent ring | active: `accent-tint` fill, divider rules | `3-shell-maude.css:3593-3616` | **blocker** |
| ak-web-hug L·D | Other widths | `btn--sm` + duplicate icon, "Add a width" | native select "Add a width…" | `v2/inspector/kinds/artboard-web.jsx:46-66` | **blocker** |
| ak-web-hug L·D | Layout | one row: Layout · "Top to bottom" | Layout section: Content "Page flow" · Padding · Gap | `v2/inspector/kinds/artboard.jsx:55-95`; `artboard-model.js:27` | **blocker** |
| ak-web-hug L·D | Fill control | InFill pill: swatch · "White" · 100 % | "Background" + "None ˅" token chip | `artboard.jsx:32-53` | **blocker** |
| ak-web-hug L·D | Web label glyph (RC-3) | kit `web` (browser window) | globe | `apps/studio/canvas-lib.tsx:2636-2646` | **blocker** |
| ak-web-hug L·D | Inspector head chip | right-aligned (title `flex:1`) | sits inline after the title | `v2/inspector/inspector.css:70-78` | warning |
| ak-web-hug L·D | "N now — grows as you add." | InNote on the right, max 170 px | spans the whole row, left | `artboard-rows.jsx` HeightRows | warning |
| ak-web-hug L·D | Export section | not on this board | 1× · PNG · Export 1 file · Copy · Export… | 09 export slot (RC-2) | warning |
| ak-web-hug L·D | "≤ 834px" breakpoint chip | — | mono chip top-right of the page | `apps/studio/web-overlay-content.tsx` | warning |
| ak-web-hug L·D | "+ 373 px" growth tag and "new section" tag | drawn | not driven (the tag only appears after a grow) | `apps/studio/artboard-growth-tag.tsx` | unverified |

## ak-web-widths

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-web-widths L·D | Siblings at 834/390, toast, "Fit to width" row, label mark | drawn | frame is identical to ak-web-hug | `add-width.js`, `artboard-web.jsx` | unverified: drive Add a width › Tablet and Mobile |
| ak-web-widths L·D | Inspector / select / warn styles | — | — | ↻ RC-1, RC-6 | — |

## ak-social · post + story

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-social L·D | W/H fields | body tabular nums, plain `fg-2` "W" inside the input, `radius-md`, 28 px | **mono** digits, bordered lead cell "W\|" on `bg-2`, `radius-xs`, 26 px | `3-shell-maude.css:2820-2866` (`.st-cp-numlead`, `.st-cp-numin`) | **blocker** |
| ak-social L·D | Layout section on a Fixed size board | none (Advanced: absolute children) | Content "Page flow" · Padding · Gap | `artboard.jsx:100-103` (slot registered for every kind) | **blocker** |
| ak-social L·D | Export | one row `btn--sm` export icon "PNG · 1×" | section: 1× / PNG selects, −, "Export 1 file", Copy as PNG, Export… | export slot (RC-2) | **blocker** |
| ak-social L·D | Digital label glyph (RC-3) | phone glyph before every label | none for `digital` | `canvas-lib.tsx:3102-3106` | **blocker** |
| ak-social L·D | W/H row label | blank (continues Size) | second "Size" label | `artboard-rows.jsx:69-71` | warning |
| ak-social L·D | Safe zones | two rows (select, Show on canvas) | own section head + note paragraph | safe-zone rows | warning |
| ak-social L·D | Size "Custom", Fill None, no bands | Story 9:16 · Ink · Instagram story | 304×540 isn't a preset | — | (fixture) |

## ak-safe-zones

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-safe-zones L·D | Band colour (RC-5) | `--accent` hatch 30/14 %, 1 px accent inset, accent tag | hardcoded `oklch(60% 0.2 25)` **red** hatch + red tag | `apps/studio/safe-zones-overlay.tsx:32-37` | **blocker** |
| ak-safe-zones L·D | Platform list | floating `k-menu`: "Safe zones" head, ✓ on the current item, footnote under a separator | native `<select>` | safe-zone row (Select) | **blocker** |
| ak-safe-zones L·D | Tag legibility | `type-xs` at any zoom | world-px size, ≈4 px on screen at 28 % | `safe-zones-overlay.tsx:46` `tagSize` | warning |
| ak-safe-zones L·D | "Under the…" flag | `--status-warn` | `oklch(82% 0.15 85)` hardcoded | `safe-zones-overlay.tsx:38-39` | warning |
| ak-safe-zones L·D | "Show on canvas" label | one line | wraps (76 px column) | `sections.css:9` | warning |
| ak-safe-zones L·D | Footnote | `xs fg-2` in the menu | body text in the inspector | safe-zone rows | warning |
| ak-safe-zones L·D | Reels right band, profile-grid crop | drawn | only Instagram story driven | `kinds/safe-zones.ts` | unverified |

## ak-print-letak · A6 inspector

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-print-letak L·D | Bleed / Safe margin field | InNum "3 mm", 140 px | mono "mm" lead cell + "3", ≈84 px | `v2/inspector/kinds/artboard-print.jsx:173-195` + `.st-cp-numlead` | **blocker** |
| ak-print-letak L·D | Colour note | InNote `xs fg-2` on the right, max 170 | `.insp-ro` `type-sm` `fg-0`, two lines | `artboard-print.jsx:224-226`; `sections.css:30-36` | **blocker** |
| ak-print-letak L·D | Paper value | "A6" | "A6 · 105 × 148 mm" | `artboard-print.jsx` Paper row | warning |
| ak-print-letak L·D | Print guides | switch ON, guides drawn on the selected flyer | OFF + "Follows View › Advanced › Print guides." line; no guides | `artboard-print.jsx:202-220` | warning |
| ak-print-letak L·D | Export / Fill / Layout / warn row / label mark | — | — | ↻ RC-2, RC-1, RC-6 | — |
| ak-print-letak L·D | "1 px wider…" warning | not on this board | shown | — | (fixture) |

## ak-print-view

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-print-view L·D | Guide colours (RC-5) | bleed `--object-coral` 30 %, trim `--object-ink`, margin `--object-lilac` dashed | red 14 %, `oklch(25% 0 0)`, magenta `oklch(58% .24 340)` (labelled "Adobe convention") | `apps/studio/print-overlay-content.tsx:23-29` | warning |
| ak-print-view L·D | Menu › View › Advanced open with "✓ Print guides" | drawn | toggled via ⌘K | `actions/defs/view.ts:338` | unverified |
| ak-print-view L·D | Guides on every print board | ✓ | ✓ | — | ✓ |

## ak-video

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-video L·D | Video label glyph (RC-3) | kit `video` (rect + play) | camera | `canvas-lib.tsx:2651-2662` | **blocker** |
| ak-video L·D | Timeline head | plain ▷ + loop, "0:04 / 0:15" in body type, title chip "Hype trailer · Reels", 4 tools, Expand | filled-accent Play, ⏮, volume slider, **mono** "0:00 / 0:02", "30 fps · 90f" + zoom slider, ✕ | `client/v2/timeline/Timeline.jsx:1859+` (07 owns detail) | **blocker** |
| ak-video L·D | Track heads | 20 px tinted icon badges (T / image / video / music) | text column "Text · Graphics · Video 2 · Video" | `timeline/tracks.js:18`; `Timeline.jsx:2297` | **blocker** |
| ak-video L·D | Ruler / playhead | body numerals; "Poster" flag chip | mono ruler; "0.00s" accent tag; no poster flag | `timeline/ruler.js`, `poster.js` | warning |
| ak-video L·D | Corner video badge on the artboard | — | camera chip top-right | canvas-lib kind overlay | warning |
| ak-video L·D | Length on the label | "· 0:15" | not appended | canvas-lib label | warning (confirm whether the product appends it) |
| ak-video L·D | "Advanced · Frames, keyframes, the cut as code" foot | — | present | `timeline/advanced/foot.jsx` | warning |
| ak-video L·D | No thumbnails / waveform, one "Clip 1" | — | — | — | (fixture) |
| ak-video L·D | Video inspector | small floating island | closed in this frame | — | unverified |

## ak-mixed-fit · ⌘0 + Layers by kind

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-mixed-fit L·D | **Kind default (RC-4)**: kind-less boards counted and glyphed as Web page | Fixed size (canvas-lib default) | chips "▯ 0 · ▭ 3", post/story rows show the web glyph, while the inspector says "Fixed size" | `v2/kinds/layers-kind-model.js:15`, `kind-filter-model.js:49`, `canvases/jump-model.js:28` vs `canvas-lib.tsx:2746` | **blocker** |
| ak-mixed-fit L·D | Layers list | artboards only, under the section title | current board expands its DOM ("div", "div.__remotion-player", "img", in italics) | `v2/layers/artboard-layers.jsx:85` | **blocker** |
| ak-mixed-fit L·D | Panel material | auto-height island ≈246 px, Canvases \| Layers | full-height docked, + Assets tab, Advanced foot | left panel (11 owns) | warning |
| ak-mixed-fit L·D | Group head | DCSection title "Výsledková karta" | canvas name "Matchday · 6 artboards" | `artboard-layers.jsx:1-24` | warning |
| ak-mixed-fit L·D | Print chip on, dim, "19 other artboards are dimmed. Show all" | drawn | All chip active, not driven | `layersFoot` | unverified |
| ak-mixed-fit L·D | 6 vs 21 boards | — | — | — | (fixture) |

## ak-mixed-filter · Canvases by kind

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-mixed-filter L·D | The Canvases chip dims the canvas (RC-7) | canvas undimmed (`<Kampan dx>` without `only`) | non-matching boards faded | `v2/kinds/KindDimHost.jsx:1-5` (shared store) | **blocker** |
| ak-mixed-filter L·D | Dim material | whole artboard at opacity .45 | body only at .34, label at full strength; the light frame shows through, so on **dark** it reads as a white wash | `apps/studio/editing/kind-dim.tsx:16-27` | **blocker** |
| ak-mixed-filter L·D | Hit row | 44 px: Thumb, name + folder line, glyphs then count on the right | 30 px: blank square, "2 of 6" inline after the name, glyphs at the far right | `v2/canvases/canvases-panel.jsx:1097-1104` | **blocker** |
| ak-mixed-filter L·D | Foot sentence | directly under the list | pinned to the panel bottom above Trash | `canvases-panel.jsx` | warning |
| ak-mixed-filter L·D | Counts 13 vs 93, no folders/thumbs | — | — | — | (fixture) |

## ak-mixed-select

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-mixed-select L·D | "2 artboards · 2 kinds" inspector | drawn | ⌘A inside the focused print board selected 3 objects (context bar) | `v2/inspector/kinds/artboard-multi.jsx` exists | unverified: shift-click two artboard labels |

## ak-convert / ak-convert-after (spec only)

Unverified capture gap, not missing product. `ConvertDialog.jsx` + `artboard-rows.jsx:51-52` (`o.convert && o.paper → onConvert`) already exist. To reach the state, pick "A6" in a Fixed size board's Size select. Not counted.

## ak-warnings

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-warnings L·D | Label mark (RC-6) | 16 px **filled** `--status-warn` dot, `object-ink` glyph, beside the label | 12 px **outline** amber triangle inside the label chip | `apps/studio/artboard-warn-mark.tsx:180-207`; `canvas-lib.tsx:3107` | **blocker** |
| ak-warnings L·D | Inspector warn row | first row of the inspector; warn-14 % bg + 1 px warn-40 % inset; verb as accent ghost button under the text | below the "Artboard" head (after Uses project); `--status-warn-soft`, no edge; verb as a bordered button on the right | `v2/inspector/sections/warnings.jsx:63-80`; `sections/warnings.css:6-16` | **blocker** |
| ak-warnings L·D | "Crosses the cut" dashed warn outline + tag on the layer | drawn | no on-canvas overlay found (only the `crosses-cut` row text, `kinds/warnings.ts:264`) | — | **blocker** (missing state: needs an on-canvas layer mark) |
| ak-warnings L·D | Video and A4 cards | drawn | not reproduced | `warnings.ts:335, 362` | unverified |

## ak-advanced

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-advanced L·D | Fold content (Exact size · Resolution · Colour · Guides · Look and layout · In code) | open | fold not opened | `v2/inspector/kinds/artboard-print-advanced.jsx` | unverified |

## ak-real-print / ak-real-web / ak-real-about

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ak-real-print L·D | content | navy flyer | green fixture | — | (fixture). Size and label match. ✓ |
| ak-real-web L·D | "≤ 834px" chip | — | present | ↻ ak-web-hug | — |
| ak-real-about | note card, not an app state | — | — | — | not a finding |

## Root causes that hit several artboards

1. **RC-1 · Inspector material.** The real inspector is the docked, sectioned v2 inspector. It uses shell controls: native `<select>`, mono number fields with lead cells, accent-tint segmented buttons, and a 76 px `xs fg-2` label column. Every 08 board draws the kit `Inspector` island instead (`k-insp`, `.select`, `k-num`, `k-seg`). Hits web-hug, web-widths, social, safe-zones, print-letak, warnings, advanced, mixed-select. One decision fixes most of them: either restyle `inspector-controls.jsx` + `sections.css` to the kit, or redraw the boards docked.
2. **RC-2 · Generic slots for every kind.** Fill (Background), Layout (Content/Padding/Gap) and the 09 Export block register for all artboards (`artboard.jsx:100-103`). So Fixed size and print boards carry rows the board leaves out, and Export is a block where the board has a single button.
3. **RC-3 · Two kind-glyph vocabularies.** canvas-lib's `ArtboardKindIcon` draws a globe for web, a camera for video and nothing for digital. `SizePicker` maps App and Social to the phone and uses the camera as its play mark. The DS kit draws a browser window, a play-in-rect and a phone, and gives every label its glyph ("every label keeps its kind glyph", note 10).
4. **RC-4 · Default kind.** The client index consumers fall back to `'web'`; canvas-lib falls back to `'digital'`. As a result the Layers and Canvases chips and rows contradict the inspector and the canvas.
5. **RC-5 · Hardcoded overlay chrome.** Safe zones (red), print guides (Adobe red/magenta), under-zone flags (yellow) and the ghost label (mono) use `oklch(...)` / `--maude-chrome-font-mono` instead of `--accent`, `--object-*`, `--status-warn` and the body font.
6. **RC-6 · Warning shape.** The label mark and the warn row both diverge from the board's "mark beside the label + first inspector row + one ghost verb".
7. **RC-7 · Kind filter is one shared store.** The Canvases chip dims the open canvas, and the dim is body-only at .34 opacity, which reads as a white wash on dark.

```json
{"canvas":"08 Artboard Kinds","critic":"design-critic","blockers":31,"warnings":26,"verified_ids":["ak-real-print-light","ak-real-print-dark"],"unverified_ids":["ak-web-widths","ak-mixed-select","ak-convert","ak-convert-after","ak-advanced"],"opt_out_applied":"palette","ds_blockers_downgraded":0}
```
