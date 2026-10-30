# a11y-critic — 08 Artboard Kinds (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/08 Artboard Kinds.tsx` (+ `.css`, `_kit.css`) · impl frames `.claude/worktrees/agent-af625ef88bd36c798/.scr/impl/08/` · standard: WCAG 2.1 AA (no project a11y-rules skill) · opt_out_applied: n/a, a11y applies at every scope_

Method and counting are the same as `07-video-editing/critic-a11y.md`: ratios are measured from impl pixels and cross-checked against the token maths, spec dark is a host re-theme, and (fixture) rows are not findings. The app runs on the v1 `.maude` ladder, not maude-v2 tokens (07 R4).

## Root causes (these hit several artboards)

| # | cause | spec | impl (measured) | owner | sev |
|---|---|---|---|---|---|
| R1 | Inspector `Segmented` (Height *Fits content/Fixed*, Orientation *Portrait/Landscape*) marks the selected option only with an `--accent-tint` wash. | DS `.seg button[aria-pressed=true]`: `--bg-2` + 1 px inset `--accent` (4.89 L / 3.13 D) | selected vs unselected fill **1.20 L / 1.31 D**, no ring | `client/inspector-controls.jsx:483-504`; `client/styles/3-shell-maude.css:3614-3616` | blocker |
| R7 | The warning mark beside an artboard label is a bare `oklch(62% .17 65)` glyph. On the selected (accent) label it nearly vanishes. | `.ak-lw`: 16 px `--status-warn` pill with `--object-ink` glyph (6.50 L / 9.13 D) | on the selected label **1.53 L / 1.26 D** (token; measured 1.33 / 1.37); on canvas 3.42 L (near) | `apps/studio/artboard-warn-mark.tsx:174-190` | blocker |
| R9 | Safe-zone tags are hard-coded red with near-white text, sized in artboard px, so they shrink with the camera (about 7 px on screen in the frame). | `.ak-sz-band span`: `--accent` / `--accent-fg`, `--type-xs` 11 px (4.89) | **4.10:1** both themes (measured 4.08); about 7 px | `apps/studio/safe-zones-overlay.tsx:34-58` | blocker |
| R5/R8 | The timeline glyph and invisible seam focus from 07 also show here (ak-video). | — | ▶ 1.29 L | `client/styles/3-shell-maude.css:6230-6241, 5745-5762` | blocker ×2 |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| ak-picker | L/D | Arrow keys in the search box move a visual highlight (`data-hl`) with no `aria-activedescendant` or combobox role. Enter then picks a tile a screen reader never announced. The tiles themselves are focusable buttons, so a Tab route exists. | listbox-like pick | silent virtual focus | `client/v2/kinds/SizePicker.jsx:370-386,415-429` | warning |
| ak-picker | L/D | The Recent row (FB event cover · Post 4:5 · A6) is missing, so it cannot be verified. Text passes: tile size 5.62 L / 5.32 D, badges 8.46 / 6.05, footer 5.53 / 5.67, tile glyphs 5.69 / 5.22. | Recent chips | none | `SizePicker.jsx` | warning |
| ak-picker-full | L/D | Keyboard focus on A2 is visible (inset 1.5 px accent + `--accent-muted` fill). In dark the ring is 2.41 against its own fill but passes against the panel. The Custom print size dialog is a separate frame, and the explainer card is board-only. | — | — | `client/v2/kinds/size-picker.css:181-185` | warning |
| ak-web-hug | L/D | R1 on Height. The growth tag "+ 373 px" and the "new section" highlight are missing, so the only statement of growth is the inspector line. "Other widths" is a native select, which is fine. | tag + highlight | none | `client/v2/inspector/kinds/artboard-rows.jsx:103-125` | warning |
| ak-web-widths | L/D | The Add-a-width menu and sibling widths were not driven, so this is not verified. | — | — | — | warning |
| ak-social | L/D | Lens-clean. Size "Custom" vs "Story 9:16" is preset recognition (not a11y). Native selects are labelled and the label chip passes. | — | — | — | — |
| ak-safe-zones | L/D | R9 tags. The platform list is a native select (better than the board's floating list for a11y). Show on canvas is a labelled switch. | — | — | R9 | (root) |
| ak-print-letak | L/D | R7 on the selected label. R1 on Orientation. The unit prefixes "W / H / mm" are about 10 px and measure 4.40–4.99, near the threshold. Inputs carry `ariaLabel` ("Bleed, millimeters"), which passes. The warning row text passes (16.0 L / 11.4 D). | — | — | `client/v2/inspector/kinds/artboard-print.jsx:132-190` | warning |
| ak-print-view | L/D | Guides were toggled from the palette, and only the selected A6 shows a thin red frame. The View › Advanced menu was not opened, so this is not verified. | ✓ Print guides menu | — | — | warning |
| ak-video | L/D | R5/R8 in the timeline. The inspector is docked rather than floating (not a11y). | — | — | R5/R8 | (root) |
| ak-mixed-fit | L/D | Layers lists raw DOM nodes ("div / div__remotion-player / img") as names. The "19 other artboards are dimmed. Show all" state is missing. Kind chips pass (`aria-pressed` plus `aria-label` "word, n"). | flat artboard list + dim/Show all | DOM tree, no dim | `client/v2/kinds/KindChips.jsx:26-50` | warning |
| ak-mixed-filter | L/D | Non-matching artboards are faded to 0.34 on the canvas, which the spec does not do. Their content and labels drop well under 4.5:1 while still readable work. | canvas undimmed | dimmed | `apps/studio/editing/kind-dim.tsx:17-30` | warning |
| ak-mixed-select | L/D | ⌘A selected 3 objects and the multi-artboard inspector did not open, so it is not verified. The align bar is a labelled `role=toolbar`. | "2 artboards · 2 kinds" | — | `apps/studio/editing/align-bar.tsx:185-207` | warning |
| ak-warnings | L/D | R7. The board's multi-warning cases were not reproduced; the one-verb shape exists. | — | — | R7 | (root) |
| ak-advanced | L/D | The Advanced fold did not open (click missed), so it is not captured. R7 is on the label. | — | — | — | warning |
| ak-real-print | L/D | R7 on the label chip. The content is the fixture's green A6, so that part is not a finding. | — | — | R7 | (root) |
| ak-real-web | L/D | Fixture content. Lens-clean. | — | — | — | — |

## Unreachable (spec-only)

| id | what makes it reachable | sev |
|---|---|---|
| ak-convert | Drive the inspector Size select to an A6 option on a social artboard. `client/v2/kinds/ConvertDialog.jsx` exists (with `useModalFocus`), but this pass didn't match the option. | blocker |
| ak-convert-after | Depends on ak-convert (A6 copy beside the post, plus undo toast) | blocker |
| ak-real-about | Board note card, not an app state | not-a-finding |

## Verdict

```json
{"canvas":"08 Artboard Kinds","critic":"a11y-critic","blockers":7,"warnings":11,"verified_ids":["ak-social·light","ak-social·dark","ak-real-web·light","ak-real-web·dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```
