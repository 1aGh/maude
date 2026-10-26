# Phase 8 fidelity — 15 Annotations (stage A evidence)

Branch p8-fid-g5 from feat/maude-v2 6d780ab1b. SPEC = the board artboard rendered 1:1 from a scratch copy of `.design/ui/v2/15 Annotations.tsx` through the capture origin (app theme light / dark; the designs inside an artboard stay theme-pinned, as designed). IMPL = the release-built v2 app (Playwright Chromium 1440×900 with a `window.__TAURI__` stub, throwaway HOME/XDG, `claude` stubbed signed-out, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`) driven into the artboard's state; theme set through prefs.json `theme`. Pairs: spec left, impl right, label strip `<id> · <theme>`; the artboard is padded (grey) to the taller side so nothing is rescaled in the full-size copy.

Full-size pairs: see `full-size-path.txt`. Committed copies here are JPEG q55, max 1100 px wide (an artboard larger than 1440 px wide is therefore small — read the full-size one).

**31 artboards · 62 pairs (31 × light + dark where drawn) · impl reachable: 7 yes, 20 partially, 4 no.**

Reading the impl side: most artboards are a 1440×900 window plus an 80 px note strip (the spec is 1440×980 — the grey band under the impl is that strip, not a defect). Close-up artboards (a sheet, a menu, several panes side by side) depict a region; the impl is the whole window with that region on it — the "how reached" column says where to look.

## Method notes for this canvas

- Stickies, shapes, arrows, sections, stickers and the kanban were **seeded through the real AI write verb** (`maude design annotate --ops/--board`, geometry from `__maudeCanvasRects` via `--rects`), then the app was driven in Edit/Preview with the keyboard (N, E, M, S, ⇧P, ⇧⌘M). Seeded notes are therefore AI-authored (cream paper with a coral outline) — the spec's coloured, person-authored stickies (Tereza, Jonas) cannot exist locally (no collaborators), so colours, author lines and presence cursors never match.
- **Finding: placed stickers render as a broken image** (`an-stk-drop`, `an-stamps`, `an-ai-stickers`): the 160 × 160 box, toolbar and selection are right, the picture is a broken-image icon.
- **Not reachable here:** AI-driven (`an-ai-read`, `an-rebind`), viewer session (`an-viewer`); `an-templates` (S arms Section, no templates popover); Figma/FigJam import needs a connection.
- **Dark.** Dark pairs not inspected one by one (the board draws the chrome in the app theme; the stickies/artboards keep their own colours). Spot-check before stage B: sticker/colour contrast on the quiet Edit layer in dark.


| id | theme | state (as the board draws it) | how reached | impl reachable? | first-glance differences |
| --- | --- | --- | --- | --- | --- |
| `an-enter` | light | N in Edit: Preview opens with Sticky in hand; colour row above the toolbar; tool letters under icons | click empty canvas, press N | yes | Preview opens with the sticky tool armed, a colour row (5 + "+5") above the toolbar and a "Previewing Homepage · esc to edit" pill. Toolbar icons have no letter captions under them (spec: H N C M A R T E S). The two before/after mini-windows and key table are explanatory specimen content. |
| `an-enter` | dark | N in Edit: Preview opens with Sticky in hand; colour row above the toolbar; tool letters under icons | click empty canvas, press N | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-place` | light | Stickies on and between artboards; quiet in Edit | seeded stickies (`maude design annotate`), Edit mode | yes | Stickies sit on the artboard and between artboards, quiet. Impl stickies are cream paper with a thin coral outline (AI-authored via the verb); spec stickies are saturated yellow/blue/pink/green paper, tilted, with numbered 1-4 badges and author lines ("Tereza · 2 h ago"). The Preview toolbar of the spec is not shown in the Edit frame. |
| `an-place` | dark | Stickies on and between artboards; quiet in Edit | seeded stickies (`maude design annotate`), Edit mode | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-sticky` | light | A sticky up close — grows with words, tilt, stack, ten colours, author line, selected toolbar | click a sticky | partially — selected toolbar reached; the six close-ups are specimen illustrations | Impl selected sticky shows a floating toolbar: colour dots (+5), size (Medium), list, Resolve, Turn into a comment, lock, trash. Spec toolbar order is colours, size, list, lock, more … and "Turn into a comment" lives in the sticky menu. Author line under the sticky not shown. |
| `an-sticky` | dark | A sticky up close — grows with words, tilt, stack, ten colours, author line, selected toolbar | click a sticky | partially — selected toolbar reached; the six close-ups are specimen illustrations | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-today` | light | Everything the annotation layer already does — Text, Shape, pictures/links, video/sound, group/align, lists, colours, keys | seeded shape, text, arrow, sticky | partially — elements exist; the board is a specimen sheet | Impl shows a sticky selected with toolbar, a blue rounded shape ("Hero v2") and an arrow with a text note below the artboard. The text-size menu, link/picture cards, media cards and group bar are not drawn here. |
| `an-today` | dark | Everything the annotation layer already does — Text, Shape, pictures/links, video/sound, group/align, lists, colours, keys | seeded shape, text, arrow, sticky | partially — elements exist; the board is a specimen sheet | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-arrow-bind` | light | An arrow to the button, not the artboard — end snaps to the element, ring + chip "Button · See the work" | select an arrow bound to an element | partially — arrow toolbar and bound end dots; ring and chip not visible | Impl arrow selection shows its toolbar (colours, Straight/Curved/Elbow, heads, label, lock, trash) and end handles on the headline; the azure ring on the target button and the "Button · See the work" chip are not drawn. Spec arrow is a smooth curve from a sticky to the button; impl lines are thin straight lines. |
| `an-arrow-bind` | dark | An arrow to the button, not the artboard — end snaps to the element, ring + chip "Button · See the work" | select an arrow bound to an element | partially — arrow toolbar and bound end dots; ring and chip not visible | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-follow` | light | Move the artboard — the arrow goes around Mobile, never through; the sticky rides on the artboard | Edit: drag the Desktop artboard by its name | partially — drag works with a position pill; arrow routing is not drawn | Impl shows the dragged artboard with "X 295 · Y 200" and the stickies/arrows staying attached with thin straight lines that cross the Tablet artboard. Spec draws the elbow route around Mobile with timing notes (0/120/160 ms) and a list of rules (bound ends follow, around-never-through, locked sticky rides). No route-avoidance visible. |
| `an-follow` | dark | Move the artboard — the arrow goes around Mobile, never through; the sticky rides on the artboard | Edit: drag the Desktop artboard by its name | partially — drag works with a position pill; arrow routing is not drawn | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-arrow-kinds` | light | Edges, elbows, curves and labels; ends and heads menu | arrow selected: line menu | yes | Same toolbar as above (Straight · Curved · Elbow, heads, label, swap, lock). Spec specimen cards (edge-binding, label-on-line, heads list) are not reproducible as a frame. |
| `an-arrow-kinds` | dark | Edges, elbows, curves and labels; ends and heads menu | arrow selected: line menu | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-marker` | light | Circle it, highlight it, rub it out — Marker/Highlighter/Eraser popover with ink colours | press M, drag a stroke around the headline | partially — the marker popover shows; the drawn stroke is not visible in the frame | Popover has Marker · Highlighter · Eraser, nine colours (+4) and a width row, like the spec. The stroke drawn around the headline is not visible in the frame (view is zoomed to the Tablet). |
| `an-marker` | dark | Circle it, highlight it, rub it out — Marker/Highlighter/Eraser popover with ink colours | press M, drag a stroke around the headline | partially — the marker popover shows; the drawn stroke is not visible in the frame | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-section` | light | A section is a named place — "Zpětná vazba Tereza" wrapping stickies; Fold/Ask AI toolbar | wrap-section around two stickies | partially — section exists, label faint (Edit is quiet) | Impl section "Tereza's feedback" is a pale frame around two stickies with a very faint title; no section toolbar (Fold · Ask AI about it) since not selected. Collapsed sections ("Nápady na story · 6 stickies · 2 people") not shown. |
| `an-section` | dark | A section is a named place — "Zpětná vazba Tereza" wrapping stickies; Fold/Ask AI toolbar | wrap-section around two stickies | partially — section exists, label faint (Edit is quiet) | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-templates` | light | Templates open above the toolbar: Kanban, Retro, Flowchart, Content calendar, Roadmap, Brainstorm, Checklist, Blank; prompt field | press S | no — S only arms the Section tool; no templates popover appeared | No template cards, no prompt field in the frame. (⌘K "templates" and the verb `annotate --board <template>` do generate them — see `an-plan`.) |
| `an-templates` | dark | Templates open above the toolbar: Kanban, Retro, Flowchart, Content calendar, Roadmap, Brainstorm, Checklist, Blank; prompt field | press S | no — S only arms the Section tool; no templates popover appeared | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-plan` | light | The plan sits next to the work — kanban, colour-coded cards, stamps, arrows to artboards | `annotate --board kanban` next to Desktop | partially — kanban columns generated by the verb; no colour-coding, stamps or arrows | Impl shows three columns (labels "Ideas / Doing 1 / Done 1" at small size) with empty cream cards near the Tablet artboard; the spec has filled cards in a language-matched kanban with channel colours, stamp counts and arrows to the artboards they became. |
| `an-plan` | dark | The plan sits next to the work — kanban, colour-coded cards, stamps, arrows to artboards | `annotate --board kanban` next to Desktop | partially — kanban columns generated by the verb; no colour-coding, stamps or arrows | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-stk-gallery` | light | E opens the Stickers gallery: Stamps row, Recent, packs (Project status 80, FigJam Doodle 24, Life Style 15, Opposing Thoughts 20), credits | press E in Preview | yes | Very close: header "Stickers · E", search, Stamps (vote · one each), four packs with "+N" tiles, credits line with links. Differences: no "Recent" row (nothing placed yet), no "Proposed: stamps" chip, gallery is anchored right-of-centre and covers the Tablet. |
| `an-stk-gallery` | dark | E opens the Stickers gallery: Stamps row, Recent, packs (Project status 80, FigJam Doodle 24, Life Style 15, Opposing Thoughts 20), credits | press E in Preview | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-stk-search` | light | Search "done" across every pack — chips (All 6, done 4, almost-done 2…), six results, empty state | type in the gallery search | yes | Matches: chips and six results with captions; the "No "done" in FigJam Doodle…" note is there. Result tiles are larger in impl. Empty-state card (search "hotovo") not shown. |
| `an-stk-search` | dark | Search "done" across every pack — chips (All 6, done 4, almost-done 2…), six results, empty state | type in the gallery search | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-stk-drop` | light | A Project status sticker dropped on the post at 160 px; toolbar Replace… · Flip · Duplicate | click a result, click the canvas | partially — placement works with the right toolbar; the picture renders broken | Impl shows the sticker selected at "160 × 160" with the toolbar (Replace…, Flip, Duplicate, trash) — but the image itself is a broken-image icon, not the sticker art. Same broken picture appears for `an-ai-stickers`. Worth a stage-C check (sticker asset URL on the canvas origin). |
| `an-stk-drop` | dark | A Project status sticker dropped on the post at 160 px; toolbar Replace… · Flip · Duplicate | click a result, click the canvas | partially — placement works with the right toolbar; the picture renders broken | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-stamps` | light | Faster than a sticky — six stamps, count popover, vote tallies per artboard | start a vote, then stamp | partially — the vote bar and the "+" add-vote mark show; the stamp row/popover does not | Impl: "Vote · 1 artboard · 3 left of your 3 · 1:59 · 0 done · End vote" bar and a "+" at the artboard corner. The stamp faces row and the "5 stamps on Směr B" popover are not reached; also a broken-image icon (the earlier sticker) is on the canvas. |
| `an-stamps` | dark | Faster than a sticky — six stamps, count popover, vote tallies per artboard | start a vote, then stamp | partially — the vote bar and the "+" add-vote mark show; the stamp row/popover does not | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-vote` | light | Start a vote — three directions, three votes each; running bar "4 of 5 done"; result section | artboard menu › Start a vote… | partially — the Start-a-vote sheet; running state is in `an-stamps` | Impl sheet: Artboards (checkboxes), Title (optional), Votes each 3, Time 2 min, note "Anyone who can open this project's files can see the votes", Cancel / Start vote. Spec shows the running state (bar with people done 4 of 5) and the result section ("Hlasování — Helmy · 1 Oct"). Sheet is a modal over the whole window with a scrim; in light the page behind is greyed. |
| `an-vote` | dark | Start a vote — three directions, three votes each; running bar "4 of 5 done"; result section | artboard menu › Start a vote… | partially — the Start-a-vote sheet; running state is in `an-stamps` | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-vs` | light | People talk, people draw — Comment vs Annotation comparison table | ⇧⌘M (Comments panel) | partially — the Comments panel opens; the comparison sheet is a doc-style specimen | Impl Comments panel: tabs Open/Mine/Resolved/All, empty state "No comments on Homepage yet. Press C then click anywhere on the canvas to leave one · Share for feedback". Stickies stay visible next to it (layers do not mix) — consistent with the spec's claim. |
| `an-vs` | dark | People talk, people draw — Comment vs Annotation comparison table | ⇧⌘M (Comments panel) | partially — the Comments panel opens; the comparison sheet is a doc-style specimen | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-convert` | light | A sticky becomes a comment — menu item, thread signed by the author, sticky goes to the trash | select a sticky, hover Turn into a comment | partially — the action is on the sticky toolbar; the resulting thread is not shown | Impl exposes "Turn into a comment" as a toolbar button. Spec shows it as the first row of the sticky's context menu and the converted thread with "From Jonas's sticky · turned into a comment · Undo". |
| `an-convert` | dark | A sticky becomes a comment — menu item, thread signed by the author, sticky goes to the trash | select a sticky, hover Turn into a comment | partially — the action is on the sticky toolbar; the resulting thread is not shown | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-ai-read` | light | AI reads three stickies: scope chip "3 stickies", one-line answer + one button | select two stickies, Ask AI | no — AI signed out | Two stickies selected with the sticky toolbar; no "Ask AI" chip/answer (the AI panel is closed / shows Connect). |
| `an-ai-read` | dark | AI reads three stickies: scope chip "3 stickies", one-line answer + one button | select two stickies, Ask AI | no — AI signed out | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-ai-apply` | light | AI makes the change in Edit — stickies resolved, ticked, struck through; "Made by AI" tag | resolve a sticky as AI (verb), Edit mode | partially — resolved state exists; no AI run, no tag, no summary card | Impl shows the resolved sticky quiet on the artboard and an "Undo: move 1 artboard" toast from the earlier undo; no "Made by AI" tag, no "Make these changes / Done — …" card. |
| `an-ai-apply` | dark | AI makes the change in Edit — stickies resolved, ticked, struck through; "Made by AI" tag | resolve a sticky as AI (verb), Edit mode | partially — resolved state exists; no AI run, no tag, no summary card | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-ai-stickers` | light | Status you can read from across the room — DONE! / Flagged stickers with a spark | annotate sticker project-status/… --to the button + resolve | partially — sticker placed by the verb; it renders as a broken image; no spark badge | Impl shows a sticker-sized broken-image tile near the Tablet and the arrow; the spec draws DONE! and FLAGGED stickers with coral spark dots and an "AI" chip. |
| `an-ai-stickers` | dark | Status you can read from across the room — DONE! / Flagged stickers with a spark | annotate sticker project-status/… --to the button + resolve | partially — sticker placed by the verb; it renders as a broken image; no spark badge | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-ai-write` | light | AI writes a review as notes with arrows (spark edge on each note) | annotate notes + connect arrows | partially — notes and arrows exist; the AI spark edge is not visible | Impl notes are small text boxes with thin arrows to the headline/sub; spec notes are red-edged cards with a spark and an "AI" chip, with curved arrows. |
| `an-ai-write` | dark | AI writes a review as notes with arrows (spark edge on each note) | annotate notes + connect arrows | partially — notes and arrows exist; the AI spark edge is not visible | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-layers` | light | Layers in Preview: annotation layer by section, person filter chips, lock | Preview › Layers tab | yes | Impl Layers tab lists Annotations with an Everyone / You / + AI chip row and the sticky rows plus "Arrow to …" rows. Missing vs spec: grouping under a section ("Zpětná vazba Tereza · 4"), per-person chips for other people (none locally), lock indicator row and "Hidden by the filter…" footer. |
| `an-layers` | dark | Layers in Preview: annotation layer by section, person filter chips, lock | Preview › Layers tab | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-visibility` | light | See it, quiet it, hide it, select it, clear it — Preview/Edit/⇧P/⇧⌘A states and ⌘K "resolved" command | ⇧P in Edit | partially — ⇧P frame still shows the stickies; the other states are explainer panels | In the impl frame the stickies remain visible (quiet) after ⇧P — hide not confirmed in this run (⇧P may have toggled back). The ⌘K "resolved" commands are not shown. |
| `an-visibility` | dark | See it, quiet it, hide it, select it, clear it — Preview/Edit/⇧P/⇧⌘A states and ⌘K "resolved" command | ⇧P in Edit | partially — ⇧P frame still shows the stickies; the other states are explainer panels | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-rebind` | light | AI rewrites the button the arrow points at — arrow follows, or says what it pointed at | — | no — needs an AI rewrite of the canvas source | Arrows are bound to elements (see `an-ai-write`) but the "Pointed at the old … replaced by AI" state needs an AI edit. |
| `an-rebind` | dark | AI rewrites the button the arrow points at — arrow follows, or says what it pointed at | — | no — needs an AI rewrite of the canvas source | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-dangling` | light | The button it pointed at is in the trash — dashed arrow end + card "Point to…" | delete the button from the canvas source | partially — dangling ends show as dots; no dashed styling or card | Impl arrow ends remain as small rings near the old place; no dashed arrow, no "Pointed at … — moved to the trash" card with the Point to… button. |
| `an-dangling` | dark | The button it pointed at is in the trash — dashed arrow end + card "Point to…" | delete the button from the canvas source | partially — dangling ends show as dots; no dashed styling or card | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-crowd` | light | 200 stickies, zoomed out — colour blocks + section counts, hover card | seed 200 stickies, fit | partially — 200 stickies render; the LOD colour-block mode is not reached at this zoom | Impl shows a grid of tiny cream stickies below the artboard at ~37 % zoom (LOD starts below 25 %); no colour blocks, no counts, no "Nápady · 84 stickies" hover card. |
| `an-crowd` | dark | 200 stickies, zoomed out — colour blocks + section counts, hover card | seed 200 stickies, fit | partially — 200 stickies render; the LOD colour-block mode is not reached at this zoom | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-video` | light | A sticky on a video, pinned to 0:12 — timeline marks | sticky over the Video artboard | partially — sticky over a video clip; no time pin or timeline | Impl: clip artboard (dark frame, no footage) with the sticky over it; no "0:12" pin chip, no timeline with sticky marks (timeline needs the artboard selected). |
| `an-video` | dark | A sticky on a video, pinned to 0:12 — timeline marks | sticky over the Video artboard | partially — sticky over a video clip; no time pin or timeline | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-print` | light | Print artboards — notes stay outside, "Not printed"; Export leaves annotations out | sticky over a print artboard; Export sheet | yes | Impl shows the "Not printed" tag on a sticky over the print artboard, as the spec does. Spec stickies are faded outside the artboard; impl sticky is full strength. Export sheet (frame `an-print-export`) has an Include annotations option — see its frame, not paired. |
| `an-print` | dark | Print artboards — notes stay outside, "Not printed"; Export leaves annotations out | sticky over a print artboard; Export sheet | yes | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-viewer` | light | Can comment — Hand and Comment only; "Stickies need Can edit · Ask to edit" | — | no — needs a share-grant session as a viewer | No local way to open as a viewer. |
| `an-viewer` | dark | Can comment — Hand and Comment only; "Stickies need Can edit · Ask to edit" | — | no — needs a share-grant session as a viewer | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |
| `an-figjam` | light | A FigJam board arrives as annotations — section "From FigJam", toast with Undo | ⌘K › Import from Figma… | partially — import sheet reached; import needs a Figma connection | Impl sheet: Figma link field, "Figma isn't connected yet. Connect…", "A board from FigJam works too — it comes in as annotations", Cancel / Import. No imported board. |
| `an-figjam` | dark | A FigJam board arrives as annotations — section "From FigJam", toast with Undo | ⌘K › Import from Figma… | partially — import sheet reached; import needs a Figma connection | As the light row. No dark-only difference noticed (dark pairs not all inspected one by one — see the note above). |

## After (stage D, 6d19daa9a) — IMPL re-shot on the stage-C-round-2 tip

Re-shot 60 of 62 pairs; 2 unreachable. SPEC side: `.design/ui/v2/15 Annotations.*` is unchanged since the stage-A shot, so the stage-A spec PNGs are reused. The committed JPEG pairs in this folder are overwritten with the stage-D pairs (same format and size as stage A); the stage-A IMPL frames are in the first section of this file (their pairs are in git history, commit 902d112ac).

- Shot with the stage-A harness (scenarios s15 groups a-f on the Studio site fixture, group f on the print fixture), same fixtures and driving as stage A, on the stage-C-round-2 tip. Harness fix only: the What’s-new toast dismiss (its first button is now "See all (3)" and opened the panel) — no product code changed.
- `an-figjam` is now shot in both themes (stage A had light only): ⌘K › Import from Figma… opens the import dialog, which says Figma is not connected — the connected state needs Figma sign-in and stays unreachable.
- `an-viewer` stays unreachable: the viewer role needs a share-grant session, none in a local lane.

| id | theme | after (stage D) | spec |
| --- | --- | --- | --- |
| `an-ai-apply` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-ai-apply` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-ai-read` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-ai-read` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-ai-stickers` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-ai-stickers` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-ai-write` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-ai-write` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-arrow-bind` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-arrow-bind` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-arrow-kinds` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-arrow-kinds` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-convert` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-convert` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-crowd` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-crowd` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-dangling` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-dangling` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-enter` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-enter` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-figjam` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-figjam` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-follow` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-follow` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-layers` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-layers` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-marker` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-marker` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-place` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-place` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-plan` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-plan` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-print` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-print` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-rebind` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-rebind` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-section` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-section` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-stamps` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-stamps` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-sticky` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-sticky` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-stk-drop` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-stk-drop` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-stk-gallery` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-stk-gallery` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-stk-search` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-stk-search` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-templates` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-templates` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-today` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-today` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-video` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-video` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-viewer` | dark | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer. | spec reused (board unchanged since stage A) |
| `an-viewer` | light | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer. | spec reused (board unchanged since stage A) |
| `an-visibility` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-visibility` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-vote` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-vote` | light | re-shot | spec reused (board unchanged since stage A) |
| `an-vs` | dark | re-shot | spec reused (board unchanged since stage A) |
| `an-vs` | light | re-shot | spec reused (board unchanged since stage A) |

## After (round 4, c4-annot) — IMPL re-shot on the p8-c4-annot tip, both themes

Changed since round 3 (see `fix-c4-annot.md`): keyboard placement of a picked sticky / sticker / stamp / template, AI connectors born Curved, resolved rows marked beyond colour in Layers, section title at full ink in Edit, sticker gallery and Templates without a ×, "Not printed" as a dark pill inside the note. `an-viewer` stays unreachable.

Re-shot with the committed stage-D harness `_d-harness-g5` (ids): `an-ai-apply`, `an-ai-read`, `an-ai-stickers`, `an-ai-write`, `an-arrow-bind`, `an-arrow-kinds`, `an-convert`, `an-crowd`, `an-dangling`, `an-enter`, `an-figjam`, `an-follow`, `an-layers`, `an-marker`, `an-place`, `an-place-preview`, `an-plan`, `an-print`, `an-print-export`, `an-rebind`, `an-section`, `an-stamps`, `an-sticky`, `an-stk-drop`, `an-stk-gallery`, `an-stk-search`, `an-templates`, `an-today`, `an-video`, `an-visibility`, `an-vote`, `an-vs`. The "after" pairs above are overwritten in place (`<id>-<theme>.jpg`); the full-size path is in `full-size-path.txt` ("round 4:").

## FINAL (stage D2, d3881fe41) — IMPL re-shot on the merged tip (all stage C rounds 1–4)

Re-shot 60 of 62 pairs; 2 unreachable. Supersedes the per-round "after" sections above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) now shows the merged product. The SPEC side is unchanged — the board `.design/ui/v2/15 Annotations.*` has no commit after the stage-A shot, so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D2):").

- Frames driven: scenarios s15 groups a-f (Studio site fixture, group f on the print fixture), same fixtures and driving as `_d-harness-g5`. Also shot (no spec pair): `an-place-preview`, `an-print-export`.
- `an-viewer` stays unreachable: the viewer role needs a share-grant session, none in a local lane.
- Round-4 R5 states the fixture still does not reach (open, see `fix-c4-annot.md`): snap ring + "Button · See the work" tag, dangling "Point to…" card, "0:12" pin on a video artboard, stamp row / count popover, vote running + result section.

| id | theme | FINAL (D2) | spec |
| --- | --- | --- | --- |
| `an-ai-apply` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-apply` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | dark | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer. | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | light | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer. | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## After (round 7, c7-g15) — IMPL re-shot on the p8-c7-g15 tip, both themes

All 62 pairs `<id>-<theme>.jpg` overwritten in place (SPEC unchanged). Harness `_c7g15-harness-g5`: Desktop framed at ~60 %, an-place with the Sticky tool armed, an-sticky zoomed, an-marker with the one-row pill, an-section selected in Preview, an-vote through ⌘K. Done / open per row: `fix-c7-oboard.md`. Full-size pairs: last line of `full-size-path.txt` ("round 7:").

## Round 7 (p8-c7-g15b)

Every pair in this folder re-shot on the p8-c7-g15b tip (light + dark), SPEC side unchanged; the "after" table above is overwritten in place. Full-size pairs: last line of `full-size-path.txt` ("round 7 (g15b):"). New in the impl frames: the dock presses **E** (and Hand lets go) while the Stickers gallery is open (an-stk-gallery, an-stk-search, an-stk-drop); sticker result tiles take the well surface so they read in light (an-stk-search); the **"Not printed" pill sits under the note**, not on its text (an-print); an-arrow-bind shows the candidate outlines + snap ring + "Button · See the work" tag mid-drag; an-arrow-kinds has the Arrowhead menu open; an-convert has the note's menu open after one note was turned into a comment; an-visibility shows the shift-P hidden state + its toast (the harness key was `Shift+p`, which never fired); an-video places a note on the video artboard; an-stamps shows the running vote bar. 04 `md-edit-image` is re-shot with the Image slot pressed beside the Assets panel.

## FINAL (D5, e37e7d82a) — IMPL re-shot on the merged tip (stage C rounds 1–7)

Re-shot 60 of 62 pairs; 2 unreachable. Supersedes every earlier "after" / "FINAL" / "Round" section above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) shows the merged product at e37e7d82a. The SPEC side is unchanged (no commit to the board since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D5):").

Shot on the Mac mini (`scripts/remote-lane.sh`) with its installed Google Chrome (no Playwright browser there; `SHOT_CHANNEL=chrome`), harness `_d5-harness-g5/` = the newest layers per canvas flattened (see its README).
- Scenarios: `s15.mjs` groups a–f, then `s15g.mjs` gesture groups g1–g5 (later runs win: an-arrow-bind, an-arrow-kinds, an-convert, an-visibility, an-video, an-vote, an-stamps).

| id | theme | FINAL (D5) | spec |
| --- | --- | --- | --- |
| `an-ai-apply` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-apply` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | dark | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | light | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | light | re-shot | spec reused (board unchanged since the stage-A shot) |


## Round 8 (p8-c8-ann, 83696d6cd) — IMPL re-shot, both themes

Harness `_c8ann-harness-g5`. Every reachable id re-shot; the unreachable ones (an-viewer) keep their earlier cards. What changed on the impl side:

| id | what the pair now shows |
| --- | --- |
| an-vs · an-layers | no stale "Annotations hidden" toast (showing the layer takes it down); an-layers selects a locked sticky ("Locked · Unlock") |
| an-sticky · an-section · an-stk-drop · an-arrow-kinds · an-dangling | every selection bar ends in "…" (Move to trash); the sticky bar reads colours · size · list · Lock · Turn into a comment · "…"; the arrow bar reads kind · head · inks · Lock · "…" |
| an-section | a lilac section with its chip tone, count and swatches, framed whole |
| an-today | text in five sizes with the size menu open, the shape set, a link card, clip chip, dashed arrow, bullet / numbered stickies |
| an-dangling | the arrow whose button is gone is selected: dashed end + "Point to…" card |
| an-convert | the converted thread card and the sticky menu on one canvas (menu clear of the dock) |
| an-plan | three toned columns with count chips and channel-coloured cards, in free space |
| an-stamps | stamps on the artboard and the folded stamp tray |
| an-crowd | five sections of coloured stickies below 25 % (tone blocks, solid count chips, readable in dark) |
| an-print | a note over a print artboard ghosted at .88 |
| an-follow | the bound arrow set to Elbow before the artboard is dragged |

## FINAL (D6, 3d58f57df) — IMPL re-shot on the merged tip (stage C rounds 1–8)

Re-shot 60 of 62 pairs; 2 unreachable. Supersedes every earlier "after" / "FINAL" / "Round" section above: every pair in this folder (`<id>-<theme>.jpg`, JPEG q55, max 1100 px wide) shows the merged product at 3d58f57df. The SPEC side is unchanged (no commit to the board since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D6):").

Shot on the Mac mini (`scripts/remote-lane.sh`) with its installed Google Chrome (no Playwright browser there; `SHOT_CHANNEL=chrome`), harness `_d6f-harness-g5/` = the newest layers per canvas flattened (see its README).
- Scenarios: `s15.mjs` groups a–f, then `s15g.mjs` gesture groups g1–g5 (the round-8 versions; later runs win: an-arrow-bind, an-arrow-kinds, an-convert, an-visibility, an-video, an-vote, an-stamps).

| id | theme | FINAL (D6) | spec |
| --- | --- | --- | --- |
| `an-ai-apply` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-apply` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | dark | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | light | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | light | re-shot | spec reused (board unchanged since the stage-A shot) |

## Round 10 (p8-c10-print) — after

| artboard id | after (round 10) |
|---|---|
| an-print | re-shot with View > Print guides on: the dashed print-area outline, the four crop marks and the bleed/trim/margin guides draw round each print sheet (un-clipped print layer); the note over the sheet keeps its .88 ghosting and the "Not printed" pill |

## Round 10 (p8-c10-ann, f44cbca82) — IMPL re-shot, both themes

Harness `_c10ann-harness-g5` (copy of `_d6f-harness-g5`; s15 groups a–f + the new clean plan group `p`, then s15g g1–g5), shot on the Mac mini with its Google Chrome. The 62 `<id>-<theme>.jpg` pairs in this folder show the round-10 product (SPEC side unchanged). Full-size pairs: last line of `full-size-path.txt` ("round 10:"). Three impl-only side shots were added: `an-today-size-*`, `an-today-shape-*`, `an-today-marker-*` (the catalogue's other cells, one state each).

| id | what the pair now shows |
| --- | --- |
| an-stk-drop | after the drop Stickers (E) stays pressed with the placed sticker selected; Hand is not |
| an-stamps | the folded Stamps tray is centred over the Stickers slot, no "Done" button |
| an-convert | the converted thread card sits beside its pin: caption line, messages, Resolve + "…" only; the upper note's menu no longer overlaps it |
| an-layers | the locked sticky and its "Locked · Unlock ⇧⌘L" bar are out from behind the Layers panel; the drag tip "Locked — unlock to move it" is up |
| an-dangling | the dashed outline of the trashed button is drawn where it was |
| an-crowd | the section count chips ("Nápady 84") have room for their text |
| an-today | the whole catalogue in one frame (text sizes, shapes, picture, link card, video + audio chips, dashed arrow, lists) with two notes selected: the group bar |
| an-plan | the plan alone: toned columns, count chips, channel-coloured cards, the Done cards pointing at the Tablet and Mobile artboards, whole board in frame |
| an-follow | a loose note beside Mobile; Tereza's bound sticky on the far side, its elbow routed around Tablet and Mobile |

## FINAL (D7, 0e926b7dc)

Final verification re-shoot of the IMPL side (every artboard id x light + dark) on the merged `feat/maude-v2` tip 0e926b7dc (stage C rounds 1–10 merged, release client); no product code changed. Supersedes every earlier "after" / FINAL / round section, round 10 included. 60 of 62 pairs re-shot, 2 unreachable. Evidence only: no match / mismatch judged here. The `<id>-<theme>.jpg` pairs in this folder (JPEG q55, max 1100 px wide) show the product at 0e926b7dc; the SPEC side is unchanged (the boards `.design/ui/v2/15*` have not changed since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of `full-size-path.txt` ("final (D7").

Shot on the Mac mini (`scripts/remote-lane.sh`) with its installed Google Chrome (`SHOT_CHANNEL=chrome`, viewport 1600 x 1000), throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, release-built client; harness `_d7-harness-g4/` (see its README).
- Chain (`_d7-harness-g4/run.sh 15`): `s15.mjs` groups a–f and p, then `s15g.mjs` g1–g5 (round 10, `_c10ann-harness-g5`), with the round-10 print step (View > Print guides on before `an-print`, p8-c10-print) folded into `scr15/s15.mjs`.
- Extra impl-only shots from the same run (no spec pair): `an-today-size`, `an-today-shape`, `an-today-marker`.

| id | theme | FINAL (D7) | spec |
| --- | --- | --- | --- |
| `an-ai-apply` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-apply` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-read` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-stickers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-ai-write` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-bind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-arrow-kinds` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-convert` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-crowd` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-dangling` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-enter` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-figjam` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-follow` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-layers` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-marker` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-place` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-plan` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-print` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-rebind` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-section` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stamps` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-sticky` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-drop` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-gallery` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-stk-search` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-templates` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-today` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-video` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | dark | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer | spec reused (board unchanged since the stage-A shot) |
| `an-viewer` | light | unreachable — Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-visibility` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vote` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | dark | re-shot | spec reused (board unchanged since the stage-A shot) |
| `an-vs` | light | re-shot | spec reused (board unchanged since the stage-A shot) |
