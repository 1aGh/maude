# critic-final — 07 Video Editing · phase 8 stage D2 (merged tip d3881fe41)

One critic, four lenses. Read: D2 pairs (light for every reachable id, dark for ve-select / ve-formats / ve-render; dark shares the layout of light in every pair), INDEX FINAL section, critic-d, stage B reports, fix-c4-video, fix-timeline.
**Result: 0 of 26 ids match.** Round 4 closed much of the island and inspector work: flat video card, island under its video with the notch, one Video lane, Advanced as floating cards, picker foot, Title inspector opens, full-screen bar, music inspector. What is left is the same short list on every id.

## Remaining root causes (RC)
- RC-1 label and chip form: label reads "Trailer 0:29" / "Reel · 320×180", never "Name · Format · 0:15  1080 × 1920"; length disagrees across label / Length row / readout (0:29 vs 0:28; 0:07 vs 0:06). `canvas-lib.tsx` label row, `artboard-handles.tsx:252`, `Timeline.jsx` total.
- RC-2 inspector: Size reads "Custom" (spec "Reels 9:16"), Poster frame has a black chip and no picture, Sound "None yet", no `Hype instrumental` row (partly fixture). Formats row for a lone video differs (ve-formats shows no Formats list, no "Make an unlinked copy", no safe-zone select).
- RC-3 timeline clip material: black blocks with code names (beat-one, beat-two-90), no thumbnails, no Music bed/label on most shots, "+ Add music / ask AI for a track" hint lane (fixture footage); the poster flag collides with the 0:10 ruler label.
- RC-4 toast: v1 pill "Split beat-two at 0:03." / "Title added." with an x and no Undo; the split toast persists into later steps (trim-split, text).
- RC-5 not drawn: Transcript card + caption chips + Captions inspector, fold rows / ruler markers / 132 px track column (ve-long), easing graph + frames ruler content (ve-advanced), "Drop N clips at …" tip over a populated lane, loop band set in ve-play, re-frame crop window with a picture, "waiting for Jonas's Mac" owner line.
- RC-6 ve-export: single-artboard sheet (Scope row, one-row Formats, file name / Save to, "Export"), no "In the cloud / On this Mac" cards, no "Export 3 videos"; the Captions default is Off.
- RC-7 ve-fullscreen: no format switcher, pill sits on the window edge, stage is plain black, picture is the wrong frame; "Back to the canvas" pill hugs the edge.
- RC-8 ve-render: Exports panel is a plain list; no Share-cluster ring, no done / partly-done toasts with Show in Finder / Retry.
- RC-9 canvas chrome: "Local project" chip in place of Saved + avatars (state, arguably fixture), 32 px toolbar.

## Table
| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ve-none | light, dark | differs | RC-1 (label "Trailer", no format / length form), RC-9 |
| ve-select | light, dark | differs | RC-1 (0:29 vs 0:28), RC-2 (Custom, poster picture, Sound), RC-3 (no thumbnails, flag over 0:10, no Music label) |
| ve-deselect | light, dark | differs (cannot confirm: board is a four-window explainer; app shows only the Kept-open island, no inspector, tiny 320×180 artboard) | RC-1, RC-3 |
| ve-drop | light, dark | differs | tooltip over the lane is drawn but no ghost clips / caret on a populated Video lane; artboard 320×180 pill ok; RC-1, RC-2, RC-3 |
| ve-trim-split | light, dark | differs | RC-4, RC-2, RC-3; no split tooltip / trim readout, Compact not Full; no −0.6 s tip |
| ve-move-transition | light, dark | differs | clip lifts and its Clip inspector opens, but no "Drop before …" tip / landing line in the shot; Volume + Framing rows differ; RC-3 |
| ve-transition | light, dark | differs | picker is styled now; it sits over the artboard, tile pictures black (fixture), a hatch/broken frame behind; RC-3 |
| ve-text | light, dark | differs | Title inspector opens but Font "Default" not Club Display, Motion/Length differ, no "Title · Slide up" tag on the artboard, play glyph over the serif title, RC-4 |
| ve-captions | light, dark | differs | RC-5 (no transcript / chips / Captions inspector), hatch tile; RC-2 |
| ve-music | light, dark | differs | inspector present; no "Fade in · out", no title head "Hype instrumental" (shows "song"), "Lower under speech" off, Cut to the beat extra row, no speech lane over the bed |
| ve-formats | light, dark | differs | RC-2 (no Formats list / unlinked copy / safe zones), no sibling artboards (fixture), blue-on-black artboard fill |
| ve-reframe | light, dark | differs | window opens but frames a hatch, window overlaps the artboard top, inspector shows Missing card instead of Length / Speed / Volume / Framing; no "Follow a subject" in view (cannot confirm) |
| ve-play | light, dark | differs | tips drawn; loop band not set, no "+ 2 frames", RC-2, RC-3 |
| ve-fullscreen | light, dark | differs | RC-7 |
| ve-export | light, dark | differs | RC-6 |
| ve-render | light, dark | differs | RC-8 |
| ve-footage | light, dark | differs | RC-5 (no owner line, no preparing bars, no File / Status inspector), black Missing clip with warn edge instead of hatch |
| ve-long | light, dark | differs | RC-5 (no fold rows, no track column, no markers), RC-3; full header and grip match |
| ve-advanced | light, dark | differs | floating cards present, but no easing graph, extra first tools row + "Long videos" note, ruler not in frame numbers in the shot, RC-3 |
| ve-ai-cut / watch / scrub / proposal / adjust | light, dark | unreachable | recorded `aiCut` store fixture or ACP stub |
| ve-together | light, dark | unreachable | seeded second-peer state (`peers.jsx`) |
| ve-fit-fill | light, dark | unreachable | `clip.insert` of a vertical clip so the Fill/Fit/Blur ask shows |

```json
{"canvas":"07 Video Editing","dir":"07-video-editing","match":[],"match_one_theme":{},"differs":["ve-none","ve-select","ve-deselect","ve-drop","ve-trim-split","ve-move-transition","ve-transition","ve-text","ve-captions","ve-music","ve-formats","ve-reframe","ve-play","ve-fullscreen","ve-export","ve-render","ve-footage","ve-long","ve-advanced"],"unreachable":["ve-ai-cut","ve-ai-watch","ve-ai-scrub","ve-ai-proposal","ve-ai-adjust","ve-together","ve-fit-fill"]}
```
