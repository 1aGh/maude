## Vocabulary: sequences, series, transitions, media

- **`<Sequence from={30} durationInFrames={60}>`** — time-shift a child so its
  own `useCurrentFrame()` starts at 0 when the parent hits frame 30.
- **`<Series>` / `<Series.Sequence durationInFrames={…}>`** — lay beats back-to-back
  without hand-computing offsets.
- **`<TransitionSeries>`** — beats joined by transitions (the "spoj tyhle klipy"
  vocabulary):

```tsx
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}><Clip src="assets/a.mp4" /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
  <TransitionSeries.Sequence durationInFrames={60}><Clip src="assets/b.mp4" /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={linearTiming({ durationInFrames: 15 })} />
  <TransitionSeries.Sequence durationInFrames={60}><Clip src="assets/c.mp4" /></TransitionSeries.Sequence>
</TransitionSeries>
```

- **Video/audio**: `<Video src="assets/clip.mp4" />` and
  `<Audio src="assets/music.mp3" volume={0.6} trimBefore={30} />` — **both from
  `@remotion/media`**, see "Audio in exports" below. Sources are
  **always** relative `assets/…` paths (see below).
