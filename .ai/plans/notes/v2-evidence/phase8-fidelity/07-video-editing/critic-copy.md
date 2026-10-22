# copy-critic — 07 Video Editing · phase 8 stage B

_2026-10-22 · board `.design/ui/v2/07 Video Editing.tsx` (+ `_video.tsx`) · impl = release client, frames in `.claude/worktrees/agent-af625ef88bd36c798/.scr/impl/07/` · voice: CONTRACT §3 words, §4 voice (studio-grade, no "we", one verb) · strings reviewed ≈ 310_

**Themes.** Copy does not change with the theme. I read every light impl frame and spot-checked the dark ones (ve-export-dark has the same strings). Each row below covers **L·D**, both themes. Per the INDEX, the dark spec is just the host's re-theme.
**Fixture.** Names like `beat-one`, `oslava`, `song.mp3`, `Reel · 320×180`, `e2e-fixture` and "Local project", and the single-format artboards, come from the fixture. They are not findings.

## TL;DR

**Blockers: 21** (13 in-lens + 8 unreachable) · Warnings: 18 · Verdict: **fix-and-retry**

The timeline doesn't talk like the board's timeline. Its header has no video name. The tracks are labelled `V1 STORYLINE`, and Music is missing when it's empty. The tool set is different, and the header shows frame jargon (`30 fps · 867f`, `0.00s`). Its total is one second short of the inspector's Length. Layer names leak from code (`AbsoluteFill`, hashes). The video inspector carries web-page rows ("Page flow"). The video's length never reaches its label.

## Per artboard (L·D)

| id | difference | spec (board) | impl | owner | sev |
|---|---|---|---|---|---|
| ve-none | length missing from the label | `Hype trailer · Reels · 0:15` (Note 1: "Its length rides on the label") | `Trailer` (selected: `Trailer  1280 × 720`) | `apps/studio/editing/artboard-handles.tsx:252-257` (size tag only; no length for video) | blocker |
| ve-select | same label finding | `… · 0:15` | `Trailer 1280 × 720` | as above | (counted) |
| ve-select | video inspector has rows a video doesn't have | Size · Length · Poster frame · Sound · Export | adds **Fill › Background None**, **Layout › Content "Page flow" · Padding · Gap** | `client/v2/inspector/kinds/artboard.jsx:1-12,38`, `artboard-model.js:27` | blocker |
| ve-select | Size names no preset; contradicts Formats | `Size: Reels 9:16` | `Size: Custom` while Formats says `16:9 · this one` | `inspector/kinds/artboard-model.js` presetValue (`'' = Custom`) | blocker |
| ve-select | chrome words the board doesn't draw | title + kind chip, then rows | panel title `Inspector` + ×; section heads `Artboard / Fill / Layout / Formats / Safe zones / Export`; `Formats` heading **and** `Formats` row label | `inspector/frame.jsx`, `inspector/sections.js` | warning |
| ve-select | timeline header: no video name | `▶ ⟳ 0:04 / 0:15 ▭ Hype trailer · Reels` | no name. The scoped-artboard chip only shows when there's more than one comp; its fallback reads `artboard ?` | `client/v2/timeline/Timeline.jsx:1920-1930` | blocker |
| ve-select | track names | Text · Graphics · Video · Music (C35) | `Text · Graphics · Video` + `V1 STORYLINE` badge row. No Music row unless there's audio | `Timeline.jsx:2306-2312` | blocker |
| ve-select | tool set + tooltips | Split at the playhead · S · Add text · Captions from speech · Add music | Split `"Split at playhead (⌘B)"` · `"Add a title overlay at the playhead"` · captions · **image overlay** · **"Add an AI placeholder clip at the end of the storyline"** · **"Comment tool — click anywhere…(C)"**. No Add music | `Timeline.jsx:1958,1970,1976-2012` | blocker |
| ve-select | frame jargon in the compact header | none (frames only under Advanced, Note 26) | `30 fps · 867f` | `Timeline.jsx:2042` | warning |
| ve-select | playhead flag format | m:ss / "2.4 s" (words.js header rule) | `0.00s`, `10.10s` | `Timeline.jsx:193-199` `fmtTime` | warning |
| ve-select | extra close + zoom tooltip | no close (follows selection); zoom = "Zoom the timeline" + `Fit` | `×` "Close timeline"; `"Zoom (⌘+/⌘−, 0 = fit)"`, no Fit | `Timeline.jsx:2054,2061` | warning |
| ve-select | foot hint | `Frame numbers, codec, keyframes, the cut as code` | `Frames, keyframes, the cut as code` | `timeline/advanced/model.js:9` | warning |
| ve-deselect | `Kept open` ✓ (`island-controls.jsx:60`). Inherits the header findings. The menu path "View › Advanced › Keep timeline open ⇧⌘T" wasn't driven | — | — | — | — |
| ve-drop | pill ✓ `Or drop here — adds at the end` | — | — | — | — |
| ve-drop | drop tip not shown (synthetic drag) | `Drop 3 clips at 0:09` / `the video grows by 0:20` | absent. The copy exists and matches | `timeline/edit/words.js:42-58` | warning (unverified) |
| ve-drop / ve-text | layer named after its React component | title text ("PROČ ALLIGATORS") | `AbsoluteFill` block, row `Absol…` | `Timeline.jsx:2514` row label = raw `seq.label` (skips `displayNameOf`, `:105-113`) | blocker |
| ve-trim-split | toast ✓ `Split beat-two at 0:03.` + Undo (fixture name). Trim tip not captured; its copy matches (`words.js:29-35`) | — | — | — | — |
| ve-trim-split | total disagrees with Length | one length everywhere (`0:14`) | readout `0:06` vs inspector `0:07` and artboard `0:07`. Also `0:02` vs label `0:03` (formats) and `0:04` vs `0:05` (captions) | `Timeline.jsx:1948` `mss((totalFrames - 1) / fps)` | blocker |
| ve-trim-split | clip Length format | `2.5 s` (one decimal) | `3 s`. Volume/Framing are absent, but only because the fixture's beats are JSX (`clip.jsx:72-75 visual()`) | `inspector/kinds/clip.jsx:80-105` | warning |
| ve-move-transition | `Drop before Touchdown` tip not captured; copy ✓ `words.js:60-65` | | | | warning (unverified) |
| ve-transition | tiles ✓ Cut · Fade · Slide · Wipe · Flip · Clock wipe. `Length 0.5 s` ✓ and `Hover a tile to play it.` ✓ | | | | |
| ve-transition | second action in the foot | only the hint line | `Remove transition (hard cut)` (parenthetical jargon) | `timeline/joins/transition-picker.jsx:233` | warning |
| ve-text | toast after an edit has no Undo | edit toasts carry `Undo` (ve-trim-split, ve-text board) | `Title added.` (× only) | `client/app.jsx:2479` | warning |
| ve-text | Title inspector not opened. Rows Font · Colour · Motion · Length unverified | | | `inspector/kinds/title-rows.jsx` | — |
| ve-captions / ve-footage | missing tile is titled by its asset hash | human file name (`dron-areal-klesani-9s.mov`), hash only under Advanced | `aaaa1111.mp4` · `Missing — no device has it` ✓ · `Relink…` ✓ | `apps/studio/asset-placeholder.tsx:47`, display name from the shell (may be fixture) | warning |
| ve-music | Sound contradicts the timeline | `Sound: Hype instrumental 80 %` | `Sound: None yet` while the Music track holds `song.mp3 · 120 BPM` | `inspector/kinds/artboard-video.jsx:47` | blocker |
| ve-formats | format row has no name (320×180) / name style | `Reels 9:16 · this one` | blank `· this one` (Reel), `9:16 this one` | `inspector/sections/formats.jsx` | (part of the Size/Custom blocker) |
| ve-reframe | re-frame island not reached (footage missing, fixture) | `Frame “Touchdown” for` · `Follow a subject` · Reset · Done | — | `timeline/reframe-island.jsx` | warning (unverified) |
| ve-play | status + step hint missing from the code | `Sound on` meter; `Step ← → one frame · ⇧ one second`; play tip second line `hold space and drag to pan` | none of the three (title attr `Pause — tap space` only) | `Timeline.jsx:1862-1871`. grep finds no "Sound on" / "one second" UI string | blocker |
| ve-fullscreen | `esc Back to the canvas` ✓ (`present/video-present.jsx:27`). Format switcher absent because there's one format (fixture) | | | | ✓ |
| ve-export | title/primary don't name what they make | `Export “Recap”` · primary `Export 3 videos` | `Export 1 artboard` · `Export` | `client/v2/export/export-sheet.jsx:95,255-261` (`selectionLabel` never passed by any caller) | blocker |
| ve-export | captions choice cut to two | `Burned in · As a file · Both · Off` (C36 .srt) | `Off · Burned in` | `export/sections/video.jsx:222-236` | blocker |
| ve-export | Sound line claims music that isn't there | (`Sound only makes one file — the formats share their sound.` when formats > 1) | `Sound: Music, mixed as on the timeline` on a video whose inspector says `Sound: None yet` | `export/sections/video.jsx:213-218` (unconditional) | blocker |
| ve-export | render choice missing | `In the cloud` / `On this Mac` with `About 6 min. Keep this window open until it's done.` | only `1 file · about 6 MB · about 45 seconds on this Mac` (local project; might be fixture) | `export/sections/video.jsx` | warning |
| ve-long | `Compact` ✓. No `Fit`, no fold counts (`Text · 18`). Fold copy exists in `timeline/fold.js:20-24`. Zoom tooltip: see ve-select | | | | warning |
| ve-advanced | panel headings/lines differ | `Render settings` · `Easing · NAUČÍME TĚ HRÁT` · `video-nabor.edl.json · Open in code view` | `This video` · `Keyframe` + `Pick a keyframe on a clip to see its curve.` · `The cut as this video describes it · Open in code view` · extra `Copy timecode` | `timeline/advanced/render-settings.jsx`, `easing-curve.jsx`, `cut-as-code.jsx` | warning |
| ve-advanced | foot readout ✓ `30 fps · frame 0 of 867 · 00:00:00:00`. Extra cap note `Long videos / One export goes up to 2:00 (3,600 frames at 30 fps).`, which overflows. The copy is fine (C22) | | | `advanced/video-cap.js` | warning |

Code-only (not in a frame, same surfaces):
- Error toasts don't follow "what happened · what is safe · one verb": `Title refused …` and `Title failed: network error` (`client/app.jsx:2478,2483`). Warning.
- Empty timeline: `No video-comp on this canvas … ⌘K → New video… … <VideoComp>` (`Timeline.jsx:2068-2071`) uses dev jargon. The contract word is "New video" via ⌘K / New artboard › Video. Warning.

## Unreachable (missing state → blocker each)

| id | what makes it reachable |
|---|---|
| ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust | A signed-in AI run in the capture lane: a scripted ACP run or a finished-run fixture on 12 clips. The copy mostly exists (`ai/video/card-model.js`, `timeline/ai-edge.jsx`, `timeline/other-takes*.js`). **`Shots land here as AI places them.` exists nowhere in the client** (videoEmpty line, ve-ai-watch), so that's a copy gap too. |
| ve-render | Export jobs that run or finish in the browser lane (a render stub feeding the jobs list). The words are in `export/exports-model.js`. |
| ve-together | A second peer on a linked hub editing a caption (`timeline/peers.jsx` has the copy). |
| ve-fit-fill | A real drop of a vertical clip on a 16:9 artboard (`timeline/fit-fill.jsx`, `music-hint.jsx`). |

## Root causes (hit several artboards)

1. **Timeline header and track vocabulary are v1's.** There's no video name, `V1 STORYLINE` / `V2` lane ids, frame counts in the header, `0.00s` flags and overlay/storyline tooltips (`Timeline.jsx:193-199, 1920-2061, 2306-2312`). This hits every timeline artboard.
2. **Readout total = (frames − 1) / fps** (`Timeline.jsx:1948`), so the timeline is one second shorter than the inspector and the artboard scrub.
3. **Row labels skip `displayNameOf`.** You get component names (`AbsoluteFill`) and hashes (`0fce5…`) (`Timeline.jsx:2248,2514` vs `:105-113`).
4. **Artboard inspector shows the web-page sections for every kind.** "Page flow" and Padding/Gap appear on a video (`inspector/kinds/artboard.jsx`).
5. **The Export sheet gets no selection facts.** No label, so the title is `Export 1 artboard`. The sound and captions rows are static (`export-sheet.jsx:95`, `sections/video.jsx:213-236`). The same cause shows up in 09.

## Verdict

```json
{"canvas":"07 Video Editing","critic":"copy-critic","blockers":21,"warnings":18,"verified_ids":["ve-fullscreen·light","ve-fullscreen·dark"]}
```
