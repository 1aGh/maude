// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The hero sits ON the canvas: the headline is a selected text layer, people and the AI are around it.

import Link from 'next/link';
import { at, T } from './clock';
import { DownloadLabel } from './download-label.client';
import { DragFloat } from './drag-float.client';
import { HeroHeadline } from './hero-headline.client';
import { Cursor, Sticky } from './kit/canvas';
import { Icon } from './kit/glyphs';
import { CLOUD_CTA_ON, PRICING_ON } from './pilot';
import { PRICE } from './price';
import { major, newest } from './released';

export function Hero() {
  return (
    <section id="v2-hero" className="ps-wrap ps-hero ps-stage" aria-labelledby="h-home">
      <DragFloat style={{ left: 40, top: 150 }}>
        <div className="ps-a ps-a--fade" style={at(T.ctas)}>
          <Sticky color="lilac" x={0} y={0} rotate={-4} w={150}>
            Go on, drag me. It's a canvas.
          </Sticky>
        </div>
      </DragFloat>
      <DragFloat style={{ right: 56, top: 120 }}>
        <div className="ps-a ps-a--fade" style={at(T.ctas + 120)}>
          <Sticky color="green" x={0} y={0} rotate={3} w={132}>
            <span className="ps-inl">
              Ship it <Icon name="check" size={14} />
            </span>
          </Sticky>
        </div>
      </DragFloat>
      <div
        className="ps-float ps-a ps-a--fade"
        style={{ left: 200, top: 330, ...at(T.ctas + 80) }}
        aria-hidden="true"
      >
        <span className="ps-roam">
          <Cursor name="tereza" x={0} y={0} />
        </span>
      </div>
      <div
        className="ps-float ps-a ps-a--glide"
        style={{
          right: 250,
          top: 300,
          ['--fx' as string]: '120px',
          ['--fy' as string]: '-60px',
          ...at(T.spark),
        }}
        aria-hidden="true"
      >
        <span className="ps-roam ps-roam--ai">
          <Cursor name="AI" agent x={0} y={0} />
        </span>
      </div>

      <div className="ps-hero-copy">
        <Link
          className="ps-announce ps-a ps-a--fade"
          href="/whats-new"
          data-track="hero-whats-new"
          style={at(0)}
        >
          <b>Maude {major} is here</b> <span className="ps-announce-t">{newest.title}</span>
          <span className="ps-announce-go">
            See what's new <Icon name="submenu" size={12} />
          </span>
        </Link>
        <HeroHeadline />
        <p className="ps-lede ps-a" style={at(T.lede)}>
          A design canvas built around AI, not bent to fit one. Draw it yourself or ask AI. Every
          design is a real file, in a project that is yours.
        </p>
        <div className="ps-row ps-a" style={{ justifyContent: 'center', ...at(T.ctas) }}>
          <Link className="btn btn--primary btn--lg" href="/desktop" data-track="hero-download">
            <DownloadLabel suffix=" · free" />
          </Link>
          {CLOUD_CTA_ON ? (
            <Link className="btn btn--lg ps-hero-more" href="/cloud" data-track="hero-cloud">
              Try Maude Cloud
            </Link>
          ) : null}
        </div>
        <span className="ps-fine ps-a ps-a--fade ps-fine-m" style={at(T.ctas + 100)}>
          A desktop app for Mac and Windows. Maude Cloud also opens in the browser.
        </span>
        <span className="ps-fine ps-a ps-a--fade ps-fine-d" style={at(T.ctas + 100)}>
          Desktop app for Mac and Windows, free and open-source.
          {PRICING_ON
            ? ` Maude Cloud from ${PRICE.project} a month per project, for the whole team.`
            : ''}{' '}
          <a href="#intro" data-track="hero-intro">
            Watch the 1-minute intro
          </a>
        </span>
      </div>
    </section>
  );
}
