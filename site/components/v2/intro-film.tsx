/**
 * The one-minute intro film (plan Phase C). The MP4 ships as a GitHub release asset, not in
 * site/public (up to 16 MB per cut would live in the repo forever); poster and captions are local.
 * NEXT_PUBLIC_INTRO_URL names the asset; without it the player points at /intro.mp4, which a local
 * preview can drop into site/public (gitignored).
 */
const SRC = process.env.NEXT_PUBLIC_INTRO_URL ?? '/intro.mp4';

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
    </section>
  );
}
