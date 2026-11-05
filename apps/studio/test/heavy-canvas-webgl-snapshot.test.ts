// 2.0.5 — what a sleeping WebGL artboard shows. Blink paints its own lost-context icon over a lost WebGL
// canvas (a CSS background under it never shows), so the last frame lives in an overlay ABOVE the canvas
// and the canvas is hidden while lost. An artboard that was never awake (a heavy canvas opened zoomed out)
// gets its first frame read one context at a time, inside the cap — or a placeholder with its name.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

type Budget = import('../artboard-webgl.ts').WebglBudget;

describe('WebGL budget — the sleeping picture', () => {
  let WebglBudget: typeof import('../artboard-webgl.ts').WebglBudget;
  beforeAll(async () => {
    GlobalRegistrator.register();
    ({ WebglBudget } = await import('../artboard-webgl.ts'));
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  /** A manual frame clock: `tick()` runs one animation frame. */
  function clock() {
    let q: (() => void)[] = [];
    return {
      frame: (fn: () => void) => {
        q.push(fn);
      },
      async tick(n = 1) {
        for (let i = 0; i < n; i++) {
          const run = q;
          q = [];
          for (const fn of run) fn();
          await new Promise((r) => setTimeout(r, 0));
          await new Promise((r) => setTimeout(r, 0));
        }
      },
    };
  }

  /** A fake page: one artboard + one canvas per id, a fake context that counts live contexts. */
  function page(b: () => Budget) {
    const lost = new Map<HTMLCanvasElement, boolean>();
    let liveNow = 0;
    let maxLive = 0;
    const canvases: Record<string, HTMLCanvasElement> = {};
    const mk = (id: string, x: number) => {
      const board = document.createElement('article');
      board.setAttribute('data-dc-screen', id);
      const label = document.createElement('header');
      label.className = 'dc-artboard-label';
      label.textContent = `Scene ${id}`;
      const body = document.createElement('div');
      body.className = 'dc-artboard-body';
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 100;
      c.getBoundingClientRect = () => ({ left: x, top: 0, width: 10, height: 10 }) as DOMRect;
      body.append(c);
      board.append(label, body);
      document.body.append(board);
      lost.set(c, false);
      liveNow += 1;
      maxLive = Math.max(maxLive, liveNow);
      // Like the browsers: the loss event comes later (a task), and restoreContext() does nothing unless
      // that event came and was cancelled.
      let restorable = false;
      const gl = {
        getExtension: () => ({
          loseContext: () => {
            if (lost.get(c)) return;
            lost.set(c, true);
            liveNow -= 1;
            restorable = false;
            setTimeout(() => {
              const ev = new Event('webglcontextlost', { cancelable: true });
              c.dispatchEvent(ev);
              restorable = ev.defaultPrevented;
            }, 0);
          },
          restoreContext: () => {
            if (!lost.get(c) || !restorable) return;
            restorable = false;
            lost.set(c, false);
            liveNow += 1;
            maxLive = Math.max(maxLive, liveNow);
            setTimeout(() => c.dispatchEvent(new Event('webglcontextrestored')), 0);
          },
        }),
      };
      canvases[id] = c;
      b().track(c, gl as unknown as WebGLRenderingContext);
      return c;
    };
    return {
      mk,
      lost,
      canvases,
      get maxLive() {
        return maxLive;
      },
      get liveNow() {
        return liveNow;
      },
    };
  }

  const overlayOf = (c: HTMLCanvasElement) => {
    const o = c.nextElementSibling as HTMLElement | null;
    return o?.hasAttribute('data-dc-gl-snapshot') ? o : null;
  };

  test('a slept context shows its last frame in an overlay above the canvas, which is hidden while lost', async () => {
    const k = clock();
    const live = new Set(['a', 'b']);
    let b: Budget | null = null;
    b = new WebglBudget((id) => (id ? live.has(id) : true), 1, {
      frame: k.frame,
      primeGapMs: 0,
      readFrame: (c) =>
        `data:image/png;base64,FRAME-${c.closest('[data-dc-screen]')?.getAttribute('data-dc-screen')}`,
    });
    const p = page(() => b as Budget);
    const a = p.mk('a', 0);
    const far = p.mk('b', 2000);
    b.apply();
    await k.tick(3);
    expect(p.lost.get(far)).toBe(true);
    expect(p.lost.get(a)).toBe(false);
    // The canvas itself is hidden (Blink's lost-context icon cannot paint) and carries no snapshot.
    expect(far.style.visibility).toBe('hidden');
    expect(far.style.backgroundImage).toBe('');
    const o = overlayOf(far);
    expect(o).not.toBeNull();
    expect(o?.getAttribute('data-dc-gl-snapshot')).toBe('frame');
    expect(o?.style.backgroundImage).toContain('FRAME-b');
    expect(o?.style.position).toBe('absolute');
    expect(o?.style.pointerEvents).toBe('none');
    expect(overlayOf(a)).toBeNull();
    expect(a.style.visibility).toBe('');

    // Wake it: the overlay stays until the page has drawn again, then goes; the canvas shows again.
    live.delete('a');
    b.apply();
    await k.tick(4);
    expect(p.lost.get(far)).toBe(false);
    expect(overlayOf(far)).toBeNull();
    expect(far.style.visibility).toBe('');
    expect(overlayOf(a)?.getAttribute('data-dc-gl-snapshot')).toBe('frame');
    expect(a.style.visibility).toBe('hidden');
  });

  test('a context asked back before its loss event arrived is restored when the event comes', async () => {
    const k = clock();
    let b: Budget | null = null;
    b = new WebglBudget(() => true, 1, {
      frame: k.frame,
      primeGapMs: 0,
      readFrame: () => 'data:image/png;base64,X',
    });
    const p = page(() => b as Budget);
    const near = p.mk('a', 500);
    // Created past the cap in the same task: the OLDER one (the nearest) is released at once, and the plan
    // (a microtask later) wants it back — before its loss event has even been dispatched.
    const far = p.mk('b', 5000);
    expect(p.lost.get(near)).toBe(true);
    await k.tick(4);
    expect(p.lost.get(near)).toBe(false);
    expect(p.lost.get(far)).toBe(true);
    expect(overlayOf(near)).toBeNull();
  });

  test('a canvas that mounts many contexts at once never holds more than the cap live', async () => {
    const k = clock();
    let b: Budget | null = null;
    b = new WebglBudget(() => false, 2, {
      frame: k.frame,
      primeGapMs: 0,
      readFrame: () => 'data:image/png;base64,X',
    });
    const p = page(() => b as Budget);
    // One React commit mounts every artboard: all six getContext calls happen before any microtask. The
    // browser drops the oldest context for good past its own limit, so the budget must release one as each
    // new one is created (only the context being created can be one over).
    let peak = 0;
    for (let i = 0; i < 6; i++) {
      p.mk(`s${i}`, i * 100);
      peak = Math.max(peak, p.liveNow);
    }
    expect(peak).toBeLessThanOrEqual(2);
    expect(p.maxLive).toBeLessThanOrEqual(3);
  });

  test('never-awake artboards get their first frame read one at a time, within the cap', async () => {
    const k = clock();
    const p = { ref: null as ReturnType<typeof page> | null };
    let b: Budget | null = null;
    // The page draws only while its context is live: a frame exists once a context was restored.
    b = new WebglBudget(() => false, 3, {
      frame: k.frame,
      primeGapMs: 0,
      readFrame: (c) =>
        p.ref?.lost.get(c)
          ? null
          : `data:image/png;base64,F-${c.closest('[data-dc-screen]')?.getAttribute('data-dc-screen')}`,
    });
    p.ref = page(() => b as Budget);
    const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
    let peak = 0;
    for (const [i, id] of ids.entries()) {
      p.ref.mk(id, i * 100);
      peak = Math.max(peak, p.ref.liveNow);
    }
    expect(peak).toBeLessThanOrEqual(3);
    // Opened zoomed out: nothing is live, so every context is released — and the never-awake ones are
    // restored ONE at a time to read a first frame.
    await k.tick(3);
    let primingPeak = 0;
    for (let i = 0; i < 120; i++) {
      await k.tick();
      primingPeak = Math.max(primingPeak, p.ref.liveNow);
    }
    expect(primingPeak).toBe(1);
    for (const id of ids) {
      const c = p.ref.canvases[id] as HTMLCanvasElement;
      expect(p.ref.lost.get(c)).toBe(true);
      expect(c.style.visibility).toBe('hidden');
      expect(overlayOf(c)?.getAttribute('data-dc-gl-snapshot')).toBe('frame');
      expect(overlayOf(c)?.style.backgroundImage).toContain(`F-${id}`);
    }
    expect(p.ref.liveNow).toBe(0);
  });

  test('an artboard that never draws sleeps as a placeholder with its name, not a blank box', async () => {
    const k = clock();
    let b: Budget | null = null;
    b = new WebglBudget(() => false, 2, { frame: k.frame, primeGapMs: 0, readFrame: () => null });
    const p = page(() => b as Budget);
    for (let i = 0; i < 4; i++) p.mk(`s${i}`, i * 100);
    await k.tick(200);
    for (let i = 0; i < 4; i++) {
      const c = p.canvases[`s${i}`] as HTMLCanvasElement;
      const o = overlayOf(c);
      expect(o?.getAttribute('data-dc-gl-snapshot')).toBe('placeholder');
      expect(o?.textContent).toBe(`Scene s${i}`);
      expect(c.style.visibility).toBe('hidden');
    }
    expect(p.liveNow).toBe(0);
  });

  test('a page that stops drawing once asleep sleeps with the frame kept while it was live', async () => {
    const k = clock();
    const live = new Set(['a']);
    let drawing = true;
    let b: Budget | null = null;
    b = new WebglBudget((id) => (id ? live.has(id) : true), 2, {
      frame: k.frame,
      primeGapMs: 0,
      // A page gated on useArtboardActive(): nothing fresh to read once its artboard sleeps.
      readFrame: () => null,
      keeper: () => {
        let kept: string | null = null;
        return {
          copy: (c) => {
            if (!drawing) return false;
            kept = `data:image/png;base64,KEPT-${c.closest('[data-dc-screen]')?.getAttribute('data-dc-screen')}`;
            return true;
          },
          url: () => kept,
        };
      },
    });
    const p = page(() => b as Budget);
    const c = p.mk('a', 0);
    b.apply();
    await k.tick(30);
    drawing = false;
    live.delete('a');
    b.apply();
    await k.tick(12);
    expect(p.lost.get(c)).toBe(true);
    expect(overlayOf(c)?.getAttribute('data-dc-gl-snapshot')).toBe('frame');
    expect(overlayOf(c)?.style.backgroundImage).toContain('KEPT-a');
  });

  test('an overlay goes when its canvas unmounts', async () => {
    const k = clock();
    let b: Budget | null = null;
    b = new WebglBudget(() => false, 1, {
      frame: k.frame,
      primeGapMs: 0,
      readFrame: () => 'data:image/png;base64,X',
    });
    const p = page(() => b as Budget);
    const c = p.mk('a', 0);
    b.apply();
    await k.tick(3);
    expect(overlayOf(c)).not.toBeNull();
    const body = c.parentElement as HTMLElement;
    c.remove();
    b.apply();
    await k.tick(1);
    expect(body.querySelector('[data-dc-gl-snapshot]')).toBeNull();
  });
});
