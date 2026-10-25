# fix-c7-cf08 — phase 8 stage C round 7, 01 Create flow + 08 Artboard kinds (branch p8-c7-cf08)

Checklist = the MUST items of `01-create-flow/critic-bar2.md` and `08-artboard-kinds/critic-bar2.md`. Budget stop reached before the whole list; what is open is named below.

## Done

| id | what | where | tests (red → green) |
|---|---|---|---|
| 08 ak-web-hug / ak-web-widths | The Artboard card reads **Width · Height · Layout · Fill · Other widths** (08 owns the card). Layout now sits before Fill for every artboard (the table's own order; the S2.22 "Fill before Layout" rule from 14 gives way), "Other widths" is its own headless slot after Fill | `inspector/sections.js`, `kinds/artboard-web.jsx` | `kind-inspector-rows` (card order), `v2-inspector-artboard`, `v2-inspector-sections-order` — red with the old order |
| 08 ak-advanced | A print board's Advanced fold leads with **Exact size · Resolution · Colour · Guides · Look and layout · In code**; **Theme** is the first row of Look and layout; Clip content and Kind (kept — nothing is taken away) come last | `inspector/advanced.jsx`, `kinds/artboard-advanced.jsx` (`ArtboardThemeRow`), `kinds/artboard-print-advanced.jsx` | `v2-inspector-print` (order + Theme in the look block) — red on the old advanced.jsx |
| 08 ak-mixed-select | The mixed-kinds card is one flat list: **Kinds · Fill (the boards' swatches + "Mixed") · Horizontal · Vertical · note**, no section heads; Left / Top (any of the six) read **pressed** when the boards already share that edge; the floating align bar ("2 artboards … Tidy up") is **not drawn over boards of different kinds** (Tidy stays in ⌘K as `artboard.tidy`) | `kinds/artboard-multi.jsx`, `kinds/multi-artboard.jsx`, `kinds/artboard-kinds-model.js` (`heldAlignment`), `editing/align-bar.tsx` (`boardsMixKinds`) | `multi-kind-shared` (3 red on the old rows), `artboard-arrange-client` |
| 08 ak-convert-after | `+13 % height · Ink fill` on the copy and `✓ Unchanged` under the post: **new dgn message `convert-marks`** (parent → canvas, own commit), the canvas paints the two marks for 12 s (`.dc-artboard-guides`, never exported, aria-hidden) | `bridge/dgn-protocol.ts`, `artboard-convert-marks.tsx`, `canvas-shell.tsx`, `canvas-lib.tsx` (mount), `client/v2/kinds/convert-api.js`, `inspector/kinds/artboard-fixed.jsx` | `dgn-protocol-gates` (parent-only, schema), `p8-c7-convert-marks` (handler red without the canvas-shell branch) |
| 01 cf-duplicate-width / -done | "Duplicate at another width" (menu) lands the copy **under the source, left edges aligned** (was: right of the row). ⌘D and the inspector's Add a width keep the row | `editing/duplicate-rhythm.ts` (`copyPlaceBelow`), `editing/artboard-actions.ts` | `v2-artboard-menu` (3 new) |
| 01 cf-panel-search | One row per canvas, the matching artboard quoted under the name ("print · “Náborový leták A6 · FLAG” and 3 more"); the artboards open by the twisty, not by themselves | `client/v2/canvases/jump-model.js` (`jumpIsOpen`) | `v2-canvases-search`, `v2-jump-list` — red on the old auto-open |
| 01 cf-search-k | ⌘K canvas rows wear a **32 × 22 picture tile** (the cover, or the same tile with the page glyph while it has none), the meta is its own right column, **Ask AI is pinned** (sticky) at the foot of a long list | `dialogs/command-palette.jsx`, `v2/search/search.css` | `p8-c7-palette-css` (rule pins) |
| 01 cf-render-error | The can't-draw card's sentence carries **no line number / "stops halfway"** (that is under Show details). The render card with **Go back to 14:05** already existed for a canvas that compiles and throws while drawing — the harness never exercised it (it wrote a syntax error): now it writes a throwing component | `v2/code/canvas-error-card.jsx`; harness `s01d.mjs` | `v2-canvas-error-card` |

## Harness (copied to `_c7-harness-g1/` and `_c7-harness-g3/`)

- g3 `t08.mjs`: the artboard is selected by its **label chip** (ak-social, ak-safe-zones, ak-video, ak-web-hug: a click in the middle landed on the photo / text inside); ak-web-hug adds a section to the page's file so the **"+ N px" growth tag** shows; ak-mixed-fit presses the **Print chip in Layers** (the "N other artboards are dimmed · Show all" foot); ak-advanced scrolls the fold to the top.
- g1 `s01b.mjs`: cf-select-tweak selects the **Desktop artboard** (label chip) with the AI panel open; cf-frames-text opens **Layers**; cf-sticky-comment ends on **N** (Sticky armed, its colour row open). `s01c.mjs`: cf-open-big presses **⌘\\** after ⌘0 (panels folded + the "Panels hidden" toast). `s01d.mjs`: the render-error variant is a throwing component.

## Open (and why)

- **01 cf-big-tree**: "a big project opens its LAST canvas, with a Recent block". No code restores the last canvas on a plain open (only the app's tab restore does), and the Canvases panel has no "Recent" block (the sort order "Recently opened" is not it). Both are new behaviour (a per-project last-canvas pref + a `recents` block in `canvases-panel.jsx` / `tree-model.js`); not started.
- **01 cf-open-big**: the read-out **"Zoom to fit · 10 %"** — the shell cannot tell a ⌘0 from a manual zoom (the key runs inside the canvas), so `ZoomUndo` keeps "10%". Needs the canvas to say "fitted" in its viewport message.
- **01 cf-add-artboard**: the size picker still opens over the new selection (its placement is `SizePickerHost`'s anchor); the "Artboard 4" tag + Preset card follow from selecting the new board (05's `select-new-artboard`), not re-checked live.
- **01 cf-duplicate-done**: the gap pill ("144") and the dashed shared left edge after the copy; the toast keeps its success tick (board neutral).
- **01 cf-ai-drafting, cf-undo-before (dark stale toast), cf-status-words / offline-create / busy** (UNREACHABLE or the AI lane — not this round).
- **08 Layers display names**: rows for unnamed children read Frame / Image (05's rule: Heading / Text / Frame); naming a Frame after its first text or an Image after its file is a layer-name change, not done.
- **08 ak-mixed-filter**: the panel keeps Search / Assets tab / Advanced foot (the board's is a hugging island with two tabs); rows are already one per canvas with thumbnail and count.
- **08 ak-advanced**: the print fold's "Grid tracks · Edit tracks…" and "Layout · Convert to absolute…" rows (frame features with no print-board engine) are not drawn.
- **08 ak-web-hug**: the "new section" selection frame (a selection of the new `<section>` would swap the card for the element inspector).

## Decisions

- `decision:maude/v2-p8-c7-card-order-08-wins`: the Artboard card is Width · Height · Layout · Fill · Other widths (the 08 board), replacing the 14-derived "Fill before Layout". Rejected: keeping Fill first for 14's `ed-ab-select` (the brief names 08 as the owner of kinds/sizes).
- `decision:maude/v2-p8-c7-convert-marks-message`: the post-convert marks come from one parent → canvas `convert-marks {v, from, to, extraPct, fill}`; the canvas builds the words. Rejected: a shell-drawn overlay (it does not know where the boards stand on screen); a toast (the board draws marks on the artboards).
- `decision:maude/v2-p8-c7-no-bar-over-mixed-kinds`: no floating align bar over boards of different kinds — the inspector's Horizontal / Vertical rows are the align there. Rejected: deleting the bar (14 draws it for one kind), hiding Tidy up everywhere.
- `decision:maude/v2-p8-c7-search-hits-stay-collapsed`: panel-search hits are one row per canvas; an artboard match is quoted, not auto-expanded (01 board). Rejected: keeping S1.3's "an artboard hit expands its canvas".
- `decision:maude/v2-p8-c7-duplicate-width-below`: menu "Duplicate at another width" places the copy below. Rejected: changing ⌘D / Add a width (08 and 14 draw the row).
