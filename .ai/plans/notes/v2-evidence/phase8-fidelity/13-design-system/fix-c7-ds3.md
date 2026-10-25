# Phase 8 stage C round 7, third pass — 13 Design system (branch p8-c7-ds3)

Nothing below is marked matched; the lead's critic judges. Re-shot (impl, light + dark) with `.scr/chain-c7ds3.sh` (`_c7ds3-harness-g5/`).

## Done (product)

| what | ids | proof (red → green) |
|---|---|---|
| **Contrast line in the board's words.** Pass: "5.6:1 on white · 4.8:1 on the dark page" (one ratio per mode, the surface it was judged on: near-white reads white, the page in Dark reads the dark page, else the token's name). Fail: "3.1:1 on A and B" — the two worst surfaces of the mode being edited; " in Dark" only when the OTHER mode is what falls short (`contrastLine(model, css, edited, editing)`). | ds-edit-colour, ds-edge-contrast, ds-edit-reach | `p8-c7-ds3-contrast-words.test.ts` (new; red on the missing export, and on the mode-being-edited rule when reverted), `v2-ds-token-kind`, `v2-ds-edges` |
| **Role row** above a contrast warning ("Text on surfaces — hints", "Fill behind accent text"; `roleWords`, read from the pairs rule). | ds-edge-contrast | `v2-ds-edges.test.tsx` |
| **Token inspector row order per the board**: the row of the mode being edited, the picker under it, the other mode last. | ds-edit-colour, ds-edge-contrast | `v2-ds-token-kind.test.tsx` |
| **Selection ring** on a swatch / master: 2 px, 4 px clear of it (`canvas-shell.tsx` HALO_CSS `[data-ring]`; shared file, own commit). | ds-edit-colour, ds-edge-contrast | `p8-c7-ds3-swatch-ring.test.ts` (source pin) |
| **Reach view**: header "Accent went from Azure to Deeper azure on the Design system canvas. “Used in N canvases › Show” draws where it goes …", key line "Colour › Accent", the change in words, the inspector's contrast line, bottom note with the board's title. | ds-edit-reach | `v2-ds-reach-view.test.tsx` |
| **Advanced**: the fold is open, "Used by · Studio site · N canvases" (project from the shell's scope), the check card closes the column after the history (board order), the tokens view starts at `:root` (a long file header is one line, `abbreviateCss`). | ds-advanced | `v2-ds-advanced.test.tsx`, `ds-check-system.test.ts` |
| New testids: `ds-reach-key`, `ds-reach-contrast`, `ds-token-role` (TESTIDS.md + testids.json). | | |

## Harness (not product)

- **ds-multi-migrate / ds-edge-migrate were harness gaps**: the product's convert sheet (`convert-dialog.jsx`, 3-folder list and one-folder section map) was never opened. Group `g`: three old folders (two followed by a canvas, one used by none → draft), group `k`: a single unconverted folder; both open the sheet through the `maude:ds-convert` event.
- ds-edge-contrast edits **Fg 1** ("Used in 2 canvases") in Dark — the old Fg 2 is used by no canvas, so "Falls short in N canvases · Show" could not draw.
- ds-advanced: viewport 1440×1500 so the whole column shows, Check the system is run.
- ds-edit-reach: waits 9 s for the canvases' frames.

## Open (by priority)

1. **Reach view: the system's own Patterns frame** (board: "Patterns — on the Design system canvas · 4 patterns · 21 places" first, then the canvases) — needs the usage index to count the board's own artboards; the view draws canvases only.
2. **Reach token card**: the Light | Dark halves on the chip (board) — the card draws two plain chips.
3. **Pass line surface words** ("on the dark page") — only `--bg-0` partners read that; a token whose pair is its own text (Accent ↔ Accent fg) reads "on white · on white" (both modes' text is white). The board's wording belongs to an Accent-on-page reading the pairs rule does not have.
4. **Advanced**: the inspector is 250 px wide, so the file tree / code wrap where the board's 420 px column does not; version history has the fixture's one row.
5. Per the earlier list: Preview in… in the multi-system menu (lead call), hero outside the Brand frame, review sub-lines.
