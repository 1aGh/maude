# C4 nav + panels (11, and the 12 foot) — fix report, stage C round 4 (branch p8-c4-navpanels)

Lead call `v2-p8-lead-canvases-header-and-switcher` is in; the 11 rows below are the ones the stage-D re-check named.

## Done

| area | item | where |
|---|---|---|
| Canvases panel (11 pn-organise, all panel shots) | the header "+" / folder pair is gone; the board's "+ New canvas" row ends the list (kit `.k-cp-new`), Trash and the foot ride the panel's bottom (the list is as tall as its rows). Hooks moved with the control: `aria-label="New blank brief board"` is the row's button, `tree-new-folder` the quiet folder button at the row's end (always drawn, fg-3 until hover/focus — a hidden button is invisible to keys and WebDriver) | `v2/left-panel/canvases-pinned.jsx` `NewCanvasRow`, `tree/tree.jsx`, `left-panel.css`, `canvases.css` |
| project switcher (every shot with the panel foot) | the dock at the panel foot is gone; the project pill IS the switcher: a "Switch project" submenu after Home (recents with the current one ticked, Open a team project…, Open another folder…). `repo-switcher-trigger` is the pill's wrapper, `repo-switcher-popup` the submenu, `switcher-open-team` / `switcher-open-folder` its rows. "Opening X…" / a failed switch is a quiet line under the pill | `panels/RepoBranchSwitcher.jsx` (`useProjectSwitcher`, `switcherNode`), `v2/shell/project-pill.jsx` + `.css`, `app.jsx` (one hook + one prop) |
| e2e + manifests | `team-project`, `cloud-attach` open the switcher through `helpers/switcher.ts` (pill → Switch project); the other specs only need the trigger to be displayed (readiness) and are unchanged; `scripts/v2-manifest/openers.mjs` clicks the same two steps; TESTIDS.md + testids.json | `apps/desktop/e2e/**`, `scripts/v2-manifest/openers.mjs`, `client/TESTIDS.md`, `client/testids.json` |
| tab strip (pn-tab-b, -b20, switch-ai-strip, relaunch-strip) | "0 more" chip: `.more[hidden]{display:none}` (the chip's display beat the UA hidden rule); resting names keep the tabs' tone (the ring says resting — the 3.6-4.1:1 dim colour is gone); done mark = `--status-success-text`, working spark = `--spark-text` (gen-tokens STRIP_NAMES grew); the tab list says "<account> · cloud" / "On this Mac" (board `where`) | `apps/desktop/src/strip.html` + `strip.js`, `scripts/gen-tokens.mjs` |
| ⌘K (pn-k-close, pn-k-across) | the close-match note quotes the mistyped word and the lower-case word it stands for ("Nothing called “unifromy”. Showing close matches for uniformy."); the hidden tools next to canvases are "Tools and settings · not on screen" ("… · not on screen, found by search" across projects); a tools-only search keeps 06's "Actions · N hidden tools" | `v2/search/search-model.js` (`closeTyped`), `search-projects.js`, `dialogs/command-palette.jsx` |
| Home (pn-home) | the slim ask bar docks once the question is under the sticky header (the observer's root stops at the header's lower edge); the account holding the most recently used project leads (Work before Personal); the Projects foot is "N more" (opens the rest) + Open project…; the "New project…" row is gone (File › New project… ⇧⌘N) | `home/HomeAsk.jsx`, `home/home-model.js` (`capProjectGroups`), `home/home-app.jsx` |
| 12 ia-assets-tidy | the foot's "Move N to the trash…" wraps under the numbers instead of running past the panel edge | `left-panel.css` |

## Tests (fail-first)
`p8-c4-project-switcher.test.tsx` (pill = switcher), `v2-left-panel-render.test.tsx` (header has no buttons; new row; viewer gets none), `desktop-strip.test.ts` (4 new), `p8-c4-search-copy.test.ts` + `v2-search-close.test.ts`/`v2-search-ui.test.tsx` (words), `p8-c4-home-model.test.ts` + `home-page.test.tsx` (order, "N more", docked bar), `p8-c4-css-pins.test.ts`. The search words were reverted once (red 3, restored, tree checked).

## Open (not done this round)
- 11 pn-history / pn-compare: version titles are machine change lines (`history/describe.ts:669`, `titles.ts:247`) — a human title needs the AI-describe data source, not a rewording; fold hint stays "Branch, git, changed files" (board 06 ad-history draws exactly that; board 11 draws "branch main · a41f9c2" — two boards disagree, ruling needed); version pictures are empty squares (render data); compare stage layout (two framed panes vs the canvas with A/B labels + 660 px island); the "B" mark over the Now row.
- 11 keys sheet (pn-switch-ai): the full 3-column sheet vs the board's two-group sheet (06 ad-search draws the full sheet — ruling needed).
- 11 DS pinned rows card + ⌘K DS results ("used by N projects" needs project-use data); Home What's-new pill; Pinned / Shared not shootable signed-out.
- 12 photo inspector (Image / Photo tab pair, Placement Fill/Fit/Crop seg, crop step), placed photos selected as a group, Browse keeps the tab row, Advanced mono wrap + the "kept open" chip (06 draws that chip — board conflict), Tidy two-row cap (hides what "Move N" would trash — needs a ruling).

## Decisions
- `decision:maude/v2-p8-c4-pill-is-the-switcher` — "Switch project" is a submenu of the project pill's menu, built in the pill from `useProjectSwitcher()` (not a registry action: the rows are data — recents — and the registry/menu tree are shared files); `repo-switcher-trigger` is the pill wrapper. Rejected: registry actions per recent project; leaving the dock mounted but hidden.
- `decision:maude/v2-p8-c4-new-row-keeps-hooks` — the new row keeps `aria-label="New blank brief board"` and `tree-new-folder` verbatim (lead call), so e2e selectors survive; the folder button is always drawn, quiet.
- `decision:maude/v2-p8-c4-tools-group-by-company` — hidden tools are "Tools and settings" only when canvases/artboards matched too (board 11); a tools-only search keeps board 06's "Actions · N hidden tools".
- `decision:maude/v2-p8-c4-home-groups-by-recency` — Home account groups order by the most recently used project, not the shell's list order.
