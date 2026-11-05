// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// Three links and two buttons. What's new lives in the release chip and a teaser above the footer;
// Changelog, Roadmap and About live in the footer; the coffee stays in the nav too, quietly.
// The skip link is the root layout's.
import Link from 'next/link';
import { gitConfig } from '@/lib/shared';
import { Mark } from './kit/glyphs';
import { MobileMenu } from './mobile-menu.client';
import { NavBuy } from './nav-buy.client';
import { NavLinks } from './nav-links.client';

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
export const coffeeUrl = 'https://www.buymeacoffee.com/mdovrtelm';

export function SiteNav() {
  return (
    <header className="ps-nav-row">
      <nav className="island ps-nav" aria-label="Main">
        <Link className="ps-brand" href="/">
          <Mark size={24} /> maude
        </Link>
        <NavLinks />
        <span className="ps-nav-end">
          <a className="ps-gh ps-coffee" href={coffeeUrl}>
            Buy me a coffee
          </a>
          <a className="ps-gh" href={githubUrl}>
            GitHub
          </a>
          <Link className="btn btn--ghost btn--sm ps-dl" href="/desktop" data-track="nav-download">
            Download
          </Link>
          <NavBuy />
          <MobileMenu github={githubUrl} />
        </span>
      </nav>
    </header>
  );
}
