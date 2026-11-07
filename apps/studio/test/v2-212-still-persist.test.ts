// #212 §5 (T2.2) — the overview stills persist across sessions, through the shell, behind security caps.
// Contract: client/v2/contracts/212-still-cache.md §5. Pinned here:
//   - scope: a frame cannot read or write another canvas's stills (the shell's own iframe + activePath decide);
//   - bytes: an oversized, non-WebP, animated or too-large-in-pixels payload is refused (bridge parse + store);
//   - staleness: a record of another source hash is never returned (and is deleted); a seed whose content
//     signature differs is never shown;
//   - reload: a persisted still stands in before any drawing (restored from the seed, `takes` 0).
import { describe, expect, test } from 'bun:test';
import { STILL_STYLE_SEP, startStillPersist } from '../artboard-still-persist.ts';
import { StillCache, StillController } from '../artboard-still.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { checkStillWebp, STILL_PERSIST_MAX_BYTES } from '../bridge/still-webp.ts';
import { frameCapFor } from '../client/frame-cap.js';
import { handleStillBridge, stillKeyFor, stillScopeOf } from '../client/v2/shell/still-bridge.js';
import {
  createStillStore,
  memoryStillBackend,
  STILL_PROJECT_MAX_BYTES,
} from '../client/v2/shell/still-store.js';

// ─── WebP fixtures (headers only: nothing here is ever decoded) ─────────────────────────────────────────────
function riff(chunk: string, data: number[]): ArrayBuffer {
  const pad = data.length % 2 ? [0] : [];
  const body = [
    ...Buffer.from('WEBP'),
    ...Buffer.from(chunk),
    ...le32(data.length),
    ...data,
    ...pad,
  ];
  return new Uint8Array([...Buffer.from('RIFF'), ...le32(body.length), ...body]).buffer;
}
function le32(n: number) {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}
/** A lossless (VP8L) still of w × h, `extra` bytes of payload. */
function vp8l(w: number, h: number, extra = 8): ArrayBuffer {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return riff('VP8L', [0x2f, ...le32(bits), ...new Array(extra).fill(7)]);
}
/** A lossy (VP8) key frame of w × h. */
function vp8(w: number, h: number): ArrayBuffer {
  return riff('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, 1, 2]);
}
/** An extended (VP8X) header; `anim` sets the animation flag. */
function vp8x(w: number, h: number, anim = false): ArrayBuffer {
  const w1 = w - 1;
  const h1 = h - 1;
  return riff('VP8X', [
    anim ? 0x02 : 0,
    0,
    0,
    0,
    w1 & 255,
    (w1 >> 8) & 255,
    w1 >> 16,
    h1 & 255,
    (h1 >> 8) & 255,
    h1 >> 16,
  ]);
}

describe('bytes: only a real still WebP the overview could have drawn', () => {
  test('lossless, lossy and extended stills pass, with their size from the bitstream', () => {
    expect(checkStillWebp(vp8l(400, 900))).toEqual({ ok: true, w: 400, h: 900 });
    expect(checkStillWebp(vp8(200, 120))).toEqual({ ok: true, w: 200, h: 120 });
    expect(checkStillWebp(vp8x(400, 1600))).toEqual({ ok: true, w: 400, h: 1600 });
  });
  test('refused: not bytes, not WebP, a lying RIFF size, animation, too many pixels, too many bytes', () => {
    expect(checkStillWebp('RIFF').ok).toBe(false);
    expect(checkStillWebp(new TextEncoder().encode('<svg onload=alert(1)>').buffer).ok).toBe(false);
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    expect(checkStillWebp(png.buffer).ok).toBe(false);
    const trailing = new Uint8Array(vp8l(10, 10).byteLength + 40);
    trailing.set(new Uint8Array(vp8l(10, 10)));
    expect(checkStillWebp(trailing.buffer)).toMatchObject({ ok: false, reason: 'bad-size' });
    expect(checkStillWebp(vp8x(100, 100, true))).toMatchObject({ ok: false, reason: 'animated' });
    expect(checkStillWebp(vp8l(2000, 100))).toMatchObject({ ok: false, reason: 'too-big' });
    expect(checkStillWebp(vp8l(400, 4000))).toMatchObject({ ok: false, reason: 'too-big' });
    expect(checkStillWebp(vp8l(100, 100, STILL_PERSIST_MAX_BYTES))).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
  });
  test('the bridge row refuses the whole message for bad bytes and copies good ones', () => {
    const put = DGN_TABLE.c2s['still-put'];
    const good = vp8l(40, 40);
    const msg = (bytes: unknown) => ({ file: '.design/a.tsx', artboard: 'ab', sig: 's~t', bytes });
    const parsed = put.parse(msg(good));
    expect(parsed?.bytes instanceof ArrayBuffer).toBe(true);
    expect(parsed?.bytes).not.toBe(good); // a copy: the sender's view cannot change it afterwards
    expect(put.parse(msg(vp8l(100, 100, STILL_PERSIST_MAX_BYTES)))).toBeNull();
    expect(put.parse(msg(new Uint8Array(100).buffer))).toBeNull();
    expect(put.parse(msg(vp8x(10, 10, true)))).toBeNull();
    expect(put.parse(msg('data:image/webp;base64,AAAA'))).toBeNull();
    expect(put.parse({ ...msg(good), artboard: 'a\u0000b' })).toBeNull();
    expect(put.gate).toBe('active');
    const answer = DGN_TABLE.s2c.stills;
    expect(
      answer.parse({ file: 'f', items: [{ artboard: 'a', sig: 's', bytes: vp8(10, 10) }] })
    ).not.toBeNull();
    expect(
      answer.parse({ file: 'f', items: [{ artboard: 'a', sig: 's', bytes: new ArrayBuffer(40) }] })
    ).toBeNull();
  });
});

// ─── the store ───────────────────────────────────────────────────────────────────────────────────────────
describe('store: caps, staleness, eviction', () => {
  const key = { pid: 'p1', scope: 'capA', src: 'h1:-:d1' };
  test('an oversized or non-WebP payload is refused by the store as well', async () => {
    const store = createStillStore({ backend: memoryStillBackend() });
    expect(await store.put({ ...key, artboard: 'a', sig: 's', bytes: new ArrayBuffer(100) })).toBe(
      false
    );
    expect(
      await store.put({
        ...key,
        artboard: 'a',
        sig: 's',
        bytes: vp8l(10, 10, STILL_PERSIST_MAX_BYTES),
      })
    ).toBe(false);
    expect(await store.put({ ...key, artboard: 'a', sig: 's', bytes: vp8l(10, 10) })).toBe(true);
    expect((await store.stats()).n).toBe(1);
  });
  test('a record of another source hash is not returned, and is deleted', async () => {
    const backend = memoryStillBackend();
    const store = createStillStore({ backend });
    await store.put({ ...key, artboard: 'a', sig: 'sa', bytes: vp8l(10, 10) });
    expect((await store.list(key)).map((x) => x.artboard)).toEqual(['a']);
    expect(await store.list({ ...key, src: 'h2:-:d1' })).toEqual([]);
    expect(backend._keys()).toEqual([]);
  });
  test("over a cap the canvas's own record used longest ago goes first", async () => {
    let t = 0;
    // a minute between writes: the per-canvas write rate is pinned in v2-212-still-persist-guard.test.ts
    const store = createStillStore({ backend: memoryStillBackend(), now: () => (t += 61_000) });
    const big = STILL_PERSIST_MAX_BYTES - 64;
    const n = Math.ceil(STILL_PROJECT_MAX_BYTES / big) + 1;
    for (let i = 0; i < n; i++)
      await store.put({
        ...key,
        scope: `c${i % 3}`,
        artboard: `a${i}`,
        sig: 's',
        bytes: vp8l(10, 10, big - 40),
      });
    const s = await store.stats();
    expect(s.bytes).toBeLessThanOrEqual(STILL_PROJECT_MAX_BYTES);
    expect(await store.list({ ...key, scope: 'c0' })).not.toContainEqual(
      expect.objectContaining({ artboard: 'a0' })
    );
    const last = `a${n - 1}`;
    const scopeOfLast = `c${(n - 1) % 3}`;
    expect((await store.list({ ...key, scope: scopeOfLast })).map((x) => x.artboard)).toContain(
      last
    );
  });
});

// ─── the shell bridge: scope ─────────────────────────────────────────────────────────────────────────────
const ORIGIN = 'http://127.0.0.1:5001';
const FRAME_KEY = Buffer.alloc(32, 9).toString('base64url');
function fakeFrame(src: string) {
  const posted: unknown[] = [];
  const win = { postMessage: (m: unknown) => posted.push(m) } as unknown as Window;
  return { contentWindow: win, getAttribute: (k: string) => (k === 'src' ? src : null), posted };
}
const snapshot = (rows: Array<{ rel: string; srcHash: string }>) => ({
  pid: 'pid-1',
  canvases: rows.map((r) => ({ ...r, metaHash: null, depsHash: 'd' })),
});
const indexOf = (snap: unknown) => ({ get: () => snap, subscribe: () => () => {} });
const ev = (data: unknown, source: unknown, origin = ORIGIN) =>
  ({ data, source, origin }) as unknown as MessageEvent;

describe('shell bridge: a frame reaches only the stills of the canvas it shows', () => {
  const A = '.design/ui/a.tsx';
  const B = '.design/ui/b.tsx';
  const rows = snapshot([
    { rel: 'ui/a.tsx', srcHash: 'ha' },
    { rel: 'ui/b.tsx', srcHash: 'hb' },
  ]);
  const ctx = (
    activePath: string,
    frame: ReturnType<typeof fakeFrame>,
    store: ReturnType<typeof createStillStore>
  ) => ({
    canvasOrigin: ORIGIN,
    activePath,
    frame,
    designRel: '.design',
    frameKey: FRAME_KEY,
    store,
    index: indexOf(rows),
    waitMs: 0,
    // no sibling frame here; the sibling guard is pinned in v2-212-still-persist-guard.test.ts
    guard: { mayWrite: () => true },
  });
  const put = (file: string) => ({
    dgn: 'still-put',
    file,
    artboard: 'ab1',
    sig: 's~t',
    bytes: vp8l(20, 20),
  });

  test("canvas B's frame cannot read canvas A's stills", async () => {
    const store = createStillStore({ backend: memoryStillBackend() });
    const fa = fakeFrame(`/_canvas-shell.html?canvas=ui/a.tsx`);
    const fb = fakeFrame(`/_canvas-shell.html?canvas=ui/b.tsx`);
    expect(await handleStillBridge(ev(put(A), fa.contentWindow), ctx(A, fa, store))).toBe('stored');
    // B is on screen and asks: it gets B's (none), never A's — whatever `file` it names
    expect(
      await handleStillBridge(
        ev({ dgn: 'stills-want', file: B }, fb.contentWindow),
        ctx(B, fb, store)
      )
    ).toBe('answered');
    expect(fb.posted).toEqual([{ dgn: 'stills', file: B, items: [] }]);
    expect(
      await handleStillBridge(
        ev({ dgn: 'stills-want', file: A }, fb.contentWindow),
        ctx(B, fb, store)
      )
    ).toBe('refused');
    // A's own window while B is active: refused (not the active frame)
    expect(
      await handleStillBridge(
        ev({ dgn: 'stills-want', file: A }, fa.contentWindow),
        ctx(B, fb, store)
      )
    ).toBe('refused');
    expect(fb.posted.length).toBe(1);
    expect(fa.posted.length).toBe(0);
    // A again on screen: its still is there
    await handleStillBridge(
      ev({ dgn: 'stills-want', file: A }, fa.contentWindow),
      ctx(A, fa, store)
    );
    expect((fa.posted[0] as { items: unknown[] }).items.length).toBe(1);
  });

  test("canvas B's frame cannot write canvas A's stills", async () => {
    const store = createStillStore({ backend: memoryStillBackend() });
    const fb = fakeFrame(`/_canvas-shell.html?canvas=ui/b.tsx`);
    expect(await handleStillBridge(ev(put(A), fb.contentWindow), ctx(B, fb, store))).toBe(
      'refused'
    );
    expect(
      await handleStillBridge(ev(put(B), fb.contentWindow, 'http://evil.test'), ctx(B, fb, store))
    ).toBe('refused');
    expect((await store.stats()).n).toBe(0);
  });

  test('a version view, an embed or a capture of the canvas stores and answers nothing', async () => {
    const store = createStillStore({ backend: memoryStillBackend() });
    for (const q of ['sha=abc&ro=1', 'embed=1', 'follow=1', 'hide-chrome=1', 'thumbnail=1']) {
      const f = fakeFrame(`/_canvas-shell.html?canvas=ui/a.tsx&${q}`);
      expect(await handleStillBridge(ev(put(A), f.contentWindow), ctx(A, f, store))).toBe(
        'refused'
      );
    }
    expect((await store.stats()).n).toBe(0);
  });

  test("the key is the shell's: project, the frame capability, the index source — the frame names none", () => {
    const k = stillKeyFor(rows, { activePath: A, designRel: '.design', frameKey: FRAME_KEY });
    expect(k).toEqual({
      pid: 'pid-1',
      scope: stillScopeOf(frameCapFor(FRAME_KEY, 'ui/a.tsx') as string),
      src: 'ha:-:d',
    });
    // another person's key → another scope
    const other = stillKeyFor(rows, {
      activePath: A,
      designRel: '.design',
      frameKey: Buffer.alloc(32, 3).toString('base64url'),
    });
    expect(other?.scope).not.toBe(k?.scope);
    expect(
      stillKeyFor(rows, {
        activePath: '.design/ui/none.tsx',
        designRel: '.design',
        frameKey: FRAME_KEY,
      })
    ).toBeNull();
    expect(
      stillKeyFor(null, { activePath: A, designRel: '.design', frameKey: FRAME_KEY })
    ).toBeNull();
  });

  test('a changed canvas (new srcHash) gets none of its old stills', async () => {
    const store = createStillStore({ backend: memoryStillBackend() });
    const fa = fakeFrame(`/_canvas-shell.html?canvas=ui/a.tsx`);
    await handleStillBridge(ev(put(A), fa.contentWindow), ctx(A, fa, store));
    const changed = {
      ...ctx(A, fa, store),
      index: indexOf(snapshot([{ rel: 'ui/a.tsx', srcHash: 'ha2' }])),
    };
    await handleStillBridge(ev({ dgn: 'stills-want', file: A }, fa.contentWindow), changed);
    expect(fa.posted).toEqual([{ dgn: 'stills', file: A, items: [] }]);
    expect((await store.stats()).n).toBe(0);
  });
});

// ─── the canvas: seeds, adopt, reload ────────────────────────────────────────────────────────────────────
function fakeTarget(width: number, html = '<div>a</div>') {
  const attrs = new Map<string, string>();
  const article = {
    offsetWidth: width,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
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
function fakeEl(): HTMLElement {
  const el: Record<string, unknown> = {
    classList: { add() {} },
    style: {},
    setAttribute() {},
    parentNode: null,
    width: 10,
    height: 10,
    appendChild(c: { parentNode?: unknown }) {
      c.parentNode = el;
    },
    remove() {
      el.parentNode = null;
    },
  };
  return el as unknown as HTMLElement;
}
const blobOf = (size: number) => ({ size }) as unknown as Blob;

function rig() {
  const frames: Array<() => void> = [];
  const timers: Array<{ fn: () => void; due: number }> = [];
  let clock = 0;
  let takes = 0;
  let decodes = 0;
  const cache = new StillCache(1_000_000, {
    encode: async () => blobOf(100),
    decode: async () => {
      decodes += 1;
      return fakeEl();
    },
    objectUrl: { make: () => 'blob:x', revoke() {} },
  });
  const c = new StillController({
    now: () => clock,
    take: async () => {
      takes += 1;
      return fakeEl();
    },
    later: (fn, ms) => timers.push({ fn, due: clock + ms }),
    frame: (fn) => frames.push(fn),
    observe: null,
    info: () => ({ visible: true, weight: 500 }),
    painted: async () => {},
    makeSlot: fakeEl,
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
  return { c, cache, drawAll, takes: () => takes, decodes: () => decodes };
}

describe('canvas: a persisted still stands in only for the content it was drawn from', () => {
  test('a reload shows the persisted still before any drawing (restored from the seed, no take)', async () => {
    const r = rig();
    expect(r.cache.seed('a', blobOf(100), '<div>a</div>')).toBe(true);
    expect(r.c.hasStill('a')).toBe(false); // a seed is nobody's still until it is checked
    r.c.register('a', fakeTarget(1600));
    await r.drawAll();
    expect(r.c.viewOf('a')).toBe('still');
    expect(r.takes()).toBe(0);
    expect(r.decodes()).toBe(1);
  });

  test('the answer comes after the artboard mounted: it adopts the seed instead of drawing', async () => {
    const r = rig();
    r.c.register('a', fakeTarget(1600));
    r.cache.seed('a', blobOf(100), '<div>a</div>');
    r.c.adoptSeeds();
    await r.drawAll();
    expect(r.c.viewOf('a')).toBe('still');
    expect(r.takes()).toBe(0);
  });

  test('a seed whose content signature differs is not shown: the artboard is drawn', async () => {
    const r = rig();
    r.cache.seed('a', blobOf(100), '<div>OLD</div>');
    r.c.register('a', fakeTarget(1600, '<div>NEW</div>'));
    await r.drawAll();
    expect(r.decodes()).toBe(0);
    expect(r.takes()).toBe(1);
    expect(r.cache.hasSeed('a')).toBe(false);
  });

  test('only stills this document drew are offered, never a seed it was given', async () => {
    const r = rig();
    const offered: string[] = [];
    r.cache.onEncoded((id) => offered.push(id));
    r.cache.seed('a', blobOf(100), '<div>a</div>');
    r.c.register('a', fakeTarget(1600));
    r.c.register('b', fakeTarget(1600, '<div>b</div>'));
    await r.drawAll();
    expect(offered).toEqual(['b']);
  });
});

describe('canvas: the persist lane talks only to its shell, about its own canvas', () => {
  function fakeWin(search = '?canvas=ui/a.tsx') {
    const listeners = new Set<(e: MessageEvent) => void>();
    const toParent: Array<{ m: Record<string, unknown>; to: string }> = [];
    const parent = {
      postMessage: (m: Record<string, unknown>, to: string) => toParent.push({ m, to }),
    };
    const win = {
      parent,
      location: { search },
      addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
    } as unknown as Window;
    const deliver = (data: unknown, source: unknown, origin = ORIGIN) => {
      for (const fn of listeners) fn({ data, source, origin } as unknown as MessageEvent);
    };
    return { win, parent, toParent, deliver };
  }

  test('asks once; seeds only from its parent, for its file and style; puts go to the origin that answered', async () => {
    const r = rig();
    const w = fakeWin();
    startStillPersist(r.c, {
      win: w.win,
      file: '.design/ui/a.tsx',
      styleSig: () => 'S1',
      toBlob: (b) => blobOf(b.byteLength),
      bytesOf: async () => vp8l(20, 20),
    });
    expect(w.toParent.map((x) => x.m.dgn)).toEqual(['stills-want']);
    const item = (artboard: string, style: string) => ({
      artboard,
      sig: `<div>a</div>${STILL_STYLE_SEP}${style}`,
      bytes: vp8l(20, 20),
    });
    // another window (a sibling, the canvas itself) cannot seed
    w.deliver({ dgn: 'stills', file: '.design/ui/a.tsx', items: [item('x', 'S1')] }, {});
    expect(r.cache.hasSeed('x')).toBe(false);
    // another file's answer is ignored
    w.deliver({ dgn: 'stills', file: '.design/ui/b.tsx', items: [item('x', 'S1')] }, w.parent);
    expect(r.cache.hasSeed('x')).toBe(false);
    // its shell: a still of another style is not seeded
    w.deliver(
      { dgn: 'stills', file: '.design/ui/a.tsx', items: [item('a', 'S1'), item('b', 'S0')] },
      w.parent
    );
    expect(r.cache.hasSeed('a')).toBe(true);
    expect(r.cache.hasSeed('b')).toBe(false);
    r.c.register('c', fakeTarget(1600, '<div>c</div>'));
    await r.drawAll();
    await new Promise((res) => setTimeout(res, 0));
    const puts = w.toParent.filter((x) => x.m.dgn === 'still-put');
    expect(puts.map((x) => [x.m.artboard, x.to, x.m.sig])).toEqual([
      ['c', ORIGIN, `<div>c</div>${STILL_STYLE_SEP}S1`],
    ]);
  });

  test('a version view or an embed neither asks nor offers', () => {
    for (const q of ['?canvas=a&sha=1', '?canvas=a&embed=1', '?canvas=a&hide-chrome=1']) {
      const r = rig();
      const w = fakeWin(q);
      startStillPersist(r.c, { win: w.win, file: '.design/ui/a.tsx', styleSig: () => 'S' });
      expect(w.toParent).toEqual([]);
    }
  });
});
