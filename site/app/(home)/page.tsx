import type { Metadata } from 'next';
import { AdvancedDoor } from '@/components/v2/advanced-door';
import { CloudBand } from '@/components/v2/cloud-band';
import { Features } from '@/components/v2/features';
import { Hero } from '@/components/v2/hero';
import { HeroShot, HeroShotMobile } from '@/components/v2/hero-shot';
import { How } from '@/components/v2/how';
import { PlainHtml } from '@/components/v2/plain-html';
import { Proof } from '@/components/v2/proof';
import { WhatsNewTeaser } from '@/components/v2/whats-new-teaser';
import { Why } from '@/components/v2/why';
import { Yours } from '@/components/v2/yours';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

// Home, in the canvas's order: hero, product shot, proof, why, how, features, ownership, the file
// story, Cloud, Advanced, What's new. The intro film's slot is added with the film (Phase C).
export default function HomePage() {
  return (
    <main id="main-content">
      <Hero />
      <div className="ps-wrap">
        <HeroShot />
        <HeroShotMobile />
      </div>
      <Proof />
      <Why />
      <How />
      <Features />
      <Yours />
      <PlainHtml />
      <CloudBand />
      <AdvancedDoor />
      <WhatsNewTeaser />
    </main>
  );
}
