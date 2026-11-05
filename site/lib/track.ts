// Anonymous site events (downloads, button clicks) into Workers Analytics Engine.
//
// WHAT IS STORED. One row per event: the event name, a short label (a platform, a
// button name, a link's host), the page path, the referring site's host and the
// visitor's country as Cloudflare sees it. No IP address, no cookie, no identifier:
// nothing here can tell two visitors apart or follow one across pages. That is the
// promise in /docs/legal/privacy ("anonymous counts of downloads and button clicks").
//
// WHERE. The `EVENTS` binding (wrangler.jsonc → dataset `maude_site_events`). Read it
// with the SQL API: README.md § "Analytics". Off Cloudflare (`next dev`, tests) there
// is no binding and every call is a no-op.

import { getCloudflareContext } from '@opennextjs/cloudflare';

export type SiteEvent = 'download' | 'click' | 'outbound' | 'video';
export const SITE_EVENTS: readonly SiteEvent[] = ['download', 'click', 'outbound', 'video'];

type DataPoint = { indexes?: string[]; blobs?: string[]; doubles?: number[] };
type AnalyticsEngine = { writeDataPoint(p: DataPoint): void };

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|curl|wget|python|go-http/i;

/** A label is short and plain; anything else is cut to what fits. */
export function cleanLabel(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[^\w:./#-]/g, '').slice(0, 64) : '';
}

/** Only the path of a same-site page, never a query string (it could carry anything). */
export function cleanPath(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/')) return '';
  return v.split(/[?#]/)[0].slice(0, 128);
}

export function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.slice(0, 64);
  } catch {
    return '';
  }
}

function dataset(): AnalyticsEngine | null {
  try {
    const env = getCloudflareContext().env as { EVENTS?: AnalyticsEngine };
    return env.EVENTS ?? null;
  } catch {
    return null;
  }
}

/** Writes one event. Never throws: analytics must not break a download. */
export function track(
  req: Request,
  event: SiteEvent,
  label: string,
  path: string,
  referrer: string | null = req.headers.get('referer')
): void {
  try {
    if (BOT_UA.test(req.headers.get('user-agent') ?? '')) return;
    const ds = dataset();
    if (!ds) return;
    const cf = (req as { cf?: { country?: string } }).cf;
    let ref = hostOf(referrer);
    if (ref === 'maude.sh' || ref === 'www.maude.sh') ref = '';
    ds.writeDataPoint({
      indexes: [event],
      blobs: [event, cleanLabel(label), cleanPath(path), ref, cf?.country ?? ''],
      doubles: [1],
    });
  } catch {
    // swallow: counting is best-effort
  }
}
