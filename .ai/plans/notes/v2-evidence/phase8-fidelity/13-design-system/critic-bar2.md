# critic-bar2 — 13 Design System · re-evaluation on the "verified" bar (D4 shots, merged tip 21c9714cf)

_2026-10-25 · read-only · every id judged fresh from the D4 pairs (light and dark read for each id called verified; full-size crops opened for where-studio, make-inputs, multi-schema, edge-trash, board-studio, edge-suggest). Lead decisions honoured: owning board wins, contract over board, inspector per 14, specimens one unit with the board, fixture names/zoom/canvas lists are not blockers._

**Result: 3 verified (both themes), 21 differs, 6 unreachable (AI run or hub).**

## Per id

- ds-where-studio · verified · —
- ds-where-gator · differs · Actions list draws 4 rows (an extra "Design system" action + "Link a team library"; board draws 2); palette ~620 px wide vs ~575 (>4 px); the Ask AI row is clipped by the footer.
- ds-board-studio · differs · board header ("Design system · maude-v2 · counts") sits inside the Brand frame and its counts line is cut off; Colour swatches carry no "Used in N canvases" line; Brand lockup row has an empty tile; a scroll-position panel ("Desktop showcase · You're looking at…") floats over the board.
- ds-board-dark · differs · same board defects (header collision, no usage lines, empty logo tile).
- ds-board-gator · differs · same board defects; no lock glyph on locked colours.
- ds-edit-colour · differs · selection is the Colour artboard's handles + size tag (not a ring on the swatch); the swatch is not framed at ~60 % (9 %/29 % camera); no "Used in N canvases · Show" row; contrast line does not name both pages ("5.6:1 on white · 4.8:1 on the dark page").
- ds-edit-reach · differs · the reach view is not drawn (no lines from the swatch to canvas spots, no card-with-review flow); Show is not offered.
- ds-edit-review · differs · pair shows "■ › ■ Accent", not the old and new names; rows have blank grey thumbs and "Follows the system" instead of "14 places — buttons, links, cards"; no left-out row with update dot.
- ds-edit-master · differs · rows have blank thumbs and no "places" sub-line; header lacks the master swatch pair beside "Corners 2 → 6".
- ds-edit-instance · differs · no "Update available" block (Update · Detach) on the instance; inspector is a plain frame inspector, not a component-instance inspector.
- ds-truth-outside · differs · the card draws now (file, old to new, Undo · Keep) but no "Changed outside" tag on the swatches, and the inspector carries an extra "Which way changes flow" block under it.
- ds-truth-conflict · differs · pick cards name the colours by raw oklch values (CONTRACT: never a raw oklch/hex), no author/time lines; extra "Which way changes flow" block.
- ds-make-inputs · verified · —
- ds-make-directions · unreachable · needs an AI run (directions, "Made by AI" tags, chat question).
- ds-make-mix · unreachable · needs an AI run (directions to mix; chat card).
- ds-make-filling · unreachable · needs an AI run (progress, "AI is setting the type").
- ds-make-done · unreachable · needs an AI run (ready banner, done card).
- ds-many-switch · differs · switch menu hangs under the banner, not at the Design system row; the inspector's empty hint shows (board draws none); canvases are not restyled in the preview.
- ds-many-library · unreachable · needs a linked hub + team library.
- ds-many-linked · unreachable · needs a hub-linked library.
- ds-multi-panel · differs · no "Design systems · N in use" header; no amber "made before the schema" dot on the draft row; inspector shows the empty hint, not the "Uses <system>" door.
- ds-multi-schema · verified · —
- ds-multi-switch · differs · sheet reads "None of the 4 canvases in Whole project can switch" with unticked rows and a disabled primary (board: Folder scope, ticked rows, "Switch 5 canvases"); blank thumbs; no "AI restyles" toggle.
- ds-multi-menu · differs · copy "Default for new canvases" (board: "Use for new canvases"); no Rename…; extra "Preview in…" and "Check the system".
- ds-multi-migrate · differs · the "Convert 3 system folders?" sheet is not drawn (plain canvas shown).
- ds-edge-contrast · differs · warning names Bg 4, Bg 3, Bg 0 in Light and Dark (board: two surfaces, "Role · Text on green" row); no "Falls short in N canvases · Show" row; selection is artboard handles.
- ds-edge-trash · differs · the sheet's Cancel and Move to trash are unstyled square buttons (kit dialog uses a grey Cancel and a primary Move to trash); light and dark.
- ds-edge-suggest · differs · the question is a card at bottom centre that covers the toolbar (board: chat card bottom right with the toolbar visible); extra "U" badges on every canvas row.
- ds-edge-migrate · differs · no per-section map ("42 pages fold into 7 sections"); impl shows the two-folder list.
- ds-advanced · differs · no "Used by · N canvases" row; Advanced collapsed (no CSS|JSON toggle, token block, Files tree, Hand off tokens); one version-history row; no "Check the system" result card.

## Polish list

- ds-where-studio · pinned rows are two system rows (fixture: two systems) with no "Design systems · N in use" header (header is a MUST on ds-multi-panel); canvas zoom, thumbnails and canvas list are fixture.
- ds-make-inputs · Anything-to-learn tiles wrap 2 + 1 (board: 4 across, filled grey tiles, check badge); "Your canvases" tile absent (fixture: project has no canvases); AI spark glyph is grey (board: accent); a what's-new toast sits under the sheet; backdrop is the project, not Home.
- ds-multi-schema · "Keeps 4 own tokens" row and "Updates 8 canvases" are fixture; closing line has no "Design system › Advanced › Map by hand…" pointer (feature not built).
- ds-board-* · the Patterns section shows 2 kept showcases (board 5) and two showcase artboards sit under the board (lead decision v2-p8-ds-board-specimens-one-unit); Brand shows maude-v2 content (fixture).
- ds-many-switch · rows maude / maude-v2 are fixture names.
- ds-edge-trash · "No canvas uses it" copy is fixture.

## Side states

- ds-many-switch/menu · system menu open under the banner · reachable (anchoring differs).
- ds-edit-colour/pending · "1 change waiting" + Review… in the bar (shot `ds-edit-colour-pending`) · reachable.
- ds-edit-review/before-after · Before | After seg on the review sheet · reachable.
- ds-make-inputs/sentence · sheet with the sentence filled and Make three directions enabled (shot `ds-make-sentence`) · reachable.
- ds-make-inputs/entry · entry door (shot `ds-make-entry`) · reachable.
- ds-multi-schema/row · amber-dot "Made before the schema" row (shot `ds-multi-schema.row`) · reachable.
- ds-edge-trash/board · the board behind the sheet (shot `ds-edge-trash-board`) · reachable.
- ds-where-gator/ask-ai · "Ask AI ⌘↵" row run · unreachable (needs a signed-in Claude).
