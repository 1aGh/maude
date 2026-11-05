// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The big features in one bento, each with a small picture of itself. Only shipped features, named
// the way the What's New feed names them (apps/studio/whats-new.json).
import type { ReactNode } from 'react';
import { Cursor, Sticky } from './kit/canvas';
import { Icon, Spark } from './kit/glyphs';
import { Thumb } from './kit/thumb';

function Feat({
  wide = false,
  icon,
  title,
  children,
  pic,
  ai = false,
}: {
  wide?: boolean;
  icon: string;
  title: string;
  children: ReactNode;
  pic: ReactNode;
  ai?: boolean;
}) {
  return (
    <article className="ps-card ps-feat ps-r" data-wide={wide ? 'true' : undefined}>
      <div className="ps-feat-pic" aria-hidden="true">
        {pic}
      </div>
      <div className="ps-feat-txt">
        <h3 className="ps-h3">
          <span className={`ps-ico${ai ? ' ps-ico--ai' : ''}`}>
            {ai ? <Spark size={14} /> : <Icon name={icon} size={14} />}
          </span>
          {title}
        </h3>
        <p className="ps-small">{children}</p>
      </div>
    </article>
  );
}

const VIDEO_CLIPS = [18, 26, 14, 22, 20];
const AUDIO_BARS = Array.from({ length: 36 }, (_, i) => 30 + ((i * 37) % 60));
const GEN_BARS = Array.from({ length: 22 }, (_, i) => 25 + ((i * 53) % 70));
const EXPORTS = ['PNG', 'PDF', 'Slides', 'MP4', 'Lottie', 'Code'];

export function Features() {
  return (
    <section className="ps-wrap ps-section--tight" aria-labelledby="h-feat">
      <div className="ps-head ps-center">
        <span className="ps-eyebrow">What Maude can do</span>
        <h2 id="h-feat" className="ps-h2">
          One canvas. Screens, reels,
          <br />
          slides and print.
        </h2>
      </div>
      <div className="ps-bento">
        <Feat
          wide
          ai
          icon="video"
          title="AI video editing"
          pic={
            <div className="fp-video">
              <span className="fp-frame">
                <Thumb art="video" />
                <span className="fp-cap">“and that's the whole trick”</span>
              </span>
              <span className="fp-track">
                {VIDEO_CLIPS.map((w) => (
                  <i key={w} style={{ flex: w }} />
                ))}
              </span>
              <span className="fp-track fp-track--audio">
                {AUDIO_BARS.map((h, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars of a fixed picture
                  <i key={i} style={{ height: `${h}%` }} />
                ))}
              </span>
              <span className="fp-head" style={{ left: '46%' }} />
            </div>
          }
        >
          Drop in raw clips. AI watches them, picks the good moments and cuts a reel with captions,
          music and transitions. Then fine-tune it on a timeline.
        </Feat>
        <Feat
          icon="print"
          title="Print-ready"
          pic={
            <div className="fp-print">
              <span className="fp-paper">
                <b>Open studio</b>
                <i />
                <i />
              </span>
              <span className="fp-crop" />
            </div>
          }
        >
          Flyers, posters and business cards, exported as PDFs a print shop will accept.
        </Feat>
        <Feat
          icon="pulse"
          title="Interactive prototypes"
          pic={
            <div className="fp-proto">
              <span className="fp-phone">
                <i />
                <span className="fp-btn">Sign up</span>
              </span>
              <span className="fp-arrow" />
              <span className="fp-phone">
                <i />
                <b>Welcome!</b>
              </span>
              <span className="fp-tap" />
            </div>
          }
        >
          A design is real code, so buttons click, forms type and a whole user flow plays, before
          anyone builds it.
        </Feat>
        <Feat
          icon="play"
          title="Present"
          pic={
            <div className="fp-present">
              <span className="fp-slide">
                <b>Q4 launch</b>
                <i />
              </span>
              <span className="fp-count">3 / 8</span>
            </div>
          }
        >
          Preview, Edit and Present in one switch. Your artboards, full screen, straight from the
          canvas.
        </Feat>
        <Feat
          icon="people"
          title="Work together, live"
          pic={
            <div className="fp-multi">
              <span className="fp-board" />
              <Cursor name="tereza" x={40} y={34} />
              <Cursor name="jonas" x={74} y={104} />
              <Sticky color="yellow" x={168} y={22} rotate={3} w={88}>
                Bigger logo?
              </Sticky>
            </div>
          }
        >
          Everyone in the same version at once: cursors, stickies and comments that stay where you
          put them.
        </Feat>
        <Feat
          wide
          ai
          icon="system"
          title="A design system from a moodboard"
          pic={
            <div className="fp-mood">
              <span className="fp-tiles">
                <i style={{ background: 'var(--object-lilac)' }} />
                <i style={{ background: 'var(--object-sky)' }} />
                <i style={{ background: 'var(--object-yellow)' }} />
                <i style={{ background: 'var(--object-green)' }} />
              </span>
              <span className="fp-to" />
              <span className="fp-ds">
                <b>Aa</b>
                <span className="fp-sw">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="fp-btns">
                  <span className="btn btn--primary btn--sm">Button</span>
                  <span className="btn btn--sm">Button</span>
                </span>
              </span>
            </div>
          }
        >
          Describe your brand. AI researches the field, shows moodboard directions to pick from,
          then builds the colours, type, components and logo. Critics check it before you see it.
        </Feat>
        <Feat
          ai
          icon="image"
          title="AI images, music and voice"
          pic={
            <div className="fp-gen">
              <span className="fp-img">
                <Thumb art="brand" w={120} h={120} />
              </span>
              <span className="fp-wave">
                {GEN_BARS.map((h, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars of a fixed picture
                  <i key={i} style={{ height: `${h}%` }} />
                ))}
              </span>
            </div>
          }
        >
          Generate pictures, clips, music, voiceover and subtitles with your own AI key, placed
          right on the canvas.
        </Feat>
        <Feat
          icon="insert"
          title="Bring your Figma work"
          pic={
            <div className="fp-import">
              <span className="fp-file">Brand.fig</span>
              <span className="fp-to" />
              <span className="fp-art" />
            </div>
          }
        >
          Import a Figma file, no Figma account needed. Fonts and boards come along, and artboards
          turn editable.
        </Feat>
        <Feat
          icon="crop"
          title="Photo editing"
          pic={
            <div className="fp-photo">
              <span className="fp-pic">
                <Thumb art="brand" w={150} h={120} />
              </span>
              <span className="fp-cut" />
            </div>
          }
        >
          Adjust and retouch photos right on the canvas, or remove a background in one click.
        </Feat>
        <Feat
          icon="export"
          title="Export anywhere"
          pic={
            <div className="fp-exp">
              {EXPORTS.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          }
        >
          Images, documents, slides, video, Lottie animations, or a handoff a developer can drop
          into the app.
        </Feat>
      </div>
    </section>
  );
}
