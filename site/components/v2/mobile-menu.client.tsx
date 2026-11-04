'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { Icon } from './kit/glyphs';
import { NavLinks } from './nav-links.client';

/** Under 720 px the three links, GitHub and Download move into a sheet under the island. */
export function MobileMenu({ github }: { github: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const path = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the sheet when the page changes
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="icon-btn ps-m-menu"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'close' : 'menu'} size={18} />
      </button>
      <nav id={id} className="island ps-sheet" aria-label="Menu" hidden={!open}>
        <NavLinks className="ps-sheet-links" />
        <a className="ps-sheet-link" href={github}>
          GitHub
        </a>
        <Link className="ps-sheet-link" href="/desktop">
          Download
        </Link>
      </nav>
    </>
  );
}
