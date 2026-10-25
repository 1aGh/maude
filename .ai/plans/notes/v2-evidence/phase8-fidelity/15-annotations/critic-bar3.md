# critic-bar3 — 15 Annotations — re-evaluated on the D5 merged-tip shots (v2-michal-verified-bar)

_Inputs: D5 full-size pairs (both themes read for every verified id), critic-bar2.md, fix-c7-g15b.md / fix-c7-oboard.md, board `.design/ui/v2/15 Annotations.tsx`. Lead decisions honoured: CONTRACT C13 pack order, sticky toolbar per lead (five papers + size + list + Lock + Turn into a comment), connection dots on hover only, first search result lit._

**Verified (both themes): an-enter · an-place · an-visibility · an-arrow-bind · an-marker · an-templates · an-stk-gallery · an-stk-search. Differs: 15. Unreachable: 8.**

## Per id
- an-enter · verified · none
- an-place · verified · none (Preview + armed Sticky + paper dots match; stack / typing-grows are gestures → side row; AI-seeded cream papers, no authors/badges = fixture)
- an-sticky · differs · selected-sticky toolbar tail: no "Turn into a comment" (lead decision), order is colours · size · list · more · lock · trash (board: … · lock · comment · more); toolbar sits over the sticky bottom instead of above it
- an-today · differs · text size menu, shape set, picture/link card, clip chips, group toolbar, dashed lists, colour rows are not drawn — only one shape + arrow on canvas
- an-arrow-bind · verified · none (arrow ink is the theme ink, board draws accent blue = polish)
- an-follow · differs · no elbow re-route around Tablet, no "Let go — shortest clean path" bubble, bound arrow stays a curve through the artboard
- an-arrow-kinds · differs · toolbar order is inks · widths · kind · head · two-way · dash · lock · trash (board: kind · head first, inks after, lock; dash/trash extra); still open from round 7
- an-marker · verified · none (one-row popover now matches; stroke ink is faint on a white artboard in dark = fixture ink)
- an-section · differs · shot frames the section badly (frame cut off, one note), chip/body are neutral grey not the object colour tint, tail is trash instead of …
- an-templates · verified · none (empty prompt field + no ghost = fixture/side)
- an-plan · differs · kanban columns untinted (board: per-status tint + count chips), cards blank, no legend/stamps/arrows to artboards; filled cards need an AI run
- an-stk-gallery · verified · none (C13 pack order = lead decision; no Recent row = empty fixture; panel title "Stickers · E" absent = polish)
- an-stk-search · verified · none
- an-stk-drop · differs · after the drop the dock presses Hand, board keeps Stickers (E) pressed; toolbar tail trash vs …
- an-stamps · differs · stamp tray, ballot clusters on the artboards not drawn; shot is the running-vote bar of an-vote
- an-vote · unreachable · running bar "4 of 5 done", ballots and result section need a second person (Start-a-vote sheet is the reachable side row)
- an-vs · differs · stale "Annotations hidden. Press ⇧P…" toast while the layer is visible (leaks from an-visibility run); otherwise matches
- an-convert · differs · converted thread card not on the canvas; sticky menu is a superset (Cut/Paste/Bring forward/Send backward/Group) of the board's 8 rows and clips over the dock
- an-ai-read · unreachable · AI run
- an-ai-apply · unreachable · AI run
- an-ai-stickers · unreachable · AI run
- an-ai-write · unreachable · AI run (notes with spark edge + arrows + chat reply)
- an-layers · differs · stale "Annotations hidden" toast; locked sticky (lock row, Locked · Unlock toolbar) not drawn; person chips / counts / section grouping = fixture
- an-rebind · unreachable · needs AI rewrite of a bound button
- an-dangling · differs · no dashed end, no dashed outline of the trashed target, no "Pointed at … — moved to the trash" card with Point to…
- an-crowd · differs · stickies are one flat pale colour, no section blocks with counts, no hover card; Layers panel open + stray "+ 29 px" chip
- an-video · differs · note + 0:00 pin present, but no timeline strip with note marks and no "0:12" (fixture has no footage)
- an-print · differs · note not ghosted, no dashed print-area outline on the artboards ("Not printed" pill now OK)
- an-viewer · unreachable · share-grant viewer session
- an-figjam · unreachable · needs a Figma connection

## Polish list
- an-arrow-bind · arrow ink is theme ink (pale on dark over a white artboard), board draws accent blue
- an-stk-gallery · panel header "Stickers · E" missing; Recent row absent (nothing placed); search focus ring on open
- an-stk-search · chip "complete" vs "approved" and tile captions (pack data); panel header missing
- an-stk-drop / an-section / an-sticky · toolbar tail is a trash button where the board draws "…" (consistent across three boards: lead to confirm as decision)
- an-templates · prompt field empty with spark (board typed + send); zoom 71 % vs 42 %; leftover "Tereza's feedback" chip and marker stroke (fixture)
- an-marker · stroke ink faint on white artboard in dark; stray blue frame at the bottom edge (fixture)
- an-place · papers cream/AI-seeded, no author lines, no numbered badges
- an-vs · Comments panel beside is 05's

## Side states
- an-place/stack · sticky dropped on another stacks 12 px down-right · reachable
- an-place/typing · typing grows to five lines, then wider · reachable
- an-enter/edit-state · Edit before N (quiet stickies) next to the Preview frame · reachable
- an-visibility/palette · ⌘K "resolved" actions + "6 stickies moved to the trash · Undo" toast · reachable
- an-visibility/edit-quiet · Edit shows faded paper, click selects the design · reachable
- an-visibility/select-all · ⇧⌘A selection with Lock/Wrap/Move to section bar · reachable
- an-templates/ghost · kanban ghost follows the pointer · reachable
- an-stk-search/empty · "No stickers match 'hotovo'" card + English hint chips · reachable
- an-sticky/stack-menu · Fan out / Bring to front / Send to back menu · reachable
- an-marker/hover-tag · "On Post 1:1 — moves with it" on stroke hover · reachable
- an-section/folded · collapsed sections "Nápady na story 6 stickies · 2 people" · reachable
- an-print/export-sheet · Export sheet with "Include annotations" · reachable
- an-vote/start-sheet · Start a vote sheet (reachable, shot) · reachable
- an-stamps/count-popover · "5 stamps on Směr B" with people · needs a second person → unreachable
