# critic-bar4 — 11 Projects and Navigation (verified bar, judged fresh from the D6 pairs on merged tip 3d58f57df, both themes read for every id)

Lead decisions applied: owning board wins (06 keys sheet, 13 ⌘K DS rows, 14 inspector), contract over board (CONTRACT §1/§6 tab strip: square + one state mark, no number badges, no "+" button), `v2-p8-c5-panel-quiet-by-state` (no foot / Trash row at rest), `v2-p8-c7-trashed-open-stays-viewing`, `v2-p8-c8-tab-rest-dense-padding`, `v2-p8-c8-first-run-card-once` (What's-new toast in the pn-deeplink shot is a fixture), c8 decision "used by N projects" has no data (board deviation, decided), `v2-3.7-own-tab-bar` supersedes variant A boards.

## Verdicts
- pn-tab-b · verified (both) · none
- pn-tab-b20 · verified (both) · none (round 8 fixed the root: names now ~8 chars beside the state mark, "10 more" overflow, resting ring, x replaces the square on the active tab)
- pn-switch-ai-strip · verified (both) · none
- pn-relaunch-strip · verified (both) · none (resting tabs show ~8 chars + ring, "10 more"; board shows 14 tabs and a chevron — fixture width)
- pn-home · verified (both) · none
- pn-home-search · verified (both) · none
- pn-ds · verified (both) · none ("used by 3 projects" line replaced by "17 canvases": recorded lead decision, no per-project-use data)
- pn-ds-search · verified (both) · none (DS rows follow board 13's search-ds.js; Colour / Components section rows only appear for a converted system, the shot's system is unconverted: fixture; Ask AI row, count footer and move/open hints present)
- pn-organise · verified (both) · none
- pn-move · verified (both) · none (round 8 shows the drag state: "Move here" on the folder, dragged row dimmed/dashed)
- pn-trash · verified (both) · none
- pn-jump · verified (both) · none
- pn-k-across · verified (both) · none
- pn-k-close · verified (both) · none
- pn-history · verified (both) · none
- pn-compare · verified (both) · none
- pn-switch-ai · verified (both) · none (full 93-key sheet = 06 owns; Mac notification is a side state)
- pn-relaunch · verified (both) · none
- pn-deeplink · verified (both) · none (round-8 re-shoot: selection ring and artboard aligned in light and dark)
- pn-tab-a, pn-tab-a20, pn-ab · unreachable · superseded by `v2-3.7-own-tab-bar` / decision board
- pn-tab-menu, pn-windows · unreachable · native NSMenu / multi-window (desktop e2e)
- pn-accounts · unreachable · account card not built + second-account fixture
- pn-cant-open · unreachable · moved root / removed access (Rust shell + hub)

## Polish list
- pn-tab-b · "Matchday 2…" truncated though the tab has room; account badge grey; working spark is a soft glyph; board's number badges and "+" button not drawn (CONTRACT)
- pn-tab-b20 · active tab is not wider than its neighbours (board: shows the full name); no account badge on the active tab (needs a second account)
- pn-relaunch-strip · 10 tabs + "10 more" vs board's 14 + chevron (strip width / fixture)
- pn-home · What's-new pill (product); starter chips + "Start with an empty canvas" visible under the docked bar; "Sign in to cloud.maude.sh" link (signed-out lane); no Pinned row (empty pins), no Shared with you (needs hub), so Projects is one column; gradient placeholder thumbnails, no "Made by AI" tag / collaborator avatars (fixture)
- pn-home-search · palette ~48 px lower than the board (same top-centre anchor); scrim grey in light, board washes white; rows lack AI sub-line and thumbnails; "Recent searches" absent (empty history)
- pn-ds · kind-filter chip row under search (panel feature, board 11 does not draw it); no folder list / Trash row / foot at rest (quiet-by-state, fixture)
- pn-ds-search · group header "Design system" instead of the project square header; rows ranked by the index, 16 results instead of the board's 3
- pn-organise · chips row as in pn-ds; menu rows 24 px; Pinned section 2 rows vs board's; no Trash row (empty)
- pn-move · no foot / Trash row at rest; the native drag ghost chip is not drawable in a synthetic-event shot
- pn-trash · one trashed row, no Earlier group (fixture); canvas area shows "No canvas open" after trashing the only canvas
- pn-jump · foot "21 artboards · 21 web" vs "19 digital, 2 print"; inspector visible (14 owns)
- pn-k-across · tool row glyphs (chevron vs artboard); no "This tab" group (current tab has no match, fixture); "Duplicate at another width" tool row not in the result list (4 results vs 7); "New artboard: Mobile" vs "New artboard — Mobile"
- pn-k-close · # glyph on artboard rows (board: print glyph), no thumbnails, stale-canvas row absent (fixture)
- pn-history · version titles are machine change lines; picture slots empty; left panel stays open (board: closed)
- pn-compare · change rows accent-tinted, no author column ("changed in between"); B label plain, no selection ring on B; left panel open; two iframes, not one canvas
- pn-switch-ai · sticky foot overlaps the last rows of the sheet
- pn-relaunch · "Wide" fixture canvas, no foot at rest
- pn-deeplink · toast names "Uniformy-2027 · Pozvánka · story" (no sender on a local link); a What's-new toast floats at the bottom (fixture); no "The link, in Slack" doc card (board annotation)

## Side states
- pn-tab-b/tab-tooltip · hover tooltip "Matchday 2026 · AI is drawing the score card" · reachable, not shot
- pn-move/rename-frame · inline rename field with "rename · esc keep" (storyboard frame 2) · reachable, not shot
- pn-move/double-click-tooltip · "Double-click a name" tooltip · reachable, not shot
- pn-trash/row-menu · context menu on a canvas row (Open · Pin · Rename · Duplicate · Move to… · Copy link · Move to trash) · reachable, not shot
- pn-trash/confirm-dialog · "Clear out the trash?" + owner-only tooltip · reachable, not shot
- pn-home/pinned-and-shared · Pinned row + Shared with you list · unreachable (signed-out lane, needs hub)
- pn-home-search/recent-searches · Recent searches group · reachable once history exists, not shot
- pn-compare/overlay · Overlay mode of the compare stage · reachable, not shot
- pn-switch-ai/mac-notification · native notification · unreachable (e2e)
- pn-deeplink/comment-popover · thread popover on the target artboard · unreachable (needs a second person's comment)
