// DDR-185 — the loopback-only curl gate behind `maude design curl-local`
// (apps/studio/bin/_curl-local.mjs). This suite locks the SECURITY CORE: the
// strict-loopback address classifier (accepts ONLY 127.0.0.0/8 / ::1 / the
// IPv4-mapped form — unlike `_fetch-asset.mjs`'s `classifyAddress`, an
// ordinary private-LAN address like 192.168.1.1 is REJECTED here, not
// allowed), the every-record DNS check (closes the multi-A-record rebinding
// gap), and — round 2 of the security addendum — the Maude-owned request
// parser (`parseRequestArgv`) that REPLACED the raw-curl-argv allowlist a
// live security fan-out found still bypassable via curl's own concatenated
// short-flag syntax (`-K<path>`, `-x<url>`, `-T<path>` all slipped past the
// `a.split('=')[0]` check) and a missing `--noproxy` reject entry. This file
// no longer recognizes ANY curl flag at all — only its own small vocabulary
// — so there is no curl-syntax bypass class left to enumerate against.

import { describe, expect, test } from 'bun:test';
import {
  buildCurlArgs,
  CurlLocalArgvError,
  CurlLocalError,
  classifyRecords,
  isLoopbackAddress,
  parseRequestArgv,
  resolveLoopbackIp,
} from './_curl-local.mjs';

describe('isLoopbackAddress', () => {
  test('accepts IPv4 loopback (127.0.0.0/8, not just 127.0.0.1)', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.9.9.9')).toBe(true);
    expect(isLoopbackAddress('127.255.255.255')).toBe(true);
  });

  test('accepts IPv6 ::1 and the IPv4-mapped loopback form', () => {
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });

  test("rejects ordinary private-LAN addresses — this is STRICTER than fetch-asset's classifier", () => {
    // fetch-asset's classifyAddress blocks these too (as "not a safe egress
    // target"), but for a different reason (SSRF from an external URL). Here
    // the bar is "is this literally my own machine" — a private-LAN IP is a
    // real, different host, not loopback, and must still prompt.
    expect(isLoopbackAddress('192.168.1.1')).toBe(false);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
    expect(isLoopbackAddress('172.16.0.1')).toBe(false);
    expect(isLoopbackAddress('169.254.169.254')).toBe(false); // cloud IMDS
  });

  test('rejects public addresses and link-local/multicast/reserved ranges', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '224.0.0.1', '240.0.0.1', 'fe80::1']) {
      expect(isLoopbackAddress(ip)).toBe(false);
    }
  });

  test('rejects a non-IP string', () => {
    expect(isLoopbackAddress('not-an-ip')).toBe(false);
    expect(isLoopbackAddress('localhost')).toBe(false); // a hostname, not a literal — resolved separately
  });
});

describe('classifyRecords — the every-record check (multi-A-record DNS rebinding)', () => {
  test('all-loopback records pass', () => {
    expect(
      classifyRecords('localhost', [{ address: '127.0.0.1' }, { address: '127.0.0.2' }])
    ).toBeNull();
  });

  test('a single non-loopback record among several loopback ones still fails the whole host', () => {
    const reason = classifyRecords('rebind.example', [
      { address: '127.0.0.1' },
      { address: '93.184.216.34' },
    ]);
    expect(reason).toContain('93.184.216.34');
    expect(reason).toContain('non-loopback');
  });

  test('empty record set fails', () => {
    expect(classifyRecords('empty.example', [])).toContain('no DNS records');
  });
});

describe('resolveLoopbackIp', () => {
  test('an IP-literal host skips DNS entirely — loopback passes, returns itself', async () => {
    await expect(resolveLoopbackIp('127.0.0.1')).resolves.toBe('127.0.0.1');
  });

  test('an IP-literal host that is not loopback throws CurlLocalError(3)', async () => {
    await expect(resolveLoopbackIp('8.8.8.8')).rejects.toThrow(CurlLocalError);
    try {
      await resolveLoopbackIp('8.8.8.8');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe(3);
    }
  });

  test('a hostname resolving to all-loopback records (injected lookup) passes, returns the pin IP', async () => {
    const lookupFn = async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ];
    await expect(resolveLoopbackIp('localhost', { lookupFn })).resolves.toBe('127.0.0.1');
  });

  test('a hostname with ONE non-loopback record among several is rejected (DNS-rebinding defense)', async () => {
    const lookupFn = async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '203.0.113.5', family: 4 }, // TEST-NET-3 — a real "other" address
    ];
    await expect(resolveLoopbackIp('rebind.example', { lookupFn })).rejects.toThrow(CurlLocalError);
  });

  test('DNS resolution failure is a rejection, not a silent pass', async () => {
    const lookupFn = async () => {
      const err = new Error('getaddrinfo ENOTFOUND nope.invalid');
      err.code = 'ENOTFOUND';
      throw err;
    };
    await expect(resolveLoopbackIp('nope.invalid', { lookupFn })).rejects.toThrow(CurlLocalError);
  });
});

describe('parseRequestArgv — the Maude-owned flag vocabulary (never raw curl syntax)', () => {
  test('a bare URL parses as a GET with no headers/body', () => {
    const req = parseRequestArgv(['http://localhost:3000/api']);
    expect(req.url).toBe('http://localhost:3000/api');
    expect(req.method).toBe('GET');
    expect(req.headers).toEqual([]);
    expect(req.data).toBeNull();
  });

  test('--method, repeated --header, and --data all parse', () => {
    const req = parseRequestArgv([
      'http://localhost:3000/api',
      '--method',
      'post',
      '--header',
      'Content-Type: application/json',
      '--header',
      'X-Test: 1',
      '--data',
      '{"a":1}',
    ]);
    expect(req.method).toBe('POST'); // uppercased
    expect(req.headers).toEqual(['Content-Type: application/json', 'X-Test: 1']);
    expect(req.data).toBe('{"a":1}');
  });

  test('boolean flags (--insecure/--include/--verbose) parse with no value consumed', () => {
    const req = parseRequestArgv([
      'http://localhost:3000/',
      '--insecure',
      '--include',
      '--verbose',
    ]);
    expect(req.insecure).toBe(true);
    expect(req.include).toBe(true);
    expect(req.verbose).toBe(true);
  });

  test('rejects an unrecognized method', () => {
    expect(() => parseRequestArgv(['http://localhost:3000/', '--method', 'TRACE'])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects a malformed header (must look like "Name: value")', () => {
    expect(() => parseRequestArgv(['http://localhost:3000/', '--header', 'not-a-header'])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects a non-positive --max-time', () => {
    expect(() => parseRequestArgv(['http://localhost:3000/', '--max-time', '0'])).toThrow(
      CurlLocalArgvError
    );
    expect(() => parseRequestArgv(['http://localhost:3000/', '--max-time', 'nope'])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects a non-http(s) URL scheme', () => {
    expect(() => parseRequestArgv(['file:///etc/passwd'])).toThrow(CurlLocalArgvError);
  });

  test('rejects a value-taking flag with no value', () => {
    expect(() => parseRequestArgv(['http://localhost:3000/', '--header'])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects more than one positional argument', () => {
    expect(() => parseRequestArgv(['http://localhost:3000/', 'http://localhost:4000/'])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects when no URL is given at all', () => {
    expect(() => parseRequestArgv(['--method', 'GET'])).toThrow(CurlLocalArgvError);
  });

  // ── Round-2 security addendum: these are exactly the argv forms that
  // bypassed the PREVIOUS raw-curl-argv allowlist. None of them are
  // "rejected flags" here — they're simply not part of this file's flag
  // vocabulary at all, so they fall through to the generic
  // "unrecognized flag" / "unexpected extra argument" path.
  test('rejects the concatenated -K<path> config-file-smuggling PoC verbatim (round-2 finding #1)', () => {
    expect(() => parseRequestArgv(['http://127.0.0.1:1/', '-Kevil.conf'])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects a caller-supplied --noproxy override verbatim (round-2 finding #2)', () => {
    expect(() => parseRequestArgv(['http://127.0.0.1:1/', '--noproxy', ''])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects the concatenated -x<url>/-T<path> short forms (round-2 finding #3)', () => {
    expect(() => parseRequestArgv(['-xhttp://evil.example', 'http://127.0.0.1:1/'])).toThrow(
      CurlLocalArgvError
    );
    expect(() => parseRequestArgv(['http://127.0.0.1:1/', '-T/etc/passwd'])).toThrow(
      CurlLocalArgvError
    );
  });

  test('rejects the original --resolve/--connect-to target-override PoC verbatim', () => {
    expect(() =>
      parseRequestArgv(['--resolve', 'localhost:80:203.0.113.5', 'http://localhost/'])
    ).toThrow(CurlLocalArgvError);
  });

  test('a value containing curl-flag-shaped text is inert data, not a flag — no injection via --data', () => {
    // "@/etc/passwd" as a --data value must never be treated as curl's
    // "read a file" shorthand (that's -d/--data's behavior, not
    // --data-raw's, which buildCurlArgs always uses — see the live
    // end-to-end test below for the full round-trip proof).
    const req = parseRequestArgv([
      'http://localhost:3000/',
      '--data',
      '@/etc/passwd; -K evil.conf',
    ]);
    expect(req.data).toBe('@/etc/passwd; -K evil.conf');
  });
});

describe("buildCurlArgs — every flag name is one of THIS file's own hardcoded literals", () => {
  test('a bare GET pins the connection and forces the safety flags', () => {
    const req = parseRequestArgv(['http://localhost:3000/']);
    const args = buildCurlArgs(req, '127.0.0.1', 3000);
    expect(args).toContain('--resolve');
    expect(args[args.indexOf('--resolve') + 1]).toBe('localhost:3000:127.0.0.1');
    expect(args).toContain('--noproxy');
    expect(args).toContain('-q'); // curlrc disabled
    expect(args).toEqual(expect.arrayContaining(['--max-redirs', '0']));
    expect(args.at(-1)).toBe('http://localhost:3000/'); // the URL, always last, after `--`
    expect(args.at(-2)).toBe('--');
  });

  // V2-3.10 low (a): curl gets the SAME parsed URL whose host and port were checked. A raw
  // string the two parsers read differently (WHATWG: `\` is a path separator; curl: part of a
  // userinfo) must not reach curl, or it could connect to a port nobody checked.
  test('curl receives the parsed URL whose port was checked, never the raw string', () => {
    const raw = 'http://localhost:3000\\@127.0.0.1:4567/x';
    const req = parseRequestArgv([raw]);
    expect(req.parsedUrl.port).toBe('3000');
    const args = buildCurlArgs(req, '127.0.0.1', 3000);
    expect(args.at(-1)).toBe(req.parsedUrl.href);
    expect(args).not.toContain(raw);
    expect(new URL(args.at(-1)).port).toBe('3000');
  });

  test('POST + headers + data map to -X/-H/--data-raw (never -d, which treats a leading @ as a file path)', () => {
    const req = parseRequestArgv([
      'http://localhost:3000/api',
      '--method',
      'POST',
      '--header',
      'Content-Type: application/json',
      '--data',
      '@/etc/passwd',
    ]);
    const args = buildCurlArgs(req, '127.0.0.1', 3000);
    expect(args).toContain('-X');
    expect(args[args.indexOf('-X') + 1]).toBe('POST');
    expect(args).toContain('-H');
    expect(args[args.indexOf('-H') + 1]).toBe('Content-Type: application/json');
    expect(args).toContain('--data-raw');
    expect(args).not.toContain('-d');
    expect(args[args.indexOf('--data-raw') + 1]).toBe('@/etc/passwd');
  });
});
