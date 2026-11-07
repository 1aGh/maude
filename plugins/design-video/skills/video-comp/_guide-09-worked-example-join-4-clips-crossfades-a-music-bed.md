## Worked example — join 4 clips + crossfades + a music bed

Four **literal** `<TransitionSeries.Sequence name="…">` blocks, one per beat —
not a `.map()`/`.flatMap()` over a clips array (see the callout above: a loop
is invisible to the Timeline). This is the shape to reuse whenever you're
asked to stitch N dropped clips together, however many N is.

```tsx
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Audio, Video } from '@remotion/media'; // NOT from 'remotion' — see "Audio in exports"
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';

const XF = 15; // crossfade length, shared by all 3 transitions
// 4 clips, 3 crossfades → total = sum(clip durations) - 3*XF. Keep this a
// literal sum of consts (not `clips.length * CLIP - ...`) so the Timeline
// can resolve it too.
const TOTAL = 60 + 60 + 60 + 60 - XF * 3;

const Clip = ({ src, label }: { src: string; label: string }) => {
  const frame = useCurrentFrame();
  const up = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Video src={src} />
      <AbsoluteFill style={{ justifyContent: 'flex-end', padding: 48 }}>
        <div style={{ color: 'var(--fg-0)', fontSize: 40, fontWeight: 700, opacity: up }}>{label}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Reel = () => (
  <AbsoluteFill>
    <TransitionSeries>
      <TransitionSeries.Sequence name="clip-1" durationInFrames={60}>
        <Clip src="assets/a.mp4" label="01" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
      <TransitionSeries.Sequence name="clip-2" durationInFrames={60}>
        <Clip src="assets/b.mp4" label="02" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
      <TransitionSeries.Sequence name="clip-3" durationInFrames={60}>
        <Clip src="assets/c.mp4" label="03" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
      <TransitionSeries.Sequence name="clip-4" durationInFrames={60}>
        <Clip src="assets/d.mp4" label="04" />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    {/* Music bed under the whole reel, fading out over the last 20 frames. */}
    <Audio src="assets/music.mp3" volume={(f) => interpolate(f, [TOTAL - 20, TOTAL], [0.7, 0], { extrapolateLeft: 'clamp' })} />
  </AbsoluteFill>
);

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection title="Showreel">
        <DCArtboard id="reel" label="Reel" width={1280} height={720}>
          <VideoComp component={Reel} durationInFrames={TOTAL} fps={30} width={1280} height={720} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
```

This scales to any clip count: for 6+ clips, write 6+ literal blocks — verbose
but Timeline-parseable, which is the whole point (drag-to-retime, per-clip
inspect, replace-media). Don't reach for a loop to shorten it.
