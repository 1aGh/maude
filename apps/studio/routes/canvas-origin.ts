// The canvas server's routes map — V2-2.5. Moved verbatim out of server.ts
// `startCanvasServer` so a test can hold it to `CANVAS_SAFE_API` (http.ts):
// test/canvas-origin-parity.test.ts. server.ts calls this for the canvas AND
// the capture listener (the capture origin wraps each entry in its GET/HEAD
// gate — never a third allowlist, V2-2.8 S9).
//
// A NEW canvas-safe route does not edit this file or CANVAS_SAFE_API: it is a
// table spec with `origin: 'canvas'` (routes/index.ts), and both lists derive
// it. The hand-listed entries below predate the table and stay hand-listed.

import type { Http } from '../http.ts';

type Handler = (req: Request) => Response | Promise<Response>;

/**
 * S9.9 — the `/_api/canvas-meta` keys canvas code may PATCH: exactly what canvas-lib's
 * `patchCanvasMeta` sends (an artboard drag's `layout`, the camera's `viewport`). Every
 * other key is refused from the canvas origin for ANY role, so a planted canvas cannot
 * reach a lane the canvas runtime never uses (overlays / locked are the shell's).
 */
export const CANVAS_ORIGIN_META_KEYS: ReadonlySet<string> = new Set(['layout', 'viewport']);

function canvasOriginMeta(handler: Handler): Handler {
  // Own props carried over (Object.assign below) so a tagged test handler keeps its tag.
  const wrapped: Handler = async (req) => {
    if (req.method === 'PATCH' || req.method === 'POST') {
      let patch: unknown;
      try {
        patch = ((await req.clone().json()) as { patch?: unknown } | null)?.patch;
      } catch {
        patch = undefined;
      }
      if (
        patch &&
        typeof patch === 'object' &&
        Object.keys(patch).some((k) => !CANVAS_ORIGIN_META_KEYS.has(k))
      ) {
        return Response.json(
          { error: 'read-only', reason: 'read-only', message: 'Ask the owner to change this.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }
    return handler(req);
  };
  return Object.assign(wrapped, handler);
}

export function canvasOriginRoutes(
  http: Pick<Http, 'routes' | 'canvasRoutes' | 'tableCanvasPaths'>
): Record<string, Handler> {
  // Hard allowlist of route-table endpoints (Bun matches `routes` before
  // `fetch`). Only the collab/display-data endpoints the canvas runtime needs
  // — see http.isCanvasSafeRoute for the trust rationale. The dynamic
  // /_api/comments/<id>/reply POST is fetch-handled + gated there.
  const routes: Record<string, Handler> = {
    '/_health': http.routes['/_health'],
    '/_api/git-user': http.routes['/_api/git-user'],
    '/_api/canvas-meta': canvasOriginMeta(http.routes['/_api/canvas-meta'] as Handler),
    '/_api/annotations': http.routes['/_api/annotations'],
    '/_api/annotations/ops': http.routes['/_api/annotations/ops'],
    // Phase 23 — capped binary image upload (magic-byte sniff + category cap +
    // content-addressed name + traversal guard + no-SVG, in api.saveAsset).
    // Bun matches `routes` BEFORE `fetch`, so the route must be listed here
    // explicitly — the CANVAS_SAFE_API entry alone only opens the fetch
    // fall-through (which serves files, not route handlers). See DDR (Task 9).
    '/_api/asset': http.routes['/_api/asset'],
    // Issue #126 — chunked upload; MIRROR of the CANVAS_SAFE_API entries (http.ts).
    '/_api/asset/chunk-start': http.routes['/_api/asset/chunk-start'],
    '/_api/asset/chunk': http.routes['/_api/asset/chunk'],
    '/_api/asset/chunk-finish': http.routes['/_api/asset/chunk-finish'],
    // feature-photo-editor — PhotoEdit sidecar GET/PUT. MUST be here AND in
    // CANVAS_SAFE_API (http.ts): Bun matches `routes` before `fetch`, so a
    // one-list entry 404s from the canvas iframe (the DDR-088 rollout bug).
    '/_api/photo-edit': http.routes['/_api/photo-edit'],
    // V2-2.8 S6 — NOT the main-origin handler: the canvas origin gets the
    // no-e-mail projection (names + commit counts) for @mention suggestions.
    '/_api/git-committers': http.canvasRoutes['/_api/git-committers'],
    '/_comments': http.routes['/_comments'],
  } as Record<string, Handler>;
  // V2-2.5 — the table's `origin: 'canvas'` specs: the SAME guarded handler the
  // main origin mounts (`http.routes` is behind readOnlyRefusal + guardTableRoute).
  for (const path of http.tableCanvasPaths) routes[path] = http.routes[path] as Handler;
  return routes;
}
