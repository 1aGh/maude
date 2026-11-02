# critic-bar2 — 15 Annotations — re-evaluated against the "verified" bar (v2-michal-verified-bar)

_Inputs: critic-final.md (D2), committed pairs (light + dark spot-checked), fix-c4-annot.md, board `.design/ui/v2/15 Annotations.tsx`. No new shots._
Many boards here are doc-style specimens (illustrations) — the check is the live state each one names, not the mini windows.

**Verified (both themes): an-enter · an-vs · an-layers. Differs: 22. Unreachable: 6 (AI run / Figma connection / viewer role).**

## Per id
- an-enter · verified · none (key letters under dock glyphs: lead decision, board `keys` is a close-up prop; ghost-in-hand needs a pointer, none in shot — polish)
- an-place · differs · Edit not Preview (Preview dock + sticky tool absent); arrows thin/straight; typing-grows + stack states not drawn
- an-sticky · differs · selection = artboard bbox + handles instead of 2 px outline on the sticky; toolbar order/controls (trash, no duplicate, bare size select); no author line
- an-today · differs · text / shape / link / media / group / dashed-line states not drawn; shape fill/stroke is a blue default, not DS token
- an-arrow-bind · differs · no snap ring, no "Button · See the work" tag, arrow thin
- an-follow · differs · no elbow re-route around Tablet; position bubble not as spec
- an-arrow-kinds · differs · toolbar order + active segment, heads menu not opened, arrow stub thin straight
- an-marker · differs · popover is a 3-row card, board is a one-row pill (segment · inks · +4 · 3 width dots); no stroke/"moves with it" tag
- an-section · differs · title chip not solid object-colour chip with count; no Fold / Ask AI; body near transparent; Edit not Preview
- an-templates · differs · kanban ghost following the pointer not drawn; prompt field not in typed/send state is FIXTURE, panel/tiles/copy match
- an-plan · differs · kanban columns untinted, blank cards, no stamps/legend, arrows to artboards absent
- an-stk-gallery · differs · dock does not press E (Hand pressed); pack order (Stamps, Recent, Project status first); "Proposed" chip
- an-stk-search · differs · no result selected (first `data-on`); result cells lack tile bg; chips/captions differ from board; empty state not shown
- an-stk-drop · differs · connection dots beside the 4 corner handles; toolbar text "Duplicate" instead of icons + more
- an-stamps · differs · stamp row, ballot clusters, count popover not drawn; shot is the Start-vote sheet
- an-vote · differs · running vote bar + result section not drawn; sheet see-through over the inspector
- an-vs · verified · none (Comments panel beside is 10/05's; "Undo" toast is fixture residue)
- an-convert · differs · "Turn into a comment" menu + converted thread card not drawn
- an-ai-read · unreachable · AI signed out (answer card, scope chip, ai-seen outline)
- an-ai-apply · unreachable · needs an AI run ("Made by AI" tag, summary, 22 px resolved disc)
- an-ai-stickers · unreachable · needs an AI run (DONE!/FLAGGED stickers, spark)
- an-ai-write · differs · AI notes not as paper with spark edge + "AI" chip; arrows thin
- an-layers · verified · none (flat list = no sections in the fixture; person chips/lock row/filter footer = fixture; docked column vs island = owned by 11)
- an-visibility · differs · ⇧P hidden state + toast not drawn; Edit shot has the inspector, no annotations menu tick
- an-rebind · unreachable · needs AI rewrite of a bound button
- an-dangling · differs · no dashed end, no dashed outline of trashed target, no "Point to…" card
- an-crowd · differs · notes not LOD colour blocks, no section counts / hover card
- an-video · differs · no "0:12" time pin, no timeline with marks
- an-print · differs · "Not printed" pill not visible; note at full strength (board faded)
- an-viewer · unreachable · share-grant viewer session (Hand + Comment dock, "Stickies need Can edit")
- an-figjam · unreachable · arrival state needs a Figma connection

## Polish list
- an-enter · key letters under dock glyphs (lead decision: board `keys` prop is close-up only); ghost sticky follows pointer (not in a pointer-less shot)
- an-vs · "Undo: move 1 artboard" toast left over from the fixture
- an-layers · docked full-height column instead of hug-height island (11 owns the left panel); "6" vs "13" annotation count; rows flat (no section in fixture)
- an-templates · kanban prompt field empty with spark button (board: typed + send); zoom 73 %, panel sits over Tablet
- an-stk-gallery · tile sizes, search focus ring, anchoring right of centre; no Recent row (fixture: nothing placed yet)
- an-stk-search · chip "complete" vs "approved" (pack data)
- an-place · sticky paper colours / authors / tilt / numbered badges (AI-seeded fixture)
- an-sticky · 5-size select label, author line (fixture)
- an-print · export sheet placement; bleed/crop marks if drawn only on the sheet

## Side states
- an-stk-search/empty · "No stickers match 'hotovo'" card + English hint chips · reachable (type a word with no match)
- an-visibility/palette · ⌘K "resolved" actions + "6 stickies moved to the trash · Undo" toast · reachable
- an-print/export-sheet · Export sheet with "Include annotations" off · reachable
- an-enter/edit-state · Edit before N (quiet stickies) next to the Preview frame · reachable
- an-templates/ghost · kanban ghost follows the pointer · reachable (pointer on canvas)
- an-sticky/stack-menu · Fan out / Bring to front / Send to back menu · reachable
- an-marker/hover-tag · "On Post 1:1 — moves with it" tag on hover · reachable
- an-vote/result · result section after the vote · needs a second person → unreachable
