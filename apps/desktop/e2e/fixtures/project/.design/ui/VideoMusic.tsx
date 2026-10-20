/**
 * @canvas   video-music · two beats and a music bed with a known beat grid, for the S7.12 Music E2E.
 * @platform desktop
 * @stack    React 19 · TSX · Remotion
 *
 * Beat "oslava" (60 frames) → a 15-frame fade → beat "logo" (60 frames), and a loose music bed `assets/song.mp3`
 * under the whole reel whose beat grid (`assets/song.beats.json`, 120 BPM, a beat every 15 frames) is committed
 * beside the fixture — no audio is decoded and no analysis service is called. The bed is not in a `<Duck>` (the reel
 * has no speech), so the run turns Lower under speech on and off and watches the bytes. The artboard is
 * `kind="video"`: selecting it brings the Timeline island up; clicking the bed fills the right-hand inspector with
 * the Music rows. Slug `ui/VideoMusic.tsx` → `data-testid="canvas-row-ui-video-music"`. Restored byte-exact.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill } from "remotion";
import { Audio } from "remotion";
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
    <Audio src="assets/song.mp3" volume={0.8} />
  </AbsoluteFill>
);

export default function VideoMusic() {
  return (
    <DesignCanvas>
      <DCSection id="music" title="Music E2E">
        <DCArtboard id="reel" kind="video" label="Reel · 320×180" width={W} height={H}>
          <VideoComp component={Comp} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
