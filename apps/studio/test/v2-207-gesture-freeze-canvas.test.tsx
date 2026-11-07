// 2.0.7 — the gesture freeze on a mounted canvas: while the camera moves, an artboard's own render loop waits,
// its silent video pauses (the one with sound plays on), its article carries `data-dc-frozen` (CSS animations
// paused); the gesture still ends on its own quiet frame (the camera's clock is exempt) and everything resumes.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

const STUDIO = join(import.meta.dir, '..');
const SHELL = join(STUDIO, '..', '..', 'plugins', 'design', 'templates', '_shell.html');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freezeScript(): string {
  const m = /<script id="maude-frame-freeze">([\s\S]*?)<\/script>/.exec(
    readFileSync(SHELL, 'utf8')
  );
  if (!m?.[1]) throw new Error('the canvas shell has no maude-frame-freeze script');
  return m[1];
}

interface FreezeApi {
  raf(cb: FrameRequestCallback): number;
  caf(id: number): void;
  set(on: boolean): void;
  frozen(): boolean;
  on(fn: (on: boolean) => void): () => void;
  stats(): { held: number; deferred: number; flushed: number; watchdog: number; freezes: number };
}

type IOEntry = { target: Element; isIntersecting: boolean };
const observers: FakeIO[] = [];
class FakeIO {
  els = new Set<Element>();
  constructor(
    public cb: (e: IOEntry[]) => void,
    public opts?: { rootMargin?: string }
  ) {
    observers.push(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
  }
}
function reportAll(near: boolean) {
  for (const o of observers) for (const el of o.els) o.cb([{ target: el, isIntersecting: near }]);
}

describe('a pan on a mounted canvas', () => {
  let lib: typeof import('../canvas-lib.tsx');
  let gate: typeof import('../artboard-live-gate.tsx');
  let api: FreezeApi;
  const ticks = { n: 0 };

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
    // frames as a browser paces them, then the shell's gate over them — as in the canvas frame
    const g = globalThis as unknown as Record<string, unknown>;
    const w = window as unknown as Record<string, unknown>;
    const raf = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number;
    const caf = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    w.requestAnimationFrame = raf;
    w.cancelAnimationFrame = caf;
    if (!w.__maudeFrameFreeze) new Function('window', freezeScript())(window);
    g.requestAnimationFrame = w.requestAnimationFrame;
    g.cancelAnimationFrame = w.cancelAnimationFrame;
    api = w.__maudeFrameFreeze as FreezeApi;
    lib = await import('../canvas-lib.tsx');
    gate = await import('../artboard-live-gate.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    observers.length = 0;
    gate.resetArtboardLive();
    ticks.n = 0;
  });

  /** an artboard's own render loop — the canvas's code, which knows nothing of Maude */
  function Loop() {
    useEffect(() => {
      let id = 0;
      const tick = () => {
        ticks.n += 1;
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(id);
    }, []);
    return <div className="spin" />;
  }

  async function mount() {
    window.happyDOM.setURL('http://localhost/?artboard-live=sleep');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <lib.DesignCanvas>
          <lib.DCSection id="s" title="S">
            {['a0', 'a1'].map((id) => (
              <lib.DCArtboard key={id} id={id} label={id} width={400} height={300} fixed>
                <Loop />
                <video muted data-v={id} />
                <video data-loud={id}>
                  <track kind="captions" />
                </video>
              </lib.DCArtboard>
            ))}
          </lib.DCSection>
        </lib.DesignCanvas>
      );
    });
    await act(async () => {
      reportAll(true);
      await sleep(100);
    });
    // a second act: the first flushed the mounts and their effects (act runs React work at its end)
    await act(async () => {
      await sleep(300);
    });
    const canvas = host.querySelector('.dc-canvas') as HTMLElement;
    const target = (canvas.querySelector('.dc-world') as HTMLElement) || canvas;
    const wheel = () =>
      target.dispatchEvent(
        new WheelEvent('wheel', { deltaX: 12, deltaY: 9, bubbles: true, cancelable: true })
      );
    return { host, root, wheel };
  }

  /** happy-dom's media elements do not play: a playing one, with pause/play counted */
  function playing(v: HTMLVideoElement) {
    const c = { pause: 0, play: 0 };
    let paused = false;
    Object.defineProperty(v, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(v, 'ended', { configurable: true, get: () => false });
    v.pause = () => {
      c.pause += 1;
      paused = true;
    };
    v.play = () => {
      c.play += 1;
      paused = false;
      return Promise.resolve();
    };
    return c;
  }

  test("while the camera moves the artboards' loops wait, their animations and silent videos pause; all resume on the settle", async () => {
    const m = await mount();
    const article = m.host.querySelector('[data-dc-screen="a0"]') as HTMLElement;
    expect(article).toBeTruthy();
    expect(article.hasAttribute('data-dc-asleep')).toBe(false); // awake: near and on screen
    const silent = playing(m.host.querySelector('video[data-v="a0"]') as HTMLVideoElement);
    const loud = playing(m.host.querySelector('video[data-loud="a0"]') as HTMLVideoElement);
    expect(ticks.n).toBeGreaterThan(3); // the loops run

    let thawAt = 0;
    const off = api.on((on) => {
      if (!on) thawAt = performance.now();
    });
    let during = 0;
    let lastWheel = 0;
    await act(async () => {
      m.wheel();
      await sleep(40);
      during = ticks.n;
      expect(api.frozen()).toBe(true);
      expect(article.hasAttribute('data-dc-frozen')).toBe(true);
      for (let i = 0; i < 8; i++) {
        m.wheel();
        await sleep(20);
      }
      lastWheel = performance.now();
    });
    // a pan of ~200 ms: the loops did not tick, the silent video was paused, the one with sound plays on
    expect(ticks.n).toBe(during);
    expect(silent.pause).toBe(1);
    expect(loud.pause).toBe(0);

    await act(async () => {
      await sleep(700);
    });
    // the gesture ended on its own quiet frame (the camera's clock is exempt), not on a fallback
    expect(api.frozen()).toBe(false);
    expect(thawAt - lastWheel).toBeLessThan(600);
    expect(ticks.n).toBeGreaterThan(during + 3); // the loops run again
    expect(article.hasAttribute('data-dc-frozen')).toBe(false);
    expect(silent.play).toBe(1);
    expect(loud.play).toBe(0);
    off();
    await act(async () => m.root.unmount());
    m.host.remove();
  });
});
