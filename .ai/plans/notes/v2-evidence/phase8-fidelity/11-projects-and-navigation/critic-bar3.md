# critic-bar3 — 11 Projects and Navigation (verified bar, judged fresh from the D5 pairs on the merged tip e37e7d82a)

Lead decisions applied: owning board wins (06 keys sheet, 13 ⌘K DS rows, 14 inspector), contract over board (CONTRACT §1/§6 tab strip: square + name + one state mark; no number badges, no "+" button), `v2-p8-c5-panel-quiet-by-state` (no foot / Trash row at rest), `v2-p8-c7-trashed-open-stays-viewing`, variant A boards superseded by `v2-3.7-own-tab-bar`.

## Verdicts
- pn-tab-b · verified (both) · none
- pn-tab-b20 · differs · name area too small once a state mark is on the tab: "S… ?", "Op… ○", "Pric… ●" (1-4 chars); the board keeps ~7 chars beside the same mark (`strip.html` mark slot + padding eat the name; tab pitch itself matches)
- pn-switch-ai-strip · verified (both) · none
- pn-relaunch-strip · differs · same root as pn-tab-b20, worse: every resting tab shows 2-3 chars ("Stu…", "Ma…", "Por…") beside the ring; board shows ~8
- pn-home · verified (both) · none (slim ask row docks in the header; Recent canvases + Projects order match; see Polish)
- pn-home-search · verified (both) · none
- pn-ds · differs · the pinned card has no "used by N projects" line (draws "17 canvases"; no per-project-use data exists)
- pn-ds-search · differs · same missing "used by N projects"; the "Colour / Components · section of the Design system" rows are not evidenced (the shot's system is unconverted, so `search-ds.js` correctly emits "not on a canvas yet" and no section rows)
- pn-organise · verified (both) · none
- pn-move · differs · the board's drag state is not in the frame: no "Move here" tag on a folder row and no drag ghost; only the dragged row ("Smoke") is dimmed/dashed, no row is the drop target
- pn-trash · verified (both) · none (main frame = Trash view + trash-glyph toast with Undo, no ×)
- pn-jump · verified (both) · none (21 rows, "21" on the canvas row, current row marked, "21 artboards" foot, artboard selected)
- pn-k-across · verified (both) · none
- pn-k-close · verified (both) · none (one "Canvases and artboards" list, close-match note)
- pn-history · verified (both) · none
- pn-compare · verified (both) · none (two frames side by side with A / B labels, change list, Side by side / Overlay, same two-line button wrap as the board)
- pn-switch-ai · verified (both) · none (full 92-key sheet = 06 owns)
- pn-relaunch · verified (both) · none (one-line pill, tabs glyph, no ×)
- pn-deeplink · verified in dark only · light shot: the selection ring/handles sit offset from "Pozvánka · story" (ring spans ~320 px, the artboard ~210 px, ring starts 115 px right of the artboard) — a stale selection rect after the centring pan, or a mid-pan capture; dark has ring and artboard aligned. Re-shoot light after the pan settles (or fix if it reproduces).
- pn-tab-a, pn-tab-a20, pn-ab · unreachable · superseded by `v2-3.7-own-tab-bar` / decision board
- pn-tab-menu, pn-windows · unreachable · native NSMenu / multi-window (desktop e2e)
- pn-accounts · unreachable · account card not built + second-account fixture
- pn-cant-open · unreachable · moved root / removed access (Rust shell + hub)

## Polish list
- pn-tab-b · "Matchday 2…" truncated though the tab has room; account badge grey (stub tone); working spark is a soft glyph; board's ⌘N number badges and "+" button not drawn (CONTRACT: ⌘T / File menu carry it)
- pn-tab-b20 · active tab is not wider than its neighbours (board: active shows the full name)
- pn-home · What's-new pill (product); starter chips + "Start with an empty canvas" tail visible under the docked bar (mid-scroll frame); no Pinned row (empty pins); Shared with you absent so Projects is one column; gradient placeholder thumbnails (fixture)
- pn-home-search · palette sits ~48 px lower than the board (top-centre either way); scrim in light is grey, board washes white; rows lack AI sub-line and thumbnails; "Recent searches" absent (empty history)
- pn-ds · two-line card shows "N canvases" instead of "used by N"; kind-filter chip row under search (panel feature, board 11 does not draw it); no Trash row / foot (quiet-by-state)
- pn-ds-search · group header "Design system" instead of the project square header; rows in the shot are ranked by the index, not the board's three
- pn-organise · Pinned section has 2 rows vs board's; no Trash row (empty); chips row as in pn-ds; menu rows 24 px
- pn-move · no foot / Trash row at rest (quiet-by-state)
- pn-trash · one trashed row, no Earlier group (fixture); canvas area shows "No canvas open" after trashing the only canvas
- pn-jump · foot "21 artboards · 21 web" vs "19 digital, 2 print"; inspector visible (14 owns)
- pn-k-across · tool row glyphs (chevron vs artboard / duplicate), "New artboard: Mobile" vs "New artboard — Mobile"; canvas rows page glyph, no "This tab" group; palette top offset as pn-home-search
- pn-k-close · # glyph on artboard rows (board: print glyph), no thumbnails, stale canvas row absent (fixture)
- pn-history · version titles are machine change lines; picture slots empty; no Named / Made by AI chips (fixture); left panel stays open (board: closed)
- pn-compare · change rows accent-tinted, no author column ("changed in between"); B label plain, no selection ring on B; left panel open; two iframes, not one canvas
- pn-switch-ai · sticky foot overlaps the last rows of the sheet
- pn-relaunch · "Wide" fixture canvas, no foot at rest
- pn-deeplink · toast names "Uniformy-2027 · Pozvánka · story" (no sender on a local link); a What's-new first-run toast floats at the bottom (fixture)

## Side states
- pn-tab-b/tab-tooltip · hover tooltip "Matchday 2026 · AI is drawing the score card" · reachable, not shot
- pn-move/rename-frame · inline rename field "Combine — test barev" with "rename · esc keep" (storyboard frame 2) · reachable, not shot
- pn-move/double-click-tooltip · "Double-click a name" tooltip · reachable, not shot
- pn-trash/row-menu · context menu on a trash/canvas row (Open · Pin · Rename · Duplicate · Move to… · Copy link · Move to trash) · reachable, not shot
- pn-trash/confirm-dialog · "Clear out the trash?" + owner-only tooltip · reachable, not shot
- pn-home/pinned-and-shared · Pinned row + Shared with you list · unreachable (signed-out lane, needs hub)
- pn-home-search/recent-searches · Recent searches group · reachable once history exists, not shot
- pn-compare/overlay · Overlay mode of the compare stage · reachable, not shot
- pn-switch-ai/mac-notification · native notification · unreachable (e2e)
- pn-deeplink/comment-popover · thread popover on the target artboard · unreachable (needs a second person's comment)
