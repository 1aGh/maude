# IntroV2: the intro film from the approved storyboard

Source of truth: `.design/ui/Intro Film v2.tsx` in the main checkout (BEATS + the Concept
energy curve), approved by Michal. VO lines are his, used verbatim. Built unattended on
2026-11-04; every choice is marked **Decided** so it can be overturned. `Intro2` (the first
cut, `intro2-script.md`) is untouched. Nothing is uploaded, pushed or deployed.

- **Cut:** 70.5 s, 30 fps, 1920×1080 (2115 frames). Composition `IntroV2`
  (`final/src/compositions/IntroV2.tsx`, scenes in `final/src/scenes/introv2/`).
- **Output:** `final/out/introv2/IntroV2-audio.mp4` (release asset later), poster
  `out/introv2/intro-poster.jpg` → `site/public/intro-poster.jpg`, captions
  `final/public/introv2/captions.vtt` → `site/public/intro.vtt`.
- **Build:** `bunx remotion render src/index.ts IntroV2 out/introv2/IntroV2.mp4`, then
  `bash build-introv2.sh` (mix, poster, captions).

## Beats, VO and cues

| # | Beat | Cut (s) | VO line (verbatim) | What moves |
|---|---|---|---|---|
| 1 | Hook | 0–6.4 | You like Figma. You like Claude. Meet Maude. A canvas with an AI that actually does stuff. | The selected text layer frames itself; the lines spring in on the VO; the spark (the AI cursor) glides in on "Meet Maude."; on "actually does stuff" the frame turns spark ("AI is editing") and a weight wave runs through "Meet Maude." |
| 2 | Wow 1 | 6.4–18 | Drop in your raw footage. Forty clips. Mostly your thumb. The AI watches all of it, picks the good bits and cuts the film. Captions and music included. | Whip pan. 14 clips fall under gravity and bounce-settle; "40 clips" lands; the spark draws the ring round the pile ("AI is watching" → "AI is cutting"); six picked clips fly on arcs into a timeline (video, captions, music tracks fill in), the rest step back; the 9:16 artboard plays the cut with a running playhead and word-by-word captions. |
| 3 | Wow 2 | 18–27.5 | Drop in photos from the shoot. Out come the Instagram posts. On brand, because it knows your design system. | Whip pan. Photos drop and settle; one by one they fly out on arcs to four 1:1 posts and two 9:16 stories (a shutter tick each, the spark hops along); on "On brand" the brand layout wipes up over each; "Made by AI · on brand" lands. |
| 4 | Wow 3 | 27.5–38.5 | Draw your idea. Badly. I do. The AI turns it into real screens you can click through. | Whip in close. Music stops dead; a wobbly hand sketch draws itself stroke by stroke (pencil); the spark ring wraps it; on the hit it snaps into a real sign-up screen (each part staggered, a spark flash); pull out; the cursor taps Sign up; the next two screens slide in, joined by prototype arrows. |
| 5 | No handoff | 38.5–46.6 | No handoff. No final_v7_really_final. Just pure creativity. | The camera dives into a dark artboard on the same canvas. Three file names stack in; each is struck on a hard stop (line snaps across, name jolts, dims); "Just pure creativity." lands. No AI, so no spark. |
| 6 | The whole team | 46.6–53.5 | Bring the whole team. Everyone on one canvas, live. You pay for the project, never per seat. | A long pull-back over all three wows (and the dark board) on the one canvas. Cursors fly in from the edges, two stickies land, the project link ripples out and five faces join it; "Per project, never per seat". |
| 7 | The secret | 53.5–63.2 | Oh, the secret? It's all good ol' HTML. The language AI grew up on. So it's fluent. And the work is yours. | Music stops dead. The camera dives onto wow 3's sign-up screen; it lifts, the world dims, it flips like a card (3D, perspective) to its own code with every line at the height of the element it makes (`<button>` exactly behind the button); it flips back and lands face up on the chord; the cursor hovers, the button answers and is pressed. |
| 8 | End card | 63.2–70.5 | Maude. Built around AI, not bent to fit one. Free to download at maude.sh. | Whip to the end card: the Mark springs in, "maude" slides out of it, the line rises; on "one." the spark flies in on an arc and lands as the full stop; Download free · maude.sh. Holds; the poster is the last frame. |

Cue times live in one place, `CUE` in `final/src/scenes/introv2/motion.ts`; every one was set
from whisper word times of the takes (e.g. the ring on "The AI watches", the fan-out on "Out
come", the strikes after "handoff.", on "No" and after the file name, the flip on "good ol'
HTML", the landing on "So it's fluent", the full stop on "one.").

## Motion language (Decided)

- **One world, one camera.** Every beat sits somewhere on one dot-grid plane (hook at 0,0;
  wows at x 2600 / 5200 / 7800; the dark board below wow 3; the end card below wow 2). Beat
  changes are camera moves (`camera.tsx` keys): whips, a dive, a long pull-back. No cross-fades.
  The dot grid is drawn from the camera so it stays crisp at every zoom.
- **Motion blur** on fast moves only: `@remotion/motion-blur` `CameraMotionBlur` (8 sub-frame
  samples, 200° shutter) switches on when the camera's screen speed passes 24 px/frame. Added
  as a dependency (`@remotion/motion-blur@4.0.463`, same version as Remotion).
- **Easing language:** one curve for moves (in-out), one for entrances (fast out), one for
  exits (accelerating), a sharper one for whips. Springs: `calm` (no overshoot) for frames and
  camera-like things, `snappy` for UI arriving, `bouncy` only where landing means something
  (clips hitting the desk, stickies, tags, the Mark, the full stop).
- **Nothing pops:** every element has an entrance (spring/slide/draw) and an exit or stays on
  the canvas as part of the world (the team pull-back shows them all).
- **The spark** is one travelling object (`spark.tsx`): the AI cursor, present only while the
  AI acts (hook edit, the cut, the posts, the snap), absent while people act (sketch, no handoff,
  team, flip); it ends as the end card's full stop. Spark colours appear nowhere else.
- **Colours** only from the vendored maude-v2 tokens (`vendor/maude-v2/`); syntax colouring of
  the code uses accent and object-palette tokens in the dark theme. **No price anywhere.**
- **Everything is a recreation** in the kit's own pieces (an AI run is not deterministic, and
  every beat needed choreography a capture cannot give). No studio capture is reused: the real
  captures from Intro2 looked like a different film next to the drawn world. Made-up people only.

## Voice (Decided: Chris, `iP95p4xoKVk53GoZ742B`, eleven_v3)

Samples (beat 1 and beat 4 lines) in `final/public/introv2/audio/vo/samples/` for Chris
(`iP95p4xoKVk53GoZ742B`), Eric (`cjVigY5qzO86Huf0OWal`) and Brian (`nPczCjzI2devNBz1zQrb`), all
three exist as premade voices. Measured with whisper medium.en (mean word confidence, beat 1 /
beat 4): Chris 0.894 / 0.918, Eric 0.930 / 0.885, Brian 0.866 / 0.911; lengths Chris 6.6 / 6.0 s,
Eric 7.7 / 7.1 s, Brian 6.9 / 6.5 s. Chris is the best average with the tightest timing, and his
beat-4 take reads "Badly. I do." as two separate throwaway sentences, exactly the direction;
Eric dragged "idea... badly" into one dramatic pause (word confidence fell to 0.09 there). Chris
is ElevenLabs' casual, down-to-earth male voice: the closest to "a designer telling a friend".
**Michal should listen and overrule if needed.**

- **Audio tags work** on eleven_v3 through the adapter (tested once on beat 1 with `[deadpan]`:
  acted, not spoken). Used: `[deadpan]` (1), `[short pause]` (2), `[smug]` (3), `[tired]` (5),
  `[conspiratorial]` (7). Beat 4 is the sample take (no tag needed).
- The file name in beat 5 was sent as "final underscore v7 underscore really underscore
  final" so it is read as a file name; the end address as "maude dot S H".
- Beat 6 took two takes: whisper heard take 1's "per seat" as "proceed"; take 2 (kept, with
  "never... per seat") is clean. Take 1 is in `samples/vo-6-take1.mp3`.
- Takes: `vo-1 … vo-8.mp3`, silence-trimmed in `vo/_trim/` (5.8, 10.6, 5.8, 5.9, 7.4, 5.8,
  8.9, 6.2 s). Every take checked word by word with whisper.

## Sound (Decided)

- **Music:** generated (ElevenLabs Music) in sections, because one prompt cannot place hard
  stops: `bed-a` (32 s, minimal electronic 112 BPM, muted felt piano motif), `bed-b2` (30 s,
  full kit from beat one; `bed-b` was the first try, its music ran out after 20 s), `bed-c`
  (14 s, resolved chord, long tail). Cut in the mix (`BED_SEGMENTS`): A 0–27.5 s, hard stop;
  silence on the sketch; B's first beat lands on the snap (31.8 s), hard stop at 53.5 s;
  silence through the lift and flip; C's chord lands with the card (59.4 s) and rings out.
  Check that Michal's ElevenLabs plan covers commercial use of generated music.
- **SFX:** generated: sub pulse, clip drop, whoosh, shutter, scribble, snap hit, strike, pop,
  card flip, click, riser, spark shimmer. Placed by frame in `build-introv2.sh`.
- **Mix:** `build-audio.sh` now also takes `BED_SEGMENTS` (bed cut from sections with their own
  trims and fades), frame offsets (`192f`) for VO and SFX, and a limiter ceiling (`TP_LIMIT`);
  V5 and Intro2 build unchanged. Bed ducked under the VO (sidechain), loudnorm -16 LUFS,
  true peak -1.5 dBTP target.
- **Captions:** whisper on each clean take shifted to its place in the mix
  (`scripts/intro2-captions.mjs`, now with an optional `script.json`): the caption text is the
  approved line word for word (`public/introv2/audio/vo/script.json`), whisper gives the timing
  (word by word where its word count matches, else spread over the spoken span by word length;
  that fallback was needed for line 3, where whisper heard "Drop in" as "Dropping"). WebVTT via
  `scripts/captions-to-vtt.mjs`, 30 cues.

## Result and QA

- `out/introv2/IntroV2-audio.mp4`: 70.5 s, 11.7 MB, -16.1 LUFS integrated, -1.3 dBTP true peak.
- Contact sheets (session scratchpad `introv2/`): every 3 s, the camera moves, and the three
  wows at 5-frame steps. Fixed after looking: the sketch phone drew as a hexagon (rounded
  corners now), the reel's captions sat on its title, the end card and team shot were too small,
  the AI cursor was too small to read, motion blur showed 8 visible ghosts (12 samples now).
- `lint:motion` clean; `tsc` clean for IntroV2; the video tests show the same 2 golden failures
  as the base commit (Demo and scene-02, 0.52% against 0.5%), none from this work.

## Weak spots for a critic

- Wow 2's "photos from the shoot" are the kit's thumbnail art, not photographs: they read as UI
  cards. Real photos (or generated ones) would sell the beat.
- Wow 1's reel artboard is empty for ~0.5 s as it rises before the cut plays.
- The team pull-back is very wide (zoom 0.29): the wows read as shapes, the people carry it.
- Whips pass mostly empty canvas between regions 2600 px apart; motion blur is sampled (12
  sub-frames), so a frame-by-frame look shows stepping.
- The weight wave in the hook and the button hover in the flip are subtle at 1080p.
- Rendering needs the network: other compositions in the project load Google Fonts at import
  (Inter), and a stalled fonts.gstatic.com times the render out; the stills helper retries.

## Generation calls

33 requests in total, under the 40 budget: 6 voice samples, 1 tag test (kept as vo-1), 6
final lines, 1 retake (vo-6), 4 music sections (bed-a, bed-b, bed-c, bed-b2), 15 SFX requests
(12 kept; one `click` was rejected by ElevenLabs for a 0.4 s duration below its 0.5 s floor and
the studio server crashed on that error, so the next two requests never reached the provider and
were sent again). Note for the studio: an ElevenLabs 4xx on a generate job takes the dev server
down (unhandled rejection in `apps/studio/generation/adapters/elevenlabs.ts` `postForAudio`).
