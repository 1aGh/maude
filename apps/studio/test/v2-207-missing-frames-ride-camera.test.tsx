// 2.0.7 — a missing-picture frame costs nothing per frame while the camera moves.
//
// The mascot canvas (studyfi-207) names ~59 pictures that are not there. Each frame followed its picture with a
// getBoundingClientRect per animation frame (asset-placeholder.tsx tick → frameBox): ~59+ layout reads in every
// frame of a pan or zoom, ~40 ms a frame in WebKit. The frames stay in the body layer (inside `.dc-world` the input
// router would claim their buttons' pointerdowns — input-router.tsx isOverlayTarget), so while the camera moves
// the layer RIDES it — one transform written from the camera numbers, no layout read — and measures once again
// when the camera is still and no gesture is running.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AssetPlaceholderLayer } from '../asset-placeholder.tsx';

type Cam = { x: number; y: number; zoom: number };
type Box = { left: number; top: number; width: number; height: number };

let rafQueue: FrameRequestCallback[] = [];
let realRaf: typeof requestAnimationFrame;
let realCaf: typeof cancelAnimationFrame;

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  realRaf = globalThis.requestAnimationFrame;
  realCaf = globalThis.cancelAnimationFrame;
  const raf = (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  const caf = () => {};
  globalThis.requestAnimationFrame = raf as never;
  globalThis.cancelAnimationFrame = caf as never;
  window.requestAnimationFrame = raf as never;
  window.cancelAnimationFrame = caf as never;
});
afterAll(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  rafQueue = [];
});

/** One animation frame: run what was queued for it (each tick queues the next one). */
const frame = () =>
  act(async () => {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(0);
  });

const shell = (data: unknown) =>
  act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, source: window.parent as never }));
  });

/** A world at screen origin (ox, oy) under camera `cam`, holding one failed picture whose world box is `wb`. */
async function mount(opts: { camera?: () => Cam | null; interacting?: boolean }) {
  document.body.innerHTML =
    '<div class="dc-canvas"><div class="dc-world" id="w"></div></div><div id="root"></div>';
  const world = document.getElementById('w') as HTMLElement;
  const state = { cam: { x: 40, y: 30, zoom: 0.5 } as Cam, canvasLeft: 10, canvasTop: 20 };
  const wb = { x: 200, y: 100, w: 1200, h: 900 }; // stays ≥ FRAME_MIN on screen down to zoom 0.13
  const screenOf = (c: Cam): Box => ({
    left: state.canvasLeft + c.x + c.zoom * wb.x,
    top: state.canvasTop + c.y + c.zoom * wb.y,
    width: c.zoom * wb.w,
    height: c.zoom * wb.h,
  });
  world.getBoundingClientRect = () =>
    ({
      left: state.canvasLeft + state.cam.x,
      top: state.canvasTop + state.cam.y,
      width: 0,
      height: 0,
    }) as DOMRect;
  const img = document.createElement('img');
  img.setAttribute('src', 'assets/pose_cheer_front.png');
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 0 });
  const reads = { n: 0 };
  img.getBoundingClientRect = () => {
    reads.n += 1;
    return screenOf(state.cam) as DOMRect;
  };
  world.appendChild(img);

  const root = createRoot(document.getElementById('root') as HTMLElement);
  roots.push(root);
  const render = (interacting: boolean | undefined) =>
    act(async () =>
      root.render(
        createElement(AssetPlaceholderLayer, {
          inShell: true,
          ...(opts.camera ? { camera: opts.camera } : {}),
          ...(interacting === undefined ? {} : { interacting }),
        } as never)
      )
    );
  await render(opts.interacting);
  await shell({
    dgn: 'asset-state',
    items: [{ rel: 'assets/pose_cheer_front.png', state: 'missing' }],
  });
  return { state, reads, img, render, screenOf };
}

const theFrame = () => document.querySelector('[data-testid="asset-frame"]') as HTMLElement;

/** Where the frame is on screen: its own left/top/size, through the transform of the wrapper it rides in. */
function onScreen(): Box {
  const f = theFrame();
  const left = Number.parseFloat(f.style.left);
  const top = Number.parseFloat(f.style.top);
  const width = Number.parseFloat(f.style.width);
  const height = Number.parseFloat(f.style.height);
  const t = (f.parentElement as HTMLElement).style.transform;
  const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\((-?[\d.e-]+)\)/.exec(t);
  if (!m) return { left, top, width, height };
  const [tx, ty, k] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { left: tx + k * left, top: ty + k * top, width: k * width, height: k * height };
}

const near = (a: Box, b: Box) => {
  expect(Math.abs(a.left - b.left)).toBeLessThan(1.01);
  expect(Math.abs(a.top - b.top)).toBeLessThan(1.01);
  expect(Math.abs(a.width - b.width)).toBeLessThan(1.01);
  expect(Math.abs(a.height - b.height)).toBeLessThan(1.01);
};

describe('2.0.7 — missing-picture frames ride the camera', () => {
  test('a pan + zoom reads no layout in any frame, the frame still sits over the picture, one measure on settle', async () => {
    let cam: Cam | null = null;
    const env = await mount({ camera: () => cam });
    cam = env.state.cam;
    await frame();
    await frame();
    expect(theFrame()).toBeTruthy();
    near(onScreen(), env.screenOf(env.state.cam)); // settled: exactly over the picture

    // the gesture: the camera changes every frame (a pan, then a zoom toward 0.1)
    const before = env.reads.n;
    const steps: Cam[] = [];
    for (let i = 1; i <= 12; i++) {
      const z = i <= 6 ? 0.5 : 0.5 * 0.8 ** (i - 6);
      steps.push({ x: 40 - 9 * i, y: 30 + 5 * i, zoom: z });
    }
    for (const c of steps) {
      env.state.cam = c;
      cam = c;
      await frame();
      near(onScreen(), env.screenOf(c)); // follows the picture with no read
    }
    expect(env.reads.n - before).toBe(0);

    // settle: the camera is still for a frame → measured once, the wrapper rides nothing any more
    await frame();
    expect(env.reads.n - before).toBeGreaterThan(0);
    expect((theFrame().parentElement as HTMLElement).style.transform).toBe('');
    near(onScreen(), env.screenOf(env.state.cam));
  });

  test('a running gesture whose camera holds still for a slow frame still reads nothing', async () => {
    let cam: Cam | null = null;
    const env = await mount({ camera: () => cam, interacting: false });
    cam = env.state.cam;
    await frame();
    await env.render(true); // the canvas says a gesture is running (isInteracting)
    const before = env.reads.n;
    for (let i = 0; i < 5; i++) await frame(); // the camera did not move between these frames
    expect(env.reads.n - before).toBe(0);
    await env.render(false); // the gesture ended
    await frame();
    expect(env.reads.n - before).toBeGreaterThan(0);
  });

  test('with no camera (an older mount, a test page) the frame still follows its picture every frame', async () => {
    const env = await mount({});
    await frame();
    const before = env.reads.n;
    env.state.cam = { x: 0, y: 0, zoom: 1 };
    await frame();
    expect(env.reads.n - before).toBeGreaterThan(0);
    near(onScreen(), env.screenOf(env.state.cam));
  });
});
