## The four comp components: Captions, Duck, Reframe, Place (Maude 2)

`@maude/canvas-lib` exports four components for a video comp. Import them from there — a comp's own
local `Captions` (the older `CUES` pattern) keeps working, but Maude derives nothing for it.

```tsx
import { Captions, DCArtboard, Duck, Place, Reframe, VideoComp } from '@maude/canvas-lib';
import { Audio, OffthreadVideo } from '@remotion/media';

const Recap = () => (
  <>
    <TransitionSeries>
      <TransitionSeries.Sequence name="interview" durationInFrames={150}>
        <Reframe focus={[[0, 0.5, 0.42], [1.5, 0.55, 0.4]]} formats={{ "16:9": [[0, 0.5, 0.55]] }}>
          <OffthreadVideo src="assets/7c40e2b1.mp4" trimBefore={30} />
        </Reframe>
      </TransitionSeries.Sequence>
    </TransitionSeries>
    <Place at={[0.5, 0.8]} formats={{ "16:9": [0.5, 0.85] }}><h1>Recap</h1></Place>
    <Duck db={-12} attackMs={200} releaseMs={400}>
      <Audio src="assets/2a886bcf.mp3" volume={0.8} />
    </Duck>
    <Captions data-cd-id="captions" words="line" position="bottom" />
  </>
);
```

### What the build adds — never write it yourself

The words and the speech come from the transcripts (`assets/<sha8>.transcript.json`), not from the
file. When the canvas builds, Maude adds `__words` to each `<Captions>` and `__speech` to each `<Duck>`,
computed from the comp's clips as they are on disk. So:

- A trim, split, move or speed change moves the captions and the dip by itself. Do not rewrite
  `<Captions>` after a cut.
- A new or changed transcript rebuilds only the canvases whose comps play that source.
- `__words` and `__speech` in a file are refused by `maude design check` (`video-derived-prop`).
- Captions and the dip need the comp to be mounted by a video artboard (`<VideoComp component={X}>`);
  linked formats share one comp, so they share the words.

### How each one renders

| Component | Renders |
| --- | --- |
| `<Captions>` | The words on screen at this frame: one word (`words={1}`), three (`words={3}`) or a line (`"line"`, broken at `maxChars`, 6 s, a 0.8 s pause, `. ! ?` or a cut between clips). The word being spoken takes `highlight`. A short pause keeps the line up. A word is always text. |
| `<Duck>` | The one `<Audio>` it wraps, its own `volume` (number or callback) multiplied by the dip: `db` under speech, a ramp of `attackMs` before and `releaseMs` after. Put it at the comp root around a bed that starts at frame 0. |
| `<Reframe>` | The clip's media cut to the output's aspect: `formats["W:H"]` (the artboard's own reduced aspect) or else `focus`, interpolated in SOURCE seconds (`trimBefore` and `playbackRate` are read from the media), holding the first and last key. `zoom` punches in. No keys = centred. `fit="fit"` letterboxes, `fit="blur"` letterboxes over a blurred, silent copy. |
| `<Place>` | Its children centred on `formats["W:H"] ?? at`, fractions of the output frame. |

### What `maude design check` refuses

| Code | Rule |
| --- | --- |
| `video-captions-twice` | One `<Captions>` per comp. |
| `video-duck-child` | `<Duck>` wraps exactly one `<Audio>` and nothing else. |
| `video-reframe-follow` | `<Reframe follow>` — following a subject is not in Maude 2.0. Set focus keyframes instead. |
| `video-reframe-focus` | `focus` / `formats` keys are literal `[sourceSec, x, y]`, in time order, x and y in 0…1; `formats` keys are `"W:H"`. |
| `video-reframe-zoom`, `video-reframe-fit` | `zoom` ≥ 1; `fit` is `"fill"`, `"fit"` or `"blur"`. |
| `video-place-at` | `at` and every `formats` value are `[x, y]` in 0…1. |
| `video-captions-fixes` | `fixes` is JSON written out in full (quoted keys): `[{ "src": "assets/….mp4", "at": 3.45, "text": "jsem" }]`. Bare keys would apply no fix. |

### Framing density — how many focus keys

Read frames over the source range the clip actually plays (`maude design smart-frames <asset>
--frames N`, or `probe-footage`) and set keys from what you see:

- 1:1 and 4:5 from a vertical or wide source usually need **no keys** — centred already holds the
  subject in about 97 % of frames, because the camera operator follows it.
- 16:9 fill from a vertical source, and any punch-in (`zoom` > 1): **one key per second** of the
  played range for fast action. Sparser keys (every 2–2.5 s) lose the subject in a quarter of the
  frames of a 2× punch-in.
- Keys are in SOURCE seconds, so they stay right when the clip is trimmed or moved.
- Per-format keys go under `formats`; shared keys under `focus`.
