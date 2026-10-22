# copy-critic — 14 Editing (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/14 Editing.tsx` · lens: every visible string vs the board and CONTRACT §3 words + §4 voice (CONTRACT wins over a stale board; the owning board wins in board conflicts — the artboard inspector rows are 08's, the Export section 09's, the AI connect sheet 03's)_

**Method.** Spec copy read from the board source (lines 536–1767). Impl copy read from the full-size impl frames (`.scr/impl/14-editing/*.png`, all light frames OCR'd with tesseract and the key ones viewed at full size), then owners grepped. **Dark:** an OCR diff of every dark frame against its light twin showed only OCR noise, and `ed-obj-order-dark` was viewed. Every row is therefore **L·D** and nothing differs in dark only.

**Fixture (not findings):** the plain-code Homepage / Combine-kampaň carries no designer layer names, no text styles and no bound tokens. So "Services › Brand systems", "Space 24" chips, "Plakát", "Klubová zelená", "Page" fill, Tereza / Jonas and the Czech object names can't match. The *fallbacks* the impl picks for those are reviewed below.

**Owning-board calls (not findings):** the artboard inspector's "Width · Desktop · 1440" (08) beats 14's "Preset". So do "1050 now — grows as you add." (08) and the Export section "Export 1 file · Copy as PNG ⇧⌘C · Export… — every option ⇧⌘E" (08/09). The extra artboard-menu rows "Add comment C" and "Start a vote…" belong to 15 (the vote is started from the artboard's right-click, dgn-protocol.ts:157).

## Per artboard (all rows L·D)

| id | difference | spec (board) | impl | owner file:line | sev |
| --- | --- | --- | --- | --- | --- |
| ed-ab-select | layout option word | "Content · Top to bottom" (08 also says Top to bottom) | "Content · Page flow" | client/v2/inspector/kinds/artboard-model.js:27 | warning |
| ed-ab-resize | two different sizes on screen at once; inspector stale | pill "Laptop · 1280 × 1573"; Preset "Laptop · 1280" | name chip "1063 × 1050", pill "1057 × 1050", Width still "Desktop · 1440" | editing/preset-ruler.tsx, editing/artboard-handles.tsx | blocker |
| ed-ab-resize | pill doesn't name the preset; ruler shows one label | "Laptop · 1280 × 1573"; ruler Tablet 834 · Laptop 1280 · Desktop 1440 | "1057 × 1050"; "Tablet 834" | editing/preset-ruler.tsx | warning |
| ed-ab-resize | Fits-content hint missing | "Drag the bottom edge to fix the height at a number." | — | client/v2/inspector/kinds/artboard-rows.jsx | warning |
| ed-ab-resize | "⌘ ignores presets · ⌥ from the centre" | | word for word | editing/preset-ruler.tsx:201 | ok |
| ed-ab-arrange | position pill + equal-gap chips not seen (drag out of snap range; re-drive) | "X 3480 · Y 0", three "80" chips | — | editing/ (smart guides) | warning |
| ed-ab-tidy | **R6** "Mixed" replaced by dashes | "X Mixed · Y Mixed", Background "Mixed" | "Size — × —", "Position — · —", Background "Default" | client/v2/inspector/kinds/multi-artboard.jsx:34 | blocker |
| ed-ab-tidy | object words on artboards; the fix is a menu path in prose | (no Interaction section) | "This object has no id yet. Edit element id… gives it one." · "Preview plays it; Edit shows the link while this is selected." | client/v2/inspector/sections/interaction.jsx:187 | warning |
| ed-ab-tidy | "3 artboards", "Tidy up", "Changes go to all 3." | | match the pattern | multi-artboard.jsx:69 | ok |
| ed-ab-menu | **R3** clipboard rows missing | "Copy ⌘C", "Paste ⌘V" | — | client/canvas-shell.tsx ~1973 (artboard menu) | blocker |
| ed-ab-menu | **R2** v1 word in the empty inspector (§2: Browse → Preview) | — | "…or ⌘-click straight from Browse." | client/inspector/inspector-panel.jsx:688-689 | blocker |
| ed-obj-enter | **R1** tag names stand in for the path and the title | "Desktop › Services › Brand systems", "Brand systems · Frame" | "Desktop › div › div › div › div", "div · Frame" | client/v2/inspector/model.js:28-55 (`el.tag` fallback), 58-64 | blocker |
| ed-obj-enter | position row replaced by prose; label repeated as its own button | "In Services · Set by Services · 2 of 3", Place freely (switch) | "It sits where its frame's layout puts it. Place freely makes X and Y yours." + row "Place freely" [Place freely] | client/v2/inspector/sections/position.jsx:172 | warning |
| ed-obj-enter | Advanced verb label | "Convert layout to absolute" | "Convert children to absolute position" | editing/object-menu.tsx:11; editing/arrange.ts:90 | warning |
| ed-obj-enter | "card" said of any frame | (said of the Services row) | "Each card keeps where it is now; the frame stops arranging them. ⌘Z brings the layout back." on every frame | client/v2/inspector/sections/layout.jsx | warning |
| ed-obj-multi | state not reached (shift-click picked the root); "3 objects", "Mixed", "Changes go to all 3. Text settings show when only text is selected." unverified | | | client/v2/inspector/model.js:28 | warning |
| ed-obj-multi | **R4** CSS words in primary rows | token / colour names; font names | "rgb(255, 255, 255)", "Size · weight Inherited · Inherited" | client/v2/inspector/sections/type.jsx:80,101 | warning |
| ed-obj-order | **R3** clipboard rows missing | "Cut ⌘X · Copy ⌘C · Paste ⌘V" | — (Duplicate is first) | editing/object-menu.tsx; client/canvas-shell.tsx:2399 | blocker |
| ed-obj-order | Advanced row lacks its note | "Advanced ▸ Copy CSS · element id" | "Advanced ▸" | editing/object-menu.tsx | warning |
| ed-obj-order | the rest matches ("Ask AI about "…" ⌘/", Copy/Paste properties ⌥⌘C/⌥⌘V, "Select matching · same style", Frame selection ⌥⌘G, Remove frame ⇧⌘G, order ⌘] ] [ ⌘[, Lock ⇧⌘L, Hide, Remove ⌫) | | | | ok |
| ed-lay-auto | gap-stops menu not opened (CONTRACT §6 [C15]: tokens + "A number, no token…") | "Gap · Space in Studio site system · Space 4…64 · Auto · A number, no token…" | "24 Bind ⌄" (closed) | client/v2/inspector/sections/layout.jsx | warning |
| ed-lay-auto | selection tag and fill line missing | "Services → Auto layout"; "3 cards, each Fills the width." | — | editing/ (selection tag); layout.jsx | warning |
| ed-lay-reorder | **R5** lift tag built from the children's text run together | "Small apps · moves to 1 of 3" | "…ct designApps and … · moves to 3 of 5" | editing/reorder-slot.tsx:10 + client/v2/inspector/model.js:52-53 (`clip(text)`) | blocker |
| ed-lay-reorder | drag hints missing | "Let go — it moves here · esc puts it back · ⌥ while dragging — a copy · Drag out of the frame — place it freely" | — | editing/reorder-slot.tsx | warning |
| ed-lay-free | constraint explainer missing | "Post places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner…" | Constraints Left/Top only; title "span · Text" (R1) | client/v2/inspector/sections/position.jsx | warning |
| ed-text-edit | an internal class leaks into the title while typing | "Titulek · Text" | "h1.dc-text-editing · Text" | editing/text-in-place.tsx:19 (class) → client/v2/inspector/model.js:51 | blocker |
| ed-text-edit | Language row + Czech line missing | "Language · Čeština"; "Čeština: one-letter words stay with the next word…, „quotes" turn Czech." | — | client/v2/inspector/kinds/text.jsx | blocker |
| ed-text-edit | weight as a number (CONTRACT §5 weights stop at 600) | "Heavy" / "Semibold" | "56 Bind · 650" | client/v2/inspector/kinds/text.jsx | warning |
| ed-text-edit | CSS jargon for the font | "Avenir Next Condensed" | "Font · Inherited" | client/v2/inspector/kinds/text.jsx:394 | warning |
| ed-text-edit | "This text follows no style. · Use a style" | (detached pane: "Use a style") | match | text.jsx:226 | ok |
| ed-text-style | override / Reset / detach states unreachable (fixture system has no text styles) | "Size differs from Plakát. · Reset", "Update Plakát for every canvas…", "Keeps its look; stops following Plakát. Nothing else changes." | "Aa No style" | client/v2/inspector/kinds/text.jsx | warning |
| ed-shape | text picked instead of the shape (re-drive); Kind row / corners unverified | "Kind · Rectangle", ↖ ↗ ↙ ↘ | — | client/v2/inspector/sections/corners.jsx | warning |
| ed-shape | shadow names shown as upper-case abbreviations | "Flat · Soft · Lifted" (the system's own words) | "Flat · SM · MD · LG" | client/v2/inspector/sections/effects.jsx:4-5 (system token suffixes) | warning |
| ed-pen | hint bar word for word ("Click — a sharp point · Drag — a smooth one · ⇧ 45° steps · ↵ or esc — finish, open") | | | editing/pen/draw.tsx | ok |
| ed-pen | close chip and point inspector not reached | "Click here to close", "45°", Point · Corner · Stroke Ends Round/Flat · Combine shapes, key list | — | editing/pen/ | warning |
| ed-pen | (same run) a refusal toast cut off with "…"; the fix is prose, not a button | — | "That frame is shared by several artboards… Detach it to draw on this artboard…" | edit-ops/insert-shape.ts:169 | warning |
| ed-img | Adjust rows + Photo line missing | "Zoom 128 %", "Look · Adjust…", "Background · ✦ Remove background", "Both open Photo (12). Edits apply to this use only…" | Image · Replace… · Fit only | client/v2/inspector/kinds/ (image) | blocker |
| ed-img | the name comes from a data-URI tail | "combine-2025-sprint.jpg · 4032 × 3024" | "2Q==" (fixture data-URI; the fallback is product) | client/v2/inspector/kinds/ (image row) | warning |
| ed-comp-pick | component names carry their specimen descriptions | "Tlačítko · 2 variants", "Štítek"… | "Tabs (this system switches views with i…", "Badge (this system marks status with it…" | client/v2/inspector/component-picker.jsx:294 (`item.label`) | blocker |
| ed-comp-pick | Patterns group and variant chips missing | "Patterns · Klubový web — hero…"; "Plné · Obrys" | — | component-picker.jsx:19-21 | warning |
| ed-comp-instance | Main component section not seen (below the fold?) | "Go to Tlačítko · Detach" + "Detach keeps this exact look as a plain frame. Nothing breaks; it stops following Tlačítko." | — | client/v2/inspector/kinds/instance.jsx | warning |
| ed-inspector | Interaction and Export sections missing for an object | "On click · Open cal.com/studio", "On hover · Lift to Floating", "Preview plays it; the link shows on the canvas while this is selected — as in 04 Modes."; "This object · Export Book a call" | — (title "button · Button", R1) | client/v2/inspector/sections/interaction.jsx, export-slot.jsx | blocker |
| ed-edge-ai | unreachable (AI signed out). The Connect sheet copy matches CONTRACT §7 ("Connect your Claude account to let AI draft this.") | tag "AI is drawing the footer", tip "Footer is AI's until it's done · Stop in the AI chat", "AI is changing Footer in this artboard. Everything else stays yours." | Connect sheet | client/v2/ai/ConnectSheet.jsx:29; AI-owned-region copy needs AI | blocker |
| ed-edge-ask | **R5** debug-looking path pills over the selection | (none) | "1.3.2.1 · 1.3.2.2 · 1.3.2.3" | editing/tab-order.tsx:83 | blocker |
| ed-edge-ask | scope + after-send copy not reached ("1 element" — the row was selected, not three cards) | "AI is adding a link to 3 cards"; "One step — ⌘Z undoes all of it · the rest of the page stays yours" | "1 element · Ask AI…" | client/v2/ai/AskSelectionHost.jsx:24 | warning |
| ed-edge-tereza | unreachable (needs a second collaborator) | "Tereza is editing See pricing. You can look; the fields open when she moves on. · Comment" | — | presence lock UI | blocker |
| ed-edge-huge | "Klub · Desktop 1440 × 6000", "6000 now — grows as you add." | | match | | ok |
| ed-edge-huge | where-you-are line + minimap missing | "You're looking at 1727–5636 of 6000." + section list | — | editing/ (minimap) | blocker |
| ed-edge-undo | "Undo history · newest first", "Opened from Menu › Edit › Undo history", "Placed a component · You · 1 min ago ⌘Z", "Version history ⌥⌘H" | | match | client/v2/undo/undo-history.jsx:119 | ok |
| ed-edge-undo | hover tag missing (AI rows need AI) | "Would undo · 14 changes" | — (R5 path pills on the canvas again) | client/v2/undo/undo-history.jsx | warning |
| ed-edge-paste | unreachable (needs a Figma clipboard) | "Pasted from Figma as an image of "Hero / v3". · Make editable"; "Make editable needs Figma Dev Mode on a paid seat. Some text may come back as pictures." | — | figma paste path | blocker |
| ed-edge-keys | focus markers use dotted depth paths | "1 … 6", "4.1–4.3" | "1.1 · 1.2 · 1.3 · 1.4" | editing/tab-order.tsx:83 | warning |

## Root causes that hit several artboards

1. **R1 — unnamed objects fall back to the HTML tag, and a class leaks while editing.** You see `div`, `span`, `img`, `button` and `h1.dc-text-editing` in the inspector title and breadcrumb (client/v2/inspector/model.js:28-64; editing/text-in-place.tsx:19). Every object frame and 15's an-crowd Layers list show it. The fixture has no names, but a designer-facing fallback is product work: the first words of the text, "Frame", "Text" or "Image" — never a tag or a class.
2. **R2 — "Browse" in the empty inspector** (inspector-panel.jsx:688-689). This is a CONTRACT §2 word. It shows in ed-ab-menu, ed-comp-pick, ed-pen and ed-edge-huge-fit.
3. **R3 — the menus drop Cut / Copy / Paste.** Both the artboard menu and the object menu lose them (canvas-shell.tsx artboard menu; editing/object-menu.tsx).
4. **R4 — CSS words in primary rows.** "rgb(…)", "Inherited", "650", "SM MD LG" and "Default" show up where the board writes token words. Part of this is the fixture; the abbreviations and "Inherited" are product.
5. **R5 — internal-looking text on the canvas.** Tab-order path pills linger outside keyboard mode (editing/tab-order.tsx:83), and the reorder tag runs the children's text together.
6. **R6 — "Mixed" becomes "—"** in the multi-artboard inspector (multi-artboard.jsx:34), against the board's "Mixed" and the file's own header comment.
7. **R7 — documented states missing.** Language / Czech ties, image Adjust / Remove background, object Interaction / Export, the minimap line, AI-owned regions, the Tereza lock and the Figma paste bar.

```json
{"canvas":"14 Editing","critic":"copy-critic","blockers":17,"warnings":28,"verified_ids":[]}
```
