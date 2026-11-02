// Loopback token proxy for the render service (DDR-230).
//
// The adapters (and the playwright shims they spawn) are written against a
// token-free loopback dev-server; pointing `ctx.serverOrigin` at this proxy
// keeps them byte-identical while every upstream request carries
// `?t=<token>` — the exact query parameter the member's own iframes use
// (client/canvas-url.js). GET/HEAD only: the grant is read-only and so is
// this hop.
//
// Extracted from server.ts so the proxy is testable without importing the
// service (whose boot assert `process.exit`s under credential-shaped env —
// e.g. any CI runner with GITHUB_TOKEN set).

export interface CanvasUpstream {
  origin: string;
  token?: string;
  /**
   * gate-b-c4 — the frame capability the cell minted for the job's canvases (studio
   * access/frame.ts): appended to every upstream request, so the canvas origin answers the render
   * as the requester narrowed to exactly those canvases.
   */
  frame?: string;
}

export interface TokenProxy {
  origin: string;
  stop: () => void;
  log: () => string;
}

export function startTokenProxy(canvas: CanvasUpstream): TokenProxy {
  const upstreamBase = canvas.origin.replace(/\/+$/, '');
  // Per-request diagnostics — surfaced in the render error so a stuck canvas
  // load ("goto: Timeout") is debuggable from the export dialog rather than
  // container logs we cannot read remotely.
  const entries: string[] = [];
  const record = (line: string) => {
    if (entries.length < 60) entries.push(line);
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        record(`${req.method} ${new URL(req.url).pathname} -> 405 (proxy read-only)`);
        return new Response('read-only proxy', { status: 405 });
      }
      const url = new URL(req.url);
      const upstream = new URL(`${upstreamBase}${url.pathname}${url.search}`);
      if (canvas.token) upstream.searchParams.set('t', canvas.token);
      if (typeof canvas.frame === 'string' && canvas.frame)
        upstream.searchParams.set('fc', canvas.frame);
      const t0 = performance.now();
      try {
        const r = await fetch(upstream, {
          method: req.method,
          // Per-request ceiling: a single canvas sub-resource must not hang the
          // whole render. On timeout this throws, is logged, and 504s that one
          // resource instead of letting the browser wait out the goto timeout.
          signal: AbortSignal.timeout(25_000),
          // A redirect is the second SSRF lane (security-review): a 3xx from the
          // canvas origin to `http://169.254.169.254/…` would be followed by
          // default. The canvas surface never legitimately redirects, so refuse.
          redirect: 'error',
          headers: {
            accept: req.headers.get('accept') ?? '*/*',
            // Identity, deliberately: Bun's fetch would otherwise advertise
            // gzip/br, the edge would compress, and the decompressed body would
            // travel on with stale headers (see below). Asking for plain bytes
            // removes the decompress hop entirely on the honest path.
            'accept-encoding': 'identity',
            // Selects the hub's capability-gated canvas LANE when host-based
            // detection can't (a self-hosted sidecar reaching the hub over the
            // compose network). Selection only — authorization is still the `t`
            // capability; without it this header opens nothing.
            'x-maude-canvas-origin': '1',
          },
        });
        record(`${url.pathname} -> ${r.status} (${Math.round(performance.now() - t0)}ms)`);
        // NEVER replay the upstream Response verbatim (`return r`) — that
        // shipped broken through v1.0.5: Bun's fetch transparently decompresses
        // a gzip/br body but keeps the upstream `content-encoding` + compressed
        // `content-length` headers, so Chromium received a header/body mismatch
        // on the main document (`ERR_CONTENT_DECODING_FAILED`), the navigation
        // never committed, and every export died as `goto: Timeout` with
        // exactly one entry in this log. Rebuild the response with the
        // encoding metadata stripped; Bun.serve re-frames the body itself.
        const headers = new Headers(r.headers);
        headers.delete('content-encoding');
        headers.delete('content-length');
        headers.delete('transfer-encoding');
        return new Response(r.body, {
          status: r.status,
          statusText: r.statusText,
          headers,
        });
      } catch (e) {
        const why = e instanceof Error ? e.name || e.message : String(e);
        record(`${url.pathname} -> ERR ${why} (${Math.round(performance.now() - t0)}ms)`);
        return new Response(`proxy upstream error: ${why}`, { status: 504 });
      }
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
    log: () => entries.join(' | '),
  };
}
