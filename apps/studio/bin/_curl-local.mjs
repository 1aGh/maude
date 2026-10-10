#!/usr/bin/env node
// _curl-local.mjs — loopback-only HTTP request, reached via
// `maude design curl-local` (DDR-062 dispatch; DDR-185, hardened per its
// security addendum's second round).
//
// WHY THIS EXISTS: an ACP chat session auto-approves `Bash(maude:*)` (DDR-184)
// but NOT a bare `curl` — every raw `curl` call still prompts, even one aimed
// at the user's own localhost dev server (a common ask mid design-workflow:
// "is my backend up on :3000?"). Claude Code's `Bash(prefix:*)` allowlist is a
// plain string-prefix match with no host awareness, so a prefix-list can't
// express "curl, but only to localhost" reliably. This verb does the real
// check instead. Covered for free by the EXISTING `Bash(maude:*)` allow-list
// rule — no widening of the session's Bash surface.
//
// SECURITY ADDENDUM, ROUND 2 — this file's FIRST hardening pass (an argv
// allowlist over raw curl flags: reject -K/--resolve/--connect-to/etc.,
// forward everything else to a real `curl` child) was itself bypassed, live,
// by the SAME class of gap it was written to close: curl supports
// CONCATENATED short-flag syntax (`-K<path>`, no space or `=`), which
// `validateArgv`'s `a.split('=')[0]` check never recognized — so `-K<path>`,
// `-x<url>`, `-T<path>` all sailed through unrejected, reproducing the
// EXACT original `-K`-config-smuggling bypass verbatim. A SEPARATE gap in
// the same pass: `--noproxy` (the flag this file forces to `*`) was never
// itself added to the reject list, so a caller-supplied `--noproxy ""`
// placed after the forced one silently re-enabled an ambient proxy
// (curl is last-flag-wins for repeated options).
//
// The lesson, stated plainly rather than patched around again: hand-parsing
// an EXTERNAL binary's own CLI grammar (short flags, concatenation,
// bundling, `=`-forms, config files, env-var equivalents) to decide what's
// "safe" is an unbounded surface — every fix closes the specific bypass
// found and leaves the next one for the next binary quirk nobody thought to
// test. So this file no longer accepts raw curl arguments AT ALL. It defines
// its OWN small, Maude-owned flag vocabulary (below) that this file fully
// parses itself (plain, unambiguous `--flag value` pairs — no short forms,
// no concatenation, no bundling, nothing to mis-parse), and constructs the
// real curl invocation from FIXED, hardcoded flag names with the caller's
// values riding as separate argv array elements (never string-interpolated,
// so a value containing e.g. "-K" or "; rm -rf" is inert data to curl, not a
// new flag token — spawnSync with an argv array bypasses the shell
// entirely). The caller can no longer name a curl flag, so there is nothing
// left to allowlist/rejectlist AGAINST — the bypass class this addendum is
// closing cannot recur here by construction, not by enumeration.
//
// SCOPE, named explicitly (not left implicit): this verb allows "any
// loopback address," not "only Maude's own dev-server port" — the user's
// explicit ask was checking THEIR OWN arbitrary local dev servers, not just
// Maude's, so narrowing to one port would defeat the feature. This means a
// call CAN reach another unauthenticated-by-convention loopback service
// (Docker's API proxy, `kubectl proxy`, Node's inspector protocol) if the
// ACP session is steered there — accepted, because enumerating every
// "trusted because it's local" service on every user's machine isn't
// tractable; recorded here and in DDR-185's addendum, not accepted
// implicitly.
//
// Reuses `_fetch-asset.mjs`'s battle-tested IPv4/IPv6 literal parsers
// (`parseIPv4`/`parseIPv6`) rather than reinventing address parsing, but with
// the OPPOSITE accept condition: fetch-asset's `classifyAddress` rejects
// loopback/private/link-local/etc. and allows everything else (it's fetching
// attacker-controlled URLs from the open web); curl-local requires STRICT
// loopback and rejects everything else, including ordinary private-LAN
// addresses (192.168.x.x etc.) — this verb is for "my own machine", not
// "anything reachable on my network".
//
// Exit: curl's own exit code on success · 2 usage/rejected argv · 3
//       non-loopback target (or DNS resolution failure) rejected · 1 other.

import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { parseIPv4, parseIPv6 } from './_fetch-asset.mjs';

/** True iff this parsed 4-byte IPv4 is in the loopback range 127.0.0.0/8. */
function isLoopbackIPv4(bytes) {
  return bytes[0] === 127;
}

/** True iff this parsed 16-byte IPv6 is ::1, or an IPv4-mapped/NAT64 loopback. */
function isLoopbackIPv6(bytes) {
  const allZeroThrough = (n) => bytes.slice(0, n).every((x) => x === 0);
  if (allZeroThrough(15) && bytes[15] === 1) return true; // ::1
  if (allZeroThrough(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isLoopbackIPv4(bytes.slice(12, 16)); // ::ffff:127.x.x.x
  }
  return false;
}

/** True iff this IP literal is strictly loopback — never any other private/reserved range. */
export function isLoopbackAddress(addr) {
  const kind = isIP(addr);
  if (kind === 4) {
    const bytes = parseIPv4(addr);
    return !!bytes && isLoopbackIPv4(bytes);
  }
  if (kind === 6) {
    const bytes = parseIPv6(addr);
    return !!bytes && isLoopbackIPv6(bytes);
  }
  return false;
}

export class CurlLocalError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Pure check over an already-resolved record set (the shape `dns.lookup(host,
 * {all:true})` returns): every record must be loopback, or this returns a
 * block-reason string naming the first offending address. A single
 * non-loopback record among several (multi-record DNS rebinding) fails the
 * whole host, not just that one record — split out from `resolveLoopbackIp`
 * so it's testable with a plain array literal, no DNS/module mocking needed.
 */
export function classifyRecords(host, records) {
  if (!records?.length) return `no DNS records for ${host}`;
  for (const { address } of records) {
    if (!isLoopbackAddress(address)) {
      return `${host} resolves to non-loopback ${address} — refusing`;
    }
  }
  return null;
}

/**
 * Resolve every DNS record for `host`, require ALL of them to be loopback,
 * and return the address to PIN the connection to (the first record) — the
 * caller must pass this to curl's own `--resolve` so the later, independent
 * connection can't re-resolve to something different (closes the
 * validate-then-reconnect DNS-rebinding TOCTOU, the same bug class as
 * CVE-2026-27826). `lookupFn` is injectable (defaults to the real
 * `node:dns/promises` `lookup`) purely so tests can supply a deterministic
 * multi-record response without mocking `node:dns`.
 */
export async function resolveLoopbackIp(host, { lookupFn = lookup } = {}) {
  if (isIP(host)) {
    if (!isLoopbackAddress(host)) {
      throw new CurlLocalError(3, `${host} is not a loopback address`);
    }
    return host;
  }
  let records;
  try {
    records = await lookupFn(host, { all: true, verbatim: true });
  } catch (err) {
    throw new CurlLocalError(3, `DNS resolution failed for ${host}: ${err?.code ?? err?.message}`);
  }
  const blockReason = classifyRecords(host, records);
  if (blockReason) throw new CurlLocalError(3, blockReason);
  return records[0].address;
}

// ── Maude-owned request vocabulary ──────────────────────────────────────────
// A small, fully-Maude-parsed flag set — deliberately NOT curl's own syntax.
// Every flag here takes its value from the NEXT argv element (no `=`-form, no
// short/concatenated form, nothing to mis-parse); `--insecure`/`--include`/
// `--verbose` are boolean. Anything not in this set is rejected outright —
// an allowlist of RECOGNIZED tokens, not a rejectlist of known-bad ones, so
// an unanticipated curl-style flag simply never has a matching case instead
// of silently riding through unexamined.
const METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VALUE_FLAGS = Object.freeze([
  '--method',
  '--header',
  '--data',
  '--user-agent',
  '--max-time',
  '--output',
]);
const BOOLEAN_FLAGS = Object.freeze(['--insecure', '--include', '--verbose']);

export class CurlLocalArgvError extends Error {}

/**
 * Parse this file's OWN small flag vocabulary (never curl's). Returns
 * `{url, method, headers, data, userAgent, maxTime, output, insecure,
 * include, verbose}` or throws CurlLocalArgvError with a human-readable
 * reason. `--header` may repeat. Exactly one positional (non-flag) argument
 * is accepted: the target URL.
 */
export function parseRequestArgv(argv) {
  const out = {
    url: null,
    method: 'GET',
    headers: [],
    data: null,
    userAgent: null,
    maxTime: null,
    output: null,
    insecure: false,
    include: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (BOOLEAN_FLAGS.includes(a)) {
      out[a.slice(2)] = true;
      continue;
    }
    if (VALUE_FLAGS.includes(a)) {
      const value = argv[i + 1];
      if (value === undefined) throw new CurlLocalArgvError(`${a} requires a value`);
      i += 1;
      if (a === '--method') {
        const m = value.toUpperCase();
        if (!METHODS.includes(m)) {
          throw new CurlLocalArgvError(
            `--method must be one of ${METHODS.join(', ')} (got "${value}")`
          );
        }
        out.method = m;
      } else if (a === '--header') {
        if (!/^[\w-]+:.*/.test(value)) {
          throw new CurlLocalArgvError(`--header must look like "Name: value" (got "${value}")`);
        }
        // A loopback helper never speaks for a browser: the headers a browser alone sends are
        // what the studio's privileged writes check (migrate apply — security review, Phase 1 gate).
        if (/^(origin|sec-fetch-[\w-]+|referer)\s*:/i.test(value)) {
          throw new CurlLocalArgvError(
            `--header ${value.split(':')[0]} is a browser header; refused`
          );
        }
        out.headers.push(value);
      } else if (a === '--data') {
        out.data = value;
      } else if (a === '--user-agent') {
        out.userAgent = value;
      } else if (a === '--max-time') {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0)
          throw new CurlLocalArgvError(`--max-time must be a positive number (got "${value}")`);
        out.maxTime = n;
      } else if (a === '--output') {
        out.output = value;
      }
      continue;
    }
    if (a.startsWith('-')) {
      throw new CurlLocalArgvError(
        `unrecognized flag "${a}" — curl-local has its OWN small flag set, not curl's; run with --help`
      );
    }
    if (out.url !== null)
      throw new CurlLocalArgvError(`unexpected extra argument "${a}" (URL already given)`);
    out.url = a;
  }
  if (!out.url) throw new CurlLocalArgvError('a target URL is required');
  let parsed;
  try {
    parsed = new URL(out.url);
  } catch {
    throw new CurlLocalArgvError(`"${out.url}" is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CurlLocalArgvError(
      `only http:// and https:// are supported (got ${parsed.protocol}//)`
    );
  }
  out.parsedUrl = parsed;
  return out;
}

/** Build the fixed-shape curl argv for a parsed request. Every user-supplied
 * value rides as its OWN argv array element (never concatenated into a
 * flag), and every flag NAME is one of this file's own hardcoded literals —
 * the caller never gets to name a curl flag. */
export function buildCurlArgs(req, pinIp, port) {
  const args = [
    '-q', // MUST be first — disables ~/.curlrc auto-load (config-file persistence)
    '-sS',
    '--proto',
    '=http,https',
    '--proto-redir',
    '=http,https',
    '--max-redirs',
    '0', // no redirects — the validated target's response can't hand off elsewhere
    '--noproxy',
    '*', // ignore *_PROXY env — no egress via a poisoned proxy; this file OWNS every flag, so nothing can override it back
    '--resolve',
    `${req.parsedUrl.hostname}:${port}:${pinIp}`, // pin — defeats the validate-then-reconnect DNS-rebinding TOCTOU
    '-X',
    req.method,
  ];
  for (const h of req.headers) args.push('-H', h);
  if (req.data !== null) args.push('--data-raw', req.data); // --data-raw (not -d/--data): never treats a leading "@" as a file path
  if (req.userAgent) args.push('-A', req.userAgent);
  if (req.maxTime) args.push('-m', String(req.maxTime));
  if (req.output) args.push('-o', req.output);
  if (req.insecure) args.push('-k');
  if (req.include) args.push('-i');
  if (req.verbose) args.push('-v');
  args.push('--', req.url);
  return args;
}

const HELP = `curl-local — loopback-only HTTP request (reached via \`maude design curl-local\`)

Usage:
  maude design curl-local <url> [--method GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS]
                          [--header "Name: value"]... [--data <body>]
                          [--user-agent <ua>] [--max-time <seconds>]
                          [--output <path>] [--insecure] [--include] [--verbose]

This is curl-local's OWN small flag vocabulary, not curl's — it does not
accept raw curl arguments (see the file's own header comment for why).
Resolves the URL's host and refuses to run at all unless EVERY resolved
address is loopback (127.0.0.0/8 or ::1); pins the connection to the
validated address.

Exit: curl's own exit code · 2 usage/rejected argv · 3 non-loopback target
      rejected · 1 other.`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    process.exit(argv.length === 0 ? 2 : 0);
  }
  let req;
  try {
    req = parseRequestArgv(argv);
  } catch (err) {
    process.stderr.write(`curl-local: ${err.message}\n`);
    process.exit(2);
  }
  let pinIp;
  try {
    pinIp = await resolveLoopbackIp(req.parsedUrl.hostname);
  } catch (err) {
    process.stderr.write(`curl-local: ${err.message}\n`);
    process.exit(err instanceof CurlLocalError ? err.code : 1);
  }
  const port = req.parsedUrl.port
    ? Number(req.parsedUrl.port)
    : req.parsedUrl.protocol === 'https:'
      ? 443
      : 80;
  const curlArgs = buildCurlArgs(req, pinIp, port);
  const result = spawnSync('curl', curlArgs, { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`curl-local: failed to run curl: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

// Run only when invoked directly (not when imported by the test). This shim
// runs under real `node` on a real on-disk path (never embedded in
// `bun --compile`), so the classic argv[1] guard is correct here — see the
// v0.38.0 self-heal memory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
