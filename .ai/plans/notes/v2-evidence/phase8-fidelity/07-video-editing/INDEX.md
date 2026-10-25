# Phase 8 fidelity — 07 Video Editing (stage A evidence)

Branch p8-fid-g3 from feat/maude-v2 6d780ab1b. SPEC = the board artboard rendered from a scratch copy of this repo's .design (capture origin, camera pinned to 100%; the Stage's note strip is cropped off the pair for 1440×900 stages). IMPL = the release-built v2 client in Playwright Chromium (1440×900 viewport) with a window.__TAURI__ stub, throwaway HOME/XDG, claude stubbed signed-out.

**Themes.** None of 07/08/09 draws a dark artboard: every artboard is a light-pinned `<Stage>`. The "dark" SPEC half is the same board with the host's dark tokens applied (the canvas shell re-themes un-pinned artboards by default), so it is NOT a designed dark state; judge dark IMPL against the app's own dark tokens, not against it.

**Fixtures (impl).** The spec boards are drawn on the Alligators brand canvases. The impl side uses the e2e fixture project + this repo's Alligators Recruiting Trailer (24-beat real cut) + a small mixed-kind "Matchday" canvas (social post+story, web page, 2 print A6, 16:9 video) made for this pass. So content, artboard counts (6 vs 21) and canvas counts (13 vs 93) differ by construction, and the video fixtures' footage is absent ("Missing — no device has it"). (fixture) marks a difference caused only by that.

Pair image: `07-video-editing/<id>-<theme>.jpg` (spec left, impl right; label strip "<id> · <theme>"). Full size: see full-size-path.txt.

| artboard id | theme | state | how reached | impl reachable? | first-glance differences |
|---|---|---|---|---|---|
| ve-none | light | Nothing selected — no timeline | open the Alligators Recruiting Trailer (24 beats), ⌘0, nothing selected | yes (one real video artboard (spec: three artboards on a social canvas)) | Different canvas: spec = a social canvas with three artboards (post 4:5, Reels 9:16, 16:9) at a 22% camera; impl = ONE real 1280×720 trailer filling the window (fixture). Spec has the project tab strip + Saved/avatar-pair cluster + undo/redo/zoom-% pill bottom-left; impl has a "Local project" chip and no undo/redo/zoom pill. |
| ve-none | dark | Nothing selected — no timeline | open the Alligators Recruiting Trailer (24 beats), ⌘0, nothing selected | yes (one real video artboard (spec: three artboards on a social canvas)) | as light (spec dark = host re-theme, not drawn) |
| ve-select | light | Select it — the timeline slides out of it | click the video artboard, then its crumb | yes | Spec: chip "Hype trailer · Reels · 0:15 1080 × 1920"; inspector is a small floating card (Size / Length / Poster frame with thumbnail / Sound / Export MP4 / Advanced); timeline = compact bar under the artboard with a notch arrow, poster flag, thumbnails, 4 labelled tracks, waveform. Impl: inspector is a full-height docked panel with many more rows (Fill, Layout, Formats, Safe zones, Export presets); poster frame has no thumbnail, Sound "None yet"; the timeline overlaps the video and shows a blue storyline with + insert buttons, no thumbnails or waveform. |
| ve-select | dark | Select it — the timeline slides out of it | click the video artboard, then its crumb | yes | as light (spec dark = host re-theme, not drawn) |
| ve-deselect | light | Switch, deselect, keep it open — the timeline's rules | ⇧⌘T keeps the timeline open, then click away | partially — the state (Kept open) is reachable; the four-step diagram and the rules card are board explanation, not app UI | The spec artboard is an EXPLAINER (four miniature app windows, a rule table, the View › Advanced menu). The app can only show the resulting state — the timeline with "Kept open" after ⇧⌘T. The menu path (View › Advanced › Keep timeline open) was not driven. |
| ve-deselect | dark | Switch, deselect, keep it open — the timeline's rules | ⇧⌘T keeps the timeline open, then click away | partially — the state (Kept open) is reachable; the four-step diagram and the rules card are board explanation, not app UI | as light (spec dark = host re-theme, not drawn) |
| ve-drop | light | Drop footage — on the artboard or the timeline | synthetic dragenter/dragover with a file over the timeline | partially — synthetic drag events; a real Finder drag was not driven | Spec: "+ Or drop here — adds at the end" pill on the artboard and the tooltip "Drop 3 clips at 0:09 — the video grows by 0:20" with a caret. Impl (synthetic drag): the pill appears on the artboard; the timeline shows no drop caret or tooltip. |
| ve-drop | dark | Drop footage — on the artboard or the timeline | synthetic dragenter/dragover with a file over the timeline | partially — synthetic drag events; a real Finder drag was not driven | as light (spec dark = host re-theme, not drawn) |
| ve-trim-split | light | Trim an edge; S splits at the playhead | select beat 2, press S | yes | Spec: split playhead, tooltip "Touchdown · 2.4 s −0.6 s · video 0:14", toast "Split Oslava at 0:10. Undo" at the top centre. Impl (3-beat fixture): split works, toast "Split beat-two at 0:03." at the bottom centre over the timeline, labels are code names (beat-one), no thumbnails; clip inspector shows Length 3 s / Speed 1× only (spec adds Volume, Framing). |
| ve-trim-split | dark | Trim an edge; S splits at the playhead | select beat 2, press S | yes | as light (spec dark = host re-theme, not drawn) |
| ve-move-transition | light | Drag a clip to move it | mouse down on beat 1, drag right, shot mid-drag | yes | Spec: a clip dragged between neighbours with a drop tooltip "Drop before Touchdown" + snap line; clip inspector (Length, Speed, Volume 70%, Framing). Impl: the drag leaves the previous toast on screen, the inspector is the whole-artboard one (drag did not select the clip), no drop indicator captured. |
| ve-move-transition | dark | Drag a clip to move it | mouse down on beat 1, drag right, shot mid-drag | yes | as light (spec dark = host re-theme, not drawn) |
| ve-transition | light | Click a join for a transition | click join (seam) 0 | yes | Spec: compact popover "Oslava → Logo" with six thumbnail tiles (Cut/Fade/Slide/Wipe/Flip/Clock wipe) and a length slider, anchored on the join. Impl: picker opens at the join but is unstyled — tiles are bare text labels over a beige "logo" slab, mono type, "Remove transition (hard cut)" link; larger than its trigger and overlaps the artboard. |
| ve-transition | dark | Click a join for a transition | click join (seam) 0 | yes | as light (spec dark = host re-theme, not drawn) |
| ve-text | light | A title with motion | timeline Add title (T) | yes | Spec: title selected on the artboard with a floating "Title" inspector (Font, Colour, 6 Motion presets, Length) and toast "Captions added — 15 words from the interview". Impl: Add title makes a red "Title" block in a serif face, toast "Title added.", the inspector did not open, the new Text track row reads "Absol…" (a raw component name). |
| ve-text | dark | A title with motion | timeline Add title (T) | yes | as light (spec dark = host re-theme, not drawn) |
| ve-captions | light | Edit the talk as text; style the captions | Captions tab | yes | Spec: Transcript card with struck words ("Ehm…" red), caption chips on a track, Captions inspector (Font, Highlight, Position, Words at a time, Also as a file). Impl: footage missing (fixture) → hatched "Missing — no device has it / Relink…" tile; generic video inspector; no transcript card, no caption chips. |
| ve-captions | dark | Edit the talk as text; style the captions | Captions tab | yes | as light (spec dark = host re-theme, not drawn) |
| ve-music | light | A music bed: beats, lower under speech, volume | open VideoMusic, select, click the bed | yes | Spec: Music inspector (Volume 80%, Lower under speech, Snap to the beat, Fade in·out, Song Change…) and a beat-marked waveform. Impl: Music row "song.mp3" with a generic wave + BPM, inspector stayed on the artboard (click on the bed did not select it), no beat ticks. |
| ve-music | dark | A music bed: beats, lower under speech, volume | open VideoMusic, select, click the bed | yes | as light (spec dark = host re-theme, not drawn) |
| ve-ai-cut | light, dark | 11 · 12 clips in, a 0:30 cut out — on the beat | — | **no** — AI cut: needs a signed-in Claude run on 12 clips; claude is stubbed signed-out | spec only: `ve-ai-cut-light-spec-only.jpg` |
| ve-ai-watch | light, dark | 12 · AI watches 12 clips | — | **no** — AI cut in progress: needs a live AI run | spec only: `ve-ai-watch-light-spec-only.jpg` |
| ve-ai-scrub | light, dark | 13 · Scrub while AI is still cutting | — | **no** — AI cut in progress: needs a live AI run | spec only: `ve-ai-scrub-light-spec-only.jpg` |
| ve-ai-proposal | light, dark | 14 · Done — the cut is on the artboard | — | **no** — AI cut done: needs a finished AI run + chat recap | spec only: `ve-ai-proposal-light-spec-only.jpg` |
| ve-ai-adjust | light, dark | 15 · Change a shot by hand — swap a take | — | **no** — swap a take after an AI cut: needs a finished AI cut | spec only: `ve-ai-adjust-light-spec-only.jpg` |
| ve-formats | light | Three formats, one edit | open VideoFormats, select | yes | Spec: four linked artboards (Reels, 16:9, 1:1, unlinked 16:9 copy) with link glyphs; inspector Formats list + "Make an unlinked copy". Impl: one dark 9:16 artboard (fixture) with a Formats list of one (9:16 this one + Add a format); no sibling artboards, no link glyphs, no unlinked-copy button. |
| ve-formats | dark | Three formats, one edit | open VideoFormats, select | yes | as light (spec dark = host re-theme, not drawn) |
| ve-reframe | light | Re-frame a clip — fit, fill, follow | clip block | partially — clip inspector with a Framing row; no re-frame window / follow-the-player preview | Spec: "Frame “Touchdown” for" window with the source frame, crop rectangles per format and a "Follow a subject" switch. Impl: no re-frame window at all (footage missing → hatched tile; the clip inspector Framing row exists elsewhere). |
| ve-reframe | dark | Re-frame a clip — fit, fill, follow | clip block | partially — clip inspector with a Framing row; no re-frame window / follow-the-player preview | as light (spec dark = host re-theme, not drawn) |
| ve-play | light | Play in place, loop a range, step frames | timeline play | yes | Spec: playing with a Pause tooltip, loop range (blue handles), "0:07 + 2 frames / 0:15", "Sound on" meter, step hint "Step ← → one frame ⇧ one second". Impl: plays (pause lit, 0:04/0:06) but no loop band, no key hints, no sound meter; stale toast remains. |
| ve-play | dark | Play in place, loop a range, step frames | timeline play | yes | as light (spec dark = host re-theme, not drawn) |
| ve-fullscreen | light | Full-screen preview | Present mode via the share cluster | yes | Spec: dark stage, format switcher top-left (Reels 9:16 · 16:9 · 1:1), video centred at its aspect, floating pill (pause, loop, 0:10/0:15, scrub with ticks, volume, captions). Impl: black (the Remotion preview does not paint in this lane), no format switcher, pill sits on the bottom edge, volume is a full blue slider. |
| ve-fullscreen | dark | Full-screen preview | Present mode via the share cluster | yes | as light (spec dark = host re-theme, not drawn) |
| ve-export | light | Export — every format at once | ⇧⌘E on the video artboard | yes | Spec: ONE sheet for the four formats of a canvas — checkbox tiles (Reels 9:16 / 16:9 / 1:1 / copy), Format MP4/GIF/Sound only, Quality, Captions Burned in/As a file/Both/Off, two-radio card "In the cloud / On this Mac", primary "Export 3 videos". Impl: single-artboard sheet with a Scope row (Selection / This canvas / Folder 19 / Whole project 19), a one-row Formats list, Captions Off/Burned in, a caption strip "No speech to caption", no cloud-vs-Mac choice (a line "about 45 seconds on this Mac"), primary "Export". Type is smaller/tighter than the spec. |
| ve-export | dark | Export — every format at once | ⇧⌘E on the video artboard | yes | as light (spec dark = host re-theme, not drawn) |
| ve-render | light, dark | 21 · Rendering, done, partly done | — | **no** — render states need running/finished export jobs; none run in the browser lane | spec only: `ve-render-light-spec-only.jpg` |
| ve-footage | light | Footage not here yet; 4K clips still preparing | open VideoTranscript (its footage file is absent), select | partially — only the Missing + Relink state; no "waiting for Jonas’s Mac" owner line, no preparing bars | — |
| ve-footage | dark | Footage not here yet; 4K clips still preparing | open VideoTranscript (its footage file is absent), select | partially — only the Missing + Relink state; no "waiting for Jonas’s Mac" owner line, no preparing bars | as light (spec dark = host re-theme, not drawn) |
| ve-together | light, dark | 23 · Tereza fixes a caption while you trim | — | **no** — two-person collab on one video; needs a second peer on a linked hub | spec only: `ve-together-light-spec-only.jpg` |
| ve-long | light | 24 clips — zoom out, fold tracks, jump by marker | Expand the timeline on the 24-beat cut | partially — 24 beats not 40; no fold-tracks / marker jump in the app | Spec: 4:12 match, 40 clips, fold rows "Text · 18 / Graphics · 6", zoom slider + Fit, drag handle on top, Compact at the right. Impl: 24 beats (fixture), Expand/Compact works, no fold counts, no zoom slider label, clip blocks are blue boxes without thumbnails, timeline covers the lower third of the video. |
| ve-long | dark | 24 clips — zoom out, fold tracks, jump by marker | Expand the timeline on the 24-beat cut | partially — 24 beats not 40; no fold-tracks / marker jump in the app | as light (spec dark = host re-theme, not drawn) |
| ve-fit-fill | light, dark | 25 · A vertical clip on 16:9; a video with no sound | — | **no** — vertical-clip ask appears on dropping a vertical clip; no real file drag in the lane | spec only: `ve-fit-fill-light-spec-only.jpg` |
| ve-advanced | light | Advanced — frames, curves, the cut as code | Expanded timeline, open Advanced | yes | Spec: floating Render settings / Easing curve / "The cut as code" (EDL / Code) cards beside the artboard plus an expanded timeline with a frames readout. Impl: one Advanced strip inside the timeline (fps/frames/codec/bitrate/colour, Keyframe "Pick a clip", cut as code EDL/Code, Copy timecode); cropped by the timeline height, a "Long videos" note overflows the window bottom, no easing graph. |
| ve-advanced | dark | Advanced — frames, curves, the cut as code | Expanded timeline, open Advanced | yes | as light (spec dark = host re-theme, not drawn) |

## Coverage

- artboards on the board: 26
- pair images (id × theme): 36
- artboards with no impl frame (spec-only): 8 — ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust, ve-render, ve-together, ve-fit-fill

## After — stage C3-timeline (p8-c-timeline)

The pairs above were re-shot (light + dark) on the C3 release client — except **ve-drop** (harness step failed; the
stage-A pair stands). "after" judges the timeline island only; the inspector (C2), toasts (C1), canvas chrome (C5) and
export (C4) are other areas. Details: `fix-timeline.md`.

| artboard id | after (timeline) |
|---|---|
| ve-select · ak-video (08) | header, chips gutter, clip material, joins, poster flag, ruler, playhead match; no thumbnails for missing footage (fixture) |
| ve-long · ve-advanced | Full header (zoom − bar +, Fit, Compact), grip, Advanced in Full only; Advanced overflow still differs (open) |
| ve-play | Sound on chip, loop band style match; on-screen Step/Pause tips still differ |
| ve-transition | join dot + keyboard placement fixed; picker styling still differs (open) |
| ve-trim-split · ve-move-transition | names on chips, trim handles, lifted clip style; toast is C1 |
| ve-text | title named by its words; Title inspector on insert still open (app.jsx) |
| ve-music | bars waveform, ticks from the top, "name · BPM" chip, bed selects when comp-media knows it |
| ve-captions · ve-footage · ve-reframe | missing/waiting hatch; transcript / re-frame not reachable with the fixture |
| ve-none | scrub-at-rest still differs (video-play-chrome.tsx, open) |
| ve-deselect · ve-formats · ve-fullscreen · ve-export | timeline parts match where shown; rest belongs to other areas |

## After — stage C round 2 (p8-c2-insptl)
Pairs re-shot light + dark on branch p8-c2-insptl. Changed: ve-transition (no slab, tile pictures, tip, keyboard), ve-advanced (contained, tracks stay, quiet Copy timecode), ve-play (scrub bar only after play), ve-text (+ Title selects the clip). Unreachable (spec only, no stub): ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust, ve-render, ve-together, ve-fit-fill; ve-drop not re-shot. Details: `08-artboard-kinds/fix-insptl.md`.

## After (stage D, 6d19daa9a) — p8-d-g3

Re-shot on the stage C round 2 tip (feat/maude-v2 6d19daa9a), release-built client, 1440×900 Chromium, throwaway HOME/XDG, claude stubbed signed-out. No product code touched. Evidence only — match / mismatch is judged by the critic re-check. Pairs: `<id>-<theme>.jpg` here (spec left, impl right); full size: `full-size-path.txt`.

**SPEC side: reused.** `.design/ui/v2/07 Video Editing.{tsx,css}` has no commit since the stage A shot, so the stage A spec PNGs were copied over unchanged.

**IMPL side, per artboard id × theme (light, dark):**

| artboard id | after (stage D) |
|---|---|
| ve-none, ve-select, ve-deselect, ve-long, ve-advanced, ve-fullscreen | re-shot, light + dark (Alligators Recruiting Trailer, 24-beat cut) |
| ve-drop | re-shot, light + dark — the stage C shot was missing (harness step failed once the camera moved); selection now clicks inside the artboard's own box. Still synthetic dragenter/dragover, not a Finder drag |
| ve-move-transition, ve-trim-split, ve-transition, ve-text, ve-play, ve-export, ve-music, ve-formats, ve-captions, ve-footage, ve-reframe | re-shot, light + dark. ve-play and ve-text now have the artboard selected with the timeline open (the stage C round 2 frames had lost the selection because a fixed click point missed the artboard) |
| ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust | unreachable — need a signed-in Claude run on footage; spec only (`*-spec-only.jpg` from stage A stay) |
| ve-render, ve-together, ve-fit-fill | unreachable — running or finished render jobs / a second peer on a linked hub / dropping a vertical clip from Finder; spec only |

Harness notes: the What's New panel (pending `next` entries) opens over a fresh project and is now closed by `run.mjs` before shooting; the footage in the Matchday / Trailer fixtures is absent, so video frames are the "Missing — no device has it" tile, as in stage A. ve-fullscreen is still black in this lane (the Remotion preview does not paint). Stage A and earlier "after" tables above are history.

## After (stage C round 4 / stage D) — p8-c4-video

Re-shot light + dark with the stage-D g3 harness on this branch's release client (`t07.mjs`). Lane change: Google Chrome instead of the bundled Chromium (`SHOT_CHANNEL=chrome` in `lib.mjs`), so H.264 footage decodes and the pictures are real. The ve-fullscreen black is NOT a product bug: the Trailer cut opens on a black frame (a fade up); the stage paints the moment the cut plays — the step now seeks to 37 % first. Overwrites the `<id>-<theme>.jpg` pairs; the critic judges. Changed this round: the inspector video card (one flat list: Size · Length · Poster picture + ghost Change · Sound · Export MP4; no Formats / Safe zones / Export sections on a lone video), the island under its video (canvas re-fit on summon / Full / Advanced), a digital comp's beats on one Video lane, lift + "Drop before …", the drop caret on the Video lane, the transition picker foot, Advanced = floating cards + frame ruler, the play / step key tips, "+ Title" keeps its selection (the Title inspector opens), the full-screen bar, the music inspector, a quiet video badge. Done / open: `fix-c4-video.md`.

| artboard id | after (round 4) |
|---|---|
| ve-none, ve-select, ve-deselect, ve-long, ve-advanced, ve-fullscreen, ve-drop, ve-move-transition, ve-trim-split, ve-transition, ve-text, ve-play, ve-export, ve-music, ve-formats, ve-captions, ve-footage, ve-reframe | re-shot, light + dark |
| ve-ai-*, ve-render, ve-together, ve-fit-fill | unreachable (as before; the `*-spec-only.jpg` stand) |

## FINAL (stage D2, d3881fe41) — p8-d2-g3

Every reachable id re-shot on the merged tip (release-built client, Google Chrome channel for H.264, light + dark), IMPL side only; spec frames reused from stage D (the board .tsx files and .design are byte-identical to the stage-D copy: `git diff 6d19daa9a HEAD -- .design` is empty). No match/mismatch judged here. Pairs: full-size-path.txt (last line).

| artboard id | light | dark |
|---|---|---|
| ve-none | re-shot (one real video artboard (spec: three artboards on a social canvas)) | re-shot (one real video artboard (spec: three artboards on a social canvas)) |
| ve-select | re-shot | re-shot |
| ve-deselect | re-shot (the state (Kept open) is reachable; the four-step diagram and the rules card are board explanation, not app UI) | re-shot (the state (Kept open) is reachable; the four-step diagram and the rules card are board explanation, not app UI) |
| ve-drop | re-shot (synthetic drag events; a real Finder drag was not driven) | re-shot (synthetic drag events; a real Finder drag was not driven) |
| ve-trim-split | re-shot | re-shot |
| ve-move-transition | re-shot | re-shot |
| ve-transition | re-shot | re-shot |
| ve-text | re-shot | re-shot |
| ve-captions | re-shot | re-shot |
| ve-music | re-shot | re-shot |
| ve-ai-cut | unreachable — AI cut needs a signed-in Claude run over 12 clips; claude is stubbed signed-out (no AI-cut stub exists in the harness) | unreachable — AI cut needs a signed-in Claude run over 12 clips; claude is stubbed signed-out (no AI-cut stub exists in the harness) |
| ve-ai-watch | unreachable — AI cut in progress needs a live AI run | unreachable — AI cut in progress needs a live AI run |
| ve-ai-scrub | unreachable — AI cut in progress needs a live AI run | unreachable — AI cut in progress needs a live AI run |
| ve-ai-proposal | unreachable — a finished AI cut + chat recap needs a live AI run | unreachable — a finished AI cut + chat recap needs a live AI run |
| ve-ai-adjust | unreachable — swapping a take after an AI cut needs a finished AI cut | unreachable — swapping a take after an AI cut needs a finished AI cut |
| ve-formats | re-shot | re-shot |
| ve-reframe | re-shot (footage in the fixture is missing, so the window frames a hatch, not a picture) | re-shot (footage in the fixture is missing, so the window frames a hatch, not a picture) |
| ve-play | re-shot | re-shot |
| ve-fullscreen | re-shot | re-shot |
| ve-export | re-shot | re-shot |
| ve-render | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) |
| ve-footage | re-shot (only the Missing + Relink state; no "waiting for Jonas’s Mac" owner line, no preparing bars) | re-shot (only the Missing + Relink state; no "waiting for Jonas’s Mac" owner line, no preparing bars) |
| ve-together | unreachable — two people on one video needs a second peer on a linked hub | unreachable — two people on one video needs a second peer on a linked hub |
| ve-long | re-shot (24 beats not 40; no fold-tracks / marker jump in the app) | re-shot (24 beats not 40; no fold-tracks / marker jump in the app) |
| ve-fit-fill | unreachable — the vertical-clip ask appears only on dropping a real vertical clip; the lane has no real file drag (synthetic drag events carry no video metadata) | unreachable — the vertical-clip ask appears only on dropping a real vertical clip; the lane has no real file drag (synthetic drag events carry no video metadata) |
| ve-advanced | re-shot | re-shot |

Totals: 38 id×theme re-shot, 14 unreachable (spec-only frames kept from stage A/D).

Harness notes (D2): lane = Google Chrome (`SHOT_CHANNEL=chrome`, H.264). ve-fullscreen is shot ~2.5 s after pressing play from the 37 % poster moment (0:11), re-trying from other scrub points if the stage is black (a paused seek does not repaint; a later moment of the cut can be dark). ve-reframe now selects the video first, so the Re-frame window opens (it frames a hatch: the fixture footage is missing). ve-render = the real Exports panel with a seeded job list (route intercept on GET /_api/export-jobs; no render runs), newly reachable. The AI-cut, together and fit-fill ids stay unreachable (no AI / second-peer / real-file-drop stub in the lane).

## Round 7b re-shoot (p8-c7-g0607b, light + dark, all 21 reachable ids)

Product since the last pairs: a video artboard's label reads `Name · Format · Length` (round 7a); an artboard kind outside the four
resolves like no kind. Harness changes (`_c7o-harness-g3/`), where a MUST was the shot, not the product:

- **ve-trim-split** is the **Full** timeline (the board draws Full, not Compact), S splits at the playhead (toast + Undo), then the first half's right edge is dragged left and HELD while the shot is taken: the trim tip (`beat-two · 0.7 s` over `−0.3 s · video 0:06`) is on screen.
- **ve-captions** (t07c) runs on a copy that HAS its media: the interview's footage (the picture is real, not a hatch), the transcript sidecar read, "Captions from speech" pressed — the Transcript card (words, the "Select words and press delete" foot) and the caption chips in the lane are drawn; the first chip is selected.
- **ve-music** (t07c) has the song file and its beats sidecar, so the bed carries a waveform + BPM label; the song's name is the file's ("song"), the board's "Hype instrumental" is fixture naming.
- ve-play (paused, loop on, two frames stepped) from round 7a.

Not done, and why (see `../06-advanced/fix-c7-oboard.md`): music **Fade in · out** needs a new edit op + a render path (the product has no music fade), the Captions inspector does not replace the video's when a caption chip is selected, ve-text has no "Title · Slide up" tag on the artboard.

## FINAL (D5, e37e7d82a) — p8-d5-g3

Final verification shoot after stage C round 7, on the merged tip (release-built client, Google Chrome channel, Mac mini, light + dark), IMPL side only; spec frames reused unchanged (the 07 board is unchanged since the D4/round-7 spec shots). Harness `_d5-harness-g3/` (`chain.sh 07` = `t07` all reachable ids, then `t07c` for ve-captions + ve-music on a project with its footage and song). Shot at `0ef942d45` (= tip + the D5 harness only). No match judged here.

| artboard id | light | dark |
|---|---|---|
| ve-none, ve-select, ve-advanced, ve-fullscreen, ve-move-transition, ve-trim-split (Full timeline, held trim), ve-play, ve-export, ve-text, ve-formats, ve-transition | re-shot | re-shot |
| ve-captions, ve-music | re-shot (t07c: footage + transcript, song + beats present) | re-shot (t07c) |
| ve-long | re-shot (24 beats, not 40; no fold-tracks / marker jump in the app) | re-shot (same) |
| ve-deselect | re-shot (state "Kept open" only; the diagram and rules card are board explanation) | re-shot (same) |
| ve-drop | re-shot (synthetic drag events; no real Finder drag) | re-shot (same) |
| ve-footage | re-shot (Missing + Relink state only; no owner line, no preparing bars) | re-shot (same) |
| ve-reframe | re-shot (the e2e-fixture footage is absent: the window frames a hatch) | re-shot (same) |
| ve-render | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (same) |
| ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust | unreachable — needs a live signed-in AI cut run (claude is stubbed signed-out); spec-only frames stand | unreachable (same) |
| ve-together | unreachable — a second peer on a linked hub | unreachable (same) |
| ve-fit-fill | unreachable — the vertical-clip ask needs a real vertical file dropped; the lane has no real file drag | unreachable (same) |

Totals: 38 id×theme re-shot (19 ids), 14 unreachable (7 ids). The committed `*-spec-only.jpg` for ve-render-light is stale (ve-render-light is now a pair). Harness note: t07 logs `MEDIA_ELEMENT_ERROR ... aaaa1111.mp4` page errors (the fixture's interview footage is a missing/placeholder file in the t07 lane; t07c replaces it with real media) — not harness-caused.

## Round 8 (p8-c8-video) — pairs re-shot light + dark (impl frames overwritten in this folder)
Changed and visible: the Full timeline gutter buttons (eye on Text / Graphics, speaker on Video) in every Full shot; the lane names once (no "beat-three" over "Video"); ve-captions shows the Captions inspector; ve-export draws In the cloud / On this Mac and the footer names the picked lane; ve-play is the playing frame with a loop range; the title card has no Text field. Details: `fix-c8-video.md`. ve-formats / ve-reframe still need a 3-format fixture; ve-advanced / 06 ad-timeline keyframes need keyframe data (06 ad-timeline NOT re-shot this round).
