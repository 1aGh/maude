'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon } from './kit/glyphs';
import { NavLinks } from './nav-links.client';

/**
 * Under 720 px the three links, GitHub and Download move into a sheet under the island. It is a
 * <details>, so it opens and closes with no JavaScript at all; the script only adds the
 * conveniences (Escape, a tap outside, closing when a link is followed).
 */
export function MobileMenu({ github }: { github: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the sheet when the page changes
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [path]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !el.open) return;
      el.open = false;
      el.querySelector('summary')?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);
  // A link to the page you are already on does not change the path, so close on the click itself.
  const closeOnLink = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a') && ref.current) ref.current.open = false;
  };
  return (
    <details ref={ref} className="ps-m-details">
      <summary className="icon-btn ps-m-menu" aria-label="Menu">
        <span className="ps-m-open">
          <Icon name="menu" size={18} />
        </span>
        <span className="ps-m-shut">
          <Icon name="close" size={18} />
        </span>
      </summary>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: links inside are natively keyboard-operable */}
      <nav className="island ps-sheet" aria-label="Menu" onClick={closeOnLink}>
        <NavLinks className="ps-sheet-links" />
        <a className="ps-sheet-link" href={github}>
          GitHub
        </a>
        <Link className="ps-sheet-link" href="/desktop">
          Download
        </Link>
      </nav>
    </details>
  );
}
