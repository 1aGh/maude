// S8.22 (Q9) — PSD and HEIC through macOS `sips`, sandboxed and bounded. Every converted file is
// attacker-controlled: these pin the decompression-bomb, external-reference, size, time, sandbox and
// output checks in `bin/_import-asset.mjs`. Local fixtures only (test/fixtures/import-convert: a 4 × 4 PSD and
// HEIC made with `sips` from a 4 × 4 PNG); nothing is fetched. The `sips` cases run on macOS only.

import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  assertPixelBudget,
  convertWithSips,
  heicDims,
  ImportAssetError,
  importConvertible,
  importRasterBytes,
  psdDims,
  rasterDims,
  runSandboxed,
  sanitizeSvgWithReport,
  sniffConvertibleKind,
} from '../bin/_import-asset.mjs';

const FIX = join(import.meta.dir, 'fixtures', 'import-convert');
const PSD = readFileSync(join(FIX, 'tiny.psd'));
const HEIC = readFileSync(join(FIX, 'tiny.heic'));
const onMac = process.platform === 'darwin' && existsSync('/usr/bin/sips');
/** Offsets inside the HEIC fixture, found rather than hard-coded: the `ispe` width/height, the `url ` flags. */
const ISPE = HEIC.indexOf('ispe') + 8;
const URL_FLAGS = HEIC.indexOf('url ') + 4;

const tmp = (p = 'maude-s822-') => mkdtempSync(join(tmpdir(), p));
const root = () => {
  const r = tmp('maude-s822-root-');
  return r;
};

async function reasonOf(p: Promise<unknown> | (() => unknown)): Promise<string | null> {
  try {
    await (typeof p === 'function' ? p() : p);
    return null;
  } catch (e) {
    return e instanceof ImportAssetError
      ? (e as ImportAssetError & { reason: string }).reason
      : `threw:${e}`;
  }
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A PNG declaring `w × h` whose IDAT is one tiny deflate stream — the decompression ("zip") bomb shape. */
function pngDeclaring(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.alloc(1 << 20))), // 1 MB of zeros → ~1 kB
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A fake `sips` (a shell script) — `$6` is the `--out` path the converter passes. */
function fakeSips(body: string): string {
  const dir = tmp('maude-s822-fake-');
  const p = join(dir, 'sips');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe('S8.22 sniff + headers (the bytes decide, never the name)', () => {
  test('PSD and HEIC fixtures sniff; a PNG, a bad PSD version and an AVIF do not', () => {
    expect(sniffConvertibleKind(PSD)).toBe('psd');
    expect(sniffConvertibleKind(HEIC)).toBe('heic');
    expect(sniffConvertibleKind(pngDeclaring(4, 4))).toBe(null);
    const badVersion = Buffer.from(PSD);
    badVersion.writeUInt16BE(7, 4);
    expect(sniffConvertibleKind(badVersion)).toBe(null);
    const avif = Buffer.from(HEIC);
    avif.write('avif', 8, 'ascii');
    expect(sniffConvertibleKind(avif)).toBe(null);
  });

  test('declared sizes are read from the headers', () => {
    expect(psdDims(PSD)).toEqual({ w: 4, h: 4 });
    expect(heicDims(HEIC)).toEqual({ w: 4, h: 4, external: false });
    expect(rasterDims(pngDeclaring(640, 480), 'png')).toEqual({ w: 640, h: 480 });
  });

  test('a hostile HEIC box tree ends the walk (no hang, no throw past the budget word)', async () => {
    const lying = Buffer.concat([
      HEIC.subarray(0, 0x24),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0x6d, 0x65, 0x74, 0x61]),
    ]);
    expect(heicDims(lying)).toBe(null);
    const many = Buffer.concat([
      HEIC.subarray(0, 0x24),
      Buffer.concat(
        Array.from({ length: 20_000 }, () => Buffer.from([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]))
      ),
    ]);
    const t0 = performance.now();
    expect(await reasonOf(() => heicDims(many))).toBe('unreadable');
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('S8.22 decompression bombs: the pixel budget refuses before anything decodes', () => {
  test('PSD declaring 30000 × 30000 is refused without running sips', async () => {
    const bomb = Buffer.from(PSD);
    bomb.writeUInt32BE(30_000, 14);
    bomb.writeUInt32BE(30_000, 18);
    // a sips that WOULD succeed (copies a real PNG): a refusal proves the header check ran first
    const good = join(tmp(), 'ok.png');
    writeFileSync(good, pngDeclaring(4, 4));
    const sipsPath = fakeSips(`cp "${good}" "$6"`);
    expect(await reasonOf(convertWithSips(bomb, { platform: 'darwin', sipsPath }))).toBe(
      'too-many-pixels'
    );
  });

  test('HEIC declaring 50000 × 50000 (ispe) is refused; one with no declared size is refused', async () => {
    const bomb = Buffer.from(HEIC);
    bomb.writeUInt32BE(50_000, ISPE);
    bomb.writeUInt32BE(50_000, ISPE + 4);
    expect(await reasonOf(convertWithSips(bomb, { platform: 'darwin' }))).toBe(
      onMac ? 'too-many-pixels' : 'not-on-mac'
    );
    const noSize = Buffer.from(HEIC);
    noSize.write('xspe', ISPE - 8, 'ascii');
    expect(await reasonOf(convertWithSips(noSize, { platform: 'darwin' }))).toBe(
      onMac ? 'unreadable' : 'not-on-mac'
    );
  });

  test('a deflate-bomb PNG (60000 × 60000 in ~1 kB) is refused by the raster lane too', async () => {
    const bomb = pngDeclaring(60_000, 60_000);
    expect(bomb.length).toBeLessThan(10_000);
    expect(await reasonOf(() => importRasterBytes(bomb, { root: root() }))).toBe('too-many-pixels');
    expect(await reasonOf(() => assertPixelBudget({ w: 0, h: 10 }))).toBe('unreadable');
  });
});

describe('S8.22 external entities + embedded scripts', () => {
  test('a HEIC whose dref points outside the file is refused', async () => {
    const ext = Buffer.from(HEIC);
    ext[URL_FLAGS + 3] = 0; // url  flags 000001 (self-contained) → 000000
    expect(heicDims(ext)?.external).toBe(true);
    expect(await reasonOf(convertWithSips(ext, { platform: 'darwin' }))).toBe(
      onMac ? 'external-reference' : 'not-on-mac'
    );
  });

  test('SVG: an external entity and a billion-laughs DTD are refused, fast', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>`;
    expect(() => sanitizeSvgWithReport(xxe)).toThrow(/ENTITY/);
    const lol = `<!DOCTYPE svg [${Array.from({ length: 10 }, (_, i) => `<!ENTITY l${i} "${`&l${i - 1};`.repeat(10)}">`).join('')}]><svg xmlns="http://www.w3.org/2000/svg">&l9;</svg>`;
    const t0 = performance.now();
    expect(() => sanitizeSvgWithReport(lol)).toThrow(/ENTITY|internal subset/);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  test('SVG: scripts, handlers and links to other sites are left out — and counted for the one line', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
      <script>alert(1)</script>
      <rect width="10" height="10" fill="#0a0" onclick="steal()"/>
      <a href="https://evil.example/"><circle r="2"/></a>
      <image href="https://tracker.example/p.png" width="1" height="1"/>
      <path d="M0 0L10 10" stroke="#000"/>
    </svg>`;
    const { svg: out, removed } = sanitizeSvgWithReport(svg);
    expect(out).not.toMatch(/script|onclick|evil|tracker/);
    expect(out).toMatch(/<path/);
    expect(removed).toEqual({ scripts: 2, links: 2, other: 0 });
  });
});

describe('S8.22 caps: bytes, time, platform', () => {
  test('past the byte cap is refused before anything parses', async () => {
    expect(await reasonOf(convertWithSips(PSD, { platform: 'darwin', maxBytes: 100 }))).toBe(
      'too-large'
    );
  });

  test('off macOS the file is refused with one word, and sips never runs', async () => {
    expect(await reasonOf(convertWithSips(PSD, { platform: 'linux' }))).toBe('not-on-mac');
    expect(await reasonOf(convertWithSips(HEIC, { platform: 'win32' }))).toBe('not-on-mac');
    expect(
      await reasonOf(convertWithSips(Buffer.from('hello world, not a picture at all'), {}))
    ).toBe('unsupported');
  });

  test.skipIf(!onMac)('a converter past the time cap is killed', async () => {
    const sipsPath = fakeSips('sleep 30');
    const t0 = performance.now();
    expect(await reasonOf(convertWithSips(PSD, { sipsPath, timeoutMs: 400 }))).toBe('timeout');
    expect(performance.now() - t0).toBeLessThan(5_000);
  });
});

describe.skipIf(!onMac)(
  'S8.22 sandbox: no network, no home reads, writes only in its own dirs',
  () => {
    test('a connection from inside the sandbox fails while the same one outside succeeds', async () => {
      const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });
      try {
        const url = `http://127.0.0.1:${server.port}/`;
        // async: a blocking spawn would stall this process's own server
        const plain = Bun.spawn(['/usr/bin/curl', '-sS', '-m', '3', '-o', '/dev/null', url]);
        expect(await plain.exited).toBe(0);
        const work = tmp();
        const boxed = await runSandboxed(
          '/usr/bin/curl',
          ['-sS', '-m', '3', '-o', '/dev/null', url],
          { work, timeoutMs: 5_000 }
        );
        expect(boxed.code).not.toBe(0);
      } finally {
        server.stop(true);
      }
    });

    test.skipIf(!import.meta.path.startsWith(homedir()))(
      'a file in the home folder cannot be read',
      async () => {
        const work = tmp();
        const r = await runSandboxed('/bin/cat', [import.meta.path], { work, timeoutMs: 5_000 });
        expect(r.code).not.toBe(0);
      }
    );

    test('a write outside the work and temp dirs is refused', async () => {
      const outside = join(import.meta.dir, '.s822-sandbox-probe');
      rmSync(outside, { force: true });
      try {
        const r = await runSandboxed('/usr/bin/touch', [outside], {
          work: tmp(),
          timeoutMs: 5_000,
        });
        expect(r.code).not.toBe(0);
        expect(existsSync(outside)).toBe(false);
      } finally {
        rmSync(outside, { force: true }); // a broken profile must not leave the probe in the tree
      }
    });
  }
);

describe.skipIf(!onMac)('S8.22 the output is checked again', () => {
  test('a symlink, a non-picture and a bomb-sized picture out of the converter are refused', async () => {
    expect(
      await reasonOf(convertWithSips(PSD, { sipsPath: fakeSips('ln -s /etc/passwd "$6"') }))
    ).toBe('unreadable');
    expect(await reasonOf(convertWithSips(PSD, { sipsPath: fakeSips('echo hello > "$6"') }))).toBe(
      'unreadable'
    );
    const big = join(tmp(), 'big.png');
    writeFileSync(big, pngDeclaring(40_000, 40_000));
    expect(await reasonOf(convertWithSips(PSD, { sipsPath: fakeSips(`cp "${big}" "$6"`) }))).toBe(
      'too-many-pixels'
    );
  });
});

describe.skipIf(!onMac)('S8.22 real conversions + the dedupe answer', () => {
  test('a .psd comes in as its flat picture; the same file again is reused', async () => {
    const r = root();
    const a = await importConvertible(PSD, { root: r });
    expect(a.path).toMatch(/^assets\/[a-z0-9]{8}\.png$/);
    expect(a.converted).toBe('psd');
    expect(a.reused).toBe(false);
    const b = await importConvertible(PSD, { root: r });
    expect(b.path).toBe(a.path);
    expect(b.reused).toBe(true);
  });

  test('a HEIC comes in as a JPG; a .psd without a flat picture says so', async () => {
    const a = await importConvertible(HEIC, { root: root() });
    expect(a.path).toMatch(/^assets\/[a-z0-9]{8}\.jpg$/);
    expect(await reasonOf(importConvertible(PSD.subarray(0, 200), { root: root() }))).toBe(
      'no-flat-picture'
    );
  });
});
