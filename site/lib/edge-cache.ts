// Cache-Control for the two GitHub-backed routes (the updater feed and the
// download redirect), on hosts that do not cache a function's response by itself.
//
// On Vercel the CDN honours the route's `s-maxage`. A Cloudflare Worker sits IN
// FRONT of the CDN, so every request would run the route, and each run is a GitHub
// API call (60/h without a token, shared by every Worker on the egress IP). The
// Workers Cache API closes that gap: the stored copy lives for the response's own
// `s-maxage`, so the route's Cache-Control stays the one place the lifetime is set.
//
// Anywhere the Cache API is absent (Vercel's Node runtime, `next dev`) this is a
// pass-through. The Cache API is also a no-op on a `*.workers.dev` hostname, so the
// cache starts working once the custom domain is attached.

const ORIGINAL_CC = 'x-edge-original-cache-control';

type WorkersCache = { default?: Cache };

function sMaxAge(res: Response): number {
  const m = /(?:^|[\s,])s-maxage=(\d+)/i.exec(res.headers.get('cache-control') ?? '');
  return m ? Number(m[1]) : 0;
}

export async function withEdgeCache(
  req: Request,
  compute: () => Promise<Response>
): Promise<Response> {
  const cache = (globalThis as { caches?: WorkersCache }).caches?.default;
  if (!cache) return compute();

  const key = new Request(new URL(req.url).href, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) {
    // Hand back the route's own Cache-Control, not the storage TTL set below.
    const out = new Response(hit.body, hit);
    const original = out.headers.get(ORIGINAL_CC);
    out.headers.delete(ORIGINAL_CC);
    if (original) out.headers.set('Cache-Control', original);
    return out;
  }

  const res = await compute();
  const ttl = sMaxAge(res);
  // Redirects, 204 and 2xx are cacheable here; errors (4xx/5xx) never are.
  if (ttl > 0 && res.status < 400) {
    const stored = new Response(res.body ? await res.clone().arrayBuffer() : null, res);
    stored.headers.set(ORIGINAL_CC, res.headers.get('cache-control') ?? '');
    stored.headers.set('Cache-Control', `public, max-age=${ttl}`);
    await cache.put(key, stored);
  }
  return res;
}
