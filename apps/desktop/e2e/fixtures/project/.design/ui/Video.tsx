/**
 * @canvas   video · 12-frame, 320×180 video comp for the desktop export E2E.
 * @platform desktop
 * @stack    React 19 · TSX · Remotion
 *
 * The smallest comp the video adapters accept, so the mp4/gif scenario measures
 * the LANE (CSP-safe injection, encoder, container), not the render. Slug
 * `ui/Video.tsx` → `data-testid="canvas-row-ui-video"`.
 */
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, useCurrentFrame } from "remotion";

const W = 320, H = 180, FPS = 12, TOTAL = 12;
function Clip() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#132038", color: "#f2efe6", justifyContent: "center", alignItems: "center" }}>
      <div style={{ fontSize: 48, transform: `translateX(${f * 6}px)` }}>{f}</div>
    </AbsoluteFill>
  );
}
export default function VideoFixture() {
  return (
    <DesignCanvas>
      <DCSection id="v" title="Video E2E">
        <DCArtboard id="clip" kind="video" label="Clip · 320×180" width={W} height={H}>
          <VideoComp component={Clip} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
