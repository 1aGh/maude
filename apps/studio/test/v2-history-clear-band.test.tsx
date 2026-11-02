// S1.23 G4 + G5 — the history surfaces that sit in the canvas area keep clear of the floating islands.
//   G4  the Viewing bar (11 · pn-history) lives in the band between the project pill and the Share cluster at
//       1440 wide, so its "back to now" is never under the top-right cluster.
//   G5  the Compare view (11 · pn-compare) insets its A / B frames and the change list by what the floating
//       panels cover, so frame A is not cut off by the Canvases panel.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { viewBarPlacement } from '../client/v2/history/clear-band.js';
import { CompareView } from '../client/v2/history/compare-view.jsx';
import { ViewBar } from '../client/v2/history/view-bar.jsx';

describe('viewBarPlacement (pure)', () => {
  const host = { left: 0, right: 1440 };
  test('no islands: centred', () => {
    expect(viewBarPlacement({ host, islands: [], width: 700 })).toEqual({
      center: 720,
      maxWidth: 1424,
    });
  });
  test('a bar that fits between the islands stays centred', () => {
    const r = viewBarPlacement({
      host,
      islands: [
        { left: 16, right: 200 },
        { left: 1300, right: 1424 },
      ],
      width: 500,
    });
    expect(r.center).toBe(720);
    expect(r.maxWidth).toBe(1292 - 208);
  });
  test('a bar wider than the band is capped to the band, which is its own centre', () => {
    const r = viewBarPlacement({
      host,
      islands: [
        { left: 16, right: 300 },
        { left: 900, right: 1424 },
      ],
      width: 760,
    });
    expect(r).toEqual({ center: 600, maxWidth: 584 });
  });
  test('only a left island: the bar slides right of it', () => {
    const r = viewBarPlacement({ host, islands: [{ left: 16, right: 700 }], width: 900 });
    expect(r.center).toBe(Math.round(708 + (1432 - 708) / 2));
  });
  test('islands that leave no room at all are ignored', () => {
    const r = viewBarPlacement({
      host,
      islands: [
        { left: 16, right: 700 },
        { left: 720, right: 1424 },
      ],
      width: 400,
    });
    expect(r).toEqual({ center: 720, maxWidth: 1424 });
  });
});

let realRect: typeof Element.prototype.getBoundingClientRect;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  if (realRect) Element.prototype.getBoundingClientRect = realRect;
});

// happy-dom has no layout: a `data-rect="l,t,r,b"` says where an element is; the bar is 760 wide unconstrained.
function installRects() {
  realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const d = this.getAttribute('data-rect');
    let l = 0;
    let t = 0;
    let r = 0;
    let b = 0;
    if (d) [l, t, r, b] = d.split(',').map(Number) as [number, number, number, number];
    else if (this.classList.contains('vh-viewbar')) [l, t, r, b] = [0, 16, 760, 56];
    else if (this.classList.contains('cmp-view')) [l, t, r, b] = [0, 0, 1440, 900];
    return {
      left: l,
      top: t,
      right: r,
      bottom: b,
      width: r - l,
      height: b - t,
      x: l,
      y: t,
      toJSON() {},
    } as DOMRect;
  };
}

describe('the Viewing bar at 1440 wide (S1.23 G4)', () => {
  test('it is placed in the band between the project pill and the Share cluster', async () => {
    installRects();
    const host = document.createElement('div');
    host.setAttribute('data-rect', '0,0,1440,900');
    host.innerHTML =
      '<div data-occludes="top" data-rect="16,16,300,56"></div>' +
      '<div data-occludes="top" data-rect="900,16,1424,56"></div>' +
      '<div data-occludes="left" data-rect="16,64,316,860"></div>';
    document.body.append(host);
    const mount = document.createElement('div');
    mount.setAttribute('data-rect', '0,0,1440,900');
    host.append(mount);
    root = createRoot(mount);
    await act(async () =>
      root?.render(
        <ViewBar
          viewing={{ title: 'Schváleno trenéry', when: '5 Oct, 18:40', who: 'Jonas' }}
          onLeave={() => {}}
        />
      )
    );
    const bar = document.querySelector<HTMLElement>('[data-testid="vh-viewbar"]') as HTMLElement;
    // host = the bar's parent here; islands at 16..300 and 900..1424 leave 308..892
    expect(bar.style.left).toBe('600px');
    expect(bar.style.maxWidth).toBe('584px');
    // "back to now" is still there, in the bar
    expect(bar.querySelector('[data-testid="vh-viewbar-back"]')).not.toBeNull();
  });
});

describe('the Compare view with a floating panel on the left (S1.23 G5)', () => {
  test('its stage is inset by what the islands cover, so frame A is not cut off', async () => {
    installRects();
    const panel = document.createElement('div');
    panel.setAttribute('data-occludes', 'left');
    panel.setAttribute('data-rect', '16,64,316,860');
    document.body.append(panel);
    const mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
    const side = { at: 'r41', title: 'Schváleno trenéry', when: '17 Oct, 18:40', who: 'Jonas' };
    await act(async () =>
      root?.render(
        <CompareView
          state={{
            path: '.design/ui/Uniformy-2027.tsx',
            a: side,
            b: { at: 'now', title: 'Now', when: '18 Oct, 15:00', who: '' },
            mode: 'side',
            focus: null,
            rows: [],
            answer: { status: 'loading' },
          }}
          cfg={{ designRel: '.design' }}
        />
      )
    );
    const view = document.querySelector<HTMLElement>('[data-testid="cmp-view"]') as HTMLElement;
    // 316 - 0 + 8 (the shell's gap)
    expect(view.style.getPropertyValue('--cmp-in-l')).toBe('324px');
    expect(view.style.getPropertyValue('--cmp-in-r')).toBe('0px');
  });
});
