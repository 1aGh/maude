/**
 * The intro film (plan Phase C). The MP4 is served from site/public with a real video/mp4 type:
 * the GitHub release asset (release intro-v2, used by the README) answers application/octet-stream
 * as an attachment, which WebKit refuses to load, so Safari would show a dead player.
 */
const SRC = '/intro.mp4';

export function IntroFilm() {
  return (
    <section id="intro" className="ps-wrap ps-section--tight" aria-labelledby="h-intro">
      <div className="ps-head ps-center">
        <span className="ps-eyebrow">The 1-minute intro</span>
        <h2 id="h-intro" className="ps-h2">
          See it before you download it.
        </h2>
      </div>
      <div className="ps-film">
        <video
          controls
          playsInline
          preload="metadata"
          poster="/intro-poster.jpg"
          width={1920}
          height={1080}
        >
          <source src={SRC} type="video/mp4" />
          <track kind="captions" src="/intro.vtt" srcLang="en" label="English" default />
          Your browser can't play this video. <a href={SRC}>Download the intro (MP4)</a>.
        </video>
      </div>
      <p className="ps-small ps-film-note">Voice and music are AI-generated.</p>
    </section>
  );
}
