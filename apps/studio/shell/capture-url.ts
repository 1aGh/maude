// The server's own captures (exporters, thumbnails) — contract `client/v2/contracts/sec-loopback-bearer.md` §7.3.
//
// A key-required server mints a frame capability on its `/_canvas-shell` 307 only for a caller that
// sent the key or the page's session. The headless browsers the server spawns itself send neither,
// so the server resolves the redirect in-process instead: the URL it hands them already points at
// the capture origin, with the capability for the one canvas it names. Leaf module: http.ts installs
// the resolver; the exporters and the thumbnail service only call `localCaptureUrl`.

type Resolver = (url: string) => string;
let resolver: Resolver | null = null;

/** http.ts — once per server. */
export function setLocalCaptureResolver(fn: Resolver | null): void {
  resolver = fn;
}

/** A main-origin `/_canvas-shell` URL → the capture-origin URL a headless child opens. */
export function localCaptureUrl(url: string): string {
  return resolver ? resolver(url) : url;
}
