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

import { closeSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
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

const LAUNCH_RE = /maude-launch/i;
const LAUNCH_MSG =
  "a Maude opening link (maude-launch) is for the person's own browser, never this one";
const UNDECODABLE_MSG = 'the URL has an escape that does not decode';

/**
 * sec-loopback-bearer §7.5 (re-check B/C) — a one-time opening link opens a full studio session, so a
 * browser helper never takes one from its caller. Parsed as the server parses it (`URLSearchParams`
 * decodes leniently), every key and value is checked, case-insensitively; a query or fragment that does
 * not decode is refused rather than checked in its raw form.
 */
export function launchRefusal(u, raw) {
  const msg = LAUNCH_MSG;
  try {
    decodeURIComponent(u.search);
    decodeURIComponent(u.hash);
    decodeURIComponent(u.pathname);
  } catch {
    return UNDECODABLE_MSG;
  }
  if (LAUNCH_RE.test(raw) || LAUNCH_RE.test(decodeURIComponent(u.href))) return msg;
  for (const [k, v] of u.searchParams) if (LAUNCH_RE.test(k) || LAUNCH_RE.test(v)) return msg;
  return null;
}

/**
 * Why `raw` may not be opened by a browser helper, or null when it may. `allowLaunch` only for a link
 * the helper minted itself or took from the server's private folder (screenshot.sh), never one its
 * caller passed.
 */
export function urlRefusal(raw, env = process.env, opts = {}) {
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
  if (!opts.allowLaunch) return launchRefusal(u, raw);
  return null;
}

/** A log line never carries a one-time opening link or a frame capability (stderr reaches the AI). */
export function redactUrl(s) {
  return String(s).replace(/(maude-launch|fc)=[^&#\s"']*/gi, '$1=…');
}

/**
 * `<state>/maude/servers/links` — the server's private folder for a link it hands a capture helper
 * (shell/key-file.ts `serverLinkDir`; inside the key folder the AI chat's Read is denied).
 */
export function linkFileDir(env = process.env) {
  const s = env.XDG_STATE_HOME;
  const state = s && isAbsolute(s) ? s : join(env.HOME || homedir(), '.local', 'state');
  return join(state, 'maude', 'servers', 'links');
}

const LINK_NAME_RE = /^[0-9a-f]{32}\.url$/;

/**
 * sec-loopback-bearer §7.5 (re-check A) — take the link the server wrote for `screenshot --url-file`:
 * only `<linkFileDir>/<32 hex>.url`, a regular file of this user that nobody else may read, in a 0700
 * folder of this user. Anything else is refused WITHOUT being read or removed (the flag is reachable
 * from an auto-tier verb). → `{ url }` (the file is gone) or `{ error }`.
 */
export function takeLinkFile(path, env = process.env) {
  const refuse = (why) => ({ error: `--url-file takes only a link Maude wrote for it (${why})` });
  if (typeof path !== 'string' || !isAbsolute(path)) return refuse('not an absolute path');
  const dir = linkFileDir(env);
  if (resolve(path) !== path || dirname(path) !== dir || !LINK_NAME_RE.test(basename(path)))
    return refuse('not in its folder');
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  try {
    const d = lstatSync(dir);
    if (!d.isDirectory() || (uid !== null && d.uid !== uid) || (d.mode & 0o077) !== 0)
      return refuse('its folder is not private');
    const f = lstatSync(path);
    if (!f.isFile() || (uid !== null && f.uid !== uid) || (f.mode & 0o077) !== 0 || f.size > 4096)
      return refuse('not a private file');
    const url = readFileSync(path, 'utf8').split('\n')[0].trim();
    unlinkSync(path);
    return { url };
  } catch {
    return refuse('unreadable');
  }
}

/**
 * sec-loopback-bearer §7.4–7.5 (re-check A) — the perf probes' opening link, on a pipe perf.sh hands
 * them as fd 3–9 (`--launch-fd 3 3< <(studio_launch_url …)`): no file, so nothing to read or delete
 * anywhere else. The first line; '' when the fd is not open or not one of those.
 */
export function readLaunchFd(arg) {
  if (!/^[3-9]$/.test(String(arg))) return '';
  const fd = Number(arg);
  try {
    return readFileSync(fd, 'utf8').split('\n')[0].trim();
  } catch {
    return '';
  } finally {
    try {
      closeSync(fd);
    } catch {}
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--take-link-file') {
    const r = argv.length === 2 ? takeLinkFile(argv[1]) : { error: 'expected one path' };
    if (r.error) {
      process.stderr.write(`maude: ${r.error}.\n`);
      process.exit(2);
    }
    process.stdout.write(`${r.url}\n`);
    return;
  }
  const allowLaunch = argv[0] === '--launch-ok';
  const [url, ...extra] = allowLaunch ? argv.slice(1) : argv;
  const why = extra.length
    ? 'expected exactly one URL'
    : urlRefusal(url, process.env, { allowLaunch });
  if (why) {
    // a refused opening link is never echoed, not even redacted (an encoded name escapes the pattern)
    const shown =
      why === LAUNCH_MSG || why === UNDECODABLE_MSG
        ? 'that link'
        : JSON.stringify(redactUrl(url ?? ''));
    process.stderr.write(`maude: refusing to open ${shown}: ${why}.\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
