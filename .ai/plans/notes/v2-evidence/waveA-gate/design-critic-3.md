# design-critic: wave-A gate, iteration 3 (area 15 re-score, area 03 hold check)

_2026-10-19 · read-only · opt_out_scope: palette · evidence: `waveA-gate/reshoot2/*.png` (dark + light, 1600x1000). Colours measured from the PNGs with PIL; rules read from `.design/ui/v2/15 Annotations.css` and `03 AI Chat.css`. No server booted._

## TL;DR

| Area | Iter 2 | Iter 3 | Gate (>= 4.0) |
| --- | --- | --- | --- |
| 15 Annotations | 3.8 | **4.1** | pass |
| 03 AI chat | 4.0 | **4.1** | pass (holds) |

**Blockers: 0 · Warnings: 6 (new or still open, in scope) · Verdict: pass.**

## Iteration-2 blockers

1. **Sticker gallery headings mono: CLOSED.** `stickers-gallery-dark.png` / `-light.png`: "Stamps vote · one each · they count", "Recent", "FigJam Doodle 24 · by CJ Xue", "Life Style 15 ...", "Opposing Thoughts 20 ...", "Project status 80 ..." are all the body sans, about 11 px, semibold, `fg-2`. Measured 5.86:1 (dark) and 5.77:1 (light). The count reads as a figure beside the name. No mono left in the gallery.
2. **Sticky author line: CLOSED.** `sticky-author-dark.png` / `-light.png`: "You · just now" now sits inside the paper at the bottom-left, in the body sans at `--type-xs`, well clear of the resize handles. Ink on paper measures 8.4:1 at the darkest stroke (canvas floor is 5.2:1), identical in both themes because the paper is an object colour. Matches `.an-st-who`.

## Other polish-2 items

- **Sticky's own menu: shown and correct.** `annot-menu-sticky-dark/-light`: "Turn into a comment", "Resolve", "Fan out", then Copy / Cut / Paste / Duplicate with key glyphs, four order rows, "Group selection" (disabled on a single sticky, correct), "Lock", "Ask AI about this sticky", and "Move to trash" as the only red row (4.97:1 light). Focus ring on the first row. Island skin, sans, hairline groups. This clears the iter-2 worry that a sticky right-click opened the artboard menu.
- **Selection / size tags sans:** `ai-*` and `sticky-*` shots show the "On A4 poster · moves with it" and "Not printed" tags in sans; no mono HUD tag visible in this set.
- **Inspect swatch edge:** not in the reshoot2 set, so not re-verified here; carried as a note, not a blocker.

## Warnings (should fix)

- **[ux · 15]** "Not printed" tag still touches the top-centre rotation handle in both themes (`sticky-author-*`); in light the handle overlaps the last letters. Give it 4 px of clearance.
- **[ux · 15]** Gallery credits still wrap to three 11 px lines with two sources run together ("... Opposing Thoughts (source) Project status ..."); the sheet also covers the right half of the bottom toolbar.
- **[ds · 15]** Vote sheet native checkboxes / select / number box and the section-label rows ("Napady 4") were not re-shot; unproven.
- **[ds-typography · 03]** In both themes the chat's role label ("AI") and the tool chip ("Edit home") are mono uppercase (`ai-permission-light`). 03's CSS keeps mono only in Advanced, slash menu and log rows; the shared `.chat-msg-role` rule in `6-acp-chat.css` is the cause. Same in dark, so it is not a new regression. One class swap.
- **[ux · 03]** The light permission card ("Edit Site.tsx?") ends with small "Not now" / "Edit" buttons tight against the card's bottom edge, and the feed is short (the Inspector island still takes the upper column). Unchanged from dark.
- **[a11y · note]** "Group selection" disabled row measures 2.89:1; disabled controls are exempt, so this is not a blocker.

## Area 15 read (4.1)

Task 4, IA 4, States 4 (done and menu states shown), Interaction 4, Microcopy 4, Parity 4, A11y 4 (author line and gallery headings now pass; menu red 4.97:1). Both iter-2 blockers closed with a picture in both themes. Held below 4.3 by the tag/handle clash, the credit wrap and un-reshot vote-sheet controls.

## Area 03 hold check (4.1)

Light theme now proven (`ai-done-light`, `ai-permission-light`): panel on white island, body text 9.2:1, "What AI did" 5.8:1, suggest line 5.5:1, "Edit home" chip 5.6:1, role label 6.1:1, "Waiting for you" pill white on (0,116,195) 4.76:1, "Needs you" in the tree. Layout and strings match the dark shots and 03: "Done — home is calmer...", "Undo / Keep going", "What AI did · 1 step · 1 s", "Whole canvas", plain "Not now" + accent "Edit". No "Claude" strings, no banner. The iter-2 warning that `ai-done-light` was a dark shot is closed. Area 03 holds above the bar; the mono role label is the only new note.

## Hard stops

glass none · gradient none · pastel none (papers are objects) · neumorphism none · 3D none · mascot none.

## Verdict

```json
{
  "agent": "design-critic",
  "iter": 3,
  "gate": "wave-A",
  "scope": "area-15 + area-03 hold",
  "scores": { "15-annotations": 4.1, "03-ai-chat": 4.1 },
  "iter2_scores": { "15-annotations": 3.8, "03-ai-chat": 4.0 },
  "gate_bar": 4.0,
  "iter2_blockers_closed": 2,
  "blockers": 0,
  "warnings": 6,
  "top_blockers": [],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": true
}
```
