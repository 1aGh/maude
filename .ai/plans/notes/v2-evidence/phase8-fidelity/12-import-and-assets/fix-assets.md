# Phase 8 C9 — 12 Import and Assets (stage C round 2), done vs open

Branch `p8-c2-assets` from feat/maude-v2 `5324d3aaf`. Stopped on the budget call (about 300k tokens); everything below that says "done" is committed, tested and re-shot (stage D: all 19 reachable ids × dark + light, the committed `*.jpg` pairs overwritten).

## Commits

| sha | what |
|---|---|
| 414834fae | Assets panel: All kinds chip menu, Generate (spark colour) + Add at the right end of the chip row, no ⌘K in the field, library foot "N assets · size", groups cap at two rows (the count opens Browse), search groups "In the name or tags" with a match foot on each tile, tile tip below the tile, pick circles in Browse, semibold group heads, search ring, tile hairline, tidy foot on one line, Copy ⌘C + separator in the tile menu |
| f8b86a31a | SHARED: left panel island 248 wide (`usePanelSize` def 264 in `hooks/use-shell-core.jsx`) and stops above the bottom row (`v2/shell/floating-panels.css` slot `padding-bottom: 72px`; a docked chat keeps the bottom edge) |
| 94cf73e48 | details: "…" More button, canvas covers in Used in, 150 px cover crop, no lone "Photo" head; Missing frame fills the picture frame with a warning card; the inspector Missing box is the board's `.ia-missbox` |
| 0353bbd5c | drop: the chip names the artboard ("Drop to place 6 photos in Fotky ze zápasu"), sits above a solid accent ring with a tint halo, no fill |
| 3f45b249a, 89c1c5e22 | SHARED `client/shell/icons.jsx`: the `warn` glyph. Import: Figma sheet 372, brand sheet 420, semibold title, lock in "Figma isn't connected", warning in "Couldn't read" |
| 34cea8bc3 | generate ask: calm shape line (no red alert before an attempt), kit chips, spark title, the two starters |
| 7a8a691a4 | placed toast "Placed N photos in X. They're in Assets too." + Undo from the panel; ContextMenu / ⇧F10 open the tile menu; offer card with hairline |

Tests (new `test/p8-c9-assets.test.tsx`, 18): foot words, kind filter, panel render (no ⌘K, chip row, 2-row cap, search groups + match foot, kind chip, ContextMenu key, pick circles), CSS pins (tip below, semibold head, search ring, 72 px stop, 264 default), `frameBox` (Missing frame), `dropHint` with a label, import sheet pins, ask render, `placedWords` = `placedLine`. Red→green: the old `assets-panel.jsx` fails 4 of the render tests (no chip row, no foot, no cap, no search groups). Updated for the board: `v2-assets-panel` and `v2-assets-browse` (tile-menu rows), `finder-drop-client` (chip words). Not touched: the p8-redtests2 files.

## Per artboard (dark = light unless noted)

| id | now | note |
|---|---|---|
| ia-drop-photos | board-fixed in code, shot still differs | ring + chip fixed in `finder-drop.tsx`; the synthetic drag is dispatched on the artboard element from the shell lane, so the capture lane never shows the ring. Needs a drag inside the iframe or the desktop e2e |
| ia-placed | fixed (toast + Undo) | fixture's one-`<img>` artboard refuses the place ("Not placed…"), so the toast is not in the frame (data) |
| ia-more-ways | unreachable | prepare-in-place clip card, "3 clips · Assemble", logo notice are product work, not started |
| ia-assets-panel | fixed | All kinds, spark+Add, foot, 2-row cap, head, tip; Video/Sound/Logos/Generated groups are data |
| ia-assets-keys | fixed except Rename… | tip below the tile; menu has Copy ⌘C + separator |
| ia-assets-browse | fixed | the wide view takes the island's box (tabs row covered, stops above the toolbar), pick circles, semibold day head; "Zápas vs. Panthers" event grouping is data |
| ia-assets-find | fixed (state 1) | ring, "In the name or tags", match foot, offer card; states 2–4 need an AI stub |
| ia-assets-tidy | fixed | soft chip (C1) + foot on one line; "Not counted" is data |
| ia-asset-details | fixed | More, covers, 150 px crop; Added-by avatar and AI-saw chips are data |
| ia-photo-inspector, ia-photo-steps | not a product bug | the gate is content-addressed names (`assets/<sha8>.ext`), which every real import produces (`api.ts` stores by hash). The lane's fixture photos have human names, so the Photo section never mounts. Re-shoot needs an imported photo in the fixture |
| ia-gen-ask | partly | kept the inline ask in Assets (the board's subtitle says "From the AI chat panel or Assets › Generate"); calm line, kit chips, starters. Hosting it in the AI island is open |
| ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges | unreachable | need a provider / Figma API / site fake / second peer stub — not built |
| ia-figma-sheets, -connect | fixed | 372 wide, semibold title, lock callout |
| ia-brand-steps (+1, 2, 3) | fixed | 420 wide, warning in the callout. "SVG, PNG or PDF" stays "SVG" (the importer takes SVG only) |
| ia-missing-gone | fixed | frame hatch + warning card + Relink…; inspector box is the board's well. "Added by Tereza on 1 Oct…" needs who/when on a Missing item (the state plane has none) |
| ia-advanced | C1 fold; no change here | the board's own CSS also pins Advanced to the foot with anywhere-wrap, so the impl matches it |

## Open

- **Rename…** in the tile menu: needs `POST /_api/assets/rename` (rewrite every canvas reference + sidecars + undo, a `routes/` entry through `routes/index.ts`, classified in the writer registry). Proposed own task.
- Generate ask inside the AI island (chat panel is C6's); ia-more-ways states; the unreachable stubs above; Photo inspector re-shoot with an imported photo; "Replace…" next to Relink… on a Missing picture.
- ia-photo-inspector R6 "img" word: `tagWord` already says Photo (editing-owned); not re-checked in a shot.

## Decisions

- `v2-8.5-c9-from-this-mac-row-04-owns`: the "From this Mac…" row stays in the Assets panel (04 Modes and 14 Editing both draw it, they own the Image-mode popover); 12's board is the one that lacks it.
- `v2-8.5-c9-browse-takes-island-box`: Browse measures the dock island, not the panel body, so it covers the tab row and stops where the island stops.
- `v2-8.5-c9-missing-frame-ancestor-box`: a collapsed broken `<img>` borrows its nearest ancestor of at least 96 px for the card (`frameBox`).
