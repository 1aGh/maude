// The signed-out answer to an EMBEDDED studio request — DDR-242.
//
// Another app (orbit) frames `/?open=<rel>&embed=1`. Signed in, the studio
// renders a read-only canvas. Signed OUT, the ordinary answer is a redirect to
// the sign-in page — which sends `X-Frame-Options: DENY` (it collects a
// password; browser-auth.mjs), so inside a frame the person sees the browser's
// "refused to connect" and the embedding app learns nothing.
//
// This page is the frameable replacement, and only for that request shape:
//   · no form, no asset, nothing to type a password into — a link that opens
//     the NORMAL sign-in in a new tab, returning to the same `?open=` (without
//     `embed=1`, so the person lands in the full studio);
//   · one inline script, pinned by hash, that tells the embedder
//     `auth-required` — to the parent's exact origin, and only when that origin
//     is on `MAUDE_EMBED_ORIGINS`;
//   · `frame-ancestors 'self' <embed origins>` — framed by those apps and no
//     one else.
//
// Embed origins are a FRAMING list, never a writing one. They are not added to
// the canvas door's cross-origin write allowlist (studio-proxy.mjs), which is
// the reason they are not simply more `MAUDE_EXTRA_SHELL_ORIGINS`.

import { createHash } from 'node:crypto';

import { validateReturnTo } from './return-to.mjs';
import { escapeHtml } from './studio-door.mjs';

/**
 * `MAUDE_EMBED_ORIGINS` → bare origins. Space/comma separated; anything that is
 * not an http(s) URL, carries a wildcard or credentials, or is the opaque
 * `null` origin is dropped — a typo fails closed, never open.
 * Twin: `parseEmbedOrigins` in apps/studio/embed-origins.ts.
 */
export function parseEmbedOrigins(raw) {
  const out = [];
  for (const entry of String(raw ?? '').split(/[\s,]+/)) {
    if (!entry || entry.includes('*')) continue;
    let url;
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

/** Is this the studio page asked for in embed mode? */
export function isEmbedPageRequest(request, pathname) {
  if (request?.method && request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (pathname !== '/' && pathname !== '/index.html') return false;
  try {
    return new URL(request?.url ?? '/', 'http://hub.invalid').searchParams.get('embed') === '1';
  } catch {
    return false;
  }
}

/** The `?open=` the embed asked for, validated exactly like a return-to. */
function requestedOpen(request) {
  let values = [];
  try {
    values = new URL(request?.url ?? '/', 'http://hub.invalid').searchParams.getAll('open');
  } catch {
    /* no usable query */
  }
  if (values.length !== 1) return null;
  const address = validateReturnTo(
    `/?open=${values[0].split('/').map(encodeURIComponent).join('/')}`
  );
  return address ? { address, rel: decodeURIComponent(address.slice('/?open='.length)) } : null;
}

/** JSON that is safe inside an inline `<script>`: no `</script>`, no `<!--`. */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Build the page. Returns `{ html, headers }` so the HTTP layer only writes it
 * and a test can assert the headers without a socket.
 */
export function embedSignInPage({ request, env = process.env }) {
  const origins = parseEmbedOrigins(env.MAUDE_EMBED_ORIGINS);
  const open = requestedOpen(request);
  // The contract (apps/studio/client/embed.js): source, v, type, open.
  const script =
    `(function(){var d=${scriptJson({ allow: origins, open: open?.rel ?? '' })};var o=null;` +
    'try{var a=window.location.ancestorOrigins;if(a&&a.length)o=a[0];' +
    'else if(document.referrer)o=new URL(document.referrer).origin}catch(e){}' +
    "if(o&&o!=='null'&&window.parent!==window&&d.allow.indexOf(o)!==-1){" +
    "try{window.parent.postMessage({source:'maude-hub',v:1,type:'auth-required',open:d.open},o)}catch(e){}}})();";
  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  const href = open?.address ?? '/';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to the design hub</title>
<style>
:root{color-scheme:light dark}
html,body{margin:0;height:100%}
body{display:grid;place-items:center;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
main{max-width:28rem;padding:24px;text-align:center}
p{margin:0 0 16px}
a{display:inline-block;padding:8px 16px;border-radius:8px;border:1px solid currentColor;color:inherit;text-decoration:none;font-weight:600}
</style>
</head>
<body><main><p>You need to sign in to the design hub to see this design.</p>
<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Sign in to the design hub</a></main>
<script>${script}</script>
</body></html>`;
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    // No X-Frame-Options: it has no allowlist form, and `frame-ancestors`
    // supersedes it wherever CSP is understood.
    'content-security-policy': [
      "default-src 'none'",
      `script-src 'sha256-${hash}'`,
      "style-src 'unsafe-inline'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${["'self'", ...origins].join(' ')}`,
    ].join('; '),
  };
  return { html, headers };
}
