# Wave-A gate: a11y re-check (B1-B4, W1, W3, W6, W7)

Branch feat/maude-v2 @ d739596d4, committed dist/client.bundle.js as is. Scratch project (rig fixture copy, `_sync.json` and `_state` stripped),
studio on :4481 with `MAUDE_CANVAS_ORIGIN_SPLIT=0`, S5 mock ACP agent for the chat. Playwright Chromium 1600x1000, `window.__TAURI__` stub,
axe-core 4.13.0 (wcag2a/aa/21a/21aa/best-practice, `region` off), dark and light (theme forced through the `/_api/ui-prefs` response).
Contrast = measured computed colour composited over the opaque background chain. Screenshots: `./a11y-recheck/`.

| Item | Verdict | Evidence |
| --- | --- | --- |
| B1 tree child | FIXED | `[data-testid=canvas-list]` (`role=tree`) now has a single child (`.cv-spacer`); `canvases-sort` is not inside it (`.cv-sort-lane` sibling, canvases-panel.jsx:523-538). axe on the Edit shell: 0 violations dark and light (was `aria-required-children`, critical). |
| B2 `--fg-3` text | FIXED | Tokens now dark `oklch(0.65 0.01 250)` = #8b9095, light `oklch(0.52 0.012 260)` = #656970. `canvases-foot`: 5.64:1 dark, 5.51:1 light. `ai-suggest-why` (finished mock run): 5.64 / 5.51. `--fg-3` vs `--bg-0..3` dark 5.97 / 5.64 / 5.21 / 4.67, light 5.14 / 5.51 / 5.32 / 4.83. axe on the AI chat after a run: 0, both themes. |
| B3 inspector "None" | FIXED | `.insp-row[data-dim=true] .insp-row-v { color: var(--fg-1) }` (sections.css:15), computed row opacity 1. Measured: `insp-chip-fill` 4.85 dark / 5.05 light, `insp-border-none` 5.86 / 5.77, `insp-chip-ab-background` 4.85 dark, "Inherited" chips 4.85 / 5.05. axe on the inspector: 0 both themes. Was 2.61 / 2.90 dark, 2.33 light. |
| B4 palette selected meta | FIXED | `[role=option][aria-selected=true] .st-pal-meta` ("ui"): 6.82:1 dark, 7.47:1 light (was 4.24). search.css:86. axe on the open palette: 0 both themes. |
| W1 vote-sheet focus trap | FIXED | Focus lands in the first input; 14 Tab presses cycle title / per-voter / duration / Cancel / Start / back to first input and stay inside `vote-sheet`; Shift+Tab wraps the same way (vote-sheet.jsx:52 `trapTab`). |
| W3 focus return | FIXED (keyboard path) | Focus `canvases-sort` -> Cmd+K -> type -> Enter on "Start a vote" -> Esc: focus returns to `canvases-sort`. When the palette row is picked with the mouse the opener is the canvas frame, so focus lands on `iframe[canvas-frame]` (pointer opener, acceptable). Cancel/Start use the same cleanup (vote-sheet.jsx:36-43). |
| W6 composer name | FIXED | `textarea[name=input]` has `aria-label="Message to AI"` plus the placeholder (Composer.jsx:374). |
| W7 canvas context menu | FIXED | In the canvas iframe `role=menu` has `aria-label="Object actions"` (15 items) on an element and `"Artboard actions"` (9 items) on the artboard chrome (context-menu.tsx:433). axe in the iframe with the menu open: 0. |

Not in the 8 items, still present: W2 `aria-allowed-role` (minor), `<form class="an-vsheet" role="dialog">` (vote-sheet.jsx:99-102). axe still reports it on the vote sheet.
Caveat: `--fg-3` on `--bg-4` is 4.08 dark / 4.45 light, below 4.5 for small text. No such site was found in the scanned surfaces; keep `--fg-3` text off `--bg-4`.

Result: 8 of 8 FIXED. 0 blockers open from the original list.
Environment: the scratch server was stopped. Unrelated working-tree changes under `apps/desktop/e2e/` (package.json, wdio.conf.ts, fixtures/project/.design/ui/Smoke.*) are not from this check (the scratch project lives in the session scratchpad).
