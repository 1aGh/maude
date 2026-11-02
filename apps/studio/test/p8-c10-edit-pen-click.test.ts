// P8 stage C round 10 (14 ed-pen): a click on a point of the path being edited keeps the path selected. The Pen's
// overlay is a fixed SVG over the world, so a press on it looked like a press on EMPTY WORLD to the marquee layers,
// whose bare-click rule clears the selection (and so left point editing) — before the chip or the Point card showed.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe('14 ed-pen: the Pen overlay is not empty world', () => {
  test('the artboard marquee and the element marquee both leave the Pen overlay alone', async () => {
    const { shouldIgnoreTarget } = await import('../artboard-marquee.tsx');
    const { isChromeTarget } = await import('../marquee-overlay.tsx');
    document.body.innerHTML = `<div class="dc-canvas"><svg class="ed-pen-svg"><rect id="pt" class="ed-pen-pt"/></svg><div id="world"></div></div>`;
    const pt = document.getElementById('pt');
    const world = document.getElementById('world');
    expect(shouldIgnoreTarget(pt)).toBe(true);
    expect(isChromeTarget(pt)).toBe(true);
    // empty world still starts a marquee (a bare click there clears the selection)
    expect(shouldIgnoreTarget(world)).toBe(false);
    expect(isChromeTarget(world)).toBe(false);
  });
});
