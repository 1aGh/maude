# P8 stage C · C3-timeline — what was fixed, what is open

Branch `p8-c-timeline` from feat/maude-v2 0f6b1242b (after C0). The lead cut the budget mid-run, so this is ONE
sub-step: the timeline island's body. Pairs for 07 (all reachable ids except ve-drop) and 08 · ak-video were re-shot
light + dark with the stage-A harness (`t07.mjs`, `t08.mjs`, retargeted), on the release client of this branch.

## Done (Timeline.jsx + timeline.css, `@layer components`, so no v1 shell rule leaks through)

- **Header (.ve-tl-hd):** ghost play / loop (`icon-btn k-icon-sm`, pressed = kit tint), `0:04 / 0:15` sans semibold
  with the length in fg-2, the video's name chip (`timeline-name`; "This video" + warning title when the shell
  cannot tell), status slot (AI cut · long badge · preparing · Shared · Kept open · **Sound on** meter, which mutes),
  four tools with the board's tooltips (Split at the playhead · S · Add text · Captions from speech · **Add music**),
  divider, Expand. Full adds zoom − bar + and **Fit**. No ×, no jump-to-start, no volume range, no `30 fps · 867f`.
- **Note 26 — nothing deleted:** jump to start, Add image, Shot for AI, Comment (C), Sound on/off, Volume live in the
  Advanced foot's first row (`timeline-more-tools`); Advanced is drawn in Full only (board).
- **Tracks:** one 20 px tinted icon chip per track in a 22 px gutter (132 px + name in Full); no `V1 STORYLINE`,
  no V2/A1/CC ids, no ƒ ▶ ◫ ♪ 🔇 glyphs. Empty tracks draw their lane (`.ve-row--empty`, hint inside: "No sound in
  this video · Add music"); folded tracks are one striped line. Titles that never overlap share a lane
  (`data-lane-join`; every row keeps its testid). The gutter is sticky over horizontally scrolled lanes.
- **Clips:** object-ink filmstrip material with a name chip (ink 78 %, object-grey); titles/graphics are lilac /
  yellow chips with their glyph; selected = 2 px accent ring; moving = lifted −10 px, −1.5°, shadow-lg; waiting =
  quiet grey hatch, missing = hatch + warn edge; trim handles = 8 px accent with grip on hover/selected.
- **Display names:** a "+ Title" goes by its words (`timeline-parse.js` reads the literal; the enumerator's `text`
  is preferred), never "AbsoluteFill"; block title / aria-label in m:ss and "2.5 s", no frame counts.
- **Joins:** round 22 px dots with the transition glyph, named "Transition Oslava → Touchdown"; the picker is
  placed from the dot's rect (keyboard Enter no longer opens it off-screen) and esc returns focus to the dot.
  "+" add-transition: hidden at rest, shown on video-track hover and on `:focus-visible` (a11y R8).
- **Ruler / playhead / flags:** body-face m:ss labels, no tick lines; Poster flag always (default 35 %); loop band =
  accent-tint + 2 px edges (no I/O letters); playhead = line + rounded knob, no "0.00s" tag; marker flags.
- **Music:** bar waveform (not a sine) until peaks are read; beat ticks hang from the top, tall every bar;
  one chip "♫ name · 120 BPM"; the bed is a real `<button>` that selects (no track scrub on press).
- Compact hugs its tracks (the dragged height applies to Full only); the full grip is a 36×4 pill.

## Tests (red → green)

`test/p8-timeline-v2-body.test.tsx` (14): written first, 12/12 red on the old body; the display-name test went red
again with the fix reverted. Updated to the board: `timeline-tracks-render` (readout `0:07 / 0:15`, loop band has no
letters, poster flag at the default frame), `timeline-advanced` (island `size:'full'`, the foot hint). e2e
`timeline-manual-cut` expands before it looks for the zoom. tsc 0, biome 0 errors; lint ratchet: Timeline.jsx back at
baseline (the other 45 ratchet lines on feat are not this branch's). Note: `captions-api`/`caption-lane` fail only in
one combined `bun test` run with the timeline files and pass alone (cross-file state), not from this change.

## Open (not done in this pass)

- **Transition picker styling** (tile thumbnails, 288 px popover, no big preview slab, no "Remove transition (hard
  cut)" link, radiogroup arrow keys) — `joins/transition-picker.jsx`, `joins.css`. Tokens are right since C0.
- **+ Title → select it and open the Title inspector** — needs `app.jsx` onAddTitle to select the inserted clip
  (shared file; `j.seq`/stableId of the new clip from `/_api/insert-sequence`).
- **Scrub only after play** — `apps/studio/video-play-chrome.tsx:112` `started = playing || frame > 0` (poster seek
  counts as started).
- **Advanced overflow** (cards spill out of the island; tracks vanish while open; Copy timecode is a native button) —
  `advanced/advanced.css`, `advanced/foot.jsx`.
- **Drop caret + tip over the timeline**, re-frame window, captions/transcript chips in a footage fixture, comment pins
  (💬 — C7's video comment markers), the ⇄ replace glyph, per-track eye/volume buttons in Full (no per-track feature
  behind them), music bed selection with no comp-media in the lane.
- **Unreachable** (ve-ai-*, ve-render, ve-together, ve-fit-fill): no stub built in this pass.
- ve-drop was not re-shot (the harness step finds no `timeline-storyline` in that state); its stage-A pair stands.
