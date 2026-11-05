'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CLOUD_CTA_ON } from './pilot';

/** Get Maude Cloud. On Home the hero owns the primary (Download), so this steps back until the hero scrolls away. */
export function NavBuy({ href = '/cloud' }: { href?: string }) {
  const home = usePathname() === '/';
  const [heroInView, setHeroInView] = useState(true);
  useEffect(() => {
    const hero = home ? document.getElementById('v2-hero') : null;
    if (!hero || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setHeroInView(e.isIntersecting));
    io.observe(hero);
    return () => io.disconnect();
  }, [home]);
  const quiet = home && heroInView;
  if (!CLOUD_CTA_ON) return null;
  return (
    <Link className={`btn btn--sm ps-buy${quiet ? '' : ' btn--primary'}`} href={href}>
      Get Maude Cloud
    </Link>
  );
}
