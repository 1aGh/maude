// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import Link from 'next/link';
import { Mark } from './kit/glyphs';
import { githubUrl } from './site-nav';

type FootLink = [text: string, href: string];

// "Maude vs Figma" (canvas, Product column) is left out until that page exists.
const COLS: [string, FootLink[]][] = [
  [
    'Product',
    [
      ['Download for Mac', '/desktop'],
      ['Maude Cloud', '/cloud'],
      ['Pricing', '/cloud#pricing'],
      ["What's new", '/whats-new'],
    ],
  ],
  [
    'Docs',
    [
      ['Getting started', '/docs/getting-started'],
      ['Using Maude', '/docs'],
      ['Advanced', '/docs#advanced'],
      ['Recipes', '/docs/recipes'],
    ],
  ],
  [
    'Project',
    [
      ['GitHub', githubUrl],
      ['Changelog', '/changelog'],
      ['Roadmap', '/roadmap'],
      ['About', '/about'],
      ['Buy me a coffee', 'https://www.buymeacoffee.com/mdovrtelm'],
    ],
  ],
  [
    'Legal',
    [
      ['Terms', '/terms'],
      ['Privacy', '/privacy'],
      ['Data processing', '/dpa'],
    ],
  ],
];

export function SiteFoot() {
  return (
    <footer className="ps-foot">
      <div className="ps-wrap">
        <div className="ps-foot-grid">
          <div className="ps-foot-col ps-foot-brand">
            <Link className="ps-brand" href="/" style={{ fontSize: 'var(--type-xl)' }}>
              <Mark size={40} /> maude
            </Link>
            <p className="ps-small">
              A design canvas built around AI. Free and open-source, made in Brno by Michal.
            </p>
          </div>
          {COLS.map(([h, items]) => (
            <div key={h} className="ps-foot-col">
              <b>{h}</b>
              {items.map(([text, href]) =>
                href.startsWith('http') ? (
                  <a key={text} href={href}>
                    {text}
                  </a>
                ) : (
                  <Link key={text} href={href}>
                    {text}
                  </Link>
                )
              )}
            </div>
          ))}
        </div>
        <div className="ps-foot-base">
          <span>MIT license · no telemetry</span>
          <span>maude.sh</span>
        </div>
      </div>
    </footer>
  );
}
