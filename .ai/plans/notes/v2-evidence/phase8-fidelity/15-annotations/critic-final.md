# critic-final — 15 Annotations — V2-8.5 stage D2 (one critic, four lenses)

_2026-10-24 · pairs: FINAL (D2, d3881fe41) full-size `.scr/pairs/15-annotations` (worktree agent-ae0b93df010d6d2f4) · checklist: stage B reports, fix-c4-annot.md, critic-d.md · read-only_

**Verdict: 1 of 31 ids matches (an-vs, both themes); 29 differ; 1 unreachable (an-viewer).** Round 4 closed: keyboard placement (A2), AI arrows curved, resolved tick in Layers, section title full ink, gallery/templates without ×, Not-printed inside pill, Layers without page root. Every R5 state in fix-c4-annot "Open" is still absent in the shots (snap ring + tag, elbow re-route, dangling card, 0:12 pin, stamp row/ballots/count popover, vote running + result, AI read/apply cards, ⇧P hidden + ⌘K resolved, LOD blocks, FigJam arrival). Spec boards that are close-ups/mock windows are compared against the whole app: the specified state must be visible in it.

| id | theme | verdict | remaining blockers |
| --- | --- | --- | --- |
| an-enter | L+D | differs | Preview dock + colour row now match the board's close-up; no after-N sticky ghost in hand / no Edit->Preview pair; key letters under dock glyphs (board close-up) absent by decision, but impl is the bare window not the specified two-state pair (cannot confirm "sticky in hand") |
| an-place | L+D | differs | Edit mode not Preview; stickies AI paper+coral outline, not coloured paper; stack/typing-grows states not drawn; arrows thin |
| an-sticky | L+D | differs | selection = bbox+handles around the artboard (spec 2 px accent outline on sticky); toolbar has trash, no duplicate; size select bare; no author line; no grows/tilt/stack states |
| an-today | L+D | differs | text/shape/link/media/group/dashed states not drawn; shape fill/stroke blue default |
| an-arrow-bind | L+D | differs | no snap ring, no "Button · See the work" tag (R5) |
| an-follow | L+D | differs | no elbow re-route around Tablet; position bubble not as spec |
| an-arrow-kinds | L+D | differs | toolbar order/active segment, heads menu not opened, arrow-in-fixture is a thin straight stub |
| an-marker | L+D | differs | popover still 3-row card (spec one-row pill: segment, inks, +4, 3 width dots, 2 widths); zoomed 73% on wrong artboard; no stroke / "On Post 1:1 — moves with it" |
| an-section | L+D | differs | title chip not solid object-colour chip with count; no Fold / Ask AI toolbar; no folded rows; section body near-transparent; Edit not Preview |
| an-templates | L+D | differs (near) | panel/tiles/copy match; no pointer-following kanban ghost on the canvas; prompt field empty with spark button (spec filled + send); zoom 73% on wrong artboard |
| an-plan | L+D | differs | kanban columns faint/no tint, no chips colour, blank cards, no stamps/legend, arrows to artboards absent, placed over Tablet |
| an-stk-gallery | L+D | differs | no Recent row, pack order differs (spec Stamps, Recent, Project status first), no "E" key chip / "Proposed", E not pressed in dock (Hand pressed), search focused ring, tile sizes |
| an-stk-search | L+D | differs | result cells larger with no tile bg, none selected (spec first selected), captions "done" repeated, chip "complete" vs spec "approved", empty-state ("hotovo") card absent |
| an-stk-drop | L+D | differs | edge connection dots beside 4 corners; toolbar text "Duplicate" (spec icons + more); lands beside Tablet, not on Post |
| an-stamps | L+D | differs | stamp row, ballot clusters, 5-stamps popover not drawn; shot is the Start-vote sheet |
| an-vote | L+D | differs | running vote bar + result section not reached; sheet is see-through over the inspector |
| an-vs | L+D | match | doc-style specimen; impl shows Comments beside the layer (owned by 10/05); "Undo: move 1 artboard" toast is fixture residue |
| an-convert | L+D | differs | context menu with "Turn into a comment" and converted thread card not drawn; selection bbox |
| an-ai-read | L+D | differs (cannot confirm) | AI signed out: no scope chip, answer card, ai-seen outline |
| an-ai-apply | L+D | differs | resolved tick not 22 px success disc; no "Made by AI" tag/summary |
| an-ai-stickers | L+D | differs | no DONE!/FLAGGED art or spark; AI badge size/corner |
| an-ai-write | L+D | differs | notes not as paper with spark edge/"AI" chip; arrows thin |
| an-layers | L+D | differs | flat list, no section grouping, lock row, "Hidden by the filter" footer; Everyone only (no person chips); docked full-height column not hug-height island; page root row fixed |
| an-visibility | L+D | differs | ⇧P hidden state + toast and ⌘K "resolved" actions not shown; Edit with inspector instead |
| an-rebind | L+D | differs (cannot confirm) | needs AI rewrite of bound button; "pointed at the old…" card not drawn |
| an-dangling | L+D | differs | no dashed end, dashed outline of trashed target, "Point to…" card |
| an-crowd | L+D | differs | 37 % zoom, notes not LOD colour blocks, no section counts / hover card |
| an-video | L+D | differs | no "0:12" time pin, no timeline with marks; note covers the clip full strength |
| an-print | L+D | differs | note at full strength (spec faded), "Not printed" pill not visible in the shot, no bleed/crop marks, Export sheet not in the shot |
| an-viewer | L+D | unreachable | share-grant viewer session (Hand + Comment dock, "Stickies need Can edit"); a dev flag forcing role=viewer would make it shootable |
| an-figjam | L+D | differs (cannot confirm) | arrival state (section "From FigJam", toast "46 items … Undo") needs a Figma-connection stub |

```json
{"canvas":"15 Annotations","dir":"15-annotations","match":["an-vs"],"match_one_theme":{},"differs":["an-enter","an-place","an-sticky","an-today","an-arrow-bind","an-follow","an-arrow-kinds","an-marker","an-section","an-templates","an-plan","an-stk-gallery","an-stk-search","an-stk-drop","an-stamps","an-vote","an-convert","an-ai-read","an-ai-apply","an-ai-stickers","an-ai-write","an-layers","an-visibility","an-rebind","an-dangling","an-crowd","an-video","an-print","an-figjam"],"unreachable":["an-viewer"]}
```
