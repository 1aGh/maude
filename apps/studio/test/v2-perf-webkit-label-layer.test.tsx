// V2-8.8 — on the WebKit path a zoom gesture must not change any placed artboard's painted bounds.
//
// WebKit M7 was not met: v2's zoom frames were all long (41 long frames vs 27 before v2, gesture p95 184 ms
// vs 130). React is not it — the WebKit lane counts the same 147 artboard renders in both arms. What v2 added
// is the artboard NAME above the frame (gate-a-polish): it is counter-scaled by `--dc-zoom` every zoom frame
// (`transform: scale(1 / zoom)` + `max-width: calc(100% * zoom)`), so it lays out every frame, and it paints
// outside the frame (`.dc-positioned` drops `contain: paint`). Inside the artboard's own compositor layer
// (`will-change: transform`, the per-board raster freeze), that label grew and moved the layer's bounds on
// every zoom frame, and WebKit re-rasters a layer whose bounds change — every board, every zoom frame.
// Measured display-free (Chromium on the WebKit branch, traced): the labels are the only layout inside the
// world during a zoom (2,776 dirty layout objects over 40 frames; 153 with the labels hidden; 324 pre-v2).
//
// The fix gives the label (and the video badge that rides the same row) its own compositor layer on the
// WebKit path, so its per-frame change stays in that layer and the board's bitmap stays frozen. Blink keeps
// CSS zoom (it relayouts the world anyway) and is left exactly as it was.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

describe('the placed artboard name on the WebKit scale path', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    // canvas-lib picks its engine branch once, at import: Safari / WKWebView report an Apple vendor
    Object.defineProperty(window.navigator, 'vendor', {
      configurable: true,
      get: () => 'Apple Computer, Inc.',
    });
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('the world says which scale path it takes, and the name gets its own layer only on WebKit', async () => {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCSection id="s" title="S">
            <DCArtboard id="a" label="Home" width={200} height={150}>
              <div>board</div>
            </DCArtboard>
            <DCArtboard id="v" label="Clip" width={200} height={150} kind="video">
              <div>clip</div>
            </DCArtboard>
          </DCSection>
        </DesignCanvas>
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const world = document.querySelector('.dc-world');
    expect(world?.getAttribute('data-dc-scale')).toBe('transform');

    const label = document.querySelector('.dc-artboard.dc-positioned > .dc-artboard-label');
    expect(label).not.toBeNull();
    expect(window.getComputedStyle(label as Element).willChange).toBe('transform');
    const badge = document.querySelector('.dc-artboard.dc-positioned > .dc-artboard-video-badge');
    expect(badge).not.toBeNull();
    expect(window.getComputedStyle(badge as Element).willChange).toBe('transform');

    // the same rule is inert on the Blink path (CSS zoom): no extra layers there
    const blink = document.createElement('div');
    blink.className = 'dc-canvas';
    blink.innerHTML =
      '<div class="dc-world" data-dc-scale="zoom"><article class="dc-artboard dc-positioned">' +
      '<header class="dc-artboard-label sku">Home</header></article></div>';
    document.body.append(blink);
    const blinkLabel = blink.querySelector('.dc-artboard-label') as Element;
    expect(window.getComputedStyle(blinkLabel).willChange).not.toBe('transform');
    blink.remove();
    await act(async () => root.unmount());
  });
});
