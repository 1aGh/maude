// p8-import-link — POST /_api/import-link (routes/import-link.ts → link-import.ts): a picture, clip or sound from a
// link lands in Assets only through every gate — https only, public addresses only (after DNS and after every
// redirect), the connection pinned to the address that was checked, a byte cap counted while streaming, one deadline
// plus idle timeouts, and the type from the bytes. NEVER the real internet: an injected resolver + transport, and one
// local HTTPS server (self-signed, 127.0.0.1) for the real Bun transport's pinning.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrotliCompress, createGzip, constants as zc } from 'node:zlib';

import { resolveAccess } from '../access/scope.ts';
import { sniffAssetType } from '../api.ts';
import {
  bunTransport,
  checkLinkUrl,
  importFromLink,
  type LinkAnswer,
  type LinkHop,
  type LinkLookup,
  type LinkTransport,
  linkAddressRefusal,
  linkTypeOf,
} from '../link-import.ts';
import { createImportLinkRoutes } from '../routes/import-link.ts';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const HTML = Buffer.from('<!doctype html><html><body>not a picture</body></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PUBLIC = '93.184.216.34';

/** The Assets writer stand-in: sniffs like the real one, keeps the bytes it was handed. */
function fakeSaver() {
  const saved: Buffer[] = [];
  return {
    saved,
    saveAsset: async (stream: ReadableStream<Uint8Array>) => {
      const parts: Uint8Array[] = [];
      try {
        for await (const c of stream as unknown as AsyncIterable<Uint8Array>) parts.push(c);
      } catch (e) {
        return { ok: false, status: 500, error: (e as Error).message };
      }
      const b = Buffer.concat(parts);
      const info = sniffAssetType(b);
      if (!info) return { ok: false, status: 415, error: 'unsupported' };
      saved.push(b);
      return { ok: true, path: `assets/0000abcd.${info.ext}` };
    },
  };
}

const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });

const ok = (body: Uint8Array, extra: Partial<LinkAnswer> = {}): LinkAnswer => ({
  status: 200,
  location: null,
  contentLength: null,
  body: streamOf(body),
  ...extra,
});

/** A resolver from a table; records every lookup. */
function table(map: Record<string, string[] | (() => string[])>) {
  const asked: string[] = [];
  const lookup: LinkLookup = async (h) => {
    asked.push(h);
    const v = map[h];
    if (!v) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return (typeof v === 'function' ? v() : v).map((address) => ({ address }));
  };
  return { lookup, asked };
}

/** A transport that records where it connected; answers per host. */
function wire(answer: (hop: LinkHop) => LinkAnswer | Promise<LinkAnswer>) {
  const hops: Array<{ host: string; ip: string; path: string }> = [];
  const transport: LinkTransport = async (hop) => {
    hops.push({ host: hop.url.hostname, ip: hop.ip, path: hop.url.pathname });
    return answer(hop);
  };
  return { transport, hops };
}

describe('the URL and address gates (no request is made)', () => {
  test('http:, other schemes, credentials and a non-443 port are refused before any lookup', async () => {
    const { lookup, asked } = table({ 'media.example': [PUBLIC] });
    const { transport, hops } = wire(() => ok(PNG));
    const s = fakeSaver();
    for (const [url, reason] of [
      ['http://media.example/a.png', 'link-not-https'],
      ['ftp://media.example/a.png', 'link-not-https'],
      ['file:///etc/passwd', 'link-not-https'],
      ['data:image/png;base64,iVBORw0KGgo=', 'link-not-https'],
      ['https://user:pw@media.example/a.png', 'link-refused'],
      ['https://media.example:8443/a.png', 'link-refused'],
      ['not a link', 'link-bad'],
    ] as const) {
      const r = await importFromLink(url, { saveAsset: s.saveAsset, lookup, transport });
      expect({ url, r: r.ok ? 'ok' : r.reason }).toEqual({ url, r: reason });
    }
    expect(asked).toEqual([]);
    expect(hops).toEqual([]);
    expect(s.saved).toEqual([]);
    // the explicit default port is the same link
    expect(checkLinkUrl('https://media.example:443/a.png').url.port).toBe('');
  });

  test('loopback, 10/8, 169.254.169.254, [::1] and [::ffff:127.0.0.1] are refused — as literals and via DNS', async () => {
    const s = fakeSaver();
    const { transport, hops } = wire(() => ok(PNG));
    const literals = [
      'https://127.0.0.1/a.png',
      'https://localhost/a.png',
      'https://10.1.2.3/a.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/a.png',
      'https://[::ffff:127.0.0.1]/a.png',
      'https://2130706433/a.png', // 127.0.0.1 as one number
      'https://[fd00:ec2::254]/', // the IPv6 metadata address (ULA)
      'https://100.64.0.1/a.png',
      'https://192.168.1.1/a.png',
    ];
    const { lookup } = table({
      localhost: ['127.0.0.1', '::1'],
      'intranet.example': ['10.0.0.5'],
      'imds.example': ['169.254.169.254'],
      'v6.example': ['::1'],
      'mapped.example': ['::ffff:127.0.0.1'],
      'mixed.example': [PUBLIC, '192.168.0.10'],
    });
    for (const url of [
      ...literals,
      'https://intranet.example/a.png',
      'https://imds.example/a.png',
      'https://v6.example/a.png',
      'https://mapped.example/a.png',
      'https://mixed.example/a.png', // one private answer refuses the host
    ]) {
      const r = await importFromLink(url, { saveAsset: s.saveAsset, lookup, transport });
      expect({ url, r: r.ok ? 'ok' : r.reason }).toEqual({ url, r: 'link-private' });
    }
    expect(hops).toEqual([]);
    expect(s.saved).toEqual([]);
  });

  test('the address classifier: private, special and non-global IPv6 refused; public allowed', () => {
    for (const a of [
      '0.0.0.0',
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.0.1',
      '100.64.0.1',
      '169.254.169.254',
      '224.0.0.1',
      '255.255.255.255',
      '198.51.100.7',
      '203.0.113.7',
      '::',
      '::1',
      '::127.0.0.1', // IPv4-compatible
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::7f00:1', // NAT64 embedding loopback
      'fe80::1',
      'fc00::1',
      'fd00:ec2::254',
      'ff02::1',
      'fec0::1',
      '2001:db8::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      '2002:7f00:1::1', // 6to4 of 127.0.0.1
      'not-an-ip',
    ])
      expect({ a, refused: Boolean(linkAddressRefusal(a)) }).toEqual({ a, refused: true });
    for (const a of [PUBLIC, '8.8.8.8', '2606:4700:4700::1111', '64:ff9b::808:808'])
      expect({ a, refused: linkAddressRefusal(a) }).toEqual({ a, refused: null });
  });
});

describe('redirects and DNS rebinding', () => {
  test('a public → private redirect is refused at the second hop; nothing is fetched from it', async () => {
    const { lookup } = table({ 'media.example': [PUBLIC], 'inside.example': ['10.0.0.8'] });
    const s = fakeSaver();
    for (const location of [
      'https://inside.example/a.png',
      'https://127.0.0.1/a.png',
      'https://169.254.169.254/latest/meta-data/',
      'http://media.example/a.png', // a downgrade
      'https://media.example:8080/a.png',
    ]) {
      const { transport, hops } = wire((hop) =>
        hop.url.pathname === '/start'
          ? { status: 302, location, contentLength: null, body: null }
          : ok(PNG)
      );
      const r = await importFromLink('https://media.example/start', {
        saveAsset: s.saveAsset,
        lookup,
        transport,
      });
      expect(r.ok).toBe(false);
      expect(hops).toEqual([{ host: 'media.example', ip: PUBLIC, path: '/start' }]);
    }
    expect(s.saved).toEqual([]);
  });

  test('a public → public redirect is followed, re-resolved, and capped', async () => {
    const { lookup, asked } = table({ 'media.example': [PUBLIC], 'cdn.example': ['8.8.4.4'] });
    const s = fakeSaver();
    const { transport, hops } = wire((hop) =>
      hop.url.hostname === 'media.example'
        ? { status: 301, location: '//cdn.example/x/photo.png', contentLength: null, body: null }
        : ok(PNG)
    );
    const r = await importFromLink('https://media.example/a', {
      saveAsset: s.saveAsset,
      lookup,
      transport,
    });
    expect(r.ok).toBe(true);
    // the name and site are the pasted link's — a redirect target never names what the line says
    expect(r.ok && [r.name, r.host]).toEqual(['a', 'media.example']);
    expect(asked).toEqual(['media.example', 'cdn.example']);
    expect(hops.map((h) => h.ip)).toEqual([PUBLIC, '8.8.4.4']);

    const loop = wire(() => ({ status: 302, location: '/again', contentLength: null, body: null }));
    const r2 = await importFromLink('https://media.example/a', {
      saveAsset: s.saveAsset,
      lookup,
      transport: loop.transport,
      limits: { maxHops: 3 },
    });
    expect(r2.ok ? 'ok' : r2.reason).toBe('link-redirects');
    expect(loop.hops.length).toBe(4);
  });

  test('DNS rebinding: first answer public, second private — the request goes to the checked address only', async () => {
    let n = 0;
    const { lookup } = table({ 'rebind.example': () => (n++ === 0 ? [PUBLIC] : ['127.0.0.1']) });
    const s = fakeSaver();
    // one hop: the transport gets the checked address; it never re-resolves the name
    const one = wire(() => ok(PNG));
    const r = await importFromLink('https://rebind.example/a.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: one.transport,
    });
    expect(r.ok).toBe(true);
    expect(one.hops).toEqual([{ host: 'rebind.example', ip: PUBLIC, path: '/a.png' }]);
    // a redirect back to the same name re-resolves — and now it is private: refused, not fetched
    n = 0;
    const two = wire((hop) =>
      hop.url.pathname === '/start'
        ? { status: 307, location: '/a.png', contentLength: null, body: null }
        : ok(PNG)
    );
    const r2 = await importFromLink('https://rebind.example/start', {
      saveAsset: s.saveAsset,
      lookup,
      transport: two.transport,
    });
    expect(r2.ok ? 'ok' : r2.reason).toBe('link-private');
    expect(two.hops.map((h) => h.ip)).toEqual([PUBLIC]);
  });
});

describe('limits and the type', () => {
  const { lookup } = table({ 'media.example': [PUBLIC] });

  test('the size cap is counted while streaming, not trusted from Content-Length', async () => {
    const s = fakeSaver();
    // no Content-Length; past the 4 KB head the body streams on, and the third 4 KB chunk crosses a 10 KB cap
    const chunk = Buffer.alloc(4100, 1);
    const { transport } = wire(() => ({
      status: 200,
      location: null,
      contentLength: null,
      body: streamOf(PNG.subarray(0, 40), chunk, chunk, chunk),
    }));
    const r = await importFromLink('https://media.example/big.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport,
      limits: { maxBytes: 10_000 },
    });
    expect(r.ok ? 'ok' : r.reason).toBe('too-large');
    expect(s.saved).toEqual([]);
    // a lying Content-Length (small) changes nothing
    const lying = wire(() => ({
      status: 200,
      location: null,
      contentLength: 10,
      body: streamOf(PNG.subarray(0, 40), chunk, chunk, chunk),
    }));
    const r2 = await importFromLink('https://media.example/big.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: lying.transport,
      limits: { maxBytes: 10_000 },
    });
    expect(r2.ok ? 'ok' : r2.reason).toBe('too-large');
    // an honest oversize Content-Length is refused before the body is read
    const honest = wire(() => ok(PNG, { contentLength: 10_000 }));
    const r3 = await importFromLink('https://media.example/big.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: honest.transport,
      limits: { maxBytes: 100 },
    });
    expect(r3.ok ? 'ok' : r3.reason).toBe('too-large');
    expect(s.saved).toEqual([]);
  });

  test('a site that never answers, or stops sending, times out', async () => {
    const s = fakeSaver();
    const silent = wire(
      (hop) =>
        new Promise<LinkAnswer>((_, reject) =>
          hop.signal.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const t0 = Date.now();
    const r = await importFromLink('https://media.example/a.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: silent.transport,
      limits: { answerMs: 80, totalMs: 5000 },
    });
    expect(r.ok ? 'ok' : r.reason).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2000);
    // the head arrives, then nothing: the idle timeout ends it, nothing is kept
    const stall = wire(() => ({
      status: 200,
      location: null,
      contentLength: null,
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(PNG.subarray(0, 32));
        },
      }),
    }));
    const r2 = await importFromLink('https://media.example/a.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: stall.transport,
      limits: { idleMs: 80, totalMs: 5000 },
    });
    expect(r2.ok ? 'ok' : r2.reason).toBe('timeout');
    // a slow drip under the idle timeout still ends at the whole-import deadline
    const drip = wire(() => ({
      status: 200,
      location: null,
      contentLength: null,
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(PNG.subarray(0, 32));
        },
        async pull(c) {
          await Bun.sleep(20);
          c.enqueue(Buffer.alloc(1));
        },
      }),
    }));
    const r3 = await importFromLink('https://media.example/a.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: drip.transport,
      limits: { idleMs: 200, totalMs: 300 },
    });
    expect(r3.ok ? 'ok' : r3.reason).toBe('timeout');
    expect(s.saved).toEqual([]);
  });

  test('the type comes from the bytes: HTML named .png and an SVG are refused, a PNG named .html lands', async () => {
    // a writer that takes ANYTHING: the link gate itself must refuse before a byte reaches it
    const s = { saved: [] as Buffer[], saveAsset: fakeSaver().saveAsset };
    const reached: string[] = [];
    s.saveAsset = async (stream) => {
      const b = Buffer.from(await new Response(stream).arrayBuffer());
      reached.push(b.subarray(0, 8).toString('latin1'));
      s.saved.push(b);
      return { ok: true, path: 'assets/0000abcd.bin' };
    };
    const named = (body: Buffer) => wire(() => ok(body)).transport;
    const html = await importFromLink('https://media.example/photo.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: named(HTML),
    });
    expect(html.ok ? 'ok' : html.reason).toBe('link-not-media');
    const svg = await importFromLink('https://media.example/logo.png', {
      saveAsset: s.saveAsset,
      lookup,
      transport: named(SVG),
    });
    expect(svg.ok ? 'ok' : svg.reason).toBe('link-svg');
    expect(s.saved).toEqual([]);
    const png = await importFromLink('https://media.example/page.html', {
      saveAsset: s.saveAsset,
      lookup,
      transport: named(PNG),
    });
    expect(png.ok && png.kind).toBe('png');
    expect(reached.length).toBe(1);
  });
});

describe('H1 and L2: compressed answers and polyglots', () => {
  const { lookup } = table({ 'media.example': [PUBLIC] });
  const untouchable = () =>
    new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('the body was read');
      },
    });

  test('H1: an encoded answer (gzip, br, deflate…) is refused before a byte of it is read', async () => {
    for (const enc of ['gzip', 'br', 'deflate', 'zstd', 'gzip, br']) {
      const s = fakeSaver();
      const { transport } = wire(() => ({
        status: 200,
        location: null,
        contentLength: 1600,
        contentEncoding: enc,
        body: untouchable(),
      }));
      const r = await importFromLink('https://media.example/a.png', {
        saveAsset: s.saveAsset,
        lookup,
        transport,
      });
      expect({ enc, r: r.ok ? 'ok' : r.reason }).toEqual({ enc, r: 'link-encoded' });
      expect(s.saved).toEqual([]);
    }
    const plain = await importFromLink('https://media.example/a.png', {
      saveAsset: fakeSaver().saveAsset,
      lookup,
      transport: wire(() => ok(PNG, { contentEncoding: 'identity' })).transport,
    });
    expect(plain.ok).toBe(true);
  });

  /** Two MPEG-1 Layer III frames, 128 kb/s, 44.1 kHz: 417 bytes each. */
  const mp3 = () => {
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    return Buffer.concat([frame, frame, Buffer.alloc(64)]);
  };

  test('L2: a weak signature must parse — an MP3 needs ID3 or two real frames, a JPEG a marker, an mp4 a sane box', () => {
    expect(linkTypeOf(mp3())?.ext).toBe('mp3');
    const id3 = Buffer.concat([
      Buffer.from('ID3'),
      Buffer.from([3, 0, 0, 0, 0, 0x10, 0x7f]),
      Buffer.alloc(32),
    ]);
    expect(linkTypeOf(id3)?.ext).toBe('mp3');
    expect(
      linkTypeOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))?.ext
    ).toBe('png');
    expect(linkTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))?.ext).toBe('jpg');
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from('ftypisom'),
      Buffer.alloc(32),
    ]);
    expect(linkTypeOf(mp4)?.ext).toBe('mp4');
    for (const [what, bytes] of [
      [
        'frame-sync + HTML',
        Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.from('<html><script>x</script>')]),
      ],
      [
        'one MP3 frame then HTML',
        Buffer.concat([mp3().subarray(0, 417), Buffer.from('<html><script>')]),
      ],
      ['ID3 + HTML', Buffer.from('ID3<html><script>alert(1)</script>')],
      ['SOI + HTML', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<html>')])],
      [
        'ftyp with a junk size',
        Buffer.concat([Buffer.from('<htm'), Buffer.from('ftyp<scr'), Buffer.alloc(16)]),
      ],
    ] as const) {
      expect({ what, t: linkTypeOf(bytes)?.ext ?? null }).toEqual({ what, t: null });
      // the Assets writer's own sniff would have taken it: the link gate is the stricter one
      expect({ what, weak: sniffAssetType(bytes)?.ext ?? null }).not.toEqual({ what, weak: null });
    }
  });

  test('L2: a polyglot from a link is refused, never handed to the writer', async () => {
    const s = fakeSaver();
    const r = await importFromLink('https://media.example/song.mp3', {
      saveAsset: s.saveAsset,
      lookup,
      transport: wire(() =>
        ok(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.from('<html><script>x</script>')]))
      ).transport,
    });
    expect(r.ok ? 'ok' : r.reason).toBe('link-not-media');
    expect(s.saved).toEqual([]);
    const good = await importFromLink('https://media.example/song.mp3', {
      saveAsset: s.saveAsset,
      lookup,
      transport: wire(() => ok(mp3())).transport,
    });
    expect(good.ok && good.kind).toBe('mp3');
  });
});

describe('the route', () => {
  const role = (r: 'owner' | 'member' | 'viewer' | 'observer') => resolveAccess({ v: 1, role: r });
  type Spec = { path: string; handle: (r: Request, p: Record<string, string>) => unknown };
  const KEY = 'page-key-for-tests';
  const routes = (over: Partial<Parameters<typeof createImportLinkRoutes>[0]> = {}) => {
    const all = createImportLinkRoutes({
      access: () => role('member'),
      saveAsset: fakeSaver().saveAsset,
      pageKey: KEY,
      env: {},
      ...over,
    }) as unknown as Spec[];
    return {
      key: all.find((x) => x.path === '/_api/import-link/key') as Spec,
      link: all.find((x) => x.path === '/_api/import-link') as Spec,
    };
  };
  const post = (
    spec: Spec,
    body: unknown,
    headers: Record<string, string> = { 'x-maude-link-key': KEY }
  ) =>
    spec.handle(
      new Request('http://127.0.0.1/_api/import-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    ) as Promise<Response>;
  const getKey = (spec: Spec, headers: Record<string, string> = {}) =>
    spec.handle(
      new Request('http://127.0.0.1/_api/import-link/key', { headers }),
      {}
    ) as Promise<Response>;

  test('main origin only, refused for a read-only session', () => {
    const all = createImportLinkRoutes({
      access: () => role('member'),
      saveAsset: fakeSaver().saveAsset,
    });
    expect(all.map((x) => [x.method, x.path, x.origin])).toEqual([
      ['GET', '/_api/import-link/key', 'main'],
      ['POST', '/_api/import-link', 'main'],
    ]);
    expect(all.find((x) => x.method === 'POST')?.readOnly).toBe('refused');
  });

  test('Can view, Can comment and a canvas-only editor are refused; nothing is fetched or kept', async () => {
    for (const access of [
      role('viewer'),
      role('observer'),
      resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] } as never),
    ]) {
      const s = fakeSaver();
      const { lookup, asked } = table({ 'media.example': [PUBLIC] });
      const { transport, hops } = wire(() => ok(PNG));
      const r = routes({ access: () => access, saveAsset: s.saveAsset, lookup, transport });
      const res = await post(r.link, { url: 'https://media.example/a.png' });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { reason: string }).reason).toBe('forbidden');
      expect((await getKey(r.key)).status).toBe(403);
      expect(asked).toEqual([]);
      expect(hops).toEqual([]);
      expect(s.saved).toEqual([]);
    }
  });

  test('F2: only the shell page may ask — no key, a wrong key or an AI chat header is refused; the key route keeps the key from a chat', async () => {
    const { lookup, asked } = table({ 'media.example': [PUBLIC] });
    const s = fakeSaver();
    const r = routes({ saveAsset: s.saveAsset, lookup, transport: wire(() => ok(PNG)).transport });
    const url = { url: 'https://media.example/a.png' };
    for (const headers of [
      {},
      { 'x-maude-link-key': 'guess' },
      { 'x-maude-link-key': `${KEY}x` },
      { 'x-maude-link-key': KEY, 'x-maude-chat': 'chat_1' },
    ]) {
      const res = await post(r.link, url, headers);
      expect({
        headers,
        status: res.status,
        reason: ((await res.json()) as { reason: string }).reason,
      }).toEqual({
        headers,
        status: 403,
        reason: 'not-from-shell',
      });
    }
    expect(asked).toEqual([]);
    // the key: the shell's page gets it; a request an AI chat made does not
    expect((await getKey(r.key, { 'x-maude-chat': 'chat_1' })).status).toBe(403);
    const k = await getKey(r.key);
    expect(k.status).toBe(200);
    const { key } = (await k.json()) as { key: string };
    expect(key).toBe(KEY);
    // the shell path: the key it was handed, no chat header
    expect((await post(r.link, url, { 'x-maude-link-key': key })).status).toBe(201);
    expect(s.saved.length).toBe(1);
    // a server mints its own key when none is given
    const minted = createImportLinkRoutes({
      access: () => role('member'),
      saveAsset: s.saveAsset,
    }) as unknown as Spec[];
    const got = (await (await getKey(minted[0] as Spec)).json()) as { key: string };
    expect(got.key.length).toBeGreaterThanOrEqual(40);
    expect(got.key).not.toBe(KEY);
  });

  test('F3/F4: private, no DNS answer and no connection answer the same; no remote status in the answer', async () => {
    const answers: string[] = [];
    for (const [url, transport] of [
      ['https://10.0.0.1/a.png', wire(() => ok(PNG)).transport],
      ['https://inside.example/a.png', wire(() => ok(PNG)).transport],
      ['https://nowhere.example/a.png', wire(() => ok(PNG)).transport],
      [
        'https://media.example/a.png',
        wire(() => {
          throw new Error('ECONNREFUSED');
        }).transport,
      ],
    ] as const) {
      const r = routes({
        lookup: table({ 'inside.example': ['192.168.1.9'], 'media.example': [PUBLIC] }).lookup,
        transport,
      });
      const res = await post(r.link, { url });
      answers.push(`${res.status} ${await res.text()}`);
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe(
      '502 {"ok":false,"reason":"link-unreachable","error":"the link cannot be reached from here"}'
    );
    const r404 = routes({
      lookup: table({ 'media.example': [PUBLIC] }).lookup,
      transport: wire(() => ({
        status: 404,
        location: null,
        contentLength: null,
        body: streamOf(HTML),
      })).transport,
    });
    const res = await post(r404.link, { url: 'https://media.example/a.png' });
    const text = await res.text();
    expect(text).toBe('{"ok":false,"reason":"link-http","error":"the site did not send the file"}');
    expect(text).not.toContain('404');
  });

  test('L1: a proxy in the environment refuses the import before any lookup', async () => {
    for (const k of [
      'HTTPS_PROXY',
      'https_proxy',
      'ALL_PROXY',
      'all_proxy',
      'HTTP_PROXY',
      'http_proxy',
    ]) {
      const { lookup, asked } = table({ 'media.example': [PUBLIC] });
      const r = routes({
        lookup,
        transport: wire(() => ok(PNG)).transport,
        env: { [k]: 'http://proxy.example:3128' },
      });
      const res = await post(r.link, { url: 'https://media.example/a.png' });
      expect({
        k,
        status: res.status,
        reason: ((await res.json()) as { reason: string }).reason,
      }).toEqual({
        k,
        status: 409,
        reason: 'link-proxy',
      });
      expect(asked).toEqual([]);
    }
    // an empty value is no proxy
    const r = routes({
      lookup: table({ 'media.example': [PUBLIC] }).lookup,
      transport: wire(() => ok(PNG)).transport,
      env: { HTTPS_PROXY: '' },
    });
    expect((await post(r.link, { url: 'https://media.example/a.png' })).status).toBe(201);
  });

  test('L4: a lookup that outlives the deadline keeps the one slot until it settles', async () => {
    let answer: ((v: Array<{ address: string }>) => void) | null = null;
    let calls = 0;
    const lookup: LinkLookup = (h) => {
      calls += 1;
      if (calls === 1) return new Promise((res) => (answer = res));
      return table({ 'media.example': [PUBLIC] }).lookup(h);
    };
    const r = routes({ lookup, transport: wire(() => ok(PNG)).transport, limits: { totalMs: 60 } });
    const first = await post(r.link, { url: 'https://media.example/a.png' });
    expect(first.status).toBe(504);
    await Bun.sleep(5);
    // the deadline answered, but the lookup still runs: the slot is still taken
    expect((await post(r.link, { url: 'https://media.example/a.png' })).status).toBe(429);
    expect(calls).toBe(1);
    (answer as unknown as (v: Array<{ address: string }>) => void)([{ address: PUBLIC }]);
    await Bun.sleep(5);
    expect((await post(r.link, { url: 'https://media.example/a.png' })).status).toBe(201);
  });

  test('a cell refuses; the happy path lands one asset and answers its path, kind and name', async () => {
    const { lookup } = table({ 'media.example': [PUBLIC] });
    const cell = routes({ inCell: true, lookup, transport: wire(() => ok(PNG)).transport });
    expect((await post(cell.link, { url: 'https://media.example/a.png' })).status).toBe(409);

    const s = fakeSaver();
    const r = routes({ saveAsset: s.saveAsset, lookup, transport: wire(() => ok(PNG)).transport });
    const res = await post(r.link, { url: 'https://media.example/foto/combine-2025-12.png#x' });
    expect(res.status).toBe(201);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j).toMatchObject({
      ok: true,
      path: 'assets/0000abcd.png',
      kind: 'png',
      category: 'image',
      name: 'combine-2025-12.png',
      host: 'media.example',
    });
    expect(s.saved.length).toBe(1);
    expect(Buffer.compare(s.saved[0] as Buffer, PNG)).toBe(0);
    // a refusal carries the reason word and no remote text
    const bad = await post(r.link, { url: 'http://media.example/a.png' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      ok: false,
      reason: 'link-not-https',
      error: 'only https links',
    });
  });
});

describe('the real transport: Bun fetch pinned to the checked address (local HTTPS, self-signed)', () => {
  let dir = '';
  let cert = '';
  let server: ReturnType<typeof Bun.serve> | null = null;
  const seen: Array<{ host: string | null; path: string }> = [];
  const bombs = { gz: Buffer.alloc(0), br: Buffer.alloc(0) };
  /** `mb` MiB of zeros through a compressor, streamed (never held inflated). */
  const squeeze = (z: NodeJS.ReadWriteStream, mb: number) =>
    new Promise<Buffer>((resolve, reject) => {
      const out: Buffer[] = [];
      z.on('data', (c: Buffer) => out.push(c));
      z.on('end', () => resolve(Buffer.concat(out)));
      z.on('error', reject);
      const zero = Buffer.alloc(1024 * 1024);
      let left = mb;
      const pump = () => {
        while (left > 0) {
          left -= 1;
          if (!z.write(zero)) return void z.once('drain', pump);
        }
        z.end();
      };
      pump();
    });
  beforeAll(async () => {
    bombs.gz = await squeeze(createGzip({ level: 9 }), 512);
    bombs.br = await squeeze(
      createBrotliCompress({ params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }),
      512
    );
  }, 60_000);
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'maude-import-link-tls-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
        '-subj',
        '/CN=media.test',
        '-addext',
        'subjectAltName=DNS:media.test',
      ],
      { stdio: 'ignore' }
    );
    cert = readFileSync(join(dir, 'cert.pem'), 'utf8');
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      tls: { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert },
      fetch(req) {
        const u = new URL(req.url);
        seen.push({ host: req.headers.get('host'), path: u.pathname });
        if (u.pathname === '/go')
          return new Response(null, { status: 302, headers: { location: '/a.png' } });
        if (u.pathname === '/bomb.gz')
          return new Response(bombs.gz, {
            headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' },
          });
        if (u.pathname === '/bomb.br')
          return new Response(bombs.br, {
            headers: { 'content-type': 'image/png', 'content-encoding': 'br' },
          });
        return new Response(PNG, { headers: { 'content-type': 'text/html' } });
      },
    });
  });
  afterAll(() => {
    server?.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('connects to the IP it was given, sends the name as Host + SNI, verifies the cert, follows no redirect', async () => {
    const port = server?.port as number;
    const t = bunTransport({ ca: cert });
    // `media.test` resolves nowhere: reaching the server proves the connect used the pinned address
    const r = await t({
      url: new URL(`https://media.test:${port}/a.png`),
      ip: '127.0.0.1',
      signal: new AbortController().signal,
    });
    expect(r.status).toBe(200);
    expect(Buffer.from(await new Response(r.body).arrayBuffer()).subarray(0, 8)).toEqual(
      PNG.subarray(0, 8)
    );
    expect(seen.at(-1)).toEqual({ host: `media.test:${port}`, path: '/a.png' });
    const redirect = await t({
      url: new URL(`https://media.test:${port}/go`),
      ip: '127.0.0.1',
      signal: new AbortController().signal,
    });
    expect(redirect.status).toBe(302);
    expect(redirect.location).toBe('/a.png');
    // a certificate for another name is refused (the check is against the link's host, not the IP)
    await expect(
      t({
        url: new URL(`https://other.test:${port}/a.png`),
        ip: '127.0.0.1',
        signal: new AbortController().signal,
      })
    ).rejects.toBeDefined();
  });

  test('H1: a gzip or brotli bomb is read as sent (never inflated) and memory stays bounded', async () => {
    const port = server?.port as number;
    const t = bunTransport({ ca: cert });
    for (const [path, packed] of [
      ['/bomb.gz', bombs.gz],
      ['/bomb.br', bombs.br],
    ] as const) {
      Bun.gc(true);
      const before = process.memoryUsage().rss;
      const r = await t({
        url: new URL(`https://media.test:${port}${path}`),
        ip: '127.0.0.1',
        signal: new AbortController().signal,
      });
      expect(r.contentEncoding).toBe(path.endsWith('gz') ? 'gzip' : 'br');
      let read = 0;
      for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) read += c.length;
      const grew = process.memoryUsage().rss - before;
      // 512 MiB inflated; what arrives is the compressed size, and the process does not grow by the bomb
      expect({ path, read }).toEqual({ path, read: packed.length });
      expect(packed.length).toBeLessThan(2 * 1024 * 1024);
      expect(grew).toBeLessThan(128 * 1024 * 1024);
    }
  }, 30_000);

  test('L1: NODE_TLS_REJECT_UNAUTHORIZED=0 does not switch the certificate check off', async () => {
    const port = server?.port as number;
    const was = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      // no `ca`: the self-signed certificate is not trusted, whatever the environment says
      await expect(
        bunTransport()({
          url: new URL(`https://media.test:${port}/a.png`),
          ip: '127.0.0.1',
          signal: new AbortController().signal,
        })
      ).rejects.toBeDefined();
    } finally {
      if (was === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = was;
    }
  });
});
