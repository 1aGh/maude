// static-lane.ts — the studio's static file lane, shared by the project server (http.ts) and the
// Home server (home/routes.ts, V2-3.3). A LEAF module on purpose: the Home server serves the same
// client bundle through the same headers without loading http.ts's whole route graph (~70 MB RSS).
// Moved verbatim out of http.ts; http.ts re-exports what it used to export.

import { join } from 'node:path';

import { CLIENT_DIR, DIST_DIR } from './paths.ts';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  // DDR-148 — video/audio media referenced by a video-comp `<Video>`/`<Audio>`.
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

export function ext(p: string): string {
  const i = p.lastIndexOf('.');
  return i === -1 ? '' : p.slice(i).toLowerCase();
}

/**
 * How long a served file may be reused — Cloud Phase 27 B2.
 *
 * `no-store` on everything is correct on a laptop, where the round trip is a
 * memcpy and the designer is editing the file you just served. Over the
 * internet it means a teammate re-downloads every photograph on every pan, on
 * a project whose media is 266 MB. So:
 *
 *   content-addressed name  →  immutable, a year. The name IS the content
 *                              (sha8), so a changed file is a changed URL and
 *                              a stale answer is impossible by construction.
 *   everything else         →  revalidate (`no-cache` + ETag). A designer
 *                              editing `hero.png` in place still sees their
 *                              edit; the wire cost of not having changed it is
 *                              a 304, not the file.
 *
 * Universal, not cloud-only: the rule is true on all three shells, and a
 * caching policy that differs per shell is a bug report nobody can reproduce.
 */
export function cacheControlFor(absPath: string): { cacheControl: string; addEtag: boolean } {
  const name = absPath.slice(absPath.lastIndexOf('/') + 1);
  // The shape every writer emits — timeline insert/replace/assemble, the asset
  // upload route, `maude design fetch-asset`: <sha8>.<ext>, lowercase hex.
  if (/^[0-9a-f]{8,64}\.[A-Za-z0-9]+$/.test(name)) {
    return { cacheControl: 'public, max-age=31536000, immutable', addEtag: false };
  }
  return { cacheControl: 'no-cache', addEtag: true };
}

/**
 * The studio page, with its bundle and stylesheet URLs VERSIONED.
 *
 * `/_client/client.bundle.js` used to be a fixed URL answered `no-cache`. Behind
 * Cloudflare that header does not survive: the zone's default Browser Cache
 * TTL turns a `.js` into `max-age=14400`, so after a release a cloud user ran
 * the previous client for up to four hours, against a server that had moved on
 * (measured on alligators after v1.6.5: new server, old bundle, none of the
 * release's UI). A query that changes whenever the built file does makes every
 * cache, ours or anyone's in front of us, fetch it again. `serveFile` ignores
 * the query, so the old URL keeps working for anything that still asks for it.
 */
export async function serveIndexHtml(extraHeaders: Record<string, string> = {}): Promise<Response> {
  const index = Bun.file(join(CLIENT_DIR, 'index.html'));
  if (!(await index.exists())) return new Response('Not found', { status: 404 });
  let html = await index.text();
  for (const name of ['client.bundle.js', 'styles.css']) {
    const built = Bun.file(join(DIST_DIR, name));
    if (!(await built.exists())) continue;
    const v = `${built.size.toString(16)}-${Math.trunc(built.lastModified).toString(16)}`;
    html = html.replaceAll(`"/_client/${name}"`, `"/_client/${name}?v=${v}"`);
  }
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

/** A weak validator from the file's own metadata — no read, no hash. */
export function etagFor(file: { size: number; lastModified: number }): string {
  return `W/"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`;
}

/**
 * An SVG is a DOCUMENT, and a document runs script.
 *
 * `image/svg+xml` is inert as an `<img>`, a CSS `url()` or a `<use>` target —
 * none of those are browsing contexts. Navigate to one directly and it is a
 * page, with `<script>` in it, executing on whatever origin served it. On the
 * canvas origin that is a stored-XSS primitive: canvases carry the tenant's own
 * SVGs, only the shell HTML gets a CSP, and every other static response here
 * has carried `nosniff` and nothing else.
 *
 * `default-src 'none'; sandbox` costs the legitimate uses nothing (an image is
 * not a document, so the policy never applies to them) and makes the
 * navigate-to-it case a blank page instead of a foothold. Found by an
 * adversarial pass as step one of a three-link cross-tenant chain; the other
 * two links are closed in the same change, and this is the cheapest of the
 * three to break.
 */
export const INERT_DOCUMENT_CSP = "default-src 'none'; sandbox";

/**
 * A repo `.html` is a document too, and on the MAIN origin a live one is the
 * whole privileged surface: same-origin with git push, `/_config`, paid
 * generation and `/_api/ui-prefs`, so its inline script passes `sameOriginWrite`
 * and the DNS-rebind guard. The agent can plant one in an auto-approved write and
 * open it; `node_modules/@1agh/maude/…/_shell.html` is one already, and with
 * `?canvas=` it renders a canvas here — what the shell's 307 exists to stop
 * (V2-2.4b gate F1, decision:maude/v2-2.4b-gate-repo-html-opaque-origin).
 *
 * `sandbox allow-scripts` without `allow-same-origin` makes the page an OPAQUE
 * origin: it shares no storage or DOM with the studio and its requests carry
 * `Origin: null`, which `sameOriginWrite` refuses. `connect-src 'none'` takes
 * fetch, XHR, EventSource and WebSocket away entirely (the collab and inspector
 * sockets check no Origin). Scripts, stylesheets and images still load, so a
 * legacy `.html` canvas — iframed from this origin by `canvasUrl` → `urlOf`, and
 * wired to the studio only by its frame's `load` event — still renders.
 * Only `.html` is a document type in MIME; `.htm`/`.xhtml`/`.xml` go out as
 * `application/octet-stream` + nosniff, which no browser renders.
 */
export const REPO_HTML_CSP = "sandbox allow-scripts; connect-src 'none'";

/** The CSP a served repo file needs because it is a document, if it is one. */
export function documentCsp(e: string): Record<string, string> {
  if (e === '.svg') return { 'Content-Security-Policy': INERT_DOCUMENT_CSP };
  if (e === '.html') return { 'Content-Security-Policy': REPO_HTML_CSP };
  return {};
}

export async function serveFile(
  absPath: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) return new Response('Not found', { status: 404 });
  const e = ext(absPath);
  const policy = cacheControlFor(absPath);
  return new Response(file, {
    headers: {
      'Content-Type': MIME[e] || 'application/octet-stream',
      'Cache-Control': policy.cacheControl,
      ...(policy.addEtag ? { ETag: etagFor(file) } : {}),
      ...documentCsp(e),
      ...headers,
    },
  });
}

/** `/_client/<rel>`: the built bundle from dist/ first, then the raw client/ source file. */
export async function serveClientAsset(rel: string): Promise<Response> {
  if (rel.includes('..')) return new Response('Forbidden', { status: 403 });
  const distHit = join(DIST_DIR, rel);
  if (await Bun.file(distHit).exists()) return serveFile(distHit);
  return serveFile(join(CLIENT_DIR, rel));
}
