# P8 stage C round 9 · p8-c9-video — what was fixed, what is open

Branch `p8-c9-video` from feat/maude-v2 (9557e9de1). Scope: 07 critic-bar4 MUST items + 06 ad-timeline.
Nothing here is marked "matches" — the lead's critic judges.

## Done (commit · what · test red → green)

| what | tests |
|---|---|
| **F1 — the Full body shows ruler + 4 lanes at rest** (`timeline.css` `.tl-scroll` min-height 112 → 168; the Full panel itself never shorter than 266 px = padding + head + body + Advanced foot, because the shell's default timeline height is 216 and the foot used to hang out of the island) | `p8-c9-video-timeline` (CSS-rule pins, red on the old CSS) |
| **ve-play — "I" and "O" handle badges** on the loop range (`loop-handle.jsx`): accent chips on the ruler at both ends, draggable, ← → step one frame (⇧ one second), `role=slider` + "Loop start" / "Loop end"; I / O keys unchanged; a press on a badge never scrubs the ruler | `p8-c9-video-timeline` (render + keys + pure `moveLoopEnd`, red without the component) |
| **ve-music — beat ticks were never visible**: the overlay (`.tl-music-ov`, ticks + volume line) had no z-index and was painted UNDER the song's block (z 2). z-index 4 → a tick per beat, a tall one per bar | CSS-rule pin |
| **ve-reframe — format pills are the scope** (lead decision `maude/v2-p8-c9-reframe-format-pills`): the header's pills are each format of the video; the "This format \| All formats" segment is gone; the count line is read (`sr-only`, `role=status`), not drawn; a video with no linked formats frames its one shared window (no `format` in the write) | `formats-and-reframe-ui` (rewritten + 2 new) |
| **ve-reframe — a photo clip draws its picture**: the island put every url in a `<video>`, so an image clip showed a black box; an image url is an `<img>` now | `formats-and-reframe-ui` |
| **gutter buttons never took a real click**: the lane's `onTrackDown` captured the pointer on the lanes, so the click on the fold / eye / speaker buttons landed on the lanes (the c8 render tests used `el.click()` and never saw it). A press inside `.tl-track-cap` is the button's | `p8-c9-video-timeline` (red: seeks `[0, 0]`) |
| **harness fixtures** (`_c9v-harness-g3/fxv.mjs`): `HypeFormats` (one cut, Reels · 16:9 · 1:1), `NaborKeyframes` (a title with `interpolate` + `Easing.bezier` — diamonds, the Easing card's curve), `ZapasLong` (40 clips, 18 titles, 6 graphics, 4 markers); scenarios `t07v` (ve-formats, ve-reframe, ve-export, ve-long, ve-advanced) and `t06v` (ad-timeline) | — |

## Open (and why)
- **"Title · Slide up" tag on the artboard (item 6) — not built.** The canvas DOM carries no clip identity: a `<Sequence name>` renders no element and `TitleMotion` only forwards `data-cd-id`, which is not the clip's `stableId` (`name:…` / `mclip:…` / `Comp#n`). So neither the shell (no geometry of the title) nor the canvas (no way to know which element is the selected clip) can draw it today. Proposal: a new parent-gated dgn `timeline-clip-tag { id, stableId, label }` posted by the shell on clip select, plus `data-clip-id` on the `Sequence` wrapper `video-comp` renders; the canvas draws the existing `.ed-name-tag` pattern under that element. Needs its own commit (dgn rule) and a decision.
- **Captions "Also as a file" (item 5) — not wired, on purpose.** There is no caption-file writer: the exporter writes no `.srt` / `.vtt`, and the export sheet itself holds "As a file" and "Both" disabled ("not in this version yet"). `captionsFileFlag` has no store to register; wiring a switch now would be a switch that does nothing. Build the writer first (renderer + the sheet's `captions: file | both`), then `registerCaptionsFileFlag` from the export state.
- **Easing / Render settings / cut-as-code cards**: the board has the Easing card at the centre top and Render settings + the cut as code stacked at the right (in the inspector's column); the product keeps the three cards in one band above the timeline (c4-video decision). Moving them to the top needs the inspector hidden while Advanced is open — not done.
- ve-long: with Text / Graphics folded the Full panel keeps its 266 px floor, so there is empty space under Music (the board's island shrinks to its rows).
- Music "Fade in · out" (feature), ve-footage "Waiting for Jonas's Mac", AI-cut and together ids (unreachable) — as before.

## Decisions
- `decision:maude/v2-p8-c9-loop-handles`: the loop band's ends are slider badges inside the ruler (one small component, `playbackStore.setLoop`), not a new store or a new key map. Rejected: badges drawn by CSS pseudo-elements on `.tl-loop` (not draggable, no keyboard).
- `decision:maude/v2-p8-c9-full-panel-floor`: the Full panel gets a CSS `min-height` equal to its parts instead of raising the shell's default `timelineHeight` (216 in `use-shell-core.jsx`, a shared file). Rejected: bumping the default (also moves compact-to-full resizing and every persisted height).
- `decision:maude/v2-p8-c9-gutter-press`: a press inside the track gutter (`.tl-track-cap`) is never a lane scrub. Rejected: `stopPropagation` on each of the three gutter buttons (the next gutter control would repeat the bug).
