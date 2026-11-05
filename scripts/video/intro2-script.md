# Intro2: the 60-second intro film (script, voice, every choice)

Plan: `.ai/plans/feature-public-site-v2.md`, Phase C (Tasks C1 to C4, plus the C5 assets).
Made unattended on 2026-11-04 while Michal was away. Every choice below is marked
**Decided** so he can overturn it. Nothing here is uploaded, pushed or deployed.

- **Cut:** 60.0 s, 30 fps, 1920×1080 (1800 frames). Composition `Intro2`
  (`scripts/video/final/src/compositions/Intro2.tsx`, scenes in `src/scenes/intro2/`).
- **Output:** `scripts/video/final/out/intro2/Intro2-audio.mp4` (ships later as a release
  asset, never in `site/public`), poster `out/intro2/intro-poster.jpg`, captions
  `public/intro2/captions.vtt`. The poster and captions are copied to
  `site/public/intro-poster.jpg` and `site/public/intro.vtt` for Task C5.

## The story (C1)

It follows the site: the headline, the draw-or-ask AI run, one ⌘Z, the "Good ol' HTML" file
story, the feature montage, Maude Cloud per project not per seat, the end card.

| # | Cut (s) | Screen | VO (final) |
|---|---|---|---|
| 1 | 0.0–5.0 | The hero headline as a selected text layer. The three lines land on the VO, the "Text · Display" tag pops, the weight bubble runs through "Meet Maude." | You like Figma. You like Claude. Meet Maude. |
| 2 | 5.0–13.0 | The product window: the ask lands on "just ask", the AI ring and cursor start on "The AI draws", three plan cards (Solo, Studio, Team) are drawn, Tereza's sticky lands. | Draw it yourself, or just ask. The AI draws right on the canvas while you watch. |
| 3 | 13.0–18.5 | ⌘Z on "One undo": every card and the "Made by AI" tag fold away in one step; a toast and the AI panel say it is undone. | Don't like it? One undo takes the whole thing back. |
| 4 | 18.5–33.5 | "Good ol' HTML. The AI knows it best." The private-format cell on "secret format"; the wipe from the design into its file on "plain web code"; the AI cursor on "fluent"; "A developer ships it as it is" on the last line. | And here's the part that matters. Your design isn't locked in a secret format. It's plain web code, the language AI grew up on. So the AI is fluent in it, and a developer can ship it as it is. |
| 5 | 33.5–43.5 | Montage cut on the words: Screens, Reels, Slides, Print, From a moodboard, A design system, Live together. | Screens, reels, slides and print. A design system from a moodboard. Your whole team, live, on one canvas. |
| 6 | 43.5–50.5 | Maude Cloud: "Invite everyone." The project link, six people join one by one; "Pay for the project." and "Per project, never per seat" on the second line. | Maude Cloud puts your project online for everyone. You pay for the project, never per seat. |
| 7 | 50.5–60.0 | End card: the Mark and "maude", "Built around AI, not bent to fit one.", Download free · maude.sh. Holds from ~55.5 s. | Maude. Built around AI, not bent to fit one. Free to download at maude.sh. |

Beats meet with 12-frame cross-fades (`@remotion/transitions` fade). Each VO line starts 0.4 s
after its beat starts; the beat lengths were sized to the generated takes.

**Decided (copy):**
- Kept the plan's draft almost word for word. Beat 7 says "Free to download at maude.sh" instead
  of "Free, at maude.sh", because Maude Cloud is paid and "Free" alone next to it reads wrong.
- maude-positioning checks: only shipped features (the montage words are the site's own bento
  headings, which name only What's-new features); no "replaces Figma" (beat 1 names Figma and
  Claude as tools people like, nothing more); the protected line "built around AI, not bent to
  fit one" is the end card; no em-dash as a clause joiner anywhere in the VO or on screen.
- **No price in the film** (plan Decision 8). The site's HeroShot cards show €0/€19/€99 and its
  HTML wipe card shows "€19 a month"; the film shows plan names (Solo, Studio, Team) and a
  "For small teams" card instead. The Present capture is cropped above the hero's fine print,
  which names a price, and the montage camera keeps the Cloud pricing artboard out of frame.
- `flow` and the self-hosted hub are not in the film. 60 s holds the site's story only; the
  positioning rule that they are "secondary, never absent" is met by the site and README.
  Open for Michal.

## Voice (VO)

Generated through Maude's own BYOK ElevenLabs integration (`maude design generate --provider
elevenlabs --modality audio --kind tts`), on a studio dev server booted on this worktree. The
server read the key itself; no key was read, printed or copied.

- **Model:** `eleven_v3` (the adapter's default for TTS; it sends no voice settings, so the
  voice's own defaults apply).
- **Samples (beat 1, kept):** `final/public/intro2/audio/vo/samples/`
  `beat1-george.mp3` (George, `JBFqnCBsd6RMkjVDRZzb`), `beat1-daniel.mp3` (Daniel,
  `onwK4e9ZLuTAKqWW03F9`), `beat1-sarah.mp3` (Sarah, `EXAVITQu4vr4xnSDxMaL`).
- **Decided: Sarah, `EXAVITQu4vr4xnSDxMaL`.** All three read the line at the same pace (three
  phrases, ~0.6 s pauses). Picked on clarity, measured: whisper medium.en word confidence was
  Sarah 0.95 mean / 0.80 min, George 0.88 / 0.60, Daniel 0.81 / 0.53. Sarah is ElevenLabs'
  soft, warm, confident narrator, and a female voice also sets the v2 film apart from V5's dry
  male read. **Michal should listen to the three samples and overrule this if he hears it
  differently.**
- **Takes:** one per line, `vo-1.mp3 … vo-7.mp3` (`vo-1` is the Sarah sample), silence-trimmed
  copies in `vo/_trim/` are what the mix uses. Durations: 4.0, 5.0, 3.4, 12.3, 8.5, 5.7, 7.4 s.
  Every take was checked with whisper against the script; all match word for word.
- Beat 7 was sent as "at maude dot S H" so the voice spells the address; the captions say
  "maude.sh".
- **Listen-check for Michal:** whisper heard beat 6's "Maude Cloud" as "ModCloud"
  (the two words run together). Captions are fixed; if it sounds like "mod", regenerate vo-6.

To re-voice a line (same voice, same model):

```sh
node cli/bin/maude.mjs design generate --provider elevenlabs --modality audio --kind tts \
  --voice EXAVITQu4vr4xnSDxMaL --prompt "<line>" --root <a repo with a running studio>
# then copy .design/assets/<sha8>.mp3 to final/public/intro2/audio/vo/vo-N.mp3 and re-trim:
ffmpeg -i vo-N.mp3 -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse" -q:a 2 _trim/vo-N.mp3
```

## Music bed

**Decided: generated**, one ElevenLabs Music call through the same integration
(`--kind music --duration 65`), so it is ours under Michal's ElevenLabs plan (check that his
plan carries commercial use for music before the film ships; the adapter notes music rights
depend on the plan). File: `final/public/intro2/audio/music/bed.mp3`, 65.0 s, instrumental
(whisper hears only music), -17.5 LUFS before the mix. Prompt:

> Instrumental background bed for a calm, modern product intro film. Warm felt piano and soft
> plucked synths over airy pads and a light, steady electronic pulse around 100 BPM.
> Optimistic, understated, uncluttered, leaves room for a voiceover. No vocals, no big drops.
> Gentle start, ends on a soft resolved chord.

## Generation calls (Michal's ElevenLabs money)

10 calls in total: 3 voice samples on beat 1, 6 more VO lines (beats 2 to 7), 1 music bed.
No retakes were needed.

## Pictures: real captures vs recreations (C2, C3)

| Beat | What it is |
|---|---|
| 1 headline | **Recreation** in the site's own pieces (Public Site v2 · HeroHeadline). |
| 2 AI run | **Recreation** of the site's HeroShot: the scripted AI run the hero plays. A live AI run is not deterministic, so the film uses the same scripted run as the site, on the film clock. |
| 3 undo | **Recreation** (the same shot, with the run folded away and a toast). |
| 4 Good ol' HTML | **Recreation** of the site section (PlainHtml), with no price on the card. |
| 5 Screens, Reels, Slides, Print, A design system | **Real captures** of the Maude 2 studio (v2.0.2, this worktree's `apps/studio`), light theme, on a throwaway demo project: the Public Site v2 canvas, a 9:16 video artboard with its timeline and inspector, Present mode on the site's Home artboard, the demo landing canvas pushed in on its A3 print artboard, the maude-v2 design system page. |
| 5 From a moodboard | **Recreation** (the site's bento picture: four tiles, the spark, the type and buttons). |
| 5 Live, together | **Composite:** the real canvas capture with the people (cursors, two stickies) drawn over it in the kit's own pieces. Live cursors need two signed-in people. |
| 6 Cloud | **Recreation** in the site's pieces (the Cloud band's words). No real Cloud capture: it needs an account. |
| 7 end card | Recreation (Mark, line, Download, address). |

**How the recreations stay on-brand:** the maude-v2 tokens, the canvas kit and the site's CSS are
vendored as a snapshot in `final/vendor/maude-v2/` (from `.design` at c83da7828), never
invented. The site's own entrance animations are reused and scrubbed frame by frame: the stage
pauses every CSS animation and sets `--t0` to the scene clock (`src/scenes/intro2/film.css`),
so a paused animation with delay `d - t0` shows its exact state at `t0`. Type is the maude-v2
display stack (`system-ui`), so it renders as SF Pro on the Mac that renders the film. The
orange spark appears only on AI things (the AI cursor, ring, tags, the moodboard step).

**Captures (C2):** `final/scripts/capture-intro2.mjs` (Playwright from `apps/studio`, 2x
pixels, stills that the film moves with a slow camera). The demo project lived in the session
scratchpad: `.design/config.json` naming only maude-v2, `ui/Landing page.tsx` (kit mocks on
web, mobile, print and social artboards), `ui/Launch reel.tsx` (a 9:16 VideoComp), copies of
`ui/Public Site v2.tsx/.css`, `ui/v2/_kit.*` and `system/maude-v2`. The studio ran with an
isolated `HOME`, `XDG_CONFIG_HOME` and `GIT_CONFIG_GLOBAL` (git user "Tereza",
tereza@example.com), a stub `claude` first on `PATH`, `NO_OPEN=1`, `MAUDE_NO_AUTOBUILD=1`. No
personal data is on screen: the only people are the kit's made-up Tereza and Jonas plus
initials. The maude-v2 moodboard canvas was left out on purpose: it holds screenshots of other
companies' products.

## Mix (C4)

`final/build-audio.sh` is now parameterised by env (input video, VO folder and list with
offsets, SFX list, bed, bed level and fades, ducking, loudness target, video codec); with no
env it builds V5 exactly as before. `final/build-intro2.sh` calls it for Intro2:

- VO offsets (ms): 400, 5400, 13400, 18900, 33900, 43900, 50900 (beat starts + 0.4 s).
- Bed at 0.3, ducked under the VO with a sidechain compressor, 1.5 s fade in, 4.5 s fade out
  from 55.5 s. No SFX.
- `loudnorm` to -16 LUFS, true peak -1.5 dB; video re-encoded x264 CRF 23 (`-preset slow`,
  `+faststart`), AAC 192k.
- Then the poster (the settled end card, last half second) and the captions.
- **Decided (captions):** whisper (the same whisper.cpp 1.5.5 + medium.en setup as `sub.mjs`)
  runs on each clean VO take, and every word is shifted by that line's offset in the mix
  (`scripts/intro2-captions.mjs`), then `scripts/captions-to-vtt.mjs` writes WebVTT and fixes
  whisper's spelling of our names and the script's punctuation. `sub.mjs` on the mixed film was
  tried first: under the music bed its word times drifted by up to 1.5 s and it added a
  `[BLANK_AUDIO]` cue. Burned-in captions are not in this cut (the site has a captions track).

## Re-render

```sh
cd scripts/video/final
pnpm install                         # Remotion 4.0.463
bunx remotion render src/index.ts Intro2 out/intro2/Intro2.mp4
bash build-intro2.sh                 # mix, poster, captions
cp out/intro2/intro-poster.jpg ../../../site/public/intro-poster.jpg
cp public/intro2/captions.vtt ../../../site/public/intro.vtt
```
