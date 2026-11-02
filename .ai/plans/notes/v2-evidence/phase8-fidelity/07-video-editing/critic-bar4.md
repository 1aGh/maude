# critic-bar4 — 07 Video Editing · verified bar (v2-michal-verified-bar), D6 merged tip 3d58f57df

Judged fresh from the D6 pairs (light and dark read for every id called verified); full-size impl frames opened for ve-trim-split, ve-text, ve-advanced, ve-long, ve-music, ve-captions, ve-transition, ve-play, ve-formats, ve-reframe, ve-export, ve-render, ve-move-transition. No shot re-taken, no code edited.

Lead decisions honoured (not MUST): owning board wins (09 owns the export sheet and the Exports panel; 04 owns the present fill), esc chip on video Present per 07, timeline raw keys per 07, music Fade not built (feature), Connect/toast rules, first-run card once, view-only opens in Preview. Timeline size (Compact vs Full) is a user toggle: it is POLISH wherever the id's subject is something else and Full is proven in another id (trim-split, advanced, long).

Cross-cutting keys:
- F1. The Full timeline's default body shows 3 of its rows: the ruler (trim-split) and the Music lane (trim-split, advanced, long) are scrolled out of view; the board draws ruler + Text / Graphics / Video / Music at rest. The per-track eye / speaker button and the lane-label collision (R1, R2 of bar3) are fixed.
- F2. Three board states need structure the harness fixtures do not have: a 3-format video (formats, reframe pills), a keyframed title (easing curve), a 40-clip video (fold rows, markers). Those states are not shown, so the id cannot be called verified.

## Per id
- ve-none · verified (L, D) · none (one trailer vs three artboards, Zoom 68 % vs 22 %, "Local project" chip are fixture)
- ve-select · verified (L, D) · none (flat Video card Size / Length / Poster / Sound / Export / Advanced, Compact island under the artboard with four lanes, selection chip with size)
- ve-deselect · verified (L, D) · none (state "Kept open": island stays with nothing selected; the four-step diagram and rules card are board explanation; the open View menu is a side row)
- ve-drop · verified (L, D) · none (artboard pill "Or drop here — adds at the end", caret on the Video lane, tip "Drop 1 clip at 0:04 · the video grows by what you drop"; the "3" ghost stack and "…and 2 more" chip are the OS drag image)
- ve-trim-split · differs · F1 (ruler and Music lane not in the Full body); held trim tip, toast + Undo, Fit / Compact header, eye and speaker buttons are drawn
- ve-move-transition · verified (L, D) · none (lift, tilt, landing line and "Drop here" tip drawn; Volume + Framing rows absent only because the fixture's beat has no media)
- ve-transition · verified (L, D) · none (six tiles, Length slider, "Hover a tile to play it.", picker anchored on the join with its notch; black tiles / "missing" badge / hatch are fixture)
- ve-text · differs · the "Title · Slide up" selection tag under the title on the artboard is not built (lives in the canvas-lib overlay); Font / Colour / Motion / Length card now matches (Text textarea moved under Advanced)
- ve-captions · differs · the Captions inspector has no "Also as a file" row (the row is gated by the S8 captions-file flag, `inspector/kinds/caption.jsx`, which is unwired); Captions inspector itself now replaces the Video one, transcript card + chips drawn
- ve-music · differs · beat ticks (a tick per beat, a tall one per bar) are not visible on the bed in either theme although "120 BPM" is read; Fade row is a lead decision, Lower-under-speech toggle state and the "song" head are fixture
- ve-formats · differs · F2 (no Formats list, link badges, sibling artboards, "Shared by 3 formats", Safe zones, "Make an unlinked copy"; the lone-video card is correct for a lone video)
- ve-reframe · differs · F2 + the window is built differently: no Reels / 16:9 / 1:1 pills in the header, an extra "This format | All formats" segment and a hint line that the board does not draw; "Follow a subject" is a side row
- ve-play · differs · the loop range is drawn as plain brackets on the ruler, not the board's "I" and "O" handle badges (and is not draggable); playing, loop on, "Pause — tap space" tip, "Sound on" chip, tinted lanes are drawn; the Step tip is a side row
- ve-fullscreen · verified (L, D) · none (esc "Back to the canvas" chip, transport pill with pause / loop / time / scrub / sound / captions, tokens only; black stage with picture fill = 04's fill decision; format switch absent only because the fixture is one format = side row)
- ve-export · verified (L, D) · none (sheet layout is 09's board; the Render row shows both cards "In the cloud" / "On this Mac", footer names the picked lane "about 45 seconds on this Mac"; Formats grid, "Export 3 videos", "Both" captions need the 3-format fixture = fixture/state)
- ve-render · verified (L, D) · none (Share-cluster ring, Exports panel with Queued / progress / Ready / partly-done row + Retry, "Cloud renders keep going…" foot per 09; the done and partly-done toasts are side rows)
- ve-footage · unreachable · the board draws "Waiting for Jonas's Mac" (a second device preparing the clip); the shot is the Missing + Relink state, which is a different state
- ve-long · differs · F1 (Music lane) + F2 (no fold rows "Text · 18 / Graphics · 6", no ruler markers, no hover name tag); header, grip, Full layout and ruler otherwise drawn
- ve-advanced · differs · F1 (Music lane) + F2 (no keyframed clip: no diamonds on the title clip, the Keyframe card is the empty "Pick a keyframe on a clip" and no easing curve); Render settings / Keyframe / The cut as code cards sit left / middle / right where the board has Easing centre, Render settings + cut as code stacked right
- ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust · unreachable (live signed-in AI cut run)
- ve-together · unreachable (second peer on a linked hub)
- ve-fit-fill · unreachable (needs a real vertical file dropped)

## Polish list
- all · Size reads "Custom" for 320×180 / 1280×720; Poster chip black; Sound "None yet"; clip names beat-one…; black clip blocks (footage missing); "Local project" chip vs Saved + avatars; zoom % differs
- ve-none · one trailer vs three artboards
- ve-text, ve-captions, ve-music, ve-transition, ve-move-transition, ve-play · timeline drawn Compact (Expand) where the board draws Full (lane names, Fit slider); Full is proven in ve-trim-split
- ve-text · Font "Default" vs Club Display, Colour white vs Club green, Motion None vs Slide up (a freshly added title), Length "3 s" stepper vs "2.2 s" read-out
- ve-captions · Transcript card has a close "×" the board does not draw (the panel must be dismissible); Font / Highlight "Default" vs Club Display / Club yellow
- ve-music · extra "Cut to the beat" row under Song (the old timeline's action, kept per the board's note 26 "nothing was deleted" — deviation for the lead to confirm)
- ve-advanced · extra tools row above the timeline (To the start / Add image / Shot for AI / Comment / Sound on / Volume), also the old timeline's kept controls per note 26 — deviation for the lead to confirm
- ve-export · cloud card has no "About 2 min" estimate (only the picked lane carries one); cloud is not the default lane (needs sign-in)
- ve-render · long job names clipped; job order and names are fixture; footer wording follows 09
- ve-reframe · window overlaps the artboard top; picture is a hatch (missing footage)
- ve-transition · picker overlaps the small artboard at 100 %
- ve-fullscreen · picture is a different frame; scrub has no marker ticks
- ve-select, ve-long, ve-advanced · Poster flag touches the ruler label by a few px

## Side states
- ve-deselect/view-menu · Menu › View › Advanced open with "Keep timeline open" ticked · reachable (open the menu)
- ve-drop/os-drag-image · "3" ghost stack + "name.mp4 and 2 more" chip · unreachable (OS drag image, synthetic events cannot carry it)
- ve-transition/tile-hover-play · a tile playing on hover · reachable
- ve-captions/struck-word · "Ehm…" struck, "Struck "Ehm…" — cut 0.4 s from the interview" strip, video 0:30 → 0:29 · reachable (select the word, press delete)
- ve-play/step-tip · "Step ← → one frame · ⇧ one second" tip and "0:07 + 2 frames" · reachable (pause, press an arrow)
- ve-render/done-toast · "3 videos are ready" + Show in Finder · reachable with a seeded job result
- ve-render/partly-done-toast · "Exported 2 of 3 — … didn't render" + Retry · reachable with a seeded failed job
- ve-fullscreen/format-switcher · Reels 9:16 / 16:9 / 1:1 pills top left · reachable with a multi-format video
- ve-formats/unlinked-copy · the 16:9 unlinked sibling artboard · reachable with a 3-format fixture
- ve-reframe/follow-a-subject · "Follow a subject" switch + "#1 · followed" box · cannot confirm (needs tracked footage)
- ve-footage/missing-relink · the Missing + Relink state shot instead of the board's waiting state · reachable (Relink flow owned by the import board)
