/**
 * @file       link-import.ts — bring a picture, a clip or a sound in from a link (p8-import-link, F16 · F)
 * @scope      apps/studio/link-import.ts
 * @purpose    The one place the studio fetches a URL a person typed and lands the bytes in Assets.
 *             Michal's ruling 2026-10-29 (second triage round, item 2): https only, public addresses
 *             only (checked after DNS and after every redirect), size and time limits, the type taken
 *             from the bytes. The route is `POST /_api/import-link` (routes/import-link.ts).
 *
 * A URL from a person is attacker-shaped input on a privileged machine: the studio runs on the
 * person's Mac, next to its router, its other services and (in a cloud) a metadata endpoint. So:
 *
 *   1. The URL — `checkLinkUrl`: https only; no user:password@; port 443 only. Another port has no
 *      strong reason for a public picture and is the usual way to reach an admin service or to scan
 *      a network, so it is refused, not allowed-with-a-check.
 *   2. The address — `linkAddressRefusal`: every address the host resolves to must be public. The
 *      `_fetch-asset.mjs` classifier (loopback, RFC 1918, CGNAT 100.64/10, link-local incl.
 *      169.254.169.254, multicast, unspecified, ULA fc00::/7, IPv4-mapped and NAT64 embeds) plus a
 *      stricter rule for IPv6: outside 64:ff9b::/96 (classified by its embedded IPv4) only global
 *      unicast 2000::/3 is allowed, minus the IETF special blocks (2001::/23 incl. Teredo,
 *      2001:db8::/32, 2002::/16 6to4). One refused address refuses the host (a mixed public/private
 *      answer is a rebinding shape).
 *   3. The connection — the request goes to the CHECKED address, never the name again: the URL
 *      handed to Bun's `fetch` is the IP literal, `Host` carries the name and TLS verifies the
 *      certificate against the name (`tls.serverName`, which is also the SNI). There is no second
 *      DNS lookup between the check and the connect, so DNS rebinding cannot swap the target.
 *   4. Redirects — `redirect: 'manual'`; every hop goes through 1–3 again, at most `maxHops`.
 *   5. Limits — one deadline for the whole import (DNS, every hop, the body), a wait-for-answer
 *      timeout per hop, an idle timeout between body chunks, and a byte cap counted while the body
 *      streams (Content-Length only trims an honest oversize early; it is never trusted).
 *   6. The type — from the bytes (`sniffAssetType`: png/jpg/gif/webp, mp4/mov/m4v/webm, mp3/m4a/wav),
 *      never the extension or Content-Type. SVG is REFUSED here: it is active content, and the
 *      sanitizer lane (`importSvg`, DDR-167) is for a file the person holds — from a link the line
 *      says to save it and use Add files…, which cleans it. HTML renamed .png is refused the same way.
 *   7. The write — `api.saveAssetFromStream` (the Assets writer every other import uses: sniff again,
 *      per-kind cap, session budget, content-addressed `assets/<sha8>.<ext>`, containment).
 *
 * Error answers carry a `reason` word and no remote-controlled text (no body, header or status
 * text reaches a message — DDR-216 D10); the person's words live in client/v2/assets/import-lines.js.
 */

import { isIP } from 'node:net';
import { assetCapForCategory, type SaveAssetResult, sniffAssetType } from './api.ts';
import { classifyAddress, parseIPv4, parseIPv6 } from './bin/_fetch-asset.mjs';

/** Why a link was not brought in — the route's `reason`, the client's words key. */
export type LinkReason =
  | 'link-bad' // not a URL at all
  | 'link-not-https' // http:, ftp:, data:, file:, …
  | 'link-refused' // credentials in the URL, a port other than 443
  | 'link-private' // the host is (or resolves to) a loopback / private / link-local / … address
  | 'link-unreachable' // no DNS answer, no connection, a TLS failure
  | 'link-http' // the site answered, but not with the file (404, 500, …)
  | 'link-redirects' // more redirects than the cap, or one without a target
  | 'link-not-media' // the bytes are not a picture, clip or sound (HTML renamed .png)
  | 'link-svg' // an SVG — active content, refused from a link
  | 'too-large'
  | 'timeout'
  | 'link-failed'; // the Assets writer refused for another reason (budget, disk)

export class LinkRefusal extends Error {
  constructor(
    readonly reason: LinkReason,
    message: string
  ) {
    super(message);
  }
}

export interface LinkLimits {
  /** Redirects followed, each re-checked. */
  maxHops: number;
  /** One deadline for the whole import: DNS, every hop and the body. */
  totalMs: number;
  /** Per hop: from the connect to the answer's status line. */
  answerMs: number;
  /** Between two body chunks. */
  idleMs: number;
  /** The ceiling read at all; the kind's Assets cap applies below it. */
  maxBytes: number;
}

export const LINK_LIMITS: Readonly<LinkLimits> = Object.freeze({
  maxHops: 5,
  totalMs: 120_000,
  answerMs: 15_000,
  idleMs: 20_000,
  maxBytes: assetCapForCategory('video'),
});

/** A URL that passed `checkLinkUrl`. `host` is bare (no IPv6 brackets). */
export interface CheckedLink {
  url: URL;
  host: string;
}

/** The URL gate (step 1). Throws `LinkRefusal`. Drops the fragment. */
export function checkLinkUrl(raw: unknown): CheckedLink {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048)
    throw new LinkRefusal('link-bad', 'not a link');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new LinkRefusal('link-bad', 'not a link');
  }
  if (u.protocol !== 'https:') throw new LinkRefusal('link-not-https', 'only https links');
  if (u.username || u.password)
    throw new LinkRefusal('link-refused', 'a link with a name and password in it');
  // WHATWG URL drops the default port, so any `port` here is not 443
  if (u.port && u.port !== '443') throw new LinkRefusal('link-refused', 'a port other than 443');
  const host = u.hostname.replace(/^\[(.*)\]$/, '$1');
  if (!host) throw new LinkRefusal('link-bad', 'a link without a site');
  u.hash = '';
  return { url: u, host };
}

const v4Extra = (b: Uint8Array): string | null => {
  const [a, c, d] = [b[0], b[1], b[2]];
  if (a === 192 && c === 88 && d === 99) return 'ipv4 192.88.99.0/24 (6to4 relay)';
  if (a === 198 && c === 51 && d === 100) return 'ipv4 198.51.100.0/24 (TEST-NET-2)';
  if (a === 203 && c === 0 && d === 113) return 'ipv4 203.0.113.0/24 (TEST-NET-3)';
  return null;
};

const v6Extra = (b: Uint8Array): string | null => {
  // 64:ff9b::/96 (NAT64, well known) — classifyAddress already judged its embedded IPv4
  const nat64 =
    b[0] === 0x00 &&
    b[1] === 0x64 &&
    b[2] === 0xff &&
    b[3] === 0x9b &&
    b.slice(4, 12).every((x) => x === 0);
  if (nat64) return null;
  if (((b[0] ?? 0) & 0xe0) !== 0x20) return 'ipv6 outside 2000::/3 (not global unicast)';
  if (b[0] === 0x20 && b[1] === 0x01 && ((b[2] ?? 0) & 0xfe) === 0x00)
    return 'ipv6 2001::/23 (IETF special purpose, incl. Teredo)';
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8)
    return 'ipv6 2001:db8::/32 (documentation)';
  if (b[0] === 0x20 && b[1] === 0x02) return 'ipv6 2002::/16 (6to4)';
  return null;
};

/**
 * Step 2: why this address may not be fetched, or null when it is public. Fail closed — anything
 * that is not a parseable IP is refused.
 */
export function linkAddressRefusal(address: string): string | null {
  const bare = String(address).replace(/^\[(.*)\]$/, '$1');
  const base = classifyAddress(bare) as string | null;
  if (base) return base;
  const kind = isIP(bare);
  if (kind === 4) {
    const b = parseIPv4(bare) as Uint8Array | null;
    return b ? v4Extra(b) : 'unparseable ipv4';
  }
  if (kind === 6) {
    const b = parseIPv6(bare) as Uint8Array | null;
    return b ? v6Extra(b) : 'unparseable ipv6';
  }
  return 'not an ip address';
}

export type LinkLookup = (host: string) => Promise<Array<{ address: string }>>;

/** Bun's resolver (the system's getaddrinfo, /etc/hosts included). */
export const bunLookup: LinkLookup = async (host) =>
  (await Bun.dns.lookup(host, {})).map((r) => ({ address: r.address }));

/** Step 2 for a host: the ONE address the request will go to. Throws `LinkRefusal`. */
export async function resolveLinkHost(host: string, lookup: LinkLookup): Promise<string> {
  if (isIP(host)) {
    if (linkAddressRefusal(host)) throw new LinkRefusal('link-private', 'a private address');
    return host;
  }
  let records: Array<{ address: string }>;
  try {
    records = await lookup(host);
  } catch {
    throw new LinkRefusal('link-unreachable', 'the site has no address');
  }
  if (!records?.length) throw new LinkRefusal('link-unreachable', 'the site has no address');
  for (const r of records) {
    if (linkAddressRefusal(r.address)) throw new LinkRefusal('link-private', 'a private address');
  }
  return records[0]?.address as string;
}

/** One hop on the wire: what the transport needs, and what it answers. */
export interface LinkHop {
  url: URL;
  /** The checked address — the only place the transport may connect to. */
  ip: string;
  signal: AbortSignal;
}
export interface LinkAnswer {
  status: number;
  location: string | null;
  contentLength: number | null;
  body: ReadableStream<Uint8Array> | null;
}
export type LinkTransport = (hop: LinkHop) => Promise<LinkAnswer>;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Maude';

/**
 * Step 3: Bun `fetch` pinned to the checked address. The request URL is the IP literal; `Host` and
 * the TLS server name (SNI + certificate check) are the link's host. No redirect is followed here.
 * `ca` is for the tests' local HTTPS server only — the studio never passes it.
 */
export function bunTransport(opts: { ca?: string } = {}): LinkTransport {
  return async ({ url, ip, signal }) => {
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const pinned = isIP(ip) === 6 ? `[${ip}]` : ip;
    const port = url.port ? `:${url.port}` : '';
    const res = await fetch(`https://${pinned}${port}${url.pathname}${url.search}`, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        Host: url.host,
        Accept: 'image/*, video/*, audio/*;q=0.9, */*;q=0.1',
        'Accept-Encoding': 'identity',
        'User-Agent': UA,
      },
      tls: {
        ...(isIP(host) ? {} : { serverName: host }),
        ...(opts.ca ? { ca: opts.ca } : {}),
      },
    } as RequestInit);
    const len = Number(res.headers.get('content-length'));
    return {
      status: res.status,
      location: res.headers.get('location'),
      contentLength:
        Number.isFinite(len) && len >= 0 && res.headers.has('content-length') ? len : null,
      body: res.body as ReadableStream<Uint8Array> | null,
    };
  };
}

export const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface LinkImportDeps {
  saveAsset: (stream: ReadableStream<Uint8Array>) => Promise<SaveAssetResult>;
  lookup?: LinkLookup;
  transport?: LinkTransport;
  limits?: Partial<LinkLimits>;
}

export type LinkImportResult =
  | { ok: true; path: string; kind: string; category: string; name: string; host: string }
  | { ok: false; reason: LinkReason; error: string; host?: string };

// biome-ignore lint/suspicious/noControlCharactersInRegex: dropping control characters (and slashes) is the point
const NAME_DROP = /[\u0000-\u001f\u007f\\/]/g;

/** A display name from the final URL: its last path segment, printable, ≤ 200 characters, else the host. */
export function linkDisplayName(url: URL): string {
  let last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    /* keep it as it came */
  }
  last = last.replace(NAME_DROP, '').trim().slice(0, 200);
  return last && last !== '.' && last !== '..' ? last : url.hostname.slice(0, 200);
}

const looksLikeSvg = (head: Uint8Array) => {
  const s = Buffer.from(head.subarray(0, 1024)).toString('utf8').trimStart().toLowerCase();
  return s.startsWith('<svg') || (s.startsWith('<?xml') && s.includes('<svg'));
};

const SNIFF_BYTES = 16;

/**
 * Fetch `rawUrl` under every gate above and land it in Assets. Never throws: a refusal is
 * `{ ok: false, reason }`.
 */
export async function importFromLink(
  rawUrl: unknown,
  deps: LinkImportDeps
): Promise<LinkImportResult> {
  const limits: LinkLimits = { ...LINK_LIMITS, ...(deps.limits ?? {}) };
  const lookup = deps.lookup ?? bunLookup;
  const transport = deps.transport ?? bunTransport();
  const whole = new AbortController();
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    whole.abort();
  };
  const totalTimer = setTimeout(expire, limits.totalMs);
  /** A promise raced against the whole-import deadline (a DNS lookup has no signal of its own). */
  const inTime = <T>(p: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (whole.signal.aborted) return reject(new LinkRefusal('timeout', 'took too long'));
      const onAbort = () => reject(new LinkRefusal('timeout', 'took too long'));
      whole.signal.addEventListener('abort', onAbort, { once: true });
      p.then(resolve, reject).finally(() => whole.signal.removeEventListener('abort', onAbort));
    });
  let host: string | undefined;
  try {
    let current = checkLinkUrl(rawUrl);
    // the line names the link the person pasted, never a redirect target the site chose
    const asked = current;
    for (let hop = 0; ; hop += 1) {
      host = current.host;
      const ip = await inTime(resolveLinkHost(current.host, lookup));
      // the answer must start within `answerMs`; the whole import ends at the deadline either way
      const hopCtl = new AbortController();
      const stopHop = () => hopCtl.abort();
      whole.signal.addEventListener('abort', stopHop, { once: true });
      const answerTimer = setTimeout(() => {
        timedOut = true;
        hopCtl.abort();
      }, limits.answerMs);
      let res: LinkAnswer;
      try {
        res = await inTime(transport({ url: current.url, ip, signal: hopCtl.signal }));
      } catch (e) {
        if (timedOut || e instanceof LinkRefusal)
          throw timedOut ? new LinkRefusal('timeout', 'took too long') : e;
        throw new LinkRefusal('link-unreachable', 'the site did not answer');
      } finally {
        clearTimeout(answerTimer);
      }
      if (REDIRECTS.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        if (hop >= limits.maxHops || !res.location)
          throw new LinkRefusal('link-redirects', 'too many redirects');
        let next: string;
        try {
          next = new URL(res.location, current.url).href;
        } catch {
          throw new LinkRefusal('link-redirects', 'a redirect to nowhere');
        }
        // EVERY hop: the whole URL gate and the address gate again
        current = checkLinkUrl(next);
        continue;
      }
      if (res.status !== 200 || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        throw new LinkRefusal('link-http', `the site answered ${Number(res.status) || 0}`);
      }
      if (res.contentLength !== null && res.contentLength > limits.maxBytes) {
        await res.body.cancel().catch(() => undefined);
        throw new LinkRefusal('too-large', 'past the size cap');
      }
      return await land(
        res.body,
        res.contentLength,
        asked,
        limits,
        deps,
        () => timedOut,
        expire,
        whole.signal
      );
    }
  } catch (e) {
    if (e instanceof LinkRefusal)
      return { ok: false, reason: e.reason, error: e.message, ...(host ? { host } : {}) };
    if (timedOut)
      return { ok: false, reason: 'timeout', error: 'took too long', ...(host ? { host } : {}) };
    return {
      ok: false,
      reason: 'link-unreachable',
      error: 'the site did not answer',
      ...(host ? { host } : {}),
    };
  } finally {
    clearTimeout(totalTimer);
    whole.abort();
  }
}

/** Read with an idle timeout: a chunk, or the end, within `idleMs`. */
async function readIdle(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
  onIdle: () => void,
  deadline: AbortSignal
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
  let t: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    // a slow drip under the idle timeout still ends at the whole-import deadline
    if (deadline.aborted) throw new LinkRefusal('timeout', 'took too long');
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        t = setTimeout(() => {
          onIdle();
          reject(new LinkRefusal('timeout', 'the site stopped sending'));
        }, idleMs);
        onAbort = () => reject(new LinkRefusal('timeout', 'took too long'));
        deadline.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(t);
    if (onAbort) deadline.removeEventListener('abort', onAbort);
  }
}

async function land(
  body: ReadableStream<Uint8Array>,
  declared: number | null,
  link: CheckedLink,
  limits: LinkLimits,
  deps: LinkImportDeps,
  isTimedOut: () => boolean,
  expire: () => void,
  deadline: AbortSignal
): Promise<LinkImportResult> {
  const reader = body.getReader();
  const cancel = () => reader.cancel().catch(() => undefined);
  // the head first: the kind decides the cap, and a refused kind writes nothing
  const head: Uint8Array[] = [];
  let headLen = 0;
  let ended = false;
  while (headLen < SNIFF_BYTES) {
    const { done, value } = await readIdle(reader, limits.idleMs, expire, deadline);
    if (done) {
      ended = true;
      break;
    }
    if (value?.length) {
      head.push(value);
      headLen += value.length;
      if (headLen > limits.maxBytes) {
        await cancel();
        throw new LinkRefusal('too-large', 'past the size cap');
      }
    }
  }
  const headBytes = Buffer.concat(head);
  if (!headBytes.length) throw new LinkRefusal('link-http', 'an empty answer');
  const info = sniffAssetType(headBytes);
  if (!info) {
    await cancel();
    throw new LinkRefusal(
      looksLikeSvg(headBytes) ? 'link-svg' : 'link-not-media',
      'not a picture, clip or sound'
    );
  }
  const cap = Math.min(assetCapForCategory(info.category), limits.maxBytes);
  if ((declared !== null && declared > cap) || headLen > cap) {
    await cancel();
    throw new LinkRefusal('too-large', 'past the size cap');
  }
  let total = headLen;
  let overrun = false;
  let stalled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(headBytes);
      if (ended) c.close();
    },
    async pull(c) {
      try {
        const { done, value } = await readIdle(reader, limits.idleMs, expire, deadline);
        if (done) return c.close();
        if (!value?.length) return;
        total += value.length;
        // the cap is counted on what arrives, never on what the site declared
        if (total > cap) {
          overrun = true;
          await cancel();
          return c.error(new Error('past the size cap'));
        }
        c.enqueue(value);
      } catch (e) {
        stalled = true;
        await cancel();
        c.error(e);
      }
    },
    cancel() {
      return cancel();
    },
  });
  const saved = await deps.saveAsset(stream);
  if (overrun) throw new LinkRefusal('too-large', 'past the size cap');
  if (stalled || isTimedOut()) throw new LinkRefusal('timeout', 'took too long');
  if (!saved.ok || !saved.path) {
    if (saved.status === 413) throw new LinkRefusal('too-large', 'past the size cap');
    if (saved.status === 415)
      throw new LinkRefusal('link-not-media', 'not a picture, clip or sound');
    throw new LinkRefusal('link-failed', 'Assets did not take it');
  }
  return {
    ok: true,
    path: saved.path,
    kind: info.ext,
    category: info.category,
    name: linkDisplayName(link.url),
    host: link.host,
  };
}
