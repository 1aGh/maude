'use client';

// Counts button clicks, outbound links and intro plays, anonymously (lib/track.ts).
// One listener for the whole site: an element opts in with `data-track="<name>"`;
// every link to another site counts as `outbound` with that site's host. No cookie,
// no storage, no identifier: each beacon is one anonymous row.

import { useEffect } from 'react';

function send(e: string, l: string) {
  try {
    const body = JSON.stringify({
      e,
      l,
      p: location.pathname,
      r: document.referrer || undefined,
    });
    navigator.sendBeacon?.('/api/e', new Blob([body], { type: 'text/plain' }));
  } catch {
    // best-effort
  }
}

export function Track() {
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const el = ev.target instanceof Element ? ev.target : null;
      if (!el) return;
      const tagged = el.closest<HTMLElement>('[data-track]');
      if (tagged) {
        send('click', tagged.dataset.track ?? '');
        return;
      }
      const a = el.closest<HTMLAnchorElement>('a[href]');
      if (!a) return;
      try {
        const u = new URL(a.href, location.href);
        if (/^https?:$/.test(u.protocol) && u.hostname !== location.hostname)
          send('outbound', u.hostname);
      } catch {
        // not a URL
      }
    };
    const played = new WeakSet<EventTarget>();
    const onPlay = (ev: Event) => {
      const v = ev.target;
      if (!(v instanceof HTMLVideoElement) || !v.dataset.track || played.has(v)) return;
      played.add(v); // once per page view, not on every resume
      send('video', v.dataset.track);
    };
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('play', onPlay, { capture: true });
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('play', onPlay, { capture: true });
    };
  }, []);
  return null;
}
