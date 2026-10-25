# 11 Projects and Navigation — stage A evidence (G4)

23 artboards · 16 paired (dark + light; 3 of them also have a second pair of a different crop: `pn-ds-search`, `pn-switch-ai-strip`, `pn-relaunch-strip`) · 7 not reachable. Full-size pairs: `full-size-path.txt`; spec-only frames: `spec-only/`.

How to read: left = spec crop (the Stage's 1440×860 window body, 1 px inset removed; the native tab-strip row cropped separately for the tab artboards), right = impl. Content differs by design (spec: Alligators' 93 canvases, people, a team; impl: the e2e fixture + a harness set of 75 small canvases in 5 folders, 21-artboard `Wide`, Czech-named `Uniformy-2027`). The desktop's tab strip is a native child webview — it is **not** in the browser lane; the strip frames render the real `apps/desktop/src/strip.html` + `strip.js` in Chromium with a stubbed Tauri `tabs_state` channel (the real page and CSS, fed a hand-built `TabStripState`, so no Rust/native chrome: no traffic lights, no real window). Rust-fed things in the shell (`index_search`, `take_pending_navigate`, `take_tabs_restored`) were stubbed the same way. Dark compared frame by frame, light on a sample.

| id | theme | state | how reached | impl reachable? | first-glance differences |
|---|---|---|---|---|---|
| pn-tab-a | dark · light | A · native macOS tabs, titles only | — | **no** — variant A was NOT picked; no native tab group exists (decision v2-3.7-own-tab-bar, `S1.21-tab-a.txt`) | superseded board; spec-only |
| pn-tab-b | dark · light | B · tab strip: square + name, account badge, state dot | `strip.html` with stubbed `tabs_state` (4 tabs, 2 accounts, working + needs-you) | partially — real strip page, not the native window | Spec draws the traffic lights, a Home icon, the "+" and numbered callouts; impl strip has Home at the left only, no "+" (by decision), no tab separators and a flatter active tab (spec: raised, darker pill with × on the active tab at the left, here × at the right). Account badge is a small dot ring "W" (spec: a badge with W). Working spark is a tiny "✦". Row is 38 px high with smaller type than the spec's. |
| pn-tab-a20 | dark · light | A · 20 tabs, » lists the rest | — | **no** — variant A not picked | spec-only |
| pn-tab-b20 | dark · light | B · 20 tabs: square + short name on every tab, "N more" | `strip.html`, 20 stubbed tabs; also the tab list opened (`strip-b20-overview-*.png` in `.scr/impl`) | partially | impl keeps 9 tabs and a "11 more" control; spec shows ≈10 tabs, 120 px min width and a "»" list. The tab-list overlay exists in impl (Show All Tabs); spec's board has no equivalent overlay frame. |
| pn-ab | dark · light | A or B: the trade-offs, and a pick | — | **no** — a decision board, no UI | spec-only |
| pn-tab-menu | dark · light | Right-click a tab: whose menu it is | — | **no** — the tab menu is a native NSMenu (`tab_menu_rows` in tabs.rs); not drawable in a browser | spec-only |
| pn-windows | dark · light | Tabs and windows: drag out / merge / open once | — | **no** — multi-window is native; drag-out/merge is not shipped (decision) | spec-only |
| pn-accounts | dark · light | Two accounts on this Mac — the account is the project's | — | **no** — the account card by the faces is not built (S1.21-accounts: binding shipped, card is a GAP) | spec-only |
| pn-home | dark · light | Home: pinned, recent canvases, shared with you, projects by account | project-less Home server (`--home`), `MAUDE_INDEX_DIR` seeded with 5 projects, `shell_state` stub (2 accounts) | partially | Spec scrolled shows **Pinned** row, **Shared with you** list with role chips (Can edit / Can comment / Can view) and a project list with per-project "Open" for ones not on this Mac; impl has no Pinned row (nothing pinned in the seed), no Shared section (hub signed out in the lane), no "Find a project" / sort control in Projects, and a "What's new" banner on top. Impl project rows: thumbnail + name + "N canvases · in a tab" but no right-aligned tone square; Personal group listed before Work (spec: Work first). Canvas cards use gradient placeholders (seed covers) — data. |
| pn-home-search | dark · light | ⌘K on Home before typing | Home, ⌘K | partially | Spec: a large centred palette with Recent searches ("letak a6 predni"…), Open tabs and Recent canvases groups and a footer. Impl: ⌘K focuses the Home search field in the top bar with a one-line hint popover ("Search every project on this Mac, open or not."); no palette, no recent searches. This is a real structural difference. |
| pn-ds | dark · light | Where the design system lives (panel row) | e2e project has no DS; the copy of this repo's `.design` (maude + maude-v2 systems) was opened instead | partially | Spec: one "Design system · Alligators brand system · used by 3 projects" card pinned above the tree. Impl with 2 systems: two compact rows ("maude · Default · 37 canvases", "maude-v2 · 16 canvases · v2") under a "Design systems · 2 in use" header; no "used by N projects" line. |
| pn-ds-search | dark · light | ⌘K "design" finds the system | same copy, ⌘K | partially | Impl: grouped "Design system / Canvases / Artboards" results, DS rows read "Design system · not on a canvas yet"; spec: one project group, "Alligators brand system · Design system · used by 3 projects", "Colour · section of the Design system". |
| pn-organise | dark · light | Pinned on top, sorted your way | pinned two canvases (row pin), opened the Sort menu | yes | Same structure (Pinned 2, Recent ▾ menu with Recently opened / Name / Kind / Folders on top). Spec menu is wider with larger rows and sits over the tree; impl menu is narrower with tight rows. Spec has a "Design system" card under Search; impl has a "Make a design system" row (no DS in project). Pinned row in impl shows only a pin glyph, spec shows the avatar-T badge + pin. |
| pn-move | dark · light | Drag into a folder · rename in place | row menu › Rename (inline edit) | partially: rename in place real; drag-and-drop drop-target "Move here" chip not driven | Inline edit field + "↵ rename · esc keep" hint match in meaning; impl hint text smaller; spec also shows the drag ghost + "Move here" target and a "Double-click a name" tooltip. |
| pn-trash | dark · light | Move to trash, Restore, clear out | row menu › Move to trash, Trash row opened | yes, partially | Spec: Trash view with 4 rows (Today / Earlier groups, Restore button, per-row who + when), the "Clear out the trash?" confirm and the owner-only tooltip; impl: Trash with 1 item "Wide · root · You, just now" (no Restore button visible, shown only on hover?), "Kept until you clear it out." foot + "Clear out…", the toast has "Undo". Confirm dialog not shot. Empty-canvas message "No canvas open — Start quick setup" is the fixture state after trashing the open canvas. |
| pn-jump | dark · light | 21 artboards — jump from the panel | open `Wide` (21 artboards), expanded row | yes | Jump list lists Artboard 1…6 with frame glyphs under the row; spec adds a "Combine campaign" board name, kind icons and counts per row ("21 artboards · 21 web" footer exists in impl). Rows are 30 px in impl, tighter in spec. |
| pn-k-across | dark · light | ⌘K — every project, grouped | ⌘K "mobil" with Tauri `index_search` STUBBED (two other projects) | yes (stubbed shell) | Group headers have the project square + name + place aside ("in another tab" / "not open — opens a tab") like the spec; the "This tab" group is missing in impl (this project had no match). Spec's rows show canvas thumbnails and a "4 close matches / Ask AI" footer; impl rows use icons, "Ask AI — find 'mobil' by what it looks like" present. Palette width/position similar. |
| pn-k-close | dark · light | Artboards by name, accents and typos | ⌘K "unifromy 2027" on `Uniformy-2027` | yes | Notice line and mark highlighting present ("Nothing called … Showing close matches for Uniformy."). Impl has separate "Canvases" and "Artboards" group headings with square icons; spec has one "Canvases and artboards" list with a canvas thumbnail, "· 12 artboards" and a "Did you mean" ordering. Result row meta differ (spec includes folder/path). |
| pn-history | dark · light | Versions with pictures — looking at yesterday | edited the canvas file 3× (auto-snapshots), ⌥⌘H, clicked the 2nd version | yes | Panel and "Viewing …" bar present with the same words. Version rows: impl thumbnails are empty dark squares (no render), no "Named" / "Made by AI" chips, rows only "You · changed outside the app" (spec: names like "Venkovní dres v zelené", author avatars, Today / Yesterday groups). "Name this version…" in the Now row is present. |
| pn-compare | dark · light | Compare two versions — every change | same, then Compare | yes | Impl splits A/B side by side with a summary line and a change list ("Kalhoty doma v3 · Artboard … renamed …"); spec's panel carries the A/B markers, the "Restores the whole canvas…" sentence and Restore only / Restore this version buttons (present in impl at the bottom of the panel). Impl compare caption sits at the very top and clips; spec is in-canvas. |
| pn-switch-ai | dark · light | Switch tabs while AI works — and the keys | ⌘K › Keyboard shortcuts | partially | Impl: 3-column "Keyboard shortcuts" sheet grouped Edit tools / Canvas / Objects / File / Panels (92 keys), not the spec's single-column "Tabs and windows" + "Finding a canvas" groups with ^Tab / ⌘W rows; the sheet in impl has no tab-group at the top of what was visible (scroll needed). The Mac notification banner and AI "done" dot are native — not in the lane. |
| pn-switch-ai-strip | dark · light | the tab strip row with working / needs-you / done marks | `strip.html` stub, 5 tabs | partially (same caveat as pn-tab-b) | marks present: spark, "?", done dot; sizes smaller than the spec's. |
| pn-relaunch | dark · light | After a restart: toast "20 tabs reopened…" | STUBBED `take_tabs_restored {count: 20}` | yes (stubbed) | Toast carries the exact sentence ("20 tabs reopened. Each one starts when you open it."). It is a bottom-centre card with a blue left rule and × (≈360 px wide); spec is a top-centre one-line pill with a tabs glyph and no ×. The 20 resting tabs themselves are in the strip row (see next row). |
| pn-relaunch-strip | dark · light | 20 resting tabs row | `strip.html`, 20 tabs, 19 resting | partially | resting ring marks present; no "»" list in the spec sense (impl: "N more"). |
| pn-deeplink | dark · light | A link from Slack — right tab, right artboard | STUBBED `take_pending_navigate {canvas, artboard}` | partially — navigates and selects the artboard; no "Opened from …'s link — …" toast in the shot, and the thread/comment landing needs a comment to exist | Spec shows the Slack message beside and the toast "Opened from Tereza's link — Pozvánka · story." plus the comment popover on the artboard; impl: artboard selected only. |
| pn-cant-open | dark · light | A project that moved · access removed · now Can view | — | **no** — needs a moved project root / removed access in the Rust shell + hub | spec-only |

## Notes for the critics
- The tab-strip frames are the closest that can be got without the native window; the native parts (traffic lights, "+", OS menus, notifications) are not in impl frames by construction.
- Home was shot from the project-less Home server, not a project tab: Home (`pn-home`, `pn-home-search`) is a separate page from the shell.
- `.scr` also holds extra frames not paired (`strip-b20-overview-*`, `pn-home-top-*`, `pn-home-search-typed-*`, `pn-k-close-2-*`).

## After (stage D, 53ceb26c5)

Re-shot on the release client of `feat/maude-v2` @ `53ceb26c5` with the same harness: project lane (e2e fixture + 75 small canvases + `Wide` + `Uniformy-2027`, Tauri `index_search` / `take_*` stubs), the real `apps/desktop/src/strip.html` fed a stubbed `tabs_state`, and the `--home` server (re-seeded 5-project machine index, `shell_state` stub). The `*.jpg` pairs in this folder are the new ones. Spec side: **reused** — `11 Projects and Navigation.tsx` unchanged since the stage-A shot, stage-A spec PNGs copied in. Full-size pairs: `full-size-path.txt` (stage D line).

Harness-only changes: dismiss selector `button.maude-notice-close` (the What's-new notice has a "See all" button first); `pn-ds` spec crop/impl crop as stage A; `pn-ds` used a copy of this tree's `.design` (system + ui only, trimmed).

| id | dark · light | note |
|---|---|---|
| pn-tab-b, pn-tab-b20 | re-shot | `strip.html`, same stubbed states (4 tabs / 20 tabs); native window chrome still absent by construction |
| pn-switch-ai, pn-switch-ai-strip | re-shot | `⌘K › Keyboard shortcuts`; strip with working / needs-you / done |
| pn-relaunch, pn-relaunch-strip | re-shot | stubbed `take_tabs_restored {count: 20}`; strip with 19 resting |
| pn-home, pn-home-search | re-shot | project-less Home server; Home's own search / ask row as built in stage C |
| pn-ds, pn-ds-search | re-shot | copy of this repo's `.design` (two design systems, not the board's one) |
| pn-organise, pn-move, pn-trash, pn-jump | re-shot | real panel interactions |
| pn-k-across, pn-k-close | re-shot | `index_search` stubbed; `pn-k-close` = "unifromy 2027" as stage A |
| pn-history, pn-compare | re-shot | file edited 3x for snapshots, second version, Compare |
| pn-deeplink | re-shot | stubbed `take_pending_navigate` |
| pn-tab-a, pn-tab-a20 | unreachable | variant A was not picked (decision `v2-3.7-own-tab-bar`), superseded boards |
| pn-ab | unreachable | decision board, no UI |
| pn-tab-menu, pn-windows | unreachable | native NSMenu / multi-window, not drawable in a browser |
| pn-accounts | unreachable | the account card by the faces is not built (stage C round 2 did not add it; `fix-navcreate.md`) |
| pn-cant-open | unreachable | needs a moved project root / removed access in the Rust shell + hub |

Extra unpaired frames kept in `.scr/impl`: `strip-b20-overview-*`, `pn-home-top-*`, `pn-home-search-typed-*`, `pn-k-close-2-*`.

## after (stage D, round 3 — p8-c3-shell, impl c7f1a0efd)

Re-shot, IMPL side only, light + dark (SPEC reused): pn-organise, pn-move, pn-jump, pn-trash, pn-k-across, pn-k-close, pn-deeplink, pn-relaunch, pn-history, pn-compare. What changed in the shell frame: the Undo · Redo · zoom % island bottom left, the Canvases panel and Version history hug their rows (no twisty at rest), B on the Now row replaces its dot, kind chips only for a mixed project. The other rows of this canvas were not re-shot this round. See `01-create-flow/fix-c3-shell.md`.

## After (round 4, p8-c4-navpanels)

Re-shot on the release client of the p8-c4-navpanels tip with the committed stage-D harness (`_d-harness-g4`): `s11 / s11e / s11b / s11d / s11ds`, `strip-shoot`, `home11`; same fixtures and stubs as stage D. Every pair above was overwritten (dark + light); `fix-c4-navpanels.md` says what changed and what is open.

| id | dark · light | note |
|---|---|---|
| pn-tab-b, pn-tab-b20, pn-switch-ai-strip, pn-relaunch-strip | re-shot | no "0 more" chip; resting names in the tabs' tone; done / spark at text strength |
| pn-organise, pn-move, pn-trash, pn-jump, pn-ds, pn-ds-search, pn-history, pn-compare | re-shot | Canvases header carries no "+" / folder pair — "+ New canvas" ends the list; no project-switcher foot (the pill is the switcher) |
| pn-k-close, pn-k-across | re-shot | close-match note quotes the typo word; "Tools and settings" group |
| pn-home, pn-home-search | re-shot | Work leads; Projects foot "N more" + Open project… (this seed has 5 projects, so no "N more" shows); no "New project…" row |
| pn-switch-ai, pn-relaunch, pn-deeplink | re-shot | unchanged by this round (keys sheet, toast and deep link are open) |

## FINAL (stage D2, d3881fe41)

Final re-shoot, IMPL side, dark + light, on the release client built from `feat/maude-v2` @ `d3881fe41` (all stage C rounds 1-4 merged; client bundle = `fae2884fa`). Every pair in this folder (`<id>-<theme>.jpg`) was overwritten with this shot, replacing every earlier round's. Spec side: **reused** — the board `.design/ui/v2/11 Projects and Navigation.tsx` has not changed since the stage-A shot (`git log` on it is empty after 2026-10-21), so the stage-A spec PNGs were reused. Full-size pairs: `full-size-path.txt` (the "final (D2)" line). No product code touched; no verdicts here (the critic judges).

Harness: the committed `_d-harness-g4` scripts repointed to this worktree, plus `_d2-harness-g4/` (new scripts below). Playwright Chromium 1440x860, `window.__TAURI__` stub unless noted, throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`.

| id | dark · light | note |
|---|---|---|
| pn-tab-b, pn-tab-b20, pn-switch-ai-strip, pn-relaunch-strip | re-shot | the real `apps/desktop/src/strip.html` fed a stubbed `tabs_state`; native window chrome absent by construction |
| pn-switch-ai | re-shot | ⌘K › Keyboard shortcuts (`s11d`) |
| pn-relaunch | re-shot | stubbed `take_tabs_restored {count: 20}`; `s11r2` waits for the "20 tabs reopened" toast to be visible before the shot (a fixed sleep missed it under load) |
| pn-home, pn-home-search | re-shot | project-less `--home` server, 5-project seeded machine index (`home11`) |
| pn-ds, pn-ds-search | re-shot | scratch copy of this tree's `.design` (system + ui, refreshed); `s11ds` waits for "Loading canvases…" to go |
| pn-organise, pn-move, pn-trash, pn-jump | re-shot | real panel interactions (`s11`); pn-jump retaken in `s11r` (first frame caught "server isn't responding" under load) |
| pn-k-across | re-shot | `s11k`: fresh boot on Uniformy-2027, ⌘K "mobil" with stubbed `index_search` (the `s11` frame came after the trash step and carried its toast) |
| pn-k-close | re-shot | `s11e`: "unifromy 2027" |
| pn-history, pn-compare | re-shot | `s11b`: file edited 3x, second version viewed, then Compare; waits lengthened to 6 s so the viewed version has drawn |
| pn-deeplink | re-shot | stubbed `take_pending_navigate` |
| pn-tab-a, pn-tab-a20 | unreachable | variant A not picked (decision `v2-3.7-own-tab-bar`), superseded boards |
| pn-ab | unreachable | decision board, no UI |
| pn-tab-menu, pn-windows | unreachable | native NSMenu / multi-window, not drawable in a browser |
| pn-accounts | unreachable | the account card by the faces is not built |
| pn-cant-open | unreachable | needs a moved project root / removed access in the Rust shell + hub |

Extra unpaired frames in the worktree `.scr/impl`: `strip-b20-overview-*`, `pn-home-top-*`, `pn-home-search-typed-*`, `pn-k-close-2-*`.

## After (round 7, p8-c7-g1112b)

All reachable ids re-shot dark + light on the release client of branch `p8-c7-g1112b` (the `*.jpg` pairs above are the new ones); the scripts are `_c7-harness-g1112b/` (`chain7.sh`, `chain7b.sh`). Changes to the product and the harness are in [`fix-c7-oboard.md`](fix-c7-oboard.md).

| id | state | what changed in the frame |
|---|---|---|
| pn-tab-b20, pn-relaunch-strip | re-shot | `strip-shoot.mjs`: 10 tabs at ~110 px + "10 more" (C4's strip fix) |
| pn-home | re-shot | `home11.mjs`: the slim ask bar docks as soon as the composer card is under the header; the header fades what scrolls under it |
| pn-ds, pn-ds-search | re-shot | `s11ds7.mjs`: ONE design system (copy of the v2 system + boards), the system open: the pinned row is the two-line "Design system / <name> / N canvases" card; ⌘K groups "Canvases and artboards" |
| pn-trash, pn-relaunch, pn-deeplink | re-shot | trash glyph on the trash toast, tabs glyph on the restore pill, no check/×; the link toast names the artboard ("Uniformy-2027 · Pozvánka · story") and the artboard is selected (`s11dl.mjs`) |
| pn-jump | re-shot | `s11c7.mjs`: artboard 4 selected, the list opened and scrolled to the canvas row: all 21 rows, "21" on the row, current row marked, foot "21 artboards · 21 web" |
| pn-k-close | re-shot | one list "Canvases and artboards" |
| pn-compare | re-shot | the two frames follow the theme (they were dark in light), borderless stage |
| pn-move | re-shot | `s11c7.mjs`: a canvas held over the folder club-web → the drop tag "Move here" on the folder |



## FINAL (D5, e37e7d82a) — merged tip after round 7

Every reachable id re-shot on the merged tip `feat/maude-v2` @ `e37e7d82a` (release-built client, light + dark, IMPL side only), by `_d5-harness-g4/chain1112.sh` (+ `chain11d.sh` for `pn-switch-ai`) on the Mac mini with Google Chrome (no Playwright Chromium download there): the round-7 `_c7-harness-g1112b` scenarios (`s11 s11e s11b s11dl s11r2 s11k s11c7 s11ds7`, `strip-shoot`, `home11`) plus `s11d`. Spec frames reused from stage A: `.design/ui/v2/11 Projects and Navigation.*` unchanged since 2026-10-08. No match judged here.

| artboard id | light | dark | note |
|---|---|---|---|
| pn-tab-b, pn-tab-b20 | re-shot | re-shot | the real `apps/desktop/src/strip.html` fed a stubbed `tabs_state` (`strip-shoot`); native window chrome absent by construction |
| pn-switch-ai | re-shot | re-shot | ⌘K › Keyboard shortcuts (`s11d`) |
| pn-switch-ai-strip | re-shot | re-shot | strip with working / needs-you / done |
| pn-relaunch, pn-relaunch-strip | re-shot | re-shot | |
| pn-home, pn-home-search | re-shot | re-shot | Home server mode with a seeded machine index (`home11`) |
| pn-ds, pn-ds-search | re-shot | re-shot | ONE design system, the system open (`s11ds7`, a copy of this tree's maude-v2) |
| pn-organise | re-shot | re-shot | |
| pn-move | re-shot | re-shot | canvas held over a folder, "Move here" (`s11c7`) |
| pn-trash | re-shot | re-shot | |
| pn-jump | re-shot | re-shot | artboard selected, list opened and scrolled (`s11c7`) |
| pn-k-across, pn-k-close | re-shot | re-shot | |
| pn-history, pn-compare | re-shot | re-shot | |
| pn-deeplink | re-shot | re-shot | waits for the toast; the artboard is selected (`s11dl`) |
| pn-tab-a, pn-tab-a20 | unreachable | unreachable | variant A not picked (decision `v2-3.7-own-tab-bar`), superseded boards; spec-only |
| pn-ab | unreachable | unreachable | a decision board, no UI |
| pn-tab-menu, pn-windows | unreachable | unreachable | native NSMenu / multi-window, not drawable in a browser |
| pn-accounts | unreachable | unreachable | the account card is not built (S1.21-accounts GAP) |
| pn-cant-open | unreachable | unreachable | needs a moved project root / removed access in the Rust shell + hub |

## Round 8 (p8-c8-misc2) — re-shot, light + dark (harness `_c8m2-harness-g4`, `chain-c8m2.sh`)

| artboard id | after (round 8) |
| --- | --- |
| pn-tab-b, pn-tab-b20, pn-switch-ai-strip, pn-relaunch-strip | re-shot from `strip.html`: a tab at rest keeps the board's dense padding (space-2), so the name gets ~8 characters beside the state mark; the × takes the square's place on hover, the active tab keeps its × room on the left only |
| pn-move | re-shot: the HTML5 drag events are dispatched by hand on one DataTransfer (Chrome's drag interception never delivered dragover to the panel): "Move here" on the folder, the dragged row dimmed and dashed, shot before the 600 ms spring-load opens the folder |
| pn-deeplink | re-shot after the canvas is up and the centring pan settled (D5 light caught the selection ring mid-pan; ring and artboard are aligned — not a product bug) |
