/**
 * @canvas   video-clip-inspect · two beats joined by a fade, and a title over them, for the S7.10 clip-inspector E2E.
 * @platform desktop
 * @stack    React 19 · TSX · Remotion
 *
 * Beat "oslava" (60 frames) → a 15-frame fade → beat "logo" (60 frames), and a standalone title "PROČ ALLIGATORS"
 * (from 10, 45 frames) over them. Beat one plays `assets/aaaa1111.mp4` — a DIRECT media element, which Speed needs
 * (`playbackRate` is written on it); the file itself is not needed (the player shows "Missing"). The artboard is `kind="video"`, so selecting it
 * brings the Timeline island up; clicking a clip fills the right-hand inspector, clicking the dot between the two beats
 * opens the join picker. Slug `ui/VideoClipInspect.tsx` → `data-testid="canvas-row-ui-video-clip-inspect"`.
 * Restored byte-exact after every run.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, OffthreadVideo, Sequence } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

// literals, not named constants: the edit engine rewrites a beat's `durationInFrames` and the comp's total in place,
// and refuses an identifier or `B1 + B2 - TRANS` it cannot reason about
const TOTAL = 105;
const W = 320, H = 180, FPS = 30;

const Comp = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="oslava" durationInFrames={60}>
        <OffthreadVideo src="assets/aaaa1111.mp4" muted />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence name="logo" durationInFrames={60}>
        <AbsoluteFill style={{ background: "#15803d" }} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    <Sequence name="title" from={10} durationInFrames={45}>
      <div style={{ color: "#fff", fontFamily: "system-ui", fontSize: 28, fontWeight: 700, padding: 16 }}>{"PROČ ALLIGATORS"}</div>
    </Sequence>
  </AbsoluteFill>
);

export default function VideoClipInspect() {
  return (
    <DesignCanvas>
      <DCSection id="clip" title="Clip inspector E2E">
        <DCArtboard id="reel" kind="video" label="Reel · 320×180" width={W} height={H}>
          <VideoComp component={Comp} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
