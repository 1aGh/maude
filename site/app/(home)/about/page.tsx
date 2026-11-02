import type { Metadata } from 'next';
import { SkuLabel } from '@/components/mdcc/sku-label';

export const metadata: Metadata = {
  alternates: { canonical: '/about' },
  title: 'About the maker',
  description:
    "Hi I'm Michal and I build things. Maude is a small set of vibe-design and vibe-code workflows for Claude Code.",
};

export default function AboutPage() {
  return (
    <main className="mdcc-landing" id="main-content">
      <section className="mdcc-about" aria-labelledby="about-h1">
        <div className="mdcc-about-copy">
          <div className="mdcc-hero-sku">
            <SkuLabel>MDCC-MKR/01</SkuLabel>
            <span aria-hidden="true">·</span>
            <span>MICHAL</span>
            <span aria-hidden="true">·</span>
            <span>MAINTAINER SINCE 2025-12</span>
          </div>
          <h1 id="about-h1">About the maker</h1>

          <p>Hi I&apos;m Michal and I build things.</p>

          <p>
            Maude is a Mac app for designing with AI, built on two Claude Code plugins and a CLI
            that you can use on their own. I built it, mostly at night, because I kept needing it.
          </p>

          <p>I don&apos;t fully understand why it works, but it works.</p>

          <p>I like nerdy jokes and tools without analytics. Based in Brno Czechia</p>

          <p>
            If it breaks it&apos;s almost certainly my fault. Open an issue. I read them (some
            times).
          </p>
        </div>

        <dl className="mdcc-about-meta">
          <div>
            <dt>SKU</dt>
            <dd>MDCC-MKR/01</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>Maintainer</dd>
          </div>
          <div>
            <dt>Since</dt>
            <dd>2025-12</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>Brno</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              <a href="https://github.com/1aGh/maude">github.com/1aGh/maude</a>
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
