// r5-2 (Michal: "video lze prehrat jen v presentation mode") — a clip on the canvas needs a visible play control in Edit and
// Preview. The button shows while the pointer is on a `<video controls>`, plays and pauses it on a click, is its own hit
// target (the selection / marquee / annotation handlers skip it), is never drawn for a clip too small to carry it, nor
// outside the shell's frame (an export capture).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { shouldIgnoreTarget } from '../artboard-marquee.tsx';
import {
  buttonBox,
  centreBox,
  VideoPlayLayer,
  VPLAY_CENTRE,
  VPLAY_MIN,
} from '../video-play-overlay.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(inShell: boolean) {
  document.body.innerHTML = '<div id="art"></div><div id="root"></div>';
  const root = createRoot(document.getElementById('root') as HTMLElement);
  roots.push(root);
  await act(async () => root.render(createElement(VideoPlayLayer, { inShell })));
}

function clip(opts: { controls?: boolean } = {}) {
  const v = document.createElement('video');
  v.setAttribute('data-cd-id', 'hero');
  if (opts.controls !== false) v.setAttribute('controls', '');
  const calls: string[] = [];
  let paused = true;
  Object.defineProperty(v, 'paused', { get: () => paused });
  Object.defineProperty(v, 'ended', { get: () => false });
  (v as unknown as { play: () => Promise<void> }).play = () => {
    paused = false;
    calls.push('play');
    v.dispatchEvent(new Event('play'));
    return Promise.resolve();
  };
  (v as unknown as { pause: () => void }).pause = () => {
    paused = true;
    calls.push('pause');
    v.dispatchEvent(new Event('pause'));
  };
  v.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 320, height: 180, right: 420, bottom: 280 }) as DOMRect;
  document.getElementById('art')?.appendChild(v);
  return { v, calls };
}

const over = async (v: Element | null) => {
  document.elementsFromPoint = () => (v ? [v] : []);
  await act(
    async () => void document.dispatchEvent(new window.Event('pointermove', { bubbles: true }))
  );
};
const button = () => document.querySelector<HTMLButtonElement>('[data-testid="video-play-button"]');

describe('the play button over a clip (r5-2)', () => {
  test('shows on hover, plays on a click, then offers Pause; leaving takes it away', async () => {
    await mount(true);
    const { v, calls } = clip();
    expect(button()).toBeNull();
    await over(v);
    const b = button();
    expect(b).not.toBeNull();
    expect(b?.getAttribute('aria-label')).toBe('Play video');
    await act(async () => void b?.click());
    expect(calls).toEqual(['play']);
    expect(button()?.getAttribute('aria-label')).toBe('Pause video');
    await act(async () => void button()?.click());
    expect(calls).toEqual(['play', 'pause']);
    expect(button()?.getAttribute('aria-label')).toBe('Play video');
    await over(null);
    expect(button()).toBeNull();
  });

  test('a video with no native controls (a timeline <Video>) gets none; nor does anything outside the shell frame', async () => {
    await mount(true);
    const plain = clip({ controls: false });
    await over(plain.v);
    expect(button()).toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    await mount(false);
    const { v } = clip();
    await over(v);
    expect(button()).toBeNull();
  });

  test('the button is its own hit target: the marquee, router and annotation layer skip it', async () => {
    await mount(true);
    const { v } = clip();
    await over(v);
    const b = button() as HTMLButtonElement;
    expect(shouldIgnoreTarget(b)).toBe(true);
    const ann = readFileSync(join(import.meta.dir, '../annotations-layer.tsx'), 'utf8');
    expect(ann).toContain("t.closest('[data-mediaref-player], [data-vplay]')");
    const router = readFileSync(join(import.meta.dir, '../input-router.tsx'), 'utf8');
    expect(router).toContain('[data-vplay]');
  });

  test('a clip too small on screen (zoomed far out) carries no button; a normal one sits in its corner', () => {
    expect(buttonBox({ left: 0, top: 0, width: VPLAY_MIN - 1, height: 200 })).toBeNull();
    expect(buttonBox({ left: 100, top: 50, width: 320, height: 180 })).toEqual({
      left: 108,
      top: 58,
    });
  });

  // rc3 walk of the packaged rc.2 (r4-1) — the big centre ▶ WebKit draws over a paused clip only selected on the first
  // click in Edit. The layer's own centre ▶ sits exactly over it: the first click there plays, a click elsewhere selects.
  test('the centre ▶ over an unstarted clip plays on the first click and is its own hit target', async () => {
    await mount(true);
    const { v, calls } = clip();
    await over(v);
    const c = document.querySelector<HTMLButtonElement>('[data-testid="video-play-centre"]');
    expect(c).not.toBeNull();
    expect(c?.getAttribute('aria-label')).toBe('Play video');
    expect(shouldIgnoreTarget(c as HTMLButtonElement)).toBe(true);
    await act(async () => void c?.click());
    expect(calls).toEqual(['play']);
    // playing: the native disc is gone, and so is this one; the corner button offers Pause
    expect(document.querySelector('[data-testid="video-play-centre"]')).toBeNull();
    expect(button()?.getAttribute('aria-label')).toBe('Pause video');
    // paused part-way: no centre ▶ comes back (the native one does not either)
    Object.defineProperty(v, 'currentTime', { get: () => 1.5, configurable: true });
    await act(async () => void button()?.click());
    expect(calls).toEqual(['play', 'pause']);
    expect(document.querySelector('[data-testid="video-play-centre"]')).toBeNull();
  });

  test('the centre ▶ is the native disc: 60 px, centred, none on a clip too small to hold it', () => {
    expect(VPLAY_CENTRE).toBe(60);
    expect(centreBox({ left: 100, top: 100, width: 320, height: 180 })).toEqual({
      left: 230,
      top: 160,
    });
    expect(centreBox({ left: 0, top: 0, width: 70, height: 200 })).toBeNull();
  });

  test('canvas-lib mounts the layer', () => {
    const lib = readFileSync(join(import.meta.dir, '../canvas-lib.tsx'), 'utf8');
    expect(lib).toContain('<VideoPlayLayer />');
  });
});
