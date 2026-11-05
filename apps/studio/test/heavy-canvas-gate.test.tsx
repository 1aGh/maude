// 2.0.5 — heavy canvases: the artboard gate in a mounted DesignCanvas. Captures mount and run EVERY artboard;
// the studio's light mode mounts only what is near; sleeping artboards pause their videos; a design-system
// specimen mounts once its artboard comes near; the WebGL budget releases contexts past the cap.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

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
function report(id: string, near: boolean, visible = near) {
  for (const o of observers) {
    for (const el of o.els) {
      if (el.getAttribute('data-dc-screen') !== id) continue;
      o.cb([{ target: el, isIntersecting: o.opts?.rootMargin ? near : visible }]);
    }
  }
}

describe('artboard live gate', () => {
  let lib: typeof import('../canvas-lib.tsx');
  let gate: typeof import('../artboard-live-gate.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
    lib = await import('../canvas-lib.tsx');
    gate = await import('../artboard-live-gate.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    observers.length = 0;
    gate.resetArtboardLive();
  });

  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

  function Probe({ id }: { id: string }) {
    const live = lib.useArtboardActive();
    const seen = lib.useArtboardSeen();
    return createElement('div', {
      'data-body': id,
      'data-live': String(live),
      'data-seen': String(seen),
    });
  }

  async function mount(search: string, ids = ['a0', 'a1', 'a2'], extra?: (id: string) => unknown) {
    window.happyDOM.setURL(`http://localhost/${search}`);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <lib.DesignCanvas>
          <lib.DCSection id="s" title="S">
            {ids.map((id) => (
              <lib.DCArtboard key={id} id={id} label={id} width={200} height={150}>
                <Probe id={id} />
                {extra ? (extra(id) as never) : null}
              </lib.DCArtboard>
            ))}
          </lib.DCSection>
        </lib.DesignCanvas>
      );
    });
    await settle();
    const read = () =>
      [...host.querySelectorAll('[data-body]')].map((e) => ({
        id: e.getAttribute('data-body'),
        live: e.getAttribute('data-live'),
        seen: e.getAttribute('data-seen'),
      }));
    const done = async () => {
      await act(async () => root.unmount());
      host.remove();
    };
    return { host, read, done };
  }

  test('a capture mounts and runs every artboard, whatever mode is asked for', async () => {
    const m = await mount('?hide-chrome=1&artboard-live=light');
    expect(m.read()).toEqual([
      { id: 'a0', live: 'true', seen: 'true' },
      { id: 'a1', live: 'true', seen: 'true' },
      { id: 'a2', live: 'true', seen: 'true' },
    ]);
    expect(observers).toHaveLength(0); // nothing observed, nothing patched
    await m.done();
  });

  test('a top-level page (headless screenshot/export) runs everything', async () => {
    const m = await mount('?canvas=x.tsx');
    expect(m.read().every((r) => r.live === 'true' && r.seen === 'true')).toBe(true);
    await m.done();
  });

  test('light mode mounts only the artboards near the viewport', async () => {
    const m = await mount('?artboard-live=light');
    expect(m.read()).toEqual([]);
    expect(m.host.querySelectorAll('.dc-artboard-sleeping')).toHaveLength(3);
    await act(async () => report('a1', true));
    await settle();
    expect(m.read()).toEqual([{ id: 'a1', live: 'true', seen: 'true' }]);
    await act(async () => report('a1', false));
    await settle();
    expect(m.read()).toEqual([]);
    await m.done();
  });

  test('sleep mode keeps the DOM; offscreen artboards are not live and their videos pause', async () => {
    const m = await mount('?artboard-live=sleep', ['a0', 'a1'], (id) =>
      createElement('video', { 'data-v': id })
    );
    const vids = [...m.host.querySelectorAll('video')] as HTMLVideoElement[];
    let paused = 0;
    let played = 0;
    for (const v of vids) {
      Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
      v.pause = () => {
        paused += 1;
      };
      v.play = () => {
        played += 1;
        return Promise.resolve();
      };
    }
    await act(async () => report('a0', true));
    await settle();
    expect(m.read()).toEqual([
      { id: 'a0', live: 'true', seen: 'true' },
      { id: 'a1', live: 'false', seen: 'false' },
    ]);
    const a1 = m.host.querySelector('[data-dc-screen="a1"]');
    expect(a1?.hasAttribute('data-dc-asleep')).toBe(true);
    // a1's video started playing while asleep → paused straight away
    a1?.querySelector('video')?.dispatchEvent(new Event('play'));
    expect(paused).toBeGreaterThan(0);
    await act(async () => report('a1', true));
    await settle();
    expect(a1?.hasAttribute('data-dc-asleep')).toBe(false);
    expect(played).toBeGreaterThan(0);
    await m.done();
  });

  test('holdAllLive (the in-frame export) wakes everything for the capture', async () => {
    const m = await mount('?artboard-live=light');
    expect(m.read()).toEqual([]);
    let release = () => {};
    await act(async () => {
      release = await gate.holdAllLive();
    });
    await settle();
    expect(m.read().map((r) => r.id)).toEqual(['a0', 'a1', 'a2']);
    await act(async () => release());
    await settle();
    expect(m.read()).toEqual([]);
    await m.done();
  });

  test('a design-system specimen mounts only once its artboard comes near', async () => {
    const state = await import('../ds/board/state.ts');
    const { Specimen } = await import('../ds/board/specimen.tsx');
    state.__registerBoardModel({ rootClass: 'x', themes: { light: 'l' } } as never, {
      'preview/a.tsx': () => createElement('p', { 'data-spec': 'a' }, 'A'),
    });
    const m = await mount('?artboard-live=sleep', ['a0'], () =>
      createElement(Specimen, { src: 'preview/a.tsx' })
    );
    expect(m.host.querySelector('[data-spec]')).toBeNull();
    expect(m.host.querySelector('.ds-specimen-pending')).not.toBeNull();
    await act(async () => report('a0', true));
    await settle();
    expect(m.host.querySelector('[data-spec]')).not.toBeNull();
    await m.done();
    state.__resetBoardState();
  });
  test('releases contexts past the cap and restores them when their artboard is live again', async () => {
    const { WebglBudget } = await import('../artboard-webgl.ts');
    const live = new Set<string>();
    const b = new WebglBudget((id) => (id ? live.has(id) : true), 2);
    const calls: string[] = [];
    const mk = (id: string, x: number) => {
      const board = document.createElement('div');
      board.setAttribute('data-dc-screen', id);
      const c = document.createElement('canvas');
      c.getBoundingClientRect = () => ({ left: x, top: 0, width: 10, height: 10 }) as DOMRect;
      board.append(c);
      document.body.append(board);
      const gl = {
        getExtension: () => ({
          loseContext: () => calls.push(`lose:${id}`),
          restoreContext: () => calls.push(`restore:${id}`),
        }),
      };
      b.track(c, gl as unknown as WebGLRenderingContext);
      live.add(id);
    };
    mk('a', 0);
    mk('b', 100);
    mk('c', 2000);
    b.apply();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual(['lose:c']);
    expect(b.stats()).toEqual({ tracked: 3, live: 2, lost: 1 });
    live.delete('a');
    b.apply();
    await new Promise((r) => setTimeout(r, 50));
    expect([...calls].sort()).toEqual(['lose:a', 'lose:c', 'restore:c']);
  });
});
