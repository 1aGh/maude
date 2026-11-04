import { AbsoluteFill } from 'remotion';
import { Hook } from '../scenes/introv2/b1-hook';
import { WowVideo } from '../scenes/introv2/b2-wow-video';
import { WowPosts } from '../scenes/introv2/b3-wow-posts';
import { WowSketch } from '../scenes/introv2/b4-wow-sketch';
import { NoHandoff } from '../scenes/introv2/b5-no-handoff';
import { Team } from '../scenes/introv2/b6-team';
import { Flip } from '../scenes/introv2/b7-flip';
import { EndCard } from '../scenes/introv2/b8-end';
import { World } from '../scenes/introv2/camera';
import { CUE, FPS, TOTAL_S, useT } from '../scenes/introv2/motion';
import { SparkTraveler } from '../scenes/introv2/spark';

/**
 * IntroV2: the 70-second intro film from the approved storyboard (.design/ui/Intro Film v2.tsx,
 * BEATS). One continuous canvas: every beat lives somewhere on the same dot-grid world and the
 * camera travels between them (whips with motion blur, a dive, a pull-back), never a cross-fade.
 * The spark (the AI) travels too. Script, voice, sound and every choice:
 * scripts/video/introv2-script.md. Cue times: CUE in scenes/introv2/motion.ts.
 *
 * Render: bunx remotion render src/index.ts IntroV2 out/introv2/IntroV2.mp4
 * Mix:    bash build-introv2.sh
 */
export const INTROV2_FRAMES = Math.round(TOTAL_S * FPS); // 2115 = 70.5 s

export const IntroV2 = () => {
  const t = useT();
  return (
    <AbsoluteFill className="maude-v2 iv2" data-theme="light" style={{ background: 'var(--canvas-bg)', fontFamily: 'var(--font-body)' }}>
      <World>
        <Hook />
        <WowVideo />
        <WowPosts />
        <WowSketch hideScreen1={t >= CUE.flip.lift - 0.05 && t < 62.95} />
        <NoHandoff />
        <EndCard />
        <SparkTraveler />
      </World>
      <Team />
      <Flip />
    </AbsoluteFill>
  );
};
