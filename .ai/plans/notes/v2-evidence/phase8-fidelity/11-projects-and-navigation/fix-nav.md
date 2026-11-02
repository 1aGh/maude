# C8-projects-nav — fix report (branch p8-c-nav, stopped early on the lead's budget call)

Stage D (re-shoots) was skipped by order. No artboard is marked fixed; nothing below was re-shot.

## Done (commit "C8 nav: Home …", tests `apps/studio/test/p8-c-nav-home.test.tsx`, red -> green)

| item | source critic | state |
|---|---|---|
| Home first run quiet: no "Recent canvases" empty line, no empty projects shelf under the sign-in card (Recent renders only with canvases or an active filter; `ProjectsEmpty` hidden while the card shows) | 02 R5 · 05 es-home-cloud | fixed |
| Home pill is a real menu button ("Home ⌄", `ProjectPill` with its own tree `home/home-menu.js`): File › New canvas / New project… / Open project…, Help › What's new (with "N new") | 02 R7 · ob-edge-whats-new | fixed |
| What's new from the menu reads the feed even when all is seen (`useWhatsNewLine().recent`) | same | fixed |
| Create-local sheet traps Tab / esc via `useModalFocus` | 02 a11y RO2 | fixed for CreateLocalSheet only |
| Sign-in card 600 wide (`.home-below` stretches) + `.btn--lg` (40 px, type-base, radius-lg) in Home CSS | 02 R2 R3 | fixed (CSS-rule pins, not rendered) |
| `.st-pill.island` positioned in the header row on Home | — | fixed (CSS) |

Stale test updated: `home-ask-send.test.tsx` "not signed in … opening a folder" asserted the empty shelf under the card; it now asserts the card alone and reaches Open project… through the pill menu (decision below).

Shared-file touches (small, separate hunks): `client/v2/shell/project-pill.jsx` (optional `tree` prop), `client/v2/signin/use-whats-new-line.js` (`recent`).

## Still open (not started, in order of the brief)

Home (11 pn-home / pn-home-search): docked ask row at the header's height (the existing `.home-askbar-wrap` is `position: sticky` inside `.home-ask`, so it scrolls away — make it `position: fixed; top: var(--space-4)`); search = icon + ⌘K island; centred 620 px ⌘K palette over a veil (Recent searches / Open tabs / Recent canvases, Ask AI row, ↑↓ ↵ foot, placeholder "Search canvases, artboards, actions, or ask AI…"); Recent cap at 6 columns + "See all"; Projects "Find a project" + "Recent ▾" sort; trailing project square on rows; "15 more" foot; Pinned aside copy "pin any canvas from its row or its menu"; account tones as one function (home-model.js / account-card-model.js / tabs.rs: Work = sky, Personal = yellow); Home sheets other than Create (InviteSheet, WhatsNewDialog, connect modal) still without the trap; Home dot grid and 880 column are board-vs-board (11 wins: fix boards 01/02/05).

Panel/⌘K/history/strip (nothing started): "not on this Mac" rows dim only the thumbnail (`canvases.css:154`); dark `<mark>` contrast >= 4.5 (`canvases.css:622`, Home `.home-pal-ltxt mark`); trash headings sentence case + Restore visible + thumbnail (`left-panel.css:264-280`, `trash-view.jsx`); jump rows 22 px (`tree-model.js:23`, `canvases.css:601`); ⌘K rows (esc hint `command-palette.jsx:444`, selected semibold, 36 px rows, close-match note box, artboard kind icon, `system` glyph for DS rows, close-match copy); history island 372 + Now-row CSS clash (`history.css:83-140`) + A/B circle marks + chips/thumbnails + human version titles (`history/describe.ts:669`, `titles.ts:247`) + fold hint (`git-model.js:25`); keys sheet group order + opaque sticky foot; strip: pill tabs / separators / spark disc / chevron "N more" / resting-name contrast / done-dot contrast (`apps/desktop/src/strip.html`, `strip.js`); deep-link arrival toast; toasts (RC-2) and segmented pressed ring belong to C1-kit.

## Decisions
- `decision:maude/v2-8.5-c8-home-pill-own-tree` — Home reuses `ProjectPill` with a Home-only tree instead of PROJECT_MENU (rows Home cannot run would be dead ends); rejected: a second hand-built pill, or the full project menu on Home.
- `decision:maude/v2-8.5-c8-first-run-card-alone` — while the sign-in card shows, no empty shelves under it; 02 ob-first-launch (card alone) wins over 05 es-home-local's shelf in that state; Open project… stays reachable through the pill menu.

## Round 2 (p8-c2-navcreate)
Most of the OPEN list above is done in round 2 — see `fix-navcreate.md` (Home palette/ask row/See all/Find a project, account tone, strip, jump rows, trash, history Now row + A/B, ⌘K rows, deep-link toast). What is still open is listed there.
