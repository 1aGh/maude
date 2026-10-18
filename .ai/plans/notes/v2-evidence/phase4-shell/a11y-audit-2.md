# a11y re-audit — Phase 4 gate (iterations 2–4), 2026-10-18

Auditor: flow:a11y-auditor (Sonnet), agent-browser + axe 4.12 + own computed-contrast pass, both themes, 1440×900,
scratch copy of the e2e fixture, browser shell. Evidence: `a11y-2/` (iteration 2, 55 PNGs + axe-json, 37 scans),
`a11y-3/` (iterations 3–4). The auditor returned its reports inline; this file is the lead's summary of them.

| # | iteration-1 blocker | verdict |
|---|---|---|
| B1 | ⌘K combobox/listbox | fixed (combobox + aria-activedescendant, listbox/option, groups, status count) |
| B2 | modal focus + palette Esc | fixed (Tab contained in palette and "?", Esc from input and rows, focus returns to opener) |
| B3 | Settings tablist children | fixed (`.v2s-tabs` holds only the 3 tabs, roving, axe clean) |
| B4 | label-in-name (pill, Done) | fixed ("e2e-fixture / Smoke, project menu"; "Done") |
| B5 | seven "Panel side" groups | fixed (7 unique names via aria-labelledby) |
| B6 | contrast | iteration 2: 3 residuals R1–R3 → fixed f1607c3e + 4c925e4c (lowest 6.33 dark, 5.05 light) |
| B7 | callout over Diagnostics tabs | fixed (`.dg-sheet` above `.st-callouts`) |
| B8 | single-key shortcuts | fixed (Settings › General › Keyboard switch; off silences "/", "?", canvas H) |

**Final: 0 blockers.** Controls kept dim as intended (done step titles, disabled rows).

Warnings carried (13): no `<main>`/h1/skip link; Settings and "?" start at h3; Layers treeitems all tabindex=0,
no aria-level; Settings Left/Right radios 14 tab stops; Assets image-redundant-alt; Diagnostics info rows as
menuitem; palette "31 results" vs 13 rendered (per-group cap 8); Present exit focus goes to the canvas and its label
differs from the visible text; three "Show panels" buttons when panels are hidden; inactive Settings notes 2.52:1
(opacity .6, empty shell); ⌘, does nothing with focus in the canvas iframe; callout buttons stay focusable under the
Diagnostics sheet; tab order noise (callout before the pill, 2 stops per tree row).

Harness note: the "renderer CPU runaway" the auditor saw was agent-browser's own `press` (it pegs Chrome even on a
static data: page); a Playwright/CDP re-measure put the shell at 0.7–2.5 % in every state.
