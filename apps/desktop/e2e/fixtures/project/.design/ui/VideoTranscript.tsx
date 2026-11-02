/**
 * @canvas   video-transcript · one interview clip whose words are in a transcript sidecar, for the S7.11 E2E.
 * @platform desktop
 * @stack    React 19 · TSX · Remotion
 *
 * One beat "rozhovor" (150 frames, 5 s) playing assets/aaaa1111.mp4 — "Přišel", "Ehm…", "Za" are in
 * assets/aaaa1111.transcript.json (the words are the sidecar's; the video file itself is not needed to edit by
 * transcript). The artboard is `kind="video"`: selecting it brings the Timeline island up; Captions from speech adds
 * the captions element (the comp's derivations scan the SOURCE TEXT for its opening tag, so this comment must not
 * spell it), the Transcript panel opens, select "Ehm…" + ⌫ cuts 0.4 s. Slug `ui/VideoTranscript.tsx` →
 * `data-testid="canvas-row-ui-video-transcript"`. Restored byte-exact after every run.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, OffthreadVideo } from "remotion";
import { TransitionSeries } from "@remotion/transitions";

const TOTAL = 150;
const W = 320, H = 180, FPS = 30;

const Comp = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="rozhovor" durationInFrames={150}>
        <OffthreadVideo src="assets/aaaa1111.mp4" muted />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export default function VideoTranscript() {
  return (
    <DesignCanvas>
      <DCSection id="transcript" title="Transcript E2E">
        <DCArtboard id="reel" kind="video" label="Reel · 320×180" width={W} height={H}>
          <VideoComp component={Comp} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
