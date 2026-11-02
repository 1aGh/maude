# a11y-critic — 13 Design System (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/13 Design System.tsx` (+ `.css`) · impl frames `.claude/worktrees/agent-a55262287b808e562/.scr/impl/13-design-system/` (lossless PNG, 1440×900) · standard: WCAG 2.1 AA (no project a11y-rules skill, so WCAG defaults) · opt_out_applied: n/a — a11y enforces at every scope_

**Method.** Every pair was read (light over dark, both halves). Contrast comes from the impl PNG pixels. For each text box the background is the modal colour and the foreground is the 99.5th-percentile outlier. Ratios are cross-checked against tokens where a token is named. Roles, labels, focus and motion come from the impl JSX/CSS. The IMPL project is a converted scratch system (`maude` + `maude-v2`), so names, counts and "no canvas uses it" lines are fixture and not findings (INDEX method notes). Board frames (`ds-board-*`) are capture renders of the whole board. The board's own a11y intent: the Check card says "Contrast — 41 of 42 text pairs pass 4.5:1, Light and Dark" and "Complete — both modes, reduced motion" (`13 Design System.tsx:1654-1658`). States drawn for Focus/Disabled masters: `13 Design System.css:766-777`.

## Root causes (count once each)

| # | cause | spec | impl (measured / code) | owner | sev |
|---|---|---|---|---|---|
| D1 | **Dark: the bottom canvas toolbar renders as a light island with pale icons.** The toolbar takes `--island-bg`/`--island-edge` from the canvas document first. That document loads the project's design system, whose `:root` is light-only (`maude-v2/colors_and_type.css:117`, 88 % white). The ink comes from the dark `--maude-chrome-fg-1`. A user's design tokens leak into Maude chrome. Hits every in-app dark frame with the toolbar visible (`ds-where-studio`, `ds-where-gator`, `ds-edit-colour`, `ds-edit-reach`, `ds-edit-instance`, `ds-many-switch`, `ds-multi-panel`, `ds-multi-migrate`, `ds-edge-contrast`, `ds-edge-trash`, `ds-advanced`). | dark island, light glyphs (board kit toolbar) | island `#dee1e2`, icons `#b7bbc0` = **1.47:1** (1.4.11 needs 3:1). Light passes, 9.0:1. | `apps/studio/toolbars/toolbar-css.ts:23-24` (also `:125`, the popover) | blocker |
| D2 | **Segmented controls show the selected option by a fill only.** The DS draws selected = `--bg-2` + shadow + 1 px accent inset. Impl uses `--accent-tint` on the track with no edge and no weight change. Seen on the token inspector's "Editing Light \| Dark". | `styles/3-kit-maude-v2.css:93-101` | selected vs unselected fill = **1.19 L / 1.28 D** (`#d8ddef`/`#eef0f3`, `#2d3850`/`#22272d`), needs 3:1 | `client/styles/3-shell-maude.css:3619-3621` (`.st-cp-segbtn.is-active`) via `client/inspector-controls.jsx:483-503` | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner file:line | sev |
|---|---|---|---|---|---|---|
| ds-where-studio | L | Pinned DS rows, inspector "Uses maude-v2" link, toolbar 9.0:1. Two rows, not one (fixture). | — | — | — | none |
| ds-where-studio | D | D1 | dark toolbar | 1.47:1 | toolbar-css.ts:23 | (D1) |
| ds-where-gator | L | ⌘K finds the systems. Token/style/component hits are absent, so a keyboard user cannot reach a token by name from ⌘K. | "Klubová zelená — Colour · used in 88 canvases" rows | system rows + actions only | `client/v2/ds/use-ds-search.js` | warning |
| ds-where-gator | D | D1 plus the row above | — | — | — | (D1) |
| ds-board-studio | L/D | Capture render. `ds-bar` is `role="toolbar"` with a labelled `<fieldset>` and `aria-pressed` Light/Dark. The selected state adds weight 600, which is not colour-only. Its focus ring is `outline: 2px solid Highlight` on `Canvas`. Chromium's light `Highlight` is a pale blue (~1.4:1 on white). Not measured, because no frame has bar focus. | DS ring `--focus-ring` 2 px | system `Highlight` | `apps/studio/ds/board/board.css:495-497` | warning (verify) |
| ds-board-dark | L/D | Same as ds-board-studio. In dark the bar text stays `CanvasText` on `Canvas` white, 8.59:1 ("60 colours in their dark values"). Passes. | — | — | `ds/board/board.css:441-505` | (warning above) |
| ds-board-gator | L/D | Same as ds-board-studio. The board's brand-colour lock is not drawn. `ds-token-locked` exists in the inspector (`client/v2/ds/kinds/token.jsx:18`) but has no board-side marker. | lock icon on locked swatches | none on board | `apps/studio/ds/board/section-colour.tsx` | warning |
| ds-edit-colour | L/D | D2 on "Editing Light \| Dark". Contrast line ("Light 4.6:1 · Dark 4.7:1") is text and passes. The drawn colour picker (square + hue rail) is absent. The text field is the keyboard route, so this is not a finding. | — | — | — | (D2), D (D1) |
| ds-edit-reach | L/D | No reach lines. INDEX: no canvas references the changed token, so the Show action is not offered (fixture). | — | — | — | D (D1) |
| ds-edit-review | L/D | Matches: `role="dialog"` + `aria-modal` + labelled title, `useModalFocus` with initial focus on primary, per-canvas `role="checkbox"` with `aria-checked="mixed"`, thumbnails `aria-hidden`, Before/After `aria-pressed`, error `role="alert"`. | — | — | `client/v2/ds/review-sheet.jsx:44-48, 152-153, 210-216, 264-270, 319` | none |
| ds-edit-master | L/D | The list is flat, not folder-grouped. The folder tick (`toggleGroup`, `review-sheet.jsx:172-176`) cannot be checked here (fixture: 4 canvases, below `FOLDER_VIEW_FROM`). | — | — | — | none (fixture) |
| ds-edit-instance | L/D | **Missing state.** No Component/instance section on a left-out instance, no "Update available · Corners 2 → 6", no Update/Detach, no quiet row dot. `update-available.jsx` (labelled `<section>`, error `role="alert"`) exists but is not surfaced. | update card in inspector | plain frame inspector | `client/v2/ds/update-available.jsx:130-160`, `client/v2/ds/update-dots.js:79` | blocker |
| ds-make-inputs | L/D | Sheet: labelled textarea (`htmlFor`), website input `aria-label`, ref tiles `aria-pressed`, audience group `aria-labelledby`, modal focus to the sentence. The site input's `outline: 0` is replaced by `.dsm-src:focus-within` (2 px ring). Empty sentence and no ticks are fixture. | — | — | `client/v2/ds/make-sheet.jsx:52-253`, `make.css:124-138` | none |
| ds-multi-panel | L/D | Two pinned rows. No draft row and no amber "made before the schema" dot (fixture: no draft, no old schema). | — | — | — | D (D1) |
| ds-multi-switch | L/D | Sheet: scope tabs, rows, disabled "Switch no canvases". Disabled is exempt. 0 of 0 canvases is fixture. | — | — | — | none |
| ds-multi-menu | L/D | Menu rows present with focus ring. Wording differs ("Default for new canvases" vs "Use for new canvases"). Rename… is absent. That is copy, not a11y. | — | — | `client/v2/ds/system-menu.jsx:20-60` | none |
| ds-multi-migrate | L/D | Unconverted panel shown. The Convert prompt is not in this frame (see ds-edge-migrate). | — | — | — | D (D1) |
| ds-many-switch | L/D | **"previewing" / "in use" notes fail contrast on the highlighted option.** `--fg-2` 11 px on `--accent-soft`. The listbox itself is correct: `aria-activedescendant`, `role="option"`, `aria-selected`, and the banner is `role="status"`. | 4.5:1 | **3.74 L / 2.19 D** (`#696e76` on `#cedcff`, `#888e97` on `#3e5495`) | `client/v2/ds/switch.css:165-172`, `client/v2/ds/preview-bar.jsx:55-82` | blocker |
| ds-edge-contrast | L/D | D2 (Editing seg). Warning line is fg-0 text + icon, 8+:1, and "Fix to 4.5:1" is a real `<button>` with a focus ring. The live contrast line is not a live region: when a value drops below 4.5:1 a screen reader is not told, and only the fix note is `role="status"`. "Falls short in 3 canvases · Show" is absent (fixture: no canvas uses `--fg-2`). | board: "checked in both modes as you drag" | not announced | `client/v2/ds/contrast-warning.jsx:30-37, 68-76` | warning |
| ds-edge-trash | L/D | **Missing state.** The "Move Linka to the trash?" confirm cannot be reached from the board. The sheet exists (`role="dialog"`, `aria-modal`, `aria-labelledby`), but no UI entry opens it, so neither keyboard nor mouse can reach it (CLI only). | confirm sheet from the swatch | history line only | `client/v2/ds/trash-token-sheet.jsx:48-81` | blocker |
| ds-edge-migrate | L/D | Convert dialog has a heading and buttons, and Esc closes it. Its content differs (2 folders, no section counts), which is a content difference. | — | — | `client/v2/ds/convert-dialog.jsx` | none |
| ds-advanced | L/D | The combined card (Hand off tokens, CSS/JSON preview, files tree) is not in one place. The parts that exist (Check button, Advanced) are reachable. Content difference. | — | — | `client/v2/ds/advanced.jsx` | D (D1) |

## Unreachable (spec-only). These states do not exist in this lane.

| id | what makes it reachable | sev |
|---|---|---|
| ds-truth-outside | The outside-change watcher must surface `outside-banner.jsx` on the board within the shot. The engine sees the edit (`ds status`). When it is reached, check the following. The banner is a labelled `<section>` with no live region (`outside-banner.jsx:75-79`), so an unprompted card is silent to a screen reader. | blocker |
| ds-truth-conflict | Same watcher, plus a token edited in two places. `conflict-pick.jsx:50-55` is a labelled section, again not announced. | blocker |
| ds-make-directions | The CLI-written draft directions must render as artboards on the system canvas (today it shows the legacy folder view, "No tokens parsed"), plus an AI lane. `direction-bar.jsx` has `menuitemcheckbox` + `role="status"`. | blocker |
| ds-make-mix | Same as ds-make-directions. | blocker |
| ds-make-filling | Same, plus the outline artboards and the progress card. | blocker |
| ds-make-done | Same, plus the ready banner. | blocker |
| ds-many-library | Needs a hub-linked team library with 3 projects (cloud lane). `library-card.jsx` dialogs are modal with alerts. | blocker |
| ds-many-linked | Needs a hub-linked library (the `VIEW_ONLY_WORDS` bar, `ds-bar.tsx:16-17, 55-62`). | blocker |
| ds-multi-schema | Needs AI (signed in) or a fixture system with an old schema, to raise the amber dot and the "Bring it up" sheet (`upgrade-sheet.jsx:80-158`, which has a labelled progressbar). | blocker |
| ds-edge-suggest | Needs AI to raise the off-system question (`off-system.jsx:29-30` is `role="status"` + `aria-live="polite"`, as the board intends). | blocker |

**Motion.** Covered. `ds/board/board.css:523-529` collapses board and bar to 1 ms. `ds/reach.css:187, 211` and `upgrade.css:106-112` animate on `--dur-*` tokens, which `1-tokens-shell.css:415-423` collapse to 1 ms. `edges.css`, `library.css` and `switch.css` carry their own `prefers-reduced-motion` blocks. No finding.

**Target size.** WCAG 2.1 AA has no target-size criterion (2.5.5 is AAA). The make-sheet tile × is 16×16 (`make.css:110-121`), and segmented buttons are 26 px. The board draws the same sizes. Warning, not counted.

```json
{"canvas":"13 Design System","critic":"a11y-critic","blockers":15,"warnings":4,"verified_ids":["ds-where-studio·light","ds-edit-review·light","ds-edit-review·dark","ds-edit-master·light","ds-edit-master·dark","ds-make-inputs·light","ds-make-inputs·dark","ds-multi-switch·light","ds-multi-switch·dark","ds-multi-menu·light","ds-multi-menu·dark","ds-multi-panel·light","ds-multi-migrate·light","ds-edge-migrate·light","ds-edge-migrate·dark","ds-advanced·light"]}
```
