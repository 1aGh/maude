# critic-d — 15 Annotations — V2-8.5 stage D (one critic, four lenses)

_2026-10-24 · pairs: stage D full-size (`.scr/pairs/15-annotations`, worktree agent-a57a21718e6d25731) · checklist: stage B critic-design/copy/a11y/signature + fix-dsedit.md (C12, partial, budget-capped; it states its own stage D re-shoot was not done and lists what is still open) · read-only_

**Verdict: 1 of 31 ids matches (an-vs, both themes); 29 differ; 1 unreachable.** Rounds fixed: dark HUD island (X3), sticker picture (X4), sticky paper/toolbar material, one front five, corner-square handles, Templates now open via S, section title chip. Not fixed (fix-dsedit "Still open", confirmed in the shots): R5 states never drawn (snap ring + tag, elbow re-route, dangling card, time pin, stamp row, ballot clusters, vote result), Layers grouping/lock/footer + docked full-height column, marker popover one-row, AI badge/tick, mono text/shape labels, straight 1 px arrows, sticker toolbar glyphs, keyboard-less placement (a11y A2), resolved-row colour-only (A3), vote bar live region ticking (a11y), section title faded 0.45 (a11y 1.5:1).

Remaining blockers shared by many ids (named once):
- **A2** placing sticky/sticker/stamp/template needs a pointer (`annotations/ui/placement.tsx`) — an-enter, an-place, an-stk-gallery, an-stk-search, an-stk-drop, an-stamps, an-plan, an-arrow-bind, an-templates.
- **R5** proposed states built but never drawn in a real run.
- **R2** mono face for free text / shape label / kanban column labels (`annotations/ui/text-style.ts:14`) — an-today, an-plan, an-ai-write; section chip still faded in Edit (an-section).
- **Arrows** straight 1 px, no curve/filled head, no re-route (`arrow.model.ts:75`, `rest-route.ts`).
- **Dock**: no key letters under glyphs (H N C M A R T E S) in the Preview dock (`tool-palette.tsx`).

| id | theme | verdict | remaining blockers |
| --- | --- | --- | --- |
| an-enter | L+D | differs | no key letters under dock glyphs; A2 (placing needs click); colour row/dock now match, dark island fixed |
| an-place | L+D | differs | captured in Edit (spec Preview, full strength); sticky still AI paper 1 px edge, arrows thin; A2 |
| an-sticky | L+D | differs | selection still bbox + handles around the artboard (spec: 2 px accent outline on the sticky); toolbar has trash, no duplicate; size select bare; author line absent |
| an-today | L+D | differs | shape label + text in mono, tiny; shape fill/stroke `#e0ebfd/#3b82f6`; text-size menu, link/media cards, group bar not drawn |
| an-arrow-bind | L+D | differs | no snap ring or "Button · See the work" tag; straight thin arrow; ink row lacks amber; A2 |
| an-follow | L+D | differs | arrows stay straight and cross Tablet, no elbow route around; magenta mono position bubble |
| an-arrow-kinds | L+D | differs | toolbar order (inks first, spec: seg · head · inks · lock), straight default, grey active segment, heads menu not opened |
| an-marker | L+D | differs | popover is a 3-row card (spec one-row pill: segment · inks · +4 · 3 width dots), 2 widths; stroke and "On Post 1:1" outline not in frame |
| an-section | L+D | differs | title chip faded (1.5:1, a11y blocker), "Tereza's feedback 2" numbering, section body ~transparent, no Fold/Ask AI, no folded rows |
| an-templates | L+D | differs (near) | now opens via S and tiles/copy match; remaining: close × (spec none), no pointer-following kanban ghost, panel placement, A2 |
| an-plan | L+D | differs | column labels faint mono, no colour tint/fill, blank cards, no stamps/legend, placed over Tablet, arrows to artboards absent |
| an-stk-gallery | L+D | differs | header + × close (spec none), E not pressed in dock (Hand pressed), tiles/stamps larger, pack heading one weight, anchored right of centre, A2 |
| an-stk-search | L+D | differs | larger result cells with no bg tile, none selected (first `data-on`), captions show matched word wrong, empty state not shown, A2 |
| an-stk-drop | L+D | differs | picture now renders; selection still 8 handles + dots (spec 4 corners); toolbar text buttons (spec icons); lands mid-view; A2 |
| an-stamps | L+D | differs | stamp row, ballot clusters, count popover not drawn; vote bar "0 done" (no "of N"); vote bar live region ticks; Edit not Preview |
| an-vote | L+D | differs | spec = running vote + result section; impl = Start sheet only; result section and "yours" pills not reached; sheet see-through |
| an-vs | L+D | match | doc-style specimen; impl = Comments panel beside the layer (owned by 10/05); leftover "Undo: move 1 artboard" toast is a copy warning only, fixture-driven |
| an-convert | L+D | differs | Turn into a comment is behind "…" now but the menu/converted thread "From Jonas's sticky … Undo" not shown; selection bbox |
| an-ai-read | L+D | differs (cannot confirm) | AI signed out: no "3 stickies" scope chip, answer card, ai-seen outline; frame selected the artboard |
| an-ai-apply | L+D | differs | resolved tick 18 px spark not 22 px success disc; no "Made by AI" tag/summary; leftover toast; layers resolved colour-only |
| an-ai-stickers | L+D | differs | picture renders now but no DONE!/FLAGGED art or spark; AI badge 18 px top-right (spec 20 px bottom-right) |
| an-ai-write | L+D | differs | notes as tiny mono text not paper; no spark edge/"AI" chip; straight thin arrows |
| an-layers | L+D | differs | flat list, no section grouping/lock row/"Hidden by the filter" footer; docked full-height column not island; empty paper swatch; resolved colour-only (A3) |
| an-visibility | L+D | differs | ⇧P hidden state + toast not shown, stickies visible; ⌘K "resolved" commands not shown; v1 toast |
| an-rebind | L+D | differs (cannot confirm) | needs AI rewrite of bound button; "Pointed at the old … replaced by AI" card not drawn |
| an-dangling | L+D | differs | no dashed end, no dashed outline of the trashed target, no "Point to…" card |
| an-crowd | L+D | differs | 37 % zoom, 200 cream stickies as notes, no LOD colour blocks/section counts/hover card; Layers shows tag names |
| an-video | L+D | differs | no "0:12" time pin chip, no timeline marks |
| an-print | L+D | differs | "Not printed" is a white pill outside above (spec dark pill inside), note at full strength, no bleed/crop marks, Export sheet "Include annotations" not in the shot |
| an-viewer | L+D | unreachable | needs a share-grant viewer session (Hand + Comment dock, "Stickies need Can edit · Ask to edit"); a local stub role (dev flag forcing `role=viewer` in the session) would make it shootable |
| an-figjam | L+D | differs (cannot confirm) | only the import sheet shot; arrival state (section "From FigJam", toast "46 items … Undo") needs a Figma-connection stub |

```json
{"canvas":"15 Annotations","dir":"15-annotations","match":["an-vs"],"match_one_theme":{},"differs":["an-enter","an-place","an-sticky","an-today","an-arrow-bind","an-follow","an-arrow-kinds","an-marker","an-section","an-templates","an-plan","an-stk-gallery","an-stk-search","an-stk-drop","an-stamps","an-vote","an-convert","an-ai-read","an-ai-apply","an-ai-stickers","an-ai-write","an-layers","an-visibility","an-rebind","an-dangling","an-crowd","an-video","an-print","an-figjam"],"unreachable":["an-viewer"]}
```
