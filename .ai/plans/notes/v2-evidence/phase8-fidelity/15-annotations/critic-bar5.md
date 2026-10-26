# critic-bar5 — 15 Annotations — judged fresh on the D7 merged-tip shots (0e926b7dc), v2-michal-verified-bar

_Inputs: D7 pairs (light + dark read for every id called verified; full-size crops where borderline), critic-bar4.md, fix-c7-g15b.md, fix-c7-oboard.md (round-10 section), INDEX round 10 + FINAL (D7), board `.design/ui/v2/15 Annotations.tsx` spec shots, kg `v2-p8-c10-ann-*` / `v2-p8-c8-ann-*`. Lead decisions honoured: CONTRACT C13 pack order (Project status last), annotation toolbars end in "…", owning board wins for the shared object menu rows (an-convert), stamp tray centred over the Stickers slot with no Done (Esc lets go), converted card ends in Resolve + "…" (rest behind it), dangling ghost from the bind box, Stickers pressed while a dropped sticker is selected, hidden toast follows the layer, first search result lit._

**Verified (both themes, 20): an-enter · an-place · an-sticky · an-today · an-visibility · an-arrow-bind · an-arrow-kinds · an-marker · an-section · an-templates · an-plan · an-stk-gallery · an-stk-search · an-stk-drop · an-stamps · an-convert · an-dangling · an-crowd · an-print · an-vs. Differs: 3 (an-follow · an-layers · an-video). Unreachable: 8 (an-vote · an-ai-read · an-ai-apply · an-ai-stickers · an-ai-write · an-rebind · an-viewer · an-figjam).**

## Per id
- an-enter · verified · none (Preview + Sticky pressed, colours +5 above the dock, quiet pill; "Edit before N" frame = side row)
- an-place · verified · none (notes on the artboard, Sticky pressed, colours; AI-seeded cream papers, no author lines / no numbered badges = fixture; stack / typing-grows = side rows)
- an-sticky · verified · none (selected-sticky bar above the sticky: colours +5 · Medium · list · Lock · Turn into a comment · "…", as the board; stack menu / 10-colour popover / author hover = side rows)
- an-today · verified · none (catalogue now one frame: five text sizes, shapes incl. dashed triangle, picture, link card, video + audio chips, dashed arrow, bullet / numbered stickies, group bar with two notes selected; size menu, shape Stroke/Fill bar and marker + highlighter rows are shot as side states)
- an-visibility · verified · none (hidden layer + "Annotations hidden. Press ⇧P to bring them back. Show" toast; Edit dock shown, valid because the board says "in any mode"; palette / select-all / Edit-quiet = side rows)
- an-arrow-bind · verified · none (held arrow, candidate outline + snap ring + "Button · See the work" tag)
- an-arrow-kinds · verified · none (bar Straight|Curved|Elbow · head menu (open) · inks · +5 · Lock · "…"; label on the line / edge bind = side rows)
- an-marker · verified · none (popover Marker|Highlighter|Eraser · inks · +4 · widths; ink is theme ink, faint on a white artboard in dark = fixture ink; hover tag = side row)
- an-section · verified · none (lilac section with tone chip + count, bar colours · Fold · Ask AI about it · Lock · "…"; framing over artboards = fixture; folded sections = side row)
- an-templates · verified · none (eight tiles, "or drop on the canvas for a blank one", prompt field with spark; kanban ghost = side row)
- an-plan · verified · none (plan alone: three toned columns with count chips, channel-coloured cards, Done cards pointing at the Tablet and Mobile artboards; straight arrows that cross the other columns, no channel legend, no stamp avatars = AI-built / fixture, see Polish)
- an-stk-gallery · verified · none (Stamps row · four packs in the C13 order · search focused · source links; pressed Stickers slot)
- an-stk-search · verified · none (query "done", count chips, first result lit, "No 'done' in …" hint, sources)
- an-stk-drop · verified · none (sticker placed, Stickers (E) stays pressed, bar Replace… · Flip · Lock · Duplicate · "…", 160 × 160 chip)
- an-stamps · verified · none (folded tray centred over the Stickers slot, no Done, stamp placed on the artboard; count popover / ballot clusters need a second person = side row)
- an-convert · verified · none (thread card beside its pin: "From AI's sticky · turned into a comment by You · Undo", message, Resolve + "…"; sticky menu = shared object menu superset, toast "Turned into a comment. Undo")
- an-dangling · verified · none (arrow selected with bar incl. "…", dashed ghost outline of the trashed button, "Pointed at "See the work" — moved to the trash" + Point to…; "by <person>" = fixture)
- an-crowd · verified · none (sections at LOD with solid count chips "Nápady 84" fully readable both themes, coloured sticky blocks; hover card = side row)
- an-print · verified · none (print area outline + crop marks + "Bleed 3 mm · trim · safe margin 3 mm" legend, note ghosted with "Not printed" pill; export sheet = side row)
- an-vs · verified · none (comments-vs-annotations frame: layer + Comments panel; harness "Undone · move 1 artboard · Redo" toast = polish)
- an-follow · differs · (1) the "Let go — the shortest clean path" route bubble and the "the straight line would cross Mobile" tag the board draws while dragging are not drawn (open since round 10); (2) the bound arrows render as thin dashed curves that pass across the top of Tablet / Mobile, not an orthogonal elbow routed around Mobile. Shown and matching: loose note beside Mobile with its "stays where it is" label, X/Y drag chip
- an-layers · differs · the selected locked sticky ("Locked · Unlock ⇧⌘L" bar + "Locked — unlock to move it" tip are now visible) has no highlighted row in the Layers list (board lights the selected row; code sets `aria-current` → `--accent-tint`, the shot shows none). Section grouping / person chips / "Hidden by the filter" footer = fixture (no sections, one author, filter Everyone)
- an-video · differs · no timeline strip with note marks, "0:12" pin and "2 notes · 1 comment" line under the video (the strip is a drawn control; shot shows only the pinned note + its bar and the "⌘Enter commits" hint; fixture video is an empty dark frame)
- an-vote · unreachable · running vote bar "Vote … · 0 left of your 3 · 1:42 · 4 of 5 done · End vote", ballots and the result section need a second person (Start a vote sheet is the reachable side row)
- an-ai-read · unreachable · AI run
- an-ai-apply · unreachable · AI run
- an-ai-stickers · unreachable · AI run
- an-ai-write · unreachable · AI run (spark-edge notes + arrows + chat reply)
- an-rebind · unreachable · needs an AI rewrite of a bound button
- an-viewer · unreachable · share-grant viewer session (shot is the stale card)
- an-figjam · unreachable · needs a Figma connection

## Polish list
- an-today · group bar shows a Group icon + one align menu (chevron) where the board draws a "Group" label and three icons (align left / top / distribute); verify distribute lives in the align menu
- an-today · picture carries no filename tag ("trenink-03.jpg"); video / audio chips are inline players with "0:00 / 0:00" (stub media) where the board draws icon tile + name + length
- an-today · "Hej!" and the other text ink is mid-grey (board near-black / white); AI-seeded cream papers over the artboard = fixture
- an-arrow-bind · arrow ink is theme ink, board draws accent blue
- an-arrow-kinds · selected arrow is one vertical line (board shows three kinds side by side) — gestures
- an-place · papers cream / AI-seeded, no author lines, no numbered badges
- an-marker · stroke ink faint on a white artboard in dark
- an-section · bar tucks under the mode pill; two stickies; "Tereza's feedback" chip text
- an-templates · prompt field empty with spark (board typed + send); zoom 71 % vs 42 %; leftover note chips
- an-stk-gallery · panel header "Stickers E" and the Recent row absent (nothing placed); pack order is the C13 decision
- an-stk-search · chip "complete" vs "approved", tile captions (pack data)
- an-stamps · pressed stamp is ⭐ vs the board's 👍; one stamp placed vs ballot clusters (people)
- an-convert · shared object menu rows (Cut / Paste / Bring forward / Send backward / Send to back / Group selection) — owning boards draw them; thread author "AI" vs Jonas / You = fixture
- an-plan · Done arrows are straight and cross the other columns (board curves around); no channel legend, no stamp avatars (AI-built content); kanban sits right of the artboards (board left)
- an-crowd · section labels without diacritics (fixture); tone blocks neutral; artboards stay thumbnails at 27 % where the board draws colour blocks
- an-vs · stray "Undone · move 1 artboard · Redo" toast (harness residue); Comments panel beside is 05's
- an-dangling · card lacks "by <person>"; arrows are long fixture lines
- an-layers · people chips / counts / section grouping (fixture)
- an-follow · Edit-mode chrome (inspector, Local project) around the frame where the board draws a bare canvas

## Side states
- an-enter/edit-state · Edit before N (quiet stickies) next to the Preview frame · reachable
- an-place/stack · sticky dropped on another stacks 12 px down-right · reachable
- an-place/typing · typing grows to five lines, then wider · reachable (an-place-preview shot)
- an-sticky/stack-menu · Fan out / Bring to front / Send to back menu · reachable
- an-sticky/colours · ten colours, five up front + 5 more (popover) · reachable
- an-sticky/author-hover · author line + cursor colour edge on hover · needs a second person → unreachable
- an-today/size-menu · Small … Huge size menu on the text bar · reachable (shot; menu opens upward and is clipped at the top of the frame)
- an-today/shape-bar · Stroke / Fill, colours, widths, shapes, dashed on a selected shape · reachable (shot)
- an-today/marker-rows · marker + highlighter colour rows · reachable (shot)
- an-visibility/palette · ⌘K "resolved" actions + "6 stickies moved to the trash · Undo" toast · reachable
- an-visibility/edit-quiet · Edit shows faded paper, click selects the design · reachable
- an-visibility/select-all · ⇧⌘A selection with Lock / Wrap / Move to section bar · reachable
- an-arrow-kinds/label · double-click an arrow to write a label on the line · reachable
- an-arrow-kinds/edge-bind · arrow to an artboard's edge lights the whole artboard (proposed) · reachable
- an-marker/hover-tag · "On Post 1:1 — moves with it" on stroke hover · reachable
- an-section/folded · collapsed sections "Nápady na story 6 stickies · 2 people" · reachable
- an-templates/ghost · kanban ghost follows the pointer · reachable
- an-stk-gallery/recent · Recent row after stickers were placed · reachable
- an-stk-search/empty · "No stickers match 'hotovo'" card + English hint chips · reachable
- an-stamps/count-popover · "5 stamps on Směr B" with people · needs a second person → unreachable
- an-crowd/hover-card · "Nápady · 84 stickies · 8 people · Click to zoom to it" · reachable
- an-print/export-sheet · Export sheet with "Include annotations" · reachable (an-print-export shot)
- an-vote/start-sheet · Start a vote sheet · reachable (shot)
- an-layers/filter-footer · "Hidden by the filter: …" footer after choosing a person chip · needs a second author → unreachable in this fixture
