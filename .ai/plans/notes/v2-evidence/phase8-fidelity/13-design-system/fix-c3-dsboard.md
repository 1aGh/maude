# Phase 8 stage C round 3 — 13 Design system board + `ds make` (branch p8-c3-dsboard)

Nothing below is marked matched; the lead's critic judges. Stage D re-shot for the ids named in INDEX.md § "Round 3".

## Done

| what | ids | proof (red → green) |
|---|---|---|
| **RC6 `ds make` was never reaching the canvas** — the made system's folder is not in a project's canvas groups when its config has no `system/` group, so no pinned row, no `ds.go-to`, the folder view opened instead. `make` now adds the `Design system` canvas group (project that already groups `system/` is left alone). | ds-make-filling / directions / mix / done (+ inputs after) | `ds-make.test.ts` "the made system is listed" (red on feat tip) |
| **Live board** — an open board did not remount when `head.json`, `colors_and_type.css`, `tokens.json`, `components.json`, `_components.css` changed (the model is built into the module), so an AI making the system showed outlines until a reload. `hmr-broadcast.ts` now also sends a `module` reload for `system/<ds>/design-system.tsx` on those writes. | the same four | `hmr-broadcast.test.ts` "board follows its system" (red → green) |
| **RC1 the board draws the specimen** — Brand opens with the hero (glyph tile, name, "7 sections · N colours, each with a Light and a Dark value · N type styles · N components … · used by N canvases"), a logo that cannot be drawn is dropped (no `spark.svg` alt text); Colour = role groups in reading order (Surfaces · Text / Accent · Status / Brand and illustration · Links and focus), then **"Text on surfaces — contrast, Light \| Dark"** (Aa pairs, ratio in both modes, "needs 3" when one falls short), then Lines · Presence · Overlays; Type = the system's **roles** as real sentences in their own look with "29 · Semibold" beside the name (families last); Space = corners and spacing smallest first (XS → Pill ∞), 12-column **Layout grid**; Motion = four cards (curve + name + ms + job); Components = **variants × states grid** (Default · Hover · Pressed · Focus · Disabled) then Sizes. | ds-board-studio / -dark / -gator | `p8-c3-dsboard-sections.test.tsx` (7 red on feat tip → green), `ds-board-render.test.tsx` motion line updated |
| **Drawn colour picker** — L/C square + hue rail (`client/v2/ds/colour-picker.jsx`, OKLCH, pointer + arrow keys, `slider` roles); the native input stays only as a hidden fallback for the keyboard / screen reader (`ds-token-picker`); the Name row moved under Advanced so the face is Editing · Light · Dark · picker · Dark follows · contrast. | ds-edit-colour, ds-edge-contrast | `v2-ds-token-kind.test.tsx` +2, 1 updated |
| **Review sheets say what changed** — swatch pair names ("■ Azure › ■ Deeper azure", from the board model), a master's change in the editor's words ("Corners 2 → 6", `var()` resolved to the value it holds); switch head never "0 of 0 canvases" ("None of the 4 canvases in Whole project can switch"). | ds-edit-review, ds-edit-master, ds-multi-switch | `p8-c3-dsboard-review.test.ts` |

## Still open (by priority)
- **Patterns** is still "No patterns yet": real screens need canvas thumbnails on the canvas origin (no canvas-safe thumb route) — needs a decision (own artboards per kept specimen already render under the sections).
- **Swatch selection ring**: a deep-selected swatch still shows the Colour artboard's handles + `993 × 620` tag; the spec rings the swatch (2 px accent) and nothing else. Needs the selection layer to drop the artboard chrome when an element inside is selected (editing/index.tsx) — not touched.
- Brand: icons / voice / Say-not / Rules for AI (SKILL.md data is not in the board model); Space: breakpoints line; elevation names.
- Review rows: blank grey thumbs (real canvas renders), per-folder grouping in the master review, the "14 places — buttons, links, cards" sub-line; "Landing left out" is fixture.
- Make: the "Use A · Mix with…" bar, Preview toolbar and the "Studio site system is ready" banner are not drawn (the states themselves now do).
- Unreachable lanes unchanged (library / linked / schema / AI suggest / update-available / outside-change / conflict).
