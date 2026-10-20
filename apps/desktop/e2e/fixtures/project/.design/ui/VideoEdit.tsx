/**
 * @canvas   video-edit · a 3-beat storyline on a video artboard for the S7.9 edit-basics E2E.
 * @platform desktop
 * @stack    React 19 · TSX · Remotion
 *
 * Three hard-cut beats of different lengths (60 / 90 / 60 frames at 30 fps = 7 s), no media and no
 * motion, so a trim, a split and a clip menu are asserted against a stable comp. The artboard is
 * `kind="video"`, so selecting it brings the Timeline island up under it. Slug `ui/VideoEdit.tsx` →
 * `data-testid="canvas-row-ui-video-edit"`. Restored byte-exact after every run.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill } from "remotion";
import { TransitionSeries } from "@remotion/transitions";

const B1 = 60, B2 = 90, B3 = 60;
const TOTAL = B1 + B2 + B3;
const W = 320, H = 180, FPS = 30;

const Comp = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="beat-one" durationInFrames={B1}>
        <AbsoluteFill style={{ background: "#1d4ed8", display: "grid", placeItems: "center", color: "#fff", fontFamily: "system-ui", fontSize: 48 }}>1</AbsoluteFill>
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="beat-two" durationInFrames={B2}>
        <AbsoluteFill style={{ background: "#15803d", display: "grid", placeItems: "center", color: "#fff", fontFamily: "system-ui", fontSize: 48 }}>2</AbsoluteFill>
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="beat-three" durationInFrames={B3}>
        <AbsoluteFill style={{ background: "#b91c1c", display: "grid", placeItems: "center", color: "#fff", fontFamily: "system-ui", fontSize: 48 }}>3</AbsoluteFill>
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export default function VideoEdit() {
  return (
    <DesignCanvas>
      <DCSection id="edit" title="Video edit basics E2E">
        <DCArtboard id="reel" kind="video" label="Reel · 320×180" width={W} height={H}>
          <VideoComp component={Comp} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
