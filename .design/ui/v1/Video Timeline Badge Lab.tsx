// @opt_out full
// @ds maude
// Throwaway verification fixture for the video-timeline-badge scenario
// (issue-78 / DDR-148). A single DCArtboard with an EXPLICIT kind="video"
// prop, so `.dc-artboard-video-badge` renders regardless of whether a real
// <VideoComp> is authored inside it — the scenario only needs the badge's
// CLICK to reach React (input-router.tsx yieldsClickToArtboardChrome), not
// real timeline content. Regenerable — delete and re-author from this
// description if absent.
import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function VideoTimelineBadgeLab() {
  return (
    <DesignCanvas>
      <DCArtboard kind="video" id="vtb-alpha" label="Alpha" width={600} height={400}>
        <div style={{ padding: 32, fontFamily: 'var(--font-sans, system-ui)', color: 'var(--fg-0)' }}>
          <h2 data-cd-id="vtb-alpha-title" style={{ margin: 0 }}>Video artboard</h2>
          <p style={{ color: 'var(--fg-2)' }}>
            Click the timeline badge in the label strip to open the Timeline panel.
          </p>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
