/**
 * @canvas   video-formats · one Reels video with a picture clip, for the S7.13 linked-formats and Re-frame E2E.
 * @platform desktop
 * @stack    React 19 · TSX · Remotion
 *
 * One 9:16 video `reel` (180 × 320) whose comp `Recap` is a single picture clip `shot` (`assets/pic.png`, 3 s). The run
 * adds a 16:9 format (a linked copy), makes an unlinked copy, and drags the Re-frame window on `shot`; every write is
 * watched in this file's bytes and ⌘Z puts them back. Slug `ui/VideoFormats.tsx` →
 * `data-testid="canvas-row-ui-video-formats"`. Restored byte-exact.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, Img } from "remotion";
import { TransitionSeries } from "@remotion/transitions";

const TOTAL = 90;
const FPS = 30;

const Recap = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="shot" durationInFrames={90}>
        <Img src="assets/pic.png" />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export default function VideoFormats() {
  return (
    <DesignCanvas>
      <DCSection id="formats" title="Formats E2E">
        <DCArtboard id="reel" kind="video" label="Recap · Reels · 0:03" width={180} height={320}>
          <VideoComp component={Recap} durationInFrames={TOTAL} fps={FPS} width={180} height={320} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
