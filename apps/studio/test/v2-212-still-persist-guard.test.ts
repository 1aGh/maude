// #212 §5 (T2.2 security follow-up) — the persisted stills behind the shell's guards.
// Contract: client/v2/contracts/212-still-cache.md §5. Pinned here:
//   - siblings: no still is stored while another canvas-origin frame is mounted, nor for the rest of the session
//     once one was (a sibling can run code in the active frame's realm); release builds expose no still globals;
//   - one answer per frame window; reads refresh the eviction order in one write, only for records not refreshed
//     lately; the answer's buffers are transferred;
//   - a canvas writes ≤ 2 MB a minute and holds ≤ 8 MB; its writes evict its own records first, so another
//     canvas's records go only by the project cap, oldest first;
//   - the key holds a SHA-256 of the frame capability, never the capability.
import { describe, expect, test } from 'bun:test';
import { STILL_DIAGNOSTICS, stillDiagnosticsOn } from '../artboard-live-gate.tsx';
import { STILL_PERSIST_MAX_BYTES } from '../bridge/still-webp.ts';
import { frameCapFor } from '../client/frame-cap.js';
import {
  createSiblingGuard,
  handleStillBridge,
  stillKeyFor,
  stillScopeOf,
} from '../client/v2/shell/still-bridge.js';
import {
  createStillStore,
  memoryStillBackend,
  STILL_BYTES_PER_MINUTE,
  STILL_CANVAS_MAX_BYTES,
  STILL_PROJECT_MAX_BYTES,
  STILL_TOUCH_AFTER_MS,
} from '../client/v2/shell/still-store.js';
import { canvasDefines } from '../release-build.ts';

function le32(n: number) {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}
/** A lossless (VP8L) still header of w × h with `extra` payload bytes (never decoded). */
function vp8l(w: number, h: number, extra = 8): ArrayBuffer {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  const data = [0x2f, ...le32(bits), ...new Array(extra).fill(7)];
  const pad = data.length % 2 ? [0] : [];
  const body = [
    ...Buffer.from('WEBP'),
    ...Buffer.from('VP8L'),
    ...le32(data.length),
    ...data,
    ...pad,
  ];
  return new Uint8Array([...Buffer.from('RIFF'), ...le32(body.length), ...body]).buffer;
}
/** A still of about `n` bytes. */
const stillOf = (n: number) => vp8l(10, 10, n - 40);

const ORIGIN = 'http://127.0.0.1:5001';
const SHELL = 'http://127.0.0.1:5000/';
const FRAME_KEY = Buffer.alloc(32, 9).toString('base64url');
const A = '.design/ui/a.tsx';

type FakeFrame = {
  nodeName: 'IFRAME';
  src: string;
  contentWindow: Window;
  getAttribute: (k: string) => string | null;
  posted: unknown[];
  transfers: unknown[][];
};
function fakeFrame(src: string): FakeFrame {
  const posted: unknown[] = [];
  const transfers: unknown[][] = [];
  const win = {
    postMessage: (m: unknown, _o: string, t?: unknown[]) => {
      posted.push(m);
      transfers.push(t ?? []);
    },
  } as unknown as Window;
  return {
    nodeName: 'IFRAME',
    src,
    contentWindow: win,
    getAttribute: (k) => (k === 'src' ? src : null),
    posted,
    transfers,
  };
}
/** A shell document with its iframes, and a MutationObserver the test fires by hand. */
function fakeDoc() {
  const frames: FakeFrame[] = [];
  let cb: ((records: unknown[]) => void) | null = null;
  class Observer {
    constructor(fn: (records: unknown[]) => void) {
      cb = fn;
    }
    observe() {}
    disconnect() {
      cb = null;
    }
  }
  const doc = { baseURI: SHELL, querySelectorAll: () => [...frames] };
  return {
    doc,
    Observer,
    mount(f: FakeFrame) {
      frames.push(f);
      cb?.([{ type: 'childList', addedNodes: [f] }]);
    },
    unmount(f: FakeFrame) {
      frames.splice(frames.indexOf(f), 1);
      cb?.([{ type: 'childList', removedNodes: [f], addedNodes: [] }]);
    },
  };
}
const rows = {
  pid: 'pid-1',
  canvases: [
    { rel: 'ui/a.tsx', srcHash: 'ha', metaHash: null, depsHash: 'd' },
    { rel: 'ui/b.tsx', srcHash: 'hb', metaHash: null, depsHash: 'd' },
  ],
};
const index = { get: () => rows, subscribe: () => () => {} };
const ev = (data: unknown, source: unknown) =>
  ({ data, source, origin: ORIGIN }) as unknown as MessageEvent;
const put = (artboard = 'ab1') => ({
  dgn: 'still-put',
  file: A,
  artboard,
  sig: 's~t',
  bytes: vp8l(20, 20),
});
const frameSrc = (rel: string, q = '') => `${ORIGIN}/_canvas-shell.html?canvas=${rel}${q}`;

describe('F1: no still is stored while a sibling canvas frame can reach the active one', () => {
  const setup = () => {
    const d = fakeDoc();
    const guard = createSiblingGuard({ doc: d.doc, Observer: d.Observer });
    const store = createStillStore({ backend: memoryStillBackend() });
    const fa = fakeFrame(frameSrc('ui/a.tsx'));
    d.mount(fa);
    const ctx = {
      canvasOrigin: ORIGIN,
      activePath: A,
      frame: fa,
      designRel: '.design',
      frameKey: FRAME_KEY,
      store,
      index,
      waitMs: 0,
      guard,
    };
    return { d, guard, store, fa, ctx };
  };

  test('alone on the canvas origin: stored', async () => {
    const { fa, ctx, store } = setup();
    expect(await handleStillBridge(ev(put(), fa.contentWindow), ctx)).toBe('stored');
    expect((await store.stats()).n).toBe(1);
  });

  test('a kept-alive tab beside it: refused', async () => {
    const { d, fa, ctx, store } = setup();
    d.mount(fakeFrame(frameSrc('ui/b.tsx')));
    expect(await handleStillBridge(ev(put(), fa.contentWindow), ctx)).toBe('siblings');
    expect((await store.stats()).n).toBe(0);
  });

  test('any frame on the canvas origin counts (a gallery thumbnail, a version view)', async () => {
    for (const q of ['&thumbnail=1&comments=0', '&sha=abc&ro=1', '&embed=1']) {
      const { d, fa, ctx } = setup();
      d.mount(fakeFrame(frameSrc('ui/b.tsx', q)));
      expect(await handleStillBridge(ev(put(), fa.contentWindow), ctx)).toBe('siblings');
    }
  });

  test('a sibling that came and went: nothing is stored for the rest of the session', async () => {
    const { d, fa, ctx, store } = setup();
    const fb = fakeFrame(frameSrc('ui/b.tsx'));
    d.mount(fb);
    d.unmount(fb);
    expect(await handleStillBridge(ev(put(), fa.contentWindow), ctx)).toBe('siblings');
    // a frame mounted later, alone, is not trusted either: the origin's state outlived the sibling
    d.unmount(fa);
    const fa2 = fakeFrame(frameSrc('ui/a.tsx'));
    d.mount(fa2);
    expect(await handleStillBridge(ev(put(), fa2.contentWindow), { ...ctx, frame: fa2 })).toBe(
      'siblings'
    );
    expect((await store.stats()).n).toBe(0);
  });

  test('a frame of another origin is not a sibling; no guard at all stores nothing', async () => {
    const { d, fa, ctx } = setup();
    d.mount(fakeFrame('http://127.0.0.1:5000/_diff.html'));
    expect(await handleStillBridge(ev(put(), fa.contentWindow), ctx)).toBe('stored');
    expect(await handleStillBridge(ev(put('ab2'), fa.contentWindow), { ...ctx, guard: null })).toBe(
      'siblings'
    );
  });

  test('reads still answer while siblings are mounted (the frame could read its own DOM anyway)', async () => {
    const { d, fa, ctx } = setup();
    expect(await handleStillBridge(ev(put(), fa.contentWindow), ctx)).toBe('stored');
    d.mount(fakeFrame(frameSrc('ui/b.tsx')));
    expect(
      await handleStillBridge(ev({ dgn: 'stills-want', file: A }, fa.contentWindow), ctx)
    ).toBe('answered');
  });

  test('a release build exposes no still globals; a canvas build is told it is one', () => {
    expect(stillDiagnosticsOn(true)).toBe(false);
    expect(stillDiagnosticsOn(false)).toBe(true);
    expect(STILL_DIAGNOSTICS).toContain('__maudeStillCache');
    expect(canvasDefines(true)).toEqual({ __MAUDE_RELEASE_BUILD__: 'true' });
    expect(canvasDefines(false)).toEqual({});
  });
});

describe('F2: the shell answers a frame once, cheaply', () => {
  const setup = () => {
    const d = fakeDoc();
    const guard = createSiblingGuard({ doc: d.doc, Observer: d.Observer });
    const fa = fakeFrame(frameSrc('ui/a.tsx'));
    d.mount(fa);
    return { d, guard, fa };
  };

  test('a second stills-want from the same frame window gets nothing', async () => {
    const { guard, fa } = setup();
    const store = createStillStore({ backend: memoryStillBackend() });
    const ctx = {
      canvasOrigin: ORIGIN,
      activePath: A,
      frame: fa,
      designRel: '.design',
      frameKey: FRAME_KEY,
      store,
      index,
      waitMs: 0,
      guard,
    };
    const want = ev({ dgn: 'stills-want', file: A }, fa.contentWindow);
    expect(await handleStillBridge(want, ctx)).toBe('answered');
    for (let i = 0; i < 5; i++) expect(await handleStillBridge(want, ctx)).toBe('once');
    expect(fa.posted.length).toBe(1);
  });

  test('the answer transfers its buffers', async () => {
    const { guard, fa } = setup();
    const store = createStillStore({ backend: memoryStillBackend() });
    const ctx = {
      canvasOrigin: ORIGIN,
      activePath: A,
      frame: fa,
      designRel: '.design',
      frameKey: FRAME_KEY,
      store,
      index,
      waitMs: 0,
      guard,
    };
    await handleStillBridge(ev(put('x'), fa.contentWindow), ctx);
    await handleStillBridge(ev(put('y'), fa.contentWindow), ctx);
    await handleStillBridge(ev({ dgn: 'stills-want', file: A }, fa.contentWindow), ctx);
    const items = (fa.posted[0] as { items: Array<{ bytes: ArrayBuffer }> }).items;
    expect(items.length).toBe(2);
    expect(fa.transfers[0]).toEqual(items.map((i) => i.bytes));
    // the store's copy is untouched by the transfer
    expect(
      (
        await store.list(
          stillKeyFor(rows, { activePath: A, designRel: '.design', frameKey: FRAME_KEY }) as never
        )
      ).length
    ).toBe(2);
  });

  test('reads refresh the eviction order in one write, only for records not refreshed lately', async () => {
    let t = 1_000_000;
    const backend = memoryStillBackend();
    const calls: number[] = [];
    const touch = backend.touch.bind(backend);
    backend.touch = async (ms: unknown[]) => {
      calls.push(ms.length);
      return touch(ms as never);
    };
    const store = createStillStore({ backend, now: () => t });
    const key = { pid: 'p', scope: 's', src: 'h' };
    for (const a of ['a', 'b', 'c'])
      await store.put({ ...key, artboard: a, sig: 's', bytes: vp8l(10, 10) });
    await store.list(key);
    expect(calls).toEqual([]); // just written: nothing to refresh
    t += STILL_TOUCH_AFTER_MS + 1;
    await store.list(key);
    expect(calls).toEqual([3]); // one write for the three
    await store.list(key);
    expect(calls).toEqual([3]); // refreshed a moment ago
  });
});

describe('F3/F4: one canvas cannot churn the disk or flush another canvas', () => {
  const key = { pid: 'p', src: 'h' };
  const big = STILL_PERSIST_MAX_BYTES - 1024;

  test('a canvas writes at most 2 MB a minute', async () => {
    let t = 0;
    const store = createStillStore({ backend: memoryStillBackend(), now: () => t });
    let ok = 0;
    for (let i = 0; i < 40; i++)
      if (await store.put({ ...key, scope: 'x', artboard: `a${i}`, sig: 's', bytes: stillOf(big) }))
        ok += 1;
    expect(ok).toBe(Math.floor(STILL_BYTES_PER_MINUTE / big));
    // another canvas has its own minute
    expect(
      await store.put({ ...key, scope: 'y', artboard: 'a', sig: 's', bytes: stillOf(big) })
    ).toBe(true);
    t += 60_001;
    expect(
      await store.put({ ...key, scope: 'x', artboard: 'later', sig: 's', bytes: stillOf(big) })
    ).toBe(true);
  });

  test("a canvas holds at most its 8 MB share, and its writes never evict another canvas's records", async () => {
    let t = 0;
    const store = createStillStore({ backend: memoryStillBackend(), now: () => (t += 61_000) });
    await store.put({ ...key, scope: 'victim', artboard: 'v', sig: 's', bytes: stillOf(1000) });
    for (let i = 0; i < 140; i++)
      await store.put({ ...key, scope: 'burst', artboard: `b${i}`, sig: 's', bytes: stillOf(big) });
    const burst = await store.list({ ...key, scope: 'burst' });
    const bytes = burst.reduce((n, x) => n + x.bytes.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(STILL_CANVAS_MAX_BYTES);
    expect(burst.map((x) => x.artboard)).toContain('b139');
    expect((await store.list({ ...key, scope: 'victim' })).map((x) => x.artboard)).toEqual(['v']);
  });

  test("over the project cap the writer's own records go first, then the oldest of the others", async () => {
    let t = 0;
    const store = createStillStore({ backend: memoryStillBackend(), now: () => (t += 61_000) });
    const share = Math.floor(STILL_CANVAS_MAX_BYTES / big); // records a full canvas holds
    // the others fill the project but for three records
    let left = Math.floor(STILL_PROJECT_MAX_BYTES / big) - 3;
    const scopes: string[] = [];
    for (let c = 0; left > 0; c++) {
      scopes.push(`c${c}`);
      for (let i = 0; i < share && left > 0; i++, left--)
        await store.put({
          ...key,
          scope: `c${c}`,
          artboard: `a${i}`,
          sig: 's',
          bytes: stillOf(big),
        });
    }
    const count = async (scope: string) => (await store.list({ ...key, scope })).length;
    const before = await Promise.all(scopes.map(count));
    // the last canvas writes more than the project has left: it pays with its own oldest
    for (let i = 0; i < 10; i++)
      await store.put({ ...key, scope: 'w', artboard: `w${i}`, sig: 's', bytes: stillOf(big) });
    expect((await store.stats()).bytes).toBeLessThanOrEqual(STILL_PROJECT_MAX_BYTES);
    const w = (await store.list({ ...key, scope: 'w' })).map((x) => x.artboard).sort();
    expect(w).toEqual(['w7', 'w8', 'w9']);
    expect(await Promise.all(scopes.map(count))).toEqual(before);
  });
});

describe('defender #4: the key never holds the frame capability', () => {
  test('scope = SHA-256 of the capability (64 hex), the same for the same frame, another for another', () => {
    const cap = frameCapFor(FRAME_KEY, 'ui/a.tsx') as string;
    const k = stillKeyFor(rows, { activePath: A, designRel: '.design', frameKey: FRAME_KEY });
    expect(k?.scope).toMatch(/^[0-9a-f]{64}$/);
    expect(k?.scope).toBe(stillScopeOf(cap));
    expect(k?.scope).not.toContain(cap);
    const other = stillKeyFor(rows, {
      activePath: A,
      designRel: '.design',
      frameKey: Buffer.alloc(32, 3).toString('base64url'),
    });
    expect(other?.scope).not.toBe(k?.scope);
    // without a frame key (the origin split off) the path is hashed too
    const plain = stillKeyFor(rows, { activePath: A, designRel: '.design', frameKey: undefined });
    expect(plain?.scope).toMatch(/^[0-9a-f]{64}$/);
    expect(plain?.scope).not.toContain('ui/a.tsx');
  });

  test('records of the first shape (keyed on the plain capability) are dropped from disk', async () => {
    const backend = memoryStillBackend();
    const cap = frameCapFor(FRAME_KEY, 'ui/a.tsx') as string;
    const k = `p\0${cap}\0ab`;
    backend._raw(
      { k, pid: 'p', scope: cap, artboard: 'ab', src: 'h', sig: 's', size: 60, at: 1 },
      vp8l(10, 10)
    );
    const store = createStillStore({ backend });
    expect(await store.list({ pid: 'p', scope: cap, src: 'h' })).toEqual([]);
    expect(backend._keys()).toEqual([]);
  });
});
