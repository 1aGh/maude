# a11y-critic — 09 Export (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/09 Export.tsx` (+ `.css`, `_kit.css`) · impl frames `.claude/worktrees/agent-af625ef88bd36c798/.scr/impl/09/` · standard: WCAG 2.1 AA (no project a11y-rules skill) · opt_out_applied: n/a, a11y applies at every scope_

Method and counting are the same as `07-video-editing/critic-a11y.md`. The export sheet holds up well structurally:

- `role=dialog` with `aria-modal`, and the shared `useModalFocus` (`client/v2/shell/modal-focus.js`) traps Tab and gives focus back to the opener.
- Initial focus goes to the primary button, with a visible double ring in both themes.
- The scope, format and render radiogroups take arrow keys (`export/parts.jsx:31`, `scope-bar.jsx:19`, `sections/render-row.jsx:26`, `sections/version.jsx:115`).
- The Other… list uses `menuitemradio`.
- Every text pair measured passes: labels and meta 4.81–6.6 in both themes.

The failures are control-state contrast plus one keyboard trap in Handoff.

## Root causes (these hit several artboards)

| # | cause | spec | impl (measured) | owner | sev |
|---|---|---|---|---|---|
| R1 | A selected segment (Scope, PNG/JPG, 1×/2×, MP4/GIF, Quality, Captions, Size by, Colour profile) differs from the others only by fill plus `--shadow-sm`. | `.k-seg-b[aria-pressed=true]`: `--bg-2` + 1 px inset `--accent` (4.89 L / 3.13 D) | **1.09 L / 1.20 D**, no ring | `client/v2/export/export.css:101-105` | blocker |
| R6 | Off-state controls are edged with `--border-strong` instead of `--control-off`. The unchecked "Include annotations" box and the off switches (Registration marks …) fail 1.4.11. | DS `.switch` / checkbox edge `--control-off` (3.31 L / 3.35 D) | checkbox **2.01 L / 2.34 D**, switch **2.10 L / 2.38 D** (token 1.93 / 2.45) | `export.css:191-201` (`.ex-box`), `export/advanced/advanced.css:84-95` (`.ex-switch`) | blocker |
| R2 | Meta text (`--fg-2`) sits on the opaque v1 `--accent-muted` (07 R2/R4). Shown here as the Handoff picked-row description. | `--fg-2` on `--accent-soft` 4.91 / 5.11 | 4.81 L / **2.39 D** | `client/v2/handoff/handoff.css:28-31,43-49` | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| ex-social | L/D | R1 (Scope, PNG/JPG, Size) and R6 checkbox. There is no preview and the File name / Save to rows sit under Advanced (not a11y). | — | — | R1/R6 | (root) |
| ex-print | L/D | R1 and R6 (unchecked Annotations). The checked Bleed/Crop boxes pass. The preview never paints ("Drawing the page…"); it is a lane gap, not a11y. | — | — | R1/R6 | (root) |
| ex-web | L/D | R1 and R6. "Code for a developer? Handoff to production…" passes. | — | — | R1/R6 | (root) |
| ex-video | L/D | R1 (MP4/GIF, Quality, Captions). The cloud-vs-Mac radio cards are absent on the local lane, so they are not verified. `sections/render-row.jsx` exists, with arrow keys. | radio cards | none | `export/sections/render-row.jsx:26-60` | warning |
| ex-inspector | L/D | Lens-clean. The Export row is labelled native selects, the remove button has `aria-label`, and the shortcuts are `<kbd>`. | — | — | `export/inspector-export.jsx:100-145` | — |
| ex-formats | L/D | The Other… menu passes (search labelled, `role=menu`, `menuitemradio` + `aria-checked`, ✓ in `--accent-text`). R1 shows behind it. The "clipped at the bottom" seen in the frame is a crop of the capture: the menu has `maxHeight = room` and scrolls. | — | — | `export/other-formats.jsx:110-170` | (root) |
| ex-canvas | L/D | R1 on Scope (1.09 / 1.20). R6 checkbox. Row sublines pass (5.28 L / 5.09 D). | — | — | R1/R6 | (root) |
| ex-batch-pick | L/D | R1 and R6 (it lands on the canvas-scope sheet). "Selection —" is `aria-disabled` and passes (fg-3 4.81 D / 5.18 L). The selection not being carried is functional, not a11y. | — | — | R1/R6 | (root) |
| ex-batch | L/D | The Folder chip was not applied, so this is not verified. | — | — | — | warning |
| ex-history | L/D | Only the empty state ("No exports yet"). Row actions (again / folder / retry) are not observable; that needs finished jobs. The focus replacement on `.ex-job:focus` exists. | job rows | empty | `export/exports-panel.css:66-74` | warning |
| ex-share-vs | L/D | The Share button opened the Move-to-cloud sheet (the fixture has no people), so the comparison isn't reached. | — | — | — | warning |
| ex-handoff | L/D | **The targets can't be reached by keyboard.** The `role=radio` rows use roving `tabIndex` (only the picked one is 0) but handle only Space. No Arrow handler exists, so App / Lottie can't be reached without a pointer. | radio cards | pointer-only | `client/v2/handoff/handoff-sheet.jsx:245-268` | blocker |
| ex-handoff | L/D | R2 on the picked description (D 2.39). Focus lands on the dialog root, so a 2 px ring wraps the whole sheet instead of sitting on the picked target. "Needs a design system" is 2.69 L / 3.11 D (an exempt disabled row, but it is the only explanation). The radio glyph is gone, so selection shows as fill + inset ring only. | radio circles, focus on pick | — | `handoff-sheet.jsx:86`, `handoff.css:20-33` | warning |
| ex-handoff-edges | L/D | Only the signed-out "Connect your Claude account?" variant. The offline and review-blocker variants are not reached. | 3 variants | 1 | `client/v2/handoff/edges.jsx` | warning |
| ex-offline | L/D | Browser-level offline does not trip the app's detection, so there is no "cloud waits" banner. Not verified. | banner | none | — | warning |
| ex-huge | L/D | R1 and R6. The big-export notice and the ZIP hint pass (dark 9+). | — | — | R1/R6 | (root) |
| ex-print-warn | L/D | **The preflight warnings are missing from the sheet.** The 1 px bleed overflow is reported on the label and in the inspector but not in the sheet. The sheet's "Show on canvas" warning rows are the only place a keyboard or screen-reader user meets them before exporting. | warning rows + Show on canvas | none | `client/v2/export/preflight/` | blocker |
| ex-advanced | L/D | R6 (Registration marks off 2.10 / 2.38) and R1 (Size by, Colour profile). The sheet is taller than the window, so the footer starts below the fold; it scrolls (`.ex-sheet` `overflow:auto`). `--dur-fast` is undefined, so 120 ms transitions are not collapsed under reduced motion. | — | — | `export.css:24,96`; `exports-panel.css:143` | warning |

## Unreachable (spec-only)

| id | what makes it reachable | sev |
|---|---|---|
| ex-progress | A running cloud or this-Mac export job (Exports ring + rows). The e2e browser lane runs none. | blocker |
| ex-states | Finished, partly-done and failed jobs (Show in Finder / Retry toasts) | blocker |
| ex-handoff-ready | A finished signed-in AI handoff run (claude is stubbed signed-out) | blocker |
| ex-edges | A viewer-role session, plus a live AI edit on the artboard. The version radios (`sections/version.jsx`) exist and take arrow keys. | blocker |

## Verdict

```json
{"canvas":"09 Export","critic":"a11y-critic","blockers":9,"warnings":8,"verified_ids":["ex-inspector·light","ex-inspector·dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```
