// #212 §5 (T2.2 fix) — WebKit has no WebP encoder: `canvas.toBlob(cb, 'image/webp')` answers `image/png`, so on
// Safari / the desktop app every still is a PNG. The persist lane must accept a single-image PNG as well as a still
// WebP — checked by what the bytes ARE (never decoded by the shell), with the same caps — and the canvas must decode
// a persisted still with the MIME of its bytes. Contract: client/v2/contracts/212-still-cache.md §5 "Bytes".
import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { STILL_STYLE_SEP, startStillPersist } from '../artboard-still-persist.ts';
import { StillCache, StillController } from '../artboard-still.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { checkStillImage, STILL_PERSIST_MAX_BYTES, stillMime } from '../bridge/still-webp.ts';
import { createStillStore, memoryStillBackend } from '../client/v2/shell/still-store.js';

// ─── real PNG fixtures (valid CRCs and zlib data, so a browser would decode them) ──────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const be32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
/** One chunk; `len` overrides the length field (a lying length), the CRC is always the real one. */
function chunk(type: string, data: Uint8Array = new Uint8Array(0), len?: number): Buffer {
  const td = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  return Buffer.concat([be32(len ?? data.length), td, be32(crc32(td))]);
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function ihdr(w: number, h: number, depth = 8, color = 6, interlace = 0): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w >>> 0, 0);
  d.writeUInt32BE(h >>> 0, 4);
  d[8] = depth;
  d[9] = color;
  d[12] = interlace;
  return chunk('IHDR', d);
}
/** RGBA rows (filter 0) with a little pattern, deflated and split over `parts` IDAT chunks. */
function idats(w: number, h: number, parts = 1): Buffer[] {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      raw.fill((x * 7 + y * 3) & 255, y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 4 + x * 4);
  const z = deflateSync(raw);
  const step = Math.ceil(z.length / parts);
  const out: Buffer[] = [];
  for (let i = 0; i < z.length; i += step) out.push(chunk('IDAT', z.subarray(i, i + step)));
  return out;
}
/** What WebKit's canvas encoder writes: IHDR, sRGB, eXIf, IDAT × n, IEND (measured in Playwright WebKit). */
function png(
  w: number,
  h: number,
  o: { head?: Buffer; before?: Buffer[]; after?: Buffer[]; parts?: number; tail?: Buffer } = {}
): ArrayBuffer {
  const exif = Buffer.from('MM\u0000*\u0000\u0000\u0000\b\u0000\u0000', 'latin1');
  const b = Buffer.concat([
    SIG,
    o.head ?? ihdr(w, h),
    chunk('sRGB', Uint8Array.of(0)),
    chunk('eXIf', exif),
    ...(o.before ?? []),
    ...idats(Math.min(w, 64), Math.min(h, 64), o.parts ?? 3),
    ...(o.after ?? []),
    chunk('IEND'),
    o.tail ?? Buffer.alloc(0),
  ]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer;
}
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer;

describe('bytes: a single-image PNG is a still as well (WebKit encodes no WebP)', () => {
  test('a PNG the overview could have drawn passes, with its format and size from IHDR', () => {
    expect(checkStillImage(png(400, 900))).toEqual({ ok: true, format: 'png', w: 400, h: 900 });
    expect(checkStillImage(png(401, 1601))).toMatchObject({ ok: true, w: 401, h: 1601 });
    expect(checkStillImage(png(20, 20, { head: ihdr(20, 20, 8, 2, 1) }))).toMatchObject({
      ok: true,
    });
    expect(stillMime(png(20, 20))).toBe('image/png');
    expect(stillMime(new ArrayBuffer(40))).toBeNull();
  });

  test('refused: a bad signature, a bad or misplaced IHDR, too many pixels', () => {
    const p = new Uint8Array(png(20, 20));
    p[1] = 0x51;
    expect(checkStillImage(p.buffer)).toMatchObject({ ok: false, reason: 'not-image' });
    // the header only, nothing else (the old test's shape)
    const head = new Uint8Array(64);
    head.set([0x89, 0x50, 0x4e, 0x47]);
    expect(checkStillImage(head.buffer).ok).toBe(false);
    const sigOnly = Buffer.concat([SIG, chunk('IEND')]);
    expect(checkStillImage(ab(sigOnly)).ok).toBe(false);
    // IHDR not first
    const late = Buffer.concat([
      SIG,
      chunk('sRGB', Uint8Array.of(0)),
      ihdr(20, 20),
      ...idats(20, 20),
      chunk('IEND'),
    ]);
    expect(checkStillImage(ab(late))).toMatchObject({ ok: false, reason: 'bad-chunk' });
    // IHDR of the wrong length, zero / oversize dimensions, an impossible depth or colour type, a compression method
    expect(checkStillImage(png(20, 20, { head: chunk('IHDR', new Uint8Array(12)) })).ok).toBe(
      false
    );
    expect(checkStillImage(png(0, 20))).toMatchObject({ ok: false, reason: 'bad-chunk' });
    expect(checkStillImage(png(402, 20))).toMatchObject({ ok: false, reason: 'too-big' });
    expect(checkStillImage(png(20, 1602))).toMatchObject({ ok: false, reason: 'too-big' });
    expect(checkStillImage(png(20, 20, { head: ihdr(0x80000000, 20) })).ok).toBe(false);
    expect(checkStillImage(png(20, 20, { head: ihdr(20, 20, 7, 6) })).ok).toBe(false);
    expect(checkStillImage(png(20, 20, { head: ihdr(20, 20, 8, 5) })).ok).toBe(false);
    expect(checkStillImage(png(20, 20, { head: ihdr(20, 20, 8, 6, 2) })).ok).toBe(false);
    const comp = ihdr(20, 20);
    comp[8 + 10] = 1; // compression method byte → 1 (the CRC is not checked: the structure is)
    expect(checkStillImage(png(20, 20, { head: comp })).ok).toBe(false);
    // a second IHDR
    expect(checkStillImage(png(20, 20, { before: [ihdr(20, 20)] })).ok).toBe(false);
  });

  test('refused: an animated PNG (acTL / fcTL / fdAT), anything after IEND, no IDAT, no IEND', () => {
    const actl = chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]));
    expect(checkStillImage(png(20, 20, { before: [actl] }))).toMatchObject({
      ok: false,
      reason: 'animated',
    });
    expect(
      checkStillImage(png(20, 20, { before: [chunk('fcTL', new Uint8Array(26))] }))
    ).toMatchObject({
      ok: false,
      reason: 'animated',
    });
    expect(
      checkStillImage(png(20, 20, { after: [chunk('fdAT', new Uint8Array(8))] }))
    ).toMatchObject({
      ok: false,
      reason: 'animated',
    });
    expect(checkStillImage(png(20, 20, { tail: Buffer.from([0]) }))).toMatchObject({
      ok: false,
      reason: 'bad-size',
    });
    expect(checkStillImage(png(20, 20, { tail: chunk('tEXt', Buffer.from('a\u0000b')) })).ok).toBe(
      false
    );
    expect(checkStillImage(png(20, 20, { tail: chunk('IEND') })).ok).toBe(false);
    const noIdat = Buffer.concat([SIG, ihdr(20, 20), chunk('IEND')]);
    expect(checkStillImage(ab(noIdat))).toMatchObject({ ok: false, reason: 'bad-chunk' });
    const full = new Uint8Array(png(20, 20));
    expect(checkStillImage(full.slice(0, full.length - 12).buffer).ok).toBe(false); // IEND cut off
    expect(checkStillImage(full.slice(0, full.length - 3).buffer).ok).toBe(false); // half an IEND
    // IDAT runs must be one run; a non-empty IEND; a chunk the encoder never writes
    expect(
      checkStillImage(png(20, 20, { after: [chunk('sRGB', Uint8Array.of(0)), ...idats(4, 4)] })).ok
    ).toBe(false);
    const fatEnd = Buffer.concat([
      SIG,
      ihdr(20, 20),
      ...idats(20, 20),
      chunk('IEND', Uint8Array.of(1)),
    ]);
    expect(checkStillImage(ab(fatEnd)).ok).toBe(false);
    expect(
      checkStillImage(png(20, 20, { before: [chunk('tEXt', Buffer.from('k\u0000v'))] }))
    ).toMatchObject({
      ok: false,
      reason: 'bad-chunk',
    });
    expect(checkStillImage(png(20, 20, { before: [chunk('zz;z', Uint8Array.of(1))] })).ok).toBe(
      false
    );
  });

  test('refused: a chunk length past the buffer (incl. 2^32-1 and 2^31), never an overflowed walk', () => {
    for (const len of [0xffffffff, 0x80000000, 0x7fffffff, 1_000_000, 20]) {
      const lying = chunk('sRGB', Uint8Array.of(0), len);
      expect(checkStillImage(png(20, 20, { before: [lying] })).ok).toBe(false);
    }
    // a length that would land the walk exactly on a forged IEND inside another chunk's data
    const inner = Buffer.concat([chunk('IEND')]);
    const swallow = chunk('sRGB', Buffer.concat([Uint8Array.of(0), inner]), 1);
    expect(checkStillImage(png(20, 20, { before: [swallow] })).ok).toBe(false);
  });

  test('refused: over 256 kB, whatever it is', () => {
    const big = chunk('IDAT', new Uint8Array(STILL_PERSIST_MAX_BYTES));
    expect(checkStillImage(png(20, 20, { after: [big] }))).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
  });

  test('the bridge rows and the store take a PNG still and refuse a bad one', async () => {
    const put = DGN_TABLE.c2s['still-put'];
    const msg = (bytes: unknown) => ({ file: '.design/a.tsx', artboard: 'ab', sig: 's~t', bytes });
    const good = png(40, 40);
    const parsed = put.parse(msg(good));
    expect(parsed?.bytes instanceof ArrayBuffer).toBe(true);
    expect(parsed?.bytes).not.toBe(good);
    expect(put.parse(msg(png(40, 40, { before: [chunk('acTL', new Uint8Array(8))] })))).toBeNull();
    expect(put.parse(msg(png(40, 40, { tail: Buffer.from([1, 2, 3]) })))).toBeNull();
    const answer = DGN_TABLE.s2c.stills;
    expect(
      answer.parse({ file: 'f', items: [{ artboard: 'a', sig: 's', bytes: png(10, 10) }] })
    ).not.toBeNull();
    expect(
      answer.parse({
        file: 'f',
        items: [{ artboard: 'a', sig: 's', bytes: png(10, 10, { head: ihdr(10, 3000) }) }],
      })
    ).toBeNull();
    const store = createStillStore({ backend: memoryStillBackend() });
    const key = { pid: 'p1', scope: 'capA', src: 'h1:-:d1' };
    expect(await store.put({ ...key, artboard: 'a', sig: 's', bytes: png(10, 10) })).toBe(true);
    expect(
      await store.put({
        ...key,
        artboard: 'b',
        sig: 's',
        bytes: png(10, 10, { head: ihdr(999, 10) }),
      })
    ).toBe(false);
    const items = await store.list(key);
    expect(items.map((i: { artboard: string }) => i.artboard)).toEqual(['a']);
  });
});

// ─── the real blob path: toBlob(…, 'image/webp') answers a PNG, a reload shows it ───────────────────────────
const ORIGIN = 'http://127.0.0.1:5001';
const FILE = '.design/ui/a.tsx';
function fakeTarget(width: number, html: string) {
  const article = {
    offsetWidth: width,
    setAttribute() {},
    removeAttribute() {},
    appendChild: (c: { parentNode?: unknown }) => {
      c.parentNode = article;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: width * 0.1, height: 10 }),
  } as unknown as HTMLElement;
  const body = {
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: width,
    offsetHeight: 100,
    innerHTML: html,
    style: { setProperty() {} },
  } as unknown as HTMLElement;
  return { article, body };
}
/** A drawn still: a canvas whose toBlob behaves like WebKit's (asked for WebP, it gives PNG). */
function webkitCanvas(asked: string[]): HTMLElement {
  const el: Record<string, unknown> = {
    classList: { add() {} },
    style: {},
    setAttribute() {},
    parentNode: null,
    width: 40,
    height: 40,
    appendChild(c: { parentNode?: unknown }) {
      c.parentNode = el;
    },
    remove() {
      el.parentNode = null;
    },
    toBlob(cb: (b: Blob | null) => void, type: string) {
      asked.push(type);
      cb(new Blob([png(40, 40)], { type: 'image/png' }));
    },
  };
  return el as unknown as HTMLElement;
}
function fakeWin() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const toParent: Array<Record<string, unknown>> = [];
  const parent = { postMessage: (m: Record<string, unknown>) => toParent.push(m) };
  const win = {
    parent,
    location: { search: '?canvas=ui/a.tsx' },
    addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
  } as unknown as Window;
  const deliver = (data: unknown) => {
    for (const fn of listeners)
      fn({ data, source: parent, origin: ORIGIN } as unknown as MessageEvent);
  };
  return { win, toParent, deliver };
}
function rig() {
  const frames: Array<() => void> = [];
  const timers: Array<{ fn: () => void; due: number }> = [];
  let clock = 0;
  let takes = 0;
  const asked: string[] = [];
  const decoded: string[] = [];
  const cache = new StillCache(1_000_000, {
    // the default encoder (canvas.toBlob, asking for WebP); a decoder that records the MIME it was handed
    decode: async (blob) => {
      decoded.push(blob.type);
      return webkitCanvas([]);
    },
    objectUrl: { make: () => 'blob:x', revoke() {} },
  });
  const c = new StillController({
    now: () => clock,
    take: async () => {
      takes += 1;
      return webkitCanvas(asked);
    },
    later: (fn, ms) => timers.push({ fn, due: clock + ms }),
    frame: (fn) => frames.push(fn),
    observe: null,
    info: () => ({ visible: true, weight: 500 }),
    painted: async () => {},
    makeSlot: () => webkitCanvas([]),
    signature: (b) => (b as unknown as { innerHTML: string }).innerHTML,
    sizeOf: () => 1000,
    cache,
  });
  c.noteZoom(0.1);
  c.settle(0.1);
  c.setZoom(0.1);
  const tick = async (ms = 16) => {
    clock += ms;
    for (const f of frames.splice(0)) f();
    await new Promise((r) => setTimeout(r, 0));
    for (let k = 0; k < timers.length; ) {
      if ((timers[k]?.due ?? 0) <= clock) timers.splice(k, 1)[0]?.fn();
      else k += 1;
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  const drawAll = async () => {
    for (let i = 0; i < 120; i++) await tick(50);
  };
  return { c, cache, drawAll, takes: () => takes, asked, decoded };
}

describe('canvas: on WebKit the drawn PNG is persisted and a reload shows it', () => {
  test('session 1 offers the PNG; the shell keeps it; session 2 restores it with image/png, no drawing', async () => {
    // session 1: the shell answers (nothing kept yet), the artboard is drawn, its still is offered
    const r1 = rig();
    const w1 = fakeWin();
    startStillPersist(r1.c, { win: w1.win, file: FILE, styleSig: () => 'S1' });
    w1.deliver({ dgn: 'stills', file: FILE, items: [] });
    r1.c.register('a', fakeTarget(1600, '<div>a</div>'));
    await r1.drawAll();
    await new Promise((res) => setTimeout(res, 0));
    expect(r1.asked).toContain('image/webp'); // asked for WebP …
    const puts = w1.toParent.filter((m) => m.dgn === 'still-put');
    expect(puts.length).toBe(1); // … got PNG, and still offered it
    // the shell: the typed row, then the store
    const parsed = DGN_TABLE.c2s['still-put'].parse(puts[0]);
    expect(parsed).not.toBeNull();
    const store = createStillStore({ backend: memoryStillBackend() });
    const key = { pid: 'p1', scope: 'capA', src: 'h1:-:d1' };
    expect(
      await store.put({ ...key, artboard: parsed.artboard, sig: parsed.sig, bytes: parsed.bytes })
    ).toBe(true);
    const answer = DGN_TABLE.s2c.stills.parse({ file: FILE, items: await store.list(key) });
    expect(answer?.items.length).toBe(1);
    expect(answer?.items[0].sig).toBe(`<div>a</div>${STILL_STYLE_SEP}S1`);

    // session 2 (a reload): the answer seeds the cache, the artboard is restored from it
    const r2 = rig();
    const w2 = fakeWin();
    startStillPersist(r2.c, { win: w2.win, file: FILE, styleSig: () => 'S1' });
    w2.deliver({ dgn: 'stills', ...answer });
    expect(r2.cache.hasSeed('a')).toBe(true);
    r2.c.register('a', fakeTarget(1600, '<div>a</div>'));
    await r2.drawAll();
    expect(r2.c.viewOf('a')).toBe('still');
    expect(r2.takes()).toBe(0);
    expect(r2.decoded).toEqual(['image/png']);
  });
});
