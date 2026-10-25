# P8 stage C · round 7 · c7-g15 — 15 Annotations (done vs open)

Branch `p8-c7-g15` (from feat/maude-v2 86eb0eb33). Checklist: `critic-bar2.md` MUST rows. Budget-capped: product items first, then the harness (most rows were harness states), then the re-shoot (62 pairs overwritten, harness `_c7g15-harness-g5`).

## Done — product (each with a fail-first test)

| change | ids | files | test |
| --- | --- | --- | --- |
| Marker / Sticky options are **one row** — segment · divider · inks · +N · divider · widths (the board's `.an-mkpop`); the tips are glyph-less words (the Eraser keeps its icon) | an-marker · an-place (paper dots) | `tool-palette.tsx`, `toolbars/toolbar-css.ts` | `tool-palette.test.tsx` (reverted once: red) |
| Sticker search **lights the first result** (`data-on`, accent-muted + 1.5 px accent ring) and **↵ puts it down** | an-stk-search | `client/v2/annotations/stickers-gallery.{jsx,css}` | `stickers-gallery.test.tsx` |
| **Connection dots are not drawn at rest** beside a selected sticky / sticker / shape: a transparent hit circle still carries the connector gesture, the dot shows under the pointer | an-stk-drop · an-sticky · an-arrow-bind | `annotations-layer.tsx` | `annotations-mode-render.test.tsx` |
| Sticker toolbar: **Duplicate is an icon button**, Replace… / Flip carry their glyphs (`IconStampDisc`, `IconFlip`, `IconDuplicate` added) | an-stk-drop | `annotations-context-toolbar.tsx`, `canvas-icons.tsx` | `annotations-sticker-drop.test.tsx` |
| The **Start-a-vote sheet is opaque** (`--bg-2`, the popover/sheet surface) — the inspector no longer reads through it | an-vote · an-stamps | `client/v2/annotations/vote.css` | `p8-c7-g15-css-pins.test.ts` |
| The **"Not printed" pill paints above the paper** (it is the first child, the paper a later sibling: round 4 moved it inside the note and it vanished) | an-print | `annotations/ui/time-pins.tsx` | `p8-c7-g15-css-pins.test.ts` |

## Done — harness (the board state is now the one shot)

- Desktop framed at ~60 % (⌥⌘1 + one ⌘−) instead of fit-all at 37 %: stickies, arrow strokes, chrome and copy read at drawn size (every id of groups a, b, c, e).
- an-place: Preview with the Sticky tool armed (paper dots + pressed Sticky). an-sticky: a sticky selected and zoomed to (2 px outline on the sticky, the small toolbar). an-marker: stroke drawn, Esc, M (the pill with the stroke visible). an-section: Preview with the section selected (Fold · Ask AI about it · swatches).
- an-follow: a bound connector from the loose note to the button. an-crowd: two steps past fit (LOD). an-stk-drop: dropped over Desktop and waited for the upload (a short wait shot the broken-picture placeholder). an-vote: opens through ⌘K "Start a vote…" (the artboard menu no longer lists it).

## Open

- an-stk-gallery: the dock does not press **E** while the gallery is open (the Stickers slot is panel-only; the shell draws the panel and nothing reports it back to the canvas toolbar — needs a shell→canvas dgn message, a shared file). Pack order is CONTRACT C13 (FigJam Doodle first), not the board's Project-status-first: the contract wins.
- an-arrow-bind: snap ring + "Button · See the work" tag (a drag-to-snap gesture shot); an-follow: elbow re-route + position bubble; an-arrow-kinds: heads menu open; an-dangling: dashed end + "Point to…" card; an-video: "0:12" time pin + timeline marks; an-stamps / an-vote running bar + result; an-convert: converted thread card; an-visibility: ⇧P hidden + toast; an-plan: kanban column tint / stamps / legend (template output); an-ai-write: paper with spark edge + "AI" chip; an-today: text / link / media / group / dashed states; an-crowd: section counts + hover card.
- an-stk-search: result tiles show no background in light (tile `--bg-1` on a `--bg-1` panel); the empty-state card is a side shot. an-templates: kanban ghost follows the pointer.
- Unreachable (unchanged): an-ai-read, an-ai-apply, an-ai-stickers, an-rebind, an-viewer, an-figjam.

## Decisions
- `decision:maude/v2-c7-g15-marker-popover-one-row`: the Marker / Sticky colour popovers are one flex row with divider elements — rejected: a new component (the data/gestures are unchanged; only the layout differs), 3 widths (the board's `.an-thick--2` draws two).
- `decision:maude/v2-c7-g15-connection-dots-on-hover`: keep the four magnets as a transparent hit circle, show the dot under the pointer — rejected: removing the dots (the only way to start a bound connector from a shape), showing them while hovering the whole element (the layer has no per-stroke hover state).
- `decision:maude/v2-c7-g15-first-result-lit`: the first search result is `data-on` and ↵ places it (the board's lit first cell is the ↵ target) — rejected: a roving arrow-key grid (larger than this round; the gallery has no list keyboard model yet).


---

# Round 8 · p8-c8-ann — 15 Annotations (done vs open)

Branch `p8-c8-ann` (from feat/maude-v2 0c3654abf). Checklist: `critic-bar3.md` MUST rows. Harness `_c8ann-harness-g5` (copy of `_d5`, s15 / s15g edited); re-shot light + dark on the branch tip.

## Done — product (each with a fail-first test, reverted once)

| change | ids | files | test |
| --- | --- | --- | --- |
| Showing the layer again takes the "Annotations hidden. Press ⇧P…" toast down (it sat out its 10 s clock over the next scenes) | an-vs · an-layers | `client/hooks/annotations-hidden-toast.js`, `use-photo-and-timeline.jsx` | `p8-c8-ann-hidden-toast.test.tsx` |
| Every selection toolbar ends in "…" (word menu; Delete is its "Move to trash" row) — LEAD decision `maude/v2-p8-c8-annot-toolbar-overflow` | an-sticky · an-section · an-stk-drop · an-arrow-kinds | `annotations-context-toolbar.tsx` (`ToolbarMore`) | `annotations-convert-ui` · `annotations-arrow-toolbar` · `annotations-sticker-drop` · `s4-19-fidelity` |
| Sticky bar: colours · size · list · Lock · Turn into a comment (icon) · "…" (Resolve in the "…") | an-sticky · an-convert | same | `annotations-convert-ui.test.tsx` |
| Arrow bar: kind · head · inks · Lock · "…"; widths, Two-way and Dashed moved into the "…" (shapes keep Dashed / widths on the bar) | an-arrow-kinds · an-arrow-bind · an-follow · an-dangling | same | `annotations-arrow-toolbar.test.tsx` |
| The zoomed-out crowd: each section is its own tone (washed block, solid count chip, ink readable on dark) | an-crowd | `annotations/ui/lod.tsx` | `annotations-lod.test.ts` |
| A note over a print artboard is ghosted at .88 | an-print | `annotations/ui/time-pins.tsx` | `annotations-pin-tags.test.tsx` |

Testids: `annot-ctx-more` / `-delete` / `-dashed` / `-thin` / `-thick` added; `annot-arrow-two-way` and `annot-ctx-resolve` now live in the "…" (testids.json + TESTIDS.md, openers.mjs `annot-arrow-sel` / `annot-sticky-sel` open it, desktop e2e `surface.e2e.ts` deletes through it).

## Done — harness (the board state is now the one shot)

an-section (lilac section, framed whole) · an-today (the whole catalogue seeded, size menu open) · an-sticky (toolbar above the sticky) · an-follow (Elbow set before the drag) · an-dangling (the dangling arrow selected → card + Point to…) · an-convert (thread card + menu on one canvas, the menu on the upper note) · an-plan (toned columns, coloured cards, free space) · an-stamps (stamps + folded tray) · an-crowd (five coloured sections, panel shut, below 25 %) · an-layers (a locked sticky selected).

## Open

- an-follow: the "Let go — the shortest clean path, over Mobile" bubble and the "straight line would cross Mobile" tag are not drawn by the product (elbow routing itself is). Needs a transient tag while an artboard with a bound elbow arrow is dragged.
- an-stk-drop: after the drop the dock presses Hand; the board keeps Stickers pressed while the placed sticker is selected (the palette lives outside the selection context).
- an-print: the dashed print-area / bleed outline on the artboards is canvas-lib's print guides (08 kinds), not drawn in Preview.
- an-plan: legend, stamps on cards and arrows to the artboards are AI-run output; an-video: timeline marks need footage; an-vote / an-stamps count popover need a second person.
- Unreachable (unchanged): an-ai-*, an-rebind, an-viewer, an-figjam.

## Decisions
- `decision:maude/v2-p8-c8-ann-toolbar-more-menu`: one `ToolbarMore` "…" word menu ends every selection toolbar; an arrow's widths / Two-way / Dashed live in it (the board draws none of them on the bar) while shapes keep Dashed and widths — rejected: dropping them (nothing-deleted), a separate arrow-options popover.
- `decision:maude/v2-p8-c8-ann-hidden-toast-follows-layer`: the shell dismisses the toast whenever the layer is visible again — rejected: a harness-only fix (a real person sees the stale sentence for 10 s).
- `decision:maude/v2-p8-c8-ann-lod-section-tone`: the crowd's section block and count chip use the section's own colour — rejected: neutral rgba blocks (invisible on dark).
