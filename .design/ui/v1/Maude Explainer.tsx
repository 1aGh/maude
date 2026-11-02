// Maude Explainer — the product showreel (Phase 1 / T1, DDR-166's onboarding
// plan). This is NOT a from-scratch composition: it's the already-produced,
// already-shipped v5 showreel (14 beats, real ElevenLabs VO + music + sound
// design, grounded in real maude captures — see scripts/video/v5/_signoff.md
// and STATE.md's 2026-06-09 "Intro video — v5 feature showreel" entry) that
// already ships as `site/public/demo.mp4`. That composition was authored in
// the separate `scripts/video/final/` Remotion workspace (non-bundled deps —
// remotion-animated, remotion-bits, @remotion/google-fonts — none of which
// resolve inside a Maude canvas per this skill's bundled-imports rule), so
// re-authoring it here would either duplicate ~2600 lines of scene code or
// require a lossy rewrite. Instead this canvas embeds the final render as a
// single `<Video>` clip — the same pattern the video-comp skill's own worked
// example uses for real footage — so the finished explainer is visible,
// scrubbable, and exportable from inside Maude too, not just on the site.
//
// Source of truth for edits: scripts/video/final/src/scenes/v5/. A re-render
// there needs a matching re-copy into .design/assets/ + this file's `SRC`/
// `TOTAL` updated (content hash + real frame count, both ffprobe-verified).

import { DCArtboard, DCSection, DesignCanvas, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill } from 'remotion';
// <Video> from @remotion/media (decode-to-canvas) — required so the export
// capture spine includes the baked-in VO/music audio track, not just picture.
import { Video } from '@remotion/media';

const SRC = '/.design/assets/e6d46406.mp4';
// ffprobe-verified against the shipped site/public/demo.mp4 (byte-identical,
// same sha256) — 3145 frames @ 30fps = 104.83s.
const TOTAL = 3145;

const Explainer = () => (
  <AbsoluteFill style={{ background: '#0b0e16' }}>
    <Video src={SRC} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
  </AbsoluteFill>
);

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection title="Maude Explainer">
        <DCArtboard id="explainer" label="Showreel (~105s, VO + music)" width={960} height={540}>
          <VideoComp component={Explainer} durationInFrames={TOTAL} fps={30} width={960} height={540} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
