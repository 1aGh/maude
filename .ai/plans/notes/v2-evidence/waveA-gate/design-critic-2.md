# design-critic: wave-A gate, iteration 2 (canvases 03 · 04 · 11 · 14 · 15)

_2026-10-19 · read-only · opt_out_scope: palette (full DS enforcement) · evidence: `waveA-gate/reshoot/*.png` (dark + light, 1600x1000), iteration-1 evidence for anything the reshoot does not cover. Colours measured from the PNGs with PIL; canvas rules read from `.design/ui/v2/{03,15}*` and `artboard-activity-overlay.tsx`. No server booted._

## TL;DR

| Area | Canvas | Iter 1 | Iter 2 | Gate (>= 4.0) |
| --- | --- | --- | --- | --- |
| AI chat | 03 | 3.6 | **4.0** | pass |
| Modes & Present | 04 | 3.9 | **4.1** | pass |
| Navigation & history | 11 | 4.0 | **4.1** | pass |
| Editing | 14 | 3.4 | **4.0** | pass |
| Annotations | 15 | 3.5 | **3.8** | fail |

**Blockers: 2 (both area 15) · Warnings: 18 · Verdict: fix-and-retry (15 only).**
Seven of the eight iteration-1 blockers are closed with a picture. The eighth (B2 of 15, v1 mono chrome) is closed for the context menus and the sticky toolbar but still open on the sticker gallery. One new blocker: the sticky author line. Both are small, same-file-family fixes.

## Iteration-1 blockers: closed or not

| # | Iter-1 blocker | Status | Proof |
| --- | --- | --- | --- |
| 03-B1 | Banner "Claude (Maude chat) is editing" | **closed** | `ai-done-dark`, `ai-done-light` (working state), `ai-open-dark`, `ai-permission-dark`: no banner; no "Claude" string anywhere on screen. |
| 03-B2 | "Ready · Claude Code" status row | **closed** | Same four shots: header is the chat title row only; the working state is "AI is working 0:15 · Stop" as 03 draws it. |
| 03-B3 | "Not now" red `btn--danger` | **closed** | `ai-permission-dark`: "Not now" plain, "Edit" accent. |
| 04-B1 | Inspect panel flush, truncated, dead `island--pad` | **closed** | `inspect-panel-dark/-light`: 12 px inner pad, group titles inset, labels wrap ("Gap to Combine 2026") instead of truncating, title clear of the cluster, colour row has a swatch. Residue is warnings below. |
| 14-B1 | Artboard name: zoom-scaled mono strip, ~2:1 | **closed** | `ab-label-selected-dark/-light`: constant 11 px sans, azure pill, size in tabular figures ("Homepage 1200 x 900"). Pill text measures dark-on-periwinkle (dark, ~6:1) / white-on-azure (light, ~4.9:1). Unselected labels are 11 px sans `fg-2` ("Pricing", "Reel", "A4 poster" in `shell-dark`, `ctx-object-dark`). |
| 14-B2 | `.dc-context-menu` mono, near-black, hard-coded | **closed** (artboard + object) | `ctx-artboard-*`, `ctx-object-*`: island surface, `--font-body` 13 px, hairline separators, key glyphs right-aligned, first row carries the focus ring, "Move to trash"/"Remove" is the only red row. Light theme matches. |
| 14-B3 | Inspector segments in UA font | **closed** | `inspector-artboard-*`: "Fits content | Fixed" in the row font and size, one line, no clipping. |
| 15-B1 | Vote sheet + bar had no material | **closed** | `vote-sheet-*`: island with title, labelled fields, "Cancel" plain + "Start vote" accent, focus ring on the first box; `vote-bar-*`: island pill "Vote 3 artboards · 3 left of your 3 · 0:30 · 0 done · End vote"; `palette-vote-*`: row "Start a vote..." with meta line "move / open / 1 result". Both themes. |
| 15-B2 | Mono near-black annotation menu, sticky toolbar, gallery headings, section labels | **partly closed** | Sticky toolbar closed (`sticky-toolbar-*`: island, sans, five papers + "+5", "Medium" size, Resolve, Turn into a comment, lock, trash; the B/I/S/U row is gone as 03/15 draw it). Shared menu skin closed. **Open:** gallery heading rows are still mono (new blocker N1). Section labels ("Napady 4") not re-shot. |

## Blockers (must fix)

1. **[ds-typography]** (15, residue of iter-1 15-B2) `stickers-gallery-dark/-light`: "Stamps vote · one each · they count", "Recent", and every pack heading ("FigJam Doodle 24 · by CJ Xue", "Life Style 15 · by Pelin ...", "Opposing Thoughts", "Project status") are mono. 15's CSS has no `font-mono`; README: mono only in Advanced and code. Fix: pack headings in `--font-body`, `--type-xs` semibold `fg-2`, count in tabular figures (gallery under `apps/studio/stickers/`).
2. **[a11y · ds-typography]** (15, new) `sticky-toolbar-dark/-light`: the author line under a selected sticky ("You · just now") is mono, about 9 px, sky blue (110,195,235) on white, measured **1.97:1**, and sits under the bottom resize handles. Canvas 15 draws it *inside* the paper: `.an-st-who`, `--font-body`, `--type-xs`, `--object-ink` at 88% ("at least 5.2:1 on every paper, both themes"), `.an-st--ai` in `--spark-text`. Fix: render it inside the sticky with those rules. Not subject to opt-out.

## Warnings (should fix)

- **[ux · 03]** `ai-done-light.png` is not light and not "done": it is the dark theme in the working state. No light-theme AI evidence at all (`ai-open`, `ai-permission` are dark-only). Re-shoot light before wave B.
- **[ux · 03]** In that same frame the panel says "AI is working 0:15" while all five artboards wear the needs-you ring and "Waiting for you · 3 waiting" (`ai-done-light`); in `ai-permission-dark` five identical dashed rings and tags. Two states at once and loud; 03 draws one ring per target. Decide which state wins when a run is waiting on a permission and a second message is queued.
- **[ux · 03]** Chat still shares the right column with a 440 px empty Inspector island, leaving about 145 px of feed (`ai-done-dark`). Better than iter 1 (about 100 px), still not 03's full-height column. Suspect the shell column, not the panel.
- **[ux · 03]** Still not re-shot (kept warnings per lead): S5.19 copy divider and day dividers, video pin chip, needs-you toast. Also from iter 1: failed-run state, Open switching canvas, point ring, slash menu strings.
- **[ds · 04]** Inspect panel colour row: raw "#111111" and, in dark, a `#111` swatch on a dark panel is invisible (`inspect-panel-dark`; the light swatch shows). 04 draws token name + swatch with an edge. Add an inset hairline to the swatch.
- **[ds-typography · 04/14]** HUD selection tag "Alligators · 595 x 51" and size tag "595 x 51" are mono azure (`inspect-panel-*`). 04 and 14 draw sans. Same family as blocker 1; one class swap.
- **[ux · 04]** Label column wraps to two lines ("Gap to Combine 2026") while its value centres between the lines; widen the label column or truncate with a title. Preview toolbar small strip and Present rows needing desktop/hub lane carry over from iter 1.
- **[ds · 14]** Seven inspector controls use the native `<select>` chevron and heavy native outline: Preset, Kind, Other widths, Content, "1x", "PNG" (`inspector-artboard-*`). The DS select has the quiet chevron. Carry-over.
- **[ux · 14]** Not re-shot, still as iter 1: component picker, minimap card (mono), selection-tag overlap with the project pill, tag-titled shapes ("div Shape"), default Rectangle fill, "Use a style" stale Type, "Edit canvas" undo labels.
- **[ux · 15]** `annot-menu-dark/-light` shows the **artboard** menu ("Duplicate at another width", "Rename", "Start a vote...") with a sticky selected; the sticky's own menu (Turn into a comment, Resolve, Copy, Duplicate, Group, Lock, Ask AI about this sticky; iter-1 `S4.V2/an-sticky-menu`) was not shown. The skin is the shared one and fine; the rows are unproven, and if a right-click on a sticky now opens the artboard menu that is a defect. Re-shoot with the cursor on the sticky.
- **[ux · 15]** "Not printed" tag (`sticky-toolbar-*`) reads well (pill, printer glyph, sans) but sits flush against the top-centre rotation handle; give it 4 px.
- **[ds · 15]** Vote sheet uses native checkboxes, native "2 min" select and a native number box (`vote-sheet-*`); canvas draws DS checkboxes and select. Cosmetic.
- **[ux · 15]** Gallery credits wrap to three 11 px lines ("... Opposing Thoughts ... (source) Project status ..."); gallery opens over the sticky toolbar and cuts it at "Me". Carry-over, tidy.
- **[ux · 15]** Section label rows ("Napady 4"), plan-board colour coding (lead decision, not raised), undo of artboard drag, viewer/figjam lanes: not re-shot.
- **[ds-typography · 11]** "Move ... to" popover header (`.st-dd-hd`, mono uppercase) not re-shot; Versions rows with blank thumbs, "Now" row wrap, compare B pane fit. All carry over from iter 1; none touched by the polish merge.
- **[ux · evidence]** `ab-label-unselected-*` is a duplicate of the selected pill (both files show the azure pill). Unselected is proven only by the full shots. Re-shoot an unselected pair.
- **[ux · 04/14]** Light theme of the Present bar, Preview toolbar and artboard menu parity with 15 untested outside the reshoot set.

## Per-area read

**03 AI chat 4.0.** Task 4, IA 4, States 4 (done card "Undo / Keep going / What AI did · 1 step · 2 s" and the permission card "Edit Site.tsx?" with plain Not now are on-canvas), Interaction 4, Microcopy 4 (v1 "Claude" strings gone from every shot; "Ask for a change, a few variants, or an answer." and "AI works on what the chip says." match), A11y 4 (suggest line now legible). Held at 4.0, not higher, by light-theme absence and the ring/panel state clash.

**04 Modes & Present 4.1.** The Inspect panel was the only blocker and reads like a panel now. Strong chrome unchanged. Warnings above.

**11 Navigation & history 4.1.** No blocker in iter 1. The reshoot adds: sort control ("Recent") sits above the list, outside the tree; foot "6 canvases · ⌘K searches every project" is legible; artboard names now sans (removes two iter-1 warnings). History/trash/move rows were not re-shot, so no further credit.

**14 Editing 4.0.** All three blockers closed with proof, in both themes. Held at 4.0 by native selects, mono HUD tags and the unre-shot warnings.

**15 Annotations 3.8.** Vote sheet/bar and toolbar are the biggest wins (3.5 to 3.8 with the two blockers open; both are a handful of lines). Clear them and 15 lands about 4.1.

## Pass B quick scan (reshoot set)

- Hardcoded values: no raw colours visible; `--dc-ai-azure` tag measures `oklch(0.64 0.165 238)` = (0,151,227) with dark text `oklch(0.18 0.03 238)` (about 6:1), correct per the overlay file.
- Type: mono remains in the sticker gallery, sticky author line and HUD selection tags. Everything else is `--font-body`.
- Surfaces/radii: islands, menus, vote sheet on ladder; no off-ladder radius seen.
- Icons: line, single weight; no emoji in chrome (stickers are user content).
- Status colour: "Move to trash"/"Remove" red only; "Not now" no longer red; "A vote is already open on this canvas." toast has the error edge, correct.
- Hard stops: glass none · gradient none · pastel none (sticky papers are objects) · neumorphism none · 3D none · mascot none.

## Verdict

```json
{
  "agent": "design-critic",
  "iter": 2,
  "gate": "wave-A",
  "scores": { "03-ai-chat": 4.0, "04-modes-present": 4.1, "11-nav-history": 4.1, "14-editing": 4.0, "15-annotations": 3.8 },
  "iter1_scores": { "03-ai-chat": 3.6, "04-modes-present": 3.9, "11-nav-history": 4.0, "14-editing": 3.4, "15-annotations": 3.5 },
  "gate_bar": 4.0,
  "areas_passing": ["03-ai-chat", "04-modes-present", "11-nav-history", "14-editing"],
  "areas_failing": ["15-annotations"],
  "iter1_blockers_closed": 7,
  "iter1_blockers_partly_closed": 1,
  "blockers": 2,
  "warnings": 18,
  "top_blockers": [
    { "category": "a11y", "area": "15", "summary": "Sticky author line is mono ~9px sky blue on white, 1.97:1, outside the paper and under the resize handles", "fix": "Render inside the sticky as .an-st-who (--font-body, --type-xs, object-ink 88%; spark-text for AI)." },
    { "category": "ds-typography", "area": "15", "summary": "Sticker gallery heading rows ('Stamps vote', 'Recent', pack headings) are mono", "fix": "--font-body, --type-xs, semibold fg-2; tabular figures for counts." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
