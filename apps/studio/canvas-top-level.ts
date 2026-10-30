// V2-3.6 N-M2 (b) — the interactive CANVAS origin is never a window's top frame.
//
// The desktop's navigation guard (windows.rs `navigation_allowed`) has to admit
// the canvas origin for every frame — WKWebView's policy callback does not say
// which frame is navigating — and bounces a main frame that landed there only
// after the commit. A synchronous inline script on the landed page runs first,
// with Tauri's IPC script already present, and can read the app-wide invoke key.
// So the canvas origin itself refuses a top-level document load: the browser
// marks one with `Sec-Fetch-Dest: document` (a canvas iframe is `iframe`), and
// the answer is an inert 403 — no script, sandboxed, nothing to run.
//
// Not applied to the CAPTURE origin: headless captures load it top-level by
// design (exporters, `maude design screenshot`), and the guard already refuses
// it for a window BEFORE commit (it is a loopback origin that is not the
// window's recorded canvas origin).
//
// One shape is exempt: the `photo-bg-remove` harness, which agent-browser opens
// top-level on the canvas origin because it needs that origin's canvas-safe
// asset + photo-edit writes. Exactly `/_canvas-shell.html?canvas=_photo/<slug>.bgremove.tsx`
// and no other parameter — the shell builds its module URL from the request's
// own parameters, so an extra one could point it elsewhere. The harness module
// is written by the local helper, never through a canvas-origin route.
//
// Requests without fetch metadata (bun fetch, curl, the CLI) are not browser
// navigations and pass unchanged.

const BG_REMOVE_HARNESS = /^_photo\/[a-z0-9_][a-z0-9._-]*\.bgremove\.tsx$/;

function isBgRemoveHarness(url: URL): boolean {
  if (url.pathname !== '/_canvas-shell.html' && url.pathname !== '/_canvas-shell') return false;
  // gate-b-c4 — plus the frame's capability (`fc`), which the main origin's redirect adds.
  const keys = [...url.searchParams.keys()].filter((k) => k !== 'fc').sort();
  if (keys.length !== 1 || keys[0] !== 'canvas') return false;
  if (url.searchParams.getAll('fc').length > 1) return false;
  return BG_REMOVE_HARNESS.test(url.searchParams.get('canvas') ?? '');
}

/** Is this a browser loading the URL as a top-level document? */
export function isTopLevelDocument(req: Request): boolean {
  const dest = req.headers.get('sec-fetch-dest');
  if (dest) return dest.toLowerCase() === 'document';
  // No Sec-Fetch-Dest but a navigate mode: a browser that sends only part of
  // the metadata. Treat it as a top-level load — iframes always send `iframe`.
  return (req.headers.get('sec-fetch-mode') ?? '').toLowerCase() === 'navigate';
}

export function canvasTopLevelRefusal(req: Request): Response | null {
  if (!isTopLevelDocument(req)) return null;
  if (isBgRemoveHarness(new URL(req.url))) return null;
  return new Response('the canvas origin is never a top-level page', {
    status: 403,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

/** Each route behind the top-level gate (Bun matches `routes` before `fetch`). */
export function topLevelGuardedRoutes<R extends Record<string, unknown>>(routes: R): R {
  const out: Record<string, unknown> = {};
  for (const [path, handler] of Object.entries(routes)) {
    const fn = handler as (req: Request) => Response | Promise<Response>;
    out[path] = (req: Request) => canvasTopLevelRefusal(req) ?? fn(req);
  }
  return out as R;
}
