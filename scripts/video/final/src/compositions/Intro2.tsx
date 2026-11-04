import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Fragment } from 'react';
import { AbsoluteFill } from 'remotion';
import { I2Headline } from '../scenes/intro2/01-headline';
import { I2AiRun, I2Undo } from '../scenes/intro2/02-ai-run';
import { I2PlainHtml } from '../scenes/intro2/04-plain-html';
import { I2Montage } from '../scenes/intro2/05-montage';
import { I2Cloud } from '../scenes/intro2/06-cloud';
import { I2EndCard } from '../scenes/intro2/07-end-card';

/**
 * Intro2: the 60-second intro film for the v2 site (feature-public-site-v2, Phase C).
 * Script, VO lines, voice and every choice: scripts/video/intro2-script.md.
 *
 * Seven beats with 12-frame cross-fades. Each beat's `frames` includes the fade into the next,
 * so beat i starts at sum(frames before it) - 12 * i. The VO offsets in build-intro2.sh are
 * those starts + 0.4 s (see INTRO2_BEAT_STARTS below; keep the two in step).
 *
 * Render: bunx remotion render src/index.ts Intro2 out/intro2/Intro2.mp4
 * Mix:    bash build-intro2.sh
 */
export const INTRO2_FADE = 12;

export const INTRO2_SCENES: { id: string; component: React.FC; frames: number }[] = [
  { id: '1-headline', component: I2Headline, frames: 162 },
  { id: '2-ai-run', component: I2AiRun, frames: 252 },
  { id: '3-undo', component: I2Undo, frames: 177 },
  { id: '4-plain-html', component: I2PlainHtml, frames: 462 },
  { id: '5-montage', component: I2Montage, frames: 312 },
  { id: '6-cloud', component: I2Cloud, frames: 222 },
  { id: '7-end-card', component: I2EndCard, frames: 285 },
];

/** Start frame of each beat in the cut: 0, 150, 390, 555, 1005, 1305, 1515. */
export const INTRO2_BEAT_STARTS = INTRO2_SCENES.map((_, i) =>
  INTRO2_SCENES.slice(0, i).reduce((n, s) => n + s.frames, 0) - INTRO2_FADE * i,
);

export const INTRO2_TOTAL_FRAMES =
  INTRO2_SCENES.reduce((n, s) => n + s.frames, 0) - INTRO2_FADE * (INTRO2_SCENES.length - 1); // 1800 = 60 s

export const Intro2 = () => (
  <AbsoluteFill className="maude-v2" data-theme="light" style={{ backgroundColor: 'var(--canvas-bg)' }}>
    <TransitionSeries>
      {INTRO2_SCENES.map((s, i) => {
        const Scene = s.component;
        return (
          <Fragment key={s.id}>
            {i > 0 ? <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: INTRO2_FADE })} /> : null}
            <TransitionSeries.Sequence durationInFrames={s.frames}>
              <Scene />
            </TransitionSeries.Sequence>
          </Fragment>
        );
      })}
    </TransitionSeries>
  </AbsoluteFill>
);
