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
// V2-8.9 re-check 2 H-a (decision maude/v2-p8-own-ports-only): loopback is every Maude server on this
// Mac — another project's terminal server on 4400 answers `/.mcp.json` too. In the Maude chat the
// bridge exports THIS session's own ports (main, canvas, capture) as MAUDE_OWN_PORTS (a key only the
// bridge sets: scrubbed, bash-guarded); any other port is refused, and a chat without a valid list
// is refused outright (fail closed). A terminal (no chat markers) keeps the plain loopback rule.
//
// CLI: `node _url-guard.mjs <url>` → exit 0 (allowed, nothing printed) · 2 (refused, reason on
// stderr). Pure Node ESM, no dependencies beyond the sibling _curl-local.mjs.

import { pathToFileURL } from 'node:url';

import { isLoopbackAddress } from './_curl-local.mjs';

const CHAT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The Maude AI chat (the bridge's markers) — same test as cli/lib/confine-read.mjs isMaudeChat. */
function isMaudeChat(env) {
  return (
    env.MAUDE_AGENT_ACTOR === 'maude-chat' ||
    (typeof env.MAUDE_CHAT_ID === 'string' && CHAT_ID_RE.test(env.MAUDE_CHAT_ID))
  );
}

/** MAUDE_OWN_PORTS → the ports, or null when it is absent or not a plain list of ports. */
export function ownPorts(env = process.env) {
  const raw = env.MAUDE_OWN_PORTS;
  if (typeof raw !== 'string' || !/^\d{1,5}(,\d{1,5})*$/.test(raw)) return null;
  const ports = raw.split(',').map(Number);
  return ports.every((p) => p > 0 && p < 65536) ? ports : null;
}

/** Why `raw` may not be opened by a browser helper, or null when it may. */
export function urlRefusal(raw, env = process.env) {
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
  if (isMaudeChat(env)) {
    const mine = ownPorts(env);
    if (!mine) return 'this AI chat has no list of its own server ports, so no page may be opened';
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (!mine.includes(port))
      return `only this project's own Maude server is allowed, not port ${port}`;
  }
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
