# a11y-critic — 04 Modes (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/04 Modes.tsx` (+ `.css`) · impl frames `.claude/worktrees/agent-a45b4750975bd8337/.scr/impl-out/04-modes/` · standard: WCAG 2.1 AA (no project a11y-rules skill, so the WCAG defaults apply) · opt_out_applied: n/a — a11y enforces at every scope_

**How this was measured.** Same method as 03. Contrast comes from impl JPEG pixels at 1440×900: the modal background against the 99.5th-percentile luminance outlier. It is cross-checked against the oklch token maths, and a value within 0.5 of a threshold is a near pass. Spec dark is the host re-theme. User designs (Homepage, Pricing, Combine-kampan stand-ins) are fixture content and are not judged. Only Maude chrome is.

**The board's own a11y intent.** Modes have "their own glyphs, words and keys" (md-keys). On click, Edit draws the DS input focus recipe on the select (`04 Modes.css:124`, `.md-focus`: 3 px `--accent-tint` + inset 1 px `--accent`). In Present, "the controls fade after two seconds; with Reduce motion they just hide" (md-present-full note).

**Severity counting.** Each root cause counts once. Each artboard-specific row and each unreachable state also counts once.

## Root causes

| # | cause | spec | impl (measured / code) | owner | sev |
|---|---|---|---|---|---|
| M1 | The Inspector's segmented controls show the chosen segment by an `--accent-tint` fill only. Examples are Border › Position "Inside", Effects › Shadow "Flat" and Layout direction. | kit `.seg > button[aria-checked=true]`: `--bg-2` + inset 1 px `--accent` (`styles/3-kit-maude-v2.css:92-100`) | chosen vs unchosen fill **1.16 L / 1.32 D** (needs 3:1) | `client/styles/3-shell-maude.css:3619-3621` (`.st-cp-segbtn.is-active`; control `inspector-controls.jsx:485-495`) | blocker |
| M2 | Present-menu rows show focus as a fill change, with `outline: none`. | DS row focus: 2 px inset `--focus-ring` (`preview/focus.css:26-29`) | `--accent-muted` on `--bg-2` = **1.32 L / 2.31 D** | `client/v2/shell/project-pill.css:145-150` (`.st-pm-row`; the same rule styles the project-pill menu) | blocker |
| M3 | In Preview with the left panel open, the zoom readout island (bottom-left) sits on top of the panel's footer, so "75 %" overlaps "Studio site". Seen in md-preview-follow, md-comment, md-draw and md-inspect. | readout clear of panels (panels hidden) | text over text | `client/v2/preview/preview.css:11-24` | warning |
| — | (cause, not counted) the v1 indigo ladder instead of maude-v2 azure. The dark Share and primary buttons carry dark ink on indigo 0.68 (6.26, token) where the board has white on azure (4.74). Everything measured passes. | — | — | `client/styles/1-tokens-maude.css:41-46, 154-158` | — |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| md-model | L/D | The mode switch is `role="group" aria-label="Mode"` with `aria-pressed` buttons. The pressed segment draws an accent hairline in both themes, like the board. Toolbar slots carry `aria-label` + `aria-pressed` (`tool-palette.tsx:532-533`). | — | — | — | none |
| md-keys | L/D | Glyph-only mode buttons expose their words through `aria-label` and a native `title`. The title appears on hover only, never on keyboard focus, and it carries no key. The buttons have no `aria-keyshortcuts` (only the Present menu rows do, `mode-switch.jsx:327`). The shell's `[data-tip]` bubble, which does show on `:focus-visible` (`3-shell-maude.css:4983-5013`), is not used here. | tooltip: word + key cap | hover-only title, no key | `client/v2/shell/mode-switch.jsx:218-260` | warning |
| md-edit | L/D | M1. The on-canvas link chip "Go to Pricing" passes (5.45 L / 5.93 D), and so does the size tag (5.55 / 5.91). The Inspector hint is 5.86 / 6.23, "Uses project" 8.54 / 6.53 and "esc" 5.68 / 5.77. The board's focused On-click select is below the first screen (the Inspector is the full one), so its focus recipe could not be compared. | — | — | — | (M1) |
| md-edit-image | L/D | The Assets photo grid and tabs show no difference in this lens. | — | — | — | none |
| md-edit-component | L/D | The picker is `role="dialog" aria-modal` with a labelled search (`component-picker.jsx:226-238`). Variant chips mark the current one with `aria-current`, not `aria-pressed`/`aria-checked`, so the chips do not read as toggles. The visible accent ring does match the board. Meta "4 variants" is 5.46 L / 4.68 D (near). | Secondary pressed | `aria-current` on buttons | `client/v2/inspector/component-picker.jsx:299-306` | warning |
| md-annotate | L/D | The Preview toolbar order and the armed hand (accent underline + fill) match. | — | — | — | none |
| md-preview | L/D | Entering Preview is not announced. "Previewing Homepage · esc to edit" is plain text with no `role="status"`. A keyboard toggle on the mode button reads "pressed", but ⌥⌘P from anywhere says nothing. The pill text passes: 12.5 / 12.6, "esc" 7.87 / 8.13, "to edit" 5.76 / 6.63. | — | silent mode change | `client/v2/preview/preview-bar.jsx:30-80` | warning |
| md-preview-follow | L/D | The back chip is a `button aria-label="Back to Homepage"` (ok). M3. | — | — | — | (M3) |
| md-preview-combine | L/D | No difference in this lens. | — | — | — | none |
| md-present-menu | L/D | M2. Notes "no chrome, no pins" and key caps pass (5.20 / 5.20, 5.59 / 5.76). The greyed "Copy presentation link" is `aria-disabled`. "Presenter view on another display" (`menuitemcheckbox`, `mode-switch.jsx:280`) is desktop-only. | — | — | — | (M2) |
| md-present-lift | L/D | Reduced motion is honoured (`present-controls.jsx:31-33, 106`; `present.css:52`). | — | — | — | none |
| md-present-full | L/D | The controls hide after 2 s, as the board asks. Any shell keydown or pointer move brings them back, and focus inside holds them (`present-controls.jsx:79-113`). The toolbar is labelled, the counter is `aria-live="polite"`, and Prev / Next / Leave are labelled. | — | — | — | none |
| md-present-canvas | L/D | The pill's exit is `aria-label="Exit presentation mode"` (`canvas-pill.jsx:23`). Text passes in both themes. | — | — | — | none |
| md-comment | L/D | The composer is `role="dialog" aria-label="New comment"`, with labelled Cancel and Send and a mention `listbox` (`comments-overlay.tsx:1211-1232, 1459-1502`). The Comments panel filter is a `tablist`. M3. | — | — | — | (M3) |
| md-draw | L/D | The sticky byline "You · just now" measures **4.36** (JPEG; near). The white swatch in the sticky toolbar has a boundary of 1.36 L against the white toolbar (non-text, needs 3:1). The selected swatch has a dark ring (ok). The context toolbar text passes (9.96 / 11.17). M3. | — | byline near, white swatch edge | `apps/studio/annotations/elements/sticky.model.ts:263` (byline), `apps/studio/tool-palette.tsx:214-223` (swatches) | warning |
| md-inspect | L/D | ⌘-click in Preview selects the button (tag "Book a call 97 × 33") but the Inspect panel does not open, so its Size, Colour and Export rows and Copy code cannot be reached. The state is missing. M3. | Inspect panel at right | no panel | `client/v2/inspect/inspect-host.jsx:26` (trigger) | blocker |
| md-edge-ai | L/D | In Preview the AI's live change carries no on-artboard tag ("AI is making a change · shown live"). The panel live region still announces the run (03 A-row), so this is a missing visual status only. | spark tag | none | `apps/studio/artboard-activity-overlay.tsx` (Preview path) | warning |
| md-edge-mixed | L/D | Canvas-mode frame; no difference in this lens. | — | — | — | none |
| md-esc | L/D | One esc from Preview returns to Edit with panels back, and focus is not lost. The other rows are not driven. | — | — | — | none |
| md-motion | L/D | Animation storyboard (documentation). | — | — | — | n/a |

## Unreachable (spec-only). The state does not exist in this lane.

| id | what makes it reachable | sev |
|---|---|---|
| md-present-video | A footage-backed video artboard in the fixture (the transport exists: `present-controls.jsx:239-255`, Play/Pause + Sound `aria-pressed`). | blocker |
| md-presenter | A second display (desktop shell, Presenter view). | blocker |
| md-present-link | A cloud viewer link (hub). | blocker |
| md-comment-only | A Can-comment role on a hub project. | blocker |
| md-edge-viewer | A viewer role on a hub project. | blocker |
| md-edge-offline | Desktop Presenter view with an offline clip. | blocker |

---

## Pass — a11y review

### Contrast (impl pixels, L / D)
| pair | L | D | verdict |
|---|---|---|---|
| Preview pill title / canvas / esc / hint | 12.50 / 19.18 / 7.87 / 5.76 | 12.57 / 18.40 / 8.13 / 6.63 | pass |
| Zoom readout | 8.78 | 9.40 | pass |
| Mode glyphs Edit / Preview (pressed) | 10.21 / 19.53 | 9.10 / 16.23 | pass (non-text) |
| Link chip / size tag | 5.45 / 5.55 | 5.93 / 5.91 | pass |
| Inspector hint / label / esc kbd | 5.86 / 5.51 / 5.68 | 6.23 / 5.55 / 5.77 | pass |
| Present-menu note / keys / group head | 5.20 / 5.59 / 6.62 | 5.20 / 5.76 / 6.13 | pass |
| Sticky byline | 4.36 | 4.36 | near |
| Seg chosen vs unchosen fill | 1.16 | 1.32 | **fail (M1)** |
| Present-menu focus fill | [1.32] | [2.31] | **fail (M2)** |

### Keyboard
Mode switch, Present menu (menu / menuitem / menuitemcheckbox), Preview toolbar, Present ‹ › Esc and the comment composer are all reachable. Present controls are shell DOM, so ‹ › work while the iframe has focus.

### Focus
The shell catch-all ring covers mode buttons and the Share cluster. Present-menu rows are M2. Inspector segments use the catch-all ring for focus, but their chosen state is M1.

### Motion
Tokens collapse under `prefers-reduced-motion` (`1-tokens-maude.css:314-321`, `1-tokens-maude-v2-shell.css:140-145`). Present uses `data-motion="reduced"`. Preview zoom-in animation durations ride `--dur-panel`.

### ARIA
Mode `group` + `aria-pressed`. Present menu `aria-haspopup` / `aria-expanded`. Toolbar `role="toolbar"`. Picker dialog `aria-modal`. Gaps: md-preview (no announcement), md-edit-component (`aria-current` on toggles).

### Images & media / i18n
n/a for this canvas.

---

## Verdict

```json
{"canvas":"04 Modes","critic":"a11y-critic","blockers":9,"warnings":7,"verified_ids":["md-model/light","md-model/dark","md-edit-image/light","md-edit-image/dark","md-annotate/light","md-annotate/dark","md-preview-combine/light","md-preview-combine/dark","md-present-lift/light","md-present-lift/dark","md-present-full/light","md-present-full/dark","md-present-canvas/light","md-present-canvas/dark","md-edge-mixed/light","md-edge-mixed/dark","md-esc/light","md-esc/dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```

Blockers: M1, M2, md-inspect, plus 6 unreachable. Warnings: M3, md-keys, md-edit-component, md-preview, md-draw, md-edge-ai, plus target size. Target size is noted once: mode and tool buttons are 28–32 px, sticky swatches ~18 px, both as the board draws them. WCAG 2.1 AA has no target-size criterion.
