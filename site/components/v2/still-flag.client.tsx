'use client';

import { useEffect } from 'react';

/**
 * `?still=1` puts every intro animation on its final frame, for captures and screenshots. (The
 * canvas used `navigator.webdriver` for this; a visitor's real browser is not a capture.)
 * Reduced motion needs no flag: the CSS already rests on the final frame.
 */
export function StillFlag() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('still') === '1') {
      document.querySelector('.v2-site')?.classList.add('ps-still');
    }
  }, []);
  return null;
}
