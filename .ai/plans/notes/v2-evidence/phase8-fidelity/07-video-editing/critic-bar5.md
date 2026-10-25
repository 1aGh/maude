# critic-bar5 — 07 Video Editing · verified bar (v2-michal-verified-bar), round-9 merged tip (6d96b9aa1 + harness)

Judged fresh from the round-9 pairs (light and dark read for every id called verified); full-size impl frames opened for trim-split, formats, reframe, transition, play, music, long, advanced, export, text, captions, move-transition, render. No shot re-taken, no code edited.

Lead decisions honoured (not MUST): owning board wins (09 export sheet + Exports panel, 04 present fill, 14 inspector sections such as "Clip" / "Music"), esc chip, timeline raw keys, music Fade not built, "Title · Slide up" tag deferred, captions "Also as a file" deferred (no writer), note-26 extras (Cut to the beat row, tools row above the timeline), re-frame format pills = scope, no auto tracker (so no "Follow a subject"), the 2 min long-video guard kept (nothing-deleted).

Round-9 fixes confirmed in the shots: Full timeline shows ruler + all four lanes (trim-split, long, advanced); I / O loop badges on the ruler (play); beat ticks visible over the song (music, both themes); Formats list / link badges / Shared by 3 formats / Make an unlinked copy (formats); format pills in the re-frame header, Reset + Done only (reframe); three-format export sheet "Export 3 videos"; 40-clip fold rows + markers (long); keyframed title + Easing card with curve (advanced).

## Per id
- ve-none · verified (L, D) · none (the reveal-inspector chip at the right edge is shell chrome, polish)
- ve-select · verified (L, D) · none
- ve-deselect · verified (L, D) · none (open View menu = side row)
- ve-drop · verified (L, D) · none (OS drag image = side row)
- ve-trim-split · verified (L, D) · none (F1 fixed: ruler, Text, Graphics, Video, Music all in the body; held trim tip, toast + Undo, Fit / Compact, eye + speaker buttons drawn)
- ve-move-transition · verified (L, D) · none (lift, tilt, landing line, drop tip drawn; Volume + Framing rows absent only because the fixture beat has no media)
- ve-transition · verified (L, D) · none (six tiles, Length slider, hover hint, picker anchored on the join with its notch)
- ve-text · verified (L, D) · none (Font / Colour / Motion tiles / Length card matches; "Title · Slide up" tag = recorded deferral, polish)
- ve-captions · verified (L, D) · none (Transcript card + Captions inspector + word chips drawn; "Also as a file" = recorded deferral; struck-word state = side row)
- ve-music · verified (L, D) · none (beat ticks now visible in both themes; Fade = feature deferral; Cut to the beat row = note-26 extra)
- ve-formats · differs · M1 — the Video inspector draws a "Formats" section heading AND a "Formats" row label (the board has the row only); make the `formats` section headless like `safe-zones` (sections.js, the 08 precedent)
- ve-reframe · verified (L, D) · none (pills Reels 9:16 / 16:9 / 1:1 are the scope; Reset + Done; "Follow a subject" + "#1 followed" box need the tracker that the video-intelligence decision left out = side row, cannot confirm; Volume row absent because the clip is a photo)
- ve-play · verified (L, D) · none (I / O badges on the loop range, pause + loop on, Pause tip with the space chip, "Sound on" chip; Step tip = side row)
- ve-fullscreen · verified (L, D) · none (esc chip, transport pill, scrub, sound, captions; format switcher = side row, one-format fixture)
- ve-export · verified (L, D) · none (sheet layout is 09's; three formats ticked, Format / Quality / Captions / Render cards, "Export 3 videos"; Captions "Both" disabled and cloud-not-default per 09 / sign-in)
- ve-render · verified (L, D) · none (Share-cluster ring, Exports panel Queued / progress / Ready / partly-done + Retry, cloud foot per 09; done and partly-done toasts = side rows)
- ve-footage · unreachable · the board draws "Waiting for Jonas's Mac" (a second device preparing the clip); the shot is the Missing + Relink state
- ve-long · verified (L, D) · none (header, grip, Full layout, "Text · 18" / "Graphics · 6" folded to striped lines, ruler markers Výkop / TD 1 / Poločas / TD 2; hover name tag = side row)
- ve-advanced · differs · M1 — keyframes are drawn as range blocks (`.tl-kf`, from..to) not the board's diamonds (◇ at each keyframe, filled at the playhead); M2 — Easing / Render settings / The cut as code are one band of three cards over the artboard above the timeline, the board puts Easing centre-top and Render settings + the cut as code stacked in the inspector's column (fix-c9 "Open"; no lead decision overrules it)
- ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust · unreachable (live signed-in AI cut run)
- ve-together · unreachable (second peer on a linked hub)
- ve-fit-fill · unreachable (needs a real vertical file dropped)

## Polish list
- all · Size reads "Custom" for 320×180; Poster chip black; Sound "None yet"; clip names beat-one…; black / hatched clip blocks (footage missing); "Local project" chip vs Saved + avatars; zoom % differs; the "Poster" flag touches a ruler label by a few px
- ve-none · one trailer vs three artboards; extra reveal-inspector chip at the right edge (shell chrome)
- ve-select, ve-text, ve-captions, ve-music, ve-transition, ve-move-transition, ve-play, ve-formats, ve-reframe · timeline drawn Compact (Expand) where the board draws Full (lane names, Fit slider); Full is proven in trim-split, long, advanced
- ve-text · Font "Default" vs Club Display, Colour white vs Club green, Motion None vs Slide up, Length "3 s" stepper vs "2.2 s"; toast reads "Title added." without Undo (board: "Captions added — 15 words" + Undo); "Title · Slide up" tag deferred (kg v2-p8-c9-title-tag-and-caption-file-deferred); no word-chip lane (fixture has no speech)
- ve-captions · Transcript card has a close "×" the board does not draw (the panel must be dismissible); Font / Highlight "Default"; "Also as a file" deferred
- ve-music · extra "Cut to the beat" row (note-26, confirmed); Fade row not built; Lower-under-speech off, song name "song"; the "Lower under speech" lane label absent (toggle off)
- ve-formats · "Make an unlinked copy" is a quiet underlined link, the board draws a bordered button; Safe zones "None" vs Instagram Reels; only the 16:9 sibling is in frame (zoom 25 %, inspector over the rest)
- ve-reframe · window overlaps the artboard top; the picture is a portrait photo, not the wide shot; extra "Re-frame…" link under Framing (the entry point); inspector "Clip" section heading (per 14)
- ve-play · loop-range tint across the lanes is faint
- ve-long · ruler labels collide with the marker chips ("1:" under Poločas, "3:30" under TD 2); the 4:12 / 3600-frame guard card + warning chip (kept v1 rule, fixture is 30 fps) ; playhead at 0:00 vs 2:13
- ve-advanced · extra tools row above the timeline (note-26, confirmed); "Long videos" block in the Render settings card (kept v1 rule)
- ve-export · light-theme preview frame is blank white while the dark shows the picture (load timing); Format card also has Sound / File name / Save to / strip (09 owns the sheet); cloud card has no "About 2 min"
- ve-render · long job names clipped; job order and names are fixture; footer wording follows 09
- ve-transition · picker overlaps the small artboard at 100 %
- ve-fullscreen · picture is a different frame; scrub has no marker ticks

## Side states
- ve-deselect/view-menu · Menu › View › Advanced open with "Keep timeline open" ticked · reachable (open the menu)
- ve-drop/os-drag-image · "3" ghost stack + "name.mp4 and 2 more" chip · unreachable (OS drag image)
- ve-transition/tile-hover-play · a tile playing on hover · reachable
- ve-captions/struck-word · "Ehm…" struck, "Struck "Ehm…" — cut 0.4 s from the interview" strip, video 0:30 → 0:29 · reachable (select the word, press delete)
- ve-play/step-tip · "Step ← → one frame · ⇧ one second" tip and "0:07 + 2 frames" · reachable (pause, press an arrow)
- ve-long/hover-name-tag · "Akce 22 · caaftv-td-run · 0:09" under the pointer over a clip · reachable (hover a clip)
- ve-render/done-toast · "3 videos are ready" + Show in Finder · reachable with a seeded job result
- ve-render/partly-done-toast · "Exported 2 of 3 — … didn't render" + Retry · reachable with a seeded failed job
- ve-fullscreen/format-switcher · Reels 9:16 / 16:9 / 1:1 pills top left · reachable with a multi-format video (HypeFormats fixture)
- ve-formats/unlinked-copy · the 16:9 unlinked sibling artboard + "Unlinked copy — its own cut" · reachable (zoom out, or the Make an unlinked copy button)
- ve-reframe/follow-a-subject · "Follow a subject" switch + the "#1 · followed" box · cannot confirm (no tracker by decision; needs tracked footage)
- ve-footage/missing-relink · the Missing + Relink state shot instead of the board's waiting state · reachable (Relink flow owned by the import board)
