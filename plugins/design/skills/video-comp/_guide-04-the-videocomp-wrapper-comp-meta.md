## The `<VideoComp>` wrapper + comp meta

Mount the composition inside a `DCArtboard` whose width/height match the comp.
`<VideoComp>` carries the **comp meta** (`fps` / `durationInFrames` / `width` /
`height`) that both the Player and the exporter read:

```tsx
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const Title = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: 'var(--bg-0)', color: 'var(--fg-0)', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: `translateY(${y}px)`, opacity, fontSize: 72, fontWeight: 800 }}>Hello</div>
    </AbsoluteFill>
  );
};

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection title="Hero video">
        <DCArtboard id="hero" label="Hero" width={1280} height={720}>
          <VideoComp component={Title} durationInFrames={90} fps={30} width={1280} height={720} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
```

- Use **DS tokens** (`var(--bg-0)`, `var(--accent)`, `var(--fg-0)`) for colors,
  same as any canvas — a video-comp is still a DS surface.
- Multiple comps on one canvas → give each `<VideoComp id="…">` a stable id.
- **Keep `<Sequence>`/`<TransitionSeries.Sequence>` structure parseable** (literal
  `from` / `durationInFrames` props, one block per beat) — the Timeline panel
  reads it directly.
