#!/usr/bin/env node
// _url-guard.mjs — the one URL rule for every browser helper the AI chat can run without a prompt
// (V2-8.9 re-check B2, decision maude/v2-p8-browser-helpers-loopback-only).
//
// `maude design screenshot` is an auto-tier verb, and it took any `--url`: `file:///Users/u/.ssh/
// id_ed25519` rendered a private key into a PNG the agent then Read from the project, and a folder
// URL listed a directory. Claude Code's own read deny rules never see a subprocess's reads. So the
// helpers (screenshot, canvas-rects, perf, smoke, visual-sanity, photo-bg-remove and
// agent-browser-safe `open`) open ONLY:
//   - http: or https:,
//   - no user name or password,
//   - a host that is `localhost` or a loopback IP literal (127.0.0.0/8, ::1, ::ffff:127.x —
//     `isLoopbackAddress` from _curl-local.mjs, the same classifier `curl-local` uses).
// No DNS: a name other than `localhost` is refused outright rather than resolved, because the
// browser resolves again on its own and a rebinding name could answer loopback to us and something
// else to it (curl-local can pin the answer with `--resolve`; a browser cannot).
// The raw string is checked too: whitespace, control characters and `\` are refused before parsing,
// because a browser strips tabs/newlines and reads `\` as `/` — the parsed URL is the WHATWG one
// Chrome and WebKit use, but a string that only parses the same after cleanup is not worth trusting.
//
// CLI: `node _url-guard.mjs <url>` → exit 0 (allowed, nothing printed) · 2 (refused, reason on
// stderr). Pure Node ESM, no dependencies beyond the sibling _curl-local.mjs.

import { pathToFileURL } from 'node:url';

import { isLoopbackAddress } from './_curl-local.mjs';

/** Why `raw` may not be opened by a browser helper, or null when it may. */
export function urlRefusal(raw) {
  if (typeof raw !== 'string' || raw === '') return 'no URL given';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control range is the point
  if (/[\u0000- \u007f\\]/.test(raw)) return 'the URL has spaces, control characters or "\\"';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 'not a URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return `only http(s) URLs to this Mac are allowed, not ${u.protocol}`;
  if (u.username || u.password) return 'a URL with a user name or password is not allowed';
  const host = u.hostname.replace(/^\[(.*)\]$/, '$1');
  if (host !== 'localhost' && !isLoopbackAddress(host))
    return `only this Mac (localhost, 127.0.0.1, [::1]) is allowed, not ${u.hostname}`;
  return null;
}

function main() {
  const [url, ...extra] = process.argv.slice(2);
  const why = extra.length ? 'expected exactly one URL' : urlRefusal(url);
  if (why) {
    process.stderr.write(`maude: refusing to open ${JSON.stringify(url ?? '')}: ${why}.\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
