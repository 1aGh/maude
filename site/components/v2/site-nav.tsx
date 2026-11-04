// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// Three links and two buttons. What's new lives in the release chip and a teaser above the footer;
// Changelog, Roadmap, About and the coffee live in the footer. The skip link is the root layout's.
import Link from 'next/link';
import { gitConfig } from '@/lib/shared';
import { Mark } from './kit/glyphs';
import { MobileMenu } from './mobile-menu.client';
import { NavBuy } from './nav-buy.client';
import { NavLinks } from './nav-links.client';

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export function SiteNav() {
  return (
    <header className="ps-nav-row">
      <nav className="island ps-nav" aria-label="Main">
        <Link className="ps-brand" href="/">
          <Mark size={24} /> maude
        </Link>
        <NavLinks />
        <span className="ps-nav-end">
          <a className="ps-gh" href={githubUrl}>
            GitHub
          </a>
          <Link className="btn btn--ghost btn--sm ps-dl" href="/desktop">
            Download
          </Link>
          <NavBuy />
          <MobileMenu github={githubUrl} />
        </span>
      </nav>
    </header>
  );
}
