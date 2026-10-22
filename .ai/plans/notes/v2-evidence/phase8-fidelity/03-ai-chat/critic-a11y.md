# a11y-critic — 03 AI Chat (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/03 AI Chat.tsx` (+ `.css`) · impl frames `.claude/worktrees/agent-a45b4750975bd8337/.scr/impl-out/03-ai-chat/` · standard: WCAG 2.1 AA (no project a11y-rules skill, so the WCAG defaults apply) · opt_out_applied: n/a — a11y enforces at every scope_

**How this was measured.** Contrast comes from the impl JPEG pixels at 1440×900. For each text box the background is the modal colour and the foreground is the 99.5th-percentile luminance outlier. Each measured ratio is cross-checked against the token maths (oklch → sRGB, alpha composited). JPEG smearing reads thin 11–12 px text about 0.3–0.5 low, so a value within 0.5 of a threshold is a near pass, not a finding. Spec dark is the host re-theme, not a drawn state (INDEX). Roles, labels, focus and motion come from the impl JSX/CSS. Rows marked (fixture) or H (fake agent) in the INDEX are not findings.

**The board's own a11y intent** (`03 AI Chat.tsx:1142`): "one polite live region per panel says Working, Waiting, Done and Needs you once each. ⌘/ moves focus into the field; esc gives it back." Reduced motion: `03 AI Chat.css:160-165` stops the tab-run and done-ring loops.

**Severity counting.** Each root cause counts once for this canvas. Each artboard-specific row and each unreachable state also counts once.

## Root causes (these hit several artboards)

| # | cause | spec | impl (measured / code) | owner | sev |
|---|---|---|---|---|---|
| A1 | Focus on menu rows is a fill change only, with `outline: none`. This hits the scope menu (`ai-scope`) and the paperclip menu (`ai-attach-menu`, which reuses `.ai-scope-item`). The attach menu moves focus onto its first row on open (`AttachMenu.jsx:89`), so a keyboard user opens it and sees no focus. | DS `preview/focus.css:26-29`: a row draws a 2 px `--focus-ring` inset ring (`.fo-row`) | `--bg-3` fill on `--bg-2` = **1.10 L / 1.12 D**, the same as hover | `client/v2/ai/ai.css:134-139` | blocker |
| A2 | The composer unmounts while a run is live. `ThreadPrimitive.If running={false}` wraps the scope chip, the paperclip, the field and Send, and the replacement stop bar is `display:none`. The board's field (scope chip + "Ask AI…" + send) cannot be reached while AI works, and the focused textarea leaves the DOM on Send. Seen in ai-working, ai-two-artboards, ai-copy and ai-same-artboard. | field + `◆ Post 1:1` chip + send drawn under the working line | no field, no chip, no paperclip | `client/v2/ai/Composer.jsx:518-598`, `client/v2/ai/ai-run.css:50-52` | blocker |
| A3 | The slash-command menu is a `role="listbox"` that is not wired to the textarea. There is no `role="combobox"`, `aria-controls`, `aria-expanded` or `aria-activedescendant`, so arrow keys move a highlight a screen reader never hears. The highlight itself is `--bg-3` fill only (1.10 L / 1.12 D). The ⌘K palette already does this correctly (`dialogs/command-palette.jsx:204-216, 411-416`). | menu of `/design:*` rows with the active row marked | no combobox wiring; active row 1.1:1 | `client/v2/ai/Composer.jsx:236-270, 371-375`; `client/styles/6-acp-chat.css:1585-1587` | blocker |
| A4 | The live region never says **Waiting**. `liveText()` returns '' for `state:'waiting'`. `WaitingCard` carries `role="status"` but mounts already filled, and screen readers do not reliably announce a region that is inserted with its content. Working / Needs you / Done are announced once each, as the board asks. | "says Working, Waiting, Done and Needs you once each" | Waiting is silent | `client/v2/ai/run-model.js:213-222`, `client/v2/ai/WaitingCard.jsx:35` | blocker |
| A5 | Pinned layout breaks reach. The left Canvases panel collapses to its header and the canvas list disappears. The Inspector corner icon (`.st-corner--right`, top 68 px) sits on the pinned AI column's header row, next to its pin and hide buttons. The Share cluster covers the column's first transcript line. | pinned column, canvas re-fits | list gone; controls overlap | `client/v2/shell/floating-panels.css:140-142, 218-224` | blocker |
| A6 | The Version history filter tabs show the selected tab by text colour plus a fill of about 1.05:1. Same family as 06 R1. | selected pill | `--fg-0` vs `--fg-2` = **2.98 L / 2.73 D** (needs 3:1) | `client/v2/history/history.css:46-49` | blocker (ai-history) |
| — | (cause, not counted) v2 surfaces render on the v1 `.maude` ladder: indigo 268, opaque `--accent-muted`, dark `--accent-fg` ink. `1-tokens-maude-v2-shell.css` only fills in tokens the shell lacks (spark, palette, island). Every text pair measured here still passes on that ladder (v1 `--fg-2`/`--fg-3` are text-safe), so this explains colour drift, not contrast failures, on this canvas. | maude-v2 azure 238 | v1 indigo 268 | `client/styles/1-tokens-maude.css:21-60, 138-170` | — |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| ai-hero | L/D | Done chat: result, Undo / Keep going, suggestion strip and composer all pass (result 9.8 L / 9.9 D, Undo 18.0 / 16.6, why-line 5.67 / 5.70, chip 8.54 / 6.20). A4's "AI is working" tag is 4.85 L / 5.73 D (token 5.37 / 6.33). The Made-by-AI tag, wipe and consent card are missing, but those are design rows, not a11y. | — | — | — | none |
| ai-open | L/D | ⌘/ with an artboard selected goes to the in-place ask bar (`ask-selection`) instead of the panel field. Focus still lands in a field, so this is not a dead end, but the board says ⌘/ focuses the panel field. Via the corner icon the field takes focus with an accent ring (4.71 D / 5.52 L). | ⌘/ → panel field | ⌘/ → ask bubble | `client/v2/ai/ask-selection-lane.js:55-60`, `client/v2/shell/menu-runner.js:506` | warning |
| ai-suggest | L/D | Only the after-a-run context is reachable. Its chips and why-line pass (5.67 / 5.70). | — | — | — | none |
| ai-scope | L/D | A1. Menu text passes (9.5–10.9 L / 9.4 D). The chip's remove × is about 16×13 px (text-sized). It is revealed on `:focus-within` (good). | — | × hit area ~16×13 | `client/styles/6-acp-chat.css:1223-1232` | (A1) |
| ai-working | L/D | A2. Working line passes: "AI is working" 7.77 L / 6.36 D, step 8.46 / 7.10, Stop 9.31 / 8.00. The canvas-row "AI is working" on the selected row is 4.76 L / 4.87 D (token 4.84 / 4.64, a near pass). Reduced motion stops the spark pulse (`ai-run.css:268-271`) and collapses the ring glyph (`artboard-activity-overlay.tsx:162-165`). | — | — | — | (A2) |
| ai-done | L/D | Result line, Undo / Keep going and `role="status"` result note all pass. Done is announced through the panel live region. | — | — | — | none |
| ai-attach | L/D | The image chip renders as a ~30×6 px azure strip with a 16 px ×, so you cannot see what is attached. The chip CSS is 40×40 (`attach.css:91-96`) and the fixture is an 8×8 PNG that `object-fit: cover` would still fill, so the chip is being squeezed by its row. The `<img alt={name}>` gives a screen reader the name. | 40 px thumbnails + named chips | collapsed strip | `client/v2/ai/attach.css:55-96`, `client/v2/ai/AChip.jsx:80-95` | blocker |
| ai-attach-menu | L/D | A1 (focus lands on row 1 with no visible indicator). Hint "Or drag files here" 6.14 / 5.69, ⌘V 6.52 / 5.91. | — | — | — | (A1) |
| ai-question | L/D | Choice card takes focus (`tabIndex -1`, a 2 px accent ring is visible). Options 17.5 / 15.6. "Waiting for you" tag 4.91 L / 5.34 D (token 4.75 / 5.83). The canvas-row word "Needs you" uses `--accent` as text: 5.08 L / 4.58 D (token 4.88 / 4.80), which passes but sits close. The DS role is `--accent-text`. | — | — | `client/v2/canvases/canvases.css:151-153` | none (near) |
| ai-long | L/D | Full height comes from transcript length. The manual toggle is double-click on the grip only, with no key equivalent (the grip is a keyboard `separator` for width, `shell/dock.jsx:267-277`). "Jump to latest" exists (`BigChat.jsx:120`) but is not driven. | edge tip "Drag to resize · double-click for full height" | dblclick only | `client/v2/ai/BigChat.jsx:66-95` | warning |
| ai-long-pinned | L/D | A5. | — | — | — | (A5) |
| ai-two-artboards | L/D | A2 (two runs, no field). Both tags pass. | — | — | — | (A2) |
| ai-same-artboard | L/D | A4. Card text passes (10.1 L / 9.5 D). "Run on a copy" 16.8 / 15.4. Cancel × is 24 px with `aria-label="Cancel this ask"` (`WaitingCard.jsx:45`). | — | — | — | (A4) |
| ai-copy | L/D | A2 (mid-run). The copy divider "Ran on a copy" is plain text. | — | — | — | (A2) |
| ai-chat-list | L/D | Row names include leaked attachment header text ("Make it greener hang [maude-…"), so the accessible name of the row is polluted too. Meta passes: "now" 4.62 L / 5.13 D, crumbs 5.19 / 5.63, footer 5.68 / 5.92. Row ⋯ reveals on `:focus-visible` (`ai-list-advanced.css:255-257`). | clean titles | leaked header | `client/v2/ai/chat-list-model.js` (title derivation) | warning |
| ai-panel-closed | L/D | The busy corner icon's name stays "Ask AI ⌘/". The busy dot is `aria-hidden` and coloured `--accent` (azure, the needs-you colour), where the board uses the spark. | spark glyph + spark dot | grey glyph + azure dot; name has no busy | `client/v2/shell/corner-icons.jsx:129-137`, `client/v2/shell/floating-panels.css:198-207` | warning |
| ai-quit | L/D | `role="alertdialog"` + `aria-modal` + Esc = Cancel. Focus goes to Quit, the destructive default. There is no Tab containment, so Tab can walk into the dimmed shell. Text passes. | — | no focus trap | `client/v2/ai/QuitDialog.jsx:50-95` | warning |
| ai-needs-hidden | L/D | The toast goes through the shell callout (`role="status"`, `v2/shell/callouts.jsx:106`). The corner badge passes (7.25 L / 5.53 D) and the corner icon's name says "— AI needs you". | — | — | — | none |
| ai-permission | L/D | The card takes focus with a ring. Primary "Edit" 5.54 L / 5.62 D (token 5.71 / 6.26; spec white on azure is 4.89 / 4.74). "Always for this canvas" is absent because the fake agent offers no `allow_always` (H). | — | — | — | none |
| ai-choice-fail | L/D | `ProblemCard` is `role="alert"`. Body 18.0 / 16.6, "Try again" 5.37 / 5.44, Advanced 5.28 / 5.34. | — | — | — | none |
| ai-not-ready | L/D | The inline connect sheet is clipped. Its Cancel / Connect verbs are scrolled out of view under the suggestion strip and the scope chip. The composer is gone, and nothing moves focus into the sheet (`ConnectSheet.jsx` has no focus call; it is `role="group"` inline). | card with both verbs visible | verbs off-screen; focus lost | `client/v2/ai/ConnectSheet.jsx:37-66` | blocker |
| ai-advanced | L/D | Fold content passes (native selects, progressbars labelled at `Advanced.jsx:398-427`). The collapsed attach strip from ai-attach is still in the composer. | — | — | — | (ai-attach) |
| ai-adv-edges | L/D | A3. | — | — | — | (A3) |
| ai-history | L/D | A6. Rows `.vh-row:focus-visible` draw a ring (ok). | — | — | — | (A6) |
| ai-queue-rule | L/D | Documentation board. | — | — | — | n/a |

Target size (noted once, not per row): WCAG 2.1 AA has no target-size criterion (2.5.5 is AAA). In the impl, the scope-chip × is ~16×13, the image-chip × is 16×16, and the panel header and waiting × are 24×24. The board draws the same small controls. Warning.

## Unreachable (spec-only). The state does not exist in this lane.

| id | what makes it reachable | sev |
|---|---|---|
| ai-other-tab | A second project tab with a running chat. The desktop tab strip exists (`apps/desktop/src/strip.html`), so this needs a desktop-e2e (WebdriverIO) scenario. Check that the tab mark has a text equivalent. | blocker |
| ai-needs-tab | Same as above, with a needs-you run in the other tab. | blocker |
| ai-needs-away | The OS notification + Dock badge exist (`apps/desktop/src-tauri/src/notify.rs`). They need the desktop lane. | blocker |
| ai-tereza | A second person's AI on a hub-linked canvas. The tag must keep the same name-first text ("Tereza's AI · …") as the accessible content, not just the avatar. | blocker |

---

## Pass — a11y review

### Contrast (impl pixels, L / D; token maths in brackets)
| pair | L | D | verdict |
|---|---|---|---|
| Running tag `--spark-fg` on `--spark` | 4.78–4.85 [5.37] | 5.73 [6.33] | pass |
| Needs-you tag azure-fg on azure | 4.91 [4.75] | 5.34 [5.83] | pass |
| Working line / step / Stop | 7.77 / 8.46 / 9.31 | 6.36 / 7.10 / 8.00 | pass |
| Canvas row `--fg-2` on `is-sel` tint | 4.76 [4.84] | 4.87 [4.64] | near pass |
| Canvas row "Needs you" `--accent` on tint | 5.08 [4.88] | 4.58 [4.80] | near pass |
| Empty hint / placeholder | 6.04 / 5.04 | 6.31 / 5.12 | pass |
| Scope chip (accent-text on accent-muted) | 8.22–8.54 | 6.20–6.23 | pass |
| Header icons (lowest: chevron) | 3.50 | 4.29 | pass (non-text) |
| Primary button text | 5.37–5.54 [5.71] | 5.44–5.62 [6.26] | pass |
| Chat-list meta (now / crumbs / foot) | 4.62 / 5.19 / 5.68 | 5.13 / 5.63 / 5.92 | pass |
| Disabled Send (empty field) | 2.10 | 2.30 | exempt (disabled, distinguishable) |
| Focus ring: `--accent` / `--accent-text` on `--bg-1` | [5.79 / 9.68] | [6.04 / 14.71] | pass |
| Menu-row focus fill `--bg-3` vs `--bg-2` | [1.10] | [1.12] | **fail (A1)** |

### Keyboard
Panel, chips, attach menu (roving ↑↓), chat list, waiting card, choice card and permission card are all reachable. Gaps: A2 (no field while running), A3 (slash menu), and ai-long (full-height has no key).

### Focus
The shell catch-all `:focus-visible` ring (`3-shell-maude.css:4885-4889`, layer shell) is overridden in layer components by `.ai-scope-item` (A1). Cards that wait for you take programmatic focus and draw a 2 px inset ring (`needs-you.css:46-48`). The connect sheet takes no focus (ai-not-ready).

### Landmarks & structure
The island is `aria-label="AI chat panel"`. Chat-list groups are `section` with labels. The quit dialog has `aria-labelledby` and `aria-describedby`.

### Form labels
Field `aria-label="Message to AI"`. Send `aria-label="Send message"`. Search `aria-label="Search chats"`. Rename `aria-label="Chat name"`.

### Motion
`prefers-reduced-motion` stops the working pulse, collapses ring settle/sweep/glyph pulse, scope-× and token durations. The board's in-app `[data-reduced-motion]` hook (`03 AI Chat.css:164-165`) has no counterpart for the rings.

### ARIA / live regions
One polite `RunLiveRegion` per run surface (`Working.jsx:68-74`). The ticking clock is kept out of it (good). Working, Needs you and Done are announced; Waiting is not (A4). `ActivityBar` (a ticking live region) is no longer mounted.

### Images & media
Attachment `img alt={name}`. Decorative glyphs are `aria-hidden`. The canvas ring overlay is `aria-hidden` (`artboard-activity-overlay.tsx:256`). Its words are carried by the panel live region.

### i18n
n/a for this canvas.

---

## Verdict

```json
{"canvas":"03 AI Chat","critic":"a11y-critic","blockers":12,"warnings":6,"verified_ids":["ai-hero/light","ai-hero/dark","ai-suggest/light","ai-suggest/dark","ai-done/light","ai-done/dark","ai-question/light","ai-question/dark","ai-needs-hidden/light","ai-needs-hidden/dark","ai-permission/light","ai-permission/dark","ai-choice-fail/light","ai-choice-fail/dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```

Blockers: A1–A6 (6) + ai-attach + ai-not-ready (2) + 4 unreachable. Warnings: ai-open, ai-long, ai-chat-list, ai-panel-closed, ai-quit and target size (6). Not counted: the `--accent`-as-text canvas-row word (`canvases.css:151-153`). It passes (token 4.80 / 4.88), so it is listed only as a token swap to `--accent-text`.
