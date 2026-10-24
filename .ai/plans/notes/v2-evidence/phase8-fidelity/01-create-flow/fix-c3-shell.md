# fix-c3-shell — phase 8 stage C round 3, shell islands (branch p8-c3-shell)

Scope: the Undo · Redo · zoom % island, the Canvases (left) panel as a content-height island, Version history as an island, the panel handle chip, the pinned layout. Shared by canvases 01, 02, 05, 06 (ad-history, ad-pinned), 10, 11 (pn-history, pn-compare, pn-jump), 14.

## Done

| what | where | board |
|---|---|---|
| **Undo · Redo · zoom % island, bottom left.** The shell draws it (`ZoomUndo`): Edit = Undo, Redo, hairline, `76%`; Viewing = the percentage alone (`co-zoom-only`); Preview keeps its `ZoomOnly` readout, Present none (the `toolbar` row of the mode table decides). Undo / Redo run `edit.undo` / `edit.redo` (the ⌘Z stack: AI, timeline, moves); the percentage fits (`view.zoom-fit`). No pref: it is not the View › Zoom controls toggle. | `client/v2/undo/zoom-undo.jsx`, `preview/preview-chrome-host.jsx` (`ShellPreviewChrome` mounts it), `preview/preview.css`, `shell/icons.jsx` (`undo`, `redo` glyphs) | 01 cf-blank etc. `ZoomUndo` / `.k-uz` |
| The canvas' own fit / 1:1 pill (View › Zoom controls, off by default) stacks above the island instead of under it. | `canvas-lib.tsx` `.dc-zoom-tb` bottom 64 px | — |
| **Canvases panel and Version history hug their rows** (content-height island, scrolls only past the window; also with a chat docked under it). | `v2/shell/floating-panels.css` (`:has(> .st-sidebar)`, `:has(> .vh-panel)`) | 01 `k-cp`, 11 `pn-vh`, 06 `ad-vh` |
| A canvas row has no twisty at rest; it shows on hover / focus / while open. | `v2/canvases/canvases.css` `.cv-jt` | 11 `PRow` (`expand` only on an open row) |
| The kind chips come once a project mixes kinds (two or more of fixed / web / print / video) and stay while a filter is on. | `canvases-panel.jsx` `kindsMixed` | 01 / 02 / 05 / 11 draw none, 08 draws them for a mixed project |
| **Panel handle chip** "Drag · double-click resets · ← → move 8" beside the handle while it is held or focused, with the 6 × 32 accent pill on the seam. | `shell/dock.jsx` `PanelGrip`, `floating-panels.css` | 06 `ad-handle-tip`, `ad-handle--on` |
| **Pinned layout.** The bottom-left island starts after a pinned Canvases column; a folded panel's corner icon stands beside a pinned column instead of over its header (a11y V4). | `preview.css`, `floating-panels.css` | 06 ad-pinned |
| B on the Now row takes the dot's place instead of sitting over the dot and the word. | `v2/history/history-panel.jsx`, `history.css` | 11 pn-compare |

Tests (fail-first, red proven by reverting the code and watching them go red): `test/p8-c3-zoom-undo.test.tsx`, `test/p8-c3-shell-islands.test.tsx`, the Now/B assertion in `test/v2-compare-view.test.tsx`, the chips rule in `test/kind-filter.test.tsx`.

## Open (and why)

- **Header row `+` / New folder** (the tall row under the tabs). The board has none: a "+ New canvas" row ends the list. Not moved: `aria-label="New blank brief board"` is a selector for `new-canvas.js` (`openBriefBoardComposer`) and six e2e specs (cloud-entry, selfhost-entry, surface, file-tree-move via `tree-new-folder`), so a move needs those specs and the label rewritten together. Needs the lead's call.
- **Project switcher foot** (`RepoBranchSwitcher`, "e2e-fixture ⌃"): the board has none (the project pill is the switch), but `repo-switcher-trigger` drives git-switch-repos, team-project, project-tabs, cloud-attach e2e. Same call.
- **Foot line** "N canvases · ⌘K searches every project" at rest: the board draws a foot only in states; the text is pinned by 05 es-search-panel and eight unit tests. Kept.
- **History width**: 372 (11 `pn-vh`) kept; 06 `ad-vh` draws 340, 400 with the Advanced fold open. The two boards disagree and the slot width is app.jsx's (`rpW`), not a panel's.
- **pn-compare** stage (two framed panes, 660 px change island, "changed in between" without an author), version titles (machine change-lines), the fold hint ("Branch, git, changed files" is 06's own copy; 11 draws "branch, version ids"): not touched, the compare view is its own task.
- **Search well** copy ("Search canvases…" / `/`): board says "Search" / ⌘K; ⌘K opens the project-wide palette, so a ⌘K hint on this field would lie. Kept.
