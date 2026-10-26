# critic-bar5 — 13 Design System · "verified" bar (D7 shots, merged tip 0d2eab1d6)

_2026-10-26 · read-only · every id judged fresh from the D7 pairs (both themes read for each id called verified); full-size impl frames opened for edit-colour, edit-reach, multi-panel, truth-outside, truth-conflict, edge-contrast, edge-suggest, multi-schema, multi-migrate, board-dark. D6 pairs (git 164a7ce2a, HEAD~1) used only to explain the three regressions below. Decisions honoured: owning board wins (palette = 01, inspector = 14), kg `DS board hero lives at the top of the Brand artboard`, `v2-p8-ds-board-specimens-one-unit`, `v2-p8-c7-ds2-check-system-out-of-row-menu` + "Preview in…" kept, `v2-p8-c7-ds3-role-row-warning-only`, `v2-p8-c8-ds-offsystem-chat-card` (no composer, "building the full chat panel" rejected), `v2-p8-c8-ds-reach-patterns-strip-no-rings`, `v2-p8-c8-ds-fill-contrast-on-page`, `v2-p8-c10-misc-embed-hides-ds-bar`, `v2-d7-lead-kept-v1-controls-not-extra`, contract over board._

**Result: 21 verified (both themes), 0 in one theme, 3 differ, 6 unreachable (AI run or hub).**

Round 10 closed the two open MUSTs of bar4: ds-edit-reach no longer draws the canvas island inside the Patterns frame (both themes), and ds-multi-panel light now shows "Design systems · 2 in use", the amber "Made before the schema" dot and the "Uses maude" door like dark. **Three ids regressed on the D7 shot only**: the harness fixture no longer holds an unconverted state, so the board's sheet is not on the shot (D6 showed it; see MUST items). That is a shot/fixture defect, not a visible product change, but the bar needs the state on the merged-tip shot.

## Per id

- ds-where-studio · verified · —
- ds-where-gator · verified · —
- ds-board-studio · verified · —
- ds-board-dark · verified · — (in-app frame "maude-v2 · Light | Dark · 60 colours in their dark values", sections in dark values)
- ds-board-gator · verified · —
- ds-edit-colour · verified · —
- ds-edit-reach · verified · — (island gone from the Patterns frame; header, token card Light | Dark halves, picture-led review, Cancel / Update 4 canvases, "1 place" pills, footnote all drawn)
- ds-edit-review · verified · —
- ds-edit-master · verified · —
- ds-edit-instance · verified · —
- ds-truth-outside · verified · —
- ds-truth-conflict · verified · —
- ds-make-inputs · verified · — (empty-sentence state; filled state is the side row)
- ds-make-directions · unreachable · AI run
- ds-make-mix · unreachable · AI run
- ds-make-filling · unreachable · AI run
- ds-make-done · unreachable · AI run
- ds-many-switch · verified · —
- ds-many-library · unreachable · hub + team library
- ds-many-linked · unreachable · hub-linked library
- ds-multi-panel · verified · — (both themes now show "Design systems · 2 in use", amber dot on `maude`, "Uses maude" door)
- ds-multi-schema · differs · D7 shot shows the variant "Bring maude up to the schema? maude is on a Design system canvas, and Bring it up can't update those yet … Close" instead of the board's pre-schema sheet (Adds N roles · Renames components · Keeps own tokens · Updates N canvases, Cancel / Bring it up). The Canvases panel behind still shows the amber "Made before the schema" dot on `maude`, so the fixture has the dot and a converted system at once. D6 showed the full sheet.
- ds-multi-switch · verified · —
- ds-multi-menu · verified · —
- ds-multi-migrate · differs · D7 shot shows a plain canvas with the toast "Every design system here is already a Design system canvas." (fixture already converted) — the board's "Convert 3 system folders?" sheet (folder rows with Design system canvas / Draft chips, Cancel / Convert) is not on the shot. D6 showed it.
- ds-edge-contrast · verified · —
- ds-edge-trash · verified · —
- ds-edge-suggest · verified · —
- ds-edge-migrate · differs · same toast, no "Convert … into its Design system canvas?" section-map sheet on the D7 shot (D6 showed the 7-section sheet).
- ds-advanced · verified · —

## Polish list

- ds-where-studio · canvas zoom, thumbnails, canvas list, two pinned systems (fixture); no "in use" header with one system in use.
- ds-where-gator · palette ~620 px vs ~575 (⌘K belongs to 01); Actions list also returns "Design system" and "Link a team library" (registry); fixture systems/component rows.
- ds-board-* · header "Design system · maude-v2" sits inside the Brand frame (kg decision); Patterns shows 2 showcases and two showcase artboards sit under the board (one-unit decision); a scroll-position panel of the showcase artboard ("You're looking at 0-587 of 7738") floats bottom-left at the whole-board zoom; no lock glyph (no locked colour in the fixture); brand content is maude-v2.
- ds-edit-colour · contrast line says "on the page" (board "on white"); Advanced open with extra Light value / Name / Trash rows (decision); colour names fixture; left canvas panel collapsed to the rail (crop); pending bar is the side state.
- ds-edit-reach · canvases drawn in the web artboard's dark device bezel (board: plain light cards); Patterns frame holds 2 showcase thumbnails in a mostly empty frame, no rings and no per-pattern place count (lead decision); review sub-lines read "Follows the system" / "1 place" without "buttons, links, cards" and no left-out row (fixture); an extra "Close" button top right (exit affordance of the overlay view, the board draws a static frame); lines end on the count pills.
- ds-edit-review · pair reads "swatch > swatch Accent" (no named old colour, fixture); sub-lines "Follows the system"; no left-out row (fixture).
- ds-edit-master · flat list (folder grouping needs many folders); 4 of 4 canvases; "Corners 10 > 4" fixture.
- ds-edit-instance · update shown as a small "update" word on the row, board a dot; inspector is the fuller board-14 one; canvas text is a serif fixture button; extra Detach under Main component.
- ds-truth-outside · token ids read raw ("accent", "bg-1") where swatches say "Accent", "Bg 1"; stray scroll-position panel bottom-left.
- ds-truth-conflict · lowercase "accent changed in two places"; author lines "Maude Runner · just now" / "Outside the app · just now"; "Review…" in the system bar is green (the system's own accent on the island, board blue); the right card's source line "In colors_and_type.css" wraps to the card edge.
- ds-make-inputs · tiles 2 + 1 (board 4 across), "Your canvases" tile absent (empty project), grey AI spark, what's-new toast under the sheet, backdrop is the project not Home; the board's filled sentence + ticked tiles is the side state.
- ds-many-switch · empty inspector card ("Click an object on the canvas…") where the board draws none (the shell's empty state); no check before the in-use row; banner reads "Previewing maude-v2 in maude. 4 canvases" (board "Previewing Studio site in Warm paper"); a kind-filter chip row in the Canvases panel; fixture rows; preview restyles nothing because both fixture systems share tokens.
- ds-multi-panel · inspector is the longer Button instance with the "Uses maude" door at the top (board 14 wins over the board's short instance card); two system rows (board three, the third a draft, fixture).
- ds-multi-schema · (when the board sheet is shot) "Keeps 4 own tokens", "Updates 8 canvases" fixture; no "Map by hand…" pointer (feature not built).
- ds-multi-switch · no "Previewing …" banner behind the sheet; empty inspector card; "Folder" scope chip carries a chevron.
- ds-multi-menu · row whose menu is open is not held highlighted and shows no "…" button; empty inspector card; "Preview in…" extra (decision); system rows fixture.
- ds-multi-migrate · folder names and counts fixture (once the sheet is shot).
- ds-edge-contrast · action reads "Fix to 4.5:1" (board "Lighten to 4.5:1"); extra "Used in 2 canvases · Show" row; Advanced open (decision); role words "Text on surfaces" (board "Text on green").
- ds-edge-trash · sheet copy "No canvas uses it…" (fixture variant of the board's "All canvases use it").
- ds-edge-suggest · the card carries no composer row ("Badge · Ask AI…", needs the AI chat, decision `v2-p8-c8-ds-offsystem-chat-card`) and its question does not name the object; the card overlaps the foot of a long inspector (docked, lead decision).
- ds-edge-migrate · no Patterns row (fixture, once the sheet is shot).
- ds-advanced · inspector 250 px wide so Files rows and the Check pill wrap; one version-history row; result toast "Contrast: 51 of 64…" after Check; stray scroll panel bottom-left; fixture check findings.

## Side states

- ds-many-switch/menu · system menu open (the shot is this state; the board draws it inside the main frame) · reachable
- ds-edit-colour/pending · "1 change waiting" + Review… in the bar (`ds-edit-colour-pending`) · reachable
- ds-edit-review/before-after · Before | After seg · reachable
- ds-make-inputs/sentence · sentence filled, tiles ticked, Make three directions enabled (`ds-make-sentence`) · reachable
- ds-make-inputs/entry · entry door (`ds-make-entry`) · reachable
- ds-multi-schema/row · amber-dot "Made before the schema" row (`ds-multi-schema.row`) · reachable
- ds-edge-trash/board · the board behind the sheet (`ds-edge-trash-board`) · reachable
- ds-edit-reach/review-list · review list card under the reach view · reachable
- ds-where-gator/ask-ai · "Ask AI ⌘↵" row run · unreachable (needs a signed-in Claude)
- ds-multi-schema/bring-it-up · "Bring it up" run · unreachable (AI)

## Remaining MUST items (3 ids, one root cause)

All three need a re-shoot on a fixture that still has unconverted system folders / a pre-schema system (the D6 harness state). `ds-multi-migrate` and `ds-edge-migrate`: open the Convert sheet (pinned system row → Convert…). `ds-multi-schema`: open Bring it up on the pre-schema system. If the product itself now refuses the sheet for a system that has both the amber dot and a Design system canvas (D7 `maude`), that is the one visible product inconsistency to check.
