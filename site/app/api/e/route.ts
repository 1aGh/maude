// POST /api/e — the browser half of the site's anonymous event counts (lib/track.ts).
// Sent by components/v2/track.client.tsx with navigator.sendBeacon. Accepts only the
// known event names and plain short labels; answers 204 either way, so it tells a
// caller nothing.

import { SITE_EVENTS, type SiteEvent, track } from '@/lib/track';

export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length <= 1024) {
      const body = JSON.parse(text) as { e?: unknown; l?: unknown; p?: unknown; r?: unknown };
      // sendBeacon cannot add headers, so the page sends its own referrer in the body.
      const e = body.e as SiteEvent;
      if (SITE_EVENTS.includes(e) && e !== 'download') {
        track(
          req,
          e,
          String(body.l ?? ''),
          String(body.p ?? ''),
          typeof body.r === 'string' ? body.r : null
        );
      }
    }
  } catch {
    // malformed body: ignore
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
