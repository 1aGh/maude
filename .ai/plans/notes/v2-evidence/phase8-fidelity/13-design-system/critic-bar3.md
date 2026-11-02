# critic-bar3 — 13 Design System · "verified" bar (D5 shots, merged tip e37e7d82a)

_2026-10-25 · read-only · every id judged fresh from the D5 pairs, light and dark read for each id called verified; full-size crops opened for board-studio, edit-colour, edit-reach, edit-review, edit-instance, truth-*, multi-menu, multi-panel, multi-switch, edge-contrast, edge-trash, edge-suggest, advanced, where-gator. Decisions honoured: owning board wins (palette = 01, inspector = 14), kg `DS board hero lives at the top of the Brand artboard` (header inside Brand = deviation, not MUST), `v2-p8-ds-board-specimens-one-unit`, `v2-p8-c7-ds2-check-system-out-of-row-menu` + "Preview in… stays", `v2-p8-c7-ds3-role-row-warning-only`, Advanced open by default, rename end to end, contract over board._

**Result: 15 verified (both themes), 9 differs, 6 unreachable (AI run or hub).**

## Per id

- ds-where-studio · verified · —
- ds-where-gator · verified · — (palette groups, Ask AI row, two systems, 4 component rows; extra registry action rows are polish)
- ds-board-studio · differs · Brand logo row: the dark-lockup tile has no dark ground, so the white wordmark is invisible (empty tile); in Dark the third tile paints a near-black "maude" on a dark tile (contrast)
- ds-board-dark · differs · same Brand logo tiles (empty tile / black wordmark on dark ground)
- ds-board-gator · differs · same Brand logo tiles
- ds-edit-colour · differs · contrast line does not name the dark page: "4.8:1 on white · 4.7:1 on white" (board "5.6:1 on white · 4.8:1 on the dark page"; the board's note: contrast is checked in both modes). Selection ring, ~60 % framing, "Used in N canvases · Show", Advanced now match
- ds-edit-reach · differs · reach view only half drawn: no "Patterns on the Design system canvas" frame, the token card has no Light | Dark halves, review rows carry "Follows the system" / "1 place" with no picture-led "N places — buttons, links, cards" lines and no left-out row; the header copy and a warning line ("3.6:1 on Accent fg in Dark") replace the board's pass line; canvases drawn in a thick black frame
- ds-edit-review · verified · — (sheet, pair, Before | After, thumbs, Cancel / Update all drawn; sub-lines and the left-out row are fixture)
- ds-edit-master · verified · — (pair "Button 10 → 6", thumbs, Before | After; by-folder grouping appears only with many canvases = fixture)
- ds-edit-instance · differs · the Canvases panel is closed in the shot, so the quiet update dot on the left-out canvas row (the board's whole point, "A quiet dot, not a nag") is not on screen; inspector (Update available · Update · Detach, Uses row) is now right
- ds-truth-outside · verified · — ("Changed outside" tags on the swatches, card with file chip, old to new, Undo · Keep, no extra system block)
- ds-truth-conflict · verified · — (two pick cards named in words, "Use this", no extra block)
- ds-make-inputs · verified · —
- ds-make-directions · unreachable · AI run (directions, "Made by AI", chat question)
- ds-make-mix · unreachable · AI run
- ds-make-filling · unreachable · AI run
- ds-make-done · unreachable · AI run
- ds-many-switch · differs · the system menu is anchored under the Previewing banner, the board hangs it beside the Design systems row; the empty-inspector card shows where the board draws no inspector; the preview does not restyle the canvases in the shot
- ds-many-library · unreachable · hub + team library
- ds-many-linked · unreachable · hub-linked library
- ds-multi-panel · verified · — ("Design systems · 2 in use", amber made-before-the-schema dot, "Uses maude" door)
- ds-multi-schema · verified · —
- ds-multi-switch · verified · — (Scope seg with Folder, ticked rows with pictures, "AI restyles", "Switch 4 canvases")
- ds-multi-menu · verified · — (Open · Use for new canvases · Switch… · Rename…; Preview in… kept by decision)
- ds-multi-migrate · verified · — (three-folder convert sheet with Design system canvas / Draft chips)
- ds-edge-contrast · verified · — (Role row, "1.5:1 on Bg 4 and Bg 3", fix action, "Falls short in 2 canvases · Show", swatch ring)
- ds-edge-trash · differs · the sheet's Cancel and Move to trash are bare browser buttons (square grey outline, no kit button, no primary), light and dark
- ds-edge-suggest · differs · the question is a card at bottom centre that covers the toolbar (board: chat card bottom right, toolbar visible); the board's form is a chat card with the question and buttons
- ds-edge-migrate · verified · — (7 section rows "N pages fold into 7 sections"; no Patterns row = fixture)
- ds-advanced · verified · — (Used by, Modes, Check, CSS | JSON, token block, Files, Hand off tokens, flow card, version history, check card; narrow 250 px wrap is polish)

## Polish list

- ds-where-studio · canvas zoom, thumbnails, canvas list, two pinned systems with no "in use" header (header shows when two are in use); fixture
- ds-where-gator · palette ~620 px vs ~575 (⌘K belongs to board 01); Actions list also returns "Design system" and "Link a team library" (registry matches; board draws two); fixture systems and component rows
- ds-board-* · header "Design system · maude-v2" sits inside the Brand frame (kg: DS board hero at the top of Brand); Patterns shows 2 kept showcases (board 5) and two showcase artboards under the board (one-unit decision); scroll-position panel from the showcase artboard floats at the bottom-left of the viewport; Brand content is maude-v2 (fixture); no lock glyph (no locked colour in the fixture)
- ds-edit-colour · inspector Advanced is open with extra Light value / Name / Trash rows (Advanced-open decision); colour names are fixture
- ds-edit-review · pair reads "■ › ■ Accent" (fixture: no named old colour); sub-lines "Follows the system"; no left-out row
- ds-edit-master · flat list (folder grouping needs many folders); 4 of 4 canvases
- ds-edit-instance · instance inspector is the fuller board-14 one; canvas is a serif text button (fixture)
- ds-truth-outside · token names read as raw ids "accent", "bg-1" (swatch names are "Accent", "Bg 1"); contrast line "5.8:1 on white · 4.7:1 on white" names no dark page; stray scroll-position panel at the bottom-left (follows the one-unit showcase artboards)
- ds-truth-conflict · lowercase "accent changed in two places"; author lines "You · just now" / "Outside the app · just now" (board names people and minutes); the system bar shows "1 change waiting · Review…" with a green Review… button (board blue; check token); second side title wraps
- ds-make-inputs · tiles 2 + 1 (board 4 across), "Your canvases" tile absent (empty project), grey AI spark, what's-new toast under the sheet, backdrop is the project not Home
- ds-multi-menu · the row whose menu is open is not held highlighted with its "…" button; empty inspector card at top right (shell empty state, board draws none); system rows are fixture
- ds-multi-schema · "Keeps 4 own tokens" row, "Updates 8 canvases" fixture; no "Map by hand…" pointer (feature not built)
- ds-multi-switch · no "Previewing …" banner behind the sheet; empty inspector card
- ds-multi-migrate · folder names and counts fixture
- ds-edge-contrast · action reads "Fix to 4.5:1" (board "Lighten to 4.5:1"); extra "Used in 2 canvases · Show" row under "Falls short…"; Advanced open (decision)
- ds-edge-migrate · no Patterns row (no pattern pages in the fixture)
- ds-advanced · inspector 250 px wide so Files rows and the Check pill wrap; version history one row; result toast "Contrast: 51 of 64…" after Check; stray scroll panel bottom-left
- ds-many-switch · rows maude / maude-v2 fixture names

## Side states

- ds-many-switch/menu · system menu open (the shot is this state; its anchoring is the MUST above) · reachable
- ds-edit-colour/pending · "1 change waiting" + Review… in the bar (shot `ds-edit-colour-pending`) · reachable
- ds-edit-review/before-after · Before | After seg · reachable
- ds-make-inputs/sentence · sentence filled, Make three directions enabled (shot `ds-make-sentence`) · reachable
- ds-make-inputs/entry · entry door (shot `ds-make-entry`) · reachable
- ds-multi-schema/row · amber-dot "Made before the schema" row (shot `ds-multi-schema.row`) · reachable
- ds-edge-trash/board · the board behind the sheet (shot `ds-edge-trash-board`) · reachable
- ds-edit-reach/review-list · card with the review list under the reach view · reachable
- ds-where-gator/ask-ai · "Ask AI ⌘↵" row run · unreachable (needs a signed-in Claude)
- ds-multi-schema/bring-it-up · "Bring it up" run · unreachable (AI)
