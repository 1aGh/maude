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
