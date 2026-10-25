# critic-bar3 — 07 Video Editing · verified bar (v2-michal-verified-bar), D5 merged tip e37e7d82a

Judged fresh from the D5 pairs (light + dark read for every id called verified). Full-size spec + impl frames opened for ve-drop, ve-trim-split, ve-play, ve-reframe, ve-move-transition, ve-export, ve-render, ve-fullscreen. Round-7 lead decisions honoured: present video fills per 04 (bar over the picture, black stage), esc chip on video Present per 07, timeline raw keys per 07, music Fade not built (feature), Connect/toast rules, 09 owns the export sheet layout. No shot was re-taken.

Cross-cutting MUST keys (referenced below):
- R1 Full timeline. The board draws the **Full** timeline (header "Compact", zoom slider + Fit, lane names, a per-track view / volume button in each lane gutter) on ve-trim-split, ve-move-transition, ve-transition, ve-text, ve-captions, ve-music, ve-long, ve-advanced. The product has **no per-track view/mute button** (nothing in `client/v2/timeline` draws one; `trackChip` = icon + name only), and five of those shots were taken Compact. A control the board draws is missing. If the lead wants this ruled a deviation, it needs a recorded decision; until then it blocks every Full-timeline id.
- R2 ve-trim-split Full body: the "beat-three" clip label collides with the "Video" lane label in the gutter (both themes), and the ruler row and the Music lane are not in the frame (body shorter than the board's, scrolled).

## Per id
- ve-none · verified (L, D) · none (label "Trailer · 16:9 · 0:28" drawn; one trailer instead of three artboards, Zoom 68 % vs 22 %, "Local project" chip are fixture)
- ve-select · verified (L, D) · none (selection chip with size, inspector card = the flat Size / Length / Poster / Sound / Export / Advanced list, timeline slides out under the artboard with the notch, four lanes; empty lanes, black clips, Custom size, "None yet" are fixture)
- ve-deselect · verified (L, D) · none for the app state (Keep timeline open: island stays while nothing is selected); the four-step diagram and the rules card are board explanation. The open Menu › View › Advanced menu is a side row.
- ve-drop · verified (L, D) · none (artboard pill "Or drop here — adds at the end", caret on the Video lane, "Drop 1 clip at 0:04 · the video grows by what you drop" tip; the "3" stacked ghost and the "name.mp4 and 2 more" chip are the OS drag image, which synthetic drag events cannot carry)
- ve-trim-split · differs · R1, R2 (the held trim itself is drawn: tip "beat-two · 0.7 s / −0.3 s · video 0:06", toast with Undo, Full header with Fit + Compact)
- ve-move-transition · differs · R1 (lift, tilt, landing line and "Drop here" tip are drawn; Volume + Framing rows are absent only because the fixture's beat has no media = fixture)
- ve-transition · differs · R1 (picker content, tiles, Length, "Hover a tile to play it", anchoring on the join are drawn; tile pictures black = fixture)
- ve-text · differs · R1; the title inspector draws an extra **Text** textarea + "Apply text" row and helper line ("Rewrites the title text in the composition") that the board does not draw (`inspector/kinds/title-rows.jsx`); "Title · Slide up" selection tag on the artboard not built (round-7b open)
- ve-captions · differs · R1; the **Captions inspector** (Font / Highlight / Position / Words at a time / Also as a file) does not replace the Video inspector when a caption chip is selected (round-7b open). Transcript card + chips are drawn.
- ve-music · differs · R1; row "Fade in · out" not drawn (lead decision: no fade in the product, a feature) = deviation; an extra "Cut to the beat" row under Song (kept per note 26) is a deviation candidate for a lead decision
- ve-formats · differs · the Formats list, Safe zones select and "Make an unlinked copy" are not in the inspector (a lone video hides them per the c4 decision; the shot never asks for them); sibling artboards + "Shared by 3 formats" need a 3-format fixture. Needs a shot with a multi-format video.
- ve-reframe · differs · the Re-frame window is built differently: no Reels / 16:9 / 1:1 format pills in the header, a "This format | All formats" segment + a hint line + a second duplicate hint line in the footer, no "Follow a subject" switch (side row); the Framing row wraps ("All for…", "Re-frame…", "Other takes…" stacked) and is cramped
- ve-play · differs · the drawn state is *playing* with a loop range (I / O handles on the ruler, "Pause — tap space" tip, "Sound on" chip); the shot is paused with loop on and no range, only the step tip is up. Reachable (press I and O, play), not shown.
- ve-fullscreen · verified (L, D) · none (esc "Back to the canvas" chip, format switch absent only because the fixture is one format, transport pill with pause chip / loop / time / scrub / sound / captions, tokens only; picture filling the stage and the bar over it = 04's fill, a lead decision)
- ve-export · differs · "In the cloud / On this Mac" render cards not in the shot, footer reads "about 45 seconds on this Mac" with no card ticked (same footer mismatch 09 reports for ex-video); the multi-format Formats grid and "Export 3 videos" need the 3-format fixture. Sheet layout (Scope segment, frame preview + strip, File name, Save to) is 09's board and is not counted here.
- ve-render · verified (L, D) · none (Share-cluster ring is drawn, Exports panel with Queued / progress / Ready / partly-done row + Retry, the "Cloud renders keep going…" foot); the done and partly-done toasts are side rows
- ve-footage · unreachable · the drawn state is "Waiting for Jonas's Mac" (a second device preparing the clip); the shot is the Missing + Relink state of one clip, which is a different state
- ve-long · differs · R1; no fold rows ("Text · 18 / Graphics · 6"), no ruler markers, no 132 px track column; needs a long fixture (24 beats, not 252 s). Header, grip and Full layout otherwise drawn.
- ve-advanced · differs · R1; an extra first tools row (To the start / Add image / Shot for AI / Comment / Sound on / Volume) sits above the timeline and the board has none; no easing graph (empty "Pick a keyframe on a clip" card, the board selects a title clip and shows the curve)
- ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust · unreachable (live signed-in AI cut run)
- ve-together · unreachable (second peer on a linked hub)
- ve-fit-fill · unreachable (needs a real vertical file dropped)

## Polish list
- all · Size reads "Custom" for 320×180 / 1280×720; Poster chip black; Sound "None yet"; clip names beat-one…; black clip blocks (footage missing), "Add music / ask AI for a track" hint lane
- ve-none · three social artboards in the board vs one trailer; "Local project" chip vs Saved + avatars; Zoom to fit 68 % vs 22 %
- ve-select, ve-long, ve-advanced · the Poster flag touches the 0:10 ruler label by a few px
- ve-drop · camera badge on the artboard label row shows (hover) — quiet at rest per the c4 decision, absent in the board
- ve-drop · "3" ghost stack + "…and 2 more" chip are the OS drag image, not capturable
- ve-text · Font "Default" vs Club Display, Colour white vs Club green, Length "3 s" stepper vs "2.2 s" read-out with a clock glyph
- ve-formats · blue-on-black artboard fill
- ve-fullscreen · picture is a different frame; the bar sits over the picture and the stage is plain black (04's fill); scrub has no marker ticks
- ve-transition · hatch behind the picker and black tiles (missing footage); picker overlaps the small artboard at 100 %
- ve-render · long names clipped in the panel ("Combine-kampan · 11…", "Exported 114 of 115 — l…"); row names are the fixture's
- ve-reframe · window overlaps the artboard top; picture is a hatch (missing footage)
- ve-play · Compact timeline with Expand matches the board; "+ 2 frames" vs "+ 18 frames" is the fixture's frame count

## Side states
- ve-deselect/view-menu · Menu › View › Advanced open with "Keep timeline open" ticked · reachable (open the menu); not in the shot
- ve-render/done-toast · "3 videos are ready" + Show in Finder · reachable with a seeded job result (09 lists the same); not in the shot
- ve-render/partly-done-toast · "Exported 2 of 3 — … didn't render" + Retry · reachable with a seeded failed job; not in the shot
- ve-fullscreen/format-switcher · Reels 9:16 / 16:9 / 1:1 pills top left · reachable only with a multi-format video (fixture is single-format)
- ve-formats/unlinked-copy · the 16:9 unlinked sibling artboard · reachable with a 3-format fixture
- ve-reframe/follow-a-subject · "Follow a subject" switch + "#1 · followed" box · cannot confirm (needs tracked footage)
- ve-footage/missing-relink · the Missing + Relink state shot instead of the board's waiting state · reachable (it is the Relink flow, owned by the import board)
- ve-play/playing · the playing frame with a set loop range and the "Pause — tap space" tip · reachable (stated under ve-play above because it is the board's main state)
