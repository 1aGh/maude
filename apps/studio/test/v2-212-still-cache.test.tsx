// #212 (2.0.8) — a drawn still must never flash back to blank. Pinned here:
//   - §4: a still evicted from the decoded tier comes back as a still when its artboard re-enters the overview
//     (restored from the encoded tier, never drawn again, never a blank);
//   - §2: two tiers — an encoded one that the decoded LRU never touches (its own byte cap, oldest first) and a
//     decoded LRU on top; restoring decodes from the encoded tier;
//   - §1: stills are drawn at 200 px × the device pixel ratio (≤ 2), no headroom: 400 at most;
//   - §3: a released artboard's placeholder holds the cache's own still element (no second canvas).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { STILL_ATTR, StillCache, StillController } from '../artboard-still.ts';
import { stillWidthPx } from '../artboard-still-raster.ts';

function fakeTarget(width: number) {
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
    innerHTML: '<div>a</div>',
    style: { setProperty() {} },
  } as unknown as HTMLElement;
  return { article, body, attr: () => attrs.get(STILL_ATTR) ?? null };
}
let elId = 0;
function fakeEl(): HTMLElement {
  const el: Record<string, unknown> = {
    n: ++elId,
    classList: { add() {} },
    style: {},
    setAttribute() {},
    parentNode: null,
    appendChild(c: { parentNode?: unknown }) {
      c.parentNode = el;
    },
    remove() {
      el.parentNode = null;
    },
  };
  return el as unknown as HTMLElement;
}
const blobOf = (size: number, tag = '') => ({ size, tag }) as unknown as Blob;
/** An encoder that always works (100 bytes) and a decoder that makes a fresh element. */
function codec(encodedMax = 1_000_000, size = 100, max = 2500) {
  let decodes = 0;
  const cache = new StillCache(max, {
    encodedMax,
    encode: async () => blobOf(size),
    decode: async () => {
      decodes += 1;
      return fakeEl();
    },
    objectUrl: { make: () => 'blob:x', revoke() {} },
  });
  return { cache, decodes: () => decodes };
}
const settleTasks = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('§1 the still is 200 px × dpr, no headroom', () => {
  test('400 px at dpr 2 (and above), 200 at dpr 1', () => {
    expect(stillWidthPx(2)).toBe(400);
    expect(stillWidthPx(3)).toBe(400);
    expect(stillWidthPx(1)).toBe(200);
  });
});

describe('§2 the two-tier cache', () => {
  test('a still pushed out of the decoded tier stays known: the encoded tier keeps it', async () => {
    const { cache } = codec();
    const none = () => false;
    cache.set('a', fakeEl(), 'sa', 1000, none);
    cache.set('b', fakeEl(), 'sb', 1000, none);
    await settleTasks();
    cache.set('c', fakeEl(), 'sc', 1000, none); // 3000 > 2500: the LRU 'a' leaves the decoded tier
    await settleTasks();
    expect(cache.ids().sort()).toEqual(['a', 'b', 'c']);
    const a = cache.peek('a');
    expect(a?.el).toBeNull();
    expect(a?.sig).toBe('sa');
    expect(cache.stats().bytes).toBe(2000); // decoded only
    expect(cache.stats().encoded).toBe(3);
    expect(cache.stats().encodedBytes).toBe(300);
  });

  test('the decoded LRU never touches the encoded tier; only its own cap drops (oldest first)', async () => {
    const { cache } = codec(250); // two blobs of 100 fit
    const none = () => false;
    for (const k of ['a', 'b', 'c']) {
      cache.set(k, fakeEl(), `s${k}`, 1000, none);
      await settleTasks();
    }
    expect(cache.ids().sort()).toEqual(['b', 'c']); // 'a' was the oldest
    expect(cache.stats().encodedBytes).toBe(200);
  });

  test('restore decodes from the encoded tier, counts in the decoded LRU, and is one element', async () => {
    const { cache, decodes } = codec();
    const none = () => false;
    cache.set('a', fakeEl(), 'sa', 1000, none);
    cache.set('b', fakeEl(), 'sb', 1000, none);
    await settleTasks();
    cache.set('c', fakeEl(), 'sc', 1000, none);
    await settleTasks();
    expect(cache.peek('a')?.el).toBeNull();
    const [x, y] = await Promise.all([cache.restore('a'), cache.restore('a')]);
    expect(x).not.toBeNull();
    expect(y).toBe(x); // a second ask while decoding shares the decode
    expect(decodes()).toBe(1);
    expect(cache.peek('a')?.el).toBe(x);
    expect(await cache.restore('nope')).toBeNull();
    expect(cache.stats().bytes).toBeLessThanOrEqual(2500 + 1000); // the LRU made room (b left)
  });

  test('a still without an encoder leaves for good when the decoded tier drops it (nothing to restore from)', () => {
    const cache = new StillCache(2500);
    cache.set('a', fakeEl(), 's', 1000, () => false);
    cache.set('b', fakeEl(), 's', 1000, () => false);
    cache.set('c', fakeEl(), 's', 1000, () => false);
    expect(cache.ids().sort()).toEqual(['b', 'c']);
  });
});

describe('§4 an evicted still comes back as a still', () => {
  function rig() {
    const timers: Array<{ fn: () => void; due: number }> = [];
    const frames: Array<() => void> = [];
    let clock = 0;
    let takes = 0;
    const t: Record<string, ReturnType<typeof fakeTarget>> = {};
    const { cache, decodes } = codec();
    const views: Array<[string, string]> = [];
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
      onView: (id, v) => views.push([id, v]),
    });
    const add = (id: string) => {
      t[id] = fakeTarget(1600);
      return c.register(id, t[id], {});
    };
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
    return { c, add, drawAll, takes: () => takes, cache, decodes, views, t };
  }

  test('released, pushed out of the decoded tier, then back under the cut: its still, not drawn again', async () => {
    const r = rig();
    r.c.noteZoom(0.1);
    r.c.settle(0.1);
    r.c.setZoom(0.1);
    const offA = r.add('a');
    await r.drawAll();
    offA();
    const offB = r.add('b');
    await r.drawAll();
    offB();
    r.add('c');
    await r.drawAll();
    expect(r.takes()).toBe(3);
    expect(r.cache.peek('a')?.el).toBeNull(); // 'a' left the decoded tier
    expect(r.c.hasStill('a')).toBe(true); // …but a still of it exists
    r.views.length = 0;
    r.add('a'); // its artboard re-enters the overview
    await r.drawAll();
    expect(r.c.viewOf('a')).toBe('still');
    expect(r.takes()).toBe(3); // restored, not drawn again
    expect(r.decodes()).toBe(1);
    expect(r.t.a?.attr()).toBe('still');
    // it never went live (a hand-over) nor stayed a cover
    expect(r.views.filter(([k]) => k === 'a').map(([, v]) => v)).not.toContain('live');
  });
});

describe('§3 mounted: the placeholder of a released artboard holds the cache element itself', () => {
  let lib: typeof import('../canvas-lib.tsx');
  let gate: typeof import('../artboard-live-gate.tsx');
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
    lib = await import('../canvas-lib.tsx');
    gate = await import('../artboard-live-gate.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    gate.resetArtboardLive();
  });

  test('one canvas in the placeholder, and it is the cached one', async () => {
    window.happyDOM.setURL('http://localhost/?artboard-live=sleep&artboard-still=on');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const tree = (label: string) => (
      <lib.DesignCanvas>
        <lib.DCSection id="s" title="S">
          <lib.DCArtboard id="a0" label={label} width={1600} height={900} background="#fafafa">
            <div data-body="a0" />
          </lib.DCArtboard>
        </lib.DCSection>
      </lib.DesignCanvas>
    );
    await act(async () => root.render(tree('one')));
    const getCache = (window as unknown as { __maudeStillCache?: () => StillCache | undefined })
      .__maudeStillCache;
    const cache = getCache?.();
    expect(cache === undefined).toBe(false);
    const el = document.createElement('canvas');
    el.width = 10;
    el.height = 10;
    cache?.set('a0', el, 's', 400, () => false);
    await act(async () => root.render(tree('two')));
    const ph = host.querySelector('.dc-artboard-sleeping');
    expect(ph === null).toBe(false);
    expect(ph?.querySelectorAll('canvas').length).toBe(1);
    expect(ph?.contains(el)).toBe(true); // a boolean: a failed DOM compare would try to print the tree
    await act(async () => root.unmount());
    host.remove();
  });
});
