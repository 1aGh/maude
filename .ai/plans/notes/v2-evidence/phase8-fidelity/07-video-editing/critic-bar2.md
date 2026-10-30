# critic-bar2 — 07 Video Editing · re-evaluation against the verified bar (D2 pairs, merged tip d3881fe41)

Inputs: critic-final.md, light+dark pairs, full-size ve-fullscreen, board, fix-c4-video, fix-timeline. No new shots.
Fixture-driven items (missing footage so black clips / no thumbnails / hatch, "Custom" size for 320x180, poster picture, Sound "None yet", clip names beat-one, Alligators vs Matchday content, one video instead of three artboards, 24 vs 40 beats) are NOT blockers.

MUST keys:
- M1 label form: the artboard label lacks the board's Name · Format · Length + size chip (Trailer: "Trailer 0:29" has no format at all), and length disagrees between label / Length row / readout (0:29 vs 0:28; 0:07 vs 0:06). Content + a11y name wrong.
- M2 toast is the v1 pill (x, "Split beat-two at 0:03.", "Title added."), persists into later steps. Copy + behaviour.
- M3 board-drawn control or card missing (named per id below).

## Per id
- ve-none · differs · M1
- ve-select · differs · M1 (0:29 vs 0:28); timeline lacks the Music bed label/lane (a lane the board draws; the fixture has no music, so only the lane label is MUST)
- ve-deselect · differs · M1; board is a four-window explainer, only the Kept-open island is app UI (rules card = board explanation, not drawn)
- ve-drop · differs · M3 (no ghost clips / caret on a populated Video lane; "Drop N clips at ..." tip over the lane missing); M1
- ve-trim-split · differs · M2; M3 (no split tooltip / trim readout and "-0.6 s" tip; Compact not Full)
- ve-move-transition · differs · M3 ("Drop before ..." tip + landing line absent from the shot; Volume + Framing rows missing in the Clip inspector); M2 carry-over
- ve-transition · differs · M3 (picker still sits over the artboard instead of anchored under the join; a hatch/broken frame behind it is fixture); tile pictures black = fixture
- ve-text · differs · M2 ("Title added."); M3 (no "Title · Slide up" tag on the artboard; Motion/Length rows not as drawn)
- ve-captions · differs · M3 (no Transcript card, caption chips or Captions inspector; needs speech footage in the fixture)
- ve-music · differs · M3 (no "Fade in · out" row, head reads "song" not the track name, "Lower under speech" row state/extra "Cut to the beat" row, no speech lane over the bed)
- ve-formats · differs · M3 (no "Make an unlinked copy" / safe-zone select for the Formats list; sibling artboards + link glyphs need a 3-format fixture)
- ve-reframe · differs · M3 (window overlaps the artboard top; inspector shows the Missing card instead of Length/Speed/Volume/Framing); picture in the window = fixture
- ve-play · differs · M3 (loop band not set, "+ 2 frames" step tip missing); tips otherwise drawn
- ve-fullscreen · differs · M3 layout/tokens: player bar is anchored on the window's bottom edge instead of floating below the picture, "Back to the canvas" pill hugs the top edge, stage is plain black not the DS dark surface; format switcher absent (fixture: single-format video, so not counted)
- ve-export · differs · M3 (single-artboard sheet: no "In the cloud / On this Mac" cards, one-row Formats, "Export N videos" primary; Captions default Off vs drawn Burnt in)
- ve-render · differs · M3 (Exports panel is a plain list, no Share-cluster ring, no done / partly-done toasts with Show in Finder / Retry)
- ve-footage · differs · M3 (no File / Status inspector, no preparing bars; Missing tile is black+warn edge rather than hatch); "waiting for Jonas's Mac" owner line needs a second Mac = side/unreachable
- ve-long · differs · M3 (no fold rows, ruler markers or 132 px track column); header and grip match
- ve-advanced · differs · M3 (no easing graph, extra first tools row + "Long videos" note, ruler not in frames in the shot); floating cards present
- ve-ai-cut, ve-ai-watch, ve-ai-scrub, ve-ai-proposal, ve-ai-adjust · unreachable (AI run)
- ve-together · unreachable (second peer on a hub)
- ve-fit-fill · unreachable (real vertical-clip drop; no stub)

## Polish list
- all · Size reads "Custom" for 320x180 / 1280x720 fixtures (spec "Reels 9:16"); Poster frame black chip no picture; Sound "None yet"; no "Hype instrumental" row
- all timeline ids · black clip blocks with code names, no thumbnails (missing footage), "+ Add music / ask AI for a track" hint lane
- ve-select, ve-long, ve-advanced · poster flag collides with the 0:10 ruler label (a few px)
- ve-none · "Local project" chip instead of Saved + avatars (state); toolbar 32 vs 40 px
- ve-none, ve-select · one 1280x720 trailer at a different camera instead of three social artboards
- ve-text · Font "Default" vs Club Display; Motion preset selected "None" vs "Slide up"; play glyph over serif title
- ve-formats · blue-on-black artboard fill
- ve-fullscreen · picture is a different frame
- ve-transition · tile pictures black

## Side states
- ve-none/three-artboards-social-canvas · the board's neighbouring Post 4:5 and 16:9 artboards · fixture (needs a 3-format canvas)
- ve-deselect/four-step-diagram+rules-card · explainer, not app UI · n/a
- ve-formats/unlinked-copy · 16:9 unlinked sibling artboard · reachable with a 3-format fixture
- ve-reframe/follow-a-subject · "Follow a subject" switch · cannot confirm (needs tracked footage)
- ve-footage/waiting-for-Jonas · owner line while another Mac prepares clips · unreachable (second peer)
- ve-render/done-toast · "3 videos are ready" + Show in Finder · unreachable without a real render
- ve-render/partly-done-toast · "Exported 2 of 3" + Retry · unreachable without a failing render
- ve-fullscreen/format-switcher · Reels 9:16 / 16:9 / 1:1 pills · reachable only with a multi-format video
