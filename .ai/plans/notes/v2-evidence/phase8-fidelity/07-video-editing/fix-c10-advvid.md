# Phase 8 stage C round 10 · p8-c10-advvid — 07 Video editing MUSTs of critic-bar5

Branch `p8-c10-advvid` from feat/maude-v2 55850113d. The lead's critic judges the re-shot pairs (ve-formats, ve-advanced, + the whole canvas).

## Done (commit · what · test red → green)

| what | tests |
|---|---|
| **ve-formats** — the `formats` section is headless (the "Formats" row only, no heading above it; the section keeps its aria-label) | `formats-and-reframe-ui` (red before) |
| **ve-advanced M1** — keyframes are diamonds (the board's `.ve-kf`): one at each end of an animated window, outlined, filled where the playhead is, picked ring kept; `timeline-kf-<i>-<k>` is the start diamond, `…-to` the end. `.tl-kf` in the shell CSS is the diamond (no range block) | `timeline-advanced` (2 tests, red with the old Timeline.jsx) |
| **ve-advanced M2** — Easing is a card at the centre top; Render settings + The cut as code are one stacked island in the inspector's column (right, under the Share cluster); both are islands of `.st-body` (portal), the stack declares `data-occludes="right"`; the inspector steps aside (`:has(.tla-layer)`) while Advanced is open | `timeline-advanced` (structure), `p8-c2-insptl` (CSS pins rewritten; the 112 → 168 px floor pin updated, it was red since c9) |

## Open
- While the cards are open the inspector (Clip / Title sections) is hidden — the board frame draws none. Closing Advanced brings it back.
- The tools island (the v1 header's tools) still floats above the island's foot; the board draws it nowhere in this frame.
- Easing card is always drawn (empty state "Keyframe" + the note) — the board draws it with a curve; the fixture picks a keyframe.

## Decisions
- `decision:maude/v2-p8-c10-advanced-cards-in-body` (see kg): cards are islands of the shell body, the inspector steps aside. Rejected: keeping the inspector beside the stack, positioning inside the timeline island, a JS flag on the shell root.
