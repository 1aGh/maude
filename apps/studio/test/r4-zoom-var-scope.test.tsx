// r4 #5 — "zooming the maude-v2 design system canvas is extremely choppy; panning is fine".
//
// The live zoom is written onto `.dc-world` as the custom property `--dc-zoom` on EVERY zoom frame (canvas-lib
// writeTransform), for the chrome that holds a constant screen size (the artboard name, the video badge, the
// guides). A custom property inherits, so each zoom frame changed the computed style of every element of every
// design inside the world, and WebKit re-resolved the whole tree: on the real Design system canvas (45 pages of
// specimens, all token-styled) every zoom frame took 90-240 ms in Safari (studio lane), with the pages' content
// hidden it still took 90 ms (style, not paint), and a pan (no `--dc-zoom` change) stayed at 18 ms.
//
// The chrome that reads `--dc-zoom` sits OUTSIDE the design surface (the name and badge are children of the
// frame, the guides/marks are siblings of it), so the design surface stops the inheritance: `--dc-zoom` is reset
// on `.dc-artboard-body`, and a zoom frame recomputes one element per artboard instead of all of its content.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

describe('the live zoom variable stops at the design surface', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Object.defineProperty(window.navigator, 'vendor', {
      configurable: true,
      get: () => 'Apple Computer, Inc.',
    });
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('the engine stylesheet resets --dc-zoom on the artboard body, and no engine rule reads it inside one', async () => {
    const { DesignCanvas, DCArtboard } = canvasLib;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCArtboard id="a" label="Home" width={200} height={150}>
            <p className="inside">board</p>
          </DCArtboard>
        </DesignCanvas>
      );
    });
    const css = document.getElementById('dc-engine-css')?.textContent ?? '';
    expect(css.length).toBeGreaterThan(0);
    // one rule on the body itself sets the variable to a constant: the world's per-frame value never reaches
    // the design's content
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      sel: (m[1] as string).trim(),
      body: m[2] as string,
    }));
    const reset = rules.find(
      (r) =>
        /(^|,)\s*\.dc-canvas \.dc-artboard-body\s*(,|$)/.test(r.sel) &&
        /--dc-zoom\s*:\s*initial/.test(r.body)
    );
    expect(reset).toBeDefined();
    // nothing the engine counter-scales lives under the body (it would be stuck at the fallback)
    const readsInside = rules.filter(
      (r) => r.body.includes('var(--dc-zoom') && /\.dc-artboard-body\s+\S/.test(r.sel)
    );
    expect(readsInside.map((r) => r.sel)).toEqual([]);
    // and the chrome that does read it is outside the body
    const label = document.querySelector('.dc-artboard.dc-positioned > .dc-artboard-label');
    expect(label?.closest('.dc-artboard-body')).toBeNull();
    await act(async () => root.unmount());
  });
});
