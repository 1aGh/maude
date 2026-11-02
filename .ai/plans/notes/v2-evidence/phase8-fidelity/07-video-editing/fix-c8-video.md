# P8 stage C round 8 · p8-c8-video — what was fixed, what is open

Branch `p8-c8-video` from feat/maude-v2 (merged again at 89551df72 for `portalToBody`). Scope: 07 critic-bar3 MUST items + 06 ad-timeline.
Nothing here is marked "matches" — the lead's critic judges.

## Done (commit · what · test red → green)

| what | tests |
|---|---|
| **R1 — the Full timeline's per-track button** (`.ve-lab-b`): an eye on Text / Graphics, a speaker on Video / Music (turns to "mute" when every clip is muted); a real `<button>` with `aria-label` "Hide Text" / "Mute Video" / "Unmute Music", `aria-pressed`, disabled on an empty track / no edit right; drawn in Full only. One click = ONE `clip.track` edit op (new, `edit-ops/clip/track.ts`): hide = the clip menu's `{false && (…)}` as a SET state (never a toggle, a half-hidden track hides the rest), mute = the bare `muted` attr (clips and loose `loose:` beds). One write → one undo step. No new comp vocabulary, no format change. `MusicInfo.muted` added to `video/derive.ts` so a bed's state reads back | `p8-c8-video-track-op` (6, op in the table red when un-registered), `p8-c8-video-track-button` (render + pure model, red with the button removed) |
| **R2 — "beat-three" over "Video"**: in Full every lane row printed its own clip name in the gutter beside the track chip (`.tl-row-label-text`); now only a LAYER row names itself | CSS-rule pin in `p8-c8-video-track-button` |
| **ve-captions**: picking a caption chip selected the caption, then the canvas's own `select` echo (after the seek) released it, so the inspector stayed Video — measured live (`onCanvasSelect` → `release()` within 900 ms). `pickCaption` shields the echo like "+ Title" | `p8-c8-video-caption-pick` (red without the shield) |
| **ve-text**: the title card is Font · Colour · Motion · Length; the Text textarea + Apply text moved under Advanced, the "Rewrites the title text…" helper line is gone | `clip-inspector-rows` (rewritten) |
| **ve-reframe**: one hint (the count line), the second note only for a read-only viewer; the Framing row is the board's one select with Re-frame… / Other takes… on a line under it (no stacked wrap) | `formats-and-reframe-ui` |
| **ve-export footer (shared with 09)**: the footer names the lane the Render row PICKED (`estimateForLane`) | `p8-c8-video-export-footer` |
| **lead note**: the timeline's body portals (`Timeline.jsx` ×5, `edit/drop.jsx`, `other-takes.jsx`, `reframe-island.jsx`) use `portalToBody`; `portal-scope` DEBT is empty | `portal-scope`, the timeline / reframe / drop suites |
| harness (`_c8v-harness-g3/`): ve-play = loop range I…O + playing; ve-export answers the estimate with the cloud Render row so the two cards are drawn | — |

## Open
- Light-theme clip fill: the board's `.ve-clip` is `--object-ink` too — the product matches; the difference is the footage picture (fixture's footage is missing → black). Not changed.
- "Title · Slide up" tag on the artboard: lives in the canvas iframe overlay (canvas-lib, shared) — not started.
- Music "Fade in · out" (feature, not built).
- ve-formats / ve-reframe format pills and "Shared by 3 formats": need a 3-format fixture (the harness opens the single-format video, so the pills are not drawn).
- ve-long fold rows / ruler markers / 132 px track column: need a 24-beat fixture with markers.
- ve-advanced extra tools row + easing curve; 06 ad-timeline keyframe diamonds + easing: the fixtures have no keyframe data (the product draws `Pick a keyframe on a clip`); needs a clip with keyframes in the harness.
- Hide on Text/Graphics is the existing persisted clip Hide (the clip is not exported while hidden), not a preview-only eye — the same as the clip menu's Hide.

## Decisions
- `decision:maude/v2-p8-c8-video-track-op`: the per-track button is one new edit op `clip.track` (ids[] + hidden | muted), not N per-clip calls. Rejected: N `clip.audio` / `/_api/toggle-hide` calls (N undo steps, the v1 route has its own seq undo); a view-only (non-persisted) eye (a second state a render would not honour).
- `decision:maude/v2-p8-c8-video-title-text-in-advanced`: a title's words are edited under Advanced, not on the card. Rejected: deleting the field (no other way to edit a title's text).
