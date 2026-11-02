# Phase 8 stage C round 2 — C12 DS · editing · annotations (branch p8-c2-dsedit) — partial, budget-capped

Scope: canvases 13 Design system, 14 Editing, 15 Annotations. One file for the three (they were one builder).
**Stage D re-shoot NOT done** (budget cap ~250k tokens): no pair overwritten, INDEX files unchanged. Nothing below is marked
matched; the lead's critic re-check must shoot the artboards named per row first.

## Done (commits on p8-c2-dsedit)

| commit | what | canvases / artboards | tests (red → green) |
|---|---|---|---|
| 1277b4cb3 | **DS bar (RC2)** = a v2 island on the HUD tokens (`--maude-hud-island-bg`, 44 px, radius-lg, island edge/shadow), 24 px `system` glyph tile, `.seg` Light \| Dark (accent ring), Review… = primary button (accent fill); no CSS system colours any more, so it follows the APP theme (was white in the dark app, undimmed by the scrim). `system` glyph added to `canvas-ds-icons.tsx`. | 13 ds-board-dark, ds-board-gator, ds-board-studio (bar), ds-edit-colour (Review…) | p8-c2-dsedit-board.test.tsx (2 red on feat's bar → green) |
| 〃 | **Sheets (RC4)**: `.dsr-dialog` = kit dialog (bg-2, radius-xl, 24 px, title type-md, shadow-lg + island edge), veil = light canvas ground at .72 (not a dark scrim), review thumbs 116×72 ringed (switch list 44×32), Make sheet 640 wide. | 13 ds-edit-review, ds-edit-master, ds-make-inputs, ds-multi-switch, ds-edge-* sheets | CSS only (pinned by existing review/switch tests green) |
| 〃 | **Token inspector (RC5 part)**: one title (the frame head names the token; the block's own title only carries the Locked badge), a colour with no name of its own is named by its token (never a raw oklch/hex), the typed value moved under Advanced, Advanced = chevron row with "OKLCH" on the right (native triangle gone), contrast line + warning = `.ds-line` block (bg-3, status glyph, fg-0 words), "Lighten to 4.5:1" = ghost accent action inside the block. | 13 ds-edit-colour, ds-edge-contrast | v2-ds-token-kind.test.tsx +3 (the colour block reads as the board draws it) |
| 〃 | **Preview banner (ds-many-switch)**: names the PROJECT looked at in the target system ("Previewing Studio site in Warm paper."), ONE action (Switch…; "Stop previewing" button removed — esc stops, CONTRACT §4), top-centre island with the menu under it, menu rows wear the `system` glyph, foot rows Open the Design system ↵ · Make a design system… · Link a team library…; testid `ds-preview-stop` retired, `ds-preview-door` added (TESTIDS.md + testids.json). | 13 ds-many-switch | v2-ds-switch-sheet.test.tsx (stop test rewritten: one action, doors, esc) |
| 〃 | **Names**: `design-system.tsx` shows as "Design system" in the pill, ⌘K rows and the AI scope (`displayName`), inspector empty state says "straight from Preview" (was Browse), pinned DS row + "Uses …" door wear the `system` glyph (+ `submenu` chevron), pinned glyph ink = accent-text. | 13 ds-where-studio, ds-where-gator, ds-multi-panel | — |
| 6e91f87a9 | **Annotations**: sticky paper = DS `.sticky` (rounded semibold, `--object-ink`, 12 px padding, 4 px corner on all four sides — the dog-ear path is gone from the display, resolved words keep full ink), section title = solid object-colour chip with ink title (semibold) and count, the context toolbar's front five = the dock's (yellow · coral · green · sky · lilac; was yellow · white · grey · salmon · peach), sticky + sticker selection = four corner squares only (no edge pills, no rotate zones), every annotation handle = the board `.ed-h` square (bg-2, 1.5 px inset accent, radius 0), `#d63b1f` fallbacks → maude-v2 azure and the placement ghost reads `--maude-hud-accent` (it read the shell `--accent`, undefined in the iframe → vermilion). | 15 an-place, an-sticky, an-section, an-plan, an-stk-drop, an-stamps, an-convert, an-ai-apply | p8-c2-dsedit-annot.test.tsx (4 red on feat's element-node → green; 3 pins) |
| 3d299cf12 | **Sticky context toolbar**: island material (HUD island bg/edge/shadow, 40 px, radius-lg), pressed segment = accent-muted + accent text + accent ring (was grey fill), Resolve / Reopen and Turn into a comment moved behind the sticky's "…" menu (`annot-ctx-more`), sticky default size 148 × 148 (was 200 × 200 empty paper). | 15 an-sticky, an-convert, an-arrow-kinds, an-arrow-bind (toolbar) | annotations-convert-ui.test.tsx + s4-19-fidelity.test.tsx updated to open the menu |

Also fixed (pre-existing red in my scope): `s4-18-fidelity.test.tsx` "standalone text keeps its face" asserted a monospace face that C5 round 2 retired — now asserts the rounded face.

## Still open (not done — by priority)

**13 Design system**
- RC1 the board sections are still the token file: Brand (icons/voice/Say-not/Rules for AI), Colour role groups + "Text on surfaces" pairs, Type role rows with real sentences, Space order (XS→Round) + Layout grid, Motion cards, Components variants × states grid, the board hero (`design-system.tsx.tpl` opens with the bar only; use a `DCSection title/subtitle` hero).
- RC6 `ds make` / `draft` / `mix` / `done` still open the legacy folder view ("No tokens parsed…") — directions / filling / done banner states stay unreachable (product work: the make verbs must write the Design system canvas).
- Token picker: no drawn L/C square + hue rail (still the native colour input); swatch selection ring on the board (inspect overlay for `[data-ds-token]`); review sheet change lines ("Azure › Deeper azure", "Corners 2 → 6"), update-available block, outside-change / conflict reviews, trash confirm entry point, system menu anchor (covers the row) + Rename…, ⌘K "In the Design system" group + palette metrics.
- Unreachable lanes still unreachable: library / linked (hub), schema upgrade, AI suggest.

**14 Editing** (nothing new this round beyond what C5 landed: R1 mono → body, R2 selection anatomy, R6 name tag)
- R3 marks at rest (corner dots on non-shapes, magenta spacing dots over gap chips, tab-order badges after a pointer selection), R4 code words as names ("h1.dc-text-editing", "div", "2Q=="), R5 inspector sections not kind-gated/ordered (inspector builder), R7 in-canvas context menu icons/Cut-Copy-Paste/danger row, artboard drag picks the root div, reorder lift, align bar glyphs + overlap with labels, text-edit ring, keyboard focus ring, pen hint pills, ask bubble, component picker rows, Undo·Redo·zoom island.

**15 Annotations**
- Layers grouping under a section + lock row + filter footer, AI badge 20 px bottom-right + resolved tick 22 px success disc, struck-words, sticker toolbar icons, stamp row / ballot clusters / vote result / time pin / dangling card / snap ring (R5: built but never drawn in a real run — needs drive scripts), Templates open via S, colour-row pill, marker popover one-row, section body wash, board pack-order vs CONTRACT C13.
- Unreachable: an-rebind, an-ai-read, an-viewer, an-figjam (need AI / share grant / Figma).

## Board / CONTRACT notes
- 15 an-stk-gallery: the board shows Project status first, CONTRACT C13 says FigJam first — the implementation follows CONTRACT; fix the board text (not edited here).
- Sticky papers keep the stored hexes (`#fce8a6` etc.): the DS `--object-*` values are oklch, a stored fill is a hex (SVG `fill` cannot read a var) — the five front papers are the nearest existing hexes, not a re-colouring of old files.
