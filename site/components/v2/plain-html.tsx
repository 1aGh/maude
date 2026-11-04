// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The file story for people who never opened one: a private format vs the web's own language,
// told in four short beats, with a slider that wipes the design into the file behind it.
import { Icon } from './kit/glyphs';
import { PRICE } from './price';
import { Wipe } from './wipe.client';

export function PlainHtml() {
  return (
    <section className="ps-wrap ps-section" aria-labelledby="h-html">
      <div className="ps-html">
        <div className="ps-head" style={{ marginBottom: 0 }}>
          <span className="ps-eyebrow">No secret file format</span>
          <h2 id="h-html" className="ps-h2">
            Good ol' HTML.
            <br />
            <span className="ps-quiet">The AI knows it best.</span>
          </h2>
          {/* biome-ignore lint/a11y/noRedundantRoles: list-style none drops list semantics in Safari */}
          <ol className="ps-story" role="list">
            <li>
              <span className="ps-num">1</span>
              <p className="ps-body">
                <b>Most design tools keep your work in their own format.</b> Only their app can open
                it. Leave, and the work stays behind.
              </p>
            </li>
            <li>
              <span className="ps-num">2</span>
              <p className="ps-body">
                <b>
                  Maude saves designs as web code, the way the web has been written for 30 years.
                </b>{' '}
                HTML and CSS, the stuff every website is made of, in React's HTML-like format.
              </p>
            </li>
            <li>
              <span className="ps-num">3</span>
              <p className="ps-body">
                <b>That's the language AI grew up on.</b> It has read more web pages than anyone
                ever will. Ask for a change and it isn't decoding a strange file. It's writing in
                its mother tongue.
              </p>
            </li>
            <li>
              <span className="ps-num">4</span>
              <p className="ps-body">
                <b>So the design is already the real thing.</b> A developer ships it as it is,
                instead of rebuilding it from a picture.
              </p>
            </li>
          </ol>
        </div>
        <div className="ps-html-demo">
          <Wipe price={PRICE.project} tier="Cloud Project" />
          <div className="ps-vs">
            <div className="ps-vs-cell">
              <span className="ps-who">A private format</span>
              <span className="ps-bytes" aria-hidden="true">
                PK▒▒ ▓░ 0x7f ▒▓▒░ ▓▒ ░░▓ 0x1c ▒▓
              </span>
              <span className="ps-small">
                <Icon name="lock" size={12} /> Opens in one app
              </span>
            </div>
            <div className="ps-vs-cell" data-on="true">
              <span className="ps-who" style={{ color: 'var(--accent-text)' }}>
                Maude
              </span>
              <span className="ps-vs-plain">&lt;b&gt;{PRICE.project}&lt;/b&gt; a month</span>
              <span className="ps-small">
                <Icon name="check" size={12} /> Opens in any editor, browser or AI
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
