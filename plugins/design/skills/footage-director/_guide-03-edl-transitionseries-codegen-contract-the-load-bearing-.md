## EDL → `<TransitionSeries>` codegen contract (the load-bearing part)

Turn the `Edl` into a video-comp canvas under `<designRoot>/ui/<Slug>.tsx`. The
output MUST be the **exact shape** of `video-comp` SKILL.md's worked 4-clip
example — one **literal** block per beat, **never `.map()`** over the beats
(the Timeline reads the file as text; a loop collapses N beats into one generic
row — the single most important rule here).

Mapping, beat by beat:

- **Comp meta** ← `Edl.fps` / `Edl.width` / `Edl.height`; `durationInFrames={TOTAL}`.
- **`TOTAL`** ← a **literal arithmetic sum** of the beat durations minus each
  non-null transition's frames, written as consts/literals so the Timeline can
  resolve it: `const TOTAL = 60 + 45 + 50 - 15 - 15;` — NOT
  `beats.reduce(...)` and NOT `clips.length * X`.
- **Each beat** → one literal
  `<TransitionSeries.Sequence name="{beat.name}" durationInFrames={beat.durationFrames}>`
  wrapping `<OffthreadVideo src="{beat.clip}" trimBefore={Math.round(beat.startSec * fps)} />`.
  - `trimBefore` (in output frames) is how a beat uses a **mid-clip in-point**
    (`startFrom` is the legacy spelling — the manual editor reads both, always
    EMIT `trimBefore`); a second beat from the same clip is a **second literal
    block** with a different `trimBefore` — this is how "multiple shots from one
    clip" renders.
  - `<OffthreadVideo>` (not `<Video>`) for frame-accurate export decoding.
- **Between beats** → if `beats[i].transition` is non-null, emit
  `<TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: {frames} })} />`
  BEFORE that beat's `<Sequence>`; if `null`, emit nothing (back-to-back
  sequences = a hard cut). `slide` takes `slide({ direction: 'from-right' })`.
- **Overlays** → a DS-token'd `<AbsoluteFill>` child inside the beat's Clip,
  frame-driven (spring/interpolate on `useCurrentFrame()` — **never** CSS
  animation, the iron law). `title` = centered display type; `lower-third` =
  bottom-left; `caption` = bottom-center; `logo` = the DS brand mark (Tier-0
  prior: lift `system/<ds>/preview/logo.*` per DDR-141, don't redraw it).
- **Music** (legacy single bed) → one `<Audio src="{music.asset}" volume={f => interpolate(f, [TOTAL - {fadeOutFrames}, TOTAL], [1, 0], { extrapolateLeft: 'clamp' })} />`
  under the whole reel. Omit if `Edl.music` is absent.
- **Audio tracks** (`Edl.audioTracks[]`, feature-ai-media-generation Phase 2 — layered music / voiceover / SFX) → one `<Audio>` PER track. Wrap a placed/trimmed track in `<Sequence from={startFrame} durationInFrames={durationFrames}>` (omit the wrapper for a whole-reel bed). `gainDb` → a constant `volume={10 ** (gainDb / 20)}`; `fadeInFrames`/`fadeOutFrames` → fold into a `volume={f => …}` interpolate. **Duck music under voiceover**: give a `music` bed a negative `gainDb` (e.g. −12) whenever a `voiceover` track overlaps it. Prefer `audioTracks` over the single `music` bed the moment a reel layers more than one sound. A generated track (ElevenLabs) is an `assets/<sha8>.mp3` like any ingested one.
- **Captions** (`Edl.captions`, fed by `generation/captions.ts` — local whisper or cloud Scribe) → ONE frame-driven caption overlay. A `<Captions>` component reads `useCurrentFrame()`/`fps`, finds the active cue (`startSec*fps ≤ frame < endSec*fps`), and renders it at the `style` position (`lower-third` default = bottom-center, `centered`, or `top`). Frame-driven, never CSS timing (the iron law). Captions are a VISUAL overlay, so they survive the frame-step export path even when audio is dropped.
  - **SECURITY — caption text + `audioTracks[].name` are UNTRUSTED (transcribed-audio / user origin). Escape them (DDR-164 Phase-2 ethical-hacker landmine).** Embed the cue list with **`const CUES = <the JSON.stringify of the cues array>`** — a JSON literal that safely escapes quotes/backslashes/newlines/`</script>`/`${…}` — **never** hand-inline the text into a JS string literal or a template literal (an apostrophe, backtick, or `${` in the transcript would otherwise break out of the literal and inject code into the executed composition). Render the text as a React **child** (`{cue.text}` between tags — React auto-escapes string children), never via `dangerouslySetInnerHTML` and never inside a `` `template ${cue.text}` ``. Same rule for `audioTracks[].name` if you surface it.
- **Placeholder beats** (enhanced-video-editing Task 24) — when the EDL calls
  for a shot no clip covers (a missing establishing shot, a motion-graphics
  insert), the codegen MAY emit a prompt-carrying slate beat instead of
  skipping it: one literal
  `<TransitionSeries.Sequence durationInFrames={N}><AIPlaceholder prompt={"…"} kind="veo|motion|image" durationInFrames={N} /></TransitionSeries.Sequence>`
  (`AIPlaceholder` from `@maude/canvas-lib`; prompt ALWAYS the JSON-stringified
  quoted form — it is user/model text). The user resolves it later via the
  Timeline's Generate ✨ flow or `/design:generate`; the beat stays fully
  editable (trim/speed/reorder) meanwhile.
- **Colors/type** → DS tokens (`var(--bg-0)`, `var(--fg-0)`, `var(--accent)`),
  same as any canvas.

### Worked codegen (3-beat EDL → comp)

```tsx
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';

const FPS = 30;
// TOTAL = Σ beat frames − Σ transition frames, as a literal sum (Timeline-resolvable).
const TOTAL = 60 + 45 + 50 - 15 - 15;

const Title = ({ text }: { text: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const y = interpolate(spring({ frame, fps, config: { damping: 200 } }), [0, 1], [30, 0]);
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: `translateY(${y}px)`, opacity, color: 'var(--fg-0)', fontSize: 88, fontWeight: 800 }}>{text}</div>
    </AbsoluteFill>
  );
};

// feature-ai-media-generation Phase 2 — a frame-driven caption overlay from an
// Edl.captions cue list (seconds → frames at fps). Frame-driven, never CSS timing.
// SECURITY: caption text is UNTRUSTED (transcribed audio) — embed the cue array as
// the JSON.stringify of Edl.captions.cues (safely escapes quotes/backticks/${}),
// NOT hand-inlined string literals. Render {cue.text} as a React child (auto-
// escaped). The literals below are illustrative (no dangerous chars).
const CUES = [
  { startSec: 0, endSec: 1.8, text: 'Alligators of Brno' },
  { startSec: 2.0, endSec: 3.6, text: 'A cold-water winter' },
];
const Captions = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cue = CUES.find((c) => frame >= c.startSec * fps && frame < c.endSec * fps);
  if (!cue) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: 64 }}>
      <div style={{ background: 'color-mix(in oklab, var(--bg-0) 70%, transparent)', color: 'var(--fg-0)', fontSize: 40, fontWeight: 600, padding: '8px 20px', borderRadius: 8 }}>{cue.text}</div>
    </AbsoluteFill>
  );
};

const Reel = () => (
  <AbsoluteFill style={{ background: 'var(--bg-0)' }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="open" durationInFrames={60}>
        <AbsoluteFill>
          <OffthreadVideo src="assets/36b11e50.mp4" trimBefore={0} />
          <Title text="Alligators" />
        </AbsoluteFill>
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence name="detail" durationInFrames={45}>
        <OffthreadVideo src="assets/36b11e50.mp4" trimBefore={Math.round(6.4 * FPS)} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence name="logo" durationInFrames={50}>
        <OffthreadVideo src="assets/9f2a11bc.mp4" trimBefore={Math.round(1.2 * FPS)} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    {/* Layered audio (Edl.audioTracks) — a ducked music bed + a placed voiceover. */}
    <Audio src="assets/deadbeef.mp3" volume={(f) => 10 ** (-12 / 20) * interpolate(f, [TOTAL - 20, TOTAL], [1, 0], { extrapolateLeft: 'clamp' })} />
    <Sequence from={15} durationInFrames={90}>
      <Audio src="assets/voiceover1.mp3" />
    </Sequence>
    {/* Caption track (Edl.captions) — a frame-driven overlay, survives frame-step export. */}
    <Captions />
  </AbsoluteFill>
);

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection title="Reel">
        <DCArtboard id="reel" label="Reel" width={1920} height={1080}>
          <VideoComp component={Reel} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
```

For 6+ beats, write 6+ literal blocks — verbose but Timeline-parseable
(drag-to-retime, per-beat inspect, ⇄ replace-media). **Never** shorten with a
loop.
