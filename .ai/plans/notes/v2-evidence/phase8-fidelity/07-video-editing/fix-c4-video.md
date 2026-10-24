# P8 stage C round 4 · c4-video — what was fixed, what is open

Branch `p8-c4-video` from feat/maude-v2 1ed20a976. Budget ran over (about 2x the brief's 300k), so the open list at the foot is
real. Pairs for 07 re-shot light + dark (harness `.scr/t07.mjs`, lane = Google Chrome, see INDEX). Nothing is marked "matches".

## Done (commit · what · test red → green)

| commit | what | tests |
|---|---|---|
| a265c8110 | **Video inspector card = 07's one flat list**: Size · Length · Poster frame (22 x 38 footage picture + time + ghost Change) · Sound · Export (one MP4 button → `export.open`); no "Artboard" heading; Formats + Safe zones only when the video has other formats or Cmd-K "Add a format" asks (`formatsUi.presence/asked`); the generic Export section stands aside for a video | `kind-inspector-rows` (rows, no section, ghost Change, picture), `formats-and-reframe-ui` (lone video has no Formats, Cmd-K draws them with the list open) — red on the old card; Formats gate revert-checked |
| 81d6b1a24 | the live `export.sizes` slot (S8) stands aside for a video artboard too | `v2-inspector-export` — red with the `when` reverted |
| 40b9c0fae | **island under its video**: once at rest and covering the video it points at (or Advanced's cards), the shell posts one `reveal-artboard` (insets-aware fit) — nothing else moves the camera (I1 holds) | `p8-c4-video-island-refit` (pure `artboardUnderIsland` + wiring pins) |
| f811e9492 | transition picker foot is the board's one line; "Remove transition (hard cut)" lives under the clip inspector's Advanced (note 26: not deleted) | `timeline-clip-select` rewritten |
| ace74346d | **a digital comp's beats share one Video lane** (was a staircase, one row per beat); a beat open into layers keeps its own lane | `p8-timeline-v2-body` (2 tests) — red with the lane join reverted |
| 9e04f5c82 | a lifted beat (reorder drag) lifts and the Video lane shows the landing line + "Drop before …" | same file — red with the lane condition reverted |
| 6f58a647a | full-screen bar: sound icon alone, volume opens on hover/focus, tinted pause chip | `present-only-formats` |
| 1e2596e1b, 556f65898 | **Advanced = floating cards** (Render settings · Keyframe · The cut as code) above the island, island keeps its height, tools row an island of its own, ruler opens in frames, cards cap at 230 px (canvas needs >= 240 px of free height or it ignores every inset) | `p8-c2-insptl` rewritten |
| d5501b8e5 (**shared canvas-lib.tsx**, CSS only) | the camera badge on the label row is quiet at rest (hover / focus shows it) | `p8-c4-video-css` |
| a06c0cc17 | the play button's key tip ("Pause — tap space / hold space and drag to pan") and the step tip ("Step ← → one frame · ⇧ one second") are drawn (07 ve-play) | `timeline-tracks-render` |
| fa6e7f425 | pressing a clip selects it (the lifted clip wears the ring and its inspector) | `p8-timeline-v2-body` |
| 30fe5154b + 99438b381 (**shared app.jsx**, 5 lines) | "+ Title" selects the clip AND keeps it: the canvas reloads the rewritten file and echoed a `select` 200 ms later that released it (measured live); `timelineSelection.shield` | `p8-c4-video-selection-shield` |
| 358d638ec | files dropped on a digital comp's Video lane use the storyline lane: caret + "Drop N clips at …" | `p8-timeline-v2-body` |
| 556f65898 | music inspector: Change… = kit button with the music glyph, Cut to the beat a ghost button, head = the song's name, volume slider has its track | `music-inspector` |

**ve-fullscreen black.** Two causes: (1) the lane — the bundled Chromium has no H.264 (use Google Chrome, `SHOT_CHANNEL=chrome`);
(2) the Trailer cut opens on a black frame (fade up). Pressing play paints the stage (the re-shot pair seeks to 37 % and plays). One
**possible product defect left open**: seeking while PAUSED in Present moves the time but the Remotion canvas does not repaint
(black until play) — not investigated further (`present-media.ts` / the comp's `canvas` video layer).

## Open (not done)

- Size select reads "Custom" for the fixture's 320x180 / 1280x720 videos — correct for a non-catalogue size (spec shows "Reels 9:16").
- Fold rows ("Text · 18"), ruler markers (Výkop…), per-track eye / volume buttons, Music row label when empty: all data- or
  fixture-driven (fold is a per-viewer choice; the fixtures have no markers) — not drawn without data.
- Transcript card + caption chips, Captions inspector (ve-captions): the fixture has no speech / footage; the `Transcript` surface exists.
- Re-frame window (ve-reframe): the harness now clicks Re-frame…; with the fixture's missing footage it frames a hatch.
- Music inspector: "Fade in · out" row (no fade data in the product), the title-head chip on the bed, lower-under-speech marker.
- Label form "Name · Format · 0:15  1080 x 1920", Saved + avatar chips, 40 px toolbar (canvas chrome, C5's).
- ve-formats: sibling artboards + "Shared by 3 formats" need a fixture with three formats; the Formats section itself now follows the board.
- Unreachable: ve-ai-*, ve-render, ve-together, ve-fit-fill (no stub built).
- biome: `advanced.css` `.tla-btn` has a duplicate `appearance` (from round 2, not touched here).

## Decisions
- `decision:maude/v2-p8-c4-video-card-is-flat`: a video artboard's inspector is the board's flat card; Export is a row, Formats/Safe zones join only with other formats (Cmd-K "Add a format" opens them). Rejected: keeping the Formats section always (the critic's extra section), deleting "Add a format" (note 26).
- `decision:maude/v2-p8-c4-video-island-reveal`: one `reveal-artboard` when the island/cards cover the video. Rejected: moving the camera on every inset change (breaks §5.6 I1), pinning the island to the artboard's bottom (loses the notch-at-the-window-foot placement the dock relies on).
- `decision:maude/v2-p8-c4-video-advanced-floats`: Advanced's cards float above the island (supersedes `v2-p8-c2r2-advanced-grows-the-island`). Rejected: the island growing (the board draws cards beside the artboard, the timeline unchanged).
- `decision:maude/v2-p8-c4-video-selection-shield`: a short shield on `timelineSelection.release()` after a programmatic pick. Rejected: delaying the pick (races the reload), ignoring canvas selects while a clip is selected (breaks "one thing selected").
