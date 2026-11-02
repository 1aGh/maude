# a11y-critic — 06 Advanced (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/06 Advanced.tsx` (+ `.css`) · impl frames `.claude/worktrees/agent-a45b4750975bd8337/.scr/impl-out/06-advanced/` · standard: WCAG 2.1 AA (no project a11y-rules skill, so the WCAG defaults apply) · opt_out_applied: n/a — a11y enforces at every scope_

**How this was measured.** Same method as 03 and 04. Contrast comes from impl JPEG pixels at 1440×900: the modal background against the 99.5th-percentile luminance outlier. It is cross-checked against the oklch token maths, and a value within 0.5 of a threshold is a near pass. Spec dark is the host re-theme. Every frame shows a fold OPEN (C1), so closed-vs-open pairs are judged on the open half. Local-project variants (C2) and fake-agent gaps (H) are not findings.

**Folds themselves pass.** Every Advanced fold is a button with `aria-expanded` + `aria-controls` (`client/v2/fold/advanced-fold.jsx:58-60`) and a `:focus-visible` ring (`fold.css:31`).

**Severity counting.** Each root cause counts once. Each artboard-specific row and each unreachable state also counts once.

## Root causes

| # | cause | spec | impl (measured / code) | owner | sev |
|---|---|---|---|---|---|
| V1 | Segmented controls and tabs show the chosen item by a fill (sometimes plus a text-colour step) far below 3:1. Instances: the Inspector segments (`.st-cp-segbtn.is-active`, ad-inspector: Resizing "Height", Align, Case "As typed"); the Logs source filter "All" (`.dg-seg-b[aria-pressed]`, ad-logs); the selected Diagnostics tab (`.dg-tab[aria-selected]`, ad-diag / ad-logs); the Version history filter (`.vh-seg-b`, ad-history); and the Export scope / size / profile segments (ad-export, the same as 07 R1). | kit chosen segment: `--bg-2` + inset 1 px `--accent` (`styles/3-kit-maude-v2.css:92-100`). The Logs board draws "All" as a solid azure chip. | Inspector 1.16 L / 1.32 D · Logs "All" **1.08** · Diag tab 1.35 L / 2.57 D · History fill ~1.05 + text step 2.98 L / 2.73 D | `client/styles/3-shell-maude.css:3619-3621`; `client/v2/diagnostics/diagnostics.css:249-252, 93-96`; `client/v2/history/history.css:46-49`; `client/v2/export/export.css:101-105` | blocker |
| V2 | Diagnostics tabs show focus as a `--bg-3` fill with `outline: none`. On the selected tab the `[aria-selected]` fill comes later in the file and wins, so focus on the current tab is not drawn at all. | DS row/tab focus: 2 px `--focus-ring` (`preview/focus.css:26-29`) | focus fill 1.10 L / 1.12 D; selected + focused = no change | `client/v2/diagnostics/diagnostics.css:88-96` | blocker |
| V3 | There are three switch recipes and none follows the DS `.switch` (`--control-off` track ≥3.3:1, white knob). The Export `.ex-switch` OFF state is a `--bg-1` knob on a `--bg-3` track with a `--border-strong` hairline, so the OFF switch's outline measures **1.87 L / 2.32 D** (ad-export "Registration marks"). | `--control-off` track 3.31 L / 3.35 D | ex-switch OFF 1.87 / 2.32 | `client/v2/export/advanced/advanced.css:84-112` | blocker |
| V4 | Pinned layout (same as 03 A5). With the AI panel pinned, the left Canvases list collapses to its header. The "12 canvases · ⌘K…" line overprints "› Advanced", and the Inspector corner icon (`.st-corner--right`, top 68 px) sits on the pinned column's header next to its pin button. | Canvases + Inspector both pinned with folds open | list gone, text overlap, controls overlap | `client/v2/shell/floating-panels.css:140-142, 218-224` | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| ad-inspector | L/D | V1 on Resizing / Align / Case. The Advanced rows sit below the 840 px crop but the panel scrolls, so they stay reachable. "Copy as PNG" / "Export… every option" carry their keys as visible text. | — | — | — | (V1) |
| ad-left | L/D | Fold rows pass: "Empty" 6.32 / 6.47, "Copy" 9.35 / 10.14, path mono 5.60 / 5.63, "12 of 12 shown" 5.43 / 6.23. The `.lp-switch` is `role="switch"` + `aria-checked` + `aria-labelledby` (good). OFF draws its state with the knob (17:1), but the track is `--bg-4` (1.24 L / 1.38 D). ON would put an `--fg-0` knob on `--accent` (token **2.95 L / 2.64 D**), where the board draws ON with a white knob. | DS `.switch` | knob/track below the DS pair | `client/v2/left-panel/left-panel.css:457-487` | warning |
| ad-ai | L/D | Fold rows: native selects, "This chat" heading. Model, Effort and Context are absent (H). | — | — | — | none |
| ad-share | L/D | Local-project variant (C2). Copy buttons are labelled and fold text passes. | — | — | — | none |
| ad-export | L/D | V1 (Scope / Size by / Colour profile) and V3 (Registration marks OFF). Field labels and hints pass (export copy 5.4–15.9). | — | — | — | (V1, V3) |
| ad-history | L/D | V1 (All / Named / Made by AI / People). Rows draw an inset focus ring (`history.css:50-53`). | — | — | — | (V1) |
| ad-diag | L/D | V1 + V2 on the tab row. The tabs are a real `tablist` / `tab` (`diagnostics-sheet.jsx:505-521`) and Copy buttons are `aria-label="Copy …"`. Status words are coloured AND worded ("Running", "Needs setup"): success 8.09 L / 7.17 D, warn 5.96 / 9.07. | — | — | — | (V1, V2) |
| ad-logs | L/D | V1 ("All") and V2. The log list is a focusable `ol aria-label="Log lines"` (`diagnostics-sheet.jsx:161`). Warn lines 6.14 / 8.49, error lines 7.57 / 6.06, timestamps 5.86 / 5.91, footer 6.04 / 6.23. Error lines are colour-only, but the line text itself says "Warning:" / "not recorded". | — | — | — | (V1, V2) |
| ad-syncd | L/D | Local-project sentence only (C2). It passes. | — | — | — | none |
| ad-settings | L/D | The selected rail item ("Advanced") is `--bg-3` + `--fg-0` + medium weight (fill about 1.1:1). It is distinguishable by weight and text colour but not by a 3:1 indicator. The switches here are `.st-switch`: OFF knob `--fg-2` on `--bg-4` = 4.65 L / 4.23 D (passes as the state cue). Hints pass (5.71 / 6.00). | — | weak selected cue | `client/v2/settings/settings.css:73-77` | warning |
| ad-pinned | L/D | V4. | — | — | — | (V4) |
| ad-search | L/D | The palette is a proper combobox (`role="combobox"` + `aria-activedescendant` + `option`/`aria-selected`, count `aria-live`) at `dialogs/command-palette.jsx:204-216, 411-416, 467`. Path chips pass. | — | — | — | none |
| ad-open-all | L/D | The "All Advanced sections are open · Close all" toast is a shell callout (`role="status"`). | — | — | — | none |
| ad-code | L/D | Palette rows only; the code view (`code/code-view.jsx:139-140`, `role="dialog"` "Code of …, read only") was not opened. | — | — | — | none |
| ad-edge-syntax | L/D | The error card is a labelled `section`, the bad line has a bar + fill + caret (the caret is `aria-hidden`, and "Where: line 9, column 30" gives the line in words), and the verbs are labelled. The line number on the marked line measures **4.41 L** / 4.68 D, `--fg-2` on the `--bg-3` highlight (near). | — | near | `client/v2/code/canvas-error-card.jsx:104-120` | warning |
| ad-map · ad-why · ad-trace | L/D | Documentation boards. | — | — | — | n/a |

Target size (noted once): fold buttons, Copy chips and switches are 18–28 px tall, as the board draws them. WCAG 2.1 AA has no target-size criterion. Warning.

## Unreachable (spec-only). The state does not exist in this lane.

| id | what makes it reachable | sev |
|---|---|---|
| ad-timeline | A video canvas with a timeline in the 06 fixture (the timeline Advanced strip exists; see 07 ve-advanced, which also overflows). | blocker |
| ad-ds | A real Design-system board in the lane (the DS seeds do not make one). | blocker |
| ad-menus | The native macOS menu bar (desktop-e2e lane). | blocker |
| ad-edge-sync | A hub-linked project in trouble (conflicts, stopped sync). | blocker |
| ad-edge-hub | A hub-linked project. | blocker |
| ad-edge-where | Browser viewer, role and offline contexts (hub). | blocker |
| ad-edge-remember | The per-Mac fold memory across days (fold key store exists, `fold/fold-store.js`). It needs a multi-session scenario. | blocker |

---

## Pass — a11y review

### Contrast (impl pixels, L / D)
| pair | L | D | verdict |
|---|---|---|---|
| Left fold: label / path / Copy / Empty | 8.37 / 5.60 / 9.35 / 6.32 | 9.20 / 5.63 / 10.14 / 6.47 | pass |
| Diagnostics status "Running" / "Needs setup" / "Local project" | 8.09 / 5.96 / 5.77 | 7.17 / 9.07 / 5.85 | pass |
| Log warn / error / time / footer | 6.14 / 7.57 / 5.86 / 6.04 | 8.49 / 6.06 / 5.91 / 6.23 | pass |
| Settings hint / group / value | 5.71 / 7.25 / 8.50 | 6.00 / 7.05 / 9.50 | pass |
| Syntax card body / Where / line no. | 10.27 / 5.44 / 4.41 | 9.67 / 5.14 / 4.68 | pass / near |
| Chosen segment or tab vs neighbour | 1.05–1.35 | 1.08–2.57 | **fail (V1)** |
| Export OFF switch outline | 1.87 | 2.32 | **fail (V3)** |

### Keyboard
Folds, Diagnostics tabs, the log list (tabbable), Settings tabs, palette and Copy buttons are all reachable. V4 removes the canvas list from the tab order while pinned.

### Focus
The fold, Settings tabs (`settings.css:78-81`), history rows, lp-switch and dg buttons draw a 2 px ring. Diagnostics tabs do not (V2).

### Landmarks & structure
Diagnostics is `role="dialog" aria-label="Diagnostics"`. The code view is a labelled dialog. The error card is `aria-labelledby` its title.

### Form labels
Log filter `aria-label="Filter log lines"`. Switches `aria-labelledby` their row label. The Resync progressbar is labelled (`diagnostics-sheet.jsx:343-347`).

### Motion
Token collapse under `prefers-reduced-motion`. The Refresh spinner stops under reduce (`left-panel.css:489-495`). `.ex-switch-k` transitions on `--dur-fast`, which is not in the reduced-motion collapse list (also seen in 07).

### ARIA / images / i18n
Resync result `role="status"`, logs error `role="alert"`, repo-changed notice `role="status"`. No images. i18n n/a.

---

## Verdict

```json
{"canvas":"06 Advanced","critic":"a11y-critic","blockers":11,"warnings":4,"verified_ids":["ad-ai/light","ad-ai/dark","ad-share/light","ad-share/dark","ad-syncd/light","ad-syncd/dark","ad-search/light","ad-search/dark","ad-open-all/light","ad-open-all/dark","ad-code/light","ad-code/dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```

Blockers: V1–V4 plus 7 unreachable. Warnings: ad-left (lp-switch), ad-settings (rail), ad-edge-syntax (near) and target size.
