// _thumb-route.mjs — which requests the thumbnail renderer's route handler sees (#169 item 1).

/**
 * A RegExp matching every URL that is NOT under `<origin>/`. Playwright checks a serializable matcher
 * in its own (server) half and continues a request that misses it without a hop to the handler, so
 * the capture origin's own loads skip the handler while everything else still meets it. A URL under
 * `<origin>/` has exactly that origin, so the set of requests that reach the network is the one the
 * handler alone allowed before. `origin` must be an http(s) origin as `URL.origin` prints it;
 * anything else gives a matcher for every URL (the handler then decides alone, as before).
 */
export function notUnder(origin) {
  let o = null;
  try {
    const u = new URL(String(origin));
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origin) o = u.origin;
  } catch {
    /* not an origin */
  }
  if (o === null) return /^/;
  return new RegExp(`^(?!${o.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/)`);
}
