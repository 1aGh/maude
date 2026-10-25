# Phase 8 stage C round 8 — 13 Design system (branch p8-c8-ds)

Nothing below is marked matched; the lead's critic judges. Checklist: the MUST rows of `critic-bar3.md`. Re-shot (impl, light + dark) with `_c8ds-harness-g5/` (the D5 harness plus an overlay of `s13.mjs`), on the Mac mini.

## Done (product)

| what | ids | proof (red → green) |
|---|---|---|
| **Logo row paints the lockup from the system's own colours** and the lockup also sits on the ink ground (the board's dark lockup tile). An `<img>` SVG cannot read `var(--accent)` / `currentColor` — the wordmark came out as a bare black word (a white one on a dark ground in Dark, an empty tile in Light). `logo-paint.ts` writes the system's values for the mode shown into the file text (follows `var()` chains and fallbacks), inks `currentColor` with `--fg-0` (`--spark` for the spark), draws the lockup on the page, again on the ink ground, then the marks as square tiles. | ds-board-studio / -dark / -gator | `p8-c8-ds-logo-ground.test.ts` (new; red when the ink ground is dropped) |
| **A fill's contrast line is judged on the page**: "5.6:1 on white · 4.8:1 on the dark page" for `--accent` and `--status-*` fills (their own-text pair already passed above it); the old line read "on white · on white" (white text in both modes). | ds-edit-colour, ds-edit-reach, ds-edge-contrast | `p8-c7-ds3-contrast-words.test.ts` (accent case rewritten, red before) |
| **Reach view**: the system's own **Patterns strip leads** (a live frame of the Design system canvas at its `ds-patterns` artboard, tagged "N patterns · M places"), the canvases follow two across (frame 480 × 300); the **token card draws the colour as Light \| Dark halves** (`swatch.afterDark`); the **review rows wear their canvas picture** (same covers as the review sheet); the review waits only for the frames that have rings. | ds-edit-reach | `v2-ds-reach-view.test.tsx` (+4 tests; red with the board frame off) |
| **Off-system question is the board's chat card**, docked bottom right (canvas name in the header, the closest colour bold, "Add it to the system" · "Use Accent" with Use last, "Not now" as the card's ⌄); the toolbar is clear. | ds-edge-suggest | `v2-ds-edges.test.tsx` (+1; red with the card centred) |
| **"Preview in…" menu hangs beside the Design systems row** it was opened from (not under the banner); its keys line is screen-reader only (the board draws the list and the doors); `.dsp` no longer carries a transform (it would have become the containing block of the anchored menu). | ds-many-switch | `v2-ds-switch-sheet.test.tsx` (+1; red on the transform) |

## Harness (not product)

- `_c8ds-harness-g5/scr/s13.mjs` (overlay over `_d5-harness-g5`): the pending Accent edit's Dark value passes the text pair (`oklch(0.52 0.18 255)`), so the reach card and the review show the pass line, not "3.6:1 on Accent fg in Dark" (ds-edit-colour-pending, ds-edit-reach, ds-edit-review); ds-many-switch closes the (empty) inspector and keeps the Canvases panel open; ds-edit-instance opens the Canvases panel again after the inspector folded it, so the update dot on the left-out row is on screen.
- ds-edge-trash buttons were fixed on feat (portalToBody) — re-shot only.

## Open (by priority)

1. **Reach Patterns frame has no rings and no own place count** — the usage index scans canvases, not the generated board's own `ds-patterns` artboard; the strip is a live frame of it and the tag is the whole view's ("N patterns · M places").
2. Reach canvases are drawn in the canvas's own artboard chrome (dark bezel around the web artboard in the embed), not the board's plain cards; review sub-lines "N places — buttons, links, cards" and the left-out row need element kinds from the usage index (fixture rows read "Follows the system" / "1 place").
3. ds-many-switch: the preview restyles nothing in the fixture (same tokens), so the canvases look unchanged; no selection (the board draws no inspector).
4. Chat card: the board draws the full chat panel (composer chip "Badge", "Ask AI…"); the card is the question only.
5. Per the earlier list: Preview in… stays in the menu (decision), hero outside the Brand frame, Advanced at 250 px.
