# critic-bar2 — 11 Projects and Navigation (verified bar, re-read of critic-final.md at D2 d3881fe41)

No new shots. Lead decisions applied: owning board wins (keys sheet = 06 full sheet, history fold hint = 06), contract over board, variant A superseded by v2-3.7-own-tab-bar, "+ New canvas" row + switcher in the pill, fixture content, stub-fed account tone.

## Verdicts
- pn-tab-b · verified (both) · none
- pn-tab-b20 · differs · tabs ~70 px with names cut to 3-6 chars (spec ~120 px min, readable names, ~10 tabs + "N more"); strip.html min-width/flex not honoured at 20 tabs (meaningful name, hierarchy)
- pn-switch-ai-strip · verified (both) · none
- pn-relaunch-strip · differs · same root as pn-tab-b20: 19 resting tabs unreadable ("Stu…", "Ma…")
- pn-home · differs · slim ask row does not dock in the header when scrolled (composer card clipped under the top bar; spec keeps ask bar + "Start with an empty canvas" on top)
- pn-home-search · differs · palette matches; page behind has the same missing docked ask row
- pn-ds · differs · no accent-tinted "Design system" card, no "used by N projects" line (two compact rows instead)
- pn-ds-search · differs · no "Colour / Components · section of the Design system" rows, no "used by N projects"
- pn-organise · verified (both) · none
- pn-move · differs · drag-into-folder behaviour ("Move here" target, drag ghost) not evidenced; only inline rename shot
- pn-trash · differs · toast keeps a check glyph + × (board: trash glyph, no ×); light shot has no toast so Undo is not evidenced
- pn-jump · differs · only 8 of 21 artboard rows fit, canvas row has no "21" count, current artboard row not marked
- pn-k-across · verified (both) · none
- pn-k-close · differs · results split into "Canvases" / "Artboards" groups; board draws one "Canvases and artboards" list incl. the stale canvas
- pn-history · verified (both) · none
- pn-compare · differs · stage is two framed panes with the caption clipped under the top bar (board: the canvas with A / B labels + 660 px island); "Restore this version" wraps to its own line
- pn-switch-ai · verified (both) · none
- pn-relaunch · differs · toast has × and no tabs glyph (board: one-line pill, tabs glyph, no ×); same shared-toast cause as pn-trash
- pn-deeplink · differs · toast names the slug "a-story" instead of the artboard name; target artboard not selected/ringed
- pn-tab-a, pn-tab-a20, pn-ab · unreachable · superseded by v2-3.7-own-tab-bar (retire or mark the boards)
- pn-tab-menu, pn-windows · unreachable · native NSMenu / multi-window (desktop e2e)
- pn-accounts · unreachable · account card + second-account fixture
- pn-cant-open · unreachable · moved-root / access-removed (Rust shell + hub)

## Polish list
- pn-tab-b · "Matchday 2…" truncated though the tab has room (crop)
- pn-tab-b · account badge grey (stub feeds tone b; fixture)
- pn-tab-b · working spark is a soft glyph, not a disc
- pn-home · What's-new pill on top (not on board; product pill)
- pn-home · gradient placeholder thumbnails (fixture)
- pn-home-search · rows lack AI-state sub-line and thumbnails; "Recent searches" absent (empty history; fixture)
- pn-ds · two systems in fixture vs board's one
- pn-organise · menu rows 24 px, empty thumb squares, no avatar on pinned row, "Make a design system" row (fixture)
- pn-trash · fixture rows (1 vs 4, no Earlier group)
- pn-k-across · tool row chevron glyph (board: artboard/duplicate glyphs); "New artboard: Mobile" vs "New artboard — Mobile"; canvas rows page glyph not thumbnails; no "This tab" group (fixture)
- pn-k-close · artboard rows # glyph (board: print glyph); canvas row page glyph not thumbnail
- pn-history · version titles are machine change lines; picture slots empty; no Named / Made by AI chips (render and AI data; fixture); fold hint follows 06
- pn-compare · change rows all accent-tint, no author; titles as pn-history
- pn-switch-ai · sheet is the full 92-key sheet (06 owns); sticky foot over last rows
- pn-deeplink · dark 89% fit vs light 100% crop

## Side states
- pn-trash/confirm-dialog · "Clear out the trash?" + owner-only tooltip · reachable, not shot
- pn-trash/row-menu · row context menu · reachable, not shot
- pn-move/double-click-tooltip · hover tooltip · reachable, not shot
- pn-home/pinned-and-shared · Pinned row, Shared with you list · unreachable (signed-out lane, needs hub)
- pn-home-search/recent-searches · Recent searches group · reachable with history, not shot
- pn-switch-ai/mac-notification · native notification · unreachable (e2e)
- pn-deeplink/comment-popover · thread popover · unreachable (needs a second person's comment)
