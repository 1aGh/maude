# Phase 8 C1-kit — kit primitives (stage C), done vs open

Branch `p8-c-kit` from feat/maude-v2 0f6b1242b. Stopped early on the lead's budget call: the items marked
open below are not started. Stage D (the re-shoot) was not done; one check run of the 06 harness (copied
from agent-a45b4750975bd8337, repointed) on the release client looked right for ad-left, ad-export and
ad-settings, in both themes.

## Commits

| sha | what |
|---|---|
| e188d6dc7 | StIcon gets the kit glyphs (chevron, submenu, more, history, pin, duplicate, home, trash). Assets group "›", "‹ Assets" back and Used-in "›" now point at `submenu`. |
| 9afac7da2 | Kit button; one select with the kit caret; one DS switch; checkbox off edge `--control-off`; pressed segments ringed; soft filter chip; status dot + word. |
| 7ebbaf822 | Every Advanced fold is the kit fold row. The hint shows only while closed. "kept open" pin. |
| 031659c15 | Sheets and dialogs use the kit dialog material: Export, Settings, `.gi-dialog`/`.cp-dialog`, brand/Figma sheet, quit dialog padding, Share + access card padding. |

## Done

| item | where | critic rows |
|---|---|---|
| Buttons: kit `.btn` (border 0, bg-3, radius-md, semibold, 32 px min). Disabled primary/spark/danger: bg-3 + fg-3. Ghost, sm (26), lg, icon. | `styles/3-kit-maude-v2.css` @layer components (moved out of `4-components-maude.css`) | 10/d RC2, 12/d R3, 03/d C0, disabled Invite/Import/Connect/Generate |
| Selects: every native `<select>` has appearance none, bg-3, radius-md, type-sm, 28 px, 0.5 px edge and the kit chevron `--k-caret` (per theme) | kit file @layer utilities. Old `.st-select` caret removed. | 06 R6, 07 RC3, 08 RC-1, 09 R9, 10 role/link-rule selects, 03 ai-adv-select (look only) |
| Missing `chevron` glyph (and submenu/pin/duplicate/more/history/home/trash) | `client/shell/icons.jsx` | 12 R2 |
| Segmented: pressed = bg-2 + shadow-sm + 1 px accent ring | export `.ex-seg-b`, share `.v2sh-seg*` (whole kit `.seg`), history `.vh-seg*`, diagnostics `.dg-seg*`, left panel `.lp-browse-size-b`, inspector `.st-cp-seg*` (track, no dividers) | 07/09/10/11/12/08 a11y R1, 06 ad-logs |
| Switches: one DS switch (34×20, off `--control-off`, 16 px bg-2 knob). Covers `.lp-switch` (black knob in light), `.st-switch`, `.st-cp-switch`, `.ex-switch`. | kit file; the 4 local rules are deleted | 06 R5, 09 a11y R6 |
| Checkbox/radio: unstyled native ones get the kit box (`--control-off` edge, accent check), at zero specificity. Export `.ex-box` edge is `--control-off`. | kit file, `export.css` | 09 a11y R6 |
| Soft chip: pressed "Not used" is accent-muted + accent-text, 22 px, radius-sm | `left-panel.css` | 12 ia-assets-tidy |
| Status word: 7 px dot + the word in fg-1 (`.st-pm-status[data-tone]`, `.dg-word`) | `diagnostics.css` | 06 R7 |
| Fold row `.k-adv*` on every `<AdvancedFold>`, beside the panel's own classes: 30 px, type-sm semibold fg-1, `submenu` glyph, hint only when closed, `.ad-kept` pin (`foldStore.isRemembered`) | `v2/fold/*`, kit file @layer components | 06 R2, R4; 12 ia-advanced; 10 fold hint |
| Dialog material: bg-2, radius-xl, island edge, shadow-lg, 24 px. Export 660 wide, title semibold. Settings rail bg-1 + hairline, title type-md. | export/settings/brand/quit/share/access CSS, `.gi-dialog` | 09 R2/R4, 12 R5, 06 ad-settings, 03 quit, C0 left-over |

Tests (red before the fix, green after): `p8-kit-icons` (2), `p8-kit-primitives` (18), `p8-kit-fold` (4).
`v2-fold.test.tsx`: the class pins now expect the kit class first. This is an approved delta.

## Open (not started; for the next spawn or the owning area)

- **Toasts = the one-line kit pill** (`notifications.tsx`, NOTICE_CSS + NoticeCard). Plan: island pill with min-height 40, a kind icon, the text and an inline ghost action in accent-text. Keep a quiet trailing × (the desktop e2e helper `chrome.ts:157` clicks it). Add `placement: 'top'` per notice; sonner supports a per-toast `position`. Use it for restart/relaunch, back-online and deep-link events (`shell-events.js`, `back-online.jsx`, `open-link.js`).
- **`.ad-row` rows inside folds:** add the kit `.ad-row/-k/-v` and change Copy to a 24 px `duplicate` icon-btn. Targets: `left-panel.css` lp-adv-row, `diagnostics.css` rows, `code.css` error card, `share.css` stacked rows, `.lp-dt-av`.
- **Dialog/menu ARIA:** `access-card.jsx` needs aria-modal, focus to Back to Home, and an inert shell. Also needed: `faces.jsx` arrow roving, the `tile.jsx` keyboard menu, the `comments-panel.jsx` tablist arrows, and handoff radio arrows (C4).
- **Hover-only actions:** trash Restore `opacity:0` (`left-panel.css`, ~272; C8 also has it). Timeline seams need `:focus-within` (C3).
- **Text-glyph stand-ins:** "⌄"/"✓" in `people-list.jsx`/`role-menu.jsx` (C7); "▾" in `ChatPanel.jsx` and "✓" in `ai.css` (C6); the `SizePicker` chevron direction (08).
- **`--dur-fast` undefined** (`export.css`, `exports-panel.css`).
- **Stage D:** re-shoot 06/09/10/11/12 (plus 03/04/07/08 where the kit shows) with each canvas's stage-A harness. Copy the harness and repoint it with the scratch `repoint.py` approach: replace the old worktree path in lib/fx/go.
- **Characterization goldens:** `scripts/check-v1-characterization.mjs` will now differ. Fold rows gain `k-adv*` classes and the `.ad-kept` span, and folds no longer render their hint while open. This is an approved delta for the lead to regenerate.

## Not mine, seen

- `p8-b2-css-pins` "display:contents wrapper" is red on the base tree (the selector is split across lines in `3-shell-maude.css:254`). Left for the red-tests triage builder.
- The Settings "Done" button (`.v2s-close`) is extra against 06 (C10).
