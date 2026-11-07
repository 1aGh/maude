// 2.0.7 regression (packaged check on 740719d90, decision v2-207-video-artboards-eager): a video artboard is always
// mounted so its comp registers (`window.__maudeVideoComps` — the link glyph, the Timeline's shared count and
// Present's format switch read it). That mounted the Remotion Player far away too, and its <video preload="auto">
// fetched the whole file at open and decoded a frame (+47 MB in WebKit for 4 far videos). The 2.0.5 rule: only an
// artboard near or on screen loads video. Pinned here, on a mounted DesignCanvas with a real VideoComp:
//   - far: the comp is registered (the far format is known), but there is no Player and no <video>;
//   - near: the Player mounts and its media loads as before;
//   - a capture (`?hide-chrome=1`, mode off) mounts every Player.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
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
/** near = the prefetch + keep rings; visible = on screen */
function report(id: string, near: boolean, visible = near) {
  for (const o of observers) {
    for (const el of o.els) {
      if (el.getAttribute('data-dc-screen') !== id) continue;
      o.cb([{ target: el, isIntersecting: o.opts?.rootMargin ? near : visible }]);
    }
  }
}

function Clip() {
  return (
    <video data-clip="" src="/_api/asset?path=assets/far.mp4" preload="auto">
      <track kind="captions" />
    </video>
  );
}

describe('a far video artboard loads no media, and its format is still known', () => {
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
    (window as unknown as { __maudeVideoComps?: Map<string, unknown> }).__maudeVideoComps?.clear();
  });

  const wait = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });

  async function mount(url: string) {
    window.happyDOM.setURL(url);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <lib.DesignCanvas>
          <lib.DCSection id="s" title="S">
            <lib.DCArtboard id="reel" label="9:16" kind="video" width={180} height={320}>
              <lib.VideoComp
                component={Clip}
                durationInFrames={30}
                fps={30}
                width={180}
                height={320}
              />
            </lib.DCArtboard>
            <lib.DCArtboard id="wide" label="16:9" kind="video" width={320} height={180}>
              <lib.VideoComp
                component={Clip}
                durationInFrames={30}
                fps={30}
                width={320}
                height={180}
              />
            </lib.DCArtboard>
          </lib.DCSection>
        </lib.DesignCanvas>
      )
    );
    await wait(80);
    const art = (id: string) => host.querySelector(`[data-dc-screen="${id}"]`);
    return {
      host,
      clips: (id: string) => art(id)?.querySelectorAll('video').length ?? 0,
      comps: () =>
        [
          ...((
            window as unknown as { __maudeVideoComps?: Map<string, { artboardId: string | null }> }
          ).__maudeVideoComps?.values() ?? []),
        ]
          .map((e) => e.artboardId)
          .sort(),
      done: async () => {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test('far: registered, no Player, no <video>; near: the media loads', async () => {
    const m = await mount('http://localhost/?artboard-live=sleep');
    // nobody is near yet — both formats are known all the same
    expect(m.comps()).toEqual(['reel', 'wide']);
    expect(m.clips('reel')).toBe(0);
    expect(m.clips('wide')).toBe(0);
    await act(async () => report('reel', true));
    await wait(80);
    expect(m.clips('reel')).toBe(1); // near: loads as before
    expect(m.clips('wide')).toBe(0); // far: still nothing fetched
    expect(m.comps()).toEqual(['reel', 'wide']);
    await m.done();
  });

  test('a capture mounts every Player', async () => {
    const m = await mount('http://localhost/?hide-chrome=1');
    expect(m.clips('reel')).toBe(1);
    expect(m.clips('wide')).toBe(1);
    expect(m.comps()).toEqual(['reel', 'wide']);
    await m.done();
  });
});
