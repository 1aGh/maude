/**
 * @file       embed-origins.ts — who may FRAME the studio (DDR-242)
 * @scope      apps/studio/embed-origins.ts
 * @purpose    Parse `MAUDE_EMBED_ORIGINS` and build the `frame-ancestors`
 *             source list shared by the studio page and the canvas shell.
 *
 * TWO LISTS, ON PURPOSE. `MAUDE_EXTRA_SHELL_ORIGINS` names more SHELLS — pages
 * that ARE the studio under another name — and the hub's canvas door also
 * accepts them as cross-origin WRITERS (apps/hub/src/studio-proxy.mjs). An app
 * that embeds a read-only view of a canvas (orbit showing a design next to a
 * task) is not a shell and must not inherit that write power, so it gets its
 * own variable that feeds framing and nothing else.
 *
 * Twin: `parseEmbedOrigins` in apps/hub/src/embed-page.mjs — same rules; the
 * hub needs them for its signed-out embed page before any studio is involved.
 */

/**
 * Normalize a space/comma separated list to bare `scheme://host[:port]`
 * origins. An entry that is not an http(s) URL, carries a wildcard or
 * credentials, or is the opaque `null` origin is DROPPED rather than widened:
 * a typo must fail closed (the embed does not render), never open (anybody
 * may frame the studio).
 */
export function parseEmbedOrigins(raw: string | undefined | null): string[] {
  const out: string[] = [];
  for (const entry of String(raw ?? '').split(/[\s,]+/)) {
    if (!entry || entry.includes('*')) continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (url.username || url.password) continue;
    if (url.origin === 'null' || out.includes(url.origin)) continue;
    out.push(url.origin);
  }
  return out;
}

/**
 * The `frame-ancestors` source list: `'self'`, the shell origins the server
 * advertises (`mainOrigin`, already space-separated), then the embedders.
 * `frame-ancestors` is checked against EVERY ancestor, so the canvas shell —
 * framed by the studio page, which is itself framed by the embedder — needs
 * the embedder listed too.
 */
export function frameAncestors(mainOrigin?: string, embedOrigins: readonly string[] = []): string {
  return ["'self'", mainOrigin?.trim(), ...embedOrigins].filter(Boolean).join(' ');
}
