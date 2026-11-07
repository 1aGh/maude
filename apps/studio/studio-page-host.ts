// 2.0.7 — the studio page and its canvas frames must be on ONE site.
//
// Each canvas frame proves which canvas it was opened for with its `fc` capability (gate-b-c4,
// access/frame.ts). The shell puts `fc` on the frame's own URL; everything the canvas loads by
// itself (an `<img>`, a CSS `url()`, a font) carries it only in the Referer. WebKit — Safari and
// Playwright's WebKit — cuts the Referer of EVERY request a frame makes down to the bare origin when
// that frame is on another site than the top page, whatever Referrer-Policy the page sets. So with
// the studio on `127.0.0.1:<port>` and the canvas origin on `localhost:<port>` (two sites), every
// picture lost its capability and got the frame-less answer (403): "Picture not found".
//
// The desktop app, `maude design browse` and every printed address use `localhost`, the same site
// as the canvas origin, so they never hit this; a cell and a self-hosted workspace must already put
// the canvas domain on the studio's site (its session cookie needs it). What is left is a person
// (or a harness) typing `127.0.0.1` or `[::1]`. Their browser's own top-level navigation to the
// studio page is sent to the same port on `localhost`, where the frames are same-site again.
//
// Rejected: a Referrer-Policy (WebKit ignores it here, measured); a cookie (blocked in a
// third-party frame); `fc` in a path prefix (absolute asset paths drop it); answering frame-less
// media (widens C4). The capability check itself is unchanged.

/** A browser's own top-level navigation: Fetch Metadata says `navigate` + `document`. */
function isTopLevelNavigation(req: Request): boolean {
  return (
    req.method === 'GET' &&
    req.headers.get('sec-fetch-mode') === 'navigate' &&
    req.headers.get('sec-fetch-dest') === 'document'
  );
}

export interface StudioPageHostOpts {
  /** `ctx.canvasOrigin` — the interactive canvas origin, when the split is on. */
  canvasOrigin?: string;
  /** `ctx.mainOrigin` — the space-separated origins this studio page is served on. */
  mainOrigin?: string;
  /** A cell / workspace: public names come from configuration, never rewritten here. */
  workspace: boolean;
}

/**
 * A 307 to the same port on `localhost` for a browser's top-level navigation to the studio page
 * on a loopback IP literal, when the canvas frames live on `localhost`; otherwise null (serve the
 * page). The port must be the one this studio is bound on (`mainOrigin`), so the redirect never
 * names a listener that is not ours, and the target host is fixed — nothing from the request but
 * the port (checked), the path and the query is carried over.
 */
export function studioPageHostRedirect(req: Request, opts: StudioPageHostOpts): Response | null {
  if (opts.workspace || !opts.canvasOrigin || !opts.mainOrigin) return null;
  if (!isTopLevelNavigation(req)) return null;
  let canvasHost: string;
  let url: URL;
  try {
    canvasHost = new URL(opts.canvasOrigin).hostname;
    url = new URL(req.url);
  } catch {
    return null;
  }
  if (canvasHost !== 'localhost') return null;
  if (url.protocol !== 'http:') return null;
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return null;
  // The port this studio is bound on: `mainOrigin` lists it on BOTH loopback names (server.ts);
  // an extra shell origin naming only `localhost:<other>` never qualifies.
  const target = `http://localhost:${url.port}`;
  const ours = opts.mainOrigin.split(/\s+/);
  if (!url.port || !ours.includes(target) || !ours.includes(`http://127.0.0.1:${url.port}`))
    return null;
  return new Response(null, {
    status: 307,
    headers: { Location: `${target}${url.pathname}${url.search}`, 'Cache-Control': 'no-store' },
  });
}
