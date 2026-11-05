import { Composition } from 'remotion';
import { Demo } from './compositions/Demo';
import { DemoCaptioned } from './compositions/DemoCaptioned';
import { Final } from './compositions/Final';
import { INTRO2_SCENES, INTRO2_TOTAL_FRAMES, Intro2 } from './compositions/Intro2';
import { INTROV2_FRAMES, IntroV2 } from './compositions/IntroV2';
import { V4, V4_TOTAL_FRAMES } from './compositions/V4';
import { V5, V5_SCENES, V5_TOTAL_FRAMES } from './compositions/V5';
import { PlaceholderScene } from './scenes/_placeholder';
import { SmokeScene } from './scenes/_smoke';
import { IntroScene } from './scenes/01-intro';
import { ContentScene } from './scenes/02-content';
import { OutroScene } from './scenes/03-outro';
import { ColdOpenScene } from './scenes/v4/00-cold-open';
import { InstallScene } from './scenes/v4/05-install';
import { OnboardingScene } from './scenes/v4/10-onboarding';
import { MoodboardScene } from './scenes/v4/12-moodboard';
import { DsRevealScene } from './scenes/v4/15-ds-reveal';
import { DesignNewScene } from './scenes/v4/20-design-new';
import { CriticsScene } from './scenes/v4/25-critics';
import { CanvasPanScene } from './scenes/v4/30-canvas-pan';
import { CmdClickScene } from './scenes/v4/35-cmd-click';
import { DesignEditScene } from './scenes/v4/40-design-edit';
import { CommentsScene } from './scenes/v4/45-comments';
import { HandoffScene } from './scenes/v4/50-handoff';
import { EndCardScene } from './scenes/v4/55-end-card';

/**
 * Composition registry. One <Composition> per scene + the master Demo cut.
 *
 * Per-scene compositions enable Studio scene preview + the regression goldens
 * harness. The Demo composition is the assembled cut for `pnpm run render Demo`.
 *
 * Add new scenes via /flow:video-new-scene <id> <duration-seconds> "<caption>".
 */

export const Root = () => (
  <>
    <Composition
      id="scene-00-placeholder"
      component={PlaceholderScene}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="SmokeCard"
      component={SmokeScene}
      durationInFrames={90}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="scene-01-intro"
      component={IntroScene}
      durationInFrames={60}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="scene-02-content"
      component={ContentScene}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="scene-03-outro"
      component={OutroScene}
      durationInFrames={75}
      fps={30}
      width={1920}
      height={1080}
    />
    {/* ── v4 scenes (phase-16 rebuild — maude DS) ── */}
    <Composition
      id="v4-00-cold-open"
      component={ColdOpenScene}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-05-install"
      component={InstallScene}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-10-onboarding"
      component={OnboardingScene}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-12-moodboard"
      component={MoodboardScene}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-15-ds-reveal"
      component={DsRevealScene}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-20-design-new"
      component={DesignNewScene}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-25-critics"
      component={CriticsScene}
      durationInFrames={210}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-30-canvas-pan"
      component={CanvasPanScene}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-35-cmd-click"
      component={CmdClickScene}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-40-design-edit"
      component={DesignEditScene}
      durationInFrames={270}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-45-comments"
      component={CommentsScene}
      durationInFrames={210}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-50-handoff"
      component={HandoffScene}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="v4-55-end-card"
      component={EndCardScene}
      durationInFrames={120}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="V4"
      component={V4}
      durationInFrames={V4_TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />

    {/* ── v5 showreel (phase-16 — supersedes V4) ── */}
    {V5_SCENES.map((s) => (
      <Composition
        key={s.id}
        id={`v5-${s.id}`}
        component={s.component}
        durationInFrames={s.frames}
        fps={30}
        width={1920}
        height={1080}
      />
    ))}
    <Composition
      id="V5"
      component={V5}
      durationInFrames={V5_TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />

    {/* ── Intro2: the v2 site's 60-second intro (feature-public-site-v2, Phase C) ── */}
    {INTRO2_SCENES.map((s) => (
      <Composition
        key={s.id}
        id={`intro2-${s.id}`}
        component={s.component}
        durationInFrames={s.frames}
        fps={30}
        width={1920}
        height={1080}
      />
    ))}
    <Composition
      id="Intro2"
      component={Intro2}
      durationInFrames={INTRO2_TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />

    {/* ── IntroV2: the approved storyboard (.design/ui/Intro Film v2.tsx), one continuous canvas ── */}
    <Composition
      id="IntroV2"
      component={IntroV2}
      durationInFrames={INTROV2_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />

    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={201}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="DemoCaptioned"
      component={DemoCaptioned}
      durationInFrames={201}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Final"
      component={Final}
      durationInFrames={2535}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
