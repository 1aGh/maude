/**
 * @canvas   video-clip-inspect · two beats joined by a fade, and a title over them, for the S7.10 clip-inspector E2E.
 * @platform desktop
 * @stack    React 19 · TSX · Remotion
 *
 * Beat "oslava" (60 frames) → a 15-frame fade → beat "logo" (60 frames), and a standalone title "PROČ ALLIGATORS"
 * (from 10, 45 frames) over them. No media, so the run is stable. The artboard is `kind="video"`, so selecting it
 * brings the Timeline island up; clicking a clip fills the right-hand inspector, clicking the dot between the two beats
 * opens the join picker. Slug `ui/VideoClipInspect.tsx` → `data-testid="canvas-row-ui-video-clip-inspect"`.
 * Restored byte-exact after every run.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, Sequence } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

const B1 = 60, B2 = 60, TRANS = 15;
const TOTAL = B1 + B2 - TRANS;
const W = 320, H = 180, FPS = 30;

const Comp = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="oslava" durationInFrames={B1}>
        <AbsoluteFill style={{ background: "#1d4ed8" }} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANS })} />
      <TransitionSeries.Sequence name="logo" durationInFrames={B2}>
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
