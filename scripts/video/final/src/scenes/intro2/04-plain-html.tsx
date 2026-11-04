import { Cursor, Icon } from '../../../vendor/maude-v2/_kit';
import { SiteStage, at, tween, useMs } from './stage';

/**
 * Beat 4 (18.5–33.5 s). The file story, "Good ol' HTML" (Public Site v2 · PlainHtml).
 *
 * VO: "And here's the part that matters. Your design isn't locked in a secret format. It's plain
 * web code, the language AI grew up on. So the AI is fluent in it, and a developer can ship it
 * as it is."
 *
 * A recreation of the site section: the headline, the private-format cell on "secret format",
 * the wipe from the design into its file on "plain web code", the AI cursor on "fluent", and
 * "ships as it is" on the developer line. The card is a plan of the demo site, with no price.
 */
const CODE = `<article className="plan">
  <span>Studio</span>
  <p className="lede">
    For small teams
  </p>
  <ul>
    <li>Unlimited projects</li>
    <li>A shared library</li>
  </ul>
  <a className="button">Get started</a>
</article>`;

// Cue points on the scene clock (ms): VO starts at 400.
const C = { head: 300, secret: 2200, plain: 4800, wipeEnd: 6400, fluent: 8600, ship: 10700 };

export const I2PlainHtml = () => {
  const ms = useMs();
  // The slider starts on the design (78%), wipes to the file on "plain web code", rests mid-way.
  const pos = tween(ms, [C.plain, C.wipeEnd], [78, 26]) + tween(ms, [C.ship - 200, C.ship + 900], [0, 24]);
  const vsOn = (d: number) => ({ opacity: tween(ms, [d, d + 300], [0, 1]), transform: `translateY(${tween(ms, [d, d + 300], [10, 0])}px)` });
  return (
    <SiteStage t0={ms}>
      <div className="ps-wrap" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
        <div className="ps-html" style={{ width: '100%' }}>
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <span className="ps-eyebrow ps-a" style={{ fontSize: 'var(--type-md)', ...at(C.head) }}>No secret file format</span>
            <h2 className="ps-h2" style={{ fontSize: 'calc(var(--type-3xl) * 1.3)', whiteSpace: 'nowrap' }}>
              <span className="ps-a" style={{ display: 'inline-block', ...at(C.head + 90) }}>Good ol' HTML.</span>
              <br />
              <span className="ps-quiet ps-a" style={{ display: 'inline-block', ...at(C.head + 360) }}>The AI knows it best.</span>
            </h2>
          </div>
          <div className="ps-html-demo">
            <div className="ps-wipe ps-a" style={{ ['--pos' as string]: `${pos}%`, ...at(C.head + 500) }}>
              <div className="ps-wipe-see">
                <article className="ps-wipe-card">
                  <span className="ps-small">Studio</span>
                  <span className="ps-wipe-price"><b style={{ fontSize: 'var(--type-2xl)' }}>For small teams</b></span>
                  <ul className="ps-ticks">
                    <li><span className="ps-t"><Icon name="check" size={14} /></span><span>Unlimited projects</span></li>
                    <li><span className="ps-t"><Icon name="check" size={14} /></span><span>A shared library</span></li>
                  </ul>
                  <span className="btn btn--primary">Get started</span>
                </article>
              </div>
              <pre className="ps-code ps-wipe-file" aria-hidden="true">{CODE}</pre>
              <span className="ps-wipe-bar" aria-hidden="true"><span className="ps-wipe-knob">‹ ›</span></span>
              <span className="ps-wipe-l">What you see</span>
              <span className="ps-wipe-r">Pricing.tsx</span>
              <span className="ps-float" style={{ left: 0, top: 0, opacity: tween(ms, [C.fluent, C.fluent + 200], [0, 1]), transform: `translate(${tween(ms, [C.fluent, C.fluent + 900], [140, 0])}px, ${tween(ms, [C.fluent, C.fluent + 900], [90, 0])}px)` }}>
                <Cursor name="AI" agent x={360} y={150} />
              </span>
            </div>
            <div className="ps-vs">
              <div className="ps-vs-cell" style={vsOn(C.secret)}>
                <span className="ps-who">A private format</span>
                <span className="ps-bytes">PK▒▒ ▓░ 0x7f ▒▓▒░ ▓▒ ░░▓ 0x1c ▒▓</span>
                <span className="ps-small"><Icon name="lock" size={12} /> Opens in one app</span>
              </div>
              <div className="ps-vs-cell" data-on="true" style={vsOn(C.plain + 300)}>
                <span className="ps-who" style={{ color: 'var(--accent-text)' }}>Maude</span>
                <span className="ps-vs-plain">&lt;span&gt;Studio&lt;/span&gt;</span>
                <span className="ps-small"><Icon name="check" size={12} /> Opens in any editor, browser or AI</span>
              </div>
            </div>
            <span className="chip" style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 6, alignItems: 'center', ...vsOn(C.ship) }}>
              <Icon name="check" size={14} /> A developer ships it as it is
            </span>
          </div>
        </div>
      </div>
    </SiteStage>
  );
};
