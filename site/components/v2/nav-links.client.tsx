'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { id: 'product', text: 'Product', href: '/' },
  { id: 'docs', text: 'Docs', href: '/docs' },
  { id: 'cloud', text: 'Pricing', href: '/cloud' },
] as const;

function current(path: string): (typeof LINKS)[number]['id'] | null {
  if (path.startsWith('/docs')) return 'docs';
  if (path.startsWith('/cloud')) return 'cloud';
  if (path === '/' || path.startsWith('/desktop')) return 'product';
  return null;
}

/** The three top links; the one for the page you are on is marked (aria-current + a fill). */
export function NavLinks({ className = 'ps-links' }: { className?: string }) {
  const on = current(usePathname() ?? '/');
  return (
    <span className={className}>
      {LINKS.map((l) => (
        <Link
          key={l.id}
          className="ps-link"
          data-on={on === l.id ? 'true' : undefined}
          aria-current={on === l.id ? 'page' : undefined}
          href={l.href}
        >
          {l.text}
        </Link>
      ))}
    </span>
  );
}
